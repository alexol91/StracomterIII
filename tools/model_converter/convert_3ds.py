#!/usr/bin/env python3
"""Convierte los modelos .3ds de 2012 a glTF 2.0, que es lo que Godot importa.

El formato .3ds está muerto —ningún motor moderno lo lee— pero la geometría la
modeló el equipo original y merece sobrevivir. Esto la rescata sin depender de
Blender ni de ninguna librería: .3ds es un formato de trozos (chunks) sencillo y
el cargador del legacy (`legacy/trunk/Graphics/include/load3ds.h`) sirve de
referencia de cómo lo interpretaba el juego.

Solo biblioteca estándar. Uso:
    python3 convert_3ds.py <origen.3ds> [...] --out <directorio> [--scale N]
"""

from __future__ import annotations

import argparse
import base64
import json
import struct
import sys
from pathlib import Path

# --- Identificadores de trozo del formato 3DS ---------------------------------
CHUNK_MAIN = 0x4D4D
CHUNK_EDIT = 0x3D3D
CHUNK_OBJECT = 0x4000
CHUNK_TRIMESH = 0x4100
CHUNK_VERTICES = 0x4110
CHUNK_FACES = 0x4120
CHUNK_UV = 0x4140

HEADER = struct.Struct("<HI")


class Mesh:
    """Una malla leída del .3ds, ya en el sistema de coordenadas de Godot."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.positions: list[tuple[float, float, float]] = []
        self.uvs: list[tuple[float, float]] = []
        self.indices: list[int] = []

    def is_valid(self) -> bool:
        return bool(self.positions) and bool(self.indices)


def _read_cstring(data: bytes, offset: int) -> tuple[str, int]:
    end = data.index(b"\0", offset)
    return data[offset:end].decode("latin-1"), end + 1


def parse_3ds(path: Path) -> list[Mesh]:
    """Extrae las mallas de un .3ds. Ignora materiales y luces a propósito: el
    remake pinta con sus propios materiales (las texturas de personaje del
    original eran de terceros)."""
    data = path.read_bytes()
    meshes: list[Mesh] = []

    def walk(offset: int, end: int, current: Mesh | None) -> None:
        while offset < end - HEADER.size + 1:
            try:
                chunk_id, chunk_len = HEADER.unpack_from(data, offset)
            except struct.error:
                return
            if chunk_len < 6 or offset + chunk_len > end:
                return
            body = offset + 6

            if chunk_id in (CHUNK_MAIN, CHUNK_EDIT):
                walk(body, offset + chunk_len, current)
            elif chunk_id == CHUNK_OBJECT:
                name, after = _read_cstring(data, body)
                mesh = Mesh(name)
                meshes.append(mesh)
                walk(after, offset + chunk_len, mesh)
            elif chunk_id == CHUNK_TRIMESH:
                walk(body, offset + chunk_len, current)
            elif chunk_id == CHUNK_VERTICES and current is not None:
                count = struct.unpack_from("<H", data, body)[0]
                for i in range(count):
                    x, y, z = struct.unpack_from("<fff", data, body + 2 + i * 12)
                    # 3DS es Z-arriba; Godot es Y-arriba. Se intercambian Y y Z
                    # y se niega la nueva Z para conservar la mano del sistema:
                    # sin negarla el modelo sale en espejo, y un personaje
                    # espejado no se nota hasta que empuña un arma.
                    current.positions.append((x, z, -y))
            elif chunk_id == CHUNK_FACES and current is not None:
                count = struct.unpack_from("<H", data, body)[0]
                for i in range(count):
                    a, b, c, _flags = struct.unpack_from("<HHHH", data, body + 2 + i * 8)
                    # El intercambio de ejes invierte el sentido de giro, así que
                    # se reordena para que las caras sigan mirando hacia fuera.
                    current.indices.extend((a, c, b))
                # Tras la lista de caras pueden venir subtrozos (materiales);
                # no se recorren porque no se usan.
            elif chunk_id == CHUNK_UV and current is not None:
                count = struct.unpack_from("<H", data, body)[0]
                for i in range(count):
                    u, v = struct.unpack_from("<ff", data, body + 2 + i * 8)
                    current.uvs.append((u, 1.0 - v))

            offset += chunk_len

    walk(0, len(data), None)
    return [m for m in meshes if m.is_valid()]


def merge(meshes: list[Mesh], name: str) -> Mesh:
    """Une varias mallas en una. El original repartía un personaje en dos o tres
    objetos; para el remake interesa una malla por fotograma."""
    merged = Mesh(name)
    for mesh in meshes:
        base = len(merged.positions)
        merged.positions.extend(mesh.positions)
        # Si a una parte le faltan UV se rellenan a cero en vez de descartarla:
        # perder geometría por no tener coordenadas de textura sería absurdo.
        uvs = mesh.uvs if len(mesh.uvs) == len(mesh.positions) else [(0.0, 0.0)] * len(mesh.positions)
        merged.uvs.extend(uvs)
        merged.indices.extend(i + base for i in mesh.indices)
    return merged


def bounds(mesh: Mesh) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    xs = [p[0] for p in mesh.positions]
    ys = [p[1] for p in mesh.positions]
    zs = [p[2] for p in mesh.positions]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def to_gltf(mesh: Mesh, scale: float, recenter: bool) -> dict:
    """Genera un glTF 2.0 con el búfer embebido en base64: un solo fichero por
    modelo, que es más fácil de mover y de revisar que un par .gltf + .bin."""
    lo, hi = bounds(mesh)
    # Se apoya el modelo en el suelo (y=0) y se centra en horizontal, para que
    # colocarlo sea poner su origen donde va el personaje y no adivinar offsets.
    ox = (lo[0] + hi[0]) / 2.0 if recenter else 0.0
    oz = (lo[2] + hi[2]) / 2.0 if recenter else 0.0
    oy = lo[1] if recenter else 0.0

    positions = bytearray()
    for x, y, z in mesh.positions:
        positions += struct.pack("<fff", (x - ox) * scale, (y - oy) * scale, (z - oz) * scale)
    uvs = bytearray()
    for u, v in mesh.uvs:
        uvs += struct.pack("<ff", u, v)
    max_index = max(mesh.indices)
    index_fmt, index_type = ("<H", 5123) if max_index < 65536 else ("<I", 5125)
    indices = bytearray()
    for i in mesh.indices:
        indices += struct.pack(index_fmt, i)
    while len(indices) % 4:
        indices += b"\0"

    blob = bytes(positions + uvs + indices)
    p_min = [min((p[k] - (ox, oy, oz)[k]) * scale for p in mesh.positions) for k in range(3)]
    p_max = [max((p[k] - (ox, oy, oz)[k]) * scale for p in mesh.positions) for k in range(3)]

    views = [
        {"buffer": 0, "byteOffset": 0, "byteLength": len(positions), "target": 34962},
        {"buffer": 0, "byteOffset": len(positions), "byteLength": len(uvs), "target": 34962},
        {"buffer": 0, "byteOffset": len(positions) + len(uvs), "byteLength": len(indices), "target": 34963},
    ]
    accessors = [
        {"bufferView": 0, "componentType": 5126, "count": len(mesh.positions),
         "type": "VEC3", "min": p_min, "max": p_max},
        {"bufferView": 1, "componentType": 5126, "count": len(mesh.uvs), "type": "VEC2"},
        {"bufferView": 2, "componentType": index_type, "count": len(mesh.indices), "type": "SCALAR"},
    ]
    attributes = {"POSITION": 0}
    if mesh.uvs:
        attributes["TEXCOORD_0"] = 1
    else:
        views.pop(1)
        accessors.pop(1)
        views[1]["byteOffset"] = len(positions)
        accessors[1]["bufferView"] = 1
        blob = bytes(positions + indices)

    return {
        "asset": {"version": "2.0",
                  "generator": "Stracomter III · conversor 3DS del proyecto de 2012"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": mesh.name}],
        "meshes": [{"name": mesh.name,
                    "primitives": [{"attributes": attributes,
                                    "indices": len(accessors) - 1, "mode": 4}]}],
        "bufferViews": views,
        "accessors": accessors,
        "buffers": [{"byteLength": len(blob),
                     "uri": "data:application/octet-stream;base64," +
                            base64.b64encode(blob).decode("ascii")}],
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", nargs="+", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--scale", type=float, default=1.0)
    parser.add_argument("--no-recenter", action="store_true")
    parser.add_argument("--report", action="store_true",
                        help="solo mide: imprime tamaños sin escribir nada")
    args = parser.parse_args(argv)

    args.out.mkdir(parents=True, exist_ok=True)
    failures = 0
    for source in sorted(args.sources):
        meshes = parse_3ds(source)
        if not meshes:
            print(f"  FALLO {source.name}: sin geometría legible", file=sys.stderr)
            failures += 1
            continue
        mesh = merge(meshes, source.stem)
        lo, hi = bounds(mesh)
        size = (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
        if args.report:
            print(f"  {source.name:<18} v={len(mesh.positions):>6} "
                  f"tri={len(mesh.indices)//3:>6} bbox=({size[0]:.2f}, {size[1]:.2f}, {size[2]:.2f})")
            continue
        gltf = to_gltf(mesh, args.scale, not args.no_recenter)
        target = args.out / f"{source.stem}.gltf"
        target.write_text(json.dumps(gltf, separators=(",", ":")), encoding="utf-8")
        print(f"  OK {source.name} -> {target.name} "
              f"({len(mesh.positions)} v, {len(mesh.indices)//3} tri, "
              f"alto {size[1] * args.scale:.2f} m)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
