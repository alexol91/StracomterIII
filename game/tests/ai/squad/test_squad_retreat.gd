extends TestCase
## Repliegue por debajo del 40 % de efectivos (GDD §8.4).
##
## La regla existe contra un patrón muy concreto: el grupo diezmado que sigue
## atacando y muere de uno en uno, que es exactamente lo que hacían los
## enemigos del original —su FSM no tenía ni concepto de grupo ni de bajas
## (`Enemy.cc`, análisis §5.5)—. Aquí, cuando el grupo se rompe, se rompe
## entero y se reagrupa en la sala anterior.


func before_each() -> void:
	Blackboard.clear()


func after_each() -> void:
	Blackboard.clear()


## LA PRUEBA DEL ENUNCIADO: grupo al 30 % ⇒ repliegue.
func test_group_at_thirty_percent_retreats() -> void:
	var director := SquadTestUtil.director(1, 10)
	var world := SquadTestUtil.world_two_accesses()
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(30, Vector3(0.0, 0.0, -1.0)),
	]
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), true, world
	)

	assert_almost_eq(assignment.strength_ratio, 0.3, 0.0001)
	assert_true(assignment.retreating, "3 de 10 está por debajo del 40 %")
	assert_eq(assignment.count_of(Blackboard.Role.RESERVE), 3, "nadie conserva rol de ataque")
	assert_size(assignment.rule_violations(), 0)


## El repliegue no es un rol: es una prohibición. Aunque haya supresión
## activa y rutas de flanqueo disponibles, un grupo roto no asalta ni rodea.
func test_a_retreating_group_can_neither_assault_nor_flank() -> void:
	var director := SquadTestUtil.director(1, 10)
	var world := SquadTestUtil.world_three_accesses()
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(30, Vector3(0.0, 0.0, -1.0)),
	]
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), true, world
	)
	for bot_id: int in [10, 20, 30]:
		assert_false(assignment.allows(bot_id, BehaviorKind.Kind.ASSAULT),
			"el bot %d no puede asaltar replegándose" % bot_id)
		assert_false(assignment.allows(bot_id, BehaviorKind.Kind.FLANK),
			"el bot %d no puede flanquear replegándose" % bot_id)
		assert_true(assignment.allows(bot_id, BehaviorKind.Kind.RETREAT))
		assert_true(assignment.allows(bot_id, BehaviorKind.Kind.REGROUP))


func test_group_above_the_threshold_keeps_fighting() -> void:
	var director := SquadTestUtil.director(1, 10)
	var world := SquadTestUtil.world_two_accesses()
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(30, Vector3(0.0, 0.0, -1.0)),
		SquadTestUtil.flanker_candidate(40, Vector3(0.0, 0.0, 1.0)),
		SquadTestUtil.flanker_candidate(50, Vector3(2.0, 0.0, 0.0)),
	]
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)
	assert_almost_eq(assignment.strength_ratio, 0.5, 0.0001)
	assert_false(assignment.retreating, "el 50 % está por encima del umbral")
	assert_eq(assignment.count_of(Blackboard.Role.PINNER), 1)


## El repliegue va a la SALA ANTERIOR, no a un punto cualquiera hacia atrás.
## Es un concepto de nivel, no de geometría: por eso lo registra quien mueve
## al grupo y no se deduce de las posiciones de los bots.
func test_rally_point_is_the_previous_room() -> void:
	var director := SquadTestUtil.director(1, 10)
	var world := SquadTestUtil.world_two_accesses()
	director.push_room_anchor(Vector3(0.0, 0.0, -30.0))
	director.push_room_anchor(Vector3(0.0, 0.0, -14.0))
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(30, Vector3(0.0, 0.0, -1.0)),
	]
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)
	assert_true(assignment.retreating)
	assert_almost_eq(assignment.rally_point.z, -14.0, 0.001,
		"la sala anterior, no la primera del nivel")


## Retroceder a una sala que el enemigo ya bate no es replegarse. Con la
## amenaza encima de la última miga, se sigue retrocediendo.
func test_rally_skips_a_room_the_threat_already_covers() -> void:
	var director := SquadTestUtil.director(1, 10)
	var world := SquadTestUtil.world_two_accesses()
	director.push_room_anchor(Vector3(0.0, 0.0, -30.0))
	director.push_room_anchor(Vector3(0.0, 0.0, 16.0))  # a 4 m del objetivo
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(30, Vector3(0.0, 0.0, -1.0)),
	]
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)
	assert_almost_eq(assignment.rally_point.z, -30.0, 0.001,
		"la miga a 4 m del enemigo no vale como punto de reagrupamiento")


## Sin migas y con el navmesh sin hornear (o sin punto navegable donde se
## pedía), el punto de reagrupamiento sigue siendo un punto REAL. Devolver
## `Vector3.INF` aquí mandaría al grupo a ninguna parte, en silencio.
func test_rally_survives_a_navmesh_that_refuses_to_project() -> void:
	var director := SquadTestUtil.director(1, 10)
	var world := SquadTestUtil.world_two_accesses()
	world.snap_always_fails = true
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(30, Vector3(0.0, 0.0, -1.0)),
	]
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)
	assert_true(assignment.retreating)
	assert_false(is_inf(assignment.rally_point.x), "el punto de reagrupamiento existe")
	assert_gt(world.stat_snap_calls, 0.0, "se intentó proyectar al navmesh")


## Histéresis: un grupo que oscila alrededor del 40 % no puede alternar
## repliegue y asalto cada tick de decisión.
func test_retreat_latches_until_the_group_regroups() -> void:
	var director := SquadTestUtil.director(1, 10)
	var world := SquadTestUtil.world_two_accesses()
	var contacts := SquadTestUtil.contacts_at(SquadTestUtil.TARGET)
	var three: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(30, Vector3(0.0, 0.0, -1.0)),
	]
	var five: Array[BotState] = three.duplicate()
	five.append(SquadTestUtil.flanker_candidate(40, Vector3(0.0, 0.0, 1.0)))
	five.append(SquadTestUtil.flanker_candidate(50, Vector3(2.0, 0.0, 0.0)))

	assert_true(director.assign_roles(three, contacts, false, world).retreating)
	assert_true(director.assign_roles(five, contacts, false, world).retreating,
		"al 50 % sigue replegándose: aún no ha llegado al punto de reunión")
	director.mark_regrouped()
	assert_false(director.assign_roles(five, contacts, false, world).retreating,
		"una vez reagrupado, vuelve a combatir")
