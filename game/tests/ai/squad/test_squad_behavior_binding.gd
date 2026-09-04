extends TestCase
## Un solo cerebro para amigos y enemigos, y las reglas de grupo como VETO
## DURO (GDD §8.4 y §8.5).
##
## Estas pruebas no usan ningún doble del cerebro: llaman al `UtilityScorer`
## REAL de `ai/behavior` con el filtro que produce `ai/squad`. Es la única
## forma de comprobar lo que de verdad importa —que la regla se cumple
## AUNQUE la utilidad diga otra cosa—, porque un doble que devuelve lo que
## queramos no demuestra nada sobre el selector que va a correr en el juego.


func before_each() -> void:
	Blackboard.clear()


func after_each() -> void:
	Blackboard.clear()


func _reserve_allowed() -> PackedInt32Array:
	return PackedInt32Array([
		BehaviorKind.Kind.TAKE_COVER,
		BehaviorKind.Kind.ATTACK,
		BehaviorKind.Kind.RELOAD,
	])


func test_the_filter_is_a_whitelist_of_what_the_squad_allows() -> void:
	var filter := SquadBehaviorBinding.filter_from(_reserve_allowed())
	assert_true(filter.is_allowed(BehaviorKind.Kind.TAKE_COVER))
	assert_true(filter.is_allowed(BehaviorKind.Kind.ATTACK))
	assert_false(filter.is_allowed(BehaviorKind.Kind.ASSAULT))
	assert_false(filter.is_allowed(BehaviorKind.Kind.FLANK))
	assert_false(filter.is_allowed(BehaviorKind.Kind.FOLLOW_LEADER))


## Una lista de permitidos VACÍA no permite nada. Es deliberado y es la misma
## regla de siempre: el valor por defecto de una consulta de la que depende
## una decisión de justicia nunca puede ser el permisivo. Un director que se
## equivoque produce un bot quieto —visible y depurable—, no un bot que
## asalta sin supresión.
func test_an_empty_allowed_list_allows_nothing() -> void:
	var filter := SquadBehaviorBinding.filter_from(PackedInt32Array())
	assert_false(filter.is_allowed(BehaviorKind.Kind.ATTACK))
	assert_false(filter.is_allowed(BehaviorKind.Kind.TAKE_COVER))


## "El bot no flanquea" tiene que tener respuesta. Sin motivo, ese síntoma
## puede venir de cuatro causas distintas y se depura a base de suposiciones.
func test_the_veto_carries_its_reason() -> void:
	var director := SquadTestUtil.director(1, 4)
	var assignment := director.assign_roles(
		SquadTestUtil.squad_of_four(), SquadTestUtil.contacts_at(SquadTestUtil.TARGET),
		false, null
	)
	var filter := SquadBehaviorBinding.filter_for_bot(assignment, 10)
	assert_eq(filter.reason_for(BehaviorKind.Kind.ASSAULT), "sin_supresion")
	assert_eq(filter.reason_for(BehaviorKind.Kind.FLANK), "sin_consulta_de_mundo")
	assert_eq(filter.reason_for(BehaviorKind.Kind.SUPPRESS), "",
		"lo permitido no lleva motivo de veto")


## LA PRUEBA QUE IMPORTA: el selector real, con un bot cuyo estado hace de
## ASSAULT la opción más apetecible, y sin supresión. Sin filtro elegiría
## asaltar; con el filtro de la escuadra, no puede.
func test_the_real_scorer_cannot_assault_without_suppression() -> void:
	var director := SquadTestUtil.director(1, 4)
	var assignment := director.assign_roles(
		SquadTestUtil.squad_of_four(), SquadTestUtil.contacts_at(SquadTestUtil.TARGET),
		false, SquadTestUtil.world_two_accesses()
	)
	var state := SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0))
	state.role = assignment.role_of(10)
	state.squad_has_suppression = true  # mentira en la instantánea, a propósito
	var weights := UtilityWeights.for_archetype(&"enemy_militiaman")

	var filter := SquadBehaviorBinding.filter_for_bot(assignment, 10)
	var chosen := UtilityScorer.select(state, weights, null, filter)
	assert_ne(chosen, BehaviorKind.Kind.ASSAULT,
		"ni con la instantánea mintiendo sobre la supresión")
	assert_ne(chosen, BehaviorKind.Kind.FLANK, "ni flanquear sin ruta reclamada")
	assert_true(filter.is_allowed(chosen), "lo elegido está dentro de lo permitido")


## Con supresión y un fijador capaz, el asalto SÍ está disponible: el veto no
## puede ser un "nunca" disfrazado.
func test_with_suppression_the_assault_is_available_again() -> void:
	var director := SquadTestUtil.director(1, 4)
	var assignment := director.assign_roles(
		SquadTestUtil.squad_of_four(), SquadTestUtil.contacts_at(SquadTestUtil.TARGET),
		true, SquadTestUtil.world_two_accesses()
	)
	var assaulters := assignment.bots_with_role(Blackboard.Role.ASSAULTER)
	assert_gt(float(assaulters.size()), 0.0)
	var filter := SquadBehaviorBinding.filter_for_bot(assignment, assaulters[0])
	assert_true(filter.is_allowed(BehaviorKind.Kind.ASSAULT))


## Un compañero que ha dejado de obedecer no puede elegir el verbo con el que
## se cumple "Ir ahí", y el motivo del veto nombra la moral.
func test_a_disobeying_companion_cannot_execute_the_order() -> void:
	var companion := CompanionController.new(1, &"technician", 0, 0)
	var directive := companion.decide(
		SquadTestUtil.companion_state(1, 0.4, 0.9, true),
		SquadOrder.move_to(Vector3(0.0, 0.0, 18.0)), Vector3.ZERO, Vector3.FORWARD
	)
	assert_false(directive.obeys)
	var filter := SquadBehaviorBinding.filter_for_directive(directive)
	assert_false(filter.is_allowed(BehaviorKind.Kind.INVESTIGATE))
	assert_true(filter.reason_for(BehaviorKind.Kind.INVESTIGATE).contains("moral"))
	assert_true(filter.is_allowed(BehaviorKind.Kind.TAKE_COVER))


## LA TABLA ES LO ÚNICO QUE CAMBIA ENTRE BANDOS. Misma clase
## (`UtilityWeights`), mismo selector, otros números.
func test_companion_and_enemy_tables_are_the_same_class_with_other_numbers() -> void:
	var enemy := UtilityWeights.for_archetype(&"enemy_militiaman")
	var companion := CompanionWeights.standard(&"technician")
	assert_true(companion.enabled(BehaviorKind.Kind.FOLLOW_LEADER),
		"un compañero mantiene la formación")
	assert_false(enemy.enabled(BehaviorKind.Kind.FOLLOW_LEADER),
		"un enemigo no sigue a nadie, y no por un `if` de bando: por ganancia 0")
	assert_gt(enemy.gain(BehaviorKind.Kind.FLANK), companion.gain(BehaviorKind.Kind.FLANK),
		"rodear es de enemigo: un compañero que flanquea deja solo al jugador")


## La moral no sólo tira la orden: cambia lo que el compañero PREFIERE. Si la
## tabla no cambiara, el cerebro seguiría prefiriendo disparar a cubrirse y
## "priorizar sobrevivir" sería una etiqueta sin efecto.
func test_the_survival_table_really_shifts_the_priorities() -> void:
	var normal := CompanionWeights.standard(&"technician")
	var survival := CompanionWeights.survival(&"technician")
	assert_gt(survival.gain(BehaviorKind.Kind.TAKE_COVER),
		normal.gain(BehaviorKind.Kind.TAKE_COVER))
	assert_lt(survival.gain(BehaviorKind.Kind.ATTACK),
		normal.gain(BehaviorKind.Kind.ATTACK))
	assert_gt(survival.gain(BehaviorKind.Kind.TAKE_COVER),
		survival.gain(BehaviorKind.Kind.ATTACK),
		"cubrirse pesa más que disparar")
	assert_false(survival.enabled(BehaviorKind.Kind.FOLLOW_LEADER),
		"y no sale a campo abierto detrás de nadie")


## El enganche completo: lo que decide la escuadra acaba dentro del
## `BehaviorController` que corre el cerebro, sin que `ai/squad` tenga que
## saber cómo puntúa nada.
func test_the_binding_reaches_the_behavior_controller() -> void:
	var state := SquadTestUtil.companion_state(1, 0.4, 0.9, true)
	var controller := BehaviorController.new(state, null, null, null)
	var companion := CompanionController.new(1, &"technician", 0, 0)
	var directive := companion.decide(
		state, SquadOrder.move_to(Vector3(0.0, 0.0, 18.0)), Vector3.ZERO, Vector3.FORWARD
	)
	SquadBehaviorBinding.apply_directive(directive, controller)

	assert_not_null(controller.filter)
	assert_not_null(controller.weights)
	assert_false(controller.filter.is_allowed(BehaviorKind.Kind.INVESTIGATE))
	assert_gt(controller.weights.gain(BehaviorKind.Kind.TAKE_COVER),
		controller.weights.gain(BehaviorKind.Kind.ATTACK))
