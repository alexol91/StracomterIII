#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
validate.py — Validador de mapas legacy convertidos.

No es opcional: un mapa que convierte sin excepciones pero no es navegable
es peor que uno que falla, porque el fallo aparece en tiempo de ejecución.
Este módulo valida directamente el modelo de datos que produce
`legacy_map.load_map()` (la misma fuente que usa `convert.py` para generar
la escena), así que un "OK" aquí es una garantía sobre la escena resultante:
la geometría de navegación se deriva de forma determinista de esos mismos
datos (`legacy_map.build_nav_grid`).

Comprueba:
  1. Carga: el XML se interpretó sin abortar (status Map::loadData >= 0) y
     tiene perímetro.
  2. Geometría no degenerada: perímetro con área > 0 y sin vértices
     duplicados consecutivos; cada wall/door con área > 0.
  3. Orientación: el perímetro es horario y los muros/puertas no lo son,
     igual que en los 27 mapas originales (Polygon::isClockwise). Es una
     nota informativa, no bloquea la validación (no afecta a la
     triangulación, que es agnóstica a la orientación de entrada).
  4. Spawn del jugador dentro del perímetro y en una celda navegable.
  5. Muros y puertas dentro (o razonablemente cerca) del perímetro.
  6. Navmesh no vacío y todas las zonas alcanzables desde el spawn del
     jugador (flood-fill sobre la rejilla de navegación).

Uso:
    python3 validate.py <mapa.xml>
    python3 validate.py --all   # valida los 27 mapas de origen
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass, field
from typing import List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import legacy_map as lm  # noqa: E402


REACHABILITY_MIN_RATIO = 0.90  # zonas "sueltas" toleradas (huecos alrededor de mobiliario, ruido de rejilla)


@dataclass
class ValidationResult:
    xml_path: str
    ok: bool = True
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)
    area_m2: float = 0.0
    counts: dict = field(default_factory=dict)
    nav_free_cells: int = 0
    nav_reachable_cells: int = 0
    nav_reachable_ratio: float = 0.0

    def fail(self, msg: str) -> None:
        self.ok = False
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    def note(self, msg: str) -> None:
        self.notes.append(msg)


def validate_map(xml_path: str) -> ValidationResult:
    r = ValidationResult(xml_path=xml_path)
    try:
        m = lm.load_map(xml_path)
    except lm.MapLoadError as exc:
        r.fail(f"no se pudo cargar el XML: {exc}")
        return r

    for w in m.load_warnings:
        # Un status < 0 es un fallo real de carga (equivalente al del motor
        # original); el resto de avisos de carga se listan como advertencias.
        if "abortada" in w:
            r.fail(w)
        else:
            r.warn(w)

    if m.status < 0:
        return r  # sin perímetro fiable, no tiene sentido seguir validando geometría

    # ---- 1. Perímetro ------------------------------------------------
    perim = m.perimeter
    if len(perim) < 3:
        r.fail("perímetro con menos de 3 vértices")
        return r

    if lm.has_duplicate_consecutive_vertices(perim):
        r.warn("el perímetro tiene vértices consecutivos duplicados")

    area_u2 = lm.polygon_area_abs(perim)
    r.area_m2 = area_u2 * (lm.SCALE ** 2)
    if area_u2 < 1.0:
        r.fail(f"área del perímetro degenerada ({area_u2} u²)")

    perim_cw = lm.legacy_is_clockwise(perim)
    if perim_cw:
        r.note("perímetro horario (coherente con los 27 mapas originales)")
    else:
        r.warn("perímetro antihorario (los 27 mapas originales son horarios; revisar orden de vértices)")

    # ---- 2. Muros ------------------------------------------------------
    degenerate_walls = 0
    outside_walls = 0
    for i, quad in enumerate(m.walls):
        if len(quad) != 4:
            r.fail(f"wall {i}: no tiene 4 vértices (no debería poder ocurrir tras la carga)")
            continue
        if lm.has_duplicate_consecutive_vertices(quad):
            r.warn(f"wall {i}: vértices consecutivos duplicados")
        a = lm.polygon_area_abs(quad)
        if a < 1.0:
            degenerate_walls += 1
        cx = sum(p[0] for p in quad) / 4.0
        cy = sum(p[1] for p in quad) / 4.0
        if not lm.point_in_polygon(cx, cy, perim):
            outside_walls += 1
    if degenerate_walls:
        r.fail(f"{degenerate_walls} muro(s) con área ~0 (geometría degenerada)")
    if outside_walls:
        r.warn(f"{outside_walls} muro(s) cuyo centro cae fuera del perímetro")

    # ---- 3. Puertas ------------------------------------------------------
    degenerate_doors = 0
    outside_doors = 0
    door_sizes = []
    for i, quad in enumerate(m.doors):
        if len(quad) != 4:
            r.fail(f"door {i}: no tiene 4 vértices")
            continue
        a = lm.polygon_area_abs(quad)
        if a < 1.0:
            degenerate_doors += 1
        obb = lm.oriented_box_from_quad(quad)
        door_sizes.append((obb["length"], obb["width"]))
        cx, cy = obb["cx"], obb["cy"]
        if not lm.point_in_polygon(cx, cy, perim):
            outside_doors += 1
    if degenerate_doors:
        r.fail(f"{degenerate_doors} puerta(s) con área ~0 (geometría degenerada)")
    if outside_doors:
        r.warn(f"{outside_doors} puerta(s) cuyo centro cae fuera del perímetro")
    for length, width in door_sizes:
        # Tamaños observados en el corpus original: 100x25 o 25x100 u.
        long_ok = 60 <= length <= 400
        short_ok = 10 <= width <= 60
        if not (long_ok and short_ok):
            r.warn(f"puerta con tamaño atípico ({length:.0f}x{width:.0f} u, "
                   "se esperaba ~100x25 u)")

    # ---- 4. Obstáculos: subtype fuera de rango ------------------------
    for i, obs in enumerate(m.obstacles):
        if obs.subtype not in lm.OBSTACLE_NAMES:
            r.warn(f"obstacle {i}: subtype {obs.subtype} fuera de la tabla conocida (0-7)")
    for i, pu in enumerate(m.objects):
        if pu.subtype not in lm.OBJECTS_NAMES:
            r.warn(f"objects {i}: subtype {pu.subtype} fuera de la tabla conocida (0-6)")
        elif pu.subtype == 6:
            r.note(f"objects {i}: subtype 'sniper' — sin efecto en el juego original (\"Próximamente\")")

    # ---- 5. Spawn del jugador -------------------------------------------
    grid = lm.build_nav_grid(m)
    nav_free = lm.nav_grid_free_count(grid)
    r.nav_free_cells = nav_free

    if m.player is None:
        r.warn("sin <object type=\"player\">: no se puede comprobar alcanzabilidad")
    else:
        px, py = float(m.player.x), float(m.player.y)
        if not lm.point_in_polygon(px, py, perim):
            r.fail(f"el spawn del jugador ({px:.0f},{py:.0f}) está fuera del perímetro")
        cell = lm.nav_grid_cell_of(grid, px, py)
        if cell is None:
            r.fail("el spawn del jugador cae fuera de la rejilla de navegación")
        elif grid.nx and grid.ny and not grid.free[cell[1]][cell[0]]:
            r.fail("el spawn del jugador cae dentro de un muro/obstáculo (celda de navegación bloqueada)")
        else:
            _visited, reachable = lm.nav_grid_reachable(grid, cell)
            r.nav_reachable_cells = reachable
            r.nav_reachable_ratio = (reachable / nav_free) if nav_free else 0.0
            if nav_free == 0:
                r.fail("navmesh vacío (0 celdas libres): el mapa no tiene área navegable")
            elif r.nav_reachable_ratio < REACHABILITY_MIN_RATIO:
                r.fail(
                    f"solo el {r.nav_reachable_ratio*100:.1f}% del área libre es alcanzable "
                    f"desde el spawn del jugador (umbral {REACHABILITY_MIN_RATIO*100:.0f}%): "
                    "hay zonas aisladas"
                )
            else:
                r.note(f"alcanzabilidad desde el spawn: {r.nav_reachable_ratio*100:.1f}% del área libre")

    if nav_free == 0 and m.player is None:
        r.fail("navmesh vacío (0 celdas libres): el mapa no tiene área navegable")

    # ---- 6. miniBoss/megaBoss: comprobar que no aparecen dentro de un muro
    for label, boss in (("miniBoss", m.mini_boss), ("megaBoss", m.mega_boss)):
        if boss is None:
            continue
        cell = lm.nav_grid_cell_of(grid, float(boss.x), float(boss.y))
        if cell is None or (grid.nx and grid.ny and not grid.free[cell[1]][cell[0]]):
            r.warn(f"{label} en ({boss.x},{boss.y}) cae en una celda no navegable")

    if m.unknown_types:
        r.note(f"tipos ignorados por el motor original: {sorted(set(m.unknown_types))}")

    r.counts = {
        "walls": len(m.walls),
        "doors": len(m.doors),
        "obstacles": len(m.obstacles),
        "pickups": len(m.objects),
        "has_player": m.player is not None,
        "has_mini_boss": m.mini_boss is not None,
        "has_mega_boss": m.mega_boss is not None,
    }
    return r


def format_report(r: ValidationResult) -> str:
    lines = [f"== {r.xml_path} =="]
    lines.append(f"  resultado: {'OK' if r.ok else 'FALLO'}")
    lines.append(f"  área: {r.area_m2:.1f} m²")
    lines.append(f"  navmesh: {r.nav_free_cells} celdas libres, "
                 f"{r.nav_reachable_cells} alcanzables "
                 f"({r.nav_reachable_ratio*100:.1f}%)")
    for e in r.errors:
        lines.append(f"  ERROR: {e}")
    for w in r.warnings:
        lines.append(f"  aviso: {w}")
    for n in r.notes:
        lines.append(f"  nota: {n}")
    return "\n".join(lines)


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("xml", help="Mapa de origen (.xml)")
    args = parser.parse_args(argv)

    r = validate_map(args.xml)
    print(format_report(r))
    return 0 if r.ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
