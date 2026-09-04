extends TestCase
## Nadie asalta sin supresión activa de un compañero (GDD §8.4).
##
## Es la regla que separa un asalto de un suicidio. Y es una PROHIBICIÓN, no
## una preferencia: si se implementara bajando la utilidad de ASSAULT,
## bastaría con que todas las demás utilidades bajaran —sin munición, sin
## cobertura cerca, sin ruta— para que ASSAULT volviera a ganar y el bot
## cruzara el vano solo. Por eso el permiso ni siquiera aparece en la lista.


func before_each() -> void:
	Blackboard.clear()


func after_each() -> void:
	Blackboard.clear()


## LA PRUEBA DEL ENUNCIADO: sin supresión no asalta nadie.
func test_nobody_assaults_without_suppression() -> void:
	var director := SquadTestUtil.director(1, 4)
	var world := SquadTestUtil.world_two_accesses()
	var assignment := director.assign_roles(
		SquadTestUtil.squad_of_four(), SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)
	assert_eq(assignment.count_of(Blackboard.Role.ASSAULTER), 0)
	assert_eq(assignment.assault_veto_reason, &"sin_supresion")
	for bot_id: int in assignment.bot_ids():
		assert_false(assignment.allows(bot_id, BehaviorKind.Kind.ASSAULT),
			"el bot %d no tiene ASSAULT ni como opción" % bot_id)


func test_with_suppression_and_a_capable_pinner_the_assault_happens() -> void:
	var director := SquadTestUtil.director(1, 4)
	var world := SquadTestUtil.world_two_accesses()
	var assignment := director.assign_roles(
		SquadTestUtil.squad_of_four(), SquadTestUtil.contacts_at(SquadTestUtil.TARGET), true, world
	)
	assert_gt(float(assignment.count_of(Blackboard.Role.ASSAULTER)), 0.0)
	assert_eq(assignment.assault_veto_reason, &"")
	for bot_id: int in assignment.bots_with_role(Blackboard.Role.ASSAULTER):
		assert_true(assignment.allows(bot_id, BehaviorKind.Kind.ASSAULT))
	assert_size(assignment.rule_violations(), 0)


## "Supresión activa DE UN COMPAÑERO". La marca de la pizarra no dice de
## quién es —`Blackboard.mark_suppression()` no guarda el id del emisor—, así
## que la condición del compañero se comprueba por el rol: tiene que haber un
## Fijador que de verdad pueda sostener el fuego. Un Fijador que no ve al
## objetivo no está suprimiendo nada.
func test_a_pinner_without_line_of_sight_does_not_authorize_an_assault() -> void:
	var director := SquadTestUtil.director(1, 4)
	var world := SquadTestUtil.world_two_accesses()
	var states: Array[BotState] = []
	for state: BotState in SquadTestUtil.squad_of_four():
		state.has_line_of_sight = false
		state.in_cover = false
		states.append(state)
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), true, world
	)
	assert_eq(assignment.count_of(Blackboard.Role.ASSAULTER), 0)
	assert_eq(assignment.assault_veto_reason, &"fijador_sin_vision")


func test_a_pinner_without_ammo_does_not_authorize_an_assault() -> void:
	var director := SquadTestUtil.director(1, 4)
	var world := SquadTestUtil.world_two_accesses()
	var states: Array[BotState] = []
	for state: BotState in SquadTestUtil.squad_of_four():
		state.ammo_ratio = 0.0
		states.append(state)
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), true, world
	)
	assert_eq(assignment.count_of(Blackboard.Role.ASSAULTER), 0)
	assert_eq(assignment.assault_veto_reason, &"fijador_sin_municion")


## Un bot solo no asalta: no hay compañero que pueda suprimir por él, por
## mucho que la pizarra tenga la marca puesta.
func test_a_lone_bot_never_assaults() -> void:
	var director := SquadTestUtil.director(1, 1)
	var world := SquadTestUtil.world_two_accesses()
	var states: Array[BotState] = [SquadTestUtil.pinner_candidate(10, Vector3.ZERO)]
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), true, world
	)
	assert_eq(assignment.count_of(Blackboard.Role.ASSAULTER), 0)
	assert_eq(assignment.assault_veto_reason, &"sin_efectivos_libres")
	assert_eq(assignment.role_of(10), Blackboard.Role.PINNER)


## Camino completo del dato: la habilidad *Supresión* del Especialista marca
## la pizarra (`Blackboard.mark_suppression`), el director la lee y el asalto
## se autoriza. Cuando la marca caduca, deja de autorizarse.
func test_the_blackboard_mark_is_what_authorizes_the_assault() -> void:
	var director := SquadTestUtil.director(5, 4)
	var world := SquadTestUtil.world_two_accesses()
	var contacts := SquadTestUtil.contacts_at(SquadTestUtil.TARGET)

	assert_false(Blackboard.has_active_suppression(5), "aún nadie suprime")
	var before := director.assign_roles(
		SquadTestUtil.squad_of_four(), contacts, Blackboard.has_active_suppression(5), world
	)
	assert_eq(before.count_of(Blackboard.Role.ASSAULTER), 0)

	Blackboard.mark_suppression(5, 3.0)
	assert_true(Blackboard.has_active_suppression(5))
	var during := director.assign_roles(
		SquadTestUtil.squad_of_four(), contacts, Blackboard.has_active_suppression(5), world
	)
	assert_gt(float(during.count_of(Blackboard.Role.ASSAULTER)), 0.0)

	Blackboard.mark_suppression(5, -1.0)
	assert_false(Blackboard.has_active_suppression(5), "la marca ha caducado")
	var after := director.assign_roles(
		SquadTestUtil.squad_of_four(), contacts, Blackboard.has_active_suppression(5), world
	)
	assert_eq(after.count_of(Blackboard.Role.ASSAULTER), 0)


## La supresión de OTRA escuadra no autoriza nada aquí. Las marcas son por
## grupo y no se contagian.
func test_suppression_does_not_leak_between_squads() -> void:
	Blackboard.mark_suppression(99, 5.0)
	assert_true(Blackboard.has_active_suppression(99))
	assert_false(Blackboard.has_active_suppression(1))
	var director := SquadTestUtil.director(1, 4)
	var world := SquadTestUtil.world_two_accesses()
	var assignment := director.assign_roles(
		SquadTestUtil.squad_of_four(), SquadTestUtil.contacts_at(SquadTestUtil.TARGET),
		Blackboard.has_active_suppression(1), world
	)
	assert_eq(assignment.count_of(Blackboard.Role.ASSAULTER), 0)
