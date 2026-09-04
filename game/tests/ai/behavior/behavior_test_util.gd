class_name BehaviorTestUtil
extends RefCounted
## Constructores de escenario de las pruebas de comportamiento.
##
## AVISO PARA QUIEN AÑADA PRUEBAS AQUÍ: viven en esta clase y no en los
## ficheros `test_*.gd` por un motivo medido, no por estilo. Un método
## declarado en un `TestCase` cuyo tipo de RETORNO es una clase de GDScript
## (`-> BotState`, `-> BehaviorController`) impide que Godot descargue ese
## script al cerrar, y la ejecución termina con "ObjectDB instances were
## leaked at exit" aunque todas las pruebas pasen. Ocurre con métodos normales
## y estáticos por igual; los PARÁMETROS de ese tipo no dan problema.
## Verificado en 4.7.2.
##
## Regla práctica: en un `test_*.gd`, tipos de clase sólo en variables locales
## y en parámetros. Todo lo que devuelva un objeto del proyecto, aquí.

const BlackboardScript := preload("res://src/core/blackboard.gd")


## Instantánea de un bot en pleno tiroteo: ve al objetivo, entero, con
## munición y a media distancia. Los escenarios de las pruebas se escriben
## como desviaciones de ésta, para que se lea qué cambia y por qué.
static func make_state(overrides: Dictionary = {}) -> BotState:
	var state := BotState.new()
	state.bot_id = 1
	state.squad_id = 7
	state.team = 2
	state.archetype = &"enemy_militiaman"
	state.position = Vector3.ZERO
	state.forward = Vector3.FORWARD
	state.health_ratio = 1.0
	state.ammo_ratio = 1.0
	state.distance_to_target_m = 12.0
	state.has_line_of_sight = true
	state.target_confidence = 1.0
	state.exposure = 0.6
	state.in_cover = false
	state.role = Blackboard.Role.NONE
	state.squad_has_suppression = false
	state.squad_strength = 1.0
	state.known_threat_count = 1
	state.time_since_last_seen_s = 0.0
	for key: String in overrides:
		state.set(key, overrides[key])
	return state


## Pizarra propia, aislada del autoload. Es un `Node`: quien la crea la
## libera en `after_each`, o la ejecución acaba denunciando objetos filtrados.
static func make_board() -> BlackboardScript:
	return BlackboardScript.new()


## Sala abierta de 40×40 m sin obstáculos.
static func open_world() -> BehaviorFakeWorld:
	return BehaviorFakeWorld.new()


## Nube de cobertura con `count` puntos alineados a la izquierda del bot.
static func cover_with_points(count: int, origin: Vector3 = Vector3.ZERO) -> BehaviorFakeCover:
	var cover := BehaviorFakeCover.new()
	for index: int in range(count):
		cover.add_point(origin + Vector3(-4.0 - float(index) * 2.0, 0.0, 0.0))
	return cover


## Nube de cobertura vacía: el nivel no ofrece dónde cubrirse.
static func empty_cover() -> BehaviorFakeCover:
	return BehaviorFakeCover.new()


static func make_actuator(position: Vector3 = Vector3.ZERO) -> BehaviorFakeActuator:
	return BehaviorFakeActuator.new(position)


static func make_context(
	state: BotState,
	world: WorldQuery,
	cover: CoverProvider,
	actuator: BotActuator,
	board: BlackboardScript
) -> BehaviorContext:
	var ctx := BehaviorContext.new(state, world, cover, actuator, board)
	ctx.refresh_from_board()
	return ctx


static func make_controller(
	state: BotState,
	ctx: BehaviorContext,
	weights: UtilityWeights,
	board: BlackboardScript
) -> BehaviorController:
	return BehaviorController.new(state, ctx, weights, board)


static func weights_for(archetype: StringName, health_ratio: float = 1.0) -> UtilityWeights:
	return UtilityWeights.for_archetype(archetype, health_ratio)


static func companion_weights() -> UtilityWeights:
	return UtilityWeights.for_companion()


## Publica un contacto enemigo en la pizarra de la escuadra. Es lo que hace
## `ai-percepcion` en juego; aquí se hace a mano para no depender de ella.
static func report_contact(
	board: BlackboardScript,
	squad_id: int,
	position: Vector3,
	confidence: float = 1.0,
	target_id: int = 99,
	team: int = 0
) -> void:
	var contact := Blackboard.Contact.new()
	contact.target_id = target_id
	contact.team = team
	contact.last_known_position = position
	contact.last_seen_msec = Time.get_ticks_msec()
	contact.confidence = confidence
	board.report_contact(squad_id, contact)


## Acción de guion: devuelve los estados de `results` en orden (repitiendo el
## último) y apunta su nombre en `recorder` cada vez que se ejecuta. Es lo que
## permite comprobar QUÉ hijos ejecuta un compuesto y en qué orden.
static func scripted_action(
	name: StringName,
	results: Array[int],
	recorder: Array[StringName]
) -> BehaviorTree.Action:
	var cursor: Array[int] = [0]
	var routine := func(_c: BehaviorContext, _d: float) -> BehaviorTree.Status:
		recorder.append(name)
		var index: int = mini(cursor[0], results.size() - 1)
		cursor[0] += 1
		return results[index] as BehaviorTree.Status
	return BehaviorTree.Action.new(name, routine)


## Ejecuta un árbol `ticks` veces integrando el movimiento del actuador entre
## tick y tick, y devuelve el último estado como entero. Devolver `int` y no
## `BehaviorTree.Status` es deliberado: ver el aviso de la cabecera.
static func run_tree(
	tree: BehaviorTree.BTNode,
	ctx: BehaviorContext,
	actuator: BehaviorFakeActuator,
	ticks: int,
	delta: float = 0.05
) -> int:
	var status := int(BehaviorTree.Status.RUNNING)
	for _i: int in range(ticks):
		status = int(tree.tick(ctx, delta))
		if actuator != null:
			actuator.advance(delta)
		if status != int(BehaviorTree.Status.RUNNING):
			break
	return status
