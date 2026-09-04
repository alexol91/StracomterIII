extends TestCase
## Flanqueo: rutas de navmesh realmente disjuntas, una por flanqueador
## (GDD §8.4).
##
## "Ángulo del objetivo + 90°" no es flanquear: es caminar hacia una pared.
## Estas pruebas comprueban que el director sólo manda a alguien a rodear
## cuando existe una segunda ruta que existe, llega y no comparte tramo con
## la frontal — y que, cuando no la hay, NO se inventa ninguna.


func before_each() -> void:
	Blackboard.clear()


func after_each() -> void:
	Blackboard.clear()


## LA PRUEBA DEL ENUNCIADO: dos bots ante un objetivo con dos accesos
## producen exactamente UN flanqueo. Ni cero (nadie rodea) ni dos (nadie fija).
func test_two_bots_two_accesses_produce_exactly_one_flank() -> void:
	var director := SquadTestUtil.director(1, 2)
	var world := SquadTestUtil.world_two_accesses()
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
	]
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)

	assert_eq(assignment.count_of(Blackboard.Role.FLANKER), 1, "exactamente un flanqueo")
	assert_eq(assignment.count_of(Blackboard.Role.PINNER), 1, "y alguien que fije")
	assert_eq(assignment.claimed_route_count(), 1, "una sola ruta reclamada")
	assert_size(assignment.rule_violations(), 0, "sin infracciones de las reglas de grupo")


func test_the_flanker_is_the_bot_free_of_contact() -> void:
	var director := SquadTestUtil.director(1, 2)
	var world := SquadTestUtil.world_two_accesses()
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
	]
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)
	# El que ya intercambia fuego se queda fijando; se va a rodear el que
	# puede moverse. Si fuese al revés, la presión frontal desaparecería y el
	# flanqueo llegaría a un objetivo que ya se ha ido.
	assert_eq(assignment.role_of(10), Blackboard.Role.PINNER)
	assert_eq(assignment.role_of(20), Blackboard.Role.FLANKER)
	assert_eq(assignment.route_of(20), 1, "el flanqueador va por la ruta 1, no por la frontal")


## Tres rutas de las que dos van casi por el mismo pasillo: solo puede salir
## un flanqueador. Es el caso que produce dos bots en fila india.
func test_never_two_flankers_on_the_same_route() -> void:
	var director := SquadTestUtil.director(1, 4)
	var world := SquadTestUtil.world_duplicate_flank()
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(30, Vector3(2.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(40, Vector3(-2.0, 0.0, 0.0)),
	]
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)

	assert_eq(assignment.count_of(Blackboard.Role.FLANKER), 1,
		"las dos variantes del mismo pasillo cuentan como una sola ruta")
	assert_eq(assignment.claimed_route_count(), assignment.count_of(Blackboard.Role.FLANKER),
		"tantas rutas distintas como flanqueadores")
	assert_eq(assignment.flank_veto_reason, &"", "hubo un flanqueo válido")
	assert_size(assignment.rule_violations(), 0)


func test_two_disjoint_flanks_allow_two_flankers() -> void:
	var director := SquadTestUtil.director(1, 4)
	var world := SquadTestUtil.world_three_accesses()
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(30, Vector3(2.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(40, Vector3(-2.0, 0.0, 0.0)),
	]
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)
	assert_eq(assignment.count_of(Blackboard.Role.FLANKER), 2, "dos rodeos disjuntos, dos flanqueadores")
	assert_eq(assignment.claimed_route_count(), 2, "y cada uno por su ruta")
	assert_size(assignment.rule_violations(), 0)


## Sin `WorldQuery` no hay geometría, y sin geometría no hay flanqueo. El
## defecto restrictivo es la regla, no una excepción: este proyecto ya pagó
## una vez el precio de un defecto permisivo.
func test_no_world_query_means_no_flank() -> void:
	var director := SquadTestUtil.director(1, 4)
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
	]
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, null
	)
	assert_eq(assignment.count_of(Blackboard.Role.FLANKER), 0)
	assert_eq(assignment.flank_veto_reason, &"sin_consulta_de_mundo")
	assert_false(assignment.allows(20, BehaviorKind.Kind.FLANK),
		"nadie puede flanquear sin ruta")


func test_single_corridor_means_no_flank() -> void:
	var director := SquadTestUtil.director(1, 4)
	var world := SquadTestUtil.world_single_access()
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
	]
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)
	assert_eq(assignment.count_of(Blackboard.Role.FLANKER), 0)
	assert_eq(assignment.flank_veto_reason, &"sin_rutas_alternativas")


## Una ruta parcial manda al flanqueador contra una pared. El motor las
## devuelve de verdad; el doble las reproduce y el director las rechaza.
func test_partial_route_is_not_a_flank() -> void:
	var director := SquadTestUtil.director(1, 4)
	var world := SquadTestUtil.world_partial_flank()
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
	]
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)
	assert_eq(assignment.count_of(Blackboard.Role.FLANKER), 0)
	assert_eq(assignment.flank_veto_reason, &"ruta_parcial")


## La pizarra es la que hace cumplir la exclusividad de la ruta, no la buena
## voluntad del director: dos reclamaciones de la misma ruta no pueden
## prosperar aunque el cálculo se equivoque.
func test_blackboard_refuses_a_second_claim_on_the_same_route() -> void:
	var director := SquadTestUtil.director(7, 2)
	var world := SquadTestUtil.world_two_accesses()
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
	]
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)
	director.publish(assignment)
	assert_eq(Blackboard.role_of(20), Blackboard.Role.FLANKER, "el rol llega a la pizarra")
	assert_false(Blackboard.claim_route(7, assignment.route_of(20)),
		"la ruta ya está reclamada en esta escuadra")
	assert_true(Blackboard.claim_route(7, 99), "una ruta libre sí se puede reclamar")


## Publicar dos veces seguidas no puede dejar al grupo sin flanqueo: la
## pizarra no sabe soltar una ruta suelta, sólo todas las de la escuadra, y
## `publish` tiene que ocuparse de eso.
func test_publishing_twice_keeps_the_flank() -> void:
	var director := SquadTestUtil.director(3, 2)
	var world := SquadTestUtil.world_two_accesses()
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
	]
	var contacts := SquadTestUtil.contacts_at(SquadTestUtil.TARGET)
	var first := director.assign_roles(states, contacts, false, world)
	director.publish(first)
	var second := director.assign_roles(states, contacts, false, world)
	director.publish(second)
	assert_eq(second.count_of(Blackboard.Role.FLANKER), 1)
	assert_eq(Blackboard.role_of(20), Blackboard.Role.FLANKER)
	assert_size(second.rule_violations(), 0)


## El director no pide al navmesh más rutas de las que su grupo puede
## aprovechar: cada ruta extra es una búsqueda A* completa sobre el grafo de
## polígonos, y el presupuesto de IA es finito (ADR-002).
func test_does_not_request_more_routes_than_the_group_can_use() -> void:
	var director := SquadTestUtil.director(1, 2)
	var world := SquadTestUtil.world_three_accesses()
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
	]
	director.assign_roles(states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world)
	assert_eq(world.stat_last_max_routes, 2,
		"con dos bots sólo cabe un flanqueo, así que sobran dos rutas: se piden 2")
