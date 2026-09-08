class_name CompanionRunner
extends AIScheduler.Client
## Pone en marcha una `CompanionSquad` dentro del planificador (ADR-002).
##
## Es el gemelo de `SquadRunner` para el bando del jugador, y era la pieza que
## faltaba: `CompanionSquad`, `CompanionController`, `CompanionFormation` y
## `CompanionWeights` estaban escritos y probados, y NADIE los instanciaba en
## partida. La pantalla de Estrategia dejaba elegir a quién te llevabas a la
## planta y no aparecía nadie.
##
## NADA EN `_process`: el planificador decide cuándo piensa esta escuadra, con
## el mismo presupuesto que el resto de la IA.
##
## El ciclo, en orden:
##   1. refrescar la moral según la cercanía al Capitán vivo,
##   2. decidir la directiva de cada compañero —función pura del controlador—,
##   3. traducirla a `BehaviorFilter` + `UtilityWeights` para su cerebro,
##   4. dejarle el punto al que ir en su `BehaviorContext.objective`.
##
## El paso 4 es el que hace visible la formación: `FOLLOW_LEADER` lee
## `objective`, y sin rellenarlo el compañero se queda plantado donde nació.

var squad: CompanionSquad = null
## Cuerpo del jugador. Es de `gameplay/`, y la dependencia va en la dirección
## permitida (`ai → gameplay`): se le leen posición y rumbo, nunca se le toca.
var leader: Character = null
## Consulta al mundo, para proyectar los huecos de formación sobre el navmesh.
##
## `null` es legítimo y RESTRICTIVO: sin ella los huecos se usan tal cual, y un
## hueco tal cual puede caer fuera del suelo. La planta de 2012 es un POLÍGONO,
## no un rectángulo: el hueco a 2,4 m a la izquierda del jugador puede estar en
## el vacío aunque el jugador esté en medio de la sala. Y `move_along_path`,
## cuando el destino queda cerca pero no tiene ruta, hace la aproximación final
## en línea recta — que es literalmente caminar por el aire. Medido: un
## compañero a −78 m de altura y bajando.
var world: WorldQuery = null

var _bodies: Dictionary[int, Character] = {}
var _states: Dictionary[int, BotState] = {}
var _controllers: Dictionary[int, BehaviorController] = {}
var _contexts: Dictionary[int, BehaviorContext] = {}
var _order: Array[int] = []
var _registered: bool = false
var _event_bus_bound: bool = false

var stat_decisions: int = 0


func _init(p_leader: Character = null, p_player_archetype: StringName = &"captain",
		p_world: WorldQuery = null) -> void:
	leader = p_leader
	world = p_world
	squad = CompanionSquad.new(Blackboard.PLAYER_SQUAD_ID, p_player_archetype)


# ---------------------------------------------------------------------------
# Altas y bajas
# ---------------------------------------------------------------------------

## Da de alta un compañero con el cerebro que ya lleva puesto.
func add_companion(body: Character, brain: BotBrain) -> void:
	if body == null or brain == null or brain.state == null:
		return
	var bot_id := brain.state.bot_id
	squad.add_companion(bot_id, body.archetype)
	_bodies[bot_id] = body
	_states[bot_id] = brain.state
	_controllers[bot_id] = brain.controller
	_contexts[bot_id] = brain.context
	if not _order.has(bot_id):
		_order.append(bot_id)


func remove_companion(bot_id: int) -> void:
	_bodies.erase(bot_id)
	_states.erase(bot_id)
	_controllers.erase(bot_id)
	_contexts.erase(bot_id)
	var index := _order.find(bot_id)
	if index >= 0:
		_order.remove_at(index)


func size() -> int:
	return _order.size()


func companion_ids() -> Array[int]:
	return _order.duplicate()


# ---------------------------------------------------------------------------
# Planificador
# ---------------------------------------------------------------------------

func register() -> void:
	if _registered:
		return
	AIScheduler.register(self)
	_registered = true


func unregister() -> void:
	if not _registered:
		return
	AIScheduler.unregister(self)
	_registered = false


func is_registered() -> bool:
	return _registered


func bind_event_bus() -> void:
	if _event_bus_bound:
		return
	EventBus.character_died.connect(_on_character_died)
	_event_bus_bound = true


func unbind_event_bus() -> void:
	if not _event_bus_bound:
		return
	EventBus.character_died.disconnect(_on_character_died)
	_event_bus_bound = false


func tick_decision(_delta: float) -> void:
	if leader == null or not is_instance_valid(leader) or _order.is_empty():
		return
	stat_decisions += 1
	world_position = leader.global_position

	_refresh_morale()
	var directives := squad.decide_all(
		_states, leader.global_position, -leader.global_transform.basis.z)
	for directive: CompanionDirective in directives:
		var controller: BehaviorController = _controllers.get(directive.bot_id, null)
		if controller != null:
			SquadBehaviorBinding.apply_directive(directive, controller)
		var context: BehaviorContext = _contexts.get(directive.bot_id, null)
		if context == null:
			continue
		# `objective` es de donde `FOLLOW_LEADER` saca a dónde ir. Sin esto el
		# compañero se queda plantado donde nació aunque su directiva diga
		# perfectamente que debería estar al lado del jugador.
		context.objective = _navigable(directive.move_target)
		context.rally_point = _navigable(directive.formation_slot)
		var state: BotState = _states.get(directive.bot_id, null)
		if state != null:
			state.role = Blackboard.Role.NONE
			state.squad_strength = directive.obedience


## La escuadra no percibe: perciben los compañeros con su propio cerebro.
func tick_perception(_delta: float) -> int:
	return 0


## Proyecta un punto sobre el navmesh. Si no hay consulta al mundo o el punto
## no se puede proyectar, se devuelve tal cual: es información que no ha
## llegado, y en ese caso manda lo que decidió la escuadra.
func _navigable(point: Vector3) -> Vector3:
	if world == null or not BehaviorContext.is_finite_point(point):
		return point
	var snapped := world.snap_to_navmesh(point)
	return snapped if BehaviorContext.is_finite_point(snapped) else point


## Moral por cercanía al Capitán, como `EventControl::UpdateMoral` del
## original. Si el jugador no es Capitán no hay aura y la moral se queda en la
## de la ficha, que es exactamente lo que debe pasar.
func _refresh_morale() -> void:
	var positions: Dictionary[int, Vector3] = {}
	for bot_id: int in _order:
		var body: Character = _bodies.get(bot_id, null)
		if body != null and is_instance_valid(body):
			positions[bot_id] = body.global_position
	var captains: Array[Vector3] = []
	if leader.archetype == &"captain" and leader.alive:
		captains.append(leader.global_position)
	for bot_id: int in _order:
		var body: Character = _bodies.get(bot_id, null)
		if body != null and is_instance_valid(body) \
				and body.archetype == &"captain" and body.alive:
			captains.append(body.global_position)
	squad.refresh_near_captain(positions, captains, CompanionSquad.captain_aura_radius_m())


func _on_character_died(character_id: int, _team: int, _killer_id: int, _xp: int) -> void:
	if not _order.has(character_id):
		return
	# La moral de los supervivientes baja ANTES de darlo de baja: si se
	# quitara primero, la penalización se aplicaría a un grupo que ya no lo
	# incluye y el hueco de formación se recolocaría sin coste.
	squad.on_member_died(character_id)
	remove_companion(character_id)
