class_name SquadRunner
extends AIScheduler.Client
## Pone en marcha un `SquadDirector` dentro del planificador (ADR-002).
##
## NADA EN `_process`. Esto es un `AIScheduler.Client`: el planificador decide
## cuándo piensa esta escuadra, con el mismo presupuesto y la misma
## degradación por distancia que el resto de la IA. Un grupo lejano y oculto
## reparte roles a menos frecuencia; el que te está disparando, a tasa
## completa. La CALIDAD de la decisión no baja nunca: sólo su frecuencia.
##
## Es la única clase de `ai/squad` con estado de ejecución. El reparto en sí
## sigue siendo la función pura de `SquadDirector`; aquí sólo se recogen las
## entradas, se publica el resultado en la pizarra y se traduce a filtros para
## los `BehaviorController` de cada bot.
##
## EL CICLO COMPLETO, EN ORDEN:
##   1. reunir las instantáneas de los bots vivos del grupo,
##   2. leer contactos y marca de supresión de la PIZARRA (nunca del estado
##      interno de otro bot),
##   3. repartir roles —función pura—,
##   4. publicar roles y reclamaciones de ruta en la pizarra,
##   5. traducir lo permitido a un `BehaviorFilter` por bot.
##
## Los pasos 2 y 4 son los únicos que tocan estado compartido, y los dos
## pasan por `Blackboard`. Ningún bot lee el estado interno de otro en ningún
## punto de este ciclo.

var squad_id: int = 0
var director: SquadDirector = null
## Consulta al mundo, para las rutas de flanqueo y la proyección al navmesh.
## `null` es legítimo y RESTRICTIVO: sin ella el grupo no flanquea.
var world: WorldQuery = null

## Último reparto calculado. Lo lee la consola (`ai.debug`) y la UI de
## depuración; nadie decide nada a partir de él.
var last_assignment: SquadRoleAssignment = null
var stat_decisions: int = 0

var _states: Dictionary[int, BotState] = {}
var _controllers: Dictionary[int, BehaviorController] = {}
var _order: PackedInt32Array = PackedInt32Array()
var _registered: bool = false
var _event_bus_bound: bool = false


func _init(p_squad_id: int = 0, p_world: WorldQuery = null) -> void:
	squad_id = p_squad_id
	world = p_world
	director = SquadDirector.new(p_squad_id, 0)


# ---------------------------------------------------------------------------
# Altas y bajas
# ---------------------------------------------------------------------------

## Da de alta un bot en el grupo. El `BehaviorController` es opcional: sin él
## el reparto se calcula y se publica igual, y eso es justo lo que permite
## probar la escuadra sin montar cerebros.
func add_bot(state: BotState, controller: BehaviorController = null) -> void:
	if state == null:
		return
	_states[state.bot_id] = state
	if controller != null:
		_controllers[state.bot_id] = controller
	if not _order.has(state.bot_id):
		_order.append(state.bot_id)


func remove_bot(bot_id: int) -> void:
	_states.erase(bot_id)
	_controllers.erase(bot_id)
	var index := _order.find(bot_id)
	if index >= 0:
		_order.remove_at(index)


func size() -> int:
	return _states.size()


## Registra que el grupo ha entrado en una sala. Es lo que hace que el
## repliegue tenga a dónde ir.
func push_room_anchor(position: Vector3) -> void:
	director.push_room_anchor(position)


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


## Un tick de decisión de escuadra. Lo llama el planificador; las pruebas lo
## llaman a mano, y ésa es la ventaja de que el reparto viva fuera.
func tick_decision(_delta: float) -> void:
	stat_decisions += 1
	var states: Array[BotState] = []
	var centroid := Vector3.ZERO
	for bot_id: int in _order:
		var state: BotState = _states[bot_id]
		if state.health_ratio <= 0.0:
			continue
		states.append(state)
		centroid += state.position
	if not states.is_empty():
		world_position = centroid / float(states.size())

	# La pizarra es la fuente, no el estado interno de ningún compañero.
	var contacts := Blackboard.contacts_for(squad_id)
	var suppression := Blackboard.has_active_suppression(squad_id)

	var assignment := director.assign_roles(states, contacts, suppression, world)
	director.publish(assignment)
	last_assignment = assignment

	# Y de vuelta a cada bot: su rol, su ángulo y —lo que de verdad importa—
	# lo que NO puede hacer.
	for state: BotState in states:
		state.role = assignment.role_of(state.bot_id)
		state.squad_has_suppression = suppression
		state.squad_strength = assignment.strength_ratio
		var controller: BehaviorController = _controllers.get(state.bot_id, null)
		if controller != null:
			SquadBehaviorBinding.apply_assignment(assignment, state.bot_id, controller)


## La escuadra no percibe: perciben los bots. Devuelve 0 raycasts.
func tick_perception(_delta: float) -> int:
	return 0


# ---------------------------------------------------------------------------
# Bajas
# ---------------------------------------------------------------------------

## Escucha las bajas en `EventBus`. Explícito y no automático para que las
## pruebas controlen cuándo hay conexión global.
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


func _on_character_died(character_id: int, _team: int, _killer_id: int, _xp: int) -> void:
	# El censo del director NO baja: la fracción de efectivos se mide contra
	# el grupo que había, que es lo que hace que el repliegue se dispare.
	remove_bot(character_id)
