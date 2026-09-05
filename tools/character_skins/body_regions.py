"""Mapa de regiones del cuerpo en el espacio de la textura.

El problema que resuelve: los `Universal Base Characters` de Quaternius vienen
en ropa interior. Para vestirlos hay que pintar la ropa en el albedo, y para
pintarla hay que saber qué parte del cuerpo es cada téxel. Esa información no
está en la textura —ahí solo hay islas de UV sin nombre—, está en la malla: los
pesos de piel dicen a qué hueso pertenece cada vértice.

Así que se rasteriza la malla EN EL ESPACIO UV y se guarda, por téxel, el hueso
dominante, la posición en el modelo y la normal. Con eso, «los pantalones» deja
de ser una región dibujada a mano y pasa a ser una regla: muslo y gemelo por
encima de la caña de la bota.

Es el mismo truco que usa Team Fortress 2 —una malla, la ropa pintada— pero
derivado de la geometría en vez de a ojo.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from gltf_mesh import Gltf

# Regiones. El 0 es «ningún téxel de la malla cae aquí» a propósito: el valor
# por defecto de un dato que no ha llegado no puede ser una parte del cuerpo,
# porque entonces el fondo de la textura se vestiría igual que el pecho.
NONE = 0
HEAD = 1
TORSO = 2
PELVIS = 3
UPPERARM = 4
LOWERARM = 5
HAND = 6
THIGH = 7
CALF = 8
FOOT = 9

REGION_NAMES: dict[int, str] = {
    NONE: "none",
    HEAD: "head",
    TORSO: "torso",
    PELVIS: "pelvis",
    UPPERARM: "upperarm",
    LOWERARM: "lowerarm",
    HAND: "hand",
    THIGH: "thigh",
    CALF: "calf",
    FOOT: "foot",
}


def region_of_bone(bone: str) -> int:
    """Región del cuerpo a la que pertenece un hueso del rig UE5."""
    name = bone.lower()
    if name in ("head", "neck_01"):
        return HEAD
    if name.startswith("spine") or name.startswith("clavicle"):
        return TORSO
    if name == "pelvis":
        return PELVIS
    if name.startswith("upperarm"):
        return UPPERARM
    if name.startswith("lowerarm"):
        return LOWERARM
    if name.startswith("hand") or _is_finger(name):
        return HAND
    if name.startswith("thigh"):
        return THIGH
    if name.startswith("calf"):
        return CALF
    if name.startswith("foot") or name.startswith("ball"):
        return FOOT
    # `root` y cualquier hueso nuevo caen aquí: sin región, se quedan con la
    # piel. Preferible a colgarlos de la región más parecida y descubrirlo
    # como una manga que llega al codo de un solo personaje.
    return NONE


def _is_finger(name: str) -> bool:
    return any(name.startswith(f) for f in ("index_", "middle_", "pinky_", "ring_", "thumb_"))


@dataclass
class BodyMaps:
    """Lo que se sabe de cada téxel de la textura del cuerpo."""

    region: np.ndarray  # (n, n) uint8
    position: np.ndarray  # (n, n, 3) float32, metros en el espacio del modelo
    normal: np.ndarray  # (n, n, 3) float32
    covered: np.ndarray  # (n, n) bool: hay malla en este téxel

    @property
    def size(self) -> int:
        return int(self.region.shape[0])

    def mask(self, *regions: int) -> np.ndarray:
        out = np.zeros_like(self.covered)
        for region in regions:
            out |= self.region == region
        return out

    def front(self) -> np.ndarray:
        """Téxeles que miran hacia el frente del personaje.

        El frente es −Z: se comprueba contra la nariz, que es el punto de la
        cabeza más adelantado, en vez de darlo por supuesto. Un signo al revés
        no da error: pone el emblema en la espalda.
        """
        return self.normal[..., 2] < -0.15


def bake_body_maps(model: str, material: str, size: int = 1024) -> BodyMaps:
    """Rasteriza la malla del cuerpo en el espacio UV."""
    gltf = Gltf(model)
    mesh_index = gltf.mesh_index_by_material(material)
    if mesh_index < 0:
        raise ValueError(f"{model}: no hay malla con material {material}")
    primitive = gltf.primitive(mesh_index)
    attributes = primitive["attributes"]

    position = gltf.accessor(attributes["POSITION"]).astype(np.float64)
    normal = gltf.accessor(attributes["NORMAL"]).astype(np.float64)
    uv = gltf.accessor(attributes["TEXCOORD_0"]).astype(np.float64)
    joints = gltf.accessor(attributes["JOINTS_0"]).astype(np.int32)
    weights = gltf.accessor(attributes["WEIGHTS_0"]).astype(np.float64)
    indices = gltf.accessor(primitive["indices"]).astype(np.int64)

    bone_region = np.array(
        [region_of_bone(name) for name in gltf.bone_names()], dtype=np.uint8
    )

    # Región por vértice: la del hueso con más peso, saltándose los huesos sin
    # región. No se mezclan regiones porque una región es una etiqueta, no una
    # cantidad; interpolarla daría «medio muslo, medio gemelo», que no es nada.
    #
    # Lo de saltarse los huesos sin región no es un detalle: el ombligo pesa
    # sobre `root`, así que quedaba sin región y aparecía un agujero de piel en
    # mitad de la chaqueta. Un vértice que pesa sobre `root` sigue siendo
    # torso; simplemente hay que mirar el segundo hueso.
    candidates = bone_region[joints]  # (n, 4)
    order = np.argsort(-weights, axis=1)
    vertex_region = np.zeros(len(joints), dtype=np.uint8)
    pending = np.ones(len(joints), dtype=bool)
    for rank in range(candidates.shape[1]):
        column = order[:, rank]
        region = candidates[np.arange(len(joints)), column]
        weight = weights[np.arange(len(joints)), column]
        take = pending & (region != NONE) & (weight > 0.0)
        vertex_region[take] = region[take]
        pending &= ~take

    n = size
    region_map = np.zeros((n, n), dtype=np.uint8)
    position_map = np.zeros((n, n, 3), dtype=np.float32)
    normal_map = np.zeros((n, n, 3), dtype=np.float32)
    covered = np.zeros((n, n), dtype=bool)

    # No hace falta invertir la V: en glTF el origen de la textura es la
    # esquina superior izquierda y la V crece hacia abajo, igual que la fila de
    # la imagen. Invertirla «por si acaso» pinta las botas en la cabeza.
    px = uv[:, 0] * (n - 1)
    py = uv[:, 1] * (n - 1)

    tris = indices.reshape(-1, 3)
    for tri in tris:
        _fill_triangle(
            tri,
            px,
            py,
            position,
            normal,
            vertex_region,
            region_map,
            position_map,
            normal_map,
            covered,
            n,
        )

    maps = BodyMaps(region_map, position_map, normal_map, covered)
    _dilate(maps, iterations=3)
    _straighten_neck(maps)
    return maps


def _straighten_neck(maps: BodyMaps) -> None:
    """Corta el cuello por una ALTURA, no por el hueso dominante.

    Cabeza y torso se solapan cinco centímetros —el trapecio pesa sobre
    `spine_03`, la garganta sobre `neck_01`— y en el espacio de la textura ese
    solape se entrelaza téxel a téxel. El resultado no es un borde: es una
    sierra de piel y tela, y se ve a simple vista en cuanto el personaje sale
    en pantalla.

    Se reasigna solo la COLUMNA del cuello. Sin ese recorte en X y Z, el
    hombro entero pasaría a ser cabeza y el personaje saldría con los hombros
    desnudos.
    """
    y = maps.position[..., 1]
    x = np.abs(maps.position[..., 0])
    z = np.abs(maps.position[..., 2])
    head = maps.mask(HEAD)
    if not head.any():
        return
    low = float(y[head].min())
    high = float(y[head].max())
    cut = low + 0.12 * (high - low)
    column = (x < 0.090) & (z < 0.090) & maps.mask(HEAD, TORSO)
    maps.region[column & (y >= cut)] = HEAD
    maps.region[column & (y < cut)] = TORSO


def _fill_triangle(
    tri: np.ndarray,
    px: np.ndarray,
    py: np.ndarray,
    position: np.ndarray,
    normal: np.ndarray,
    vertex_region: np.ndarray,
    region_map: np.ndarray,
    position_map: np.ndarray,
    normal_map: np.ndarray,
    covered: np.ndarray,
    n: int,
) -> None:
    x = px[tri]
    y = py[tri]
    # Un píxel de margen: sin él quedan costuras de piel de un téxel de ancho
    # justo en el borde de cada isla, y en el juego se ven como hilos claros.
    x0 = max(int(np.floor(x.min())) - 1, 0)
    x1 = min(int(np.ceil(x.max())) + 1, n - 1)
    y0 = max(int(np.floor(y.min())) - 1, 0)
    y1 = min(int(np.ceil(y.max())) + 1, n - 1)
    if x1 < x0 or y1 < y0:
        return

    area = (x[1] - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (y[1] - y[0])
    if abs(area) < 1e-12:
        return

    gx, gy = np.meshgrid(
        np.arange(x0, x1 + 1, dtype=np.float64),
        np.arange(y0, y1 + 1, dtype=np.float64),
    )
    w0 = ((x[1] - gx) * (y[2] - gy) - (x[2] - gx) * (y[1] - gy)) / area
    w1 = ((x[2] - gx) * (y[0] - gy) - (x[0] - gx) * (y[2] - gy)) / area
    w2 = 1.0 - w0 - w1
    inside = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
    if not inside.any():
        return

    rows = np.arange(y0, y1 + 1)
    cols = np.arange(x0, x1 + 1)
    rr, cc = np.meshgrid(rows, cols, indexing="ij")
    rr = rr[inside]
    cc = cc[inside]
    bary = np.stack([w0[inside], w1[inside], w2[inside]], axis=-1)

    position_map[rr, cc] = (bary @ position[tri]).astype(np.float32)
    normal_map[rr, cc] = (bary @ normal[tri]).astype(np.float32)
    # La región es del vértice más cercano: la etiqueta no se promedia.
    region_map[rr, cc] = vertex_region[tri][np.argmax(bary, axis=1)]
    covered[rr, cc] = True


def _dilate(maps: BodyMaps, iterations: int) -> None:
    """Extiende las islas unos téxeles hacia fuera.

    El filtrado bilineal muestrea fuera del borde de la isla. Sin este relleno,
    el color que entra es el del fondo de la textura y aparece un perfilado
    oscuro alrededor de cada pieza de ropa.
    """
    neighbours = ((0, 1), (0, -1), (1, 0), (-1, 0))
    for _ in range(iterations):
        empty = ~maps.covered
        if not empty.any():
            return
        filled = np.zeros_like(maps.covered)
        for dy, dx in neighbours:
            # `roll` desplaza, así que source[r, c] == covered[r - dy, c - dx].
            source = np.roll(np.roll(maps.covered, dy, axis=0), dx, axis=1)
            take = empty & source & ~filled
            if not take.any():
                continue
            rr, cc = np.nonzero(take)
            sr = (rr - dy) % maps.region.shape[0]
            sc = (cc - dx) % maps.region.shape[1]
            maps.region[rr, cc] = maps.region[sr, sc]
            maps.position[rr, cc] = maps.position[sr, sc]
            maps.normal[rr, cc] = maps.normal[sr, sc]
            filled[rr, cc] = True
        if not filled.any():
            return
        maps.covered |= filled
