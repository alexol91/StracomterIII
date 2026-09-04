# Conversor de mapas legacy → Godot 4

Convierte los 26 mapas XML de `legacy/trunk/testFiles/maps/*.xml` (más
`legacy/trunk/editorMap.xml`) — diseño de nivel real, dibujado a mano en 2012
por cuatro personas — a escenas `.tscn` de texto plano para Godot 4.7.

Solo librería estándar de Python 3. Sin dependencias externas.

## Uso

```bash
# Un mapa suelto:
python3 tools/map_converter/convert.py <mapa.xml> <salida.tscn>

# Validar un mapa (sin convertirlo):
python3 tools/map_converter/validate.py <mapa.xml>

# Regenerar los 27 mapas + game/maps/legacy/CONVERSION.md:
python3 tools/map_converter/build_all.py
```

`build_all.py` es la fuente de la verdad de qué XML se convierte y con qué
nombre de escena (`SOURCE_BASENAMES` en ese fichero). Es determinista: se
puede ejecutar tantas veces como se quiera y produce siempre los mismos 27
`.tscn` byte a byte (verificado; no hay timestamps, IDs aleatorios ni orden
de iteración no determinista).

## Ficheros

| Fichero | Qué hace |
|---|---|
| `legacy_map.py` | Analizador XML tolerante + geometría + rejilla de navegación. Toda la semántica derivada de `Map::loadData`/`Map::getType` vive aquí, con referencias línea a línea al `.cc` original. |
| `convert.py` | Construye el texto del `.tscn` a partir de un `LegacyMap` ya cargado. |
| `validate.py` | Valida un mapa (geometría degenerada, spawn dentro del perímetro, navmesh no vacío y alcanzable). Ver más abajo. |
| `build_all.py` | Orquesta: convierte los 27 mapas, valida cada uno, escribe `game/maps/legacy/CONVERSION.md`. |
| `game/maps/legacy/_legacy_floor_mesh.gd` | Script runtime compartido por las 27 escenas: construye el `ArrayMesh` + `ConcavePolygonShape3D` del suelo a partir de los arrays exportados por `convert.py`. |
| `game/maps/legacy/_legacy_navmesh.gd` | Ídem para el `NavigationMesh` del `NavigationRegion3D`. |

## Por qué el análisis previo manda

La gramática del XML **no se adivina**: se deriva de `legacy/trunk/core/lib/Map.cc`
(`Map::loadData`, `Map::getType`) y de `docs/analisis/legacy-datos-assets.md`
(que a su vez se verificó compilando el TinyXML del propio repo). Puntos que
`legacy_map.py` reproduce a propósito porque así se comporta el motor
original, no porque sean "la forma correcta" de leer XML:

- Solo se leen 8 valores de `type`: `perimeter`, `wall`, `door`, `player`,
  `obstacle`, `objects`, `miniBoss`, `megaBoss`. **No existen los tipos
  numéricos `"0".."7"` como valor de `type`** — un `grep` ingenuo de
  `type="[0-7]"` da falsos positivos con el atributo `subtype` (que sí es
  numérico, y sí importa: ver la tabla de abajo). Si alguien pasara
  `type="0"` literalmente, `Map::getType` devolvería `-1` y el objeto se
  ignoraría en silencio, igual que `enemy`/`companion` en `map_01.xml`.
- Un `wall`/`door` con un número de vértices distinto de 4 **aborta el resto
  de la carga del mapa** (no solo ese objeto). No ocurre en ninguno de los
  27 mapas reales, pero el conversor lo replica y lo marca como error si
  algún día ocurre.
- Dentro del bucle de vértices de un mismo polígono, si a un `<vertex>` le
  falta `x` o `y`, **hereda el valor del vértice anterior** (así es como
  TinyXML rellena `QueryIntAttribute` cuando el atributo no existe: no toca
  la variable).
- `map_01.xml`..`map_04.xml` no son XML bien formado (`<?xml version="1.0">`
  sin `?>`, atributos sin comillas como `id=0`). `xml.etree` los rechaza;
  TinyXML los acepta. El analizador de `legacy_map.py` es un tokenizador
  mínimo escrito a propósito para tolerar exactamente esto (no es un parser
  XML general).

### Tipos numéricos `subtype` (la pregunta que pedía la tarea)

Los únicos enteros "sueltos" en los datos son el atributo `subtype` de
`obstacle` y `objects` — **no** un `type` numérico:

- `obstacle subtype` 0–7 → `Core::Obstacles::Type` (mesa, escritorio, sillón,
  sofá, silla, estantería, maceta, mesa con sillas). Se usa además para la
  huella de colisión 2D que alimenta la rejilla de navegación.
- `objects subtype` 0–6 → `Core::Objects::Class` (packs de vida/munición ×3
  tamaños + `sniper`, sin efecto implementado en el original).

## Escala y mapeo de coordenadas

- **Escala**: `1 unidad legacy = 1/75 m` (radio de personaje 30 u → 0,4 m;
  `docs/01-gdd.md` §5, confirmado en `legacy_map.SCALE`). Distinto del 1 u =
  2 cm que proponía el borrador de análisis inicial: se usa la cifra del GDD
  porque es la que rige la escala del remake completo, no solo de los mapas.
- **Muros**: extruidos a 3,0 m de altura (`WALL_HEIGHT_M`). **Puertas**: 2,1 m
  de referencia (`DOOR_HEIGHT_M`), aunque en esta conversión son solo
  marcadores (ver más abajo).
- **Coordenadas**: `godot(x, y) = Vector3(x·S, altura, y·S)`. El plano XY del
  legacy pasa al plano XZ de Godot; **no se invierte ningún eje**. Con una
  `Camera3D` cenital `rotation_degrees.x = -90` (mira hacia -Y; "arriba" de
  pantalla = -Z) la imagen coincide con la del legacy (+x derecha, +y abajo)
  sin necesidad de espejar nada — igual que en `docs/analisis/legacy-datos-assets.md`
  §6.2. **Verificación de la orientación** (para no invertir el diseño sin
  darse cuenta): `Polygon::isClockwise` del legacy dice que los 27 perímetros
  originales son horarios y los 300 muros + 100 puertas no lo son;
  `validate.py` recalcula la misma fórmula sobre cada mapa convertido y avisa
  si algún perímetro sale antihorario (ninguno lo hace en el corpus actual).
  Como el mapeo de ejes es una identidad (solo se renombra `y`→`z` y se añade
  la altura), el signo del área con la fórmula de Gauss es el mismo en
  legacy-XY que en Godot-XZ: la comprobación de orientación es, en la
  práctica, una comprobación de que el orden de los vértices no se ha tocado
  al leerlos, no de que haya que corregir un espejo.
- **Ángulos**: `rotation.y = -deg_to_rad(ángulo_legacy)` para objetos
  puntuales (jugador, obstáculos, pickups); para segmentos con dirección
  (aristas del perímetro, muros, puertas) se usa la fórmula equivalente
  `rotation.y = -atan2(dy, dx)`. Ambas fórmulas son la misma expresada de dos
  formas (`heading_rotation_y(cosθ, sinθ) == angle_rotation_y(θ)`, comprobado
  en `legacy_map.py`).

## Qué es geometría real y qué es un marcador

- **`wall`** se extruye a malla 3D real con colisión: un `StaticBody3D` por
  tramo, con `BoxMesh`/`BoxShape3D` — **siempre convexo por tramo**, nunca un
  trimesh gigante para todos los muros. Para el `wall` no rectangular de
  `map_03.xml` (el único de los 300) se usa una caja orientada a la
  diagonal más larga del cuadrilátero: una aproximación razonable, no una
  extrusión exacta del cuadrilátero irregular.
- **`perimeter`** también se extruye a malla 3D (visualmente, cada arista
  sigue siendo un `StaticBody3D` con su propio `BoxMesh`), pero su colisión
  **no** vive en esas cajas: por un bug real de Recast/`NavigationServer3D`
  documentado más abajo ("Bug real: la colisión del perímetro rompía el
  navmesh de verdad"), una `BoxShape3D` suelta por arista del perímetro
  puede sellar el navmesh en un punto totalmente ajeno del mapa. La colisión
  del perímetro se funde como más triángulos del trimesh de `Floor`
  (`skirt_vertices`/`skirt_indices`); `Walls/PerimeterWall_i` es puramente
  visual (`collision_layer = 0`, sin `CollisionShape3D`).
- **`door`, `obstacle`, `objects`, `player`, `miniBoss`, `megaBoss`** son
  **nodos `Marker3D` con metadatos** (`metadata/type`, tamaño, `subtype`,
  ángulo original…), sin geometría ni colisión propias. Decisión explícita
  del encargo: "otros agentes instanciarán las escenas reales encima". Esto
  incluye las puertas — no llevan `Door.tscn` ni colisión aquí porque esa
  escena no existe todavía en el árbol del proyecto y no es responsabilidad
  de este conversor crearla.
- Consecuencia directa para el navmesh: como las puertas no tienen colisión
  en esta conversión, el hueco que dejan en el trazado de muros ya es
  transitable de por sí (tal y como en los datos originales: "las puertas no
  se restan de los muros, ocupan huecos ya dejados", ver
  `docs/analisis/legacy-datos-assets.md` §2). Cuando otro agente añada la
  puerta real con colisión que empieza cerrada, deberá excluir su hueco del
  navmesh horneado (o usar un `NavigationObstacle3D` dinámico) — este
  conversor no lo hace porque haría trampa: fingiría una puerta que en esta
  escena no existe.

## El `ArrayMesh`/`NavigationMesh` no se escribe a mano

Godot 4 serializa `ArrayMesh._surfaces` y los polígonos de `NavigationMesh`
como buffers binarios comprimidos con flags de formato exactos — escribir
eso a mano desde Python es frágil y no aporta nada. En su lugar, `convert.py`
escribe los datos crudos (`floor_vertices`, `floor_indices`, `nav_vertices`,
`nav_polygons`, ...) como propiedades exportadas en texto plano
(`PackedVector3Array`, `PackedInt32Array`, `Array[PackedInt32Array]` — el
mismo tipo de literal que ya usan `game/src/data/floors/*.tres`), y dos
scripts compartidos (`_legacy_floor_mesh.gd`, `_legacy_navmesh.gd`)
construyen el recurso real en `_ready()`. Resultado idéntico a un mesh
horneado a mano en el editor, pero determinista y verificable por diff de
texto.

Importante para quien escriba pruebas sobre estas escenas: las propiedades
exportadas (`nav_vertices`, `nav_polygons`, `floor_vertices`...) están
disponibles en cuanto se instancia la escena, **sin** necesidad de que el
nodo entre en el `SceneTree` ni de que `_ready()` llegue a ejecutarse. El
recurso derivado (`NavigationMesh`, `ArrayMesh`) sí depende de `_ready()`.
`game/tests/maps/test_legacy_maps.gd` comprueba el navmesh "no vacío" leyendo
los datos exportados por esa razón: el runner de pruebas del proyecto
(`game/tests/run_tests.gd`) ejecuta los tests de forma síncrona y no procesa
ningún frame antes de salir.

## Navegación: por qué una rejilla y no un Delaunay

El legacy hornea el navmesh con una triangulación de Delaunay del mapa más
expansión por `charRadius` (`Pathfinder::makeDualGraph`, `Map.cc:562-647`).
Reproducir eso exactamente en Python puro (sin `shapely`/`CGAL`) para 27
mapas —algunos no convexos, con hasta 47 obstáculos rotados— es un proyecto
en sí mismo. En su lugar, `build_nav_grid` (en `legacy_map.py`) usa un
**flood-fill sobre una rejilla regular**:

1. Rejilla dimensionada dinámicamente por mapa (celda entre 15 y 50 u,
   apuntando a ~1600 celdas) para que el fichero de salida no se dispare de
   tamaño en los mapas grandes ni pierda resolución en los pequeños (un
   hueco de puerta de 100 u siempre cae en ≥2 celdas).
2. Una celda es "libre" si su centro cae dentro del perímetro y fuera de
   todo `wall` y de la huella rotada de todo `obstacle` (tabla de huellas de
   `docs/analisis/legacy-datos-assets.md` §2, la misma que usa el motor
   original para las colisiones de mobiliario). Las puertas no bloquean (ver
   arriba).
3. Las celdas libres contiguas de cada fila se fusionan en un único
   rectángulo antes de escribirse como polígono del `NavigationMesh` — si no,
   un mapa grande generaría miles de quads sueltos.

Limitaciones documentadas, no escondidas:

- No hay erosión por `agent_radius` a nivel de rejilla (un pasillo de
  exactamente el ancho de un personaje podría marcarse libre de punta a
  punta sin margen). Para los 27 mapas del corpus no se ha observado ningún
  pasillo tan ajustado, pero si aparece uno nuevo, `validate.py` lo detectaría
  igualmente como "alcanzable" aunque en el juego real friccionara contra
  la pared.
- Es una aproximación por rejilla, no un navmesh poligonal fiel a la forma
  exacta del hueco entre muros. Sirve para verificar conectividad
  (alcanzabilidad) y para tener *algo* navegable de partida; si el gameplay
  necesita rutas más finas, hornear con `NavigationServer3D` sobre la
  colisión real (`Floor` + `Walls`) en el propio editor es la vía natural
  — la geometría de colisión que genera este conversor es apta para ello.

## Bug real: la colisión del perímetro rompía el navmesh de verdad (Recast)

Esta sección documenta un hallazgo posterior a la primera versión de este
conversor, para que quien vuelva a tocar `convert.py` no lo repita. `ai-navegacion`
midió con `NavigationServer3D` (el horneado que usa el juego de verdad, no la
rejilla de `validate.py` de más abajo) que `finalMap` — la planta 8,
obligatoria — solo tenía el **46 %** de su navmesh horneado en una única
componente conexa, y en menor medida `map1`, `mapM2`, `mapM4`, `mapP1`,
`map_03`, `mapaMolon`. El validador propio de este conversor daba los 27
mapas al 100 %: dos navmeshes distintos, y el que manda es el de Recast
porque es el que usa el juego.

Dos bugs reales, distintos, encontrados en cadena:

1. **Bobinado de la colisión del suelo.** `NavigationServer3D.bake_from_source_geometry_data`
   con `PARSED_GEOMETRY_STATIC_COLLIDERS` exige los triángulos con la normal
   apuntando a **-Y** (horario visto desde arriba); el mesh visual necesita
   justo lo contrario (+Y, si no Godot le hace back-face culling y el suelo
   no se ve). Con el suelo usando el mismo orden para colisión y para
   render, el horneado descartaba el suelo entero **en silencio** (0
   polígonos, sin ningún aviso). Arreglo: `_legacy_floor_mesh.gd` construye
   la forma de colisión con los triángulos invertidos respecto al mesh
   visual (ver la nota grande de ese fichero).
2. **Una `BoxShape3D` suelta por arista del perímetro.** Con el bobinado ya
   arreglado, `finalMap` seguía al 46 %. Por bisección (quitar geometría de
   una en una hasta que la conexión vuelve) la causa resultó ser la caja de
   colisión de **una sola arista** de `Walls/PerimeterWall_i` — una caja 3D
   normal y corriente, sin solapar nada — que rompía la conectividad del
   navmesh en un punto **a más de 4 metros de distancia**, en una puerta con
   la geometría perfecta (comprobada vértice a vértice). No es un problema
   del tipo de forma (una `ConvexPolygonShape3D` equivalente falla igual) ni
   exclusivo de aristas diagonales (`map1.xml`/`mapP1.xml` tienen perímetro
   rectilíneo y mostraban el mismo fallo en aristas alineadas a ejes): es que
   una caja suelta, como cuerpo rígido aparte, confunde el reparto en
   regiones del horneador de Recast/Godot 4.7.2. Un trimesh no tiene ese
   problema — el propio suelo, con esas mismas aristas, hornea siempre bien.

   **Arreglo**: el perímetro ya no tiene ninguna `BoxShape3D` de colisión
   propia. Su zócalo vertical (de altura `WALL_HEIGHT_M`) se funde como más
   triángulos del MISMO trimesh del suelo (`_build_perimeter_skirt` en
   `convert.py`, exportado como `skirt_vertices`/`skirt_indices` y fundido en
   `_legacy_floor_mesh.gd`). `Walls/PerimeterWall_i` se queda solo con su
   `MeshInstance3D` (aspecto visual) y `collision_layer = 0`.

   **Efecto secundario documentado, no un fallo de este conversor**:
   `pruebasMov.xml` (perímetro + spawn, sin ningún `wall` interior) se queda
   sin ninguna `BoxShape3D` en toda la escena. El detector de puntos de
   cobertura de `ai/navigation` (`NavTestUtil.collect_map_boxes`) solo sabe
   buscar `BoxShape3D`, no el trimesh de `Floor`, así que ese mapa concreto
   se queda sin puntos de cobertura. `pruebasMov.xml` no es un mapa de
   `floor_config` ni de `GameAction::selectionMap`: es un banco de pruebas de
   movimiento de 2012 sin mobiliario. La decisión de tratarlo como los demás
   prototipos sin sala jugable (`map_03.xml` ya tiene ese trato en
   `TINY_PROTOTYPES`) es de `ai/navigation`, no de este conversor.

Verificado tras el arreglo con `game/tests/maps/test_legacy_maps.gd`
(hornea con `NavTestUtil` + `NavigationServer3D`, la misma geometría de
origen que usa `game/tests/ai/navigation/test_legacy_maps_navigation.gd`):
los 25 mapas sin fallo de carga quedan con el **100 %** de su navmesh
horneado en una sola componente, salvo `mapaMolon.xml` (72 %) y `map_03.xml`
(55 %) — ninguno de los dos es un mapa de `floor_config`, y su causa es
distinta y mucho más pequeña: bolsillos de un par de m² alrededor de
obstáculos con forma de caja pegados casi al perímetro, no zonas enteras
tabicadas. Documentado como excepción conocida en ambos ficheros de test.

## Validación: la rejilla propia es una comprobación rápida, no la definitiva

No es un extra: el encargo es explícito en que un mapa que convierte pero no
es navegable es peor que uno que falla. Pero, como demuestra el bug de arriba,
**la rejilla de `validate.py` no es el navmesh que usa el juego** — es una
comprobación rápida en tiempo de conversión (geometría degenerada, spawn
dentro del perímetro, orden de vértices…), útil para pillar errores obvios
sin necesidad de abrir Godot, pero no una garantía de navegabilidad real. La
comprobación que manda corre en Godot, con `NavigationServer3D`, sobre la
geometría de colisión de verdad:

- `game/tests/maps/test_legacy_maps.gd` — hornea cada mapa con
  `NavTestUtil.source_from_map()` (lee `Floor.floor_vertices/floor_indices` y
  toda `BoxShape3D` de la escena directamente de las propiedades exportadas,
  sin necesitar árbol de escena) y comprueba que el navmesh resultante no
  está vacío y que ≥90 % de su área es una sola componente conexa (60 % para
  las dos excepciones documentadas arriba).
- `game/tests/ai/navigation/test_legacy_maps_navigation.gd` — la prueba de
  integración de `ai-navegacion`, con el mismo criterio y su propia lista de
  cuarentena (que debería poder vaciarse ahora que el bug del perímetro está
  arreglado — es su fichero, no el de este conversor).

`validate.py` recibe el mismo `LegacyMap` que alimenta a `convert.py` (no
relee el `.tscn`: la geometría de la rejilla se deriva de forma determinista
de esos mismos datos) y comprueba:

1. **Carga**: el XML no abortó (`status >= 0` como en `Map::loadData`).
2. **Geometría no degenerada**: perímetro con área > 0 y sin vértices
   duplicados consecutivos; cada `wall`/`door` con área > 0.
3. **Orientación**: perímetro horario / muros y puertas no horarios, como en
   el corpus original (aviso, no bloquea).
4. **Spawn del jugador**: dentro del perímetro y en una celda navegable de la
   rejilla (si el XML no trae `player` — solo pasa en `map_03.xml`— se avisa
   y no se puede comprobar alcanzabilidad).
5. **Muros y puertas dentro del perímetro** (aviso si el centro de alguno
   cae fuera).
6. **Navmesh no vacío y alcanzabilidad**: se hace flood-fill desde la celda
   del jugador; si menos del 90 % de las celdas libres son alcanzables, se
   considera que hay zonas aisladas y el mapa **falla** la validación.

`build_all.py` ejecuta esto sobre los 27 mapas y vuelca el resultado en
`game/maps/legacy/CONVERSION.md`. A fecha de esta conversión: **25 de 27
OK**. Los dos que fallan (`map_01.xml`, `map_02.xml`) son prototipos de 2011
("formato 2011": declaración sin `?>`, `ang`/`rank` en vez de `angle`, tipos
`enemy`/`companion` que el motor ignoraba) con el spawn del jugador situado
exactamente sobre el borde de un muro o de una entrante del perímetro en el
propio XML original — no forman parte de `GameAction::selectionMap` ni de
ningún `floor_config`, y `docs/analisis/legacy-datos-assets.md` ya los
señalaba como "pruebas de 2011 sin valor de diseño". El fallo es un hallazgo
real sobre el dato de origen, no un defecto del conversor: se documenta y no
se "arregla" moviendo el spawn, porque eso ya no sería el mapa de 2012.

## Cómo regenerar todo

```bash
python3 tools/map_converter/build_all.py
```

Regenera los 27 `.tscn` de `game/maps/legacy/` y `game/maps/legacy/CONVERSION.md`.
Para comprobar que las escenas cargan de verdad en Godot 4.7 (no solo que el
conversor no lanzó una excepción):

```bash
<godot> --headless --path game res://tests/run_tests.tscn -- --filter=maps
```

Sale con código 1 si algún mapa no carga, le falta `NavigationRegion3D`,
le falta la estructura de nodos acordada (`Walls`/`Doors`/`Obstacles`/
`Pickups`/`Spawns`), (para los 12 mapas exigidos por `floor_config`) no tiene
`Spawns/PlayerSpawn`, o su navmesh horneado con `NavigationServer3D` (no la
rejilla propia) queda partido en zonas sin conexión — ver la sección de
arriba sobre el bug del perímetro.

Para la prueba de integración equivalente de `ai-navegacion` (misma
geometría, más la comprobación de puntos de cobertura por sala):

```bash
<godot> --headless --path game res://tests/run_tests.tscn -- --filter=navigation
```
