#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
legacy_map.py — Librería compartida del conversor de mapas legacy → Godot 4.

Ámbito: tools/map_converter/**  (ver docs/analisis/legacy-datos-assets.md y docs/01-gdd.md §5)

Este módulo reproduce, deliberadamente y con referencias línea a línea, la
semántica real de `Map::loadData()` y `Map::getType()`
(`legacy/trunk/core/lib/Map.cc`), NO una interpretación libre del XML. Cada
irregularidad del parser original (atributos que se heredan del vértice
anterior si faltan, tipos desconocidos que se ignoran en silencio, un
`wall`/`door` mal formado que aborta la carga completa) se replica a
propósito para que el conversor cargue exactamente lo que cargaría el motor
de 2012, ni más ni menos.

No usa dependencias fuera de la librería estándar de Python 3.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

Point = Tuple[float, float]

# ---------------------------------------------------------------------------
# 1. Escala y constantes (docs/01-gdd.md §5, confirmado por la tarea)
# ---------------------------------------------------------------------------
# El legacy usa unidades de juego (u) donde el radio de personaje es
# Core::Radius = 30 (CoreNamespace.h:10). El remake trabaja en metros con
# radio de personaje 0.4 m, luego:
SCALE = 0.4 / 30.0  # == 1/75 m por unidad legacy
assert abs(SCALE - 1.0 / 75.0) < 1e-12

WALL_HEIGHT_M = 3.0   # altura a la que se extruden perimeter/wall
DOOR_HEIGHT_M = 2.1   # altura de referencia de las puertas (solo metadato: son marcadores)
WALL_THICKNESS_U = 25.0   # grosor de muro estándar del editor legacy, en unidades legacy
AGENT_RADIUS_U = 30.0     # Core::Radius, en unidades legacy
DOOR_USE_RADIUS_U = 90.0  # 3 * Core::Radius (core/lib/HIDControl.cc:244-256)


def u_to_m(v: float) -> float:
    """Convierte una distancia en unidades legacy a metros."""
    return v * SCALE


# ---------------------------------------------------------------------------
# 2. Tabla de tipos — Map::getType (Map.cc:524-548) y Core::Map::Object
#    (CoreNamespace.h:386-398). Los únicos 8 valores reconocidos.
# ---------------------------------------------------------------------------
TYPE_MAP: Dict[str, int] = {
    "perimeter": 0,
    "wall": 1,
    "door": 2,
    "player": 3,
    "obstacle": 4,
    "objects": 5,
    "miniBoss": 6,
    "megaBoss": 7,
}
POLY_TYPE_IDS = (0, 1, 2)
POINT_TYPE_IDS = (3, 4, 5, 6, 7)

# Core::Obstacles::Type (CoreNamespace.h:57-70)
OBSTACLE_NAMES: Dict[int, str] = {
    0: "obs_table",
    1: "obs_desk",
    2: "obs_couch",
    3: "obs_sofa",
    4: "obs_chair",
    5: "obs_shelf",
    6: "obs_plantPot",
    7: "obs_mesaConSillas",
}

# Huella de colisión 2D de cada subtipo de obstáculo, en unidades legacy,
# relativa al centro (x0, x1, y0, y1). Fuente: core/lib/Model2D.cc, tabla
# reproducida en docs/analisis/legacy-datos-assets.md §2 (`obstacle`).
OBSTACLE_FOOTPRINT_U: Dict[int, Tuple[float, float, float, float]] = {
    0: (-20, 22, -45, 45),    # obs_table
    1: (-65, 65, -55, 55),    # obs_desk
    2: (-22, 22, -20, 20),    # obs_couch
    3: (-22, 22, -60, 60),    # obs_sofa
    4: (-20, 20, -20, 20),    # obs_chair
    5: (-55, 45, -25, 18),    # obs_shelf
    6: (-10, 10, -10, 10),    # obs_plantPot
    7: (-50, 50, -50, 50),    # obs_mesaConSillas
}
# Model2D.cc:153-158: subtype fuera de rango 0-7 no se dibuja pero sí colisiona.
OBSTACLE_FOOTPRINT_DEFAULT: Tuple[float, float, float, float] = (-32, 32, -70, 70)

# Core::Objects::Class (CoreNamespace.h:79-88)
OBJECTS_NAMES: Dict[int, str] = {
    0: "health_pack_1",
    1: "health_pack_2",
    2: "health_pack_3",
    3: "ammo_pack_1",
    4: "ammo_pack_2",
    5: "ammo_pack_3",
    6: "sniper",
}
# Huella de recompensas: 64x64 u para todas las clases (Model2D.cc:164-220)
PICKUP_FOOTPRINT_U = 64.0


# ---------------------------------------------------------------------------
# 3. Analizador XML tolerante (equivalente a TinyXML para esta gramática)
# ---------------------------------------------------------------------------
# `map_01..04.xml` no son XML bien formado (declaración sin '?>', atributos
# sin comillas: `id=0`) y `xml.etree`/`xml.dom` los rechazan. TinyXML sí los
# acepta. En vez de tirar de una dependencia externa (lxml) se implementa
# aquí un tokenizador mínimo suficiente para la gramática real de
# Map::loadData: un nivel de anidamiento exacto, sin espacios de nombres, sin
# CDATA ni comentarios dentro de los objetos.

@dataclass
class Node:
    tag: str
    attrs: Dict[str, str]
    children: List["Node"] = field(default_factory=list)


_TAG_RE = re.compile(r"<[^<>]+>", re.S)
_ATTR_RE = re.compile(
    r"""([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'/>]+))"""
)


def _parse_attrs(tag_body: str) -> Dict[str, str]:
    attrs: Dict[str, str] = {}
    for m in _ATTR_RE.finditer(tag_body):
        value = m.group(2)
        if value is None:
            value = m.group(3)
        if value is None:
            value = m.group(4)
        attrs[m.group(1)] = value if value is not None else ""
    return attrs


def parse_xml_tolerant(text: str) -> Node:
    """Devuelve un pseudo-DOM (#document -> raíz -> ...) tolerante al estilo
    TinyXML. No es un parser XML general (no resuelve entidades, no procesa
    CDATA); basta y sobra para los 27 mapas de este proyecto.
    """
    doc = Node("#document", {}, [])
    stack: List[Node] = [doc]
    for m in _TAG_RE.finditer(text):
        raw = m.group(0)
        inner = raw[1:-1].strip()
        if not inner:
            continue
        if inner.startswith("?") or inner.startswith("!"):
            continue  # declaración XML / doctype / comentario
        if inner.startswith("/"):
            if len(stack) > 1:
                stack.pop()
            continue
        self_closing = inner.endswith("/")
        if self_closing:
            inner = inner[:-1].rstrip()
        name_m = re.match(r"([A-Za-z_:][-A-Za-z0-9_:.]*)", inner)
        if not name_m:
            continue
        name = name_m.group(1)
        attrs = _parse_attrs(inner[name_m.end():])
        node = Node(name, attrs, [])
        stack[-1].children.append(node)
        if not self_closing:
            stack.append(node)
    return doc


# ---------------------------------------------------------------------------
# 4. Lectura tolerante de atributos numéricos (semántica QueryIntAttribute /
#    QueryDoubleAttribute de TinyXML: si el atributo falta o no es numérico,
#    la variable NO se toca y conserva su valor anterior).
# ---------------------------------------------------------------------------

def _q_int(attrs: Dict[str, str], name: str, current: int) -> int:
    raw = attrs.get(name)
    if raw is None:
        return current
    try:
        return int(raw, 10)
    except ValueError:
        try:
            return int(float(raw))
        except ValueError:
            return current


def _q_float(attrs: Dict[str, str], name: str, current: float) -> float:
    raw = attrs.get(name)
    if raw is None:
        return current
    try:
        return float(raw)
    except ValueError:
        return current


# ---------------------------------------------------------------------------
# 5. Modelo de datos del mapa cargado
# ---------------------------------------------------------------------------

@dataclass
class PointObj:
    x: int
    y: int
    angle: float
    subtype: int = 0


@dataclass
class LegacyMap:
    source_path: str
    perimeter: List[Point] = field(default_factory=list)
    walls: List[List[Point]] = field(default_factory=list)
    doors: List[List[Point]] = field(default_factory=list)
    player: Optional[PointObj] = None
    obstacles: List[PointObj] = field(default_factory=list)
    objects: List[PointObj] = field(default_factory=list)
    mini_boss: Optional[PointObj] = None
    mega_boss: Optional[PointObj] = None
    unknown_types: List[str] = field(default_factory=list)
    status: int = 0
    load_warnings: List[str] = field(default_factory=list)


class MapLoadError(Exception):
    pass


def _iter_vertex_nodes(obj_node: Node) -> List[Node]:
    """objeto->FirstChildElement()->FirstChildElement() (Map.cc:147,180,240):
    exactamente un nivel de anidamiento; el nombre de <vertexlist>/<vertex> es
    irrelevante."""
    if not obj_node.children:
        return []
    return obj_node.children[0].children


def _read_polygon(obj_node: Node) -> List[Point]:
    # x, y viven FUERA del bucle de vértices en Map.cc (declaradas una vez
    # por objeto): si a un <vertex> le falta x o y, hereda el valor del
    # vértice anterior dentro del mismo polígono.
    x, y = 0, 0
    pts: List[Point] = []
    for v in _iter_vertex_nodes(obj_node):
        x = _q_int(v.attrs, "x", x)
        y = _q_int(v.attrs, "y", y)
        pts.append((float(x), float(y)))
    return pts


def load_map(path: str, encoding: str = "latin-1") -> LegacyMap:
    """Carga un XML de mapa reproduciendo Map::loadData(). Lanza
    MapLoadError solo si no hay ningún elemento raíz (documento vacío);
    cualquier otra irregularidad se registra en `load_warnings` y en
    `status`, igual que hace el motor original (que nunca comprueba el
    valor de retorno, GameAction.cc:178)."""
    with open(path, "r", encoding=encoding, errors="replace") as f:
        text = f.read()

    doc = parse_xml_tolerant(text)
    if not doc.children:
        raise MapLoadError(f"{path}: no se encontró ningún elemento raíz")

    root = doc.children[0]
    m = LegacyMap(source_path=path)
    status = 0

    for obj in root.children:
        if status < 0:
            # Map.cc: `while (objeto != NULL && status >= 0)` — un wall/door
            # mal formado o un objeto sin 'type' detiene el resto de la carga.
            break

        type_s = obj.attrs.get("type")
        if type_s is None:
            status = -2
            m.load_warnings.append(
                "objeto sin atributo 'type': carga abortada (status -2, Map.cc:321)"
            )
            break

        type_i = TYPE_MAP.get(type_s, -1)

        if type_i == 0:  # perimeter
            m.perimeter = _read_polygon(obj)
            status = 1
        elif type_i in (1, 2):  # wall, door
            pts = _read_polygon(obj)
            label = "wall" if type_i == 1 else "door"
            if len(pts) != 4:
                status = -1
                m.load_warnings.append(
                    f"{label} con {len(pts)} vértices (se esperaban 4): "
                    "carga abortada (status -1, Map.cc:194-195/254-255)"
                )
                break
            (m.walls if type_i == 1 else m.doors).append(pts)
        elif type_i == 3:  # player
            m.player = PointObj(
                x=_q_int(obj.attrs, "x", 0),
                y=_q_int(obj.attrs, "y", 0),
                angle=_q_float(obj.attrs, "angle", 0.0),
            )
        elif type_i == 4:  # obstacle
            m.obstacles.append(PointObj(
                x=_q_int(obj.attrs, "x", 0),
                y=_q_int(obj.attrs, "y", 0),
                angle=_q_float(obj.attrs, "angle", 0.0),
                subtype=_q_int(obj.attrs, "subtype", 0),
            ))
        elif type_i == 5:  # objects
            m.objects.append(PointObj(
                x=_q_int(obj.attrs, "x", 0),
                y=_q_int(obj.attrs, "y", 0),
                angle=_q_float(obj.attrs, "angle", 0.0),
                subtype=_q_int(obj.attrs, "subtype", 0),
            ))
        elif type_i == 6:  # miniBoss — angle se lee y se descarta (Map.cc:292)
            m.mini_boss = PointObj(
                x=_q_int(obj.attrs, "x", 0),
                y=_q_int(obj.attrs, "y", 0),
                angle=_q_float(obj.attrs, "angle", 0.0),
            )
        elif type_i == 7:  # megaBoss — ídem
            m.mega_boss = PointObj(
                x=_q_int(obj.attrs, "x", 0),
                y=_q_int(obj.attrs, "y", 0),
                angle=_q_float(obj.attrs, "angle", 0.0),
            )
        else:
            # default: (Map.cc:313-316) ignorado en silencio (enemy, companion, ...)
            m.unknown_types.append(type_s)

    m.status = status
    return m


# ---------------------------------------------------------------------------
# 6. Geometría 2D (todo en unidades legacy salvo que se indique lo contrario)
# ---------------------------------------------------------------------------

def shoelace_signed_area(points: List[Point]) -> float:
    n = len(points)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return s * 0.5


def legacy_is_clockwise(points: List[Point]) -> bool:
    """Reproduce Polygon::isClockwise (Math/lib/Polygon.cc:179-192):
    suma (x2-x1)(y2+y1); horario si suma < 0. Equivalente a área shoelace >
    0 en el sistema Y-abajo de pantalla del legacy."""
    n = len(points)
    if n < 3:
        return False
    s = 0.0
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        s += (x2 - x1) * (y2 + y1)
    return s < 0


def polygon_area_abs(points: List[Point]) -> float:
    return abs(shoelace_signed_area(points))


def bbox(points: List[Point]) -> Tuple[float, float, float, float]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), max(xs), min(ys), max(ys)


def point_in_polygon(px: float, py: float, poly: List[Point]) -> bool:
    """Ray casting estándar (par-impar)."""
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > py) != (y2 > py):
            x_int = x1 + (py - y1) * (x2 - x1) / (y2 - y1)
            if px < x_int:
                inside = not inside
    return inside


def has_duplicate_consecutive_vertices(points: List[Point], eps: float = 1e-6) -> bool:
    n = len(points)
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        if abs(x1 - x2) < eps and abs(y1 - y2) < eps:
            return True
    return False


def rotate_legacy_deg(x: float, y: float, angle_deg: float) -> Point:
    """Rotación matemática legacy: x' = x cosθ - y sinθ; y' = x sinθ + y cosθ
    (Graphics/lib/Transformacion.cc:101-112, Math/lib/Vector2D.cc:134-141)."""
    th = math.radians(angle_deg)
    c, s = math.cos(th), math.sin(th)
    return x * c - y * s, x * s + y * c


def obstacle_footprint_world(x: float, y: float, angle_deg: float, subtype: int) -> List[Point]:
    x0, x1, y0, y1 = OBSTACLE_FOOTPRINT_U.get(subtype, OBSTACLE_FOOTPRINT_DEFAULT)
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    world = []
    for cx, cy in corners:
        rx, ry = rotate_legacy_deg(cx, cy, angle_deg)
        world.append((x + rx, y + ry))
    return world


def pickup_footprint_world(x: float, y: float) -> List[Point]:
    h = PICKUP_FOOTPRINT_U / 2.0
    return [(x - h, y - h), (x + h, y - h), (x + h, y + h), (x - h, y + h)]


def oriented_box_from_quad(pts: List[Point]) -> Dict[str, float]:
    """Deriva una caja orientada (centro, ángulo, longitud, anchura) de un
    cuadrilátero de 4 vértices en el orden documental del editor legacy
    (a=(x-,y-), b=(x-,y+), c=(x+,y+), d=(x+,y-); Wall::Move, Wall.cc:93-114).
    Válido para rectángulos alineados a ejes (la inmensa mayoría, 385/400) y
    da una aproximación razonable para el resto (grosores atípicos,
    cuadriláteros no perfectamente rectangulares como en map_03.xml)."""
    if len(pts) != 4:
        raise ValueError("oriented_box_from_quad requiere exactamente 4 vértices")
    cx = sum(p[0] for p in pts) / 4.0
    cy = sum(p[1] for p in pts) / 4.0
    p0, p1, p3 = pts[0], pts[1], pts[3]
    dx1, dy1 = p1[0] - p0[0], p1[1] - p0[1]
    dx2, dy2 = p3[0] - p0[0], p3[1] - p0[1]
    len1 = math.hypot(dx1, dy1)
    len2 = math.hypot(dx2, dy2)
    # El lado más largo define el eje "longitudinal" de la caja.
    if len1 >= len2:
        length, width = len1, len2
        heading = math.atan2(dy1, dx1)
    else:
        length, width = len2, len1
        heading = math.atan2(dy2, dx2)
    return {"cx": cx, "cy": cy, "length": length, "width": width, "heading_rad": heading}


def heading_rotation_y(dx: float, dy: float) -> float:
    """Vector dirección legacy (dx, dy) -> rotation.y de Godot, sin invertir
    ejes (godot(x,y) = Vector3(x, h, y)). Ver docs/analisis §6.2."""
    return -math.atan2(dy, dx)


def angle_rotation_y(angle_deg: float) -> float:
    """Ángulo legacy en grados -> rotation.y de Godot. Coherente con
    heading_rotation_y: heading_rotation_y(cosθ, sinθ) == angle_rotation_y(θ)."""
    return -math.radians(angle_deg)


# ---------------------------------------------------------------------------
# 7. Triangulación por ear-clipping (perímetro, posiblemente no convexo)
# ---------------------------------------------------------------------------

def triangulate_ear_clip(points: List[Point]) -> List[Tuple[int, int, int]]:
    n = len(points)
    if n < 3:
        return []

    area2 = shoelace_signed_area(points)
    order = list(range(n))
    if area2 < 0:
        order.reverse()

    def is_convex(a: int, b: int, c: int) -> bool:
        ax, ay = points[a]
        bx, by = points[b]
        cx, cy = points[c]
        cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
        return cross > 1e-9

    def sign(p1: Point, p2: Point, p3: Point) -> float:
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])

    def point_in_tri(p: Point, a: Point, b: Point, c: Point) -> bool:
        d1, d2, d3 = sign(p, a, b), sign(p, b, c), sign(p, c, a)
        has_neg = d1 < 0 or d2 < 0 or d3 < 0
        has_pos = d1 > 0 or d2 > 0 or d3 > 0
        return not (has_neg and has_pos)

    triangles: List[Tuple[int, int, int]] = []
    remaining = order[:]
    guard = 0
    guard_max = max(1000, n * n * 4)
    while len(remaining) > 3 and guard < guard_max:
        guard += 1
        ear_found = False
        m = len(remaining)
        for i in range(m):
            i_prev = remaining[(i - 1) % m]
            i_curr = remaining[i]
            i_next = remaining[(i + 1) % m]
            if not is_convex(i_prev, i_curr, i_next):
                continue
            a, b, c = points[i_prev], points[i_curr], points[i_next]
            blocked = False
            for j in remaining:
                if j in (i_prev, i_curr, i_next):
                    continue
                if point_in_tri(points[j], a, b, c):
                    blocked = True
                    break
            if blocked:
                continue
            triangles.append((i_prev, i_curr, i_next))
            remaining.pop(i)
            ear_found = True
            break
        if not ear_found:
            break

    if len(remaining) >= 3:
        for i in range(1, len(remaining) - 1):
            triangles.append((remaining[0], remaining[i], remaining[i + 1]))

    return triangles


# ---------------------------------------------------------------------------
# 8. Rejilla de navegación (aproxima el Delaunay + expansión por charRadius
#    del legacy con un flood-fill sobre una rejilla regular; ver
#    tools/map_converter/README.md para la justificación de la decisión).
# ---------------------------------------------------------------------------

@dataclass
class NavGrid:
    min_x: float
    min_y: float
    cell: float
    nx: int
    ny: int
    free: List[List[bool]]  # free[j][i], j = fila (y), i = columna (x)


def build_nav_grid(
    m: LegacyMap,
    target_cells: int = 1600,
    min_cell: float = 15.0,
    max_cell: float = 50.0,
) -> NavGrid:
    if len(m.perimeter) < 3:
        return NavGrid(0.0, 0.0, min_cell, 0, 0, [])

    min_x, max_x, min_y, max_y = bbox(m.perimeter)
    w = max(max_x - min_x, 1.0)
    h = max(max_y - min_y, 1.0)
    cell = math.sqrt((w * h) / max(target_cells, 1))
    cell = max(min_cell, min(max_cell, cell))
    nx = max(1, int(math.ceil(w / cell)))
    ny = max(1, int(math.ceil(h / cell)))

    # Bloqueadores: muros (siempre) y obstáculos (mobiliario físico). Las
    # puertas NO bloquean: en esta conversión son marcadores sin colisión
    # (ver README, decisión "puertas como marcadores"), así que representan
    # el hueco ya abierto en el trazado de muros, igual que en los datos
    # originales ("las puertas no se restan de los muros: ocupan huecos ya
    # dejados", docs/analisis/legacy-datos-assets.md §2 `door`).
    blockers: List[List[Point]] = list(m.walls)
    for obs in m.obstacles:
        blockers.append(obstacle_footprint_world(obs.x, obs.y, obs.angle, obs.subtype))

    free = [[False] * nx for _ in range(ny)]
    for j in range(ny):
        cy = min_y + (j + 0.5) * cell
        for i in range(nx):
            cx = min_x + (i + 0.5) * cell
            if not point_in_polygon(cx, cy, m.perimeter):
                continue
            blocked = False
            for poly in blockers:
                if point_in_polygon(cx, cy, poly):
                    blocked = True
                    break
            free[j][i] = not blocked

    return NavGrid(min_x=min_x, min_y=min_y, cell=cell, nx=nx, ny=ny, free=free)


def nav_grid_cell_of(grid: NavGrid, x: float, y: float) -> Optional[Tuple[int, int]]:
    if grid.nx == 0 or grid.ny == 0:
        return None
    i = int((x - grid.min_x) // grid.cell)
    j = int((y - grid.min_y) // grid.cell)
    if 0 <= i < grid.nx and 0 <= j < grid.ny:
        return i, j
    return None


def nav_grid_reachable(grid: NavGrid, start: Tuple[int, int]) -> Tuple[List[List[bool]], int]:
    nx, ny = grid.nx, grid.ny
    visited = [[False] * nx for _ in range(ny)]
    if nx == 0 or ny == 0:
        return visited, 0
    si, sj = start
    if not (0 <= si < nx and 0 <= sj < ny) or not grid.free[sj][si]:
        return visited, 0
    stack = [(si, sj)]
    visited[sj][si] = True
    count = 1
    while stack:
        i, j = stack.pop()
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ni, nj = i + di, j + dj
            if 0 <= ni < nx and 0 <= nj < ny and grid.free[nj][ni] and not visited[nj][ni]:
                visited[nj][ni] = True
                count += 1
                stack.append((ni, nj))
    return visited, count


def nav_grid_free_count(grid: NavGrid) -> int:
    return sum(1 for row in grid.free for v in row if v)


def nav_grid_to_polygons(grid: NavGrid) -> Tuple[List[Point], List[List[int]]]:
    """Fusiona celdas libres contiguas de cada fila en un único rectángulo
    para mantener el recuento de polígonos manejable (en vez de un quad por
    celda). Devuelve vértices únicos (en unidades legacy) y la lista de
    polígonos (índices en sentido antihorario visto desde +Y)."""
    vert_index: Dict[Tuple[float, float], int] = {}
    vertices: List[Point] = []

    def vid(x: float, y: float) -> int:
        key = (round(x, 4), round(y, 4))
        idx = vert_index.get(key)
        if idx is None:
            idx = len(vertices)
            vert_index[key] = idx
            vertices.append((x, y))
        return idx

    polygons: List[List[int]] = []
    for j in range(grid.ny):
        i = 0
        while i < grid.nx:
            if not grid.free[j][i]:
                i += 1
                continue
            i0 = i
            while i < grid.nx and grid.free[j][i]:
                i += 1
            i1 = i
            x0 = grid.min_x + i0 * grid.cell
            x1 = grid.min_x + i1 * grid.cell
            y0 = grid.min_y + j * grid.cell
            y1 = grid.min_y + (j + 1) * grid.cell
            a = vid(x0, y0)
            b = vid(x1, y0)
            c = vid(x1, y1)
            d = vid(x0, y1)
            polygons.append([a, b, c, d])
    return vertices, polygons
