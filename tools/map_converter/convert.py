#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
convert.py — Conversor de mapas legacy (XML, Stracomter III 2012) a escenas
Godot 4.7 en texto plano (.tscn).

Uso:
    python3 convert.py <mapa.xml> <salida.tscn>
    python3 convert.py --all          # convierte los 27 mapas de origen a
                                       # game/maps/legacy/ (ver build_all.py)

Solo librería estándar de Python 3. Determinista: la misma entrada produce
siempre la misma salida byte a byte (no hay timestamps, UUIDs aleatorios ni
orden de iteración de dict no determinista: todo se recorre en el orden del
XML de origen).

Ver tools/map_converter/README.md para las decisiones de diseño (escala,
mapeo de coordenadas, por qué puertas/obstáculos/pickups/spawns son
marcadores con metadatos y no geometría, cómo se hornea el navmesh).
"""

from __future__ import annotations

import argparse
import math
import os
import sys
from typing import Dict, List, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import legacy_map as lm  # noqa: E402


# ---------------------------------------------------------------------------
# Rutas de los scripts de construcción en tiempo de ejecución (compartidos
# por las 27 escenas; ver esos ficheros para el porqué de este patrón: evita
# tener que escribir a mano el formato binario comprimido de ArrayMesh).
# ---------------------------------------------------------------------------
FLOOR_SCRIPT_RES_PATH = "res://maps/legacy/_legacy_floor_mesh.gd"
NAVMESH_SCRIPT_RES_PATH = "res://maps/legacy/_legacy_navmesh.gd"
# Los mapas se generan SIN materiales a propósito: el aspecto lo decide
# `PresentationStyle` en tiempo de ejecución, y así `: chutaos on|off` puede
# cambiar el mundo entero. Si se pintaran aquí, quedaría horneado en 24
# escenas generadas y el truco no podría tocarlo.
DRESSING_SCRIPT_RES_PATH = "res://src/gameplay/world_dressing.gd"
# El juego no tenía ni una luz: con Forward+ eso no da error, da un mundo
# negro. La iluminación viaja con el mapa por lo mismo que el vestido — una
# planta cargada suelta tiene que verse igual que en partida.
LIGHTING_SCRIPT_RES_PATH = "res://src/gameplay/world_lighting.gd"


def _fmt(v: float) -> str:
    """Formatea un float de forma determinista y compacta para el .tscn."""
    if v == int(v) and abs(v) < 1e15:
        return f"{int(v)}"
    s = f"{v:.6f}".rstrip("0").rstrip(".")
    return s if s else "0"


def _vec3(x: float, y: float, z: float) -> str:
    return f"Vector3({_fmt(x)}, {_fmt(y)}, {_fmt(z)})"


def _legacy_xy_to_godot(x: float, y: float, height: float = 0.0) -> Tuple[float, float, float]:
    """godot(x, y) = Vector3(x*S, altura, y*S). Sin inversión de eje: con una
    cámara cenital rotada -90º en X (mirando -Y, 'arriba' de pantalla = -Z)
    la imagen coincide con la del legacy (+x derecha, +y abajo) sin invertir
    nada. Ver docs/analisis/legacy-datos-assets.md §6.2 y el README de este
    conversor."""
    return x * lm.SCALE, height, y * lm.SCALE


def _basis_rotation_y(rot_y: float) -> str:
    """Basis de una rotación pura en Y (matriz estándar right-handed,
    R_y(θ)·e_x = (cosθ, 0, -sinθ), R_y(θ)·e_z = (sinθ, 0, cosθ)), serializada
    en el orden que usa Godot: basis.x, basis.y, basis.z (cada uno como
    vector fila de 3 componentes)."""
    c = math.cos(rot_y)
    s = math.sin(rot_y)
    return (f"{_fmt(c)}, 0, {_fmt(-s)}, 0, 1, 0, {_fmt(s)}, 0, {_fmt(c)}")


def _transform3d(rot_y: float, pos: Tuple[float, float, float]) -> str:
    basis = _basis_rotation_y(rot_y)
    return f"Transform3D({basis}, {_fmt(pos[0])}, {_fmt(pos[1])}, {_fmt(pos[2])})"


class SceneWriter:
    """Acumula nodos/sub-recursos de un .tscn y produce el texto final."""

    def __init__(self, root_name: str, root_type: str = "Node3D"):
        self.root_name = root_name
        self.root_type = root_type
        self.ext_resources: List[str] = []   # líneas [ext_resource ...]
        self._ext_ids: Dict[str, str] = {}   # res_path -> id
        self.sub_resources: List[str] = []   # bloques [sub_resource ...]
        self.nodes: List[str] = []           # bloques [node ...]
        self._sub_counter = 0

    def ext_resource(self, res_type: str, path: str) -> str:
        if path in self._ext_ids:
            return self._ext_ids[path]
        rid = f"{res_type}_{len(self._ext_ids) + 1}"
        self._ext_ids[path] = rid
        self.ext_resources.append(
            f'[ext_resource type="{res_type}" path="{path}" id="{rid}"]'
        )
        return rid

    def sub_resource(self, res_type: str, body_lines: List[str], hint: str = "") -> str:
        self._sub_counter += 1
        rid = f"{res_type}_{hint}{self._sub_counter}" if hint else f"{res_type}_{self._sub_counter}"
        block = [f'[sub_resource type="{res_type}" id="{rid}"]']
        block.extend(body_lines)
        self.sub_resources.append("\n".join(block))
        return rid

    def node(self, name: str, node_type: str = "", parent: str = "", *,
              properties: List[str] = None) -> None:
        header = f'[node name="{name}"'
        if node_type:
            header += f' type="{node_type}"'
        if parent:
            header += f' parent="{parent}"'
        header += "]"
        lines = [header]
        if properties:
            lines.extend(properties)
        self.nodes.append("\n".join(lines))

    def render(self, header_comment: str) -> str:
        load_steps = 1 + len(self._ext_ids) + self._sub_counter
        parts: List[str] = []
        parts.append(header_comment.rstrip("\n"))
        parts.append("")
        parts.append(f'[gd_scene load_steps={load_steps} format=3]')
        parts.append("")
        if self.ext_resources:
            parts.extend(self.ext_resources)
            parts.append("")
        if self.sub_resources:
            for block in self.sub_resources:
                parts.append(block)
                parts.append("")
        for block in self.nodes:
            parts.append(block)
            parts.append("")
        text = "\n".join(parts)
        while text.endswith("\n\n\n"):
            text = text[:-1]
        if not text.endswith("\n"):
            text += "\n"
        return text


def _packed_vector3_array(points3d: List[Tuple[float, float, float]]) -> str:
    flat = []
    for x, y, z in points3d:
        flat.append(_fmt(x))
        flat.append(_fmt(y))
        flat.append(_fmt(z))
    return f"PackedVector3Array({', '.join(flat)})"


def _packed_vector2_array(points2d: List[Tuple[float, float]]) -> str:
    flat = []
    for u, v in points2d:
        flat.append(_fmt(u))
        flat.append(_fmt(v))
    return f"PackedVector2Array({', '.join(flat)})"


def _packed_int32_array(values: List[int]) -> str:
    return f"PackedInt32Array({', '.join(str(int(v)) for v in values)})"


def _ensure_ccw_up(tri_indices: Tuple[int, int, int], verts3d: List[Tuple[float, float, float]]
                    ) -> Tuple[int, int, int]:
    a, b, c = tri_indices
    ax, ay, az = verts3d[a]
    bx, by, bz = verts3d[b]
    cx, cy, cz = verts3d[c]
    ux, uy, uz = bx - ax, by - ay, bz - az
    vx, vy, vz = cx - ax, cy - ay, cz - az
    ny = uz * vx - ux * vz  # componente Y de (u x v)
    if ny < 0:
        return a, c, b
    return a, b, c


def _build_perimeter_skirt(perimeter: List[Tuple[float, float]]
                            ) -> Tuple[List[Tuple[float, float, float]], List[int]]:
    """Zócalo vertical de TODAS las aristas del perímetro (de y=0 a
    y=WALL_HEIGHT_M), como triángulos del MISMO tipo de malla que el suelo —
    no como cajas independientes. Ver la nota grande en
    _legacy_floor_mesh.gd: una `BoxShape3D` suelta y girada por arista del
    perímetro rompe el horneado de NavigationServer3D en zonas alejadas de la
    propia caja (confirmado en finalMap.xml, en la única arista diagonal más
    cercana a una puerta). Un trimesh no tiene ese problema (el propio suelo,
    con esas mismas aristas diagonales, hornea sin fallos).

    Se probó una versión más quirúrgica —quedarse con la `BoxShape3D` en las
    aristas alineadas a ejes y fundir solo las diagonales— confiando en que
    el problema fuera específico de la rotación. **No lo es**: en `map1.xml`
    y `mapP1.xml` (perímetros rectilíneos SIN ninguna arista diagonal) el
    mismo problema apareció en aristas alineadas a ejes, y esa versión
    quirúrgica los dejaba tan rotos como antes del arreglo (74 % y 89 % de
    componente mayor en vez del 100 %). Por eso aquí se funden TODAS las
    aristas sin excepción; `Walls/PerimeterWall_i` se queda sin colisión
    propia (ver más abajo)."""
    n = len(perimeter)
    if n < 3:
        return [], []
    centroid_x = sum(p[0] for p in perimeter) / n
    centroid_y = sum(p[1] for p in perimeter) / n
    verts: List[Tuple[float, float, float]] = []
    indices: List[int] = []

    def vid(v: Tuple[float, float, float]) -> int:
        verts.append(v)
        return len(verts) - 1

    for i in range(n):
        p0 = perimeter[i]
        p1 = perimeter[(i + 1) % n]
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        if math.hypot(dx, dy) < 1e-6:
            continue
        b0 = _legacy_xy_to_godot(p0[0], p0[1], 0.0)
        t0 = _legacy_xy_to_godot(p0[0], p0[1], lm.WALL_HEIGHT_M)
        b1 = _legacy_xy_to_godot(p1[0], p1[1], 0.0)
        t1 = _legacy_xy_to_godot(p1[0], p1[1], lm.WALL_HEIGHT_M)
        i_b0, i_t0, i_b1, i_t1 = vid(b0), vid(t0), vid(b1), vid(t1)

        mid_out_x, _mh, mid_out_z = _legacy_xy_to_godot(
            (p0[0] + p1[0]) / 2.0 - centroid_x, (p0[1] + p1[1]) / 2.0 - centroid_y, 0.0
        )

        for tri in ((i_b0, i_b1, i_t1), (i_b0, i_t1, i_t0)):
            a, b, c = tri
            ax, ay, az = verts[a]
            bx, by, bz = verts[b]
            cx, cy, cz = verts[c]
            ux, uy, uz = bx - ax, by - ay, bz - az
            vx, vy, vz = cx - ax, cy - ay, cz - az
            nx = uy * vz - uz * vy
            nz = ux * vy - uy * vx
            # se orienta hacia FUERA del centroide; el sentido exacto no
            # afecta a la clasificación de Recast (una cara casi vertical no
            # es "suelo" mires desde el lado que la mires) pero mantiene la
            # malla coherente para depurar y para una futura colisión de dos
            # caras si hiciera falta.
            if (nx * mid_out_x + nz * mid_out_z) < 0:
                tri = (a, c, b)
            indices.extend(tri)

    return verts, indices


def _quad_ccw_up(quad: Tuple[int, int, int, int], verts3d: List[Tuple[float, float, float]]
                  ) -> Tuple[int, int, int, int]:
    a, b, c, d = quad
    fixed = _ensure_ccw_up((a, b, c), verts3d)
    if fixed == (a, b, c):
        return a, b, c, d
    return d, c, b, a


# ---------------------------------------------------------------------------
# Construcción de la escena
# ---------------------------------------------------------------------------

def build_scene(m: "lm.LegacyMap", scene_name: str) -> Tuple[str, Dict]:
    """Construye el texto del .tscn y un resumen de conteos/metadatos para el
    informe de conversión. `scene_name` es el nombre del nodo raíz (== nombre
    de fichero sin extensión)."""

    sw = SceneWriter(root_name=scene_name)
    warnings: List[str] = list(m.load_warnings)

    if len(m.perimeter) < 3:
        warnings.append("perímetro con menos de 3 vértices: no se genera geometría de suelo")

    area_u2 = lm.polygon_area_abs(m.perimeter) if len(m.perimeter) >= 3 else 0.0
    area_m2 = area_u2 * (lm.SCALE ** 2)
    min_x, max_x, min_y, max_y = lm.bbox(m.perimeter) if m.perimeter else (0, 0, 0, 0)
    is_cw_legacy = lm.legacy_is_clockwise(m.perimeter) if len(m.perimeter) >= 3 else None

    floor_script_id = sw.ext_resource("Script", FLOOR_SCRIPT_RES_PATH)
    navmesh_script_id = sw.ext_resource("Script", NAVMESH_SCRIPT_RES_PATH)
    dressing_script_id = sw.ext_resource("Script", DRESSING_SCRIPT_RES_PATH)
    lighting_script_id = sw.ext_resource("Script", LIGHTING_SCRIPT_RES_PATH)

    # ---- raíz -------------------------------------------------------
    root_meta = [
        f'metadata/source_xml = "{os.path.basename(m.source_path)}"',
        f'metadata/scale_u_to_m = {_fmt(lm.SCALE)}',
        f'metadata/legacy_bbox = Rect2({_fmt(min_x)}, {_fmt(min_y)}, {_fmt(max_x - min_x)}, {_fmt(max_y - min_y)})',
        f'metadata/legacy_area_u2 = {_fmt(area_u2)}',
        f'metadata/area_m2 = {_fmt(area_m2)}',
        f'metadata/wall_count = {len(m.walls)}',
        f'metadata/door_count = {len(m.doors)}',
        f'metadata/obstacle_count = {len(m.obstacles)}',
        f'metadata/pickup_count = {len(m.objects)}',
        f'metadata/has_player = {"true" if m.player else "false"}',
        f'metadata/has_mini_boss = {"true" if m.mini_boss else "false"}',
        f'metadata/has_mega_boss = {"true" if m.mega_boss else "false"}',
        f'metadata/load_status = {m.status}',
    ]
    if m.unknown_types:
        joined = ",".join(m.unknown_types)
        root_meta.append(f'metadata/ignored_object_types = "{joined}"')
    sw.node(scene_name, "Node3D", properties=root_meta)

    # ---- suelo (Floor) -----------------------------------------------
    if len(m.perimeter) >= 3:
        verts3d = [_legacy_xy_to_godot(x, y) for x, y in m.perimeter]
        tris = lm.triangulate_ear_clip(m.perimeter)
        tris = [_ensure_ccw_up(t, verts3d) for t in tris]
        indices: List[int] = []
        for a, b, c in tris:
            indices.extend([a, b, c])
        uvs = [(x / 200.0, y / 200.0) for x, y in m.perimeter]

        skirt_verts3d, skirt_indices = _build_perimeter_skirt(m.perimeter)

        floor_props = [
            "transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0)",
            "collision_layer = 1",
            "collision_mask = 0",
            f'script = ExtResource("{floor_script_id}")',
            f"floor_vertices = {_packed_vector3_array(verts3d)}",
            f"floor_uvs = {_packed_vector2_array(uvs)}",
            f"floor_indices = {_packed_int32_array(indices)}",
            f"skirt_vertices = {_packed_vector3_array(skirt_verts3d)}",
            f"skirt_indices = {_packed_int32_array(skirt_indices)}",
        ]
        sw.node("Floor", "StaticBody3D", parent=".", properties=floor_props)
    else:
        tris = []

    # ---- muros de perímetro: SOLO aspecto visual --------------------------
    # La colisión del perímetro NO vive aquí para NINGUNA arista, alineada a
    # ejes o diagonal: ver _build_perimeter_skirt() y su nota grande sobre por
    # qué una BoxShape3D suelta y girada por arista del perímetro rompe el
    # horneado de NavigationServer3D en zonas alejadas de la propia caja —
    # comprobado tanto en la arista diagonal de finalMap.xml como en aristas
    # alineadas a ejes de map1.xml/mapP1.xml. Estos nodos son puramente
    # cosméticos: StaticBody3D sin ninguna CollisionShape3D (no participan en
    # física ni en el horneado; la colisión real vive en Floor).
    sw.node("Walls", "Node3D", parent=".")
    perim_n = len(m.perimeter)
    for i in range(perim_n):
        p0 = m.perimeter[i]
        p1 = m.perimeter[(i + 1) % perim_n]
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        length_u = math.hypot(dx, dy)
        if length_u < 1e-6:
            continue
        mid_x, mid_y = (p0[0] + p1[0]) / 2.0, (p0[1] + p1[1]) / 2.0
        rot_y = lm.heading_rotation_y(dx, dy)
        gx, gh, gz = _legacy_xy_to_godot(mid_x, mid_y, lm.WALL_HEIGHT_M / 2.0)
        size = _vec3(lm.u_to_m(length_u), lm.WALL_HEIGHT_M, lm.u_to_m(lm.WALL_THICKNESS_U))
        box_mesh_id = sw.sub_resource("BoxMesh", [f"size = {size}"], hint="perim")
        node_name = f"PerimeterWall_{i}"
        parent = "Walls"
        transform = _transform3d(rot_y, (gx, gh, gz))
        sw.node(node_name, "StaticBody3D", parent=parent, properties=[
            f"transform = {transform}",
            "collision_layer = 0",
            "collision_mask = 0",
            f'metadata/legacy_edge = "{i}-{(i + 1) % perim_n}"',
            'metadata/collision_note = "puramente visual: la colisión vive en Floor (ver _legacy_floor_mesh.gd)"',
        ])
        sw.node("Mesh", "MeshInstance3D", parent=f"{parent}/{node_name}", properties=[
            f'mesh = SubResource("{box_mesh_id}")',
        ])

    # ---- muros interiores (wall) ---------------------------------------
    for wi, quad in enumerate(m.walls):
        obb = lm.oriented_box_from_quad(quad)
        rot_y = -obb["heading_rad"]  # heading_rotation_y(cosθ, sinθ) == -θ
        gx, gh, gz = _legacy_xy_to_godot(obb["cx"], obb["cy"], lm.WALL_HEIGHT_M / 2.0)
        size = _vec3(lm.u_to_m(obb["length"]), lm.WALL_HEIGHT_M, lm.u_to_m(obb["width"]))
        box_mesh_id = sw.sub_resource("BoxMesh", [f"size = {size}"], hint="wall")
        box_shape_id = sw.sub_resource("BoxShape3D", [f"size = {size}"], hint="wall")
        node_name = f"Wall_{wi}"
        transform = _transform3d(rot_y, (gx, gh, gz))
        sw.node(node_name, "StaticBody3D", parent="Walls", properties=[
            f"transform = {transform}",
            "collision_layer = 1",
            "collision_mask = 0",
        ])
        sw.node("Mesh", "MeshInstance3D", parent=f"Walls/{node_name}", properties=[
            f'mesh = SubResource("{box_mesh_id}")',
        ])
        sw.node("Collision", "CollisionShape3D", parent=f"Walls/{node_name}", properties=[
            f'shape = SubResource("{box_shape_id}")',
        ])

    # ---- puertas: marcadores con metadatos (sin geometría) -------------
    sw.node("Doors", "Node3D", parent=".")
    for di, quad in enumerate(m.doors):
        obb = lm.oriented_box_from_quad(quad)
        rot_y = -obb["heading_rad"]  # heading_rotation_y(cosθ, sinθ) == -θ
        gx, gh, gz = _legacy_xy_to_godot(obb["cx"], obb["cy"], 0.0)
        node_name = f"Door_{di}"
        transform = _transform3d(rot_y, (gx, gh, gz))
        sw.node(node_name, "Marker3D", parent="Doors", properties=[
            f"transform = {transform}",
            'metadata/type = "door"',
            f'metadata/width_m = {_fmt(lm.u_to_m(obb["length"]))}',
            f'metadata/depth_m = {_fmt(lm.u_to_m(obb["width"]))}',
            f'metadata/height_m = {_fmt(lm.DOOR_HEIGHT_M)}',
            f'metadata/use_radius_m = {_fmt(lm.u_to_m(lm.DOOR_USE_RADIUS_U))}',
            'metadata/is_open_by_default = false',
        ])

    # ---- obstáculos: marcadores con metadatos --------------------------
    sw.node("Obstacles", "Node3D", parent=".")
    for oi, obs in enumerate(m.obstacles):
        rot_y = lm.angle_rotation_y(obs.angle)
        gx, gh, gz = _legacy_xy_to_godot(obs.x, obs.y, 0.0)
        node_name = f"Obstacle_{oi}"
        transform = _transform3d(rot_y, (gx, gh, gz))
        subtype_name = lm.OBSTACLE_NAMES.get(obs.subtype, "obs_unknown")
        sw.node(node_name, "Marker3D", parent="Obstacles", properties=[
            f"transform = {transform}",
            'metadata/type = "obstacle"',
            f'metadata/subtype = {obs.subtype}',
            f'metadata/subtype_name = "{subtype_name}"',
            f'metadata/legacy_angle_deg = {_fmt(obs.angle)}',
        ])

    # ---- vestido del mundo ---------------------------------------------
    # Va después de la geometría y antes del navmesh: cuando su _ready() se
    # ejecuta, los muros y el suelo ya existen y hay algo que pintar.
    sw.node("Dressing", "Node", parent=".", properties=[
        f'script = ExtResource("{dressing_script_id}")',
    ])

    sw.node("Lighting", "Node", parent=".", properties=[
        f'script = ExtResource("{lighting_script_id}")',
    ])

    # ---- recompensas (objects): marcadores con metadatos ---------------
    sw.node("Pickups", "Node3D", parent=".")
    for pi, pu in enumerate(m.objects):
        rot_y = lm.angle_rotation_y(pu.angle)
        gx, gh, gz = _legacy_xy_to_godot(pu.x, pu.y, 0.0)
        node_name = f"Pickup_{pi}"
        transform = _transform3d(rot_y, (gx, gh, gz))
        subtype_name = lm.OBJECTS_NAMES.get(pu.subtype, "unknown_class")
        sw.node(node_name, "Marker3D", parent="Pickups", properties=[
            f"transform = {transform}",
            'metadata/type = "objects"',
            f'metadata/subtype = {pu.subtype}',
            f'metadata/subtype_name = "{subtype_name}"',
            f'metadata/legacy_angle_deg = {_fmt(pu.angle)}',
        ])

    # ---- spawns ---------------------------------------------------------
    sw.node("Spawns", "Node3D", parent=".")
    if m.player is not None:
        rot_y = lm.angle_rotation_y(m.player.angle)
        gx, gh, gz = _legacy_xy_to_godot(m.player.x, m.player.y, 0.0)
        transform = _transform3d(rot_y, (gx, gh, gz))
        sw.node("PlayerSpawn", "Marker3D", parent="Spawns", properties=[
            f"transform = {transform}",
            'metadata/type = "player"',
            f'metadata/legacy_angle_deg = {_fmt(m.player.angle)}',
        ])
        # Offsets de formación de los 3 compañeros (Player.cc:35-45, sin
        # ruido aleatorio): (-4R,-2R), (+4R,-2R), (0,-4R) en unidades legacy,
        # relativos al spawn, convertidos con nuestra escala.
        r = lm.AGENT_RADIUS_U
        offsets_u = [(-4 * r, -2 * r), (4 * r, -2 * r), (0.0, -4 * r)]
        for ci, (odx, ody) in enumerate(offsets_u):
            ox, _oh, oz = _legacy_xy_to_godot(odx, ody, 0.0)
            sw.node(f"CompanionOffset{ci}", "Marker3D", parent="Spawns/PlayerSpawn", properties=[
                f"transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, {_fmt(ox)}, {_fmt(_oh)}, {_fmt(oz)})",
                'metadata/type = "companion_offset"',
            ])
    else:
        warnings.append("sin <object type=\"player\">: el mapa no tiene spawn de jugador")

    if m.mini_boss is not None:
        gx, gh, gz = _legacy_xy_to_godot(m.mini_boss.x, m.mini_boss.y, 0.0)
        sw.node("MiniBossSpawn", "Marker3D", parent="Spawns", properties=[
            f"transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, {_fmt(gx)}, {_fmt(gh)}, {_fmt(gz)})",
            'metadata/type = "miniBoss"',
            # angle se lee y se descarta en el legacy (Map.cc:292): se documenta,
            # no se aplica como rotación.
            f'metadata/source_angle_deg_discarded_by_original = {_fmt(m.mini_boss.angle)}',
        ])
    if m.mega_boss is not None:
        gx, gh, gz = _legacy_xy_to_godot(m.mega_boss.x, m.mega_boss.y, 0.0)
        sw.node("MegaBossSpawn", "Marker3D", parent="Spawns", properties=[
            f"transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, {_fmt(gx)}, {_fmt(gh)}, {_fmt(gz)})",
            'metadata/type = "megaBoss"',
            f'metadata/source_angle_deg_discarded_by_original = {_fmt(m.mega_boss.angle)}',
        ])

    # ---- navegación -------------------------------------------------
    grid = lm.build_nav_grid(m) if len(m.perimeter) >= 3 else None
    nav_free_cells = lm.nav_grid_free_count(grid) if grid else 0
    if grid and grid.nx and grid.ny:
        nav_verts_u, nav_polys = lm.nav_grid_to_polygons(grid)
        nav_verts3d = [_legacy_xy_to_godot(x, y, 0.0) for x, y in nav_verts_u]
        nav_polys_fixed = [list(_quad_ccw_up(tuple(p), nav_verts3d)) for p in nav_polys]
    else:
        nav_verts3d = []
        nav_polys_fixed = []

    nav_props = [
        f'metadata/nav_cell_size_u = {_fmt(grid.cell) if grid else 0}',
        f'metadata/nav_free_cells = {nav_free_cells}',
        f'script = ExtResource("{navmesh_script_id}")',
        f"nav_vertices = {_packed_vector3_array(nav_verts3d)}",
        "nav_polygons = Array[PackedInt32Array]([" + ", ".join(
            _packed_int32_array(p) for p in nav_polys_fixed
        ) + "])",
    ]
    sw.node("NavigationRegion3D", "NavigationRegion3D", parent=".", properties=nav_props)

    header_lines = [
        f"; Escena generada automáticamente por tools/map_converter/convert.py",
        f"; NO EDITAR A MANO: los cambios se pierden al regenerar (build_all.py).",
        f"; Fuente legacy: {m.source_path}",
        f"; Escala: 1 unidad legacy = {lm.SCALE:.10f} m (1/75, radio de personaje 30u -> 0.4m)",
        f"; Mapeo de coordenadas: godot(x, y_altura, z) = (x*S, y_altura, y*S) — sin inversión de eje",
        f";   (cámara cenital rotation_degrees.x=-90; ver tools/map_converter/README.md).",
        f"; Perímetro legacy: {'horario' if is_cw_legacy else 'antihorario'} "
        f"(Polygon::isClockwise, Math/lib/Polygon.cc:179-192).",
    ]
    scene_text = sw.render("\n".join(header_lines))

    summary = {
        "source_xml": os.path.basename(m.source_path),
        "scene_name": scene_name,
        "area_m2": area_m2,
        "walls": len(m.walls),
        "doors": len(m.doors),
        "obstacles": len(m.obstacles),
        "pickups": len(m.objects),
        "has_player": m.player is not None,
        "has_mini_boss": m.mini_boss is not None,
        "has_mega_boss": m.mega_boss is not None,
        "unknown_types": list(m.unknown_types),
        "load_status": m.status,
        "warnings": warnings,
        "nav_free_cells": nav_free_cells,
    }
    return scene_text, summary


def convert_file(xml_path: str, tscn_path: str) -> Dict:
    m = lm.load_map(xml_path)
    scene_name = os.path.splitext(os.path.basename(tscn_path))[0]
    scene_text, summary = build_scene(m, scene_name)
    os.makedirs(os.path.dirname(os.path.abspath(tscn_path)), exist_ok=True)
    with open(tscn_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(scene_text)
    return summary


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("xml", nargs="?", help="Mapa de origen (.xml)")
    parser.add_argument("tscn", nargs="?", help="Escena de salida (.tscn)")
    args = parser.parse_args(argv)

    if not args.xml or not args.tscn:
        parser.print_help()
        return 2

    summary = convert_file(args.xml, args.tscn)
    print(f"OK  {args.xml} -> {args.tscn}  "
          f"(muros={summary['walls']} puertas={summary['doors']} "
          f"obstaculos={summary['obstacles']} pickups={summary['pickups']} "
          f"area={summary['area_m2']:.1f} m2)")
    for w in summary["warnings"]:
        print(f"    aviso: {w}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
