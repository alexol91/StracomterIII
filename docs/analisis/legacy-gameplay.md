# Análisis legacy — Reglas de juego y core

> Ámbito: `legacy/trunk/core/` (`include`, `lib`, `entities/include`, `entities/lib`, `src`). Todas las rutas de este documento son relativas a `legacy/trunk/` salvo que se indique lo contrario. Los números de línea corresponden al estado actual del repositorio. Donde el core delega en otro módulo (Optimization, AI, Graphics) se cita únicamente lo imprescindible para entender la regla.

**Resumen ejecutivo.** StracomterIII es un shooter top-down (cámara 3D inclinable, lógica 2D Box2D) por plantas de la "Torre Chutaos": 7 plantas normales + 1 planta final (`finalMap.xml`) con megaboss. Antes de cada planta el jugador elige en la pantalla "estrategia" (a) con cuál de los 4 personajes juega y (b) una "zona" en una ruleta octogonal aleatoria; la zona determina el mapa (pequeño/mediano/grande) y la recompensa (pack de vida o munición) que reciben **todos** los supervivientes al ganar. La condición de victoria es matar a todos los enemigos (incluido el jefe); la de derrota, que muera el personaje controlado. Los tres compañeros son bots con FSM que siguen en formación, atacan, se retiran a curarse (capitán) o a recargar (especialista). El número y mezcla de enemigos lo decide un Simplex en función del área navegable del mapa, la planta y la dificultad. El estado (planta, puntuación, hp/munición/inventario de los 4 personajes) se guarda en binario crudo en `testFiles/save.dat`.

---

## 1. Máquina de modos de juego

### 1.1 Enumerados

`Core::GameMode::Mode` (`core/include/CoreNamespace.h:362-372`): `Salir=0, Menu=1, Strategy=2, Action=3, Credits=4, Free=5, size=6`.

`Core::GameActionStatus::Mode` (`CoreNamespace.h:373-381`): `Normal=0, Paused=1, Console=2, GameOver=3, Win=4` (sub-estados dentro de Action).

`Core::signalExit = -3` (`CoreNamespace.h:385`): cierre de ventana.

### 1.2 Arranque

- `main` (`core/src/Stracomter.cc:10-25`): `Aplication::getInstance()`; si `argc == 2` → `setMap(argv[1])` (mapa por defecto); `Launch()`.
- `Aplication::Aplication()` (`core/lib/Aplication.cc:30-70`): carga `testFiles/settings.txt` (si no existe lo crea con defaults); `defaultMap = "testFiles/maps/mapG4.xml"`; crea `Map`, `TWindow`, `IOControl`, `HIDControl`, `TConsole(15 líneas)`, `GameAction`, `GameMenu`; **`strategyGame = NULL`** (línea 48); `currentMode = Menu`; carga `GameStatus` desde `testFiles/save.dat` y si falla inicializa `nivelPlanta=1, zona=3` y guarda (63-67).
- `StartUp()` (135-144): abre ventana SFML con resolución/fullscreen de opciones, `setFrameLimit(60)`, construye menús, muestra `m_inicio`, música `s_menu`.
- `GameLoop()` (401-418): `while (currentMode != Salir) { Update(); Render(); fps = 1000/ms; }`; al salir muestra `m_closing`.

### 1.3 ¿Está implementado GameStrategy?

**No.** `GameStrategy` (`core/include/GameStrategy.h:14-16`, comentario literal: *"Inutilizado por el momento"*) es una cascara de 37 líneas (`core/lib/GameStrategy.cc`) que sólo reenvía `hid->formMenuControl(menu)` y `menu->Draw()`. `Aplication` nunca la instancia (`strategyGame = NULL`, `Aplication.cc:48`). El "modo estrategia" real es **una pantalla de menú** (`Graphics::Menus::m_strategy`) gestionada por `GameMenu` y por el `case Core::GameMode::Strategy` de `Aplication::Update` (`Aplication.cc:284-360`). Además su destructor hace `delete hid` (`GameStrategy.cc:21-22`) sobre un puntero compartido con `Aplication` — si se usara, doble liberación.

### 1.4 Transiciones (`Aplication::Update`, `Aplication.cc:151-381`)

El bucle despacha por `currentMode`. `menuGame->Update()` devuelve el `evento` del widget pulsado (`GameMenu.cc:31-36` → `HIDControl::formMenuControl`, `HIDControl.cc:19-76`), `0` si se pulsa **Escape**, `-3` si se cierra la ventana, `-1` si nada.

**Modo `Menu`** (180-283). Códigos de botón (asignados en `GameMenu::StartUp`, `GameMenu.cc:132-166`):

| Botón `m_inicio` | Evento | Efecto (`Aplication.cc`) |
|---|---|---|
| Nueva partida | `Strategy+100 = 102` | 193-202: `initializeVectorPlayers()`, `nivelPlanta=1`, `zona=3`, `puntuacion=0`, `typePlayer=e_captain`, **`saveData()`**, → Strategy |
| Continuar | `Strategy = 2` | 203-211: `loadData()`; si falla → planta 1, zona 3, save. → Strategy |
| Personalizada | `Free = 5` | 183-192: igual que Nueva partida pero **`nivelPlanta = -1`** y **sin guardar**; → Strategy |
| Opciones | `size+1 = 7` | 214-218: slideDown a `m_options`, `loadOptionsMenu()` |
| Creditos | `Credits = 4` | 260-265: `m_credits`, música `s_credits` |
| Salir | `0` | `currentMode = Salir` → fin del bucle |
| (Escape) | `0` | Igual que Salir. Si el menú visible es `m_options`, vuelve a `m_inicio` (267-270) |

Al ir a Strategy (226-242): `loadStrategyStatus()`; si `nivelPlanta < 9` muestra `m_strategy`, si no `m_theend`. Eventos `> size` (opciones) van a `controlOption()` (421-466): `size+2/+3` música ±5, `+4/+5` efectos ±5 (reproduce `e_machineGun` de prueba), `+6/+7` dificultad ↓/↑, `+8/+9` resolución ↑/↓, `+10` fullscreen, `+11` shaders, `+12` partículas; siempre re-guarda `settings.txt`.

**Modo `Strategy`** (284-360). Botones (`GameMenu.cc:568-645`):

| Widget | Evento | Efecto |
|---|---|---|
| Sector rojo/amarillo/verde de la ruleta (`TRadioButton`) | `s0 / s1 / s2` (< 10) | 309-312: `gameSelections->selectZona(aux)` + `cambiaRecompensa(aux)` |
| Retratos capitán/técnico/especialista/explosivo (`TPicture`) | `11 / 12 / 13 / 14` | 313-315: `efectoVisible(aux%10)` + `setTypePlayer(aux%10)` |
| Jugar | `30` | 297-298 y 333-344: música `s_action`, pantalla `m_loading`, `sm->removeMenuTree()`, **`actionGame->StartUp()`** → Action |
| Menú | `20` | 294-295: vuelve a `m_inicio` |
| (`m_theend`) Creditos | `40` | → Credits |
| (`m_theend`) Menu | `20` | → Menu |
| (Escape) | `0` | **Bug**: cae en `aux < 10` → `selectZona(0)` (ver §11) |

**Modo `Action`** (154-179): `currentMode = actionGame->Update()`. Si devuelve `Menu` → reconstruye árbol de menús y muestra `m_inicio`; si devuelve `Strategy` → `loadStrategyStatus()` + `m_strategy`.

**Modo `Credits`** (361-376): cualquier evento `> -1` hace `currentMode = (Mode) aux` y vuelve a `m_inicio`. El botón "Atras" vale `Menu=1`. **Escape vale 0 = `Salir`: pulsar Escape en créditos cierra el juego** (ver §11).

### 1.5 Sub-estados de Action (`GameAction::Update`, `core/lib/GameAction.cc:286-433`)

Cada frame se llama `UpdateGraphics()` (288) y luego:

- **Normal** (293-326): `gameTime.Unpause()`; oculta menú; `event->Update()` (explosiones, moral, munición); `status = hid->actionControl()` (0/1/2 o -3); `ia->Update()`; `world->setFrame(frameTime); world->UpdateWorld()`; **si `manager->Update()` devuelve true → `GameOver`** (muerte del tipo del jugador, `EntityManager.cc:634-635`); **si `getBadPersons().size()==0 && !debugMode` → `Win`** (320-322); `ParticleManager::Update()`.
- **Paused** (328-345): `gameTime.Pause()`, menú `m_pause`. Evento `0` (botón "Fortsetzen" o Escape) → Normal; cualquier otro (`1` = "Sortie") → devuelve ese `GameMode` tras `Clear()`. **No guarda.**
- **Console** (347-359): pausa, `consola->Open()`, `status = consola->getInput()` (2 = sigue abierta, 0 = cerrada con `º`, 1 = evento Close de ventana → **Paused**), `parseCommand(consola->getCommand())`.
- **GameOver** (360-378): menú `m_gameover`. "Reiniciar" = `3` (Action) → `Clear()` + `StartUp()` (**reinicia la misma planta con el estado en memoria del inicio de nivel**); "Salir" = `1` → Menu. Escape = `0` = **Salir del juego**.
- **Win** (380-428): menú `m_win`. Al pulsar **cualquier** botón:
  - si `nivelPlanta == -1` (Personalizada): reinicia estado (planta -1, zona 3, puntuación 0, capitán), no guarda;
  - si no: **cada `getGoodPersons()` recibe `new Object(recompensa)`** (407-409), `incrementLevel()` (412), `getCharacters(manager)` (414), **`saveData()`** (415).
  - Luego `Clear()` y, si el destino es Action, `StartUp()`. "Siguiente nivel" = `Strategy=2`; "Salir" = `1` = Menu (también guarda). Escape = `0` = Salir del juego.

`GameAction::Start()` (454-467), `getPaused/setPaused` (469-475), `gameOver`, `loadMap`: documentados como *"Inutilizado"* (`GameAction.h:65,88,95,177,210`) y no se usan.

---

## 2. Progresión: plantas y zonas

### 2.1 Variables (`core/include/GameStatus.h:218-234`)

- `nivelPlanta` (int): planta actual. Constructor: `0` (`GameStatus.cc:27`), pero `Aplication` fuerza `1` en partida nueva / `-1` en Personalizada.
- `zonaPlanta` (int): zona elegida. Por defecto `3` (Aplication). **No se persiste.**
- `recompensa` (`Core::Objects::Class`): recompensa dinámica del nivel; **no se inicializa en el constructor ni se persiste** (comentario en `GameStatus.h:231-233`: *"RECOMPENSA DEL NIVEL ACTUAL (no guardar)"*).
- `puntuacionPlayer`, `typePlayer`, `players[18]` (ver §7).

### 2.2 Significado de valores especiales

- **`nivelPlanta == -1`**: modo "Personalizada"/editor. `selectionMap()` carga `editorMap.xml` **del directorio de trabajo** si existe (`GameAction.cc:829-836`), si no `Aplication::defaultMap`. La dificultad usa `dificultad²` en lugar de `planta×dificultad` (190-197). El label de nivel del menú muestra la cadena `"editorMap.xml"` (`GameMenu.cc:713`). La ruleta se dibuja con `Octogonal(8,0,0)` (un único sector, `GameMenu.cc:716-717`). Al ganar no hay recompensa ni incremento (`GameAction.cc:389-403`).
- **`nivelPlanta == 8`**: planta final. Mapa fijo `testFiles/maps/finalMap.xml` sea cual sea la zona (837-840). Se coloca **megaboss** en `mapa->megaBoss` en lugar de miniboss (203-207). La ruleta también es `Octogonal(8,0,0)` y el sector devuelve evento `8` → `cambiaRecompensa(8)` muestra `win.png` (`GameMenu.cc:790-792`); `selectZona(8)` no tiene `case` → `recompensa` queda con el valor anterior.
- **`nivelPlanta >= 9`**: juego terminado → pantalla `m_theend` ("¡ENHORABUENA! Tras derrotar al grupo terrorista, el Chutaos Team recupera el control de sus instalaciones. Jorobate Flanders.", `GameMenu.cc:516-555`).

### 2.3 Incremento

`GameStatus::incrementLevel()` = `nivelPlanta++` (`GameStatus.cc:19-21`). Sólo se llama en Win cuando `nivelPlanta != -1` (`GameAction.cc:411-412`). No hay tope: tras la 8 pasa a 9 y se muestra `m_theend`; si el jugador vuelve a "Continuar" con planta 9 verá siempre `m_theend`.

### 2.4 Elección de zona: la ruleta (`TRadioButton::Octogonal`, `core/lib/TRadioButton.cc:117-222`)

Cada vez que se entra en la pantalla de estrategia (`loadStrategyStatus`, `GameMenu.cc:716-719`) se reconstruye un octógono de radio 120 px dividido en 3 sectores contiguos con **tamaños aleatorios**:

```
srand(time(NULL));
s0 = rand()%4 + 3;      // {3,4,5,6}  sector rojo
s1 = (8 - s0) / 2;      // {2,2,1,1}  sector amarillo
s2 = 8 - s0 - s1;       // {3,2,2,1}  sector verde
buttons[i]->setEvento(s_i);   // TRadioButton.cc:208-210
```

**El evento del sector = número de porciones que ocupa = número de zona.** Combinaciones posibles: (3,2,3), (4,2,2), (5,1,2), (6,1,1). La zona 3 puede aparecer en dos sectores; las zonas 4-6 sólo en el rojo.

### 2.5 Recompensa por zona (`GameStatus::selectZona`, `GameStatus.cc:225-247`)

| Zona | `recompensa` | Efecto al usarla (`Object::Apply`, `Object.cc:43-74`) | Icono menú (`GameMenu.cc:766-797`) |
|---|---|---|---|
| 1 | `ammo_pack_1` | +20 munición | `ammo20.png` |
| 2 | `health_pack_1` | +20 HP (sin tope) | `vida20.png` |
| 3 | `ammo_pack_2` | +50 munición | `ammo50.png` |
| 4 | `health_pack_2` | +50 HP | `vida50.png` |
| 5 | `ammo_pack_3` | +100 munición | `ammo100.png` |
| 6 | `health_pack_3` | +100 HP | `vida100.png` |
| 0, 7, 8, otros | (sin cambio) | — | `none.png` (8 → `win.png`) |

`selectZona` siempre hace `zonaPlanta = zona`, incluso para valores sin `case`.

### 2.6 Tabla EXACTA de mapas (`GameAction::selectionMap`, `GameAction.cc:822-923`)

Precedencia: primero `nivelPlanta == -1`, luego `== 8`, luego `switch(zona)` → `switch(planta)`. Cualquier combinación no listada devuelve `Aplication::defaultMap` (`mapG4.xml` o `argv[1]`).

| Planta \ Zona | 1 – 2 | 3 – 4 | 5 – 6 |
|---|---|---|---|
| 1 | `mapP1.xml` | `mapM1.xml` | `mapG1.xml` |
| 2 | `mapP2.xml` | `mapM1.xml` (sic) | `mapG2.xml` |
| 3 | `mapP3.xml` | `mapG3.xml` (sic) | `mapG3.xml` |
| 4 | `mapP4.xml` | `mapM4.xml` | `mapG4.xml` |
| 5 | `mapP1.xml` | `mapG1.xml` (sic) | `mapG1.xml` |
| 6 | `mapP2.xml` | `mapG2.xml` (sic) | `mapG2.xml` |
| 7 | `mapP3.xml` | `mapM3.xml` | `mapG3.xml` |
| 8 | `finalMap.xml` | `finalMap.xml` | `finalMap.xml` |
| -1 | `editorMap.xml` si existe, si no `defaultMap` | ídem | ídem |
| cualquiera, zona ∉ {1..6} | `defaultMap` | | |

Observaciones: la columna 3-4 mezcla M y G sin patrón; **`mapM2.xml` existe en `testFiles/maps/` pero nunca se carga**; la variable `num_mapa = planta*10 + zona` (línea 827) se calcula y no se usa. Prefijos: P = pequeño, M = mediano, G = grande (por número de muros/obstáculos/puertas: P ≈ 5-6 muros, 12-24 obstáculos, 1-3 puertas; G ≈ 12-18 muros, 27-47 obstáculos, 2-7 puertas; `finalMap` 27 muros, 14 puertas, 0 obstáculos, 16 objetos).

**Regla de diseño resultante:** sector más grande ⇒ zona mayor ⇒ mapa más grande ⇒ más enemigos (§4.7) ⇒ mejor recompensa. La ruleta es la única mecánica "estratégica" del juego.

### 2.7 Carga de un nivel (`GameAction::StartUp`, `GameAction.cc:110-284`)

1. `features->loadData("testFiles/features/f1.xml")` (136).
2. `mapa->setMap(selectionMap()); loadData(); generateTriangulation()` (175-179).
3. `ia->initMap(mapa, puertas); ia->Init()` (183-186).
4. `dif = planta × dificultad` (o `dificultad²`); `opti->CargarFuncionObjetivo(mapa->getArea(), dif); CalcularEnemigos(); CargarEnemigos(mapa, pf)` (189-200).
5. Jefe: `planta < 8` → miniboss en `mapa->miniBoss`; si no megaboss en `mapa->megaBoss` (203-207).
6. `addPointer()`; los 3 compañeros que no son el tipo del jugador se crean en `playerPos` con los offsets de formación `f0,f1,f2` según el tipo elegido (209-239, ver §5.3).
7. `GameStatus::applyCharacterStatus(manager)` (241): aplica hp/munición/puntuación/inventario guardados; los personajes con `hp <= 0` se marcan muertos y desaparecen en el primer `manager->Update()`.
8. Cámara: `mode3D=false`, `zoom=-680`, `angleAction=0`, `angleCamera=-30` (270-273). `gameTime.Start()` (283).

---

## 3. Clases jugables y enemigos

### 3.1 Qué fuente de datos se usa realmente

`Character::generateFeatures(t)` (`core/entities/lib/Character.cc:164-315`):

```cpp
if (features == NULL) features = CharacterFeature::getInstance();   // 166-168
if (features != NULL) { ...featuresContainer[t]... ammunition = 50; bodyDamage = 30; slashRate = 500; }  // 169-180
else { switch(t) { ...Core::Features::e_captain::HP... } }         // 181-313
```

Como `CharacterFeature::getInstance()` es un singleton que **nunca devuelve NULL**, la rama `else` con las constantes de `Core::Features` (`CoreNamespace.h:106-242`) **es código muerto**. Los valores en vigor son los de `testFiles/features/f1.xml`, cargado en `GameAction::StartUp:136` y en `GameStatus::initializeVectorPlayers` (`GameStatus.cc:33-34`). Si `f1.xml` no carga, `featuresContainer` queda con `Features()` a cero (HP 0, etc.). El comando de consola `feature <xml>` permite cambiarlo en caliente.

`testFiles/entities.xml` usa un esquema distinto (`name=`, `morale=`, sin `force`) que `CharacterFeature::getType` (`CharacterFeature.cc:151-167`, espera `type="e_captain"`) no reconoce; **ningún fichero del árbol lo referencia** → obsoleto.

El campo `DPS` de `Features` sólo se imprime en `operator<<` (`CharacterFeature.cc:172`); **no interviene en ninguna fórmula**. `f1.xml` no lo define (queda 0).

Valores hard-codeados adicionales en `generateFeatures` (178-180, marcados `//TODO`): `ammunition = 50`, `bodyDamage = 30` (daño de cuchillo), `slashRate = 500` ms.

### 3.2 Tabla comparativa

Leyenda: **NS** = `CoreNamespace.h` (muerto), **F1** = `f1.xml` (**en vigor**), **ENT** = `entities.xml` (obsoleto). Cadence en ms entre disparos (menor = más rápido). "DPS calc." = `Damage / (Cadence/1000)` con los valores F1 (sólo indicativo: el explosivo hace daño en área con caída lineal).

| Tipo (enum) | Fuente | HP | Speed | Force | Cadence | Damage | Moral | Exp kill | DPS (campo) | DPS calc. | Color (r,g,b) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Capitán** (1) | NS | 100 | 150 | 3 | 100 | 10 | 3 | 0 | 30 | — | 0.4, 0.7, 0.8 |
| | **F1** | **160** | **400** | 3 | 100 | 10 | 3 | 0 | — | 100 | 0.1, 0.5, 0.1 |
| | ENT | 100 | 100 | — | 100 | 10 | 3 | 0 | — | — | 0.4, 0.7, 0.8 |
| **Técnico** (2) | NS | 85 | 175 | 3 | 300 | 7 | 2 | 0 | 3 | — | 1.0, 0.9, 0.9 |
| | **F1** | 85 | **500** | **4** | **80** | 7 | 2 | 0 | — | 87.5 | 0.4, 0.3, 0.3 |
| **Especialista** (3) | NS | 125 | 130 | 3 | 200 | 5 | 2 | 0 | 10 | — | 0.9, 0.9, 1.0 |
| | **F1** | 125 | **400** | **4** | 200 | 5 | 2 | 0 | — | 25 | 0.3, 0.1, 0.6 |
| **Explosivo** (4) | NS | 110 | 145 | 3 | 500 | 60 | 2 | 0 | 0.75 | — | 0.9, 1.0, 0.9 |
| | **F1** | 110 | **450** | **4** | 500 | 60 | 2 | 0 | — | 120 (área) | 0.5, 0.3, 0.1 |
| **Enemy1** (5) | NS | 45 | 180 | (no asignado) | 100 | 1 | 0 | 3 | 10 | — | 0.8, 0.3, 0.0 |
| | **F1** | 45 | **150** | 3 | **500** | 1 | 0 | 3 | — | 2 | 1, 0, 0 |
| | ENT | 45 | 120 | — | 100 | 1 | 0 | 3 | — | — | 0.8, 0.3, 0.0 |
| **Enemy2** (6) | NS | 50 | 150 | 3 | 200 | 3 | 0 | 5 | 15 | — | 1.0, 0.0, 0.0 |
| | **F1** | 50 | **140** | 3 | **800** | 3 | 0 | 5 | — | 3.75 | 1, 0, 0 |
| | ENT | 50 | 100 | — | 200 | 3 | 0 | 5 | — | — | 1.0, 0.0, 0.0 |
| **Enemy3** (7) | NS | 65 | 130 | 3 | 200 | 4 | 0 | 7 | 20 | — | 0.9, 0.6, 0.2 |
| | **F1** | 65 | 130 | 3 | **600** | **2** | 0 | 7 | — | 3.33 | 1, 0, 0 |
| | ENT | 65 | 80 | — | 200 | 4 | 0 | 7 | — | — | 0.9, 0.6, 0.2 |
| **Miniboss** (8) | NS | 200 | 80 | 3 | 500 | 30 | 0 | 50 | 1 | — | 0.4, 0.4, 0.4 |
| | **F1** | 200 | 80 | 3 | 500 | 30 | 0 | 50 | — | 60 (área) | 0.5, 0.3, 0.1 |
| **Megaboss** (9) | NS | 500 | 60 | 3 | 200 | 10 | 0 | 500 | 10 | — | 0.2, 0.2, 0.2 |
| | **F1** | 500 | 60 | 3 | 200 | 10 | 0 | 500 | — | 50 | 0.3, 0.1, 0.6 |

Comunes a todos (F1 en vigor): munición inicial 50, daño de cuchillo 30, cadencia de cuchillo 500 ms, radio de cuerpo `Core::Radius = 30` (`CoreNamespace.h:10`, `Model2D.cc:21`).

### 3.3 Discrepancias señaladas

1. **Velocidades**: F1 multiplica ×2.5-3 la de los jugadores (400-500 vs 130-175) y **baja** la de los enemigos (150/140 vs 180/150). Con F1 el jugador es 2.5-3.8× más rápido que cualquier enemigo.
2. **Cadencias de enemigos** ×5-8 más lentas en F1 (500/800/600 ms vs 100/200/200). Enemy2 dispara menos de 1 vez/s.
3. **HP capitán** 160 (F1) vs 100 (NS/ENT). **Técnico** cadencia 80 vs 300.
4. **Enemy3 daño** 2 (F1) vs 4 (NS/ENT).
5. **Force** 4 en F1 para técnico/especialista/explosivo (3 en NS). Sólo afecta a `mov->setMaxForce` en técnico/especialista/explosivo (`Technic.cc:255`, `Especialist.cc:238`, `Explosive.cc:242`); capitán y enemigos usan `setMaxSpeed(400)`/`setMaxForce(4)` fijos (`Captain.cc:235-237`, `Enemy.cc:277-279`) ignorando Speed/Force de la ficha.
6. **Colores** totalmente distintos en F1 (todos los enemigos rojo puro; el capitán verde en vez de azul).
7. `Core::Features::e_enemy1` **no asigna `force`** en la rama muerta (`Character.cc:240-252`).
8. `entities.xml` sólo define capitán y 3 enemigos; carece de técnico/especialista/explosivo/jefes.

### 3.4 Roles funcionales (lo que diferencia de verdad a cada clase)

- **Capitán**: aura de moral (radio 200) que activa regeneración de HP en aliados (§5.1). Su Moral base es 3 ⇒ se regenera siempre.
- **Especialista**: aura de munición (radio 200): +10 balas / 4 s a aliados y a sí mismo (§4.5). Sonido de ametralladora (`EventControl.cc:61-63`).
- **Técnico**: el más rápido (500) y con la cadencia más alta (80 ms). No tiene habilidad pasiva propia.
- **Explosivo**: su disparo primario es una **explosión** en el punto del láser (radio 150, daño 60 con caída lineal) en vez de un rayo (`EventControl::doAttack`, `EventControl.cc:31-41`). Igual el **miniboss**.
- **Enemy1/2/3**: sólo cambian números. **Megaboss**: disparo normal con sonido de ametralladora.

---

## 4. Combate

Todo el combate está en `core/entities/lib/EventControl.cc` y `Character.cc`. No hay proyectiles: son **hit-scan** con un rayo Box2D (`Character::generateRay`, `Character.cc:400-412`) de **500 unidades** desde el centro en la dirección del ángulo; `laser.hit/body/point` guardan el primer cuerpo tocado o el extremo del rayo.

### 4.1 Cadencia y munición (`Character.cc:328-346`)

```cpp
bool canShoot()  { return ammunition != 0 && lastShoot.ms() >= rate; }   // rate = Cadence
float shootDamage() { if (ammunition != 0) { lastShoot.Reset(); shooting = true; if (ammunition > 0) ammunition--; return damage; } return 0; }
```

- `ammunition == -1` significaría infinita (no se decrementa); **nadie lo asigna**.
- `shootDamage()` se llama **aunque el rayo no toque a nadie** (`Shoot`, 89-91) ⇒ el disparo al aire consume bala y reinicia la cadencia.
- Los **enemigos también tienen 50 balas** y no las regeneran (sólo `getGoodPersons()` reciben `updateAmmunition`, `EventControl.cc:355-371`): un enemy1 sólo puede infligir 50×1 = 50 de daño en toda la partida.

### 4.2 `EventControl::doAttack` (31-41)

Si `canShoot()`: explosivo o miniboss → `Explosion(ent)`; resto → `Shoot(ent)`. Lo usan el jugador (clic izquierdo, `HIDControl.cc:276-278`) y los bots (`Bot::Dispara`, `Bot.cc:26-32`).

### 4.3 `EventControl::Shoot` (43-94)

1. Candidatos = `entities->getCharacters()` = **buenos + malos** (47). El filtro por facción está comentado (49-54): **hay fuego amigo total** (el rayo pega al primer cuerpo, sea compañero o enemigo).
2. Sonido: especialista y megaboss `e_machineGun`, resto `e_pistol` (59-68).
3. Si `laser.hit`, busca el `Character` cuyo `body` coincide con `laser.body`; `muerto = reventado->hurt(shooter->shootDamage())`; partícula de sangre; si la víctima no estaba ya marcada `dead` → `postDisparo`.
4. Si no intersecta: `shootDamage()` igualmente (gasta bala).

### 4.4 `EventControl::Slash` (96-138) — cuchillo (clic derecho)

- Requiere `canSlash()` = `!shooting && lastSlash >= 500 ms` (`Character.cc:353-358`). `shooting` se limpia cada frame en `EntityManager::UpdateGraphics` (`EntityManager.cc:854`).
- Alcance: `distance(laser.point, centro) < Core::Radius + 50 = 80` (114-115).
- Daño fijo `bodyDamage = 30` (`Character.cc:348-352`). Sonido `e_knife`.
- **Bug**: `postDisparo` se llama dos veces (122 y 124) en golpes no letales: doble sonido "ouch" y doble entrada en `atackers` del bot.
- Sólo el jugador lo usa; ningún bot llama a `Slash`.

### 4.5 `EventControl::postDisparo` (140-168) — muerte, puntuación, experiencia

```cpp
if (muerto) { sound e_dead; atacante->addScore(atacado->getExpKill()); atacado->setDead(true); entities->addDead(tipo,id); return true; }
else        { sound e_ouch; if (!isPlayer(atacado) && facciones opuestas) ((Bot*)atacado)->addAtacker(atacante->getCenter()); }
```

- **Puntuación = experiencia**: el atacante suma `expKill` de la víctima (3/5/7/50/500). No hay niveles, subida de estadísticas ni multiplicadores. Las muertes causadas por compañeros suman al `score` del compañero (se guarda pero nunca se muestra). La puntuación del jugador se persiste como `puntuacionPlayer` y se muestra en el HUD.
- `hurt(int)` (`Character.cc:360-369`): `hp -= damage; if (hp <= 0) { hp = 0; muerto = true; }`. Sin armadura (`//TODO: Escudo`). Daño **entero** (los daños fraccionarios de explosión se truncan).
- La eliminación real la hace `EntityManager::Update` (`EntityManager.cc:629-642`): si el tipo del muerto es `playerType` → devuelve `true` → **GameOver**; si no, `removeType()` borra la entidad.

### 4.6 `EventControl::Explosion` (170-262)

Dos variantes:

| | `Explosion(Entity*)` (170-215) — explosivo/miniboss | `Explosion(Point p, int damage)` (217-262) — granada Espacio |
|---|---|---|
| Centro | `laser.point` del atacante | `p` (= `player->laser.point`, `HIDControl.cc:243`) |
| Coste | `shootDamage()` (bala + cadencia 500 ms) | **ninguno: sin munición, sin cadencia** |
| Daño base | `damage` (60 explosivo, 30 miniboss) | **50** fijo |
| Radio | `Core::explosionRadius = 150` (`CoreNamespace.h:14`) | 150 |
| Fórmula | `hurt(damage × (1 − dist/150))` para cada `getCharacters()` con `dist <= 150` **y** línea de visión (`RayBody(centro, víctima).body == víctima.body`) | ídem |
| Empuje | `setLinearVelocity(dir × 100)` | `setLinearVelocity(dir × 10)` |
| Puntuación | vía `postDisparo` (sí suma exp) | **no llama a `postDisparo`: las muertes por granada no dan puntos** (250-255) |
| Efectos | Shape texturizado `exploMala.png` 2 s (`UpdateExplosions`, 311-334), partículas, sonido | ídem |

No hay exclusión del propio lanzador ni de aliados: el explosivo puede herirse a sí mismo y a su equipo.

### 4.7 Cuántos enemigos hay (Optimization, invocado desde `GameAction.cc:198-200`)

Fuera de `core/` pero define la regla. `Optimization::CargarFuncionObjetivo(tam, dif)` (`Optimization/lib/Optimization.cc:90-109`):

```
MaxEnemies = (int)( ln( (área/250) × dif ) × 10 )      // área = Σ tri.Area()/1000  (Map.cc:1005-1016)
Max z = x1 + x2 + x3  sujeto a:
  60x1 + 100x2 + 120x3 <= 93 × MaxEnemies     // (280/3) división entera
  45x1 +  50x2 +  65x3 <= 51 × MaxEnemies     // (155/3)
  60x1 +  45x2 +  35x3 <= 46 × MaxEnemies     // (140/3)
```

`CalcularEnemigos` (111-133) resuelve con Simplex entero; si falla o suma 0 reparte `MaxEnemies/3` a cada tipo. `CargarEnemigos` (135-171) coloca enemy1, luego enemy2, luego enemy3 en incentros aleatorios de triángulos del navmesh con área ≥ 2000 a más de 200 unidades del jugador. `dif = planta × dificultad` con dificultad ∈ {1.0 Fácil, 1.3 Normal, 1.5 Difícil} (`GameOptions.cc:43-70`). Además siempre hay exactamente **un jefe** (§2.7).

### 4.8 Curación y munición pasivas

- `Character::UpdateSanar()` (`Character.cc:113-122`): si `moral == 3 && hp < MAXhp` y han pasado 2000 ms → `hp++`. Llamado para el jugador en `Player::Update` (`Player.cc:169`) y para los compañeros bot en `AI::Update` (`AI/lib/AI.cc:72-84`). Los enemigos nunca (moral 0).
- `Character::updateAmmunition()` (`Character.cc:152-162`): si han pasado 4000 ms → `ammunition += 10`, tope 999. Sólo lo dispara `EventControl::UpdateAmmunition` (355-371) para cada `getGoodPersons()` a menos de 200 de **cualquier especialista** (incluido él mismo).
- Objetos de inventario y recogibles: §6.

### 4.9 Puntería, visión y IA de disparo (Bot)

- Campo de visión: triángulo `±20°` × 500 unidades (`Bot::generateVisionTri`, `Bot.cc:183-217`); un triángulo secundario de 700 se calcula y **no se usa**. `isInsideFOV` (243-266) devuelve 1 si `dist < 500` y `|ángulo| < 20°`, si no 0 (**nunca 2**).
- `enemySpotted` (424-454): para cada entidad de la facción contraria visible dentro del triángulo con línea de visión (`RayBody`) → `memory.push_back(id)` (sin deduplicar). `selectObjetive` (287-344) elige el de mayor `1/distancia` entre los recordados que sigan visibles.
- `Bot::Dispara` (26-32): orienta, genera rayo, `doAttack`. La puntería es perfecta (rayo al centro del objetivo).

### 4.10 Depuración

Consola `mode debug` desactiva la condición de victoria (`GameAction.cc:320`); `: god` alterna `dead` del jugador (deja de poder morir pero su HP sigue bajando hasta 0); `: ammo` → 999; `: health` → 999.

---

## 5. Moral y compañeros

### 5.1 Moral (`EventControl::UpdateMoral`, `EventControl.cc:336-354`)

La "moral" es un entero por personaje cuyo **único efecto** es habilitar la regeneración (`UpdateSanar` exige `moral == 3`, `Character.cc:114`). Cada frame:

```
subidoras = todos los e_captain (jugador o bot); receptoras = getGoodPersons()
para cada capitán × cada aliado:
    dist < 200  → aliado->setMoral(3)
    si no       → aliado->returnMoral()   // vuelve al valor de la ficha (f1.xml: capitán 3, resto 2)
```

Consecuencias: el capitán siempre tiene moral 3 (distancia 0 a sí mismo) ⇒ siempre se regenera (+1 HP / 2 s); técnico/especialista/explosivo sólo se regeneran mientras estén a menos de 200 unidades de un capitán; si el capitán muere nadie salvo él mismo se cura pasivamente. Los enemigos tienen moral 0 y no entran en `receptoras`. No hay penalizaciones por moral baja, pánico ni huida.

### 5.2 Reclutamiento y control

No existe reclutamiento: al empezar cada planta `GameAction::StartUp` crea **los tres tipos que no son el elegido** (`GameAction.cc:217-239`) en la posición del jugador, salvo que `applyCharacterStatus` los marque muertos (hp guardado ≤ 0, `GameStatus.cc:130-133`). En la pantalla de estrategia los retratos de los muertos aparecen deshabilitados y grises (`GameMenu.cc:721-756`, `isVivitoYColeando` = `players[t].hp != 0`, `GameStatus.cc:257-264`). El tipo controlado se elige con los retratos (evento 11-14) y `EntityManager::setPlayerType` (`GameAction.cc:117`). **Un compañero muerto lo está para el resto de la campaña** (no hay resurrección), y como el jugador no puede "morir" en el guardado (su muerte es GameOver sin guardar), como mínimo siempre queda uno.

Control directo del jugador sobre los bots: **una sola orden**, tecla **V** → `EventControl::ComeBackCompanions` (264-294): para cada compañero IA (`getIACompains()` = los 4 tipos menos el del jugador, `EntityManager.cc:547-562`) llama `goToComeBack(posJugador)` = `calculatePath(p); updateStates(4)` (`Captain.cc:174-177` y equivalentes). No hay órdenes de posición, foco de disparo ni modos de agresividad.

### 5.3 Sistema de formación

- El `Player` define 3 offsets locales (segundo constructor, el usado por `EntityManager::addPlayer`, `Player.cc:75-85`): `v1 = (−120, −60)`, `v2 = (120, −60)`, `v3 = (0, −120)` (= `Radius×4`, `Radius×−2`, `Radius×−4`).
- Asignación por tipo del jugador (`GameAction.cc:217-239`):

| Jugador | f0 (−120,−60) | f1 (120,−60) | f2 (0,−120) |
|---|---|---|---|
| Capitán (default) | Explosivo | Técnico | Especialista |
| Técnico | Explosivo | Especialista | Capitán |
| Especialista | Explosivo | Técnico | Capitán |
| Explosivo | Capitán | Técnico | Especialista |

- `EntityManager::addSmartEntity` (`EntityManager.cc:297-349`) hace `setOffset(formation)` y `setLeader(player->getMovementComp())`; `MovementComp::setLeader` pone `mode = 1` (`MovementComp.cc:172-181`). `SteeringBehavior::Calculate` (`core/lib/SteeringBehavior.cc:50-61`): modo 0 = `FollowPath()`, modo 1 = `OffsetPursuit(offset)` (el offset se convierte a mundo con la posición y heading del líder, `MovementComp::getWorldOffset`, 187-192).
- El primer constructor de `Player` (`Player.cc:34-41`) intenta añadir aleatoriedad con `(rand()%100)/100.0 − 50`, que da siempre ≈ −50 (bug), pero ese constructor **no se usa** en el juego.

### 5.4 FSM de los compañeros (`Captain.cc`, `Technic.cc`, `Especialist.cc`, `Explosive.cc`; idénticas salvo umbrales)

Estados: `Debug(0)`, `FollowPlayer(1)`, `Attack(2)`, `ComeBack(3)`, `GotoPoint(4)`; transiciones en `generateFSM` (p.ej. `Captain.cc:138-172`). Cada `updateAI` empieza por el auto-uso de inventario:

| Clase | Usa pack de vida si `hp <=` | Usa pack de munición si `ammo <=` | Radio de seguimiento | Se retira al capitán si `hp <` | Se retira al especialista si `ammo <` |
|---|---|---|---|---|---|
| Capitán (`Captain.cc:21-23, 58, 83`) | 30 | 5 | 150 | — | 1 |
| Técnico (`Technic.cc:21-23, 58, 88-91`) | 10 | 1 | 200 | 20 | 1 |
| Especialista (`Especialist.cc:21-23, 58, 82`) | 15 | 10 | 200 | 20 | — |
| Explosivo (`Explosive.cc:21-23, 60, 90-93`) | 50 | 1 | 200 | 20 | 1 |

- **FollowPlayer**: si `meAtacan()` (cola `atackers` no vacía) se gira hacia el atacante. Si `enemySpotted()` → Attack. Si el jugador está a más del radio → A* (`calculatePath`, `Bot.cc:277-285`: `pf->AStar` + `smoothPath`) y GotoPoint; si no, `mov->setMode(1)` + `Move()` (formación).
- **Attack**: si procede retirarse → `goToComeBack(posCapitán/posEspecialista)` (que envía **4 = GotoPoint**, no 3); si no, `selectObjetive` → `Dispara`, o si no hay objetivo → FollowPlayer.
- **GotoPoint**: `mov->setMode(0)` + `Move()` por el camino; si ve enemigo → Attack; si llega → FollowPlayer.
- **ComeBack (3)**: **inalcanzable** — ningún código emite la entrada 3.
- La curación de la retirada es implícita: acercarse a < 200 del capitán activa moral 3 (§5.1); no hay acción "curar".

### 5.5 FSM de los enemigos (`Enemy.cc`)

Estados `Debug(0)`, `Patrol(10)`, `Attack(20)`, `Pursue(30)`, `Ensure(40)` (`generateFSM`, 169-205). Puntos de patrulla = los 3 vértices del triángulo del navmesh donde aparece (`EntityManager.cc:352-358`); siguiente punto = `actual + rand()%2 + 1 (mod 3)` (`Enemy.cc:54-55`).

- **Patrol**: si le atacan → camino hacia el atacante y Pursue; si ve a un bueno → Attack; si no, alterna vértices.
- **Attack**: `selectObjetive` → `Dispara`; la rama `isInsideFOV == 2` (112) es inalcanzable; si pierde el objetivo va a su última posición (`currentObj`) → Pursue, o vuelve a Patrol.
- **Pursue**: sigue el camino; al llegar → Ensure.
- **Ensure**: gira 360° a 1°/frame (`fullRotation`, 158-167) y vuelve a Patrol.
- Los enemigos **no abren puertas** (sólo `HIDControl.cc:254` llama a `Door::Switch`), pero el pathfinder los enruta por puertas abiertas (§6.3).

---

## 6. Objetos, obstáculos y puertas

### 6.1 Objetos (`Core::Objects`, `CoreNamespace.h:72-89`; `core/entities/lib/Object.cc`)

Clases: `health_pack_1/2/3`, `ammo_pack_1/2/3`, `sniper`, `none_class=-1`. Tipos `obj_statics/obj_dynamics` (sin efecto práctico).

| Clase (subtype en XML) | `Object::Apply(Character*)` (`Object.cc:43-74`) |
|---|---|
| 0 `health_pack_1` | `hp += 20` |
| 1 `health_pack_2` | `hp += 50` |
| 2 `health_pack_3` | `hp += 100` |
| 3 `ammo_pack_1` | `ammunition += 20` |
| 4 `ammo_pack_2` | `ammunition += 50` |
| 5 `ammo_pack_3` | `ammunition += 100` |
| 6 `sniper` | `cout << "Próximamente"` — **no implementado** |

La vida **no se limita a `MAXhp`** (`setHp(getHp()+N)` sin clamp). La munición sólo se limita a 999 en la regeneración pasiva, no aquí.

Dos vías de obtención:

1. **Recogibles en el mapa** (`type="objects"` en el XML, `Map.cc:222-235` → `EntityManager::addObject`, `EntityManager.cc:237-264`): cuerpo Box2D estático **sensor** de 64×64 (`Model2D.cc:173-179`, `Object.cc:111-148`), animación de rotación infinita de 10 s. `EntityManager::Update` (646-655) comprueba **sólo el centro del jugador** contra cada objeto: si está dentro, `Apply(player)` inmediato y se elimina. Los bots no recogen nada. Los 12 mapas de campaña contienen entre 2 y 16 recogibles, con las 6 clases repartidas casi uniformemente (13-16 de cada una en total).
2. **Inventario de recompensas** (`Character::recompensas`, máx. 5, `Character.cc:474-484`): se llena al ganar una planta (uno por superviviente, §1.5) y se persiste (§7). El jugador cicla con **LShift** (`Player::addIdRecompensa`, `Player.cc:193-201`) y consume con **Q** (`applyRecompensa` → `ApplyObject(idx)` → `Apply` + `removeObject`, `Character.cc:514-531`). Los bots lo consumen automáticamente según los umbrales de §5.4 (`applyObjectHealth/applyobjectArmmor`, 561-603; nótese que "Armmor" son packs de **munición**, no de armadura).

### 6.2 Obstáculos (`Core::Obstacles`, `CoreNamespace.h:57-70`; `Obstacle.cc`)

8 subtipos: `obs_table(0)`, `obs_desk(1)`, `obs_couch(2)`, `obs_sofa(3)`, `obs_chair(4)`, `obs_shelf(5)`, `obs_plantPot(6)`, `obs_mesaConSillas(7)`. Cada uno es un polígono de `Model2D` (p. ej. mesa 42×90, `Model2D.cc:90-97`), cuerpo estático Box2D con `setObstacle()` (`Obstacle.cc:73-108`), color amarillo en modo debug. **Sin vida ni destrucción**; sólo bloquean movimiento y rayos (hit-scan y línea de visión). En `Map::generateTriangulation` (`Map.cc:562-647`) sus polígonos, rotados y trasladados, se añaden como agujeros del navmesh (566-585) y se expanden por `charRadius` antes de triangular. Distribución en campaña: 360 obstáculos, el más común `obs_shelf` (112) y `obs_mesaConSillas` (76).

### 6.3 Puertas (`Door.cc`)

- XML: `type="door"` con `vertexlist` de **exactamente 4 puntos** (si no, `status = -1`, `Map.cc:254-256`). `Map::loadData` las crea con `manager->addDoor(Point(), vPAux)` (261) → `Door(id, p, contour, vNodes=∅, pf=NULL)`.
- Cuerpo Box2D `setNeutral()` (`Door.cc:50-62`); display list propia (`ResourceManager::generateDoor`).
- Enlace con navegación: `AI::initMap` (`AI/lib/AI.cc:115-118`) hace `pared->setNodes(pf->addDoor(points)); pared->setPF(pf)`. `Door::switchNodes` (139-146) llama `pathf->getDualGraph()->changeNodeState(nodo, open)` para cada nodo del grafo dual cubierto por la puerta ⇒ **puerta cerrada = nodos no transitables para A\*; abierta = transitables**. Además `Map::generateDoorColisions` (1041-1053) añade al mundo de triangulación sensores expandidos por `charRadius`.
- Estado inicial: **cerradas** (`open = false`). `Switch()` (94-111) alterna: al abrir → `AnimationControl::addFadeOut(1000 ms)` + `body->Active(false)` (se atraviesa); al cerrar → `addFadeIn` + `Active(true)`. `Open()/Close()` (64-92) son la versión sin animación (no usadas en juego).
- Interacción: tecla **E** (`HIDControl.cc:244-257`): para **todas** las puertas cuyo centroide esté a `<= Core::Radius×3 = 90` del jugador → `Switch()`. Sin coste, sin bloqueo, sin llaves. **Nadie más las abre**: los enemigos quedan encerrados/aislados hasta que el jugador abra.
- `Rotate/Move/Width/Height` (148-210) son utilidades del editor de mapas.

### 6.4 Formato del mapa (`Map::loadData`, `Map.cc:94-330`; `Map::getType`, 524-547)

`<map>` con hijos `<object type="...">`: `perimeter` (vertexlist, 1 por mapa; genera el suelo), `wall` (4 vértices exactos, rojo en debug), `door` (4 vértices), `player` (`x,y,angle`), `obstacle` (`x,y,angle,subtype`), `objects` (`x,y,angle,subtype`), `miniBoss` y `megaBoss` (`x,y,angle`; sólo guardan el punto en `Map::miniBoss/megaBoss`, el enemigo lo crea `GameAction::StartUp`). Tipos desconocidos se ignoran; `<object>` sin `type` aborta con `-2`. El editor (`core/src/mapEditor.cc`) escribe `editorMap.xml` en la raíz de `trunk`.

---

## 7. Persistencia

### 7.1 Ficheros

| Fichero | Clase | Formato | Cuándo |
|---|---|---|---|
| `testFiles/save.dat` | `GameStatus` (`nomFich`, `GameStatus.cc:30`) | binario crudo | Nueva partida, Continuar sin fichero, y **al ganar cada planta** (`GameAction.cc:415`) |
| `testFiles/settings.txt` | `GameOptions` | texto `clave:valor` | arranque (si no existe) y cada cambio en Opciones |

Ninguno de los dos está en el repositorio (se generan en tiempo de ejecución en el directorio de trabajo).

### 7.2 `GameStatus::saveData` / `loadData` (`GameStatus.cc:146-184`)

Orden exacto de escritura (`ofstream ... ios::binary | ios::trunc`):

| Offset | Tamaño | Campo | Notas |
|---|---|---|---|
| 0 | 4 (`sizeof(int)`) | `typePlayer` | enum `Core::Entities::Type` escrito como int (1..4) |
| 4 | 4 | `nivelPlanta` | -1, 1..9 |
| 8 | 4 | `puntuacionPlayer` | score del jugador |
| 12 | `sizeof(CharacterStatus)` × 4 | `players[1]`, `players[2]`, `players[3]`, `players[4]` | bucle `for i = 1; i < 5` (capitán, técnico, especialista, explosivo). `players[0]` y `[5..17]` no se guardan |

`loadData` lee en el mismo orden con `file.read((char*)&players[i], sizeof(CharacterStatus))`. **No hay número mágico, versión, checksum ni comprobación de tamaño**; cualquier fichero existente se acepta (`if (file)`). `zonaPlanta` y `recompensa` **no se guardan**.

### 7.3 `CharacterStatus` (`GameStatus.h:247-376`)

Clase sin métodos virtuales (sin vptr), por lo que el volcado es la secuencia de sus miembros públicos:

| Campo | Tipo | Significado | Origen al guardar (`getCharacters`, `GameStatus.cc:62-91`) |
|---|---|---|---|
| `type` | `Core::Entities::Type` (enum, 4 B) | tipo del personaje | `person->getType()` |
| `hp` | int | vida al final de la planta (0 = muerto) | `getHp()` |
| `ammo` | int | munición | `getAmmunition()` |
| `score` | int | puntuación individual (nunca mostrada) | `getScore()` |
| `recomp1` … `recomp5` | int ×5 | clase (`Core::Objects::Class`) del objeto en la ranura 1..5 del inventario; **-1 = vacía** | `getRecompensas()[i]->getObjectClass()`, para `i < size()` |

Tamaño en GCC/x86: 10 × 4 = **40 bytes**; fichero total = 12 + 4×40 = **172 bytes**. Constructor por defecto: `type = e_captain, hp = ammo = score = 0, recomp* = -1`. Si un tipo no tiene entidad viva al guardar se almacena ese valor por defecto (⇒ **`type` incorrecto** para técnico/especialista/explosivo muertos; irrelevante porque al cargar se indexa por el tipo del personaje real, `applyCharacterStatus`, 108-136).

`applyCharacterStatus` (108-136): para cada `getGoodPersons()`: `setHp`, `setAmmunition`, `setScore` desde `players[tipo]`; por cada `recompN != -1` → `addObject(new Object((Class) recompN))`; si `hp <= 0` → `addDead`. Finalmente `player->setScore(puntuacionPlayer)`.

`initializeVectorPlayers` (32-43): para tipos 1..4: `hp = f1.xml HP`, `ammo = 50`, `score = 0`, inventario vacío.

### 7.4 `GameOptions` (`GameOptions.cc:72-175`)

Líneas `clave:valor` (parseo por el primer `:`): `music` (0-100, paso 5), `effects` (0-100), `width`/`height` (sólo 800×600 ↔ 1024×768, `upResolution/downResolution` 102-116), `full` (0/1), `shader` (0/1), `difficult` (1.0 / 1.3 / 1.5; otro valor → 1.0, `setDificultad` 242-249), `particles` (0/1). Defaults: 100, 100, 800, 600, 0, 0, 1, 1 (177-186).

---

## 8. Controles e input

### 8.1 Modo acción (`HIDControl::actionControl`, `core/lib/HIDControl.cc:162-288`)

Dos mecanismos SFML 1.6: estado en tiempo real (`IsKeyDown`/`isMouseButtonDown`, `IOControl.cc:18-27`) para acciones continuas y cola de eventos (`isKeyPressed`, 45-48) para pulsaciones.

| Entrada | Tipo | Acción | Líneas |
|---|---|---|---|
| **W / S / D / A** | mantenida | `velocity += Vector2D(angleAction ∓90 / 0 / +180) × speed` — movimiento **relativo a la rotación de cámara** `angleAction`; se aplica con `setLinearVelocity` directo (`Player::UpdateMov`, `Player.cc:172-181`); soltar = velocidad 0 | 189-204, 274 |
| **Ratón (posición)** | continuo | apuntado: `Pointer::getAbsolutCenter` (pantalla → mundo: `(cursor − centroVentana).Rotate(angleAction) + posJugador`, `Pointer.cc:68-84`) → `generateVisionRotation` + rayo de 500 | 263-274 |
| **Clic izquierdo** | mantenido | `doAttack(player)` (disparo o explosión según clase; respeta cadencia/munición) | 276-278 |
| **Clic derecho** | mantenido | `Slash(player)` (cuchillo, 30 daño, 500 ms, alcance 80) | 279-281 |
| **Rueda ratón** | evento | `zoomAction ± 20` | 236-241 |
| **Espacio** | pulsación | **granada gratuita**: `Explosion(player->laser.point, 50)` | 242-243 |
| **E** | pulsación | `Switch()` de todas las puertas a ≤ 90 unidades | 244-257 |
| **V** | pulsación | `ComeBackCompanions()` | 217-218 |
| **LShift** | pulsación | siguiente ranura del inventario | 227-229 |
| **Q** | pulsación | usar ranura seleccionada | 230-231 |
| **Escape** | pulsación | `modo = 1` (Paused) | 209-210 |
| **º** (`TextEntered` Unicode 186, tecla a la izquierda del 1 en teclado ES) | pulsación | `modo = 2` (Console) | 213-214 |
| **F5** | pulsación | alterna `mode3D` (árbol de escena vs. render 2D `Scene::Draw` de depuración) | 215-216 |
| **F8** | pulsación | reset cámara: zoom −680, angleCamera −30, angleAction 0 | 219-222 |
| **← / →** | pulsación | `angleAction ± 1°` (rota escenario y, por tanto, el eje de WASD) | 223-226 |
| **↑ / ↓** | pulsación | `angleCamera ∓ 1°` (inclinación) | 232-235 |
| Cerrar ventana | evento | `Core::signalExit` | 211-212 |

Declaradas pero **sin uso** en el juego: `IsPressAction()` (E), `IsPressPause()` (P), `IsPressSpace`, `pauseControl()` (`HIDControl.cc:105-160`, sustituida por `GameMenu::Update`), `formMenuControlEditor` (sólo editor).

### 8.2 Menús (`HIDControl::formMenuControl`, 19-76)

Hover: `menu->whoIsClicked(cursor)` hace `TestPoint` sobre el **cuerpo Box2D** de cada widget (`TForm.cc:285-307`) y marca `setOver`. Clic izquierdo sobre widget habilitado → devuelve `getEvento()` (en `TRadioButton` el del sub-botón; `TCheckBox` además alterna). Escape → `0`. Cierre → `-3`. Sin navegación por teclado.

### 8.3 Consola (`TConsole`, `core/lib/TConsole.cc`; `GameAction::parseCommand`, `GameAction.cc:477-733`)

Edición (`getInput`, 112-224): Enter ejecuta (`split` por espacios) y guarda en historial de 15 líneas; ↑/↓ historial; ←/→/Inicio/Fin cursor; Retroceso/Supr; `º` cierra (devuelve 0); evento Close devuelve 1 (→ Paused). Render: caja + fuente Monospace 14 px, 15 líneas visibles (`Init`, 52-79).

Comandos (nombres de tipo aceptados por `getEnum`, 735-759: `captain, technic, especialist, explosives, enemy1, enemy2, enemy3, miniboss, megaboss`):

| Comando | Efecto |
|---|---|
| `spawn <tipo> <x> <y>` / `add …` | `addSmartEntity` en (x,y) |
| `team <tipo> <x> <y>` | 10 unidades del tipo |
| `kill all` / `kill bad` / `kill me` / `kill <id>` | `addDead` de enemigos+compañeros / enemigos / jugador (⇒ GameOver) / entidad |
| `move <id> <x> <y>` / `tp <x> <y>` | teletransporta entidad / jugador |
| `pos [<id>]` | imprime posición (stdout) |
| `info <id>` | posición, ángulo, hp/max, munición (stdout) |
| `goto <id> <x> <y>` | A* del bot y estado Debug |
| `setVision <id> 0\|1` | ceguera del bot |
| `isVisible [<id>] 0\|1` | visibilidad de entidad/jugador |
| `: god` / `: ammo` / `: health` | alterna `dead` / munición 999 / hp 999 |
| `feature <fichero.xml>` | recarga fichas y las aplica a todos |
| `load <mapa.xml>` | recarga mapa + `Clear/StartUp` |
| `restart` | `Clear/StartUp` |
| `mode debug\|normal` | desactiva/activa condición de victoria |
| `shader true\|false` / `shader use Phong\|CellShading\|Pruebas\|None` | shaders |

---

## 9. UI y menús

### 9.1 Pantallas (`Graphics::Menus::Index`, `Graphics/include/GraphicsNamespace.h:109-125`; construidas en `GameMenu::StartUp`, `GameMenu.cc:110-658`)

| Índice | Pantalla | Contenido | Botones → evento |
|---|---|---|---|
| 1 `m_inicio` | Menú principal | fondo `fondo.jpg`, título "Stracomter III" (fuente `tf2Build` 90), subtítulo "dos puntos espacio el mejor juego de la historia" | Nueva partida 102 · Continuar 2 · Personalizada 5 · Opciones 7 · Salir 0 · Creditos 4 |
| 2 `m_loading` | "Cargando..." | se dibuja un frame antes de `StartUp` | — |
| 3 `m_pause` | Pausa | "Pause" | Fortsetzen 0 · Sortie 1 |
| 4 `m_gameover` | Derrota | "¡Segmentation Fault!" | Reiniciar 3 · Salir 1 |
| 5 `m_closing` | "Cerrando" | último frame | — |
| 6 `m_win` | Victoria | "¡Nivel completado!" | Siguiente nivel 2 · Salir 1 |
| 7 `m_strategy` | Estrategia | retrato grande del elegido (`captain/tecnic/especial/explosive.jpg`), 4 miniaturas `mini-*.jpg`, ruleta octogonal, icono de recompensa, labels "Recompensa:", "Nivel:" + número | Jugar 30 · Menú 20 · retratos 11-14 · sectores s0/s1/s2 |
| 8 `m_options` | Opciones | Música −/+ (9/8) con label, Efectos −/+ (11/10), Dificultad <=/=> (12/13) con label Fácil/Normal/Difícil, Resolución <=/=> (15/14) con label "W x H", checkboxes Fullscreen 16 / Shaders 17 / Particles 18, aviso "Reinicie el juego para aplicar…" | Back 1 |
| 9 `m_credits` | Créditos | fondo `molamos.png`; "Created by CHUTAOS TEAM": Sergio Gallardo Sales, Martin Candela Calabuig, Alejando Oñate Latorre, Ruben Pardo Milla; "Music by": Adrian Gomez Marin, Almudena Segovia Calabuig; tecnologías SFML, Wankel Particles, BOX2D, FTGL, GPC, tinyXML, g++/gdb/OpenGL/valgrind; agradecimientos JohnCor Team/Esteve, ABP Teachers | Atras 1 |
| 10 `m_theend` | Fin de juego | "¡ENHORABUENA!" + 3 líneas de texto | Creditos 40 · Menu 20 |

Transiciones animadas con `AnimationControl::slideLeft/Right/Up/Down` (500 ms, `Aplication.cc:57`). Las posiciones absolutas están hard-codeadas para 800×600 (p. ej. `Point(720,560)`, `GameMenu.cc:166`), aunque el formulario se crea con `width/height` de opciones ⇒ en 1024×768 los widgets absolutos quedan descentrados.

### 9.2 Toolkit propio (`core/include/T*.h`, `core/lib/T*.cc`)

| Clase | Hereda | Qué es | Notas de implementación |
|---|---|---|---|
| `TWidget` | — | base abstracta: `Polygon* shape`, **`Body* phisicShape`** (Box2D para hit-test), `color/colorOver/colorClicked`, `enable/visible`, `evento` (int devuelto al pulsar), márgenes `Up/Bottom/Left/Right`, `Draw()=0` | `TWidget.h:31-195` |
| `TForm` | `Element` (nodo del grafo de escena) | contenedor: panel de fondo, `widgets` (auto-apilados verticalmente por márgenes) y `widgetsAbsoluts` (posición fija), **un `World` Box2D propio** para el hit-test, `whoIsClicked(Point)` | `TForm.h:38-153` |
| `TButton` | `TWidget` | rectángulo `width×height` + `TLabel` interno, `colorBorder`, `setWlabel` (desplazamiento manual del texto) | `TButton.h:32-141` |
| `TLabel` | `TWidget` | texto (`Text` FTGL), `size`, `setFontText(Graphics::Font)`, `colorText` | `TLabel.h:27-108` |
| `TPicture` | `TWidget` | imagen `w×h` en `position`; puede ser botón (`setEnable(true)` + `evento`) — así funcionan los retratos | `TPicture.h:15-66` |
| `TCheckBox` | `TWidget` | cuadro + marca + texto, `switchCheck()` | `TCheckBox.h:21-141` |
| `TRadioButton` | `TWidget` | N `TButton` poligonales con `selected`; `Octogonal()` genera 3 sectores de radio 120 con eventos = tamaño | `TRadioButton.h:14-48` |
| `TProgressBar` | — (no es `TWidget`) | barra `percentage` con 3 `Shape` | **sólo se usa en el test `core/src/tTPB.cc`**; el juego no la muestra |
| `TConsole` | — | consola in-game (§8.3) | `TConsole.h:25-164` |
| `TWindow` | — | envoltorio de `sf::RenderWindow` | |

### 9.3 HUD (`GameAction::UpdateGraphics`, `GameAction.cc:761-819`; `EntityManager::UpdateGraphics`, `EntityManager.cc:779-1052`)

Nodos directos del grafo (`Graphics::DirectNodes`, `GraphicsNamespace.h:49-75`) actualizados cada frame:

| Nodo | Contenido | Fuente |
|---|---|---|
| `t_enemigos` | número de enemigos vivos (`getBadPersons().size()`) | `GameAction.cc:796-803` |
| `t_fps` | "FPS:N", refresco cada 500 ms | 805-813 |
| `t_time` | tiempo de partida (`gameTime.toString()`, se pausa en menús/consola) | 815-817 |
| `t_puntuacion` | `player->getScore()` | `EntityManager.cc:983-994` |
| `t_hp` | `player->getHp()` (sin barra, sólo número) | 997-1002 |
| `t_balas` | `player->getAmmunition()` | 1005-1049 |
| `t_recompensa` | `TForm` con una `TPicture`: icono del objeto seleccionado en el inventario (`vida20/50/100.png`, `ammo20/50/100.png`, `none.png`) | 1009-1046 |
| `t_escena` | transformación de cámara: `translate(0,0,zoom) · rotX(angleCamera) · rotZ(angleAction) · translate(−x, y, −100) · scale(1,−1,1)` — la cámara sigue al jugador | `GameAction.cc:772-779` |
| `t_mapa` | minimapa: misma traslación a −600 | 782-786 |
| `t_light2` | luz que sigue al jugador (`z=700, y−400`) | 788-792 |

Otros elementos visuales de juego: rayo láser de cada personaje (rojo 1 px en reposo, amarillo-verde 4 px al disparar, `EntityManager.cc:844-852`); animación de andar cambiando `idDisplay` cada 200 ms con sonido de pasos en los frames 1 y 3 (660-673); culling de entidades a > 750 unidades (800-801); explosiones como quad texturizado 2 s; partículas de sangre/explosión. No hay barra de vida de enemigos, indicador de daño, minimapa funcional con entidades ni marcador de compañeros.

---

## 10. Puntos críticos para el remake

| Regla / sistema | Implementación legacy | Veredicto | Justificación | Riesgo |
|---|---|---|---|---|
| Bucle de modos Menu → Strategy → Action → (Win) → Strategy… | `Aplication::Update` switch anidado con códigos mágicos (0, 1, 2, 20, 30, 40, 102, size+N) | **REDISEÑAR** | La estructura (menú → selección → nivel → recompensa) es sólida y barata; la implementación mezcla códigos de botón con enums de modo y hace que Escape signifique "Salir" en varias pantallas | Bajo: máquina de estados explícita |
| 7 plantas + planta final, jefe por planta, `m_theend` | `nivelPlanta`, `selectionMap`, miniboss/megaboss | **REPLICAR** | Es la columna vertebral de la campaña y está clara | Bajo |
| Ruleta octogonal aleatoria de zona (tamaño de sector = zona = mapa + recompensa) | `TRadioButton::Octogonal` + `selectZona` | **REPLICAR** (la regla) / **REDISEÑAR** (la UI) | Es la única decisión "estratégica" del juego y funciona (riesgo ↔ recompensa: más enemigos por mejor pack). La ruleta como widget es frágil (Box2D para hit-test) | Medio: hay que decidir si el jugador ve el mapa/dificultad antes de elegir; en legacy sólo ve el icono de recompensa |
| Tabla planta×zona → mapa | switch hard-codeado con inconsistencias (`mapM2` sin usar, zona 3-4 mezcla M/G) | **REDISEÑAR** | Convertir en tabla de datos; corregir la columna 3-4 y usar los 12 mapas | Bajo |
| Recompensa al ganar: un pack a **cada** superviviente, inventario de 5, uso manual (LShift/Q) | `GameAction.cc:407-409`, `Character::recompensas` | **REPLICAR** | Regla sencilla y verificable; los bots la consumen solos por umbral | Bajo. Decidir si la vida debe capar a `MAXhp` (legacy no lo hace) |
| Fichas de personaje desde XML (`f1.xml`) | `CharacterFeature` singleton; `Core::Features` muerto | **REPLICAR** (datos) / **DESCARTAR** (`CoreNamespace::Features`, `entities.xml`, campo `DPS`) | Una única fuente de datos externa. Los valores de f1.xml son los que se jugaron y probaron | Medio: velocidades 400-500 vs enemigos 130-150 hacen trivial el kiting; revisar en pruebas |
| Hit-scan con rayo de 500 y láser visible | `generateRay` + `Shoot` | **REPLICAR** | Define el "feel" (láser rojo/amarillo); sin proyectiles = sin física de balas | Bajo |
| Cadencia = ms entre disparos; bala gastada aunque no aciertes | `canShoot/shootDamage` | **REPLICAR** | Simple y coherente | Bajo |
| Fuego amigo total (rayos y explosiones) | filtro por facción comentado (`EventControl.cc:49-54`) | **REDISEÑAR** | Probablemente accidental (el código para desactivarlo existe comentado). Decidir explícitamente; como mínimo excluir auto-daño del explosivo | Alto para la jugabilidad con bots en formación delante del jugador |
| Explosión: radio 150, caída lineal, LOS, empuje | `Explosion(Entity*)` | **REPLICAR** | Fórmula clara `d × (1 − dist/R)` | Bajo |
| Granada con Espacio: gratis, sin cadencia, 50 daño, sin puntos | `HIDControl.cc:243` + `Explosion(Point,int)` | **DESCARTAR** o **REDISEÑAR** | Es claramente un resto de depuración ("Provisional…", `HIDControl.cc:208`); rompe el equilibrio (daño en área infinito). Si se conserva, darle munición/cooldown y puntuación | Alto si se replica tal cual |
| Cuchillo (clic derecho): 30 daño, 500 ms, alcance 80, requiere no estar disparando | `Slash` | **REPLICAR** (corrigiendo la doble llamada a `postDisparo`) | Da una opción sin munición | Bajo |
| Puntuación = Σ expKill del atacante; sin niveles ni progresión de stats | `postDisparo` | **REPLICAR** | Sencillo; la "experiencia" es sólo score | Bajo. Considerar sumar también las muertes de compañeros al jugador |
| Moral: aura de capitán (200) ⇒ regeneración +1 HP/2 s | `UpdateMoral/UpdateSanar` | **REPLICAR** como "aura de curación del capitán" | Es lo único que hace la moral; renombrar evita malentendidos | Bajo |
| Aura de munición del especialista (200, +10/4 s, tope 999) | `UpdateAmmunition/updateAmmunition` | **REPLICAR** | Da rol al especialista | Bajo |
| Enemigos con 50 balas sin regeneración | `generateFeatures` común | **REDISEÑAR** | Casi seguro no intencionado: un enemigo se queda inerme tras 50 disparos | Medio |
| Compañeros: 3 bots FSM (seguir en formación / atacar / retirarse a curar o recargar / auto-uso de packs), orden única "V" | `Captain/Technic/Especialist/Explosive.cc` | **REPLICAR** (comportamiento) / **REDISEÑAR** (umbrales como datos; añadir estado ComeBack real o eliminarlo) | El comportamiento observable es razonable y define el juego de escuadra | Medio: depende de pathfinding/steering equivalentes |
| Formación fija de 3 offsets (−120,−60), (120,−60), (0,−120) según clase del jugador | `Player.cc:75-85`, `GameAction.cc:217-239` | **REPLICAR** | Barato; la tabla por clase es arbitraria pero inofensiva | Bajo |
| Enemigos: patrulla por vértices del triángulo de spawn, FOV ±20°×500, memoria de objetivos, persecución a última posición, giro 360° | `Enemy.cc`, `Bot.cc` | **REPLICAR** (simplificando) | Patrón patrol/attack/pursue/ensure clásico | Medio: la patrulla depende del navmesh Delaunay |
| Cantidad/mezcla de enemigos por Simplex sobre área del navmesh | `Optimization` | **REDISEÑAR** | Sobre-ingeniería: el resultado es "≈ ln(área·dif/250)·10 enemigos repartidos ~1/3". Sustituir por tabla planta/zona/dificultad o fórmula directa | Bajo |
| Dificultad 1.0/1.3/1.5 que sólo escala el número de enemigos | `GameOptions`, `GameAction.cc:190-197` | **REPLICAR** ampliando | Coherente, pero podría escalar también daño/HP | Bajo |
| Puertas: 4 puntos, E abre todas a ≤ 90, sólo el jugador, alternan nodos del navmesh, fade 1 s | `Door.cc`, `HIDControl.cc:244-257` | **REPLICAR** (regla) / **REDISEÑAR** (que los bots puedan atravesar/abrir) | Interesante como control de flujo, pero enemigos encerrados = victoria imposible sin explorar; decidir | Medio |
| Recogibles sólo para el jugador, por centro, aplicación inmediata | `EntityManager::Update:646-655` | **REPLICAR** | Sencillo | Bajo. Considerar que los bots recojan |
| Obstáculos de 8 tipos, indestructibles, bloquean tiro y visión | `Obstacle.cc`, `Model2D` | **REPLICAR** | Base del combate de coberturas | Bajo |
| Sniper (`Core::Objects::sniper`) | `cout << "Próximamente"` | **DESCARTAR** (o implementar de cero) | No existe | — |
| GameStrategy (modo estrategia real) | clase vacía sin instanciar | **DESCARTAR** | Nunca existió | — |
| Guardado binario `save.dat` crudo | `GameStatus::saveData` | **REDISEÑAR** | Sin versión ni portabilidad; no guarda zona/recompensa. Conservar el *contenido* (tipo, planta, puntuación, hp/ammo/score/5 ranuras × 4 personajes) en JSON/texto versionado | Medio |
| Muerte del jugador = GameOver; compañeros muertos lo están para toda la campaña | `EntityManager::Update`, `isVivitoYColeando` | **REPLICAR** | Da peso a las decisiones; "Reiniciar" ya permite repetir la planta | Bajo |
| Reiniciar tras GameOver = misma planta con el estado del inicio de planta | `GameAction.cc:365-371` + estado en memoria | **REPLICAR** | Comportamiento correcto y esperado | Bajo |
| Condición de victoria: 0 enemigos (incluido jefe) | `GameAction.cc:320-322` | **REPLICAR** | Clara | Bajo: contar enemigos inaccesibles (puertas) |
| Cámara 3D orbitable (←→↑↓, rueda, F8) y modo 2D (F5) | `Aplication` zoom/angle | **REDISEÑAR** | Los controles de cámara en flechas y el WASD relativo a `angleAction` confunden; fijar cámara o mover a ratón | Bajo |
| Consola in-game con comandos de depuración | `TConsole` + `parseCommand` | **REPLICAR** (como herramienta dev) | Muy útil para QA; el conjunto de comandos es buen punto de partida | Bajo |
| Toolkit de widgets con Box2D para hit-test | `TWidget`/`TForm` | **DESCARTAR** | Usar el sistema de UI del motor destino; conservar sólo la lista de pantallas y textos | — |
| HUD numérico (score, hp, balas, enemigos, tiempo, icono de objeto) | `UpdateGraphics` | **REPLICAR** ampliando | Cubre lo esencial; añadir barra de vida y estado de compañeros | Bajo |

---

## 11. Deuda técnica y bugs detectados

Ordenados por impacto en jugabilidad; todos verificados en el código.

### 11.1 Rotos o incoherentes en reglas de juego

1. **Escape cierra el juego en Créditos, Game Over y Win.** `formMenuControl` devuelve `0` con Escape (`HIDControl.cc:48-49`) y `0 == Core::GameMode::Salir`. En `Aplication::Update` modo Credits (`Aplication.cc:364-365`) y en `GameAction::Update` GameOver/Win (`GameAction.cc:365-366, 397, 416`) se hace `currentMode/gameStatus = (Mode) aux` sin filtrar. En Win además se guarda antes, así que el progreso no se pierde, pero la app termina.
2. **Escape en la pantalla de estrategia selecciona la "zona 0".** `Aplication.cc:309-312`: `if (aux < 10) selectZona(aux)`. Zona 0 ⇒ `selectionMap` no tiene `case` ⇒ carga `defaultMap` (`mapG4.xml`) para cualquier planta 1-7, y `recompensa` no cambia.
3. **`GameStatus::recompensa` nunca se inicializa** (`GameStatus.cc:23-31`). Si el jugador pulsa "Jugar" sin tocar la ruleta (la zona por defecto 3 se fija con `setZona`, no con `selectZona`), al ganar se hace `new Object((Class) basura)`; `Apply` no hace nada para clases desconocidas pero el valor se guarda en `recompN`.
4. **Granada gratuita con Espacio** (`HIDControl.cc:242-243`): sin munición, sin cadencia, 50 de daño en radio 150 y **sin puntuación** (`Explosion(Point,int)` no llama a `postDisparo`, `EventControl.cc:250-255`). Comentario en `HIDControl.cc:208`: *"Provisional para poder crear enemigos"*.
5. **Fuego amigo total**, incluido auto-daño del explosivo/miniboss (`EventControl.cc:47, 100, 172, 218`; filtro comentado en 49-54 y 102-107).
6. **Enemigos con munición finita (50) sin regeneración** (§4.1).
7. **`Slash` llama dos veces a `postDisparo`** en golpes no letales (`EventControl.cc:122-125`).
8. **Tabla de mapas inconsistente**: zona 3-4 alterna M y G sin patrón; `mapM2.xml` nunca se carga; `num_mapa` calculado y sin usar (`GameAction.cc:827, 867-894`).
9. **Estado `ComeBack` (3) inalcanzable** en las 4 FSM de compañeros: `goToComeBack` emite 4 (`Captain.cc:174-177`, `Technic.cc:187-190`, `Especialist.cc:173-176`, `Explosive.cc:179-182`).
10. **`Enemy::Attack` rama `isInsideFOV(...) == 2` muerta** (`Enemy.cc:112`; `isInsideFOV` sólo devuelve 0/1, `Bot.cc:243-266`). `secondaryVision` (700) se calcula y no se usa (`Bot.cc:214`).
11. **Capitán y enemigos ignoran Speed/Force de la ficha**: `setMaxSpeed(400); setMaxForce(4)` fijos (`Captain.cc:235-237`, `Enemy.cc:277-279`) frente a `setMaxSpeed(speed); setMaxForce(force)` en técnico/especialista/explosivo (`Technic.cc:253-255`, `Especialist.cc:236-238`, `Explosive.cc:240-242`).
12. **`Core::Features` (140 líneas de constantes) es código muerto** (`Character.cc:166-168`); `DPS` no se usa; `testFiles/entities.xml` no lo lee nadie (§3.1).
13. **Vida sin tope al usar packs** (`Object.cc:49-57`): `hp` puede superar `MAXhp` indefinidamente.
14. **Sniper no implementado** (`Object.cc:67-69`).
15. **Ni compañeros ni enemigos abren puertas**; el jugador puede dejar enemigos inaccesibles y la victoria exige encontrarlos.
16. `Map::miniBoss/megaBoss` **no se reinician en `loadData`** (`Map.cc:102-122` vs 292/308): un mapa sin etiqueta heredaría el punto del mapa anterior (todos los mapas de campaña la tienen, así que hoy no se manifiesta).
17. `Bot::memory` crece sin límite: `push_back` cada frame mientras un enemigo es visible, sin deduplicar (`Bot.cc:444`).
18. `Bot::Move(int)` usa `cos(getAngle())` con el ángulo en grados (`Bot.cc:357-358`) — no tiene llamadores.
19. Constructor `Player(ResourceManager*, Type)`: "aleatoriedad" `(rand()%100)/100.0 − 50` ∈ [−50, −49.01] (`Player.cc:39-41`) — no se usa en el juego.
20. `Enemy` patrulla los vértices de `map->getTri(p)`; si el spawn cae fuera del navmesh `getTri` devuelve `Tri()` ⇒ patrulla hacia (0,0) (`Map.cc:1030-1039`, `EntityManager.cc:353-356`).
21. `Map::isNavegable` devuelve `true` incondicionalmente (`Map.cc:1061-1065`).
22. Cálculo de bounding box duplicado y `lY` nunca actualizado: `if (y >= hY) hY = y;` dos veces (`Map.cc:159-162` y `614-617`).

### 11.2 Corrupción de memoria / UB

23. **`Optimization::operator=` llama al destructor del objeto origen** (`opti.~Optimization()`, `Optimization/lib/Optimization.cc:36-48`) y después copia `opti.simplex` ya liberado. Nunca se invoca desde `core/`, pero es una bomba de relojería.
24. **Llamadas explícitas al destructor dentro de `operator=`** (doble destrucción al destruir el objeto): `Entity.cc:40`, `EntityManager.cc:148`, `Pointer.cc:38`, `Player.cc:116`, `TWidget.cc:73`, `TForm.cc:150`. Las variantes de `Obstacle.cc:139`, `Floor.cc:50` y `Bot.cc:125` están comentadas.
25. `GameStrategy::~GameStrategy` hace `delete hid` sobre el `HIDControl` compartido (`GameStrategy.cc:21-22`); inofensivo sólo porque la clase nunca se instancia.
26. `EventControl::UpdateExplosions`: `removeElement(aux)` con el `delete` comentado y la nota *"Que mierdas pasa con esto TODO"* (`EventControl.cc:319-320`) ⇒ fuga de un `Shape` por explosión.
27. `Character::~Character` no libera `ray` (comentado, `Character.cc:47-54`); `mov` lo liberan las subclases.
28. `GameStatus::saveData` vuelca `sizeof(CharacterStatus)` crudo: depende de ABI (tamaño de enum, padding), sin versión ni validación; `loadData` acepta cualquier fichero no vacío (`GameStatus.cc:146-184`).
29. `EntityManager::Update` accede a `getPlayer()->getCenter()` sin comprobar NULL (`EntityManager.cc:649`); si el tipo del jugador no existe (p. ej. tras `kill me` y un segundo frame) se desreferencia NULL.
30. `Bot::Move()` lleva la nota *"TODO Cuidado, que da segmentacion"* (`Bot.cc:400`).

### 11.3 Código muerto, "Inutilizado" y TODOs relevantes

31. Marcados explícitamente como sin uso por los autores: `GameStrategy` (*"Inutilizado por el momento"*, `GameStrategy.h:15`); `GameAction::Start/getPaused/setPaused/gameOver/loadMap` (*"Inutilizado"/"En desuso"*, `GameAction.h:65, 88, 95, 177, 210`); `Aplication::getActionGame/getMenuGame/setActionGame/setMenuGame` (*"EN DESUSO"*), `setFps` (*"Absurda funcion sin ningun sentido"*), `getGameSelections/setGameSelections` (*"innecesaria y peligrosa"*, *"todavia mas absurda"*, `Aplication.h:134-196`); `GameMenu::exportOpenGL` (*"FUNCION EN DESUSO"*, `GameMenu.h:49`); `Bot::lastShooted` (*"EN DESUSO"*, `Bot.h:222`); `Entity.h:368`; `HIDControl.h:48`.
32. `HIDControl::pauseControl`, `IsPressAction`, `IsPressPause`, `IsPressSpace` sin llamadores en el juego (§8.1). `EntityManager::removeBot` sólo busca en `e_enemy2` (`EntityManager.cc:435-449`) y no se usa. `EntityManager::copiar` no copia bots (`//TODO`, 117-124).
33. Bloque de 30 líneas comentado con la selección de mapa antigua por zona (`GameAction.cc:144-173`) y `addObject` de prueba (276-280).
34. `TProgressBar` sólo se usa en el test `core/src/tTPB.cc`. De los 10 ejecutables de `core/src`, sólo `Stracomter`, `Editor`, `Movimiento` y `RadioB` se compilan (`core/src/CMakeLists.txt`); el resto están comentados.
35. Valores hard-codeados con `//TODO` que deberían venir de la ficha: `ammunition = 50`, `bodyDamage = 30`, `slashRate = 500` (`Character.cc:178-180`); `//TODO: Escudo` en `hurt` (`Character.cc:361`); umbrales de auto-uso y radios de seguimiento repartidos por las 4 clases de compañero.
36. Layout de menús hard-codeado para 800×600 pese a soportar 1024×768 (§9.1).
37. Nombres inconsistentes: `getEnum` acepta `"technic"`/`"explosives"` mientras las clases son `Technic`/`Explosive` y el enum `e_tecnic`/`e_explosive` (`GameAction.cc:738-755`); `haveArmmorobject/applyobjectArmmor` operan sobre packs de **munición** (`Character.cc:548-559, 588-603`); `isVivitoYColeando`; "Fortsetzen"/"Sortie" en el menú de pausa (`GameMenu.cc:455-461`).
38. `TConsole::getInput` devuelve `1` (Paused) ante el evento de cierre de ventana en lugar de salir (`TConsole.cc:117-119`).
39. Duplicidad de rutas de recursos: texturas de recompensa en `Graphics/Resources/texturas/` y retratos en `testFiles/img/`; `RESOURCESROOT` en unos sitios y rutas relativas al CWD en otros (`GameMenu.cc:114-116, 609, 769`), lo que obliga a ejecutar desde `legacy/trunk/`.
40. En `Optimization::CargarFuncionObjetivo`: divisiones enteras `280/3`, `155/3`, `140/3` (93, 51, 46) y formato `"%f3"` (añade un dígito decimal espurio) (`Optimization.cc:93-102`); inofensivo pero delata falta de pruebas.

