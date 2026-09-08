extends Node
## Sonda de rendimiento: ¿cuánto cuesta un frame con CUARENTA bots?
##
## El proyecto prometía 60 fps con 40 bots (GDD §11) y lo tenía "sin medir":
## `AIScheduler` y sus techos duros DEBERÍAN dar el número, pero «debería» no
## es un número. Esto lo mide.
##
## Cómo lo mide, porque el método importa más que la cifra: dos tramos
## iguales, uno con el planificador de IA encendido y otro con él apagado, en
## la misma planta, con los mismos cuerpos y la misma física. La diferencia es
## el coste de la IA. Medir solo el total no distingue "la IA es caraa" de
## "esta máquina es lenta", y el contenedor de CI es lento.
##
## Lo que NO mide: el render. Esto corre en `--headless`, así que el coste de
## dibujar no aparece. El presupuesto de abajo lo tiene en cuenta dejando
## margen: si la simulación se come el frame entero, no hay 60 fps posibles
## por bien que se dibuje.
##
## Uso: tools/perf_probe/probe.sh <ruta-a-godot>

## Bots enemigos que se ponen en la planta. El número de la promesa.
const BOTS: int = 40
## Frames que se miden en cada tramo. A 60 Hz nominales, ~8 s de simulación.
const SAMPLE_FRAMES: int = 500
## Frames que se descartan al empezar cada tramo: el primero paga el horneado
## de navegación, la adopción de bots y el primer tick de percepción de todos.
const WARMUP_FRAMES: int = 120
## Planta grande, para que la navegación y las coberturas sean las de verdad.
const FLOOR: int = 5
const ZONE: int = 5
const SEED: int = 20120601
## Presupuesto de simulación por frame, en milisegundos. 16,6 ms es el frame
## completo a 60 fps; la simulación no puede quedarse con más de la mitad.
const SIM_BUDGET_MS: float = 8.0
## Tope del percentil 95. Un p95 por encima del frame entero significa que uno
## de cada veinte frames se cae SOLO por la simulación, sin haber dibujado
## nada: eso ya no es ruido de la máquina, es un problema del juego.
const FRAME_MS_60FPS: float = 16.6

var _loader: Node = null
var _spawned: int = 0


func _ready() -> void:
	_run()


func _run() -> void:
	var main := (load("res://scenes/main.tscn") as PackedScene).instantiate()
	add_child(main)
	await get_tree().process_frame

	var intents := UIIntents.get_singleton()
	intents.run_start_requested.emit(&"captain")
	await get_tree().process_frame
	GameState.run_seed = SEED
	GameState.current_floor = FLOOR
	intents.strategy_confirmed.emit(ZONE, 0, {})
	await _wait(120)

	_loader = main.get_node_or_null("%LevelLoader")
	if _loader == null:
		printerr("[sonda] sin LevelLoader no se puede medir")
		get_tree().quit(1)
		return
	_fill_with_bots()
	await _wait(60)

	var alive := _count_enemies()
	var with_ai := await _measure(true)
	var without_ai := await _measure(false)
	AIScheduler.set_enabled(true)

	var mean_with := float(with_ai["mean"])
	var mean_without := float(without_ai["mean"])
	var ai_cost := mean_with - mean_without
	print("[sonda] %d bots enemigos vivos en la planta %d zona %d" % [alive, FLOOR, ZONE])
	print("  frame con IA:    media %.2f ms · p95 %.2f ms · peor %.2f ms" % [
		with_ai["mean"], with_ai["p95"], with_ai["max"]])
	print("  frame sin IA:    media %.2f ms · p95 %.2f ms" % [
		without_ai["mean"], without_ai["p95"]])
	print("  coste de la IA:  %.2f ms de media (%.0f %% del frame)" % [
		ai_cost, 100.0 * ai_cost / maxf(mean_with, 0.001)])
	print("  planificador:    %d clientes · %d rayos el último frame · %d decisiones el último tick" % [
		AIScheduler.stat_clients, AIScheduler.stat_raycasts_last_frame,
		AIScheduler.stat_decisions_last_tick])

	var failures: Array[String] = []
	if alive < BOTS:
		failures.append("solo %d bots de los %d que se pidieron: la medida no vale" % [alive, BOTS])
	if mean_with > SIM_BUDGET_MS:
		failures.append("la simulación se come %.2f ms de media, presupuesto %.2f ms"
			% [mean_with, SIM_BUDGET_MS])
	if float(with_ai["p95"]) > FRAME_MS_60FPS:
		failures.append("p95 de %.2f ms: uno de cada veinte frames se cae solo con la simulación"
			% float(with_ai["p95"]))
	if AIScheduler.stat_raycasts_last_frame > AIScheduler.MAX_RAYCASTS_PER_FRAME:
		failures.append("techo de rayos superado: %d > %d"
			% [AIScheduler.stat_raycasts_last_frame, AIScheduler.MAX_RAYCASTS_PER_FRAME])
	if AIScheduler.stat_decisions_last_tick > AIScheduler.MAX_DECISIONS_PER_TICK:
		failures.append("techo de decisiones superado: %d > %d"
			% [AIScheduler.stat_decisions_last_tick, AIScheduler.MAX_DECISIONS_PER_TICK])
	if failures.is_empty():
		print("[sonda] la simulación cabe en el frame.")
		get_tree().quit(0)
		return
	for line: String in failures:
		printerr("[sonda] FALLO: %s" % line)
	get_tree().quit(1)


## Pone bots hasta llegar a `BOTS`, repartidos por los puntos de aparición que
## el propio director considera justos. No se colocan a mano: un bot en el
## vacío o dentro de un muro no cuesta lo que cuesta un bot que navega.
func _fill_with_bots() -> void:
	var runtime := _find_encounter_runtime()
	var director: Object = runtime.get("_director") if runtime != null else null
	var squad := 100
	while _count_enemies() < BOTS:
		# `pick_spawn_positions` devuelve `Array[Vector3]`, NO
		# `PackedVector3Array`. Comprobarlo contra el tipo equivocado hacía que
		# la sonda se rindiera en la primera vuelta y midiera con tres bots.
		var positions: Array = []
		if director != null:
			var raw: Variant = director.call("pick_spawn_positions", 8)
			if raw is Array:
				positions = raw as Array
		if positions.is_empty():
			break
		for position: Vector3 in positions:
			if _count_enemies() >= BOTS:
				break
			squad += 1
			var archetype: StringName = [&"enemy_thug", &"enemy_militiaman", &"enemy_veteran"][
				_spawned % 3]
			_loader.call("spawn_enemy", archetype, position, int(float(squad) / 4.0))
			_spawned += 1


## Mide `SAMPLE_FRAMES` frames y devuelve media, p95 y máximo en milisegundos.
func _measure(ai_enabled: bool) -> Dictionary:
	AIScheduler.set_enabled(ai_enabled)
	await _wait(WARMUP_FRAMES)
	var samples: Array[float] = []
	for _i: int in range(SAMPLE_FRAMES):
		var started := Time.get_ticks_usec()
		await get_tree().physics_frame
		samples.append(float(Time.get_ticks_usec() - started) / 1000.0)
	samples.sort()
	var total := 0.0
	for value: float in samples:
		total += value
	return {
		"mean": total / float(samples.size()),
		"p95": samples[int(float(samples.size()) * 0.95)],
		"max": samples[samples.size() - 1],
	}


func _wait(frames: int) -> void:
	for _i: int in range(frames):
		await get_tree().physics_frame


func _count_enemies() -> int:
	var total := 0
	for node: Node in get_tree().get_nodes_in_group(&"characters"):
		var character := node as Character
		if character != null and character.alive and character.team == Character.Team.ENEMY:
			total += 1
	return total


func _find_encounter_runtime() -> Node:
	return _find_by_script(get_tree().root, "encounter_runtime.gd")


func _find_by_script(node: Node, suffix: String) -> Node:
	var script := node.get_script() as Script
	if script != null and script.resource_path.ends_with(suffix):
		return node
	for child: Node in node.get_children():
		var found := _find_by_script(child, suffix)
		if found != null:
			return found
	return null
