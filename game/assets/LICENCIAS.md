# Procedencia de los assets

Auditoría de lo que se ha traído del proyecto de 2012 y de lo que se ha dejado
fuera. El criterio no es la cautela por la cautela: **lo que hizo el equipo es
del equipo y se usa**; lo que es de terceros no entra, por mucho que estuviera
en el repositorio original.

El proyecto de 2012 se liberó bajo licencia BSD. Para que el remake pueda hacer
lo mismo, no puede arrastrar material ajeno.

## Se usa — obra del equipo original

| Asset | Qué es | Procedencia |
|---|---|---|
| 45 modelos de personaje (`assets/models/characters/`) | 9 arquetipos × 5 fotogramas de animación | Modelados por Chutaos Team |
| 10 modelos de mobiliario y objetos (`assets/models/props/`) | Mesa, escritorio, sillón, sofá, silla, estantería, planta, mesa con sillas, botiquín, munición | Ídem |
| Efectos de sonido, paquete normal (`assets/audio/sfx/normal/`) | pistola, ametralladora, cuchillo, paso, muerte, quejido | Grabados por el equipo |
| Efectos de sonido, paquete Chutaos (`assets/audio/sfx/chutaos/`) | Los mismos, en tomas de broma | Ídem. Se conservan porque son parte de la identidad del proyecto |
| `assets/audio/music/credits.ogg` | Música de créditos | **Compuesta por el equipo** — sus metadatos Vorbis dicen `TITLE=Stracomter3 ARTIST=Chutaos Team` |
| `assets/audio/sfx/chutaos/taunt.ogg` | Provocación | Metadatos: `ARTIST=Ruben` (Rubén Pardo Millá, del equipo) |
| Texturas de superficie, mobiliario, HUD y efectos | Suelos, paredes, muebles, iconos de vida y munición | Creadas por el equipo |
| `BebasNeue.ttf`, `Absender.ttf`, `Coolvetica.ttf` | Tipografías | Fuentes libres de terceros, redistribuibles |

## Se usa — terceros con licencia libre

| Asset | Qué es | Licencia | Procedencia |
|---|---|---|---|
| `assets/models/characters_modern/*.glb` | 9 personajes estilizados con 27 animaciones cada uno (`idle`, `walk`, `sprint`, `die`, `pick-up`…) | **CC0 (dominio público)** | *Blocky Characters* de [Kenney](https://kenney.nl/assets/blocky-characters). La licencia viaja junto a los ficheros, no en un README que alguien pueda separar de ellos |

Sobre Team Fortress 2, que era la referencia buscada: **sus modelos no son código
abierto**, son propiedad de Valve, y no existe una versión libre oficial. Lo que sí
existe es material CC0 del mismo registro estilizado, y eso es lo que se usa. Los
personajes de Kenney encajan por dos razones: son de proporciones exageradas y colores
planos, que es justo lo que pide el cel-shading, y traen animación real, cosa que los
modelos de 2012 no tienen.

Estos modelos conviven con los originales, no los sustituyen: se conmuta en juego con
`: retro on` y `: retro off`.

## NO se usa — material de terceros

| Asset | Qué es en realidad | Cómo se supo |
|---|---|---|
| `LegendsOfLiberty.ogg` | **"Invaders Must Die" — The Prodigy** | Metadatos Vorbis del propio fichero |
| `andorga.ogg` | **"Warriors Dance" — The Prodigy** | Ídem |
| `LegendsOfLibertyVerdad.ogg`, `andorgaVerdad.ogg` | Recodificaciones de los anteriores | Mismo nombre base, sin metadatos |
| `acdc.ogg` | Presumiblemente AC/DC | El nombre del fichero |
| `personal/explosion.ogg` | Idéntico byte a byte a `sound/3rd/explosion.ogg` | El propio equipo lo archivó en una carpeta llamada `3rd` |
| `scout_flat.tga`, `pyro_flat.tga`, `medic_flat.tga`, `spy_flat.tga`, `heavy_flat.tga`, `demo_flat.tga`, `engi_flat.tga`, `soldier_flat.tga`, `sniper_flat.tga` | **Texturas de personaje de Team Fortress 2** | Los nombres son las nueve clases del juego de Valve |
| `TF2.ttf`, `tf2build.ttf` | Tipografías de Team Fortress 2 | El nombre |

Hay un test que falla si alguno de estos vuelve a colarse
(`tests/assets/test_legacy_assets.gd`).

## Consecuencias y qué hacer

**Los personajes de 2012 van sin textura, con cel-shading y un color plano por
arquetipo.** Las nueve skins que el original les ponía eran de Team Fortress 2. El
color sale del campo `tint` de `CharacterStats`, que es el que el legacy ya asignaba
a cada tipo, así que se conserva la identificación visual por color. El cel-shading
porta la receta exacta del shader que el propio equipo escribió en 2012 —cuatro
bandas con umbrales 0,95 / 0,7 / 0,3— así que el color plano se lee como estilo y no
como carencia.

Los modelos CC0 nuevos están disponibles en paralelo. `: retro on` devuelve los de
2012; `: retro off` pone los nuevos.

**Menú y acción están sin música.** Las dos pistas que sonaban son de The
Prodigy. La de créditos sí suena, porque la compuso el equipo. Opciones:
componer o licenciar dos pistas, o dejar el ambiente sin música y apoyarse en el
sonido diegético, que además encaja con un juego donde oír es información táctica.

**La explosión del paquete normal es provisional**: se usa la del paquete
Chutaos mientras no se grabe una propia, porque la original era de terceros.

## Nota sobre el formato

Los `.3ds` no los lee ningún motor moderno. Se convierten a glTF 2.0 con
`tools/model_converter/convert_3ds.py`, escrito para este proyecto y sin
dependencias fuera de la biblioteca estándar. La geometría es la de 2012, sin
retoques: solo cambio de sistema de coordenadas y de escala.
