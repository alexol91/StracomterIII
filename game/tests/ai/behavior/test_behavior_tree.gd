extends TestCase
## Semántica de los nodos del árbol. Son seis y hay que poder confiar en ellos:
## un fallo aquí se manifiesta como "los bots hacen cosas raras" en cualquier
## otro sitio.

var ctx: BehaviorContext = null
var ticks: Array[StringName] = []


func before_each() -> void:
	ctx = BehaviorContext.new()
	ticks = []


## Las acciones de guion se construyen en `BehaviorTestUtil` y no aquí: un
## método de un `TestCase` cuyo tipo de RETORNO es una clase de GDScript
## impide descargar el script y la ejecución acaba denunciando objetos
## filtrados. Ver el aviso de la cabecera de esa clase.


func test_sequence_stops_at_the_first_failure() -> void:
	var root := BehaviorTree.Sequence.new(&"raíz")
	root.add(BehaviorTestUtil.scripted_action(&"a", [int(BehaviorTree.Status.SUCCESS)], ticks))
	root.add(BehaviorTestUtil.scripted_action(&"b", [int(BehaviorTree.Status.FAILURE)], ticks))
	root.add(BehaviorTestUtil.scripted_action(&"c", [int(BehaviorTree.Status.SUCCESS)], ticks))
	assert_eq(root.tick(ctx, 0.05), BehaviorTree.Status.FAILURE)
	assert_eq(ticks.size(), 2, "el tercer hijo no debe ejecutarse")


## Las secuencias tienen MEMORIA: si un hijo devuelve RUNNING, el siguiente
## tick reanuda por él. Sin esto, "muévete a la cobertura" volvería a pedir
## cobertura veinte veces por segundo y el bot no llegaría nunca.
func test_sequence_resumes_at_the_running_child() -> void:
	var root := BehaviorTree.Sequence.new(&"raíz")
	root.add(BehaviorTestUtil.scripted_action(&"a", [int(BehaviorTree.Status.SUCCESS)], ticks))
	root.add(BehaviorTestUtil.scripted_action(&"b", [
		int(BehaviorTree.Status.RUNNING), int(BehaviorTree.Status.SUCCESS)], ticks))
	assert_eq(root.tick(ctx, 0.05), BehaviorTree.Status.RUNNING)
	assert_eq(root.tick(ctx, 0.05), BehaviorTree.Status.SUCCESS)
	assert_eq(ticks, [&"a", &"b", &"b"] as Array[StringName],
		"el primer hijo no se repite mientras el segundo está en marcha")


func test_selector_returns_the_first_success() -> void:
	var root := BehaviorTree.Selector.new(&"raíz")
	root.add(BehaviorTestUtil.scripted_action(&"a", [int(BehaviorTree.Status.FAILURE)], ticks))
	root.add(BehaviorTestUtil.scripted_action(&"b", [int(BehaviorTree.Status.SUCCESS)], ticks))
	root.add(BehaviorTestUtil.scripted_action(&"c", [int(BehaviorTree.Status.SUCCESS)], ticks))
	assert_eq(root.tick(ctx, 0.05), BehaviorTree.Status.SUCCESS)
	assert_eq(ticks, [&"a", &"b"] as Array[StringName])


func test_selector_fails_when_every_child_fails() -> void:
	var root := BehaviorTree.Selector.new(&"raíz")
	root.add(BehaviorTestUtil.scripted_action(&"a", [int(BehaviorTree.Status.FAILURE)], ticks))
	root.add(BehaviorTestUtil.scripted_action(&"b", [int(BehaviorTree.Status.FAILURE)], ticks))
	assert_eq(root.tick(ctx, 0.05), BehaviorTree.Status.FAILURE)


## `Parallel` ejecuta TODOS los hijos en el mismo tick: es lo que permite
## "avanza mientras disparas" sin dos árboles ni un estado extra.
func test_parallel_runs_every_child_each_tick() -> void:
	var root := BehaviorTree.Parallel.new(&"raíz")
	root.add(BehaviorTestUtil.scripted_action(&"a", [int(BehaviorTree.Status.RUNNING)], ticks))
	root.add(BehaviorTestUtil.scripted_action(&"b", [int(BehaviorTree.Status.RUNNING)], ticks))
	assert_eq(root.tick(ctx, 0.05), BehaviorTree.Status.RUNNING)
	assert_eq(ticks.size(), 2)


func test_parallel_succeeds_at_its_threshold() -> void:
	var root := BehaviorTree.Parallel.new(&"raíz")
	root.success_threshold = 1
	root.add(BehaviorTestUtil.scripted_action(&"a", [int(BehaviorTree.Status.SUCCESS)], ticks))
	root.add(BehaviorTestUtil.scripted_action(&"b", [int(BehaviorTree.Status.RUNNING)], ticks))
	assert_eq(root.tick(ctx, 0.05), BehaviorTree.Status.SUCCESS)


func test_parallel_fails_at_its_threshold() -> void:
	var root := BehaviorTree.Parallel.new(&"raíz")
	root.success_threshold = 1
	root.failure_threshold = 1
	root.add(BehaviorTestUtil.scripted_action(&"a", [int(BehaviorTree.Status.FAILURE)], ticks))
	root.add(BehaviorTestUtil.scripted_action(&"b", [int(BehaviorTree.Status.SUCCESS)], ticks))
	assert_eq(root.tick(ctx, 0.05), BehaviorTree.Status.FAILURE,
		"un fallo tumba el paralelo aunque otro hijo haya tenido éxito")


func test_inverter_and_succeeder() -> void:
	var inverter := BehaviorTree.Inverter.new(&"no",
		BehaviorTestUtil.scripted_action(&"a", [int(BehaviorTree.Status.SUCCESS)], ticks))
	assert_eq(inverter.tick(ctx, 0.05), BehaviorTree.Status.FAILURE)
	var succeeder := BehaviorTree.Succeeder.new(&"da_igual",
		BehaviorTestUtil.scripted_action(&"b", [int(BehaviorTree.Status.FAILURE)], ticks))
	assert_eq(succeeder.tick(ctx, 0.05), BehaviorTree.Status.SUCCESS)


## Una condición SIN predicado no deja pasar. El valor por defecto de una
## comprobación de la que depende un disparo no puede ser el permisivo: una
## condición vacía que devolviera SUCCESS dejaría pasar "¿tengo visión?" sin
## preguntarlo, que es el bug del legacy en pequeño.
func test_a_condition_without_predicate_denies() -> void:
	var condition := BehaviorTree.Condition.new(&"vacía")
	assert_eq(condition.tick(ctx, 0.05), BehaviorTree.Status.FAILURE)


## Lo mismo para una acción sin rutina: falla, no finge haber hecho algo.
func test_an_action_without_routine_fails() -> void:
	var action := BehaviorTree.Action.new(&"vacía")
	assert_eq(action.tick(ctx, 0.05), BehaviorTree.Status.FAILURE)


## Abortar recorre el árbol y da a cada acción la oportunidad de soltar lo que
## tuviera cogido. Sin esto, un flanqueo abandonado a medias deja su ruta
## reclamada en la pizarra y la escuadra no manda a nadie más.
func test_abort_reaches_every_action_and_resets_the_sequence() -> void:
	var released: Array[bool] = [false]
	var root := BehaviorTree.Sequence.new(&"raíz")
	root.add(BehaviorTestUtil.scripted_action(&"a", [int(BehaviorTree.Status.SUCCESS)], ticks))
	var action := BehaviorTestUtil.scripted_action(&"b", [int(BehaviorTree.Status.RUNNING)], ticks)
	action.on_abort = func(_c: BehaviorContext) -> void: released[0] = true
	root.add(action)

	assert_eq(root.tick(ctx, 0.05), BehaviorTree.Status.RUNNING)
	root.abort(ctx)
	assert_true(released[0], "la acción en marcha debe soltar lo suyo al abortar")

	ticks.clear()
	root.tick(ctx, 0.05)
	assert_eq(ticks[0], &"a", "tras abortar, la secuencia empieza de cero")


## La traza del árbol es la herramienta de depuración: si no se puede leer qué
## nodo se quedó en RUNNING, un comportamiento atascado no tiene diagnóstico.
func test_the_tree_prints_a_readable_trace() -> void:
	var root := BehaviorTree.Sequence.new(&"raíz")
	root.add(BehaviorTestUtil.scripted_action(&"hoja", [int(BehaviorTree.Status.RUNNING)], ticks))
	root.tick(ctx, 0.05)
	var text := root.to_text()
	assert_true(text.contains("raíz"), "la traza nombra la raíz")
	assert_true(text.contains("hoja"), "y sus hojas")
	assert_true(text.contains("RUNNING"), "con el estado de cada nodo")
