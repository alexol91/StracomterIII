"""Lector mínimo de glTF: solo lo que hace falta para pintar uniformes.

No es una librería de glTF. Lee los accesores de una malla concreta y la
jerarquía de huesos de su `skin`, porque para repintar un personaje hace falta
saber **qué parte del cuerpo** ocupa cada téxel, y eso solo lo dicen los pesos
de piel y las coordenadas UV.

Se escribe a mano en vez de tirar de `pygltflib` por la regla del proyecto: sin
dependencias externas más allá de numpy/Pillow, que ya usa el horneador de
texturas.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

# Tipos de componente de glTF → dtype de numpy.
_COMPONENT = {
    5120: np.int8,
    5121: np.uint8,
    5122: np.int16,
    5123: np.uint16,
    5125: np.uint32,
    5126: np.float32,
}

_COMPONENTS_PER_ELEMENT = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT4": 16,
}


class Gltf:
    """Un fichero glTF (`.gltf` + `.bin`) o `.glb` ya cargado en memoria."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        if self.path.suffix.lower() == ".glb":
            self.json, self._buffers = _read_glb(self.path)
        else:
            self.json = json.loads(self.path.read_text(encoding="utf-8"))
            self._buffers = [
                (self.path.parent / buffer["uri"]).read_bytes()
                for buffer in self.json.get("buffers", [])
            ]

    def accessor(self, index: int) -> np.ndarray:
        """Datos de un accesor, como `(count, componentes)` o `(count,)`."""
        acc = self.json["accessors"][index]
        dtype = _COMPONENT[acc["componentType"]]
        width = _COMPONENTS_PER_ELEMENT[acc["type"]]
        count = acc["count"]
        view = self.json["bufferViews"][acc["bufferView"]]
        blob = self._buffers[view.get("buffer", 0)]
        start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        stride = view.get("byteStride", 0)
        item = np.dtype(dtype).itemsize * width

        if stride and stride != item:
            # Accesor entrelazado: hay que saltar de elemento en elemento.
            out = np.empty((count, width), dtype=dtype)
            for i in range(count):
                offset = start + i * stride
                out[i] = np.frombuffer(blob, dtype=dtype, count=width, offset=offset)
        else:
            out = np.frombuffer(blob, dtype=dtype, count=count * width, offset=start)
            out = out.reshape(count, width)
        return out[:, 0] if width == 1 else out

    def mesh_index_by_material(self, material_name: str) -> int:
        """Índice de la malla cuyo material se llama así. -1 si no está."""
        for index, mesh in enumerate(self.json.get("meshes", [])):
            for primitive in mesh["primitives"]:
                material = self.json["materials"][primitive["material"]]
                if material.get("name") == material_name:
                    return index
        return -1

    def primitive(self, mesh_index: int) -> dict:
        return self.json["meshes"][mesh_index]["primitives"][0]

    def bone_names(self, skin_index: int = 0) -> list[str]:
        """Nombres de los huesos EN EL ORDEN de `JOINTS_0`.

        El orden importa: `JOINTS_0` guarda índices dentro de `skin.joints`, no
        índices de nodo. Confundirlos no da error, da un personaje con la ropa
        repartida al azar.
        """
        skin = self.json["skins"][skin_index]
        return [self.json["nodes"][node].get("name", "") for node in skin["joints"]]


def _read_glb(path: Path) -> tuple[dict, list[bytes]]:
    blob = path.read_bytes()
    if blob[:4] != b"glTF":
        raise ValueError(f"{path} no es un .glb")
    offset = 12
    doc: dict = {}
    binary = b""
    while offset < len(blob):
        length, kind = struct.unpack_from("<II", blob, offset)
        offset += 8
        chunk = blob[offset : offset + length]
        if kind == 0x4E4F534A:
            doc = json.loads(chunk)
        elif kind == 0x004E4942:
            binary = chunk
        offset += length
    return doc, [binary]
