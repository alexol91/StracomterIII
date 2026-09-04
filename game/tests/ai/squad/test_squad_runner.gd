extends TestCase
## El ciclo completo de una escuadra en ejecución, sin escena y sin `_process`.
##
## Es la prueba de que las piezas encajan: instantáneas → pizarra → reparto
## puro → pizarra → filtro de cada bot. Y de que el bucle pasa SIEMPRE por la
## pizarra: en ningún punto un bot lee el estado interno de otro.


func before_each() -> void:
	Blackboard.clear()


func after_each() -> void:
	Blackboard.clear()


func test_a_decision_tick_publishes_roles_and_writes_them_back_to_the_states() -> void:
	var runner := SquadRunner.new(1, SquadTestUtil.world_two_accesses())
	for state: BotState in SquadTestUtil.squad_of_four():
		runner.add_bot(state)
	Blackboard.report_contact(1, SquadTestUtil.contact(99, SquadTestUtil.TARGET, 1.0))

	runner.tick_decision(0.2)

	assert_not_null(runner.last_assignment)
	assert_eq(runner.last_assignment.count_of(Blackboard.Role.PINNER), 1)
	assert_eq(Blackboard.role_of(10), runner.last_assignment.role_of(10),
		"el rol llega a la pizarra, que es por donde lo lee el bot")
	assert_size(runner.last_assignment.rule_violations(), 0)


## El contacto entra por la pizarra. Sin contacto publicado, la escuadra no
## tiene objetivo aunque los bots "sepan" dónde está: un bot no puede
## enterarse de nada por otro que no lo haya escrito ahí.
func test_the_squad_is_blind_until_a_contact_reaches_the_blackboard() -> void:
	var runner := SquadRunner.new(2, SquadTestUtil.world_two_accesses())
	for state: BotState in SquadTestUtil.squad_of_four():
		runner.add_bot(state)

	runner.tick_decision(0.2)
	assert_false(runner.last_assignment.has_target, "nadie ha reportado nada")

	Blackboard.report_contact(2, SquadTestUtil.contact(99, SquadTestUtil.TARGET, 1.0))
	runner.tick_decision(0.2)
	assert_true(runner.last_assignment.has_target)


## La supresión también viene de la pizarra, no de un acuerdo entre bots.
func test_suppression_authorizes_the_assault_through_the_blackboard() -> void:
	var runner := SquadRunner.new(3, SquadTestUtil.world_two_accesses())
	for state: BotState in SquadTestUtil.squad_of_four():
		runner.add_bot(state)
	Blackboard.report_contact(3, SquadTestUtil.contact(99, SquadTestUtil.TARGET, 1.0))

	runner.tick_decision(0.2)
	assert_eq(runner.last_assignment.count_of(Blackboard.Role.ASSAULTER), 0)

	Blackboard.mark_suppression(3, 2.0)
	runner.tick_decision(0.2)
	assert_gt(float(runner.last_assignment.count_of(Blackboard.Role.ASSAULTER)), 0.0)


## Las bajas llegan por `EventBus` —`gameplay/` emite, `ai/` escucha— y el
## censo del director NO baja con ellas: por eso la fracción de efectivos
## cae y el repliegue se dispara solo.
func test_deaths_shrink_the_squad_and_trigger_the_retreat() -> void:
	var runner := SquadRunner.new(4, SquadTestUtil.world_two_accesses())
	for state: BotState in SquadTestUtil.squad_of_five():
		runner.add_bot(state)
	Blackboard.report_contact(4, SquadTestUtil.contact(99, SquadTestUtil.TARGET, 1.0))
	runner.push_room_anchor(Vector3(0.0, 0.0, -20.0))
	runner.bind_event_bus()

	runner.tick_decision(0.2)
	assert_false(runner.last_assignment.retreating, "cinco de cinco")

	for bot_id: int in [20, 30, 40]:
		EventBus.character_died.emit(bot_id, int(Character.Team.ENEMY), 0, 0)
	assert_eq(runner.size(), 2, "quedan dos de cinco")
	runner.tick_decision(0.2)
	# El umbral es ESTRICTO: 2 de 5 es exactamente el 40 %, y el 40 % todavía
	# combate. Fijar el borde en una prueba evita que "por debajo del 40 %" se
	# convierta en "al 40 %" la próxima vez que alguien toque la constante.
	assert_false(runner.last_assignment.retreating, "el 40 % justo aún aguanta")

	EventBus.character_died.emit(50, int(Character.Team.ENEMY), 0, 0)
	assert_eq(runner.size(), 1, "queda uno de cinco")
	runner.tick_decision(0.2)
	assert_true(runner.last_assignment.retreating, "el 20 % se repliega")
	assert_almost_eq(runner.last_assignment.rally_point.z, -20.0, 0.001,
		"y se reagrupa en la sala anterior")
	runner.unbind_event_bus()


## Lo que la escuadra prohíbe acaba dentro del `BehaviorController` del bot.
## Es el último eslabón: sin él, el reparto sería una opinión.
func test_the_veto_reaches_the_behavior_controller_of_each_bot() -> void:
	var runner := SquadRunner.new(5, SquadTestUtil.world_two_accesses())
	var controllers: Dictionary[int, BehaviorController] = {}
	for state: BotState in SquadTestUtil.squad_of_four():
		var controller := BehaviorController.new(state, null, null, null)
		controllers[state.bot_id] = controller
		runner.add_bot(state, controller)
	Blackboard.report_contact(5, SquadTestUtil.contact(99, SquadTestUtil.TARGET, 1.0))

	runner.tick_decision(0.2)
	for bot_id: int in controllers:
		var controller: BehaviorController = controllers[bot_id]
		assert_not_null(controller.filter, "el bot %d tiene filtro" % bot_id)
		assert_false(controller.filter.is_allowed(BehaviorKind.Kind.ASSAULT),
			"sin supresión, el bot %d no puede asaltar" % bot_id)


## Nada de IA en `_process` (ADR-002): la escuadra decide cuando el
## planificador se lo permite, igual que todos los demás.
func test_the_runner_lives_in_the_scheduler() -> void:
	var runner := SquadRunner.new(6, null)
	assert_false(runner.is_registered())
	runner.register()
	assert_true(runner.is_registered())
	runner.register()
	assert_true(runner.is_registered(), "registrar dos veces no duplica")
	runner.unregister()
	assert_false(runner.is_registered())


## Sin `WorldQuery` el ciclo sigue funcionando: el grupo fija y se cubre, pero
## no flanquea. Es el modo degradado, y es SILENCIOSO por diseño en el juego
## pero explícito en el motivo del veto.
func test_the_cycle_survives_without_a_world_query() -> void:
	var runner := SquadRunner.new(7, null)
	for state: BotState in SquadTestUtil.squad_of_four():
		runner.add_bot(state)
	Blackboard.report_contact(7, SquadTestUtil.contact(99, SquadTestUtil.TARGET, 1.0))

	runner.tick_decision(0.2)
	assert_eq(runner.last_assignment.count_of(Blackboard.Role.FLANKER), 0)
	assert_eq(runner.last_assignment.flank_veto_reason, &"sin_consulta_de_mundo")
	assert_eq(runner.last_assignment.count_of(Blackboard.Role.PINNER), 1,
		"pero el grupo sigue funcionando")


## La prioridad del planificador se calcula con la posición del grupo, así que
## el runner tiene que mantenerla al día o su escuadra se degradaría a baja
## frecuencia estando delante del jugador.
func test_the_runner_keeps_its_world_position_up_to_date() -> void:
	var runner := SquadRunner.new(8, null)
	var far: Array[BotState] = [
		SquadTestUtil.bot(10, Vector3(10.0, 0.0, 10.0)),
		SquadTestUtil.bot(20, Vector3(20.0, 0.0, 10.0)),
	]
	for state: BotState in far:
		runner.add_bot(state)
	runner.tick_decision(0.2)
	assert_almost_eq(runner.world_position.x, 15.0, 0.001)
	assert_almost_eq(runner.world_position.z, 10.0, 0.001)
