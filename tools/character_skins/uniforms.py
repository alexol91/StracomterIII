"""Los nueve uniformes de la Torre Chutaos, como datos.

Un uniforme NO es una imagen: es un conjunto de colores y de medidas (dónde
acaba la manga, hasta dónde sube la bota). La imagen la deriva `bake_skins`
del mapa de regiones. Así, cambiar el azul del Capitán es cambiar un número, y
no repintar 2048×2048 píxeles a mano.

Los nueve arquetipos y su clase equivalente salen del original de 2012
(`docs/analisis/`): cuatro del escuadrón del jugador y cinco de la Corporación.
El reparto de color es de Team Fortress 2 y por el mismo motivo: a diez metros
y de espaldas, el equipo tiene que leerse antes que la silueta.
"""

from __future__ import annotations

from dataclasses import dataclass

RGB = tuple[int, int, int]


@dataclass(frozen=True)
class Uniform:
    """Cómo va vestido un arquetipo."""

    archetype: str
    base: str  # "male" | "female"
    label: str  # nombre en la UI, para el catálogo

    jacket: RGB  # torso y hombros
    trim: RGB  # cuello, puños, galones
    accent: RGB  # correaje y franja del pecho
    trousers: RGB
    belt: RGB
    boots: RGB
    gloves: RGB | None  # None = manos desnudas
    hair: RGB

    ## Fracción del gemelo que cubre la bota (0 = solo el pie, 1 = hasta la
    ## rodilla). Es fracción y no metros para que valga igual en el cuerpo
    ## masculino y en el femenino, que no miden lo mismo.
    boot_height: float = 0.35
    ## "long" cubre el antebrazo, "short" acaba en el codo.
    sleeves: str = "long"
    beard: bool = False
    ## Peso de la franja del pecho; 0 la quita.
    stripe: float = 1.0


## Escuadrón del jugador: azules. El original los llamaba por su función y esos
## nombres se conservan en inglés en el código (regla del proyecto).
_SQUAD: list[Uniform] = [
    Uniform(
        archetype="captain",
        base="male",
        label="Capitán",
        jacket=(38, 58, 104),
        trim=(196, 158, 66),
        accent=(214, 178, 74),
        trousers=(52, 56, 64),
        belt=(30, 30, 34),
        boots=(28, 28, 32),
        gloves=(38, 38, 44),
        hair=(58, 44, 34),
        boot_height=0.45,
        beard=True,
    ),
    Uniform(
        archetype="technician",
        base="female",
        label="Técnica",
        jacket=(58, 104, 154),
        trim=(214, 132, 40),
        accent=(226, 168, 52),
        trousers=(58, 104, 154),
        belt=(52, 40, 32),
        boots=(74, 52, 36),
        gloves=(188, 150, 96),
        hair=(126, 74, 40),
        boot_height=0.28,
        sleeves="short",
    ),
    Uniform(
        archetype="specialist",
        base="male",
        label="Especialista",
        jacket=(66, 78, 92),
        trim=(34, 44, 58),
        accent=(96, 158, 214),
        trousers=(34, 40, 50),
        belt=(24, 26, 30),
        boots=(26, 26, 30),
        gloves=(30, 32, 38),
        hair=(34, 30, 28),
        boot_height=0.50,
    ),
    Uniform(
        archetype="demolition",
        base="male",
        label="Demolición",
        jacket=(40, 62, 96),
        trim=(206, 176, 54),
        accent=(206, 176, 54),
        trousers=(62, 60, 52),
        belt=(44, 38, 30),
        boots=(64, 44, 30),
        gloves=(86, 62, 40),
        hair=(96, 62, 34),
        boot_height=0.55,
        beard=True,
    ),
]

## La Corporación: rojos.
_CORP: list[Uniform] = [
    Uniform(
        archetype="enemy_thug",
        base="male",
        label="Sicario",
        jacket=(150, 46, 40),
        trim=(206, 206, 204),
        accent=(40, 40, 44),
        trousers=(40, 40, 46),
        belt=(28, 28, 32),
        boots=(200, 198, 192),
        gloves=None,
        hair=(28, 24, 22),
        boot_height=0.18,
        sleeves="short",
        stripe=0.0,
    ),
    Uniform(
        archetype="enemy_militiaman",
        base="female",
        label="Miliciana",
        jacket=(132, 62, 46),
        trim=(88, 92, 58),
        accent=(88, 92, 58),
        trousers=(96, 92, 62),
        belt=(52, 44, 32),
        boots=(58, 44, 30),
        gloves=None,
        hair=(46, 34, 26),
        boot_height=0.40,
    ),
    Uniform(
        archetype="enemy_veteran",
        base="male",
        label="Veterano",
        jacket=(112, 36, 32),
        trim=(48, 24, 22),
        accent=(198, 176, 130),
        trousers=(44, 42, 40),
        belt=(30, 26, 24),
        boots=(32, 28, 26),
        gloves=(38, 34, 32),
        hair=(72, 70, 68),
        boot_height=0.52,
        beard=True,
    ),
    Uniform(
        archetype="miniboss",
        base="male",
        label="MiniBoss",
        jacket=(148, 30, 34),
        trim=(184, 148, 60),
        accent=(232, 214, 150),
        trousers=(34, 32, 36),
        belt=(24, 22, 26),
        boots=(26, 24, 28),
        gloves=(184, 148, 60),
        hair=(24, 22, 20),
        boot_height=0.58,
    ),
    Uniform(
        archetype="megaboss",
        base="male",
        label="MegaBoss",
        jacket=(46, 20, 26),
        trim=(198, 162, 66),
        accent=(158, 24, 30),
        trousers=(30, 24, 28),
        belt=(198, 162, 66),
        boots=(24, 20, 24),
        gloves=(198, 162, 66),
        hair=(30, 28, 30),
        boot_height=0.62,
        beard=True,
    ),
]

UNIFORMS: list[Uniform] = _SQUAD + _CORP

BY_ARCHETYPE: dict[str, Uniform] = {u.archetype: u for u in UNIFORMS}
