#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_all.py — Regenera los 27 mapas legacy y el informe de conversión.

Convierte los 26 XML de `legacy/trunk/testFiles/maps/*.xml` más
`legacy/trunk/editorMap.xml` a `game/maps/legacy/*.tscn` (mismo nombre base
que el XML de origen), valida cada uno con `validate.py` y escribe
`game/maps/legacy/CONVERSION.md` con una fila por mapa.

Determinista: se puede ejecutar tantas veces como se quiera, produce
siempre los mismos 27 `.tscn` byte a byte y el mismo CONVERSION.md (salvo la
fecha de cabecera, que se fija explícitamente a partir de la fecha de commit
si se desea reproducibilidad total — ver --no-date).

Uso:
    python3 tools/map_converter/build_all.py
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import List, Tuple

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

import convert as cv  # noqa: E402
import validate as vd  # noqa: E402

REPO_ROOT = os.path.abspath(os.path.join(_HERE, "..", ".."))
LEGACY_MAPS_DIR = os.path.join(REPO_ROOT, "legacy", "trunk", "testFiles", "maps")
EDITOR_MAP_XML = os.path.join(REPO_ROOT, "legacy", "trunk", "editorMap.xml")
OUTPUT_DIR = os.path.join(REPO_ROOT, "game", "maps", "legacy")
REPORT_PATH = os.path.join(OUTPUT_DIR, "CONVERSION.md")

# Los 26 mapas de testFiles/maps/*.xml (se listan explícitamente, no con un
# glob, para que el orden del informe sea siempre el mismo con independencia
# del sistema de ficheros).
SOURCE_BASENAMES = [
    "finalMap.xml",
    "gallardoMap.xml",
    "map1.xml",
    "map4.xml",
    "map5.xml",
    "map6.xml",
    "mapAlex.xml",
    "mapG1.xml",
    "mapG2.xml",
    "mapG3.xml",
    "mapG4.xml",
    "mapM1.xml",
    "mapM2.xml",
    "mapM3.xml",
    "mapM4.xml",
    "mapP1.xml",
    "mapP2.xml",
    "mapP3.xml",
    "mapP4.xml",
    "mapRuben.xml",
    "map_01.xml",
    "map_02.xml",
    "map_03.xml",
    "map_04.xml",
    "mapaMolon.xml",
    "pruebasMov.xml",
]

# Mapas exigidos textualmente por game/src/data/floors/*.tres
# (res://maps/legacy/<n>.tscn): deben existir con estos nombres exactos.
REQUIRED_SCENE_NAMES = [
    "mapP1", "mapP2", "mapP3", "mapP4",
    "mapM1", "mapM3", "mapM4",
    "mapG1", "mapG2", "mapG3", "mapG4",
    "finalMap",
]


def _source_list() -> List[Tuple[str, str]]:
    """Devuelve [(ruta_xml, nombre_escena), ...] en orden determinista."""
    out = []
    for base in SOURCE_BASENAMES:
        out.append((os.path.join(LEGACY_MAPS_DIR, base), os.path.splitext(base)[0]))
    out.append((EDITOR_MAP_XML, "editorMap"))
    return out


def _md_escape(s: str) -> str:
    return s.replace("|", "\\|")


def build_all(write_report: bool = True) -> int:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    sources = _source_list()

    rows = []
    any_fail = False

    for xml_path, scene_name in sources:
        tscn_path = os.path.join(OUTPUT_DIR, f"{scene_name}.tscn")
        rel_xml = os.path.relpath(xml_path, REPO_ROOT)
        rel_tscn = os.path.relpath(tscn_path, REPO_ROOT)

        try:
            summary = cv.convert_file(xml_path, tscn_path)
            conv_error = None
        except Exception as exc:  # noqa: BLE001 — se informa en el reporte, no se oculta
            summary = None
            conv_error = str(exc)

        result = vd.validate_map(xml_path)

        status = "OK" if (conv_error is None and result.ok) else "FALLO"
        if status == "FALLO":
            any_fail = True

        notes: List[str] = []
        if conv_error:
            notes.append(f"error de conversión: {conv_error}")
        notes.extend(f"ERROR: {e}" for e in result.errors)
        notes.extend(f"aviso: {w}" for w in result.warnings)
        if summary:
            notes.extend(f"aviso: {w}" for w in summary["warnings"] if w not in result.warnings)

        rows.append({
            "xml": rel_xml,
            "tscn": rel_tscn,
            "scene_name": scene_name,
            "area_m2": result.area_m2,
            "walls": result.counts.get("walls", 0),
            "doors": result.counts.get("doors", 0),
            "obstacles": result.counts.get("obstacles", 0),
            "pickups": result.counts.get("pickups", 0),
            "has_player": result.counts.get("has_player", False),
            "has_mini_boss": result.counts.get("has_mini_boss", False),
            "has_mega_boss": result.counts.get("has_mega_boss", False),
            "nav_free_cells": result.nav_free_cells,
            "nav_reachable_ratio": result.nav_reachable_ratio,
            "status": status,
            "notes": notes,
            "required": scene_name in REQUIRED_SCENE_NAMES,
        })

        mark = "OK  " if status == "OK" else "FAIL"
        print(f"{mark} {rel_xml} -> {rel_tscn}")
        for n in notes:
            print(f"       {n}")

    if write_report:
        _write_report(rows)

    print("")
    print(f"{len(rows)} mapas procesados, "
          f"{sum(1 for r in rows if r['status'] == 'OK')} OK, "
          f"{sum(1 for r in rows if r['status'] == 'FALLO')} con fallos.")
    return 1 if any_fail else 0


def _write_report(rows: List[dict]) -> None:
    lines = []
    lines.append("# Conversión de mapas legacy a Godot 4")
    lines.append("")
    lines.append(
        "Generado automáticamente por `tools/map_converter/build_all.py`. "
        "**No editar a mano**: se sobrescribe en cada regeneración."
    )
    lines.append("")
    lines.append(
        "Fuente: 26 mapas de `legacy/trunk/testFiles/maps/*.xml` más "
        "`legacy/trunk/editorMap.xml` (27 en total). Escala 1 unidad legacy "
        "= 1/75 m (`docs/01-gdd.md` §5). Validación con "
        "`tools/map_converter/validate.py` (ver ese fichero para el criterio "
        "exacto de cada comprobación)."
    )
    lines.append("")
    lines.append(
        "| XML origen | Escena | Área (m²) | Muros | Puertas | Obstáculos | "
        "Pickups | Player | MiniBoss | MegaBoss | Navmesh (libres / alcanzable) | "
        "Resultado | Notas |"
    )
    lines.append("|---|---|---:|---:|---:|---:|---:|:-:|:-:|:-:|---:|:-:|---|")

    for r in rows:
        name_cell = f"`{r['scene_name']}`" + (" **(requerido)**" if r["required"] else "")
        notes = "; ".join(_md_escape(n) for n in r["notes"]) if r["notes"] else "—"
        lines.append(
            f"| `{r['xml']}` | {name_cell} | {r['area_m2']:.0f} | {r['walls']} | "
            f"{r['doors']} | {r['obstacles']} | {r['pickups']} | "
            f"{'sí' if r['has_player'] else 'no'} | "
            f"{'sí' if r['has_mini_boss'] else 'no'} | "
            f"{'sí' if r['has_mega_boss'] else 'no'} | "
            f"{r['nav_free_cells']} / {r['nav_reachable_ratio']*100:.0f}% | "
            f"{'OK' if r['status'] == 'OK' else '**FALLO**'} | {notes} |"
        )

    lines.append("")
    total = len(rows)
    ok_count = sum(1 for r in rows if r["status"] == "OK")
    lines.append(f"**Totales**: {total} mapas convertidos, {ok_count} validados sin fallos, "
                 f"{total - ok_count} con fallos.")
    lines.append("")
    lines.append(
        "Notas generales: el navmesh se hornea con una rejilla regular propia "
        "(no con `NavigationServer3D.bake`), documentada en "
        "`tools/map_converter/README.md`. Las puertas, obstáculos, pickups y "
        "spawns se generan como nodos `Marker3D` con metadatos (`tipo`, "
        "posición, ángulo) — no llevan geometría ni colisión: otro agente "
        "instanciará las escenas de gameplay reales sobre estos marcadores. "
        "\"Navmesh (libres / alcanzable)\" es el número de celdas navegables "
        "de la rejilla y el porcentaje alcanzable desde el spawn del "
        "jugador (100% cuando no hay zonas aisladas; el umbral de fallo del "
        f"validador es {vd.REACHABILITY_MIN_RATIO*100:.0f}%)."
    )
    lines.append("")

    with open(REPORT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-report", action="store_true", help="No escribir CONVERSION.md")
    args = parser.parse_args(argv)
    return build_all(write_report=not args.no_report)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
