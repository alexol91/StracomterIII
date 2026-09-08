extends Node
## Sonda de partida: ¿se puede TERMINAR la torre?
##
## La sonda de combate (`tools/combat_probe/`) comprueba que dentro de una zona
## se pelea. Esto comprueba lo otro: que las nueve plantas se enlazan, que el
## resumen de fin de planta lleva a Estrategia, que la azotea acaba en la
## pantalla de Victoria y que desde ahí se llega a los créditos.
##
## Existe porque los dos finales estaban roto y no daban ningún error:
##
##   * el resumen de fin de planta se ponía a la vista y desaparecía en el
##     MISMO frame — `FloorRunner` entraba en modo Estrategia acto seguido y
##     `UiRoot` solo muestra el resumen en modo Acción;
##   * la azotea limpia saltaba directa a los créditos, así que la pantalla de
##     Victoria, escrita y con sus dos botones, no se veía JAMÁS.
##
## Ninguna prueba del runner podía cogerlo: son síncronas, no pasan frames, y
## esto es una secuencia de nueve montajes de nivel.
##
## Uso: tools/run_probe/probe.sh <ruta-a-godot>
## Sale con código 1 si la torre no se puede terminar.

const PHYSICS_HZ: float = 60.0
## Semilla fija, por lo mismo que en la sonda de combate.
const SEED: int = 20120601
## Zona que se elige en cada planta. La 1 es la más barata de todas.
const ZONE: int = 1
## Segundos que se espera a que una planta se monte y el director suelte su
## presupuesto antes de limpiarla.
const SETTLE_S: float = 2.0
## Segundos que se espera tras limpiar, para que la comprobación de zona limpia
## y el resumen lleguen.
const AFTER_CLEAR_S: float = 0.5
## Intentos de limpieza por planta. El director suelta oleadas: una sola pasada
## puede dejar enemigos por aparecer, y entonces la zona no se da por limpia.
const CLEAR_ATTEMPTS: int = 60

var _failures: Array[String] = []
var _intents: Object = null


var _cleared: bool = false


func _ready() -> void:
	EventBus.zone_cleared.connect(func(_f: int, _z: int, _e: float) -> void: _cleared = true)
	_run()


func _run() -> void:
	var main := (load("res://scenes/main.tscn") as PackedScene).instantiate()
	add_child(main)
	await get_tree().process_frame

	_intents = UIIntents.get_singleton()
	_intents.call("emit_signal", "run_start_requested", &"captain")
	await get_tree().process_frame
	GameState.run_seed = SEED
	if GameState.mode != GameState.Mode.STRATEGY:
		_fail("empezar partida no lleva a Estrategia (modo %d)" % int(GameState.mode))
		_finish()
		return

	for expected_floor: int in range(GameState.FIRST_FLOOR, GameState.ROOFTOP_FLOOR + 1):
		if GameState.current_floor != expected_floor:
			_fail("se esperaba la planta %d y la partida está en la %d"
				% [expected_floor, GameState.current_floor])
			break
		if not await _play_floor(expected_floor):
			break

	_finish()


## Juega una planta: la monta, la limpia y comprueba a dónde lleva. Devuelve
## `false` si algo se rompió y no tiene sentido seguir subiendo.
func _play_floor(number: int) -> bool:
	_cleared = false
	_intents.call("emit_signal", "strategy_confirmed", ZONE, 0, {})
	await _wait(SETTLE_S)
	if GameState.mode != GameState.Mode.ACTION:
		_fail("planta %d: confirmar la zona no arranca la acción (modo %d)"
			% [number, int(GameState.mode)])
		return false

	# El jugador de la sonda no juega: limpia. Lo que se mide aquí es el
	# enlace entre plantas, no el combate — de eso ya se encarga la otra sonda.
	var player := _find_player()
	if player == null:
		_fail("planta %d: no hay jugador en la planta" % number)
		return false
	player.set_meta(&"godmode", true)
	# El director suelta su presupuesto en oleadas separadas por
	# `min_wave_interval_s`, así que una sola pasada deja enemigos por
	# aparecer: se limpia en bucle hasta que la zona se da por limpia.
	for attempt: int in range(CLEAR_ATTEMPTS):
		var report := Cheats.execute(":killall")
		await _wait(AFTER_CLEAR_S)
		if _cleared:
			print("[sonda] planta %d: limpia en %.0f s (%s)" % [
				number, float(attempt + 1) * AFTER_CLEAR_S, report])
		if _cleared:
			break
		if GameState.mode != GameState.Mode.ACTION:
			break

	# Qué planta era se sabe por el número que se estaba jugando, NO por
	# `GameState.is_on_rooftop()`: al limpiar, `FloorRunner` ya ha avanzado la
	# planta, así que después de limpiar la 8 el estado dice 9 y la sonda se
	# creía en la azotea.
	if number >= GameState.ROOFTOP_FLOOR:
		return await _finish_rooftop()
	return await _leave_floor(number)


## Fin de planta intermedio: la partida se queda en Acción con el resumen
## delante, y solo pasa a Estrategia cuando el jugador lo confirma.
func _leave_floor(number: int) -> bool:
	if GameState.mode != GameState.Mode.ACTION:
		_fail("planta %d: la partida salió de Acción sola, sin resumen (modo %d)"
			% [number, int(GameState.mode)])
		return false
	if GameState.action_status == GameState.ActionStatus.WIN:
		_fail("planta %d: pantalla de Victoria en una planta que no es la azotea" % number)
		return false
	var floor_before := GameState.current_floor
	if floor_before != number + 1:
		_fail("planta %d limpia y la partida sigue en la %d" % [number, floor_before])
		return false
	_intents.call("emit_signal", "floor_end_acknowledged")
	await _wait(0.2)
	if GameState.mode != GameState.Mode.STRATEGY:
		_fail("planta %d: el resumen no lleva a Estrategia (modo %d)"
			% [number, int(GameState.mode)])
		return false
	print("[sonda] planta %d → resumen → Estrategia de la %d" % [number, GameState.current_floor])
	return true


## Azotea: la partida se queda en Victoria, y de ahí a los créditos.
func _finish_rooftop() -> bool:
	if GameState.action_status != GameState.ActionStatus.WIN:
		_fail("azotea limpia y no hay pantalla de Victoria (estado %d)"
			% int(GameState.action_status))
		return false
	if GameState.mode != GameState.Mode.ACTION:
		_fail("azotea: la Victoria necesita seguir en Acción para verse (modo %d)"
			% int(GameState.mode))
		return false
	print("[sonda] azotea limpia → pantalla de Victoria")
	_intents.call("emit_signal", "navigate_to_credits_requested")
	await _wait(0.2)
	if GameState.mode != GameState.Mode.CREDITS:
		_fail("desde la Victoria no se llega a los créditos (modo %d)" % int(GameState.mode))
		return false
	print("[sonda] Victoria → créditos. La torre se termina.")
	return true


func _wait(seconds: float) -> void:
	for _i: int in range(int(seconds * PHYSICS_HZ)):
		await get_tree().physics_frame


func _enemies_alive() -> int:
	var total := 0
	for node: Node in get_tree().get_nodes_in_group(&"characters"):
		var c := node as Character
		if c != null and c.alive and c.team == Character.Team.ENEMY:
			total += 1
	return total


func _find_player() -> Character:
	for node: Node in get_tree().get_nodes_in_group(&"characters"):
		var character := node as Character
		if character != null and character.team == Character.Team.PLAYER:
			return character
	return null


func _fail(message: String) -> void:
	_failures.append(message)


func _finish() -> void:
	if _failures.is_empty():
		print("[sonda] la torre se puede terminar: 9 plantas, Victoria y créditos.")
		get_tree().quit(0)
		return
	for line: String in _failures:
		printerr("[sonda] FALLO: %s" % line)
	get_tree().quit(1)
