extends TestCase
## Reparto de roles sin duplicados (GDD §8.4).


func before_each() -> void:
	Blackboard.clear()


func after_each() -> void:
	Blackboard.clear()


func test_every_bot_gets_exactly_one_role() -> void:
	var director := SquadTestUtil.director(1, 5)
	var world := SquadTestUtil.world_three_accesses()
	var assignment := director.assign_roles(
		SquadTestUtil.squad_of_five(), SquadTestUtil.contacts_at(SquadTestUtil.TARGET), true, world
	)
	assert_size(assignment.roles, 5, "cinco bots, cinco roles")
	for bot_id: int in assignment.bot_ids():
		assert_ne(assignment.role_of(bot_id), Blackboard.Role.NONE,
			"el bot %d se ha quedado sin rol" % bot_id)


## Un Fijador y sólo uno. Dos fijadores es munición desperdiciada en el mismo
## vano; ninguno es un flanqueo que llega a un objetivo que ya se ha movido.
func test_there_is_exactly_one_pinner() -> void:
	var director := SquadTestUtil.director(1, 5)
	var world := SquadTestUtil.world_three_accesses()
	var assignment := director.assign_roles(
		SquadTestUtil.squad_of_five(), SquadTestUtil.contacts_at(SquadTestUtil.TARGET), true, world
	)
	assert_eq(assignment.count_of(Blackboard.Role.PINNER), 1)


func test_role_counts_respect_their_caps() -> void:
	var director := SquadTestUtil.director(1, 5)
	var world := SquadTestUtil.world_three_accesses()
	var assignment := director.assign_roles(
		SquadTestUtil.squad_of_five(), SquadTestUtil.contacts_at(SquadTestUtil.TARGET), true, world
	)
	assert_true(assignment.count_of(Blackboard.Role.FLANKER) <= SquadTuning.MAX_FLANKERS,
		"como mucho %d flanqueadores" % SquadTuning.MAX_FLANKERS)
	assert_true(assignment.count_of(Blackboard.Role.ASSAULTER) <= SquadTuning.MAX_ASSAULTERS,
		"como mucho %d asaltantes" % SquadTuning.MAX_ASSAULTERS)
	assert_size(assignment.rule_violations(), 0)


## El Fijador es el que ve al objetivo desde cobertura. No es un detalle
## estético: es el único que puede sostener el fuego que autoriza el asalto.
func test_the_pinner_is_the_one_who_sees_the_target_from_cover() -> void:
	var director := SquadTestUtil.director(1, 4)
	var world := SquadTestUtil.world_two_accesses()
	var assignment := director.assign_roles(
		SquadTestUtil.squad_of_four(), SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)
	assert_eq(assignment.role_of(10), Blackboard.Role.PINNER)


## Sin contacto fiable no hay a quién fijar, rodear ni asaltar. El grupo
## busca; no ataca a un punto en el que ya no cree.
func test_without_a_reliable_contact_the_group_searches() -> void:
	var director := SquadTestUtil.director(1, 4)
	var world := SquadTestUtil.world_two_accesses()
	var faint := SquadTestUtil.contacts_at(SquadTestUtil.TARGET, 0.05)
	var assignment := director.assign_roles(SquadTestUtil.squad_of_four(), faint, true, world)

	assert_false(assignment.has_target, "una confianza de 0,05 no es un objetivo")
	assert_eq(assignment.count_of(Blackboard.Role.RESERVE), 4)
	assert_eq(assignment.flank_veto_reason, &"sin_contacto")
	for bot_id: int in assignment.bot_ids():
		assert_true(assignment.allows(bot_id, BehaviorKind.Kind.INVESTIGATE))
		assert_false(assignment.allows(bot_id, BehaviorKind.Kind.ASSAULT))


func test_the_most_confident_contact_wins() -> void:
	var director := SquadTestUtil.director(1, 4)
	var world := SquadTestUtil.world_two_accesses()
	var contacts: Array[Blackboard.Contact] = [
		SquadTestUtil.contact(1, Vector3(30.0, 0.0, 0.0), 0.4),
		SquadTestUtil.contact(2, SquadTestUtil.TARGET, 0.95),
	]
	var assignment := director.assign_roles(SquadTestUtil.squad_of_four(), contacts, false, world)
	assert_eq(assignment.target_id, 2)
	assert_true(assignment.target_position.is_equal_approx(SquadTestUtil.TARGET))


## Un grupo sin bajas no cuenta como diezmado aunque el censo se haya
## rellenado solo: `roster_size` sólo crece.
func test_roster_size_latches_upwards() -> void:
	var director := SquadTestUtil.director(1, 0)
	var world := SquadTestUtil.world_two_accesses()
	var contacts := SquadTestUtil.contacts_at(SquadTestUtil.TARGET)
	var five := SquadTestUtil.squad_of_five()
	var first := director.assign_roles(five, contacts, false, world)
	assert_almost_eq(first.strength_ratio, 1.0, 0.0001, "el primer censo son los que hay")
	assert_eq(director.roster_size, 5)

	var one: Array[BotState] = [five[0]]
	var second := director.assign_roles(one, contacts, false, world)
	assert_almost_eq(second.strength_ratio, 0.2, 0.0001,
		"cuatro bajas no reducen el denominador")
	assert_true(second.retreating)


## `publish()` es el único punto que toca la pizarra, y la pizarra es la
## única vía por la que un bot conoce su rol.
func test_publish_writes_roles_and_routes_to_the_blackboard() -> void:
	var director := SquadTestUtil.director(4, 4)
	var world := SquadTestUtil.world_two_accesses()
	var assignment := director.assign_roles(
		SquadTestUtil.squad_of_four(), SquadTestUtil.contacts_at(SquadTestUtil.TARGET), true, world
	)
	for bot_id: int in assignment.bot_ids():
		assert_eq(Blackboard.role_of(bot_id), Blackboard.Role.NONE,
			"assign_roles() no puede tener efectos secundarios")
	director.publish(assignment)
	for bot_id: int in assignment.bot_ids():
		assert_eq(Blackboard.role_of(bot_id), assignment.role_of(bot_id))


## Un grupo vacío no revienta ni inventa roles. Es el estado en el que queda
## una escuadra aniquilada, y ocurre de verdad.
func test_an_empty_squad_produces_an_empty_assignment() -> void:
	var director := SquadTestUtil.director(1, 4)
	var empty: Array[BotState] = []
	var assignment := director.assign_roles(
		empty, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), true, SquadTestUtil.world_two_accesses()
	)
	assert_size(assignment.roles, 0)
	assert_almost_eq(assignment.strength_ratio, 0.0, 0.0001)
	assert_size(assignment.rule_violations(), 0)
