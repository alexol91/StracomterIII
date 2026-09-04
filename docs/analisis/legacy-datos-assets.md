# Análisis legacy — Datos, assets y especificación del conversor

Ámbito: ficheros de datos (`legacy/trunk/testFiles/maps/*.xml`, `legacy/trunk/editorMap.xml`, `editorMap.xml.nav`, `mapRuben.xml.aux`, `mapRuben.xml.wall`), assets (`legacy/trunk/Graphics/Resources/{modelos,texturas,shaders,fuentes}`, `legacy/trunk/testFiles/sound`) y la especificación de un conversor XML → Godot 4. Todo lo que sigue se ha derivado leyendo el código y los datos reales; las cifras de los inventarios se han calculado con `python3` (scripts en el scratchpad de la sesión) y la carga de los XML se ha verificado compilando el TinyXML del propio repo (`legacy/trunk/3rdParty/tinyXML`) contra un arnés que reproduce la lógica de `Map::loadData`.

Rutas: salvo indicación contraria, todas las rutas son relativas a `legacy/trunk/`.

---

## 1. Formato del XML de mapa

### 1.1 Parser de referencia

El único lector de mapas del motor es `Map::loadData()` (`core/lib/Map.cc:94-327`), basado en TinyXML. Puntos clave, en el orden en que los ejecuta el código:

| Paso | Código | Consecuencia sobre el formato |
|---|---|---|
| Se abre el documento y se recorre **todo hijo directo del elemento raíz**, sin comprobar el nombre del raíz ni del hijo | `Map.cc:129` `doc.RootElement()->FirstChildElement()` y `Map.cc:131` `while (objeto != NULL && status >= 0)` | El nombre `<map>` y `<object>` es convención del escritor, **no** se valida. Cualquier elemento hijo del raíz se trata como objeto. |
| De cada hijo se lee **solo** el atributo `type` | `Map.cc:133` `objeto->Attribute("type")` | Si falta `type` → `status = -2` (`Map.cc:321`) y el bucle termina (no se procesan los objetos siguientes). |
| `type` se convierte a entero con `Map::getType` | `Map.cc:136`, definición en `Map.cc:524-548` | Solo se reconocen 8 cadenas (ver 1.2). Cualquier otra cadena devuelve `-1` y cae en `default:` (`Map.cc:313-316`), que **ignora el elemento en silencio**. |
| Variables por objeto con valores por defecto | `Map.cc:138-142`: `vector<Point> vPAux; int x = 0, y = 0; double ang = 0.0; int clase = 0;` | Los atributos ausentes conservan el valor por defecto (`QueryIntAttribute` no toca la variable si el atributo no existe): `angle` ausente ⇒ 0.0, `subtype` ausente ⇒ 0, `x`/`y` ausentes ⇒ 0. |
| Lista de vértices | `Map.cc:147`, `180`, `240`: `objeto->FirstChildElement()->FirstChildElement()` y luego `NextSiblingElement()` | Se exige exactamente **un nivel de anidamiento** (`<vertexlist>` → `<vertex>`), pero el nombre de ambos elementos es irrelevante. De cada vértice se leen `x` e `y` como **enteros** (`QueryIntAttribute`, `Map.cc:151-152`). El atributo `id` **nunca se lee**. El orden es el orden documental. Si a un `<vertex>` le falta `x` o `y`, hereda el valor del vértice anterior (las variables `x`,`y` viven fuera del bucle interno). |
| Valor de retorno | `Map.cc:174` `status = 1` al leer el perímetro; `Map.cc:194-195` y `254-255` `status = -1` si un `wall`/`door` no tiene exactamente 4 vértices | `loadData()` devuelve `1` si hay perímetro y ningún error, `0` si no hay perímetro, `-1` muro/puerta mal formado, `-2` elemento sin `type`. Nadie comprueba el retorno en `GameAction.cc:178`. |

Escritor de referencia: `Map::writeFile()` (`Map.cc:395-518`), usado por el editor (`core/src/mapEditor.cc:1035`). Escribe la declaración `<?xml version="1.0" ?>`, el raíz `<map>` y, **solo si hay perímetro** (`Map.cc:405`), en este orden: 1 `perimeter`, N `wall`, N `door`, N `obstacle`, N `objects` y **exactamente un** `player` con `angle="0.0"` y `rank="1"` fijos (`Map.cc:505-511`). **No escribe `miniBoss` ni `megaBoss`**: esos elementos se añadieron a mano en los mapas (se aprecia en `mapM4.xml:218`, la única línea con tabulador en vez de espacios).

### 1.2 Gramática real

```
documento   := '<?xml version="1.0" ?>'? raiz
raiz        := '<map>' objeto* '</map>'              -- nombre no validado
objeto      := poligono | puntual                    -- nombre 'object' no validado
poligono    := '<object type="' tipoPoly '">' lista '</object>'
tipoPoly    := 'perimeter' | 'wall' | 'door'
lista       := '<vertexlist>' vertice+ '</vertexlist>' -- nombre no validado; un nivel exacto
vertice     := '<vertex id="INT"? x="INT" y="INT" />'   -- id ignorado
puntual     := '<object type="' tipoPunt '" x="INT" y="INT" angle="FLOAT"? subtype="INT"? rank="INT"? />'
tipoPunt    := 'player' | 'obstacle' | 'objects' | 'miniBoss' | 'megaBoss'
```

Tabla de `type` válidos (`Map::getType`, `Map.cc:524-548`) y su enumerado `Core::Map::Object` (`core/include/CoreNamespace.h:386-398`):

| Cadena `type` | Entero | Enum | Forma | Atributos leídos |
|---|---|---|---|---|
| `perimeter` | 0 | `Perimeter` | polígono (≥3 vértices; no se valida el mínimo) | vértices `x`,`y` |
| `wall` | 1 | `Wall` | polígono, **exactamente 4** vértices | vértices `x`,`y` |
| `door` | 2 | `Door` | polígono, **exactamente 4** vértices | vértices `x`,`y` |
| `player` | 3 | `Player` | puntual | `x`,`y` (int), `angle` (double) |
| `obstacle` | 4 | `Obstacle` | puntual | `x`,`y`, `angle`, `subtype` (int → `Core::Obstacles::Type`) |
| `objects` | 5 | `Objects` | puntual | `x`,`y`, `angle`, `subtype` (int → `Core::Objects::Class`) |
| `miniBoss` | 6 | `MiniBoss` | puntual | `x`,`y`, `angle` (leído y **descartado**) |
| `megaBoss` | 7 | `MegaBoss` | puntual | `x`,`y`, `angle` (leído y **descartado**) |
| cualquier otra (`enemy`, `companion`, …) | −1 | — | — | ignorado (`default:` `Map.cc:313-316`) |

**Sobre los supuestos tipos numéricos `"0".."7"`.** No existe ningún `<object type="N">` en ningún mapa. Un `grep 'type="[0-7]"'` da falsos positivos porque casa con `subtype="N"`. Verificado con `grep '<object type="[0-9]'` y `grep 'type=[0-9]'` sobre los 26 mapas + `editorMap.xml`: cero resultados. Los dígitos observados son el atributo **`subtype`**, que se interpreta así:

- en `obstacle`: cast directo a `Core::Obstacles::Type` (`Map.cc:218`): `0 obs_table, 1 obs_desk, 2 obs_couch, 3 obs_sofa, 4 obs_chair, 5 obs_shelf, 6 obs_plantPot, 7 obs_mesaConSillas` (`CoreNamespace.h:57-70`). Valores observados en los mapas: 0..7, los ocho.
- en `objects`: cast a `Core::Objects::Class` (`Map.cc:233`): `0 health_pack_1, 1 health_pack_2, 2 health_pack_3, 3 ammo_pack_1, 4 ammo_pack_2, 5 ammo_pack_3, 6 sniper` (`CoreNamespace.h:79-88`). Valores observados: 0..5 (nunca 6).

Si `getType` recibiera la cadena `"0"`, devolvería −1 y el objeto se ignoraría.

### 1.3 Atributos, opcionalidad y valores observados

Vocabulario completo de atributos en los 26 mapas (conteo con `grep -o`): `x`/`y` 2317, `id` 1723, `type` 999, `angle` 586, `subtype` 548, `rank` 30, `ang` 8, más `version`/`standalone` de la declaración.

| Atributo | Dónde | Leído por `Map.cc` | Por defecto si falta | Observaciones |
|---|---|---|---|---|
| `type` | todo objeto | sí (`:133`) | error `-2` | obligatorio |
| `x`, `y` | vértices y puntuales | sí, `int` | 0 | siempre enteros en los datos |
| `id` | `vertex` | **no** | — | siempre presente pero decorativo; `map_01.xml:12-13` tiene dos `id=7` sin consecuencias |
| `angle` | puntuales | sí, `double` (`:213`, `:228`, `:272`, `:288`, `:304`) | 0.0 | grados; en `player` vale `0.0` en los 26 mapas |
| `subtype` | `obstacle`, `objects` | sí, `int` | 0 | |
| `rank` | `player` | **no** (solo se escribe, `Map.cc:507`) | — | vestigio del formato 2011 |
| `ang` | `player`/`enemy`/`companion` en `map_01..04` | **no** | — | nombre antiguo; el motor lo ignora ⇒ ángulo 0 |

Cabecera y forma sintáctica: `map_01.xml`..`map_04.xml` tienen `<?xml version="1.0">` (sin `?>`) y atributos sin comillas (`id=0`). No son XML bien formado (`xml.etree` los rechaza con «unclosed token»), **pero TinyXML los acepta**: compilando `3rdParty/tinyXML` con `-DTIXML_USE_STL` y ejecutando la lógica de `loadData`, los 26 mapas, `editorMap.xml`, `mapRuben.xml.aux` y `mapRuben.xml.wall` devuelven `loadOkay=1, status=1`. `map_01.xml` es el único con tipos desconocidos (4 `enemy` + 1 `companion`, ignorados).

### 1.4 Unidades y sistema de coordenadas

- **Unidad**: entero adimensional «unidad de juego» (u). Referencias: radio de colisión de todos los personajes `Core::Radius = 30` (`CoreNamespace.h:10`, `core/lib/Model2D.cc:21-59`), radio de explosión 150 (`CoreNamespace.h:14`), **altura de muros y puertas 90** (`core/lib/ResourceManager.cc:196-198`, `:305-414`), grosor de muro del editor 25 (300/300 muros de los mapas del editor), anchura de puerta 100 (54 puertas de 100×25 y 46 de 25×100), rejilla de colocación del editor 25 u con centro en +12.5 (`core/src/mapEditor.cc:662-663`), altura de los modelos de personaje 87–95 u (bbox de los `.3ds`, ver §5). Las texturas de muro se repiten cada 90 u en horizontal (`ResourceManager.cc:189`) y las de suelo/techo cada 200 u (`ResourceManager.cc:271-278`, `:460`, `:533`). Todo es coherente con **1 u ≈ 2 cm** (persona 1,8 m; muro 0,5 m de grosor; puerta 2 m de ancho).
- **Plano y eje vertical**: el mapa vive en el plano XY y **Z es la altura** (comentario `Graphics/lib/SceneManager.cc:666` «Y ==> N/S; Z ==> A/B; X ==> I/D»; muros extruidos de z=0 a z=90; luces en z=700; rotaciones de entidades con `addRotationZ`, `core/entities/lib/EntityManager.cc:198`).
- **Sentido de Y**: el mundo se dibuja con `addScale(1, -1, 1)` (`core/lib/GameAction.cc:779`; editor: `mapEditor.cc:399` `glScalef(op.zoom, -op.zoom, 1.0)` y `:411`). Es decir, **el XML está expresado en coordenadas de pantalla: +x a la derecha, +y hacia abajo**. Coherente con `Polygon::isClockwise` (`Math/lib/Polygon.cc:179-192`): su fórmula es Σ(x₂−x₁)(y₂+y₁) < 0, que equivale a «área shoelace > 0», o sea que devuelve `true` para polígonos antihorarios en un sistema Y-arriba = horarios vistos en pantalla con Y-abajo.
- **Orientación de los polígonos** (calculada con la fórmula legacy sobre los 27 ficheros): los 27 perímetros son «clockwise» según `isClockwise`; los 300 muros y las 100 puertas son «no clockwise». El motor normaliza ambos antes de usarlos (`Map.cc:592-595` invierte los objetos horarios para la triangulación; `core/entities/lib/Wall.cc:66` y `Door.cc:53` hacen `pol.Reverse()` para Box2D).
- **Orden de vértices de muros/puertas**: el editor los genera en `Wall::Move` (`Wall.cc:93-114`) como `a=(x−,y−), b=(x−,y+), c=(x+,y+), d=(x+,y−)`. 385 de los 400 rectángulos siguen exactamente ese patrón (`LB,LT,RT,RB`); los 15 restantes son rotaciones cíclicas del mismo (mapas antiguos hechos a mano).
- **Ángulos**: en **grados**, sentido matemático positivo en el plano (x′ = x·cosθ − y·sinθ, y′ = x·sinθ + y·cosθ): `Graphics/lib/Transformacion.cc:101-112` (`addRotationZ`, convierte con `M_PI/180`), `Math/lib/Vector2D.cc:134-141` (`Rotate`) y `Vector2D.cc:50-53` (`Vector2D(double ang)` = (cosθ, sinθ)). Por la inversión de Y en pantalla, un ángulo positivo se **ve** horario.
- **Bug del bounding box**: en `loadData` (`Map.cc:159-162`) y en `generateTriangulation` (`Map.cc:614-617`) la comprobación `if (y >= hY) hY = y;` está duplicada y `lY` nunca se actualiza: `supIzq.y` es siempre 0 (o el `y` del primer punto). No afecta a la carga, pero cualquier consumidor de `getSupIzq()` hereda el error.

---

## 2. Semántica de cada tipo de objeto

### `perimeter` — polígono del suelo y muro exterior
- Lista de vértices = **polígono cerrado** (el último enlaza con el primero). Se guarda en `perimetroV` y se crea la entidad `Floor` con `manager->addFloor(perimetroV, 0.0, blanco)` (`Map.cc:172`).
- Física: cuerpo Box2D estático neutral con la forma del polígono (`core/entities/lib/Floor.cc:61-72`).
- Gráficos (`ResourceManager::generatePerimeter`, `ResourceManager.cc:416-540`): suelo triangulado en tiras (`suelo.getTriStrip()`), textura `t_floor` = `sueloOficina.jpg` con UV = (x/200, y/200); **muro interior** de altura 90 a lo largo de cada arista con textura `t_wallFloor` = `pared.jpg` (UV u = longitud/200, v ∈ [0, 0.9]); **banda exterior de 50 u** obtenida desplazando cada arista hacia fuera (`Polygon::getNewPoint(..., false, 50)`, `:432-433`) y luego **`makeConvexHull()`** (`:439`, simplificación: en mapas no convexos el remate superior exterior es la envolvente convexa); tapa superior a z=90 con `t_wallCeil` = `techoPared.png`. No hay techo sobre el suelo (vista cenital).
- Navegación: el perímetro es la frontera del navmesh; se contrae en `charRadius` (`Map.cc:756-767`, `Expand(charRadius, true)`) y se añaden sensores extra a 0.95·radio (`Map.cc:649-671`).
- Un solo perímetro por mapa (todos los mapas cumplen); si hubiera varios, el último sobreescribe `perimetroV` acumulando puntos.

### `wall` — muro interior
- Exactamente 4 vértices; en la práctica un **rectángulo alineado a ejes** (verificado en 300/300; salvo `map_03.xml` que tiene uno no rectangular, y grosores atípicos en `mapAlex` 30–70, `mapaMolon` 96–107 y `map_0x` 10–100). Grosor estándar 25 u.
- Física: cuerpo Box2D estático neutral (`Wall.cc:63-75`).
- Gráficos (`generateWall`, `ResourceManager.cc:163-284`): 4 caras laterales z 0→90 con `pared.jpg` (u = longitud/90, v 0→1, color 0.8) + tapa superior `techoPared.png` (UV x/200, y/200).
- Navegación: se expande en `charRadius` y se fusiona con otros obstáculos solapados (`Map.cc:756-767`, `flattenGeometry` `Map.cc:876-963`).

### `door` — puerta
- Exactamente 4 vértices; siempre rectángulo 100×25 o 25×100 en los datos. Se guarda en `doorsV` y se crea con `manager->addDoor(Point(), vPAux)` (`Map.cc:261`; `vNodes` y `pf` por defecto vacíos, `core/entities/include/EntityManager.h:141`).
- Física: cuerpo estático (`Door.cc:50-62`) que se **desactiva al abrir** (`Door.cc:104`).
- Gráficos (`generateDoor`, `ResourceManager.cc:286-414`): como un muro de altura 90 pero **retraído 10 u a lo largo del eje corto** (`cortoVertical/cortoHorizontal = 10`, `:301-312`), textura lateral `t_door` = `tp3.png` (UV 0..1 sin repetición) y tapa `t_doorCeil` = `techoPuerta.png`.
- Interacción: tecla **E** con el jugador a ≤ `3·Radius` = 90 u del centroide (`core/lib/HIDControl.cc:244-256`) → `Door::Switch()` (`Door.cc:94-111`): fundido de 1000 ms (`addFadeOut/addFadeIn`), activa/desactiva el cuerpo y conmuta el estado `enabled` de los nodos de navegación asociados (`Door.cc:139-146`, vía `Pathfinder::getDualGraph()->changeNodeState`). Los nodos «dentro» de la puerta los calcula la IA en `ia->initMap(mapa, puertas)` (`GameAction.cc:181`); para el navmesh la puerta se añade como sensor expandido en `charRadius` (`Map.cc:1041-1053`).
- Las puertas **no** se restan de los muros: en los datos ocupan huecos ya dejados entre dos muros.

### `player` — spawn del jugador
- Puntual: `x`,`y` posición del centro; `angle` en grados = **heading inicial** `Vector2D(angle) = (cosθ, sinθ)` (`core/entities/lib/Player.cc:70`; `Vector2D.cc:50-53`); 0 ⇒ mira hacia +x. En los 26 mapas vale `0.0`.
- Crea el `Player` del tipo elegido en el menú (`playerType`), no del mapa (`EntityManager.cc:175-186`).
- Los **3 compañeros** no están en el mapa: se generan en el mismo punto con offsets de formación (−4R,−2R), (+4R,−2R), (0,−4R) más ruido (`Player.cc:35-45`; `GameAction.cc:210-238`).
- Radio de colisión: círculo de radio 30 (`Model2D.cc:21-59`).

### `obstacle` — mobiliario con colisión
- Puntual: `x`,`y` = centro; `angle` grados; `subtype` = `Core::Obstacles::Type` (tabla). Transformación gráfica: traslación al centro y `addRotationZ(angle)` (`EntityManager.cc:196-198`). Física: cuerpo estático con bandera obstáculo (`core/entities/lib/Obstacle.cc:73-98`, `setObstacle()`), forma = huella 2D de `Model2D(Core::Obstacles::Type)` (`Model2D.cc:81-160`). Para el navmesh se rota la huella por `angle`, se traslada al centro y se trata como un muro (`Map.cc:567-587`).

| `subtype` | Enum | Modelo / textura (`ResourceManager.cc:783-821`) | Huella de colisión (u, respecto al centro; `Model2D.cc`) | Bbox visual del `.3ds` (u) |
|---|---|---|---|---|
| 0 | `obs_table` | `mesa.3ds` / `mesa.png` | x[−20,22] y[−45,45] (`:90-96`) | x[−24,25] y[−47,49] z[−1,39] |
| 1 | `obs_desk` | `desk.3ds` / `desk.png` | x[−65,65] y[−55,55] (`:98-104`) | x[−78,84] y[−44,63] z[0,77] |
| 2 | `obs_couch` | `sillon.3ds` / `sAzul.png` | x[−22,22] y[−20,20] (`:114-120`) | x[−23,23] y[−22,23] z[0,43] |
| 3 | `obs_sofa` | `sofa.3ds` / `sAzul.png` | x[−22,22] y[−60,60] (`:146-152`) | x[−29,24] y[−79,71] z[0,48] |
| 4 | `obs_chair` | `sillaEspera.3ds` / `silla.png` | x[−20,20] y[−20,20] (`:122-128`) | x[−23,23] y[−24,24] z[−1,52] |
| 5 | `obs_shelf` | `estanteria.3ds` / `estanteria.png` | x[−55,45] y[−25,18] (`:106-112`) | x[−48,48] y[−13,15] z[0,105] |
| 6 | `obs_plantPot` | `plant.3ds` / `plant.png` | x[−10,10] y[−10,10] (`:138-144`) | x[−19,20] y[−20,21] z[0,50] |
| 7 | `obs_mesaConSillas` | `mesaSillas.3ds` / `mesaSillas.png` | x[−50,50] y[−50,50] (`:130-136`) | x[−55,51] y[−66,66] z[0,53] |
| otro | — | display list `subtype+1000` inexistente | x[−32,32] y[−70,70] (`:153-158`) | — |

### `objects` — recompensas (pickups)
- Puntual: `x`,`y`, `angle`, `subtype` = `Core::Objects::Class`. Entidad `Object` de tipo `obj_dynamics` (`EntityManager.cc:237-264`), **sensor** Box2D (`core/entities/lib/Object.cc:111-125`, `setSensor(true)`) con huella 64×64 u para todas las clases (`Model2D.cc:164-220`). Se le añade una **rotación infinita de 10 000 ms por vuelta** (`EntityManager.cc:261`). No participa en el navmesh (solo se recogen entidades `e_obstacle`, `Map.cc:567`).
- Efecto al recoger (`Object.cc:43-74`): 0 → +20 HP, 1 → +50 HP, 2 → +100 HP, 3 → +20 munición, 4 → +50, 5 → +100, 6 (`sniper`) → imprime «Próximamente» (no implementado). Modelos: `hpack.3ds`/`hpack.png` para 0–2 y `ammo_pack.3ds`/`ammo_pack.png` para 3–5 (`ResourceManager.cc:823-846`).

### `miniBoss` / `megaBoss` — spawn de jefes
- Puntual; solo se conserva la posición en `Map::miniBoss` / `Map::megaBoss` (`Map.cc:292`, `:308`; `core/include/Map.h:178-179`). `angle` se lee y se pierde.
- Uso (`GameAction.cc:203-207`): si la planta actual es < 8 se instancia **un** `e_miniboss` en `mapa->miniBoss`; si es 8, **un** `e_megaboss` en `mapa->megaBoss`. Ángulo 0. Si el mapa no trae el elemento, el `Point` por defecto es (0,0) (`Math/include/Point.h:29-33`) y el jefe aparece en el origen sin aviso (así ocurre implícitamente en `finalMap.xml` para `miniBoss` y en los mapas P/M/G para `megaBoss`; explícitamente `mapG1/G4/M3/M4/editorMap` declaran `miniBoss` en (0,0)).

### Tipos que **no** están en el mapa
- **Enemigos normales**: se generan proceduralmente en función del área navegable y la dificultad (`GameAction.cc:199-201`, `opti->CargarFuncionObjetivo(mapa->getArea(), dif); CalcularEnemigos(); CargarEnemigos(...)`), fuera de este ámbito. El conversor no debe esperar spawns de enemigos en el XML.
- **`enemy` / `companion`** (solo `map_01.xml:76-80`, formato de 2011 con `ang` y `rank`): desconocidos para `getType`; el arnés TinyXML confirma que se ignoran.

---

## 3. Formato del NavGraph (`.nav`)

### 3.1 Fichero `editorMap.xml.nav`
125 líneas, 3565 bytes. Estructura literal:

```xml
<?xml version="1.0" ?>
<navgraph>
    <node id="0" x="72" y="-192" enabled="1">
        <adyacent id="0" />
        <adyacent id="10" />
        ...
    </node>
    ...
</navgraph>
```

Estadísticas (python): 22 nodos (`id` 0..21), 78 entradas de adyacencia, `enabled="1"` en todos. **Todos** los nodos tienen `<adyacent id="0" />` como primera entrada, el nodo 0 se lista a sí mismo, y solo 17 pares de aristas son simétricos. Las coordenadas ocupan x∈[−144,286], y∈[−192,123]: un área de ~430×315 u, incompatible con el `editorMap.xml` actual (bbox x[−603,1323] y[−971,2594]) → el `.nav` es un residuo de otro mapa.

### 3.2 Escritura — `NavGraph::writeFile` (`AI/lib/NavGraph.cc:282-314`)
Escribe `<navgraph>` y por nodo `<node id x y enabled>` (`enabled` como `int`) y `<adyacent id>` por cada vecino **a partir del segundo** (`:305`: `for(iIter = (*iter).getAdyacence().begin() + 1; iIter < (*iter).getAdyacence().end(); ...)`). Como `ASNode::getAdyacence()` devuelve el vector **por valor** (`AI/lib/ASNode.cc:38-40`), `begin()+1` y `end()` pertenecen a **dos copias temporales distintas**: comportamiento indefinido. `NavGraph::addEdge` rechaza autoaristas (`NavGraph.cc:108`, `if (ori!=dest)`) y siempre añade la arista en ambos sentidos (`:121-122`), así que el «id 0» sistemático y la autoarista del nodo 0 del fichero no pueden proceder de un grafo bien formado: son compatibles con esa UB.

### 3.3 Lectura — `NavGraph::loadFile` (`NavGraph.cc:316-350`)
Recorre los hijos del raíz; lee `x`, `y`, `id` (`:331-333`); **ignora `enabled`**. Para las adyacencias hace `nodo->FirstChildElement()->FirstChildElement()` (`:338`): el primer hijo del primer `<adyacent>`, que no tiene hijos → `NULL` → **no se carga ninguna arista**. Si un nodo no tuviera ningún `<adyacent>`, `FirstChildElement()` sería `NULL` y la segunda llamada desreferenciaría un puntero nulo. Es decir, el lector es incompatible con lo que produce el escritor.

### 3.4 Uso real
Nadie llama a `loadFile`; la única llamada a `writeFile` del grafo está comentada (`core/src/mapEditor.cc:1037`). En juego, el grafo se reconstruye siempre a partir de la triangulación de Delaunay del mapa (`AI/lib/Pathfinder.cc:99`, `Pathfinder::makeDualGraph`, `:103-170`: un nodo por incentro de triángulo + nodos en las esquinas, aristas entre triángulos vecinos o a lo largo de aristas frontera). **Conclusión**: el `.nav` es un artefacto muerto; el conversor debe ignorarlo y horneará su propio navmesh.

Ficheros hermanos: `testFiles/maps/mapRuben.xml.aux` (18 vértices de perímetro, 8 muros, player) y `mapRuben.xml.wall` (4 vértices, 6 muros, player) son **mapas completos en el mismo formato** (cargan con `status=1`) sin relación con `mapRuben.xml` salvo el nombre; son copias de trabajo del editor.

---

## 4. Inventario de los 26 mapas

Calculado con `python3` (fórmula del área de Gauss/shoelace sobre el perímetro; orientación con la fórmula legacy de `Polygon::isClockwise`; conteos por `type`). m² con 1 u = 2 cm (0.0004 m²/u²). Todos los ficheros cargan en TinyXML con `status=1`.

| Fichero | Vértices perímetro | Área (u²) | Área (m²) | Walls | Doors | Obstacles | Objects | Player | miniBoss | megaBoss | Notas |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `finalMap.xml` | 8 | 4.161.050 | 1.664 | 27 | 14 | 0 | 16 | sí (85,−40) | no | **sí** (−169,−915) | Planta 8 (`GameAction.cc:837-839`). Único mapa con `megaBoss`. Sin obstáculos. Objects: hp3×7, ammo2×5, ammo3×4. bbox x[−1208,1172] y[−1144,922]. |
| `gallardoMap.xml` | 8 | 1.833.729 | 734 | 18 | 8 | 29 | 8 | sí (0,42) | no | no | Idéntico a `map4.xml` salvo: sin `miniBoss` y 6 ángulos de obstáculo distintos (`diff`). Los 8 subtipos de obstáculo. No referenciado por el juego. |
| `map1.xml` | 6 | 4.896.364 | 1.959 | 2 | 1 | 5 | 0 | sí (0,0) | no | no | Mapa de prueba: 5 mesas (subtype 0, una con angle −22). |
| `map4.xml` | 8 | 1.833.729 | 734 | 18 | 8 | 29 | 8 | sí (0,42) | sí (810,317) | no | Variante de `gallardoMap` con `miniBoss`. No referenciado. |
| `map5.xml` | 4 | 4.258.026 | 1.703 | 14 | 3 | 6 | 7 | sí (−434,−888) | sí (−450,910) | no | Prueba; un obstáculo de cada subtipo salvo 0 y 6. |
| `map6.xml` | 4 | 721.560 | 289 | 13 | 5 | 0 | 0 | sí (144,19) | sí (407,−287) | no | Prueba sin mobiliario. |
| `mapAlex.xml` | 9 | 2.909.372 | 1.164 | 32 | 0 | 0 | 0 | sí (273,155) | no | no | Muros a mano, grosor 30–70. Sin puertas ni objetos. |
| `mapG1.xml` | 8 | 5.590.993 | 2.236 | 18 | 7 | 47 | 8 | sí (1457,2028) | sí (0,0) | no | Zonas 3–6, plantas 1/5 (`GameAction.cc:875-876`, `:903-905`). Mapa más poblado (47 obstáculos, 18 estanterías). |
| `mapG2.xml` | 6 | 4.890.093 | 1.956 | 15 | 6 | 45 | 6 | sí (1739,1044) | sí (1250,−500) | no | Zonas 3–6, plantas 2/6. |
| `mapG3.xml` | 8 | 2.513.563 | 1.005 | 12 | 2 | 27 | 8 | sí (0,0) | sí (2700,200) | no | Zonas 3–6, plantas 3/7. Pasillo largo (x hasta 3379). Ángulos 179/181 (rotación a mano). |
| `mapG4.xml` | 8 | 6.598.817 | 2.640 | 16 | 7 | 31 | 5 | sí (2221,1888) | sí (0,0) | no | Zonas 5–6 planta 4 y **mapa por defecto** (`core/lib/Aplication.cc:37`). Mayor área. |
| `mapM1.xml` | 19 | 1.724.305 | 690 | 11 | 6 | 38 | 8 | sí (844,−587) | sí (−50,−100) | no | Zonas 3–4, plantas 1 **y 2** (`GameAction.cc:872-880`). Perímetro más complejo (19 vértices). Ángulos libres (−19…58). |
| `mapM2.xml` | 12 | 3.734.150 | 1.494 | 20 | 8 | 30 | 11 | sí (499,105) | sí (−50,−100) | no | **Nunca seleccionado por `selectionMap`** (la planta 2 de zonas 3–4 usa `mapM1`). Ángulo −269 en un obstáculo. |
| `mapM3.xml` | 8 | 3.975.065 | 1.590 | 9 | 5 | 39 | 6 | sí (1209,1172) | sí (0,0) | no | Zonas 3–4 planta 7. 14 `mesaConSillas`. |
| `mapM4.xml` | 8 | 5.353.660 | 2.141 | 15 | 5 | 37 | 5 | sí (1174,2522) | sí (0,0) | no | Zonas 3–4 planta 4. `editorMap.xml` es una edición posterior de este mapa (ver abajo). |
| `mapP1.xml` | 8 | 629.907 | 252 | 6 | 3 | 13 | 2 | sí (0,0) | sí (−149,−417) | no | Zonas 1–2, plantas 1/5 (`GameAction.cc:850-853`). |
| `mapP2.xml` | 6 | 1.008.040 | 403 | 5 | 1 | 12 | 2 | sí (179,−175) | sí (−120,0) | no | Zonas 1–2, plantas 2/6. |
| `mapP3.xml` | 14 | 1.188.356 | 475 | 6 | 3 | 20 | 4 | sí (−27,127) | sí (500,−800) | no | Zonas 1–2, plantas 3/7. |
| `mapP4.xml` | 8 | 1.972.529 | 789 | 5 | 1 | 24 | 5 | sí (−223,70) | sí (800,−484) | no | Zonas 1–2, planta 4. |
| `mapRuben.xml` | 7 | 272.964 | 109 | 2 | 1 | 3 | 4 | sí (0,0) | no | no | Mapa pequeño de prueba; una puerta entre dos muros que separa dos salas. |
| `map_01.xml` | 20 | 172.500 | 69 | 6 | 0 | 0 | 0 | sí (150,150) `ang=45` | no | no | Formato 2011: declaración sin `?>`, `id` sin comillas, `ang`, `rank`; 4 `enemy` + 1 `companion` ignorados; `id=7` duplicado. Muros 10–35 de grosor. |
| `map_02.xml` | 4 | 240.000 | 96 | 5 | 0 | 0 | 0 | sí (150,300) `ang=45` | no | no | Formato 2011. Grosores 50–100. |
| `map_03.xml` | 4 | 240.000 | 96 | 2 | 0 | 0 | 0 | **no** | no | no | Formato 2011. Sin `player`. Un muro **no rectangular**. |
| `map_04.xml` | 4 | 1.000.000 | 400 | 4 | 0 | 0 | 0 | sí (150,300) `ang=45` | no | no | Formato 2011. Cuadrado 1000×1000. |
| `mapaMolon.xml` | 4 | 245.021 | 98 | 4 | 0 | 0 | 0 | sí (440,368) | no | no | Muros 96–107 de grosor. |
| `pruebasMov.xml` | 4 | 1.263.312 | 505 | 0 | 0 | 0 | 0 | sí (340,208) | no | no | Solo perímetro + player (pruebas de movimiento). |
| *(`editorMap.xml`, raíz)* | 9 | 4.790.390 | 1.916 | 15 | 6 | 37 | 5 | sí (1174,2522) | sí (0,0) | no | Cargado en planta −1 (modo editor, `GameAction.cc:829-836`). `diff` con `mapM4.xml`: perímetro con un vértice más, una puerta adicional en (175..275, 2300..2325) y la maceta de (−546,−919) con angle 16 en vez de −16. |

Totales (26 mapas + editorMap): 300 muros, 100 puertas, 472 obstáculos, 118 recompensas. Mapas realmente usados por el juego (`GameAction::selectionMap`, `GameAction.cc:822-915`): `mapP1..P4`, `mapM1`, `mapM3`, `mapM4`, `mapG1..G4`, `finalMap`, `editorMap`; el resto son pruebas o borradores. Recuento de obstáculos por subtipo en todo el corpus: shelf 123, mesaConSillas 87, desk 51, chair 48, plantPot 45, table 44, sofa 31, couch 6.

---

## 5. Inventario de assets

`RESOURCESROOT` apunta a `Graphics/Resources/` (`CMakeLists.txt:101`). Los recursos se cargan en `ResourceManager::loadModels` (`core/lib/ResourceManager.cc:547-860`), `loadTextures` (`:862-893`), `getFont` (`:910-955`) y los shaders en `:53-70`.

### 5.1 Modelos 3DS (`Graphics/Resources/modelos/`, 77 ficheros, 4,3 MB)
Todos tienen magic 3DS `0x4D4D` y se cargan con `Load3DS` (`Graphics/lib/load3ds.c`, autor Alexander Zaprjagaev, «modified by Chutaos Team», **sin texto de licencia**), que lee x,y,z tal cual (`load3ds.c:179-181`, sin intercambio de ejes). El camino de dibujo usado (`Model::createDisplayList()`, `Graphics/lib/Model.cc:176-236`) no aplica escala ni rotación, luego **los `.3ds` están en unidades de juego y con Z arriba**, igual que el mapa. (El otro camino, `createDisplayList(int)` con `glScaled(20,20,20)`, `Model.cc:258-261`, no tiene llamadas.)

**Series de animación de personajes** (`c1..c5`, `s1..s5`, `h1..h5`, `d1..d5`, `p1..p5`, `sn1..sn5`, `e1..e5`, `sp1..sp5`, `m1..m5`): cada serie son los **5 fotogramas del ciclo de andar** de un personaje. La display list se indexa como `Core::Entities::Type*5 + fotograma` (`ResourceManager.cc:566-777`; `Player.cc:21` `idDisplay = t*5`) y `EntityManager::Update` avanza el fotograma cada 200 ms mientras la entidad se mueve, vuelve al 0 al parar y reproduce el paso en los fotogramas 1 y 3 (`EntityManager.cc:657-671`). Los cinco ficheros de cada serie tienen md5 distintos (posturas distintas) y mismo número de vértices; cada uno son 2 mallas exportadas de Blender («Mesh», «Mesh.00x»), material «None». Las letras son las iniciales de las **clases de Team Fortress 2** con cuya textura `_flat.tga` se pintan:

| Serie | Entidad (`CoreNamespace.h:31-55`) | Textura (`ResourceManager.cc`) | Vértices/caras por frame | Altura (u) |
|---|---|---|---|---|
| `c1..c5` | `e_captain` (1) | `soldier_flat.tga` (`:709`) | 509 / 522 | 93 |
| `s1..s5` | `e_tecnic` (2) | `scout_flat.tga` (`:684`) | 541 / 550 | 91 |
| `h1..h5` | `e_especialist` (3) | `heavy_flat.tga` (`:658`) | 505 / 538 | 89 |
| `d1..d5` | `e_explosive` (4) | `demo_flat.tga` (`:634`) | 622 / 584 | 91 |
| `p1..p5` | `e_enemy1` (5) | `pyro_flat.tga` (`:566`) | 630 / 584 | 89 |
| `sn1..sn5` | `e_enemy2` (6) | `sniper_flat.tga` (`:589`) | 525 / 532 | 89 |
| `e1..e5` | `e_enemy3` (7) | `engi_flat.tga` (`:612`) | 508 / 544 | 88 |
| `sp1..sp5` | `e_miniboss` (8) | `spy_flat.tga` (`:736`) | 452 / 487 | 93 |
| `m1..m5` | `e_megaboss` (9) | `medic_flat.tga` (`:759`) | 547 / 568 (m5: 713/716) | 95 |

**Mobiliario (obstáculos)**: `mesa.3ds` (14 719 v, 1 malla «Parallele7»), `desk.3ds` (192 v, materiales alemanes GRAU/SCHWARZ/WEISS, mapa `desk.png`), `sillon.3ds` (8 839 v), `sofa.3ds` (15 688 v, 16 mallas, materiales italianos «Legno_chiaro/Pelle_nera»), `plant.3ds` (1 949 v, mapa `plant.png`), `estanteria.3ds` (268 v; **incluye objetos `Light01`/`Camera01`**), `sillaEspera.3ds` (2 016 v, mapa `silla.png`), `mesaSillas.3ds` (1 131 v; también `Light01`/`Camera01`). Los nombres de material (alemán, italiano, «G_tbl01», «VIFS01», «3D_Object») delatan que proceden de bibliotecas/repositorios de modelos de terceros distintos; procedencia y licencia desconocidas.

**Pickups**: `hpack.3ds` (5 737 v, 4 mallas, z 6–21) y `ammo_pack.3ds` (706 v, «Object12_hol», z 9–20).

**No referenciados por el código** (candidatos a borrar): `Captain.3ds`, `Player.3ds` (materiales `ct_urban.tga`/`ct_urban_gla` → modelo **CT Urban de Counter-Strike**), `Enemy1/2/3.3ds` (los tres **idénticos**, md5 `047230a67b`, materiales `t_leet_tga` → **Leet de Counter-Strike**), `Especial.3ds`, `Explodemo.3ds`, `Tecnic.3ds`, `human.3ds` (metaballs de Blender), `cuadra.3ds`, `enemigo.3ds` (icosfera), `player.3ds` (cubo), `simba3ds.3DS` (mallas `DrawCall_0..2` con materiales `.DDS` → **volcado de un juego con un «ripper» 3D**), `c.3ds`/`e.3ds`/`s.3ds`/`t.3ds` (escena de prueba de Blender: Monkey, Torus, Text…; `c.3ds` es el modelo por defecto de `Graphics/src/modelLoader.cc:34`), `cube.3ds`/`bola.3ds` (pruebas `Graphics/src/textureLoader.cc:60-61`).

### 5.2 Texturas (`Graphics/Resources/texturas/`, 51 ficheros, 19 MB)
Cargadas con `sf::Image::LoadFromFile` (`Graphics/lib/Textura.cc:78-79`).

| Uso | Ficheros | Dónde |
|---|---|---|
| Escenario (`Graphics::Texturas`, `Graphics/include/GraphicsNamespace.h:12-23`) | `pared.jpg` 500² (`t_wall` y `t_wallFloor`), `sueloOficina.jpg` 256² (`t_floor`), `tp3.png` 256² (`t_door`), `techoPared.png` 256² (`t_wallCeil`), `techoPuerta.png` 256² (`t_doorCeil`), `exploMala.png` 512² (`t_explosion`, también `core/entities/lib/EventControl.cc:16,28`) | `ResourceManager.cc:866-892` |
| Personajes | `pyro_flat`, `sniper_flat`, `engi_flat`, `demo_flat`, `heavy_flat`, `scout_flat`, `soldier_flat`, `medic_flat` (128×128, 24 bpp, TGA sin comprimir) y `spy_flat` (64×128) | `ResourceManager.cc:566-759` |
| Mobiliario | `mesa.png`, `desk.png`, `sAzul.png` (sillón y sofá), `plant.png`, `estanteria.png`, `silla.png`, `mesaSillas.png` — todas 512² y **exactamente 1 050 873 bytes** (PNG sin compresión) | `ResourceManager.cc:784-819` |
| Pickups | `hpack.png` 512², `ammo_pack.png` 512² | `ResourceManager.cc:825,838` |
| HUD (64²) | `clock`, `skull`, `points`, `vida`, `ammo`, `null`, `none`, `vida20/50/100`, `ammo20/50/100`, `win` | `Graphics/lib/SceneManager.cc:719-732`, `EntityManager.cc:1022-1042`, `core/lib/GameMenu.cc:791` |
| Menús / otros | `fondo.jpg` 1916×938 (`GameMenu.cc:119`), `van.jpg` 500×360 (`GameAction.cc:244`), `blood.png` 25² (solo en código comentado, `core/lib/ParticleManager.cc:219`) | |
| **Sin referencias** | `enemy.tga` y `player.tga` (1024², 32 bpp, 4 MB cada una; encajan con los modelos CS), `cabeza.jpg`, `cuerpo.jpg`, `mesa.jpg`, `paredOficina.jpg`, `puerta.jpg`, `suelo.jpg`, `sGranate.png` | |

**Riesgo legal**: las nueve `*_flat.tga` llevan los nombres de las clases de **Team Fortress 2** (Valve) y visten unos modelos low-poly cuyas series también se nombran por esas clases; con toda probabilidad son texturas «flat»/papercraft derivadas de los assets de TF2. No son redistribuibles. Igualmente `testFiles/img/*.jpg` (retratos de menú `captain`, `especial`, `explosive`, `tecnic`, `mini-*`, `molamos`) tienen procedencia desconocida.

### 5.3 Shaders (`Graphics/Resources/shaders/`, GLSL 1.x con estado fijo)
Se cargan los tres pares en `ResourceManager.cc:56,63,70` (los tres sobre la misma variable `cellShad`, de modo que el último con éxito, `Pruebas`, es el que queda). Todos usan variables obsoletas (`gl_LightSource`, `gl_FrontMaterial`, `ftransform`, `gl_TexCoord`), así que **no son portables a Godot 4** sin reescritura:

- `CellShading.vert` (23 líneas): pasa UV, normal en espacio ojo, dirección y half-vector de **la luz 2**, y difusa/ambiente = material × luz 2 (+ ambiente global).
- `CellShading.frag` (59 líneas): **toon shading** de 4 bandas sobre N·L: >0.95 → 1.0, >0.7 → 0.7, >0.3 → 0.3, resto 0.1 (`:20-34`); color = (ambiente + difusa·factor) × texel, alfa = alfa material × alfa texel.
- `Phong.vert/.frag`: Phong clásico con `NUM_LIGHTS 3`: por luz, Lambert + especular `pow(max(R·E,0), shininess)`; resultado × texel.
- `Pruebas.vert/.frag`: copia de Phong con `NUM_LIGHTS 2` y la multiplicación por textura **comentada** (`Pruebas.frag:40-41` devuelve `final_color`), es decir, un Phong sin textura de pruebas.

Iluminación de la escena: 3 luces puntuales (ambiente 0.1, difusa 0.7, especular 0.3) en (0,0,700), (0,0,700) y (0,0,100) (`SceneManager.cc:661-668`); la luz 2 sigue al jugador a (x, y−400, 700) (`GameAction.cc:783-787`). Cámara perspectiva de 45° (`SceneManager.cc:653`), inclinación reiniciable a −30° y «zoom» −680 u (`HIDControl.cc:220-222`, `GameAction.cc:271`).

### 5.4 Audio (`testFiles/sound/`, 26 `.ogg` Vorbis, 14,8 MB)
Etiquetas Vorbis extraídas con python:

| Fichero | Uso (`sound/lib/AudioControl.cc`) | Etiquetas / procedencia |
|---|---|---|
| `LegendsOfLiberty.ogg` (5,5 MB, estéreo 44,1 kHz) | música de **menú** (`:144`) | **ARTIST=The Prodigy, TITLE=Invaders Must Die, ALBUM=Invaders Must Die (Ltd. Deluxe Edition), 2009** → música comercial con copyright |
| `andorga.ogg` (6,0 MB) | música de **acción** (`:147`) | **The Prodigy — Warriors Dance (2009)** → ídem |
| `credits.ogg` (0,5 MB, mono) | créditos (`:150`) | TITLE=Stracomter3, ARTIST=Chutaos Team → propia |
| `LegendsOfLibertyVerdad.ogg`, `andorgaVerdad.ogg` | **no referenciados** | sin etiquetas; versiones más cortas («Verdad» = «de verdad»), probablemente sustitutos nunca conectados |
| `acdc.ogg` (48 kHz, 64 kbps) | solo tests `sound/src/testAbstraction.cc:64`, `testBlank.cc:59` | sin etiquetas; el nombre sugiere AC/DC → copyright |
| `go.ogg` | tests (`testSpacialization.cc:39`, `AI/src/testNiceGrafic.cc:64`) | sin etiquetas |
| `sexo.ogg` | no referenciado | ARTIST=Ruben (broma del equipo) |
| `personal/{pistol,explosion,machine,knife,step,dead,ouch}.ogg` | **set de efectos por defecto** (`:48`, `:57-63`) | mayoría ARTIST=ruben (propios); `step.ogg` ARTIST=«SoundJay.com Sound Effects and Chutaos team» → licencia SoundJay (verificar términos de redistribución); `explosion.ogg` TITLE=grenade (mismo que `3rd/explosion.ogg`, tercero desconocido) |
| `personal/{ouchOld,pistolOld,stepAux}.ogg` | no referenciados | versiones antiguas |
| `joke/*.ogg` | set alternativo si existe `testFiles/sound/joke.txt` (`:47-51`; el fichero no está en el repo) | voces de broma, ARTIST=ruben |
| `3rd/explosion.ogg` | no referenciado | TITLE=grenade; la carpeta indica «third party» |

### 5.5 Fuentes (`Graphics/Resources/fuentes/`, 8 TTF, 1,5 MB)
Renderizadas con FTGL (`ResourceManager::getFont`, `:910-955`). Datos de la tabla `name` de cada TTF:

| Fichero | Familia real | Autor / licencia (tabla `name`) | Uso |
|---|---|---|---|
| `Monospace.ttf` | DejaVu Sans Mono 2.33 | Bitstream Vera / DejaVu (libre) | `Graphics::Font::Monospace` |
| `Sans.ttf` | DejaVu LGC Sans 2.33 | Bitstream Vera + Arev (libre) | `SansSerif` |
| `Serif.ttf` | DejaVu Serif 2.33 | Bitstream Vera (libre) | `Serif` |
| `BebasNeue.ttf` | Bebas Neue 1.101 | Ryoichi Tsunekawa / Dharma Type (gratuita; verificar versión de licencia) | `BebasNeue` |
| `Coolvetica.ttf` | Coolvetica Rg 4.101 | Ray Larabie 1999-2009, «see attached license agreement» (freeware Typodermic; verificar EULA) | `Coolvetica` |
| `Absender.ttf` | absender 1.000 | © Nick Polifroni 2011, «All rights reserved», sin licencia embebida → **verificar** | `Absender` |
| `TF2.ttf` | «TF2» (vendor `pyrs`) | sin copyright; fuente de **Team Fortress 2**/derivada → **no redistribuible** | `Font::tf2`, usada en todas las etiquetas (`core/lib/TLabel.cc:36,69,101`) |
| `tf2build.ttf` | «TF2 Build» 1.000 | fuente oficial de TF2 (Valve) → **no redistribuible** | `Font::tf2Build` |

### 5.6 Otros datos
`testFiles/features/f1.xml` (estadísticas de personajes, leído por `CharacterFeature.cc:59-64` con el mismo patrón `Attribute("type")`; mismas irregularidades de cabecera), `testFiles/entities.xml` (versión antigua), `testFiles/fsm/fsm_0{1..4}.txt` (máquinas de estados de la IA, fuera de ámbito).

---

## 6. Especificación del conversor a Godot 4

Objetivo: `convert_map.py <mapa.xml> <salida.tscn>` (Python 3, sin dependencias) que produce una escena 3D de Godot 4.x reproducible y verificable. Se describe primero el modelo de conversión y después el algoritmo.

### 6.1 Escala
`S = 0.02 m/u` (1 u = 2 cm). Deriva de: modelos de personaje 87–95 u ≈ 1,8 m; radio de colisión 30 u → 0,6 m de diámetro; muros de 25 u → 0,5 m; puertas de 100 u → 2 m; altura de muro 90 u → 1,8 m; rejilla del editor 25 u → 0,5 m; velocidades 130–180 u/s → 2,6–3,6 m/s; explosión 150 u → 3 m. Constantes derivadas: `H_WALL = 90·S = 1.8`, `R_AGENT = 30·S = 0.6`, `BAND_PERIM = 50·S = 1.0`, `DOOR_INSET = 10·S = 0.2`, `PICKUP_HALF = 32·S = 0.64`, `DOOR_USE_RADIUS = 90·S = 1.8`.

### 6.2 Mapeo de coordenadas y ángulos
- `godot(x, y) = Vector3(x·S, 0, y·S)`: el plano XY legacy pasa al plano XZ de Godot y la altura legacy (z) pasa a Y. Con una `Camera3D` cenital estándar (`rotation_degrees.x = -90`, mirando −Y, «arriba» de pantalla = −Z) la imagen coincide con la del legacy (+x derecha, +y abajo), sin necesidad de invertir nada.
- Ángulo legacy θ (grados, `x′ = x cosθ − y sinθ; y′ = x sinθ + y cosθ`) ⇒ `rotation.y = -deg_to_rad(θ)`. Comprobación: la rotación de Godot alrededor de +Y por φ da `x′ = x cosφ + z sinφ; z′ = −x sinφ + z cosφ`; con φ = −θ y z ≡ y se recupera la fórmula legacy.
- Heading del jugador `(cosθ, sinθ)` ⇒ dirección de mirada `Vector3(cosθ, 0, sinθ)`.
- Orientación de polígonos: los perímetros vistos desde arriba en Godot aparecen horarios y los muros antihorarios (igual que en pantalla legacy). Para cada triángulo generado se calcula la normal por producto vectorial y se invierte el orden de índices si `normal.y < 0` para que el suelo mire hacia +Y.

### 6.3 Lectura del XML (tolerante, equivalente a TinyXML)
1. Tokenizar con un lector tolerante: lxml `recover=True`, o el enfoque regex del script de inventario (`<object …>…</object>` / `<vertex …/>`), porque `xml.etree` rechaza `map_01..04`. Alternativa: normalizar esos 4 ficheros (añadir `?>` y comillas) y verificar con el arnés TinyXML que siguen dando `status=1`.
2. Reproducir la semántica de `loadData`: iterar hijos del raíz en orden; `type` ausente ⇒ abortar con el mismo código −2; tipo desconocido ⇒ **warning y omitir**; `wall`/`door` con ≠4 vértices ⇒ error −1 (abortar, como el legacy); atributos ausentes ⇒ `angle=0`, `subtype=0`, `x=y=0`; `id`, `rank`, `ang` ⇒ ignorar (avisar si aparece `ang` para que el autor lo migre a `angle`).
3. Validaciones adicionales (warnings, no errores): más de un perímetro; sin `player`; sin `miniBoss` (el legacy usaría (0,0)); `subtype` fuera de rango (0–7 obstáculos, 0–6 objetos); obstáculo cuya huella rotada intersecta un muro o sale del perímetro (`Geometry2D.intersect_polygons` o shapely opcional).
4. Calcular y guardar como metadatos del nodo raíz: `source_xml`, `scale`, `bbox_legacy` (min/max reales, sin el bug de `lY`), `area_legacy` (shoelace), conteos por tipo. Sirven para la verificación (§6.7).

### 6.4 Geometría y colisión

**Árbol de la escena** (`.tscn` en texto: `[gd_scene]`, `[ext_resource]` para materiales/escenas compartidas, `[sub_resource]` para mallas/formas, `[node]` con `transform = Transform3D(...)`):

```
Map (Node3D)                          metadata: source_xml, scale, bbox_legacy, area_legacy
├─ Floor (StaticBody3D, layer=static) MeshInstance3D(ArrayMesh) + CollisionShape3D(ConcavePolygonShape3D)
├─ Perimeter (Node3D)                 PerimEdge_i (StaticBody3D): BoxShape3D + MeshInstance3D(BoxMesh)
├─ Walls (Node3D)                     Wall_i (StaticBody3D): BoxShape3D + MeshInstance3D
├─ Doors (Node3D)                     Door_i (instancia de res://scenes/Door.tscn)
├─ Obstacles (Node3D)                 Obstacle_i (instancia de res://props/<obs_name>.tscn)
├─ Pickups (Node3D)                   Pickup_i (instancia de res://scenes/Pickup.tscn, export pickup_class)
├─ Spawns (Node3D)                    PlayerSpawn, MiniBossSpawn, MegaBossSpawn (Marker3D)
└─ NavigationRegion3D                 NavigationMesh horneado (§6.6)
```

**Suelo (`perimeter`)**: triangular el polígono 2D en unidades legacy (`Geometry2D.triangulate_polygon` desde un `@tool`, o `mapbox_earcut`/ear-clipping propio en Python). `ArrayMesh` con vértices `(x·S, 0, y·S)`, normal +Y y UV `(x/200, y/200)` (reproduce el tileado legacy: 1 repetición cada 4 m). Material `StandardMaterial3D` con `sueloOficina.jpg` (o su sustituto). Colisión: `ConcavePolygonShape3D` con los mismos triángulos (o un `BoxShape3D` fino bajo el bbox si solo se necesita para el `CharacterBody3D`).

**Banda exterior del perímetro**: para cada arista `(p_i, p_{i+1})` un `StaticBody3D` con `BoxShape3D` de tamaño `(|p_{i+1}−p_i|·S + BAND_PERIM, H_WALL, BAND_PERIM)`, centrado en el punto medio desplazado `BAND_PERIM/2` hacia el **exterior** (normal exterior = la que se aleja del centroide del polígono, o `perpCW` de la arista dado que los perímetros son horarios en pantalla) y elevado `H_WALL/2`; `rotation.y = -atan2(dy, dx)`. Cara interior con `pared.jpg` (u = longitud/200 u, v 0→0.9 como el legacy) y tapa `techoPared.png`. No replicar el `makeConvexHull` del legacy (es un defecto gráfico, no una regla del mapa).

**Muros (`wall`)**: como los 300 son rectángulos alineados a ejes, `BoxShape3D size = ((xmax−xmin)·S, H_WALL, (ymax−ymin)·S)` en `((xmin+xmax)/2·S, H_WALL/2, (ymin+ymax)/2·S)`. Malla: `BoxMesh` del mismo tamaño con material `pared.jpg` (UV escalada para 1 repetición por 1,8 m en horizontal y 1 en vertical) y `techoPared.png` en la tapa (segundo `surface` o material de triplanar). **Ruta genérica** para cuadriláteros no alineados (`map_03.xml`): `CollisionPolygon3D` con `polygon = 4 puntos (x·S, y·S)`, `depth = H_WALL`, el nodo rotado −90° en X para que la extrusión sea vertical, y malla por `SurfaceTool` (4 quads laterales + tapa), exactamente el orden de `generateWall`.

**Puertas (`door`)**: escena `Door.tscn` = `StaticBody3D` (layer `doors`) con `BoxShape3D` (tamaño del rectángulo, altura `H_WALL`) + `MeshInstance3D` `BoxMesh` retraído `DOOR_INSET` en el eje corto, materiales `tp3.png` (lados) y `techoPuerta.png` (tapa) + `Area3D` esfera `DOOR_USE_RADIUS` (layer `player`) + script `door.gd`: `toggle()` conmuta `is_open`; al abrir: `Tween` de `albedo_color.a` 1→0 en 1,0 s (`Door.cc:103`), `collision_layer = 0`, y `nav_region.enabled = true` (ver §6.6); al cerrar, lo inverso. El conversor instancia `Door.tscn` y fija `transform`, `size` y el nombre.

**Obstáculos (`obstacle`)**: una escena por subtipo en `res://props/` (`obstacle_table.tscn`, …) = `Node3D` → `MeshInstance3D` (GLB obtenido de `<modelo>.3ds` vía Blender: importar 3DS Z-arriba, aplicar escala 0.02, exportar glTF Y-arriba) + `StaticBody3D` (layer `static`) con `BoxShape3D` de la **huella de colisión** de la tabla de §2 (no del bbox visual): `size = (dx·S, h, dy·S)`, `position = (cx·S, h/2, cy·S)` con `cx, cy` el centro de la huella (por ejemplo table `cx=+1`, shelf `(−5, −3.5)`); `h` = altura del bbox 3DS (mesa 39 u, estantería 105 u…). El conversor instancia la escena en `(x·S, 0, y·S)` con `rotation.y = -deg_to_rad(angle)` y `subtype` en metadatos.

**Pickups (`objects`)**: `Pickup.tscn` = `Area3D` (`monitoring`, mask `player`) con `BoxShape3D (1.28, 0.4, 1.28)` centrado a 0,2 m; hijo `MeshInstance3D` (`hpack.glb` para clases 0–2, `ammo_pack.glb` para 3–5) con `AnimationPlayer` o script girando 360° cada 10 s (`EntityManager.cc:261`); `@export var pickup_class: int` y tabla de efectos (+20/+50/+100 HP o munición; clase 6 → sin efecto + warning). No entra en el horneado del navmesh (layer propia).

**Spawns**: `PlayerSpawn` (`Marker3D`) en `(x·S, 0, y·S)` con `rotation.y = -deg_to_rad(angle)`; hijos opcionales `CompanionOffset0..2` con los offsets de formación `(−2.4, 0, −1.2)`, `(2.4, 0, −1.2)`, `(0, 0, −2.4)` m (de `Player.cc:35-45`, sin el ruido aleatorio). `MiniBossSpawn` y `MegaBossSpawn` (`Marker3D`) solo si el XML los trae; si faltan, warning y metadato `implicit_origin = true` para que el gameplay decida (el legacy los pondría en el origen).

### 6.5 Materiales y aspecto
- Convertir texturas a PNG/WebP (`tga` → `png`; recomprimir los PNG de 1 MB); `StandardMaterial3D` con `albedo_texture`, `uv1_scale` para el tileado (muros 1/1,8 m, suelo y tapas 1/4 m), `texture_filter` nearest o lineal según gusto.
- Opcional: shader espacial de Godot que reproduzca `CellShading.frag` con una función `light()` que cuantice `N·L` en {1.0, 0.7, 0.3, 0.1}.
- Iluminación: `WorldEnvironment` (ambiente 0.1) + `OmniLight3D` siguiendo al jugador a `(0, 14, −8)` m (equivale a `(x, y−400, 700)` legacy) o `DirectionalLight3D` fijo. Cámara: `Camera3D` `fov = 45`, a `13.6 m` (680·S) del jugador con 30° de inclinación respecto a la vertical (valores de reinicio del legacy).

### 6.6 Navegación
Equivale al Delaunay + expansión por `charRadius` del legacy (`Map.cc:562-647`):
- `NavigationRegion3D` con `NavigationMesh`: `agent_radius = 0.6`, `agent_height = 1.8`, `agent_max_climb = 0.1`, `cell_size = 0.1`, `cell_height = 0.1`, `geometry_parsed_geometry_type = STATIC_COLLIDERS`, `geometry_collision_mask = static | doors` (suelo, banda exterior, muros, obstáculos y **puertas**, que dejan hueco).
- Puertas: el conversor añade por puerta una **`NavigationRegion3D` pequeña** cuya malla es el rectángulo de la puerta ampliado `agent_radius` (para que sus aristas casen con las del navmesh principal dentro de `edge_connection_margin`) y que **empieza `enabled = false`** (puerta cerrada). `door.gd` conmuta `enabled` al abrir/cerrar: la conectividad cambia sin rehornear, análogo a `changeNodeState` del legacy.
- Horneado: en un `EditorScript`/`@tool` tras generar el `.tscn` (`NavigationRegion3D.bake_navigation_mesh()`), o en `_ready()` la primera vez.

### 6.7 Verificación de la conversión
Automatizable con `godot --headless -s verify_map.gd -- <mapa.tscn> <mapa.xml>` y/o un parser de `.tscn` en Python:
1. **Conteos**: nº de `Wall_*`, `Door_*`, `Obstacle_*`, `Pickup_*` y presencia de `PlayerSpawn`/`MiniBossSpawn`/`MegaBossSpawn` iguales a los del XML (los mismos que en la tabla de §4).
2. **Área y bbox**: suma de áreas de los triángulos del `Floor` ≈ `area_legacy·S²` (tolerancia 1e-6 relativa); AABB de todos los `StaticBody3D` ≈ `bbox_legacy·S` expandido `BAND_PERIM`.
3. **Posiciones**: para cada objeto puntual, `global_position` = `(x·S, 0, y·S)` y `rotation.y = -deg_to_rad(angle)` (tolerancia 1e-4).
4. **Navegabilidad**: tras hornear, `NavigationServer3D.map_get_closest_point(p)` distancia < 0.3 m para el spawn del jugador, de los jefes y de cada pickup; existe camino (`map_get_path`) del jugador al jefe con todas las puertas abiertas; en `mapRuben.xml` no debe existir con la puerta cerrada.
5. **Visual**: render cenital ortográfico headless (`SubViewport` + `Camera3D` ortográfica) a PNG comparado con un dibujo del XML hecho con matplotlib (eje Y invertido, misma escala): IoU de las máscaras de muro ≥ 0.98.
6. **Ida y vuelta**: exportar desde los metadatos del `.tscn` un XML y compararlo con el original ignorando espacios e `id` — debe ser idéntico para los 22 mapas producidos por el editor.
7. **Regresión**: `map4.xml` vs `gallardoMap.xml` y `editorMap.xml` vs `mapM4.xml` deben producir escenas que difieran exactamente en los nodos que muestra el `diff` de §4.

---

## 7. Riesgos y assets no reutilizables

| Elemento | Problema | Decisión recomendada |
|---|---|---|
| Modelos `.3ds` (todos) | Godot 4 no importa 3DS; formato de 1990 con nombres de 12 caracteres, sin materiales PBR ni animación esquelética; el cargador legacy (`load3ds.c`) no tiene licencia. | Convertir con Blender a glTF **solo** el mobiliario y los pickups como referencia de bloqueo; rehacer todo lo demás. |
| Series `c/s/h/d/p/sn/e/sp/m` (personajes) | 5 fotogramas rígidos por personaje (mesh-swap cada 200 ms), ~500 vértices, texturas 128² con nombres de clases de **TF2** → derivados de IP de Valve. | **Rehacer** personajes y animaciones desde cero (rig + walk cycle). No reutilizar mallas ni texturas. |
| `Player.3ds`, `Enemy1/2/3.3ds`, `enemy.tga`, `player.tga` | Materiales `ct_urban`/`t_leet`: modelos de **Counter-Strike** (Valve). No referenciados. | Eliminar del repositorio. |
| `simba3ds.3DS` | `DrawCall_*` + `.DDS`: volcado de otro juego con un ripper. No referenciado. | Eliminar. |
| Mobiliario (`mesa`, `sofa`, `sillon`, `desk`, `estanteria`, `sillaEspera`, `mesaSillas`, `plant`) | Procedencia externa desconocida (materiales en alemán/italiano, luces y cámaras embebidas); `mesa`/`sofa`/`sillon` con 9–16 k vértices para un top-down. | Usar como placeholder; sustituir por modelos propios o CC0 antes de publicar. |
| Texturas de escenario (`pared`, `sueloOficina`, `tp3`, `techo*`, `exploMala`, `fondo`, `van`) | Procedencia no documentada; resoluciones bajas (256–500 px); PNG de 1 MB sin comprimir. | Sustituir por texturas CC0 tileables; si se conservan como placeholder, recomprimir. |
| Fuentes `TF2.ttf`, `tf2build.ttf` | Propiedad de Valve; usadas en todo el HUD (`TLabel.cc`). | Sustituir por fuentes OFL (p. ej. Bebas Neue si se confirma su licencia). Verificar `Absender` y `Coolvetica`. DejaVu es reutilizable. |
| Música `LegendsOfLiberty.ogg`, `andorga.ogg`, `acdc.ogg` | The Prodigy (etiquetas Vorbis) y AC/DC: **copyright comercial**. | Eliminar del repo y sustituir. Mantener `credits.ogg` (propio). |
| Efectos `personal/*.ogg` | Propios salvo `step.ogg` (SoundJay: revisar condiciones) y `explosion.ogg`/«grenade» (tercero desconocido). | Conservar los propios; sustituir los dos dudosos. |
| Shaders GLSL | Dependen de `gl_LightSource`/`gl_FrontMaterial` (OpenGL 2 fijo). | Reescribir como shader espacial de Godot (toon con cuantización 1.0/0.7/0.3/0.1) o usar `StandardMaterial3D`. |
| `editorMap.xml.nav` | Formato roto (escritor con UB, lector que no carga aristas), ningún consumidor, coordenadas de otro mapa. | Ignorar; hornear `NavigationMesh` en Godot. |
| `map_01..04.xml` | No son XML bien formado (solo TinyXML los tolera); usan `ang`/`enemy`/`companion` que el motor ignora. | Normalizar o excluir (son pruebas de 2011 sin valor de diseño). |
| Duplicados y huérfanos | `map4` ≈ `gallardoMap`; `editorMap` ≈ `mapM4`; `mapM2` nunca se carga; `mapRuben.xml.aux/.wall` copias de trabajo. | Convertir solo los 13 mapas que usa `selectionMap` (P1–P4, M1, M3, M4, G1–G4, finalMap, editorMap); archivar el resto. |
| Bugs del formato heredados | `lY` nunca se actualiza en el bbox (`Map.cc:159-162`); `angle` de jefes se descarta; jefe implícito en (0,0) si falta el elemento; `subtype` fuera de rango dibuja nada pero colisiona 64×140. | El conversor recalcula el bbox correctamente, exporta el ángulo de los jefes en metadatos y avisa de los casos implícitos. |
| Datos que **no** están en el XML | Enemigos normales (generados por el módulo de optimización según área/dificultad), compañeros (formación relativa al jugador), tipo de jugador (menú). | Documentar en la escena (metadatos/markers) y resolverlo en gameplay, no en el conversor. |
