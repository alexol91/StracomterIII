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
| Texturas de mobiliario, HUD y efectos | Muebles, iconos de vida y munición, explosión | Creadas por el equipo |
| `BebasNeue.ttf`, `Absender.ttf`, `Coolvetica.ttf` | Tipografías | Fuentes libres de terceros, redistribuibles |

## Se usa — terceros con licencia libre

| Asset | Qué es | Licencia | Procedencia |
|---|---|---|---|
| `assets/models/characters_modern/*.glb` | 9 personajes estilizados con 27 animaciones cada uno (`idle`, `walk`, `sprint`, `die`, `pick-up`…) | **CC0 (dominio público)** | *Blocky Characters* de [Kenney](https://kenney.nl/assets/blocky-characters). La licencia viaja junto a los ficheros, no en un README que alguien pueda separar de ellos |

Sobre Team Fortress 2, que era la referencia buscada: **sus modelos no son código
abierto**, son propiedad de Valve, y no existe una versión libre oficial. Lo que sí
existe es material CC0 del mismo registro estilizado, y eso es lo que se usa.

Los primeros que se probaron fueron los *Blocky Characters* de Kenney, también CC0.
Se descartaron por estilo: son cubos, y lo que se buscaba era el registro de TF2 o
Fortnite —proporciones exageradas pero humanas, pintado a mano—. Los de KayKit dan
justo eso, traen entre 76 y 95 animaciones cada uno, y **el reparto resuelve además un
problema de juego**: los cuatro aventureros son la escuadra y los cuatro esqueletos los
enemigos, así que amigo y enemigo se distinguen por SILUETA y no por el color de una
camiseta. Es la regla de TF2, y con los modelos anteriores no se cumplía.

Se buscaron también Quaternius (CC0, *Ultimate Modular Men*, temáticamente más
apropiado para una oficina) y varios paquetes de OpenGameArt, pero sus descargas van
por Google Drive o por ficheros sueltos de autores distintos, sin un esqueleto ni un
set de animaciones común. La coherencia de un solo paquete pesa más que la temática.

Estos modelos conviven con los originales, no los sustituyen: se conmuta en juego con
`: chutaos on` y `: chutaos off`.

## Se usa — hecho para el remake

| Asset | Qué es | Procedencia |
|---|---|---|
| `assets/textures/modern/*.png` | 13 mapas (albedo, normales, rugosidad) de las seis superficies del mundo | Horneados por `tools/texture_baker/bake_textures.gd`, escrito para este proyecto. Son función pura de unas semillas fijas: se pueden reproducir bit a bit y el generador es revisable en texto |
| `assets/materials/modern/*.tres` | Los seis materiales del remake más el cristal | Ídem |

Ninguna de estas texturas viene de un banco de imágenes. La paleta sí está sacada
de las originales —el gris de `sueloOficina.jpg`, el hormigón claro de `pared.jpg`—,
que es lo que se pidió: usar las de 2012 como boceto.

## Se usa, con reserva — texturas de superficie de 2012

`assets/textures/chutaos/` contiene cinco texturas del proyecto original
(`pared.jpg`, `sueloOficina.jpg`, `tp3.png`, `techoPared.png`, `mesa.png`) más el
fondo del menú (`fondo.jpg`, aquí `fondo_torre.jpg`). Se usan **solo en el estilo
chutaos**, que es el modo «así era en 2012», y el reparto por superficie es
exactamente el que hacía `core/lib/ResourceManager.cc:867-890`.

Una corrección a la versión anterior de este documento, que las daba por obra del
equipo: **no todas lo son**. `pared.jpg` y `paredOficina.jpg` son fotografías —un
panel de hormigón con remaches y un muro de bloques— con la iluminación y el ruido
de sensor propios de una cámara, no de un dibujo. Lo más probable es que salieran
de un banco de texturas en 2012, sin registrar de cuál. `fondo.jpg` sí es obra del
equipo: es un render de SketchUp de la propia Torre Chutaos, con el rótulo
«CHUTAOS Inc.» puesto a mano.

Se mantienen porque son el juego original y el modo chutaos existe para verlo tal
cual, pero conviene saber que **su procedencia no está verificada**. Si el remake
se publicara con licencia BSD, esta carpeta es lo primero que habría que sustituir
—y sustituirla es barato, porque el estilo moderno ya no depende de ninguna de
ellas—.

## Se usa solo en local — Team Fortress 2

Los personajes de TF2 **no están en este repositorio y no van a estarlo**.
`game/assets/models/characters_tf2/` está en `.gitignore`, y la razón es una
distinción que conviene no confundir: el uso no comercial de material de Valve
en un proyecto de aficionado es una cosa, y **subir sus modelos a un
repositorio público es otra** — eso es redistribución, la haga quien la haga y
con la intención que sea.

Quien quiera jugar con ellos los saca de su propia copia del juego con
`tools/tf2_import/import_tf2.py`, que necesita TF2 instalado y Blender con
Blender Source Tools. El reparto de clase por arquetipo no es una elección
nueva: es el mismo que hacía `core/lib/ResourceManager.cc:560-770` en 2012.

| Arquetipo | Clase de TF2 |
|---|---|
| captain | soldier |
| technician | scout |
| specialist | heavy |
| demolition | demo |
| enemy_thug | pyro |
| enemy_militiaman | sniper |
| enemy_veteran | engineer |
| miniboss | spy |
| megaboss | medic |

Sin esa carpeta el juego funciona igual, con los modelos CC0 de KayKit, y
`: tf2 on` avisa de que no hay nada importado en vez de encender un modo vacío.

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

Los modelos CC0 nuevos están disponibles en paralelo. `: chutaos on` devuelve los de
2012 —modelos, voces de broma y texturas de entonces—; `: chutaos off` pone los
nuevos. `: retro` sigue funcionando como alias del mismo eje.

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
