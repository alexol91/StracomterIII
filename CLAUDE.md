# Stracomter III: Torre Elite — guía para agentes

Remake en **Godot 4.7.2** de un shooter táctico en C++ de 2012. Lee
`docs/00-decision-tecnologica.md`, `docs/01-gdd.md` y `docs/02-arquitectura.md` antes de
tocar nada.

## Ejecutar y probar

```bash
GODOT=<ruta a godot 4.7.2>
$GODOT --headless --path game --quit-after 90        # arranque limpio: sin errores ni avisos
$GODOT --headless --path game res://tests/run_tests.tscn                 # todas las pruebas
$GODOT --headless --path game res://tests/run_tests.tscn -- --filter=simplex   # filtrar
```

El runner sale con código **1** si algo falla. No hay GdUnit4 ni ningún addon: las
pruebas usan `tests/test_case.gd`. Un fichero es una prueba si se llama `test_*.gd`,
extiende `TestCase` y define métodos `test_*`. Una prueba sin aserciones **se considera
fallo**.

> Aviso: varios agentes ejecutando Godot a la vez sobre `game/` compiten por el caché de
> importación de `.godot/`. Si una ejecución se cuelga o da errores raros de recursos,
> es esto: reintenta en serie.

## Reglas que no se negocian

1. **`legacy/` es de SOLO LECTURA.** No se compila, no se parchea, no se formatea. Es el
   documento fuente del remake. Lo que haga falta de ahí se extrae a `docs/analisis/`.
2. **Las dependencias van solo hacia abajo:** `ui → director → ai → gameplay → levels/core`.
   `gameplay/` **no conoce** `ai/`. Un `Character` expone intenciones (`move_to`,
   `fire`, `reload`…) y las rellena o el input humano o un cerebro de IA. Si algo en
   `gameplay/` necesita preguntarle a `ai/`, la responsabilidad está mal repartida.
3. **Ningún número de balanceo en código.** Todo en `.tres` bajo `game/src/data/`, servido
   por el autoload `Balance`. El original los tenía triplicados y contradictorios en tres
   ficheros; no se repite.
4. **Todo sistema de IA y del director es testeable en `--headless`**, sin escena ni GPU.
   Se consigue haciéndolos funciones puras de `(BotState, Blackboard, WorldQuery)`. Si un
   sistema necesita render para probarse, está mal diseñado.
5. **Nada de IA en `_process`.** Los bots se registran en `AIScheduler` (ADR-002), que
   reparte percepción a 10 Hz, decisión a 5 Hz y comportamiento a 20 Hz, con techos duros
   de raycasts y peticiones de camino por frame.
6. **Determinismo donde se prometió**: Simplex con racionales exactos, director y
   generador procedural sembrados desde `GameState.run_seed`. Nunca `randf()` global.
7. **Propiedad exclusiva de ficheros.** Cada agente escribe solo en su ámbito
   (`docs/03-equipo-agentes.md`). Dos agentes tocando el mismo fichero es el fallo más
   caro y más evitable de este modelo de trabajo.

## Convenciones

* GDScript con **tipado estático estricto**: `class_name`, `-> void`, `: float`. El
  proyecto trata los avisos de tipado como errores.
* Nombres de dominio **en inglés en el código** (`SquadDirector`, `CoverPoint`),
  **español en la UI** vía claves de traducción. El legacy mezclaba los dos idiomas
  dentro de la misma clase (`CargarEnemigos`, `getNivelPlanta`) y era ruido.
* Comentarios y documentación **en español**.
* Escenas y recursos siempre en **texto** (`.tscn`, `.tres`), nunca binario: es lo que
  hace el proyecto revisable en un PR.
* Sin dependencias externas ni addons.

## Mapa del proyecto

| Ruta | Qué es | Dueño |
|---|---|---|
| `game/src/core/` | Autoloads: EventBus, Balance, GameState, Blackboard, AIScheduler, SaveSystem, AudioDirector, DevConsole | `godot-arquitecto` |
| `game/src/data/` | Recursos de balanceo (`.tres`) — única fuente de verdad | `godot-arquitecto` |
| `game/src/gameplay/` | Personajes, armas, cámara, puertas, pickups | `godot-gameplay` |
| `game/src/ai/contracts/` | `BotState`, `WorldQuery`, `CoverProvider`, `BehaviorKind` | `godot-arquitecto` |
| `game/src/ai/perception/` | Vista con oclusión, oído por navmesh, memoria con confianza | `ai-percepcion` |
| `game/src/ai/behavior/` | Selector por utilidad + árboles de comportamiento | `ai-comportamiento` |
| `game/src/ai/squad/` | Roles, flanqueo, supresión, compañeros y moral | `ai-escuadra` |
| `game/src/ai/navigation/` | Navmesh, enlaces de puerta, coberturas, spawns justos | `ai-navegacion` |
| `game/src/director/` | Simplex exacto, modelo de habilidad, curva de tensión | `director-encuentros` |
| `game/src/levels/` | Generador procedural de plantas | `level-procedural` |
| `game/src/ui/` | HUD, menús, pantalla de Estrategia, consola | `ui-ux` |
| `tools/map_converter/` | XML de 2012 → escenas de Godot | `level-conversor` |
| `game/tests/` | Runner y pruebas | `qa-tests` (cada agente aporta las suyas) |

## Contexto del original que conviene saber

Cosas que la arqueología (`docs/analisis/`) demostró y que cambian decisiones:

* **Los valores en vigor eran los de `testFiles/features/f1.xml`**, no los de
  `CoreNamespace.h`: esas constantes vivían en una rama inalcanzable.
* **La programación lineal del original era degenerada**: su óptimo entero daba ~26
  enemigos del tipo 2 y casi nada más. Se conserva el solucionador y se reformula el
  problema.
* **Los bots veían a través de las paredes** (comprobaban el cono, no la oclusión) y su
  cono periférico era código muerto.
* El **modo Estrategia nunca se implementó**: era una ruleta octogonal aleatoria. En el
  remake es una elección informada.
* **GPC** (usado por la triangulación) es de licencia **no comercial** y
  **WankelParticles es GPLv3**. Nada de eso se reutiliza.
