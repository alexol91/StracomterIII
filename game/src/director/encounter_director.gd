class_name EncounterDirector
extends Node
## Director de encuentros: une el modelo de habilidad, el Simplex y el ritmo.
##
## Cadena completa, de la geometría al enemigo:
## [codeblock]
## zona (área, forma)  +  planta (dificultad)  +  jugador (SkillModel)
##        -> EncounterContext
##        -> EncounterComposer  (Simplex exacto + ramificación y acotación)
##        -> TensionCurve       (ascenso -> pico -> alivio -> descanso)
##        -> SpawnPointProvider (apariciones justas, ponderadas por camino)
##        -> señal `enemy_requested`
## [/codeblock]
##
## El director NO instancia enemigos: pide que se instancien. Quien los crea
## es `gameplay`, que es la capa de abajo (ADR: las dependencias van solo
## hacia abajo, `docs/02-arquitectura.md` §2).
##
## Todo el camino es determinista: con la misma semilla y las mismas entradas
## sale la misma composición, las mismas oleadas y los mismos puntos.

## Composición decidida para la zona.
signal composition_ready(composition: EncounterComposer.Composition)
## Una oleada ha sido liberada.
signal wave_released(wave: TensionCurve.Wave)
## Petición de crear un enemigo. La escucha `gameplay`.
signal enemy_requested(archetype: StringName, position: Vector3)
signal phase_changed(previous: TensionCurve.Phase, current: TensionCurve.Phase)
## La zona ha terminado, incluido el silencio forzado.
signal encounter_finished()

## Frecuencia a la que el director revisa el ritmo. No hace falta más: el
## director decide cada pocos cientos de milisegundos, no por frame
## (ADR-002).
const TICK_HZ: float = 5.0

var composer: EncounterComposer = null
var skill_model: SkillModel = null
var curve: TensionCurve = null
var spawn_provider: SpawnPointProvider = null

var _profile: DirectorProfile = null
var _rng := RandomNumberGenerator.new()
var _context: EncounterContext = null
var _composition: EncounterComposer.Composition = null
var _hostiles: Dictionary[int, bool] = {}
var _hostiles_alive: int = 0
var _accumulator: float = 0.0
var _active: bool = false
## Posición y mirada del jugador, refrescadas por `gameplay`. El director no
## busca al jugador en el árbol: se lo dicen.
var _player_position: Vector3 = Vector3.ZERO
var _player_forward: Vector3 = Vector3.FORWARD


func _init(profile: DirectorProfile = null) -> void:
	# Nada de autoloads aquí: `_init` corre también al instanciar el nodo en
	# un test, y el perfil se resuelve luego en `_ensure_parts`.
	_profile = profile


func _ready() -> void:
	if _profile == null:
		_profile = Balance.director_profile()
	if _profile == null:
		_profile = DirectorProfile.new()
	composer = EncounterComposer.new(_profile)
	skill_model = SkillModel.new(_profile)
	curve = TensionCurve.new(_profile)
	skill_model.connect_event_bus()
	EventBus.character_died.connect(_on_character_died)
	reseed(GameState.run_seed)
	register_console_commands()


func _exit_tree() -> void:
	if skill_model != null:
		skill_model.disconnect_event_bus()
	if EventBus.character_died.is_connected(_on_character_died):
		EventBus.character_died.disconnect(_on_character_died)


func _process(delta: float) -> void:
	if not _active:
		return
	_accumulator += delta
	var period := 1.0 / TICK_HZ
	while _accumulator >= period:
		_accumulator -= period
		tick(period)


# ---- Configuración ----

## Inyecta el proveedor de puntos de aparición. Lo hace `ai-navegacion` al
## construir el nivel; en los tests se inyecta un doble.
func configure(provider: SpawnPointProvider) -> void:
	spawn_provider = provider


## Fija la semilla del director. Todo el azar del director sale de aquí.
func reseed(seed_value: int) -> void:
	_rng.seed = seed_value


func set_player_pose(position: Vector3, forward: Vector3) -> void:
	_player_position = position
	_player_forward = forward if forward.length_squared() > 0.0 else Vector3.FORWARD


# ---- Ciclo de la zona ----

## Compone el encuentro de una zona y arranca su curva de tensión.
func begin_zone(context: EncounterContext) -> EncounterComposer.Composition:
	_ensure_parts()
	_context = context
	if context.skill_multiplier <= 0.0:
		context.skill_multiplier = skill_model.skill_multiplier()
	_composition = composer.compose(context)
	curve.plan(_composition)
	curve.begin()
	skill_model.begin_encounter(_composition.total(), GameState.squad.size())
	_hostiles.clear()
	_hostiles_alive = 0
	_accumulator = 0.0
	_active = true
	_rng.seed = context.seed if context.seed != 0 else GameState.run_seed
	composition_ready.emit(_composition)
	return _composition


## Un paso del director. Se puede llamar a mano desde un test: no depende de
## `_process` ni del árbol de escena.
func tick(delta_s: float) -> void:
	if not _active or curve == null:
		return
	var previous := curve.phase()
	var current := curve.advance(delta_s, _hostiles_alive)
	if current != previous:
		phase_changed.emit(previous, current)
	var wave := curve.take_wave(_hostiles_alive)
	if wave != null:
		_release(wave)
	if curve.is_finished():
		_active = false
		encounter_finished.emit()


## Notifica que un enemigo generado ya existe en el mundo, para que el
## director sepa cuánta presión hay viva.
func report_enemy_spawned(character_id: int) -> void:
	if _hostiles.has(character_id):
		return
	_hostiles[character_id] = true
	_hostiles_alive = _hostiles.size()


func hostiles_alive() -> int:
	return _hostiles_alive


func composition() -> EncounterComposer.Composition:
	return _composition


func context() -> EncounterContext:
	return _context


func is_active() -> bool:
	return _active


# ---- Generación ----

func _release(wave: TensionCurve.Wave) -> void:
	var archetypes := wave.to_archetype_list()
	var positions := _positions_for(archetypes.size())
	for index: int in archetypes.size():
		if index >= positions.size():
			# Sin punto justo no se genera. El original consumía la
			# iteración y dejaba de generar enemigos sin decírselo a nadie
			# (`Optimization.cc:163-168`); aquí la oleada se queda corta a
			# propósito y de forma visible.
			break
		enemy_requested.emit(archetypes[index], positions[index])
	wave_released.emit(wave)


func _positions_for(count: int) -> Array[Vector3]:
	var out: Array[Vector3] = []
	if spawn_provider == null or count <= 0:
		return out
	var request := SpawnPointProvider.SpawnRequest.new()
	request.player_position = _player_position
	request.player_forward = _player_forward
	request.min_distance_m = _profile.min_spawn_distance_m
	request.forbid_in_player_fov = _profile.forbid_spawn_in_player_fov
	request.forbid_line_of_sight = _profile.forbid_spawn_with_line_of_sight
	request.prefer_entry_points = _profile.prefer_entry_points
	request.zone_id = _context.zone if _context != null else 0
	request.count = count
	var candidates := spawn_provider.sample_candidates(request)
	for candidate: SpawnPointProvider.SpawnCandidate in SpawnPointProvider.select(
			candidates, request, _rng):
		out.append(candidate.position)
	return out


func _ensure_parts() -> void:
	if _profile == null:
		_profile = Balance.director_profile()
	if _profile == null:
		_profile = DirectorProfile.new()
	if composer == null:
		composer = EncounterComposer.new(_profile)
	if skill_model == null:
		skill_model = SkillModel.new(_profile)
	if curve == null:
		curve = TensionCurve.new(_profile)


func _on_character_died(character_id: int, _team: int, _killer_id: int, _xp: int) -> void:
	if not _hostiles.has(character_id):
		return
	_hostiles.erase(character_id)
	_hostiles_alive = _hostiles.size()


# ---- Consola de depuración ----

## Registra los comandos del director. Es la herramienta con la que se
## depura el balanceo sin jugar la planta entera.
func register_console_commands() -> void:
	DevConsole.register("director.status", "Estado del director: fase, oleadas y habilidad.", 0,
		_cmd_status)
	DevConsole.register("director.budget", "Presupuestos del encuentro en curso.", 0, _cmd_budget)
	DevConsole.register(
		"director.compose",
		"Compone un encuentro de prueba: director.compose <area_m2> <dificultad> [legacy].",
		2,
		_cmd_compose
	)


func _cmd_status(_args: Array[String]) -> String:
	_ensure_parts()
	var lines: Array[String] = []
	lines.append("Director: %s" % ("activo" if _active else "inactivo"))
	lines.append("  habilidad: x%.3f (puntuación %.3f sobre %d encuentros)" % [
		skill_model.skill_multiplier(), skill_model.current_score(), skill_model.sample_count()])
	if curve != null:
		lines.append("  fase: %s (%.1f s), oleadas pendientes: %d" % [
			TensionCurve.phase_name(curve.phase()), curve.time_in_phase_s(),
			curve.pending_wave_count()])
	lines.append("  hostiles vivos: %d" % _hostiles_alive)
	if _composition != null:
		lines.append("  composición: %s" % _composition.describe())
	if _context != null:
		lines.append("  contexto: %s" % _context.to_string())
	return "\n".join(lines)


func _cmd_budget(_args: Array[String]) -> String:
	_ensure_parts()
	if _context == null:
		return "No hay zona en curso. Prueba: director.compose <area_m2> <dificultad>"
	var total := composer.max_enemies(_context)
	var budgets := composer.budgets_for(_context, total)
	var lines: Array[String] = []
	lines.append("MaxEnemies = %d  (área %.0f m², dificultad efectiva %.3f)" % [
		total, _context.navigable_area_m2, _context.effective_difficulty()])
	lines.append("  presupuesto de daño:      %.1f" % budgets[0])
	lines.append("  presupuesto de vida:      %.1f" % budgets[1])
	lines.append("  presupuesto de velocidad: %.1f" % budgets[2])
	if _composition != null:
		lines.append("  consumido: %.1f / %.1f / %.1f" % [
			_composition.spent[0], _composition.spent[1], _composition.spent[2]])
	return "\n".join(lines)


func _cmd_compose(args: Array[String]) -> String:
	_ensure_parts()
	var test_context := EncounterContext.new()
	test_context.navigable_area_m2 = args[0].to_float()
	test_context.floor_difficulty = args[1].to_float()
	test_context.skill_multiplier = skill_model.skill_multiplier()
	test_context.floor_number = GameState.current_floor
	test_context.zone = GameState.current_zone
	var floor_data := Balance.floor_config(GameState.current_floor)
	if floor_data != null:
		test_context.allowed_archetypes = floor_data.enemy_pool.duplicate()
	# Forma del mapa: si no hay zona en curso se usa la de la zona actual.
	if _context != null:
		test_context.cover_points_per_100m2 = _context.cover_points_per_100m2
		test_context.mean_line_of_sight_m = _context.mean_line_of_sight_m
		test_context.entry_count = _context.entry_count
	var use_legacy := args.size() > 2 and args[2].to_lower() == "legacy"
	var previous := composer.legacy_formulation
	composer.legacy_formulation = use_legacy
	var result := composer.compose(test_context)
	composer.legacy_formulation = previous
	return "%s\n  objetivo: %s\n  presupuestos: %s\n  consumido: %s\n  nodos: %d" % [
		result.describe(),
		str(result.target_counts),
		str(result.budgets),
		str(result.spent),
		result.nodes_explored,
	]
