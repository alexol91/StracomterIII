# Stracomter III: Torre Chutaos — guía para agentes

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

## El principio de los valores por defecto

Cuatro agentes llegaron a esta regla por separado, cada uno tras un bug distinto.
Está escrita aquí para que el quinto no tenga que pagarla:

> **El valor por defecto de un dato que no ha llegado nunca puede ser el permisivo
> ni el extremo.**

Los cuatro casos, por si ayuda a reconocer el patrón:

* `WorldQuery.has_line_of_sight` devolvía `true` sin espacio de física. Resultado: rayos X
  para cualquier bot creado antes de que el nivel enlazara la física. **Ante la duda, no
  se ve.**
* Una petición de aparición sin configurar generaba igualmente. Resultado: enemigos en la
  cara del jugador. **Ante la duda, no se genera.**
* Un muestreador sin backend de física daba todos los candidatos por buenos. **Ante la
  duda, no se propone.**
* El director no distinguía «esta zona no tiene cobertura» de «nadie me ha dicho cuánta
  tiene»: en punto flotante ambas son `0.0`. Resultado: leía la zona como descampado y
  mandaba la composición equivocada. **Ante la duda, la geometría se abstiene** y los
  presupuestos se quedan en su valor nominal.

Lo que hace peligrosos a estos fallos no es su gravedad, es que **no dan error**. Se
manifiestan como un enemigo que dispara a través de una pared o como un balanceo raro,
nunca como un mensaje en consola. Por eso la defensa tiene que estar en el valor por
defecto y no en acordarse de comprobarlo.

Trampa concreta de GDScript, por si ahorra una tarde: **las lambdas capturan por
valor**. Un contador escrito así siempre da cero, y el test parece correcto:

```gdscript
var received := 0
var cb := func() -> void: received += 1   # incrementa la COPIA de la lambda
signal_x.connect(cb); signal_x.emit()
assert_eq(received, 1)                     # falla: received sigue a 0
```

Con `var received: Array[int] = [0]` y `received[0] += 1` se captura la referencia y la
mutación se ve. Es el fallo silencioso perfecto: no da error, y el test acusa al código
en vez de a sí mismo.

Otra trampa que ya ha costado dos veces: **una variable `static` sobrevive al árbol de
escena.** Si guarda `Callable` ligados a un nodo autoload y ese nodo se libera al cerrar
el juego, quedan referencias a un objeto muerto y el proceso **aborta con corrupción de
memoria**. El síntoma es el peor posible: las pruebas pasan, el juego parece funcionar, y
el proceso sale con código 134. Verde por dentro, rojo en CI.

Regla: **quien llena un registro lo vacía.** Si registras comandos, trucos o callbacks
desde un nodo, retíralos en su `_exit_tree()`. Y da al registro un `prune_dangling()` que
descarte los `Callable` cuyo objeto ya no existe, como red para quien se olvide.

Y una lección de método sobre ese mismo fallo: apareció justo al añadir el cel-shading,
así que la hipótesis intuitiva era el shader. Era falsa. Lo que la descartó fue barato —
correr un grupo de pruebas que no tocara ni materiales ni modelos y ver que abortaba
igual—. Antes de arreglar, busca el dato que separa tus hipótesis; suele costar menos que
el parche equivocado.

Corolario para los dobles de prueba: **un doble más amable que la realidad hace que las
pruebas mientan.** Ya ha pasado tres veces —una máscara de colisión ignorada, rutas que
siempre llegan al destino exacto, un mundo de cajas que dejó de parecerse al mapa—. Si
escribes un doble, documenta qué modos de fallo del original reproduce y **cuáles no**.

## Si el entregable es visual, míralo

Cuatro fallos de una misma tarde no los detectó ninguna prueba, y los cuatro se
vieron a la primera captura de pantalla:

* La interfaz arrancaba **en inglés** en un proyecto cuya UI es española.
* La torre del menú tenía **ventanas flotando sobre el tejado**.
* El **suelo de todos los mapas llevaba desde siempre sin dibujarse**: la
  planta parecía un agujero negro mal iluminado.
* El mundo **no tenía ni una luz**, así que la biblioteca de materiales entera
  era invisible.

`tools/screenshots/capture.sh` renderiza las pantallas a PNG con `xvfb-run`.
Cuesta un minuto. Aprobar un entregable visual sin verlo es fiarse de una
descripción, y una descripción no tiene ventanas flotando.

Aviso de la propia herramienta: sin Vulkan cae al renderizador de
Compatibilidad y el juego se exporta en Forward+. La silueta, la composición,
el valor y la saturación son fiables; el ambiente de imagen, la oclusión de
contacto y las sombras, no. De ahí que la iluminación no dependa solo del
aporte del cielo: **lo que se afina mirando una captura tiene que sobrevivir al
cambio de renderizador.**

## Cuando el motor gana en silencio

Tres trampas del mismo tipo: el código es correcto, el motor hace otra cosa y
no avisa.

* **Una función estática no puede llamarse como un método del motor.**
  `Localization.reload()` llamaba a `Script.reload()` —que recompila el
  script—, no a la función estática del fichero. Desde dentro de la clase
  resolvía bien; desde fuera, no. Devolvía OK y no recargaba nada. El síntoma
  era absurdo: una función que no llegaba a imprimir ni su primera línea.
  Comprueba los nombres contra `Object`, `Resource`, `Node` y `Script`.
* **La cara frontal en Godot es la HORARIA vista de frente**, al revés que en
  OpenGL. Una malla convertida con la convención de OpenGL no se ve mal: no se
  dibuja, y detrás solo está el fondo. Cuidado especialmente con la geometría
  que viene del conversor de mapas, que además necesita el bobinado CONTRARIO
  para que el horneador de navegación la acepte.
* **Un mapa de normales sin tangentes pinta la superficie de negro.** Las
  primitivas (`BoxMesh`…) las traen; una malla montada a mano con
  `add_surface_from_arrays`, no. `SurfaceTool.generate_tangents()`.

Y dos de recursos en texto: dentro de `[resource]` los comentarios van con `;`
—un `#` se pega al nombre de la propiedad siguiente— y los nombres de Godot 3
(`specular` por `metallic_specular`) se remapean con un aviso, así que el
recurso carga, la prueba pasa y el arranque deja de estar limpio.

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
