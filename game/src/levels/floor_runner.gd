class_name FloorRunner
extends Node
## Encadena una planta completa: monta el mapa de la zona elegida, arranca el
## director de encuentros, detecta la victoria o la derrota y prepara la
## siguiente.
##
## Es la máquina de modos que el original tenía a medias: su `GameStrategy`
## estaba documentado literalmente como «Inutilizado por el momento» y la
## elección de zona era una ruleta de sectores aleatorios. Aquí el bucle
## Menú → Estrategia → Acción → Fin de planta existe de verdad.
##
## No decide nada de juego: pregunta. La composición enemiga la da el
## director, los puntos de aparición la navegación, y el estado de la partida
## vive en `GameState`. Esto solo los conecta en el orden correcto.

signal floor_started(floor_number: int, zone: int)
signal floor_cleared(floor_number: int, zone: int, elapsed_s: float)
signal run_failed()
signal run_completed()

@export var level_loader_path: NodePath
@export var director_path: NodePath

var _loader: LevelLoader = null
var _director: Node = null
var _elapsed_s: float = 0.0
var _running: bool = false
var _hostiles: Array[Character] = []


func _ready() -> void:
	_loader = get_node_or_null(level_loader_path) as LevelLoader
	_director = get_node_or_null(director_path)
	EventBus.character_died.connect(_on_character_died)
	set_process(false)


## Arranca la planta y zona que indique `GameState`. Devuelve false si no se
## pudo montar: quien llama debe poder distinguir «no hay mapa» de «se perdió».
func start_current_floor() -> bool:
	if _loader == null:
		push_error("FloorRunner: falta el LevelLoader")
		return false

	var cfg := Balance.floor_config(GameState.current_floor)
	if cfg == null:
		push_error("FloorRunner: no hay configuración para la planta %d" % GameState.current_floor)
		return false

	var index := GameState.current_zone - 1
	if index < 0 or index >= cfg.zone_maps.size():
		push_error("FloorRunner: zona %d fuera de rango en la planta %d"
			% [GameState.current_zone, GameState.current_floor])
		return false

	var level := _loader.load_level(cfg.zone_maps[index], GameState.player_archetype,
		true, GameState.companions_for_floor())
	if level == null or level.player == null:
		push_error("FloorRunner: no se pudo montar '%s'" % cfg.zone_maps[index])
		return false

	_hostiles.clear()
	_elapsed_s = 0.0
	_running = true
	set_process(true)
	AIScheduler.set_focus(level.player.global_position)
	GameState.set_mode(GameState.Mode.ACTION)
	GameState.action_status = GameState.ActionStatus.NORMAL
	floor_started.emit(GameState.current_floor, GameState.current_zone)
	return true


func register_hostile(hostile: Character) -> void:
	if hostile != null and not _hostiles.has(hostile):
		_hostiles.append(hostile)


func hostiles_alive() -> int:
	var alive := 0
	for h: Character in _hostiles:
		if is_instance_valid(h) and h.alive:
			alive += 1
	return alive


func elapsed_seconds() -> float:
	return _elapsed_s


func _process(delta: float) -> void:
	if not _running:
		return
	_elapsed_s += delta
	var level := _loader.current()
	if level != null and is_instance_valid(level.player):
		AIScheduler.set_focus(level.player.global_position)


func _on_character_died(_id: int, team: int, _killer: int, xp: int) -> void:
	if not _running:
		return
	if team == int(Character.Team.PLAYER):
		_fail()
		return
	GameState.score += xp
	GameState.experience += xp
	# La zona se da por limpia cuando no queda ningún hostil vivo Y el director
	# ha terminado de liberar su presupuesto: si no se comprueba lo segundo, una
	# pausa entre oleadas se leería como victoria.
	if hostiles_alive() == 0 and _director_finished():
		_clear()


func _director_finished() -> bool:
	if _director == null:
		return true
	if _director.has_method("has_pending_budget"):
		return not bool(_director.call("has_pending_budget"))
	return true


func _clear() -> void:
	_running = false
	set_process(false)
	EventBus.zone_cleared.emit(GameState.current_floor, GameState.current_zone, _elapsed_s)
	floor_cleared.emit(GameState.current_floor, GameState.current_zone, _elapsed_s)

	# La recompensa de la zona se concede al limpiarla, como en el original.
	var reward := GameState.current_zone_reward()
	if reward != &"":
		var stats := Balance.pickup(reward)
		var level := _loader.current()
		if stats != null and level != null and is_instance_valid(level.player):
			match stats.effect:
				PickupStats.Effect.HEAL:
					level.player.heal(stats.amount)
				PickupStats.Effect.AMMO:
					level.player.add_ammo(int(stats.amount))
				_:
					pass

	# Aquí NO se cambia de pantalla, y es el arreglo de dos finales que no se
	# veían:
	#
	#   * el resumen de fin de planta se ponía a la vista y desaparecía en el
	#     MISMO frame, porque esto entraba en modo Estrategia acto seguido y
	#     `UiRoot` solo lo muestra en modo Acción. Un resumen que dura un
	#     frame es un resumen que no existe;
	#   * la azotea limpia saltaba directa a los créditos —`advance_floor()`
	#     dejaba la planta en 10, `run_completed` desmontaba y cambiaba de
	#     modo— así que la pantalla de Victoria, escrita y con sus dos
	#     botones, no se veía JAMÁS.
	#
	# Quien decide la siguiente pantalla es el jugador, pulsando: `Main`
	# traduce `floor_end_acknowledged` y el botón de la Victoria. La planta se
	# queda montada detrás mientras lee, que además es lo que se quiere ver.
	if GameState.is_on_rooftop():
		GameState.action_status = GameState.ActionStatus.WIN
		run_completed.emit()
		return
	GameState.action_status = GameState.ActionStatus.NORMAL
	GameState.advance_floor()


func _fail() -> void:
	_running = false
	set_process(false)
	GameState.action_status = GameState.ActionStatus.GAME_OVER
	run_failed.emit()
