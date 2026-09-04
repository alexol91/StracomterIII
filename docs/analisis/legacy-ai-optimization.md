# Análisis legacy — AI y Optimization

Ámbito: `legacy/trunk/AI/`, `legacy/trunk/Optimization/` y, dentro de `legacy/trunk/Math/`, `Triangulation`, `Tri`, `GraphUD`, `Polygon`, `Rational`, `Matrix`. Para entender cómo se usan estos módulos se han leído además (sin entrar a analizarlos como tales) `core/entities/lib/{Bot,Enemy,Captain,Technic,Especialist,Explosive,Door,EventControl,EntityManager}.cc`, `core/lib/{Map,GameAction,SteeringBehavior,MovementComp,Path}.cc`, `core/include/CoreNamespace.h` y `Math/lib/{Vector2D,Point,LineEquation}.cc`.

Convención de citas: todas las rutas son relativas a `legacy/trunk/` (p. ej. `AI/lib/Pathfinder.cc:348`). Todo lo que sigue procede de la lectura literal del código; cuando algo no está implementado o no se usa, se dice explícitamente.

---

## 1. Inventario de ficheros y LOC

LOC = líneas físicas (`wc -l`).

### 1.1 `AI/` — 3 941 LOC en total (biblioteca `StraAI`)

| Fichero | LOC | Contenido |
|---|---|---|
| `AI/include/AI.h` | 74 | Fachada `AI`: bucle de IA, tabla de FSM por tipo (`fsmV`), puntero a `Pathfinder`. |
| `AI/lib/AI.cc` | 446 | `AI::Update` (despacho por tipo de entidad), `AI::initMap` (grafo dual + puertas), `AI::makeFSM` (tabla FSM **muerta**, ver §2.3). |
| `AI/include/FSM.h` | 257 | `FSM` y `FSMState`. |
| `AI/lib/FSM.cc` | 347 | Máquina de estados tabular (estado → lista de `(input, destino)`), `loadData` (formato `.txt`). |
| `AI/include/ASNode.h` | 165 | Nodo de A*: `g,h,f,parent,next,id,center,enabled,adyacentes`. |
| `AI/lib/ASNode.cc` | 201 | Implementación trivial. |
| `AI/include/NavGraph.h` | 78 | Grafo de navegación (vector de `ASNode`). |
| `AI/lib/NavGraph.cc` | 360 | Adyacencias, heurística, `writeFile`/`loadFile` (XML `.nav`, roto y sin uso), `changeNodeState`. |
| `AI/include/Pathfinder.h` | 197 | Declaraciones de A*, grafo dual, suavizado, puertas. |
| `AI/lib/Pathfinder.cc` | 488 | `makeDualGraph`, `addDoor`, `smoothPath`, `getNearestCenter`, `AStar`, `generatePath`. |
| `AI/src/testDelaunay.cc` | 260 | Test visual de `Triangulation` (no compilado: `#add_subdirectory(src)` en `AI/CMakeLists.txt:6`). |
| `AI/src/testFSM.cc` | 227 | Editor de FSM por consola (`FSMMaker`), lee/escribe el formato `.txt`. |
| `AI/src/testFSMGrafico.cc` | 269 | Visor gráfico de FSM (`FSMViewer`). |
| `AI/src/testNiceGrafic.cc` | 369 | Test gráfico. |
| `AI/src/testPathfinder.cc` | 189 | Test visual de pathfinding. |
| `AI/CMakeLists.txt`, `AI/lib/CMakeLists.txt`, `AI/src/CMakeLists.txt` | 6+8+6 | `StraAI` enlaza `StraMath` y `StraPhysics` (`AI/lib/CMakeLists.txt:8`). Los tests están desactivados. |

### 1.2 `Optimization/` — 1 578 LOC en total (biblioteca `StraOptimization`)

| Fichero | LOC | Contenido |
|---|---|---|
| `Optimization/include/Optimization.h` | 93 | Fachada: `CargarFuncionObjetivo`, `CalcularEnemigos`, `CargarEnemigos`, `E1..E3`, `MaxEnemies`. |
| `Optimization/lib/Optimization.cc` | 173 | Formulación del PL y generación de enemigos. |
| `Optimization/include/Simplex.h` | 230 | Simplex tabular sobre `Matrix<Rational>`. |
| `Optimization/lib/Simplex.cc` | 843 | Parser de restricciones en texto, Simplex primal con penalizaciones (Big-M), Simplex dual, ramificación y acotación (`SimplexInt`). |
| `Optimization/src/test.cc` | 156 | CLI `Simplex` (demo con la función objetivo del juego). |
| `Optimization/src/testOpti.cc` | 51 | Prueba de integración con `mapRuben.xml`. |
| CMake | 8+8+24 | `StraOptimization` enlaza sólo `StraMath`; `src` desactivado (`Optimization/CMakeLists.txt:5`). |

### 1.3 `Math/` (sólo lo que toca al ámbito) — 4 175 LOC

| Fichero | LOC | Contenido |
|---|---|---|
| `Math/include/Triangulation.h` / `Math/lib/Triangulation.cc` | 158 / 615 | Delaunay incremental con volteo de aristas. |
| `Math/include/Tri.h` / `Math/lib/Tri.cc` | 232 / 371 | Triángulo con 3 vecinos, in-circle, incentro, área. |
| `Math/include/GraphUD.h` | 343 | Grafo no dirigido genérico (plantilla, sólo cabecera). **No lo usa nadie**: sólo lo incluye `AI/include/Pathfinder.h:4`. |
| `Math/include/Polygon.h` / `Math/lib/Polygon.cc` | 269 / 501 | Polígono, expansión por radio, envoltorio de GPC. |
| `Math/include/Rational.h` / `Math/lib/Rational.cc` | 195 / 596 | Racional `int/int`. |
| `Math/include/Matrix.h` | 895 | Matriz genérica (plantilla, sólo cabecera) con Gauss-Jordan (`baseTo`) para el Simplex y determinante para el in-circle. |

Dependencias de estos ficheros fuera del ámbito: `Point`, `Vector2D`, `LineEquation` (`equ`), `Node`, `tinyxml`, `gpc` (3rdParty), Box2D vía `Physics` (`World`, `Body`, `BodyData`).

---

## 2. FSM (máquinas de estado)

### 2.1 Mecánica de la clase `FSM`

* Los estados se numeran desde **1** (`nState = 1` en `AI/lib/FSM.cc:125`); `currentState` empieza en **0** = "sin estado" (`FSM.cc:124`).
* Una transición es un par `(input, destino)` dentro del estado origen. Cada estado admite **una sola transición por valor de input** (`FSMState::addTransition`, `FSM.cc:61-76`); la máquina es determinista.
* `FSM::addTransition(ori, des, inp)` sólo comprueba `ori < nState && des < nState` (`FSM.cc:226`), no que el id exista; si `ori` no existe la inserción falla en silencio.
* `updateStates(input)` (`FSM.cc:267-282`): si el estado actual no tiene transición para ese input, **se queda** en el mismo estado (`FSMState::updateState`, `FSM.cc:93-104`). No hay acciones de entrada/salida ni temporizadores: la FSM sólo guarda "en qué estado estoy"; la lógica de cada estado vive en el `updateAI` de cada entidad y compara el **nombre** del estado por cadena cada frame (`Enemy.cc:22-39`, `Captain.cc:26-38`).
* `setDebug(true)` imprime las transiciones por `cout` (`FSM.cc:263, 277-279`).

### 2.2 Formato de `testFiles/fsm/*.txt`

`FSM::loadData` (`AI/lib/FSM.cc:154-193`) lee tokens separados por blancos:

| Registro | Sintaxis | Efecto |
|---|---|---|
| estado | `e <nombre>` | `addState(nombre)` (`FSM.cc:169-171`) |
| transición | `t <origen> <input:int> <destino>` | `addTransition(getId(origen), getId(destino), input)` (`FSM.cc:172-182`); los nombres desconocidos resuelven a id 0 y la transición se descarta en silencio |
| inicial | `i <nombre>` | `makeCurrent(getId(nombre))` (`FSM.cc:183-186`) |

Defectos: el bucle es `while(!fDatos.eof())` (`FSM.cc:166`), con lo que el último registro puede procesarse dos veces si hay espacio/salto final; `fsm_03.txt:9` contiene `i ` con nombre vacío, así que ese fichero queda sin estado inicial.

Ficheros presentes:

| Fichero | Estados | Transiciones | Inicial | Observación |
|---|---|---|---|---|
| `fsm_01.txt` | 7 (`primero`…`septimo`, incluido `pato`) | 11 con inputs 1-4 | `cuarto` | Fixture genérica |
| `fsm_02.txt` | 5 (`patrullo, ataco, defiendo, huyo, curo`) | 14 con inputs 0-4 | `patrullo` | Boceto de IA de enemigo; **no coincide** con la FSM real del juego |
| `fsm_03.txt` | 4 (`a s d f`) | 4 | (vacío) | Fixture |
| `fsm_04.txt` | 26 (`a`…`z`) | 45 con inputs 1-3 | `a` | Test de estrés |

**Estos ficheros no los carga el juego.** Los únicos llamadores de `FSM::loadData` son `AI/src/testFSM.cc:15,170` y `AI/src/testFSMGrafico.cc:57` (herramientas `FSMMaker`/`FSMViewer`, no compiladas). Las FSM del juego se construyen en código (§2.4).

### 2.3 Tabla FSM en `AI::makeFSM` — código muerto

`AI::AI()` construye una `FSM` por cada `Core::SmartEntities::Type` (`AI/lib/AI.cc:3-8`, tabla en `AI.cc:141-446`) y expone `AI::updateFSM(entidad, estado, input)` (`AI.cc:94-101`). **Nadie llama a `updateFSM`** (grep en todo `legacy/trunk`). Es una versión anterior del diseño:

* Aliados (`e_captain`, `e_tecnic`, `e_explosives`): `Follow`(1) `Attack`(2) `Resupply`(3) `Retreat`/`Heal`(4); inputs `10` nada→Follow, `20` enemigo→Attack, `30` sin munición→Resupply, `40` daño→Retreat/Heal (`AI.cc:145-224, 257-295`).
* `e_especialist`: `Follow`(1) `Attack`(2) `Heal`(3) — pero referencia un estado 4 inexistente (`AI.cc:241, 247`, descartadas en silencio) y añade un bucle `3→3` con input 40 (`AI.cc:253`).
* Enemigos (`e_enemy1..3`, `e_miniboss`, `e_megaboss`): `Patrol`(1) `Attack`(2) `Pursue`(3); inputs `10`, `20`, `30` (`AI.cc:297-440`).

Sirve como documentación de intenciones (la semántica de los códigos 10/20/30/40 coincide con la usada por `Enemy`), no como comportamiento real.

### 2.4 FSM reales: `generateFSM()` por entidad

Los ids se asignan por orden de `addState` empezando en 1. Los comentarios del código ("Patrol = 1", etc.) están **desplazados una unidad** porque `Debug` se añade primero.

#### Enemigos (`Enemy`, tipos `e_enemy1..3`, `e_miniboss`, `e_megaboss`) — `core/entities/lib/Enemy.cc:169-205`

Estados: `Debug`=1, `Patrol`=2, `Attack`=3, `Pursue`=4, `Ensure`=5. Inicial `Patrol` (`Enemy.cc:196`).

Códigos de input (`core/entities/include/Enemy.h:14-20`, `enum State`): `Debug = 0`, `Patrol = 10`, `Attack = 20`, `Pursue = 30`, `Ensure = 40`. Cada input significa "ir al estado X"; el significado semántico lo da quien lo emite:

| Origen | Input | Destino | Quién lo emite y por qué |
|---|---|---|---|
| Patrol | 20 | Attack | `enemySpotted` (`Enemy.cc:47-48`) |
| Patrol | 30 | Pursue | cola de atacantes no vacía: ruta hacia el atacante (`Enemy.cc:69-71`) |
| Attack | 10 | Patrol | sin objetivo ni última posición conocida (`Enemy.cc:126-127`) |
| Attack | 30 | Pursue | objetivo perdido → ruta a `currentObj` (`Enemy.cc:120-121`); o `isInsideFOV==2` (`Enemy.cc:112-114`, **inalcanzable**, ver §3.2) |
| Pursue | 20 | Attack | `enemySpotted` (`Enemy.cc:81-82`) |
| Pursue | 40 | Ensure | llegada al destino (`Enemy.cc:84-86`) |
| Ensure | 10 | Patrol | giro de 360° completado (`Enemy.cc:99-101`) |
| Ensure | 20 | Attack | `enemySpotted` (`Enemy.cc:96-97`) |
| Patrol/Attack/Pursue/Ensure | 0 | Debug | consola (`Bot::setDebug`, `Bot.cc:420-422`); **sin salida** de Debug |

Comportamiento por estado:

* **Patrol** (`Enemy.cc:44-73`): 3 puntos de patrulla = los 3 vértices del triángulo de la triangulación donde ha aparecido (`EntityManager.cc:352-356`, `getTri(p)`), índice inicial `rand()%3` (`Enemy.cc:284`). Si está a ≤ **10** px del punto actual (`Enemy.cc:50`), el siguiente es `+1` o `+2` al azar módulo 3 (`Enemy.cc:54-55`) y el camino es `[actual, siguiente]` directo (sin A*). Si el camino está vacío se calcula con A* (`calculatePath`), si no se ejecuta `Move()`.
* **Pursue** = `gotoPosition` (`Enemy.cc:76-89`): `Move()`; al llegar → `nRotations = 0` e input 40.
* **Ensure** (`Enemy.cc:92-104`): `fullRotation()` gira **1° por frame durante 360 frames** (`Enemy.cc:158-167`; dependiente del framerate). Existe `partialRotation` (paradas de **3000 ms** en múltiplos de **90°**, `Enemy.cc:136-156`) pero **no se llama desde ningún sitio**.
* **Attack** (`Enemy.cc:107-130`): `selectObjetive`; con objetivo → `Dispara`; sin objetivo → si hay `currentObj` (última posición vista) ruta hasta allí y Pursue, si no ruta al punto de patrulla y Patrol.
* Los jefes (`e_miniboss`, `e_megaboss`) usan exactamente la misma clase y FSM; sólo cambian las `Features` (`CoreNamespace.h:212-241`).

#### Aliados (`Captain`, `Technic`, `Especialist`, `Explosive`) — `Captain.cc:138-172`, `Technic.cc:151-185`, `Especialist.cc:137-171`, `Explosive.cc:144-177` (idénticas)

Estados: `Debug`=1, `FollowPlayer`=2, `Attack`=3, `ComeBack`=4, `GotoPoint`=5. Inicial `FollowPlayer`.

Códigos de input: `0` → Debug, `1` → FollowPlayer, `2` → Attack, `3` → ComeBack, `4` → GotoPoint.

| Origen | Input | Destino |
|---|---|---|
| FollowPlayer | 2 | Attack |
| FollowPlayer | 3 | ComeBack |
| FollowPlayer | 4 | GotoPoint |
| Attack | 1 | FollowPlayer |
| Attack | 3 | ComeBack |
| ComeBack | 1 | FollowPlayer |
| GotoPoint | 1 | FollowPlayer |
| GotoPoint | 2 | Attack |
| FollowPlayer/Attack/ComeBack | 0 | Debug |

**El input 3 no lo emite nadie** (grep de `updateStates(3)` / `updateState(3)` vacío): el estado `ComeBack` es inalcanzable. `goToComeBack()` en realidad emite **4** (`Captain.cc:174-177`), por lo que "volver al capitán/especialista" se ejecuta en `GotoPoint`.

Comportamiento (Captain como referencia; los otros tres son copia con umbrales distintos):

* Pre-chequeo cada frame (`Captain.cc:21-24`): si `hp <= 30` y lleva botiquín → lo usa; si no, si `ammunition <= 5` y lleva munición → la usa. Umbrales: Technic `hp <= 10`, `ammo <= 1` (`Technic.cc:21-23`); Especialist `hp <= 15`, `ammo <= 10` (`Especialist.cc:21-23`); Explosive `hp <= 50`, `ammo <= 1` (`Explosive.cc:21-23`).
* **FollowPlayer** (`Captain.cc:42-70`): si le atacan, gira hacia el atacante y saca el punto de la cola (`Captain.cc:45-50`). Si ve enemigo → 2. Si el jugador está a más de **150** px (Captain, `Captain.cc:58`) / **200** px (Technic `Technic.cc:58`, Especialist `Especialist.cc:58`, Explosive `Explosive.cc:60`) → A* hasta el jugador e input 4; si no, modo formación (`mov->setMode(1)`, `Captain.cc:62`) y `Move()`. Sin jugador → `turnAround(1)`.
* **Attack** (`Captain.cc:73-99`): Captain: si `ammunition < 1` y existe un Especialist → `goToComeBack(posEspecialist)` (`Captain.cc:83-84`). Technic/Explosive: si `hp < 20` y existe Captain → ir al Captain; si no, si `ammunition < 1` y existe Especialist → ir al Especialist (`Technic.cc:88-93`, `Explosive.cc:90-95`). Especialist: sólo `hp < 20` → ir al Captain (`Especialist.cc:82-84`). En otro caso `selectObjetive` → `Dispara` o input 1.
  Roles implícitos: el Captain es el "curador" (es el único con `Moral = 3`, `CoreNamespace.h:119`, y `Character::UpdateSanar` sólo regenera con `moral == 3`: **+1 hp cada 2000 ms**, `Character.cc:113-122`, invocado desde `AI::Update` para los cuatro aliados, `AI.cc:72,76,80,84`); el Especialist es el "punto de munición". En los ficheros del ámbito sólo se ve el desplazamiento hasta ese aliado; la mecánica de traspaso de vida/munición al llegar no se ha verificado aquí.
* **GotoPoint** (`Captain.cc:115-136`): modo 0, `Move()`; si le atacan gira hacia el atacante; si ve enemigo → 2; al llegar → 1.
* **ComeBack** (`Captain.cc:102-107`): `Move()` hasta llegar → 1. Inalcanzable.
* **Debug**: modo 0 + `Move()`.

### 2.5 Despacho

`AI::Update` (`AI/lib/AI.cc:55-92`) recorre `EntityManager::getBots()` (aliados que no son el jugador + todos los enemigos, `EntityManager.cc:592-620`) y llama a `updateAI` según el tipo. No hay ticks separados ni prioridades; todo se evalúa cada frame.

---

## 3. Percepción y selección de objetivo

### 3.1 Parámetros

* Distancia de visión **500** px, fijada en todos los constructores de `Bot` (`Bot.cc:15,58,87,110,140`) y **reasignada dentro de `isInsideFOV` en cada llamada** junto con `visionAngle = 20` (`Bot.cc:251-252`): no es configurable por tipo de entidad aunque el miembro exista.
* Semiángulo **20°** (cono total de 40°).
* Visión secundaria hasta **700** px (`Bot.cc:194,205`).
* El ángulo del personaje se guarda en **grados**, con el convenio `angle = -atan(dy/dx)·180/π` (y +180 si el objetivo queda a la izquierda) en `Character::generateVisionRotation` (`Character.cc:371-398`), y en `Bot::Move()` como `velocity.Angle()` negado cuando `vy > 0` (`Bot.cc:383-387`). Los consumidores (`generateRay`, `Character.cc:402-403`; `isInsideFOV`, `Vector2D(double ang)` → `(cos, sin)`, `Vector2D.cc:50-53`) lo usan directamente. El signo depende de la orientación del eje Y del mundo físico frente al gráfico; **conviene re-derivarlo con `atan2` en el remake y no copiar la fórmula**.

### 3.2 Cono de visión: dos tests distintos

**`generateVisionTri`** (`Bot.cc:183-217`) construye dos triángulos con vértice en el centro `a`:

* `vision = Tri(a, c1, b1)` con `b1 = a + 500·(cos(θ+20°), sin(θ+20°))`, `c1 = a + 500·(cos(θ−20°), sin(θ−20°))` (la doble negación de `ang = -angle` y `y = a.y - 500·sin(...)` se cancela). Coordenadas truncadas a `int` (`Bot.cc:190-191`).
* `secondaryVision = Tri(a, c2, b2)` igual a **700** px.
* Además lanza el rayo láser a `a + 500·(cos θ, sin θ)` (`Bot.cc:209-211` → `Character::generateRay`, raycast Box2D `RayBody`).

Se recalcula en cada `Move()`, `Dispara` y giro.

**Test A — `enemySpotted`** (`Bot.cc:424-454`): si no está ciego, para cada entidad de la facción contraria (`getBadPersons`/`getGoodPersons`, `EntityManager.cc:530-582`), distinta de sí mismo y `soyVisible()`: `vision.isInside(centro) ∈ {1 (dentro), 0 (en un lado)}` (`Bot.cc:441-442`; `Tri::isInside` por productos vectoriales, `Tri.cc:314-342`, con comparaciones exactas `== 0`) **y** línea de visión física: `RayBody(miCentro, suCentro).body == suCuerpo` (`Bot.cc:443`). Si se cumple, `memory.push_back(id)` (`Bot.cc:444`, sin comprobar duplicados) y devuelve `true`. Nótese que el "cono" es un **triángulo con lado lejano recto**, no un sector circular.

**Test B — `isInsideFOV(p)`** (`Bot.cc:243-266`): devuelve `1` si `distance(pos,p) < 500` y `|ángulo(heading, p−pos)| < 20°` (sector circular real, `Vector2D::Angle` con signo por producto vectorial, `Vector2D.cc:194-207`); si no, `0`. **Nunca devuelve 2** aunque el comentario y `Enemy::Attack` (`Enemy.cc:112`) lo esperen: la banda 500–700 px (`secondaryVision`) **no se usa para nada** salvo dibujado de depuración.

### 3.3 Memoria y selección — `selectObjetive` (`Bot.cc:287-344`)

Recorre `memory` (lista de ids acumulada por `enemySpotted`) y **borra** cada entrada que: sea `NULL`, esté muerta o invisible (`Bot.cc:299`); no pase `isInsideFOV > 0` (`Bot.cc:301`); o no tenga línea de visión `RayBody` (`Bot.cc:302`). Entre las que sobreviven elige la de mayor `enemyValue` con `>=` (a igualdad gana la última, `Bot.cc:315`) y guarda `currentObj = new Point(centro del objetivo)` (`Bot.cc:312,323`).

Consecuencias: la "memoria" sólo retiene lo que sigue visible en ese frame (los ids salen en cuanto se pierden de vista); la única persistencia real es `currentObj` (última posición conocida), que `Enemy::Attack` usa para ir a buscar al objetivo perdido (`Enemy.cc:119-124`). Los aliados no usan `currentObj`.

### 3.4 Heurística `enemyValue`

```
double Bot::enemyValue(Character *enemigo) { return 1.0 / Point::distance(this->getCenter(), enemigo->getCenter()); }
```
(`Bot.cc:416-418`). Es decir: **objetivo = el enemigo visible más cercano**. No pondera vida, tipo ni amenaza. División por cero si coinciden los centros.

### 3.5 Cola de atacantes

`Bot::atackers` es `queue<Point>` (`Bot.h:269`). La alimenta `EventControl::postDisparo` (`EventControl.cc:140-168`): cuando un disparo **no letal** alcanza a un bot y atacante y atacado son de facciones opuestas (`EventControl.cc:155-162`), se encola el **centro del atacante** en ese instante. `meAtacan()` = cola no vacía (`Bot.cc:90-92`).

Consumo: `Enemy::Patrol` → A* hasta `atackers.front()`, `pop`, input 30 (`Enemy.cc:69-71`); aliados en FollowPlayer/GotoPoint → sólo giran hacia el punto y `pop` (`Captain.cc:45-50, 122-127`). En Attack/Pursue/Ensure la cola **no se consume** y se acumula.

### 3.6 Otros

* `Dispara(objetivo)` (`Bot.cc:26-32`): gira hacia el objetivo, `generateRay`, `generateVisionTri`, `EventControl::doAttack(this)`.
* Ceguera (`blind`): sólo la activa el comando de consola `setVision <id> 0|1` (`GameAction.cc:565-578`); no hay granadas cegadoras ni similar.
* La visibilidad de la percepción **no** usa la triangulación: usa raycasts Box2D sobre el mundo de juego (`Bot.cc:302,443`). La triangulación sólo interviene en `Map::hasVision` (suavizado y nodo más cercano, §4).

---

## 4. Pathfinding

### 4.1 `NavGraph` y `ASNode`

* `ASNode` (`AI/include/ASNode.h`): `g, h, f, numChildren, parent, next, id (-1 por defecto), center, enabled (true), adyacentes (vector<int>)`. `setGH` fija `f = g + h` (`ASNode.cc:160-164`).
* `NavGraph::addNode` **deduplica por posición** (`Point::operator==` con tolerancia **0.1**, `Point.cc:38-49`) y devuelve el id existente (`NavGraph.cc:69-91`). `addEdge` es no dirigida y sin duplicados (`NavGraph.cc:106-130`).
* Bug: `removeEdge` usa los **ids como índices** del vector (`NavGraph.cc:138,142`), sólo correcto si `id == índice`. (No se usa en el juego.)
* Heurística: `heuristicH = Point::distance(ori, dest)` = **euclídea** (`NavGraph.cc:241-245`). Coste `g = distance(origen, vecino) + recorrido` (`NavGraph.cc:190`), `h = distance(destino, vecino)` (`NavGraph.cc:191`).

### 4.2 Formato `.nav` (XML) — roto y sin uso en el juego

`NavGraph::writeFile` (`NavGraph.cc:282-314`) genera:

```xml
<?xml version="1.0" ?>
<navgraph>
    <node id="0" x="72" y="-192" enabled="1">
        <adyacent id="10" />
        ...
    </node>
</navgraph>
```

Defectos verificables en el único fichero existente, `editorMap.xml.nav` (22 nodos, 78 `<adyacent>`):

* `x`,`y` se escriben con `SetAttribute(int)` → truncados.
* El bucle recorre `getAdyacence().begin() + 1` … `getAdyacence().end()` sobre **dos temporales distintos** (`getAdyacence()` devuelve por valor, `ASNode.cc:38-40`; `NavGraph.cc:305`): comportamiento indefinido. Síntomas en el fichero: todos los nodos empiezan con `<adyacent id="0"/>` y el nodo 16 contiene `<adyacent id="1635345505"/>`.
* `loadFile` (`NavGraph.cc:316-350`) espera `node > (hijo) > adyacent` (`nodo->FirstChildElement()->FirstChildElement()`, `NavGraph.cc:338`), que **no** es lo que escribe `writeFile`; ignora `enabled`; y desreferencia `NULL` en nodos sin hijos.
* El editor tiene la escritura comentada (`core/src/mapEditor.cc:1037`) y **ningún** código del juego llama a `loadFile`/`writeFile` de `NavGraph`. El grafo se reconstruye siempre desde la triangulación en carga (`AI::initMap` → `Pathfinder::generateDualGraph`, `AI/lib/AI.cc:103-120`).

### 4.3 Construcción del grafo desde la triangulación — `Pathfinder::makeDualGraph` (`Pathfinder.cc:103-170`)

Para cada `Tri*` de `Map::getTriangulation()`:

1. Nodo en el **incentro** (`Tri::getIncenter`, `Tri.cc:129-146`) (`Pathfinder.cc:114`).
2. Nodos en los **tres vértices** (deduplicados por posición) (`Pathfinder.cc:141-143`).
3. Aristas: incentro ↔ incentro del vecino por cada lado con vecino (`Pathfinder.cc:145-159`); si un lado **no** tiene vecino (frontera), arista entre los dos vértices de ese lado; y siempre incentro ↔ cada uno de sus tres vértices (`Pathfinder.cc:163-165`).

Es un híbrido "grafo dual + grafo de esquinas": los caminos pueden pasar por vértices (esquinas de la geometría expandida) y por centros. El emparejamiento `Tri* → id` es O(T²) (`Pathfinder.cc:129-139`).

### 4.4 A* — `Pathfinder::AStar` (`Pathfinder.cc:348-456`)

1. `origen = getNearestCenter(ori)`, `destino = getNearestCenter(des)` (`Pathfinder.cc:359-360`): el nodo **habilitado** más cercano **con `map->hasVision(p, nodo)`** (`Pathfinder.cc:263-299`; `hasVision` = ningún corte con los sensores Box2D de `mapWorld`, `Map.cc:1018-1024`). `map->isNavegable` está anulado con `return true` (`Map.cc:1061-1065`). Si falla, id `-1` y no hay ruta.
2. Listas abierta/cerrada como `vector<ASNode>` con búsquedas lineales; `getMinCost` escanea toda la abierta saltando nodos deshabilitados (`Pathfinder.cc:326-346`).
3. Expansión con `getAdyacenceCalculated(best.id, destino.id, best.g)` (`Pathfinder.cc:407`); se saltan vecinos deshabilitados (`Pathfinder.cc:414`).
4. **Defecto**: si un vecino ya está en la abierta con `f` peor, sólo se actualiza `parent` (`Pathfinder.cc:417-426`), **no** `g`/`f` → A* no es estrictamente óptimo (el coste heredado queda desactualizado). Nodos en cerrada se ignoran sin reapertura.
5. Termina al extraer el destino. `generatePath` (`Pathfinder.cc:458-473`) devuelve `[ori, pos(origen), …padres…, pos(destino), des]` (construido hacia atrás y `reverse`).

`AStar` **no** suaviza; lo hace `Bot::calculatePath` (`Bot.cc:277-285`): `path = pf->AStar(...)`; `path = pf->smoothPath(path)`; `mov->setPath(path)`.

### 4.5 Suavizado — `Pathfinder::smoothPath` (`Pathfinder.cc:242-261`)

Una pasada voraz: con `i` recorriendo el camino, si `map->hasVision(p[i], p[i+2])` se borra `p[i+1]`, si no `i++`. La visibilidad se evalúa contra `mapWorld` (geometría **expandida** por el radio del personaje, §5), así que los atajos ya respetan el radio. Las puertas están siempre en `mapWorld` (§4.6), luego el suavizado nunca "ve" a través de una puerta, abierta o cerrada.

### 4.6 Puertas — `Pathfinder::addDoor` (`Pathfinder.cc:172-235`) y `Door::switchNodes` (`Door.cc:139-146`)

En `AI::initMap` (`AI.cc:114-119`) por cada entidad puerta: `pared->setNodes(pf->addDoor(pared->getPoints()))`.

`addDoor(contorno)`:
1. Crea un `World` Box2D temporal y un `Body` sensor con el polígono de la puerta (`Pathfinder.cc:178-185`).
2. Añade un nodo en el **centroide** de la puerta (`Pathfinder.cc:188-189`; `Polygon::getCentroid` = media de vértices, `Polygon.cc:457-479`).
3. Para cada nodo habilitado: si está **dentro** del polígono (paridad de cortes del rayo hasta `(-99999,-99999)`, `Pathfinder.cc:198`) → `enabled=false` y se anota su id. Si no, para cada vecino habilitado cuyo segmento esté bloqueado por la puerta (`!mundo->Ray(pos, vecino)`, `Pathfinder.cc:207`) → se elimina la arista y se conectan ambos extremos al nodo central de la puerta (`Pathfinder.cc:212-219`; las aristas se añaden dos veces con un `TODO`).
4. Si el nodo central queda aislado se elimina; si no, se añade a la lista devuelta (`Pathfinder.cc:227-231`).

`Door::switchNodes` aplica `changeNodeState(id, open)` a **todos** los ids devueltos (`Door.cc:143`): puerta cerrada ⇒ nodos deshabilitados (A* los ignora en `getNearestCenter`, `getMinCost` y expansión); abierta ⇒ habilitados. Estado inicial: `open=false` (`Door.cc:45`), pero justo tras `addDoor` el nodo central está **habilitado** hasta el primer `Open/Close/Switch` (incoherencia menor). `Switch` añade fundido de **1000 ms** (`Door.cc:103,108`) y activa/desactiva el cuerpo físico.

Además, `Map::generateDoorColisions` (`Map.cc:1041-1053`) mete los polígonos de puerta **expandidos por `charRadius`** como sensores permanentes en `mapWorld`, de modo que `hasVision` (nodo más cercano y suavizado) trata las puertas como muros **independientemente de su estado**.

### 4.7 Consumo del camino

`Bot::Move()` (`Bot.cc:373-404`): actualiza `MovementComp` (steering `FollowPath`, §7), aplica la velocidad al cuerpo Box2D (`setLinearVelocity`), fija el ángulo desde la velocidad y devuelve "llegado" si está a ≤ **5** px de `path.back()` (`Bot.cc:403`). Existe una variante `Bot::Move(int radius)` (`Bot.cc:346-371`, fuerza fija **50**) **sin llamadores**.

---

## 5. Triangulación

### 5.1 Algoritmo de `Triangulation` (`Math/lib/Triangulation.cc`)

Es una **Delaunay incremental** (inserción punto a punto con localización por barrido lineal y legalización por volteo de aristas, tipo Lawson; no es Bowyer-Watson por cavidad):

1. `createBorders(i, f)` (`Triangulation.cc:61-123`): rectángulo envolvente ampliado **2× la extensión en cada eje** (`excesoX = |px−nx|·2`, `Triangulation.cc:88-89`) → 4 súper-vértices `pxpy, pxny, nxpy, nxny` y 2 triángulos iniciales.
2. `addPoint`/`addPoints` deduplican contra vértices ya triangulados y contra la lista pendiente (`Triangulation.cc:138-174`).
3. `stepDelaunay()` (`Triangulation.cc:199-392`): toma `puntos[0]`, localiza el triángulo que lo contiene con `Tri::isInside` en barrido lineal (`Triangulation.cc:208-209`). Si está **dentro** (`rel==1`) divide en 3 (`nab, nbc, nca`) y legaliza sus lados externos (`Triangulation.cc:211-251`). Si está **sobre un lado** (`rel==0`) divide los dos triángulos que comparten el lado en 4 (`Triangulation.cc:252-380`). Si está **fuera** (`rel==-1`) el punto se descarta en silencio (`Triangulation.cc:383-388`).
4. `legalize(tri, lado)` (`Triangulation.cc:425-464`) usa el test in-circle `Tri::liesInside(i,j,k,l)` (`Tri.cc:67-104`): determinante 3×3 tras forzar orden antihorario, `> 0.0` ⇒ voltear; `flipEdge` (`Triangulation.cc:466-575`) crea `t1,t2`, recablea vecinos con `swapP` y legaliza recursivamente los 4 lados nuevos (`Triangulation.cc:570-573`).
5. `finishedDelaunay()` elimina todo triángulo que toque un súper-vértice (`removeP`, `Triangulation.cc:184-197, 394-410`).

Robustez: `double` sin predicados exactos; `Tri::isInside` compara productos vectoriales con `== 0` exacto (`Tri.cc:330-334`); `Tri::side` usa ε = **0.001** (`Tri.cc:353-356`); `Point(x,y)` anula |v| < 1e-6 (`Point.h:37-47`) y la igualdad de puntos tiene tolerancia **0.1** (`Point.cc:41-45`). `Matrix<T>::determinant` sólo es válido hasta 3×3 (`Matrix.h:185,633-663`). `Tri::isCounterClockwise` devuelve `o < 0.0` (`Tri.cc:236-247`), es decir, lo contrario de lo que hace `makeCounterClockwise` (`Tri.cc:219-234`); no tiene llamadores. `quicksort` por distancia (`Triangulation.cc:577-605`) no se usa. El constructor `Triangulation(std::vector<Node>)` está declarado (`Triangulation.h:43`) pero **no definido**. El constructor de copia **no copia** la triangulación: reinicia a los dos triángulos del borde (`Triangulation.cc:20-36`).

### 5.2 Pipeline de `Map::generateTriangulation` (`core/lib/Map.cc:562-647`)

Radio de personaje: `charRadius = Core::Radius = 30` (`Map.cc:16,30,81`; `CoreNamespace.h:10`). (El `charRadius = 10` de `Pathfinder` (`Pathfinder.cc:7,48,55`) no se usa para nada.)

1. **Geometría de entrada** (`Map.cc:564-587`): `objectList = murosV` (paredes de 4 vértices del XML) + contorno de cada obstáculo (`Model2D::getShape()->getPuntos()` rotado por su ángulo y trasladado). Las **puertas no entran** como obstáculo (se tratan como sensores en el paso 9). `pointList = perimetroV`.
2. **Orientación** (`Map.cc:589-596`): todo objeto se pone antihorario (`Polygon::isClockwise` → `Reverse`). El perímetro no se toca.
3. **Expansión por radio** — `expandGeometry` (`Map.cc:756-769`): `Polygon::Expand(30, true)` al perímetro y a cada objeto. `Expand` (`Polygon.cc:481-501`) desplaza cada par de lados adyacentes `distance` a lo largo de su perpendicular (`perpCCW` si `dextrogiro`, `Polygon.cc:274-278`) y toma la **intersección de las rectas** (`getNewPoint`, `Polygon.cc:265-297`; `equ::Intersection`, `LineEquation.cc:69-101`). Es un offset **"miter" sin límite**: en ángulos agudos genera picos; si las rectas son paralelas devuelve `(0,0)` (`LineEquation.cc:85-88`). El sentido (dilatar o contraer) depende de la orientación del polígono: con `dextrogiro=true` el desplazamiento va hacia la **izquierda** del sentido de recorrido. Los objetos se fuerzan siempre a la misma orientación en el paso 2, pero **el perímetro no se normaliza**: se toma tal cual viene en el XML. En los mapas de ejemplo (p. ej. `testFiles/maps/mapRuben.xml`) el perímetro está recorrido en sentido opuesto al que reciben los objetos, de modo que el mismo `dir=true` contrae el perímetro y dilata los objetos; un mapa con el perímetro al revés invertiría el efecto sin aviso.
4. **Aplanado de geometría** — `flattenGeometry` (`Map.cc:879-958`): cuerpos sensor Box2D por polígono en un `World` temporal; mientras dos objetos estén en `contact` se **unen con GPC** (`Polygon::Join` → `gpc_polygon_clip(GPC_UNION)`, `Polygon.cc:355-369`); después, los objetos en contacto con el perímetro se **recortan** al perímetro (`Polygon::Inter` → `GPC_INT`, `Polygon.cc:417-431`). `fromGPC` conserva **sólo `contour[0]`** (`Polygon.cc:317-325`): se pierden agujeros y contornos múltiples.
5. **Caja envolvente** (`Map.cc:602-621`): bug — la comprobación de `hY` está duplicada y `lY` nunca se actualiza (`Map.cc:614-617`), así que `minY` = Y del primer vértice. Lo enmascara el 2× de `createBorders`. (El mismo bug existe en `loadData`, `Map.cc:159-162`.)
6. **Delaunay** (`Map.cc:628-637`): `createBorders(supIzq, infDer)`, `addPoints` del perímetro expandido y de cada objeto, `continueDelaunay`, `finishedDelaunay`.
7. **Aplanado de la triangulación** — `flattenTriangulation` (`Map.cc:677-739`): `createCollision` crea `mapWorld` con sensores del perímetro y objetos expandidos (`Map.cc:771-795`). Para cada triángulo se buscan cortes de sus tres lados con la geometría (`World::CutOffPoints`, `Map.cc:697-699`); el primer punto de corte se inserta en la Delaunay (`addPoint` + `stepDelaunay`, `Map.cc:713-716`) y se reinicia el barrido; los puntos añadidos se insertan también en los polígonos (`Map::addPoint`, `Map.cc:804-859`: en el lado colineal con `Tri::side == 0` y proyección dentro del segmento). Es una aproximación iterativa a una **Delaunay restringida** (CDT): no garantiza que todos los lados de la geometría acaben siendo aristas y termina cuando la deduplicación rechaza el punto.
8. **Eliminación de triángulos no navegables** — `removeTris` (`Map.cc:741-754`): se elimina todo triángulo cuyo incentro tenga un número **par** de cortes con `mapWorld` en el rayo hasta `(-999999,-999999)` (fuera del perímetro = 0 cortes; dentro de un obstáculo = 2). Quedan los triángulos del área caminable.
9. `generateDoorColisions` (`Map.cc:1041-1053`): puertas `Expand(charRadius)` como sensores en `mapWorld`.
10. `addExtraCollision` (`Map.cc:649-675`): perímetro y paredes `Expand(charRadius·0.95, false)` añadidos también a `mapWorld`. Al añadir cuerpos, cambia la paridad de cortes para llamadas posteriores; como `removeTris` ya se ejecutó sólo afecta a `hasVision` (más bloqueos). Es un parche dependiente del orden.

### 5.3 Usos de la triangulación además de la navegación

| Uso | Dónde | Detalle |
|---|---|---|
| Grafo de navegación | `Pathfinder::makeDualGraph` | §4.3 |
| Visibilidad para suavizado / nodo más cercano | `Map::hasVision` (`Map.cc:1018-1024`) | Cortes con sensores de `mapWorld` (geometría expandida), no con la triangulación en sí |
| Área del mapa para el Simplex | `Map::getArea` (`Map.cc:1005-1016`) | `Σ Tri::Area()/1000.0` (Herón, `Tri.cc:360-371`); unidades: **miles de px²** |
| Puntos de aparición de enemigos | `Map::getTriCenters(minArea)` (`Map.cc:1067-1077`) | Incentros de triángulos con `Area() >= 2000` px² (`Optimization.cc:144`), a más de **200** px del jugador (`Optimization.cc:152`) |
| Puntos de patrulla | `Map::getTri(p)` (`Map.cc:1030-1039`) | Vértices del triángulo que contiene el punto de aparición (`EntityManager.cc:353-356`) |
| Depuración visual | `Graphics/lib/Scene.cc:97-110` | Dibuja nodos (azul habilitado / blanco deshabilitado) |

La percepción de los bots **no** usa la triangulación (§3.6).

### 5.4 `Polygon` y GPC

* Tipos: `POL_NONE/POLYGON/CIRCLE/EDGE/CHAIN` (`Polygon.h:14-18`); un círculo se discretiza con **300** vértices (`Polygon.cc:20`); un polígono con centro se clasifica por nº de vértices: 2 arista, 3–8 polígono, >8 círculo (`Polygon.cc:34-39`).
* GPC (General Polygon Clipper, `3rdParty`): `Join` (UNION), `Diff` (DIFF), `Inter` (INT), `getTriStrip`, `DiffToTriStrips` (`Polygon.cc:299-431`). Sólo se usan `Join` e `Inter` en el pipeline del mapa. GPC históricamente es de uso libre sólo no comercial: **riesgo de licencia** para un remake distribuido.
* `isClockwise` devuelve `Σ (x2−x1)(y2+y1) < 0` (`Polygon.cc:179-192`); con la convención habitual (Y hacia arriba) ese sumatorio es **positivo** para un polígono horario, así que la función devuelve lo contrario de lo que indica su nombre y todo el pipeline está escrito contra ese signo invertido; `makeConvexHull` (envolvente por barrido, `Polygon.cc:205-241`) y `removeColinear` (ε 0.001, `Polygon.cc:243-263`) no se usan en el pipeline.

### 5.5 `GraphUD<T>` y `Matrix<T>`

* `GraphUD` (`Math/include/GraphUD.h`) es un grafo no dirigido genérico sobre `Node*`. **No lo usa ni `NavGraph` ni `Pathfinder`** (sólo el `#include` en `Pathfinder.h:4`). Tiene bugs propios: `getNumNodes` devuelve `numNodes + 1` (`GraphUD.h:179`); el constructor de copia itera sobre el vector propio vacío y no copia nada (`GraphUD.h:143-152`); el destructor borra mientras itera (`GraphUD.h:155-175`).
* `Matrix<T>` (`Math/include/Matrix.h`): índices 1-based en `operator()` con **redimensionado automático** al escribir fuera de rango (`Matrix.h:423-443`, usado por el parser del Simplex), `determinant` (`Matrix.h:633-663`, sólo ≤3×3), `inverse` y `baseTo(base)` (Gauss-Jordan para poner la identidad en las columnas de la base, `Matrix.h:863-893`). La usa `Tri::liesInside` con `double` y el Simplex con `Rational`.

---

## 6. Simplex y generación adaptativa de enemigos

### 6.1 Entrada: área y dificultad

`GameAction.cc:189-200`:

```
dif = nivelPlanta * dificultad      si nivelPlanta != -1
dif = dificultad * dificultad       si nivelPlanta == -1 (modo libre)
opti->CargarFuncionObjetivo(mapa->getArea(), dif);
opti->CalcularEnemigos();
opti->CargarEnemigos(mapa, ia->getPf());
```

* `dificultad ∈ {1.0, 1.3, 1.5}` (mín/media/máx; `GameOptions.cc:243-246`, doc en `GameOptions.h:77-80`).
* `nivelPlanta`: 0 al crear `GameStatus` (`GameStatus.cc:27`), se pone a **1** al empezar partida (`Aplication.cc:64,196,206`), se incrementa por planta (`GameStatus::incrementLevel`, `GameStatus.cc:19-21`), el juego termina al llegar a **9** (`Aplication.cc:228,237,285`); `-1` en modo libre (`Aplication.cc:186`). Con `nivelPlanta < 8` se añade un `e_miniboss`, si no un `e_megaboss` (`GameAction.cc:203-208`), fuera del Simplex.
* `tam = Map::getArea()` = Σ área de triángulos navegables / 1000 (miles de px²).

### 6.2 `Optimization::CargarFuncionObjetivo(tam, dif)` (`Optimization.cc:90-109`)

```
MaxEnemies = log((tam / 250.0) * dif) * 10;          // línea 91, log natural
maxDa = (280 / 3) * MaxEnemies;                        // 93 -> 280/3 es división ENTERA = 93
maxHp = (155 / 3) * MaxEnemies;                        // 94 -> 51
maxVe = (140 / 3) * MaxEnemies;                        // 95 -> 46
obj = "Max z x1 + x2 + x3"
r1  = "60x1 + 100x2 + 120x3 <= %f3"  (maxDa)          // 98
r2  = "45x1 + 50x2+ 65x3 <=  %f3"    (maxHp)          // 100
r3  = "60x1 + 45x2 + 35x3 <=  %f3"   (maxVe)          // 102
```

Lectura de la fórmula de `MaxEnemies`: número máximo de enemigos "presupuestables" = 10·ln(área relativa × dificultad), donde `250` (miles de px²) es el área de referencia para la que `ln(1·dif)` arranca en 0, y `10` la ganancia. Es logarítmica: duplicar el área añade ~6.9 enemigos; multiplicar `dif` por 12 (planta 8, difícil) añade ~24.8. Si `(tam/250)·dif < 1`, `MaxEnemies` es **negativo** y `CalcularEnemigos` no hace nada (`E1=E2=E3=0`, `Optimization.cc:113`). Valores de referencia calculados con la fórmula actual para `tam = 1000` (mapa de ~1 000 000 px²): dif 1.0 → 13.9; 1.5 → 17.9; 4 → 27.7; 8 → 34.7; 12 → 38.7.

El comentario de la línea 91 ("1000000: cambio de unidad… 15: Constante de multiplicacion") describe una **fórmula anterior** `ln((tam/1e6)·dif)·15`. Lo confirman los tests: `testOpti.cc:38` llama con `(4773784, 8)` y `test.cc:33-36` usa los RHS `5133.333 / 2841.666 / 2566.666`, que son exactamente `280/3 · 55`, `155/3 · 55`, `140/3 · 55` con división real y `55 ≈ ln(4.77·8)·15 = 54.6`. Con la fórmula actual esa misma entrada daría 119.4. Es decir: **las constantes de los tests no corresponden al código actual**, y el código actual usa división entera (93/51/46) donde los tests usaron 93.33/51.67/46.67.

Interpretación de las restricciones (tres "presupuestos" por partida, coeficiente = coste unitario de cada tipo de enemigo `x1=e_enemy1, x2=e_enemy2, x3=e_enemy3`):

| Restricción | Coeficientes (E1, E2, E3) | Presupuesto | Correspondencia con `Features` |
|---|---|---|---|
| `r1` "Da" (daño) | 60 / 100 / 120 | 93·N (= media 280/3 de los coeficientes) | No coincide con `Damage` (1/3/4) ni `Cadence` |
| `r2` "Hp" (vida) | 45 / 50 / 65 | 51·N (155/3; la media real sería 160/3) | **Coincide exactamente con `HP`** de `e_enemy1/2/3` (`CoreNamespace.h:173,188,203`) |
| `r3` "Ve" (velocidad) | 60 / 45 / 35 | 46·N (= media 140/3) | No coincide con `Speed` (180/150/130); misma monotonía |

Al ser el presupuesto ≈ coste medio × N, la LP relajada da `Z ≈ N` y la solución entera **favorece masivamente al tipo 2** (el más equilibrado en los tres presupuestos). Óptimo entero exacto de la formulación (calculado por fuerza bruta como referencia, no es salida del legacy): N=10 → (0, 8, 1); N=20 → (1, 18, 0); N=30 → (3, 26, 0); N=39 → (5, 32, 1); N=55 → (10, 39, 5). El solver legacy puede devolver otro punto entero (ver 6.4).

### 6.3 Parser de restricciones (`Simplex.cc:109-283`)

* Coeficiente `0` se interpreta como `1` (`Simplex.cc:166-167`): permite `x1 + x2`.
* Término independiente con **`atoi`** (`Simplex.cc:193`) ⇒ el `%f3` (que imprime p. ej. `5115.0000003`, un `%f` seguido del carácter literal `3`) se **trunca a entero**. Todo el PL es entero.
* Holguras: `<=` añade columna `+1`, `>=` añade `-1` (`Simplex.cc:187-190`).
* `Max` ⇒ el objetivo se multiplica por `Z = -1` (`Simplex.cc:221,281`) y se resuelve como mínimo; `CalculaZ` deshace el signo (`Simplex.cc:481-488`).

### 6.4 Resolución: `SimplexInt` (`Simplex.cc:696-752`) sobre `SimplexPenal` / `SimplexDual`

* **Aritmética exacta con `Rational`**: sí. `Matrix<Rational>` en todo el tablero (`Simplex.h:188-194`), `Rational = int n / int d` (`Rational.h:178-180`). Sin coma flotante en el pivotaje (`Matrix::baseTo`, Gauss-Jordan exacto, `Matrix.h:863-893`). Pero `int` de 32 bits: los productos `n·n`, `d·d` (`Rational.cc:235-243`) pueden desbordar, y `MCD`/`MCM` son **bucles de fuerza bruta O(max)** (`Rational.cc:316-345`) ejecutados en cada operación → coste que explota con numeradores grandes.
* **Simplex entero: sí**, por ramificación y acotación (`SimplexInt`): cola FIFO de nodos (`NV`, `Simplex.cc:702,747`), como máximo **30 iteraciones** (`Simplex.cc:705`); cada nodo se resuelve con `SimplexPenal` (Big-M con `M = 999999`, `Simplex.cc:515`; si hay RHS negativo delega en `SimplexDual`, `Simplex.cc:570,629`); se ramifica sobre la **primera variable fraccionaria por índice** (`varFloat` ordenado, `Simplex.cc:549-557`) añadiendo `x_i <= floor` / `x_i >= floor+1` (`forzarEntero`, `Simplex.cc:681-694`). Se acepta como óptimo el primer entero cuyo `Z` iguale a `floor(Z_LP)` del nodo raíz (`maxZ`, `Simplex.cc:712-713,732`); si no, se conserva el mejor con `Z <= nodo->Z` (`Simplex.cc:739`).
* Regla de entrada Dantzig (`indiceEntraP`, máximo `Zj−Cj`, `Simplex.cc:439-450`). Regla de salida por razón mínima **inicializada a `min = 99`** (`Simplex.cc:426`): cualquier razón ≥ 99 no se elige; si **todas** las razones de la columna entrante lo son, `sale = 0`, la base no cambia y **el bucle de `SimplexPenal` no termina** (no tiene tope de iteraciones). Con los presupuestos del juego, en el primer pivote entra `x1` (todos los `Zj−Cj` valen 1 y se elige el primero, `Simplex.cc:443-447`) y la razón mínima es `46·N/60 ≈ 0,77·N`, así que el bloqueo exigiría **N ≥ 129**; en pivotes posteriores las razones cambian y no se ha acotado. Para los mapas y dificultades reales N < 40 (ver 6.2): es un riesgo latente, no un fallo observado.
* Otros defectos: el constructor de copia y `operator=` **duplican** el vector `Base` (`Simplex.cc:52-54, 99-103`; inocuo porque `getXi` sólo mira las primeras F posiciones, `Simplex.cc:802-813`); `varEnteras` omite la última fila (`Simplex.cc:543`, no se usa).

### 6.5 `CalcularEnemigos` (`Optimization.cc:111-133`) y `CargarEnemigos` (`Optimization.cc:135-172`)

* Si `MaxEnemies > 0`: `status = SimplexInt()`; si `0` → `E1 = ⌊x1⌉, E2 = ⌊x2⌉, E3 = ⌊x3⌉` truncados (`getValorInt`, `Optimization.cc:117-119`). Si `status != 0` o `E1+E2+E3 == 0` → **fallback** `E1 = E2 = E3 = (int)(MaxEnemies/3)` (`Optimization.cc:126-128`).
* Colocación: candidatos = `getTriCenters(2000)`; se repite `max = E1+E2+E3` veces: índice aleatorio; si el punto está a **> 200** px del jugador se crea el enemigo con ángulo 0 en el orden **primero todos los E1, luego E2, el resto E3** (`Optimization.cc:153-161`); si no, se descarta el candidato **y se consume la iteración** (`Optimization.cc:163-168`), por lo que pueden aparecer **menos** enemigos que `max`. Devuelve `insertados`.
* El resultado no se persiste ni se recalcula en partida: es un cálculo único al cargar la planta.

---

## 7. Steering behaviors

### 7.1 `MovementComp` (`core/lib/MovementComp.cc`)

`Update()` (`MovementComp.cc:57-85`), integración de Euler por frame:

```
dt = ms_transcurridos / 1000              // 58
si dt <= 0.5:                             // 61  (se ignora el frame si pasaron >500 ms)
  F = steering->Calculate()
  a = F / masa                            // 64
  v += a * dt ; v.Truncate(maxSpeed)      // 66-70
  si 1.05 <= |v| < 5 : v.Truncate(1)      // 73-74  banda muerta anti-vibración
  pos += v * dt                           // 76
  si |v|^2 > 1e-8 : heading = v/|v| ; side = perpCW(heading)   // 78-82
```

`getMeEstoyMoviendo()` = `|v| > 10` (`MovementComp.cc:195`). `setLeader(mov)` cambia a modo 1 si `mov != NULL`, a 0 si es `NULL` (`MovementComp.cc:172-181`).

Parámetros por entidad:

| Entidad | maxSpeed | masa | maxForce | Fuente |
|---|---|---|---|---|
| Player | 400 | 1 | 4 | `Player.cc:71-73` |
| Enemy (todos los tipos y jefes) | 400 | 1 | 4 | `Enemy.cc:235-237, 277-279` |
| Captain | 400 | 1 | 4 | `Captain.cc:203-205, 235-237` |
| Technic / Especialist / Explosive (constructor con posición, el que usa el juego) | `speed` de Features = 175 / 130 / 145 | 1 | `force` de Features = 3 | `Technic.cc:253-255`, `Especialist.cc:236-238`, `Explosive.cc:240-242`; valores en `CoreNamespace.h:130-131,145-146,160-161` |
| Bot genérico | `getSpeed()` | — | — | `Bot.cc:56,86` |

Los `Speed` de Features de enemigos (180/150/130/80/60) **no** se aplican al `MovementComp` de `Enemy` (queda 400). La velocidad final la recorta además Box2D.

### 7.2 `SteeringBehavior` (`core/lib/SteeringBehavior.cc`)

Sólo dos modos (`Calculate`, `SteeringBehavior.cc:50-61`): `0` = `FollowPath`, `1` = `OffsetPursuit(owner->getOffset())`. No hay combinación ponderada, ni evitación de obstáculos, ni separación/cohesión, ni wander, ni flee/evade.

* **Seek** (`SteeringBehavior.cc:67-72`): `desired = normalize(target − pos) · maxSpeed`; devuelve `desired − velocity · maxForce`. **No estándar** (Reynolds: `desired − velocity`); aquí `maxForce`(=4) actúa como factor de amortiguación, no como tope de fuerza (nunca se trunca la fuerza).
* **Arrive** (`SteeringBehavior.cc:74-90`): `decelTweaker = 0.3`; `speed = min(dist / (deceleration · 0.3), maxSpeed)`; `desired = toTarget · speed / dist`; devuelve `desired − velocity · maxForce`.
* **FollowPath** (`SteeringBehavior.cc:101-115`): `Seek(waypointActual)`; avanza de waypoint cuando `Distance < 5` (`SteeringBehavior.cc:107`); terminado el camino, fuerza `= velocity · (−2)` (freno).
* **OffsetPursuit** (`SteeringBehavior.cc:121-137`): `worldOffset = offset` rotado por el ángulo entre `(0,10)` y el heading del líder y trasladado a su posición (`Vector2D::localToWorld`, `Vector2D.cc:158-162`). Si `|toOffset| >= 1`: `lookAheadTime = |toOffset| / |(maxSpeed + leaderVelocity)|` — **bug**: `maxSpeed` (400.0) se convierte implícitamente a `Vector2D(400°)` (constructor por ángulo, `Vector2D.cc:50-53`) y se suma a la velocidad del líder; luego `Arrive(worldOffset + leaderVelocity · lookAheadTime, 1)`. Si `|toOffset| < 1`: `−velocity`.
* `Path` (`core/lib/Path.cc`): `setWaypoints(vector<Point>)` guarda posiciones **absolutas** como `Vector2D` (`Path.cc:56-68`); el constructor `Path(vector<Point>)` guarda **diferencias** (`Path.cc:36-46`), incoherente pero sin uso desde `MovementComp`.

### 7.3 Formación (offsets de `OffsetPursuit`)

`Player.cc:34-45` (constructor por defecto) y `Player.cc:75-85` (constructor con posición, el usado): `offsetX = Radius·4 = 120`, `offsetY1 = Radius·(−2) = −60`, `offsetY2 = Radius·(−4) = −120`; `v1 = (−120, −60)`, `v2 = (120, −60)`, `v3 = (0, −120)` en coordenadas locales del líder. El constructor por defecto añade "aleatoriedad" `(rand()%100)/100.0 − 50` (`Player.cc:39-41`), que en realidad es un desplazamiento casi constante de **−50**. Asignación de offsets a compañeros según el tipo del jugador en `GameAction.cc:213-236`.

### 7.4 Enlace con la física

`Bot::Move()` (`Bot.cc:373-404`): `mov->setPos(centro)`, `mov->Update()`, `setLinearVelocity(mov->getVelocity())` al cuerpo Box2D, ángulo desde la velocidad, y actualización del cono. Es decir, el steering calcula una velocidad deseada y Box2D la aplica (con colisiones); la posición interna del `MovementComp` se re-sincroniza desde el cuerpo cada frame.

---

## 8. Puntos críticos para el remake

| Concepto | Cómo está en el legacy | Veredicto | Justificación técnica | Riesgo si se ignora |
|---|---|---|---|---|
| Estados y transiciones de enemigos (Patrol/Attack/Pursue/Ensure) y condiciones que los disparan | `Enemy.cc:20-205`; inputs 10/20/30/40 | **REPLICAR** | Es el comportamiento jugable observable: patrulla en triángulo, persecución a última posición conocida, giro de 360° al llegar, reacción a disparos recibidos. | Enemigos con "personalidad" distinta; se pierde la sensación del juego original. |
| Estados de aliados (FollowPlayer/Attack/GotoPoint) y umbrales de vida/munición por rol | `Captain.cc`, `Technic.cc`, `Especialist.cc`, `Explosive.cc` (§2.4) | **REPLICAR** (umbrales) / **REDISEÑAR** (estructura) | Los umbrales (30/5, 10/1, 15/10, 50/1; hp<20 para buscar al capitán; radios 150/200) definen el rol de cada compañero. Las 4 clases son copia-pega; en Godot basta una escena/clase con parámetros. | Compañeros que no van a curarse/reabastecerse cuando el jugador lo espera. |
| Estado `ComeBack` y `Debug`; `partialRotation`; `Bot::Move(int)`; tabla `AI::makeFSM`; `GraphUD` | Código sin llamadores (§2.3, §2.4, §4.7, §5.5) | **DESCARTAR** | Verificado por grep: nunca se ejecutan. | Arrastrar deuda y confundir el diseño del remake. |
| FSM tabular genérica por nombre de estado y despacho por `string` cada frame | `FSM.cc`, `Enemy.cc:22-39` | **REDISEÑAR** | Godot ofrece máquinas de estado por nodos/enum; comparar cadenas cada frame y no tener `enter/exit` es un lastre. Conservar la **semántica** (tabla determinista input→destino), no la clase. | Ninguno funcional; sólo rendimiento y mantenibilidad. |
| Formato `testFiles/fsm/*.txt` | `FSM::loadData` (§2.2); sólo herramientas | **DESCARTAR** | El juego no lo carga; las FSM reales están en código. Si se quiere data-driven, usar `Resource`/JSON de Godot. | Ninguno. |
| Cono de visión 500 px / ±20° | `Bot.cc:187-217, 251-260` | **REPLICAR** | Define el alcance de detección y por tanto la dificultad. Unificar los dos tests (triángulo en `enemySpotted`, sector en `isInsideFOV`) en un sector circular con `Area2D`/raycast. | Detección demasiado fácil o difícil respecto al original. |
| Visión secundaria 500–700 px y retorno `2` de `isInsideFOV` | `Bot.cc:194,205,214`; `Enemy.cc:112` | **DESCARTAR** | Nunca se evalúa; rama muerta. Si se desea "sospecha a distancia", diseñarla de cero. | Ninguno. |
| Línea de visión por raycast físico (primer cuerpo = objetivo) | `Bot.cc:302,443` | **REPLICAR** | Equivale a `PhysicsDirectSpaceState2D.intersect_ray` con máscaras; comportamiento correcto y barato. | Enemigos que ven a través de muros. |
| `enemyValue = 1/distancia` (más cercano gana) | `Bot.cc:416-418` | **REPLICAR** (como base) | Es la heurística real; sencilla y predecible. Ampliable con pesos por amenaza sin romper la fidelidad si la distancia domina. | Cambiar el objetivo preferido cambia el "feel" de los tiroteos. |
| Última posición conocida (`currentObj`) y "memoria" volátil | `Bot.cc:287-344`; `Enemy.cc:119-124` | **REPLICAR** (`currentObj`) / **REDISEÑAR** (`memory`) | La persecución a la última posición es la pieza de IA más reconocible. `memory` sólo dura mientras el objetivo es visible y acumula duplicados: sustituir por un `Dictionary id→última_vista`. | Enemigos que se "olvidan" instantáneamente o persiguen fantasmas. |
| Cola de atacantes (reacción a disparos) | `Bot.cc:22-24`, `EventControl.cc:155-162`, `Enemy.cc:69-71` | **REPLICAR** | Hace que emboscar tenga consecuencias: el enemigo va a la posición del tirador. Sustituir `queue` por señal `hit_by(position)`. | Enemigos pasivos ante fuego enemigo fuera de su cono. |
| Patrulla = vértices del triángulo de aparición, radio 10, salto +1/+2 aleatorio | `EntityManager.cc:352-356`, `Enemy.cc:50-55` | **REPLICAR** (semántica) / **REDISEÑAR** (fuente) | La patrulla "corta y local" es característica. En Godot obtener el polígono de `NavigationRegion2D` en el punto de spawn o definir puntos de patrulla en el editor. | Enemigos estáticos o con patrullas largas que cambian la dificultad. |
| Ensure: giro 1°/frame × 360 frames | `Enemy.cc:158-167` | **REDISEÑAR** | Dependiente del framerate. Reemplazar por giro de 360° en tiempo fijo (p. ej. 6 s a 60 fps equivalentes) con `delta`. | Duración del giro variable según la máquina. |
| A* sobre grafo incentros+vértices, heurística euclídea, suavizado LOS voraz | `Pathfinder.cc:103-170, 242-261, 348-456` | **REDISEÑAR** | `NavigationServer2D`/`NavigationAgent2D` (funnel sobre malla) hace lo mismo mejor y sin el bug de no actualizar `g` (`Pathfinder.cc:417-426`). Conservar sólo la intención: rutas que pasan cerca de esquinas expandidas por el radio. | Reimplementar un A* con defectos conocidos y listas O(n). |
| Puertas: habilitar/deshabilitar nodos + nodo central | `Pathfinder.cc:172-235`, `Door.cc:139-146` | **REDISEÑAR** | En Godot: `NavigationLink2D` o región/`NavigationObstacle2D` conmutable, o capas de navegación por puerta. Mantener la semántica: puerta cerrada = intransitable; abierta = transitable; fundido 1000 ms. | Puertas que bloquean o no la navegación de forma incoherente con su estado visual. |
| Formato `.nav` XML | `NavGraph.cc:282-350`; `editorMap.xml.nav` | **DESCARTAR** | Escritura con UB (datos corruptos en el fichero real), lectura incompatible, nunca usado por el juego. | Intentar "importar" datos basura. |
| Triangulación Delaunay propia + aplanado iterativo + `removeTris` | `Triangulation.cc`, `Map.cc:562-754` | **REDISEÑAR** | Godot 4 genera la malla con `NavigationPolygon`/`NavigationServer2D.bake_from_source_geometry_data` (CDT robusta). El legacy no garantiza restricciones, usa aritmética inexacta y ε ad hoc. | Meses reimplementando geometría frágil que el motor ya resuelve. |
| Expansión por radio de personaje 30 px (offset "miter") | `Map.cc:756-769`, `Polygon.cc:481-501`, `Core::Radius=30` | **REPLICAR** (valor) / **REDISEÑAR** (método) | El radio determina por dónde caben los personajes. Usar `agent_radius = 30` en el `NavigationPolygon` (offset tipo Clipper con límite de miter). | Personajes atascados en esquinas o pasillos que antes eran transitables. |
| GPC (unión/intersección de polígonos) | `Polygon.cc:299-431` | **DESCARTAR** | Licencia no comercial; `Geometry2D.merge_polygons/clip_polygons/offset_polygon` cubren el uso. | Problema legal y dependencia C antigua. |
| Área navegable → `MaxEnemies = 10·ln((área/250)·dif)` | `Optimization.cc:91`, `Map.cc:1005-1016` | **REPLICAR** | Es el núcleo de la "generación adaptativa": pocos enemigos en mapas pequeños/fáciles, crecimiento logarítmico. Calcular el área desde la malla de navegación de Godot en las mismas unidades (px²/1000). | Curva de dificultad distinta al original. |
| `dif = planta × {1.0, 1.3, 1.5}` (o `dificultad²` en modo libre) | `GameAction.cc:189-197`, `GameOptions.cc:243` | **REPLICAR** | Progresión de dificultad del juego. | Idem. |
| Presupuestos 93/51/46 por enemigo y costes (60,100,120)/(45,50,65)/(60,45,35) | `Optimization.cc:93-102` | **REPLICAR** (los números) / **REDISEÑAR** (el solver) | Definen la mezcla de tipos. Un PL de 3 variables y 3 restricciones se resuelve en el remake con enumeración entera exacta en microsegundos (Z ≤ 40); no hace falta Simplex. Documentar que el resultado esperado favorece al tipo 2. | Mezcla de enemigos distinta; o, si se copia el Simplex, heredar el riesgo de no terminación con presupuestos grandes (`min = 99`) y el coste de `Rational`. |
| Fallback `E1=E2=E3=MaxEnemies/3` | `Optimization.cc:126-128` | **REPLICAR** | Garantiza enemigos aunque el solver falle. | Plantas vacías ante un fallo numérico. |
| Spawn: incentros de triángulos ≥ 2000 px², a > 200 px del jugador, orden E1→E2→E3, iteraciones consumidas al descartar | `Optimization.cc:144-168` | **REPLICAR** (reglas) / corregir el consumo de iteraciones | Distribución espacial reconocible; el "área mínima" evita spawns en pasillos estrechos. | Enemigos apareciendo encima del jugador o en huecos. |
| `Rational`/`Matrix<Rational>`/`Simplex` como biblioteca | `Math/`, `Optimization/lib/Simplex.cc` | **DESCARTAR** | Aritmética exacta pero con `int32`, MCD por fuerza bruta y varios bugs; es un ejercicio académico. | Rendimiento y desbordamientos. |
| Steering: `Seek`/`Arrive` con `− velocity·maxForce` y `decelTweaker 0.3`; banda muerta 1.05–5; dt máx 0.5 s | `SteeringBehavior.cc:67-90`, `MovementComp.cc:57-85` | **REPLICAR** (sensación) / **REDISEÑAR** (fórmula) | El "peso" del movimiento viene de estas constantes. En Godot usar `NavigationAgent2D` + `velocity.move_toward` o reproducir `desired − k·velocity` con `k=4` como amortiguación explícita y tope de aceleración. | Movimiento demasiado brusco o flotante respecto al original. |
| Formación en OffsetPursuit: offsets (−120,−60), (120,−60), (0,−120) | `Player.cc:75-85` | **REPLICAR** | Posición de los compañeros alrededor del jugador. Corregir el `lookAheadTime` (bug de conversión) y el "jitter" de −50. | Compañeros que se apelotonan o quedan mal colocados. |
| maxSpeed/masa/maxForce: 400/1/4 (jugador, enemigos, capitán) y Features 175/130/145 con fuerza 3 (técnico, especialista, explosivos) | §7.1 | **REPLICAR** (con revisión) | Son las velocidades efectivas. Nótese la incoherencia: `Speed` de Features **no** se aplica a enemigos. Decidir explícitamente si el remake usa 400 o los Features (180/150/130/80/60). | Velocidades relativas distintas cambian el equilibrio. |
| Convenio de ángulo `−atan(dy/dx)` en grados | `Character.cc:371-398`, `Bot.cc:383-387` | **REDISEÑAR** | Mezcla de signos dependiente de ejes; usar `Vector2.angle()`/`atan2` con un único convenio. | Conos y rayos apuntando en espejo. |
| Doble mundo físico (`mapWorld` de sensores para LOS + mundo de juego) | `Map.cc:771-795`, `Bot.cc:302` | **REDISEÑAR** | En Godot basta un espacio físico con capas: capa "geometría estática" para LOS de navegación, capas de entidades para percepción. | Duplicar la geometría y desincronizarla. |

---

## 9. Constantes numéricas a preservar

Todas las rutas relativas a `legacy/trunk/`.

**Percepción**
* `500` — distancia de visión (px): `core/entities/lib/Bot.cc:15`, `:58`, `:87`, `:110`, `:140`, `:251`; radios del triángulo de visión `Bot.cc:190-191`, `:201-202`, `:209-210`; alcance del rayo láser `core/entities/lib/Character.cc:402-403`; mira inicial `core/entities/lib/EntityManager.cc:326-327`, `:360-361`.
* `20` — semiángulo de visión (grados): `Bot.cc:187-188`, `:198-199`, `:252`.
* `700` — visión secundaria (px, sin uso efectivo): `Bot.cc:194-195`, `:205-206`.
* `1.0 / distancia` — heurística de objetivo: `Bot.cc:417`.

**FSM / comportamiento**
* Inputs enemigos `0, 10, 20, 30, 40` — `core/entities/include/Enemy.h:14-20`; emitidos en `Enemy.cc:48, 71, 82, 86, 97, 101, 114, 121, 127`.
* Inputs aliados `0, 1, 2, 3, 4` — `Captain.cc:153-168`; emitidos en `Captain.cc:54, 60, 92, 105, 130, 133, 176`.
* `10` — radio de llegada a punto de patrulla (px): `Enemy.cc:50`.
* `rand()%2 + 1` y `% 3` — salto de patrulla: `Enemy.cc:54-55`; `rand()%3` inicial: `Enemy.cc:284`.
* `360` — grados de `fullRotation` (1°/frame): `Enemy.cc:159-161`.
* `3000` ms y `90`° — `partialRotation` (sin uso): `Enemy.cc:139, 144`.
* `150` — radio de seguimiento del Captain (px): `Captain.cc:58`.
* `200` — radio de seguimiento de Technic/Especialist/Explosive (px): `Technic.cc:58`, `Especialist.cc:58`, `Explosive.cc:60`.
* Umbrales de uso de objetos: Captain `hp <= 30`, `ammo <= 5` (`Captain.cc:21, 23`); Technic `hp <= 10`, `ammo <= 1` (`Technic.cc:21, 23`); Especialist `hp <= 15`, `ammo <= 10` (`Especialist.cc:21, 23`); Explosive `hp <= 50`, `ammo <= 1` (`Explosive.cc:21, 23`).
* Umbrales de retirada: `ammunition < 1` (`Captain.cc:83`, `Technic.cc:91`, `Explosive.cc:93`); `hp < 20` (`Technic.cc:88`, `Especialist.cc:82`, `Explosive.cc:90`).
* `2000` ms y `+1` hp — regeneración con `moral == 3`: `Character.cc:114-117`; `Moral = 3` (Captain) `core/include/CoreNamespace.h:119`; `Moral = 2` resto de aliados `CoreNamespace.h:134, 149, 164`.

**Pathfinding / puertas**
* `5` — radio de llegada de `Bot::Move()` (px): `Bot.cc:403`; avance de waypoint en `FollowPath`: `core/lib/SteeringBehavior.cc:107`.
* `50` — fuerza de `Bot::Move(int)` (sin uso): `Bot.cc:357-358`.
* `10` / `1.0` — `charRadius` por defecto de `Pathfinder` (sin efecto): `AI/lib/Pathfinder.cc:7, 16-18, 48, 55`.
* `(-99999, -99999)` — punto lejano para la prueba de paridad en `addDoor`: `Pathfinder.cc:198`; en `Map::isInside`/`isNavegable`: `core/lib/Map.cc:987, 1064`.
* `(-999999, -999999)` — idem en `removeTris`: `Map.cc:747`.
* `1000` ms — fundido de apertura/cierre de puerta: `core/entities/lib/Door.cc:103, 108`.
* `0.1` — tolerancia de igualdad de `Point` (deduplicación de nodos): `Math/lib/Point.cc:41-45`; `0.001` para `!=`: `Point.cc:93-97`.

**Triangulación / geometría**
* `30` — `Core::Radius`, radio de personaje usado para expandir la geometría: `CoreNamespace.h:10`; `Map.cc:16, 30, 81`.
* `2` — factor de exceso del rectángulo envolvente de Delaunay: `Math/lib/Triangulation.cc:88-89`.
* `0.95` — factor de la colisión extra: `Map.cc:653, 666`.
* `0.001` — épsilon de `Tri::side`: `Math/lib/Tri.cc:353, 355`; de `Point::Colinear` en `removeColinear`: `Math/lib/Polygon.cc:250, 255`.
* `1e-6` — anulación de coordenadas casi cero en `Point(x,y)`: `Math/include/Point.h:38-45`; `0.001` en `setXY`: `Point.h:135-142`.
* `> 0.0` — criterio in-circle: `Tri.cc:101`.
* `300` — vértices de un círculo discretizado: `Polygon.cc:20`; umbrales de tipo `2 / 3..8 / >8`: `Polygon.cc:34-39`.
* `1000.0` — divisor del área (`getArea` en miles de px²): `Map.cc:1012`.
* `2000` — área mínima (px²) de triángulo para spawn: `Optimization/lib/Optimization.cc:144`.
* `200` — distancia mínima al jugador para spawn (px): `Optimization.cc:152`.

**Simplex / generación de enemigos**
* `250.0` y `10` — `MaxEnemies = log((tam/250.0)*dif)*10`: `Optimization.cc:91`.
* `280/3`, `155/3`, `140/3` (división entera → `93`, `51`, `46`): `Optimization.cc:93-95`.
* Coeficientes `60, 100, 120` / `45, 50, 65` / `60, 45, 35` y objetivo `x1 + x2 + x3`: `Optimization.cc:97-102`.
* `/ 3` — fallback de reparto: `Optimization.cc:126-128`.
* `1.0, 1.3, 1.5` — niveles de dificultad: `core/lib/GameOptions.cc:44-47, 52-55, 243`.
* `-1` (modo libre), `1` (planta inicial), `8` (<8 miniboss), `9` (fin): `core/lib/GameAction.cc:190, 203`; `core/lib/Aplication.cc:64, 186, 196, 206, 228`.
* `999999` — Big-M de las artificiales: `Optimization/lib/Simplex.cc:515, 534`.
* `99` — valor inicial de la razón mínima (riesgo de no terminación): `Simplex.cc:426, 465`.
* `30` — tope de nodos de ramificación y acotación: `Simplex.cc:705`.
* `5` — `RAT_ROUND`, decimales al convertir `double`→`Rational` (no usado en el camino del juego): `Math/include/Rational.h:18`.
* Constantes de los tests (fórmula antigua, N = 55): `5133.333`, `2841.666`, `2566.666` en `Optimization/src/test.cc:34-36`; `(4773784, 8)` en `Optimization/src/testOpti.cc:38`.

**Steering / movimiento**
* `400` — maxSpeed: `Enemy.cc:235, 277`; `Captain.cc:203, 235`; `Technic.cc:218`; `Especialist.cc:202`; `Explosive.cc:208`; `core/entities/lib/Player.cc:71`.
* `1` — masa: `Enemy.cc:236, 278`; `Captain.cc:204, 236`; `Player.cc:72`; y en los constructores con Features `Technic.cc:254`, `Especialist.cc:237`, `Explosive.cc:241`.
* `4` — maxForce: `Enemy.cc:237, 279`; `Captain.cc:205, 237`; `Player.cc:73`.
* `Speed`/`Force` de Features usados como maxSpeed/maxForce: `Technic.cc:253, 255`; `Especialist.cc:236, 238`; `Explosive.cc:240, 242`; valores `175/3`, `130/3`, `145/3` en `CoreNamespace.h:145-146, 130-131, 160-161`. (Enemigos: `180/150/130/80/60` en `CoreNamespace.h:175, 190, 205, 220, 235`, **no aplicados** al steering.)
* `0.5` s — dt máximo aceptado por `MovementComp::Update`: `core/lib/MovementComp.cc:61`.
* `5` y `1.05` → `1` — banda muerta de velocidad: `MovementComp.cc:73-74`.
* `0.00000001` — umbral para actualizar heading: `MovementComp.cc:78, 111`.
* `10` — umbral de "me estoy moviendo": `MovementComp.cc:195`.
* `0.3` — `decelTweaker` de `Arrive`: `SteeringBehavior.cc:79`; `deceleration = 1` en `OffsetPursuit`: `SteeringBehavior.cc:131`.
* `-2` — freno al terminar el camino: `SteeringBehavior.cc:111`; `-1` en `OffsetPursuit` al estar en posición: `SteeringBehavior.cc:135`; `1` — distancia mínima a la posición de formación: `SteeringBehavior.cc:128`.
* `(0, 10)` — vector de referencia de `localToWorld`: `Math/lib/Vector2D.cc:159`.
* Formación: `Radius·4 = 120`, `Radius·(−2) = −60`, `Radius·(−4) = −120`; offsets `(−120,−60)`, `(120,−60)`, `(0,−120)`: `Player.cc:34-36, 75-81`; jitter `(rand()%100)/100.0 − 50`: `Player.cc:39-41`.
