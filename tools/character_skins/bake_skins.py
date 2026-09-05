#!/usr/bin/env python3
"""Viste a los `Universal Base Characters` con los nueve uniformes del juego.

Los modelos de Quaternius son CC0 y de una calidad que ningún otro paquete
libre alcanza, pero vienen **en ropa interior**: el paquete gratuito son dos
cuerpos base y ocho peinados, y la ropa solo existe en versión de fantasía.

La solución es la de Team Fortress 2: una sola malla y la ropa **pintada** en
el albedo. La diferencia es que aquí no se pinta a mano sino que se deriva de
la geometría — `body_regions` dice qué parte del cuerpo es cada téxel, y
`uniforms` dice de qué color va cada parte. Nueve uniformes son nueve tablas de
colores, no nueve sesiones de Photoshop.

Se generan tres mapas por arquetipo:

* **albedo** (1024): el uniforme.
* **normal** (512): el del cuerpo, pero APLANADO donde hay tela. Sin esto el
  mapa de normales del torso desnudo pinta abdominales sobre la chaqueta.
* **rugosidad** (512): la tela es mate y la piel no.

Uso:
    python3 tools/character_skins/bake_skins.py [--size 1024] [--out DIR]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).parent))

from body_regions import (  # noqa: E402
    CALF,
    FOOT,
    HAND,
    HEAD,
    LOWERARM,
    PELVIS,
    THIGH,
    TORSO,
    UPPERARM,
    BodyMaps,
    bake_body_maps,
)
from uniforms import UNIFORMS, Uniform  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "game/assets/models/characters_ubc"

BASES: dict[str, dict[str, str]] = {
    "male": {
        "model": "Superhero_Male_FullBody.gltf",
        "material": "MI_Superhero_Male",
        "albedo": "T_Superhero_Male_Dark.png",
        "normal": "T_Superhero_Male_Normal.png",
        "roughness": "T_Superhero_Male_Roughness.png",
    },
    "female": {
        "model": "Superhero_Female_FullBody.gltf",
        "material": "MI_Superhero_Female",
        "albedo": "T_Superhero_Female_Dark_BaseColor.png",
        "normal": "T_Superhero_Female_Normal.png",
        "roughness": "T_Superhero_Female_Roughness.png",
    },
}

NORMAL_SIZE = 512
ROUGHNESS_SIZE = 512

MATERIALS = ROOT / "game/assets/materials/characters"

BODY_MATERIAL = """[gd_resource type="StandardMaterial3D" load_steps=4 format=3]

; Uniforme de {label} ({archetype}).
;
; Lo generan las tres texturas de `tools/character_skins/bake_skins.py` a
; partir del cuerpo CC0 de Quaternius y de la tabla de colores de
; `uniforms.py`. NO se edita a mano: se cambia el color en la tabla y se
; vuelve a hornear, o el siguiente horneado se lo lleva por delante.
;
; La rugosidad se lee por canal de gris porque el mapa horneado es de un solo
; canal; leerlo como rojo daría una tela con el brillo de la piel.

[ext_resource type="Texture2D" path="res://assets/models/characters_ubc/skins/{archetype}_albedo.png" id="Albedo"]
[ext_resource type="Texture2D" path="res://assets/models/characters_ubc/skins/{archetype}_normal.png" id="Normal"]
[ext_resource type="Texture2D" path="res://assets/models/characters_ubc/skins/{archetype}_roughness.png" id="Roughness"]

[resource]
resource_name = "{archetype}"
albedo_texture = ExtResource("Albedo")
normal_enabled = true
normal_texture = ExtResource("Normal")
normal_scale = 0.8
roughness_texture = ExtResource("Roughness")
roughness_texture_channel = 0
metallic = 0.0
metallic_specular = 0.25
"""

HAIR_MATERIAL = """[gd_resource type="StandardMaterial3D" format=3]

; Cejas de {label} ({archetype}).
;
; Color plano y no la textura del atlas de pelo del paquete: las cejas miden
; dos centímetros y a esa escala el atlas no aporta nada. El importador de
; glTF, además, no resuelve las imágenes externas del `.gltf` y las deja sin
; textura —de ahí que TODOS los materiales de estos modelos se asignen desde
; `UbcModel` y no se hereden del fichero.

[resource]
resource_name = "{archetype}_hair"
albedo_color = Color({r}, {g}, {b}, 1)
roughness = 0.85
metallic = 0.0
metallic_specular = 0.15
"""


class Landmarks:
    """Medidas del cuerpo, sacadas de la propia malla.

    Fijar estas alturas en metros funcionaría para el cuerpo masculino y
    pondría el cinturón en el pecho del femenino, que mide 4 cm menos. Se
    derivan de la extensión real de cada región para que un cuerpo nuevo no
    necesite tocar nada.
    """

    def __init__(self, maps: BodyMaps) -> None:
        y = maps.position[..., 1]
        x = np.abs(maps.position[..., 0])

        def span(region: int) -> tuple[float, float]:
            mask = maps.mask(region)
            if not mask.any():
                return (0.0, 0.0)
            return (float(y[mask].min()), float(y[mask].max()))

        self.head_low, self.head_high = span(HEAD)
        self.torso_low, self.torso_high = span(TORSO)
        self.pelvis_low, self.pelvis_high = span(PELVIS)
        self.calf_low, self.calf_high = span(CALF)

        head = max(self.head_high - self.head_low, 1e-3)
        self.hair_side = self.head_low + 0.55 * head
        self.hair_front = self.head_low + 0.72 * head
        self.beard_low = self.head_low + 0.16 * head
        self.beard_high = self.head_low + 0.46 * head

        self.collar = self.torso_high - 0.07 * (self.torso_high - self.torso_low)
        self.belt_centre = 0.5 * (self.torso_low + self.pelvis_high)
        self.belt_half = 0.030

        # La correa del pecho va POR DEBAJO del pectoral. Más arriba y más
        # ancha —como estaba— no lee como correaje sino como un top.
        chest = self.torso_low + 0.50 * (self.torso_high - self.torso_low)
        self.chest_low = chest - 0.028
        self.chest_high = chest + 0.028
        self.knee = self.calf_high

        arm = maps.mask(UPPERARM)
        forearm = maps.mask(LOWERARM)
        hand = maps.mask(HAND)
        self.shoulder_x = float(x[arm].min()) if arm.any() else 0.0
        self.elbow_x = float(x[arm].max()) if arm.any() else 0.0
        self.wrist_x = float(x[forearm].max()) if forearm.any() else 0.0
        self.knuckle_x = float(x[hand].max()) if hand.any() else 0.0

    def boot_top(self, fraction: float) -> float:
        return self.calf_low + fraction * (self.calf_high - self.calf_low)


def paint(uniform: Uniform, maps: BodyMaps, base_albedo: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Devuelve `(albedo, mascara_de_tela)` para un uniforme.

    La máscara de tela sale junto al albedo porque los otros dos mapas la
    necesitan: aplanar el normal y subir la rugosidad se hacen exactamente
    donde hay ropa, y recalcularla por separado sería la ocasión perfecta para
    que se descuadren.
    """
    marks = Landmarks(maps)
    y = maps.position[..., 1]
    x = np.abs(maps.position[..., 0])
    front = maps.front()

    out = base_albedo.astype(np.float64).copy()
    cloth = np.zeros(maps.region.shape, dtype=bool)

    def lay(mask: np.ndarray, colour: tuple[int, int, int], *, fabric: bool = True) -> None:
        """Pinta una prenda con el borde SUAVIZADO.

        El borde duro es lo que delataba el horneado: las máscaras se calculan
        téxel a téxel a partir de la región y de la normal, así que su contorno
        sigue la retícula de la textura y sale dentado. En pantalla se veía
        como parches recortados con tijera en los hombros y el cuello. Un
        difuminado de un téxel y medio lo convierte en una costura.
        """
        if not mask.any():
            return
        alpha = _feather(mask)[..., None]
        out[:] = out * (1.0 - alpha) + np.array(colour, dtype=np.float64) * alpha
        if fabric:
            cloth[mask] = True

    # --- raíz del pelo ----------------------------------------------------
    # El pelo y la barba son MALLAS de verdad (ver `UbcModel`), así que aquí
    # solo se tiñe la coronilla: es lo que se ve por las rendijas entre el
    # casquete de pelo y el cráneo.
    #
    # Antes se pintaba el cuero cabelludo entero con una línea de pelo
    # calculada por la normal. No daba error y en las pruebas todo pasaba: en
    # pantalla salía un antifaz oscuro sobre los ojos, porque las sienes miran
    # de lado y les tocaba la altura de la nuca. Lo que se ve en una captura no
    # lo ve una aserción.
    crown = maps.mask(HEAD) & (y > marks.head_low + 0.86 * (marks.head_high - marks.head_low))
    lay(crown, _mix(uniform.hair, (0, 0, 0), 0.1), fabric=False)

    # --- pantalón ---------------------------------------------------------
    lay(maps.mask(PELVIS, THIGH, CALF), uniform.trousers)

    # Rodilleras y bolsillos de muslo. Dos bandas apenas más oscuras que el
    # pantalón: no se ven como piezas, se ven como que el pantalón es táctico.
    # Sin ellas la pierna pintada lee como una malla.
    side = np.abs(maps.normal[..., 0]) > 0.55
    knee = maps.mask(THIGH, CALF) & front & (y > marks.knee - 0.05) & (y < marks.knee + 0.09)
    lay(knee, _mix(uniform.trousers, (0, 0, 0), 0.22))
    pocket_y = 0.5 * (marks.knee + marks.pelvis_low)
    pocket = maps.mask(THIGH) & side & (np.abs(y - pocket_y) < 0.075)
    lay(pocket, _mix(uniform.trousers, (0, 0, 0), 0.16))

    # --- botas ------------------------------------------------------------
    boot_top = marks.boot_top(uniform.boot_height)
    boots = maps.mask(FOOT) | (maps.mask(CALF) & (y < boot_top))
    lay(boots, uniform.boots)
    boot_cuff = maps.mask(CALF) & (y < boot_top) & (y > boot_top - 0.028)
    lay(boot_cuff, _mix(uniform.boots, (0, 0, 0), 0.35))

    # --- chaqueta ---------------------------------------------------------
    jacket = maps.mask(TORSO, UPPERARM)
    if uniform.sleeves == "long":
        jacket = jacket | maps.mask(LOWERARM)
    lay(jacket, uniform.jacket)

    # Cuello y puños en el color de galón.
    lay(maps.mask(TORSO) & (y > marks.collar), uniform.trim)
    if uniform.sleeves == "long":
        lay(maps.mask(LOWERARM) & (x > marks.wrist_x - 0.045), uniform.trim)
    else:
        lay(maps.mask(UPPERARM) & (x > marks.elbow_x - 0.040), uniform.trim)

    # Hombreras. Se recortan por POSICIÓN y no por la normal: una máscara
    # hecha con `normal.y > 0.3` sigue la curvatura téxel a téxel y sale como
    # un parche mordido, no como una pieza de tela.
    lay(maps.mask(UPPERARM) & (x < marks.shoulder_x + 0.055), uniform.trim)

    # --- correaje del pecho ----------------------------------------------
    if uniform.stripe > 0.0:
        strap = (
            maps.mask(TORSO)
            & (y > marks.chest_low)
            & (y < marks.chest_high)
        )
        lay(strap, uniform.accent)
        # Cremallera: una línea fina en el centro del pecho, solo por delante.
        lay(maps.mask(TORSO) & front & (x < 0.013), _mix(uniform.jacket, (0, 0, 0), 0.45))

    # --- cinturón ---------------------------------------------------------
    belt = maps.mask(TORSO, PELVIS, THIGH) & (
        np.abs(y - marks.belt_centre) < marks.belt_half
    )
    lay(belt, uniform.belt)
    lay(belt & front & (x < 0.050), uniform.trim)

    # --- guantes ----------------------------------------------------------
    if uniform.gloves is not None:
        gloves = maps.mask(HAND) | (maps.mask(LOWERARM) & (x > marks.wrist_x - 0.020))
        lay(gloves, uniform.gloves)

    # --- acabado ----------------------------------------------------------
    detail = _detail_transfer(base_albedo)
    out[cloth] *= detail[cloth][:, None]
    out *= _fabric_noise(out.shape[:2], cloth)[..., None]
    out[~maps.covered] = base_albedo[~maps.covered]
    return np.clip(out, 0, 255).astype(np.uint8), cloth


def _feather(mask: np.ndarray, radius: float = 1.4) -> np.ndarray:
    """Máscara binaria → alfa con el borde difuminado."""
    image = Image.fromarray((mask * 255).astype(np.uint8))
    return np.asarray(image.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float64) / 255.0


def _mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(round(a[i] * (1 - t) + b[i] * t)) for i in range(3))  # type: ignore[return-value]


def _detail_transfer(albedo: np.ndarray) -> np.ndarray:
    """Pliegues y sombreado del cuerpo, sin su color.

    Se divide la luminancia por su versión desenfocada. Lo que queda es solo el
    detalle de alta frecuencia —arrugas, cavidades, el hueco del ombligo—, sin
    arrastrar el hecho de que la ropa interior del modelo sea negra. Copiar la
    luminancia tal cual pintaría un calzoncillo oscuro debajo del pantalón.
    """
    gray = albedo.astype(np.float64) @ np.array([0.2126, 0.7152, 0.0722])
    blurred = np.asarray(
        Image.fromarray(gray.astype(np.uint8)).filter(ImageFilter.GaussianBlur(6.0)),
        dtype=np.float64,
    )
    ratio = np.divide(gray, np.maximum(blurred, 1.0))
    return np.clip(ratio, 0.90, 1.10)


def _fabric_noise(shape: tuple[int, int], cloth: np.ndarray) -> np.ndarray:
    """Grano finísimo, solo sobre la tela. Semilla fija: el resultado tiene que
    ser el mismo en cada ejecución o el repositorio se llena de diffs de ruido.
    """
    rng = np.random.default_rng(20120601)
    noise = 1.0 + (rng.random(shape) - 0.5) * 0.05
    return np.where(cloth, noise, 1.0)


def flatten_normal(base: Image.Image, cloth: np.ndarray, size: int) -> Image.Image:
    """Atenúa el relieve del cuerpo desnudo donde hay ropa."""
    normal = np.asarray(base.convert("RGB").resize((size, size), Image.LANCZOS), dtype=np.float64)
    mask = _resize_mask(cloth, size)
    flat = np.array([127.5, 127.5, 255.0])
    # 0.75 y no 1.0: aplanarlo del todo deja la chaqueta como un plástico. Un
    # cuarto del relieve original lee como tela sobre un cuerpo.
    normal[mask] = normal[mask] * 0.25 + flat * 0.75
    return Image.fromarray(np.clip(normal, 0, 255).astype(np.uint8))


def cloth_roughness(base: Image.Image, cloth: np.ndarray, size: int) -> Image.Image:
    """Sube la rugosidad donde hay tela: la piel brilla, el algodón no."""
    rough = np.asarray(base.convert("L").resize((size, size), Image.LANCZOS), dtype=np.float64)
    mask = _resize_mask(cloth, size)
    rough[mask] = np.clip(rough[mask] * 0.25 + 218.0, 0, 255)
    return Image.fromarray(rough.astype(np.uint8))


def _resize_mask(mask: np.ndarray, size: int) -> np.ndarray:
    image = Image.fromarray((mask * 255).astype(np.uint8)).resize((size, size), Image.NEAREST)
    return np.asarray(image) > 127


def write_materials() -> None:
    """Escribe los `.tres` que el juego carga para cada arquetipo."""
    MATERIALS.mkdir(parents=True, exist_ok=True)
    for uniform in UNIFORMS:
        (MATERIALS / f"{uniform.archetype}.tres").write_text(
            BODY_MATERIAL.format(label=uniform.label, archetype=uniform.archetype),
            encoding="utf-8",
        )
        (MATERIALS / f"{uniform.archetype}_hair.tres").write_text(
            HAIR_MATERIAL.format(
                label=uniform.label,
                archetype=uniform.archetype,
                r=round(uniform.hair[0] / 255.0, 3),
                g=round(uniform.hair[1] / 255.0, 3),
                b=round(uniform.hair[2] / 255.0, 3),
            ),
            encoding="utf-8",
        )


def build(size: int, out_dir: Path) -> list[str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    cache: dict[str, tuple[BodyMaps, np.ndarray, Image.Image, Image.Image]] = {}

    for uniform in UNIFORMS:
        base = BASES[uniform.base]
        if uniform.base not in cache:
            maps = bake_body_maps(str(MODELS / base["model"]), base["material"], size)
            albedo = np.asarray(
                Image.open(MODELS / base["albedo"])
                .convert("RGB")
                .resize((size, size), Image.LANCZOS),
                dtype=np.uint8,
            )
            normal = Image.open(MODELS / base["normal"])
            rough = Image.open(MODELS / base["roughness"])
            cache[uniform.base] = (maps, albedo, normal, rough)
        maps, albedo, normal, rough = cache[uniform.base]

        painted, cloth = paint(uniform, maps, albedo)
        name = uniform.archetype
        Image.fromarray(painted).save(out_dir / f"{name}_albedo.png")
        flatten_normal(normal, cloth, NORMAL_SIZE).save(out_dir / f"{name}_normal.png")
        cloth_roughness(rough, cloth, ROUGHNESS_SIZE).save(out_dir / f"{name}_roughness.png")
        written.append(name)
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--size", type=int, default=1024)
    parser.add_argument("--out", type=Path, default=MODELS / "skins")
    args = parser.parse_args()
    names = build(args.size, args.out)
    write_materials()
    print(f"{len(names)} uniformes en {args.out}: {', '.join(names)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
