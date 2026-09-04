extends TestCase
## Un solo cerebro para amigos y enemigos (GDD §8.5), y las reglas de grupo
## como PROHIBICIÓN y no como preferencia (GDD §8.4).
##
## AVISO DE COORDINACIÓN: cuando se escribieron estas pruebas,
## `game/src/ai/behavior/` estaba vacío —`ai-comportamiento` lo está
## construyendo—. `SquadBrainPort` declara la forma en la que `ai/squad`
## espera hablar con ese selector, y `SquadFakeBrain` la imita. Cuando la
## interfaz real exista, el puerto se adapta a ELLA y estas pruebas cambian
## con él; nada más de `ai/squad` toca al cerebro.


func _allowed_of_a_reserve() -> PackedInt32Array:
	return PackedInt32Array([
		BehaviorKind.Kind.TAKE_COVER,
		BehaviorKind.Kind.ATTACK,
		BehaviorKind.Kind.RELOAD,
	])


## Sin cerebro enlazado el bot se cubre y espera. NO ataca, NO flanquea y NO
## asalta. Es la misma regla que ya costó un fallo en este proyecto: el valor
## por defecto de una consulta de la que depende una decisión de justicia
## nunca puede ser el permisivo.
func test_an_unbound_port_never_attacks_flanks_or_assaults() -> void:
	var port := SquadBrainPort.new()
	assert_false(port.is_bound())
	var everything := PackedInt32Array([
		BehaviorKind.Kind.ASSAULT,
		BehaviorKind.Kind.FLANK,
		BehaviorKind.Kind.ATTACK,
		BehaviorKind.Kind.SUPPRESS,
		BehaviorKind.Kind.TAKE_COVER,
	])
	var chosen := port.select(BotState.new(), SquadWeightTable.for_enemy(), everything)
	assert_eq(chosen, int(BehaviorKind.Kind.TAKE_COVER),
		"el modo degradado se cubre; no elige nada comprometido")


func test_an_empty_allowed_list_yields_no_decision() -> void:
	var port := SquadBrainPort.new()
	assert_eq(port.select(BotState.new(), SquadWeightTable.for_enemy(), PackedInt32Array()), -1)


## El puerto COMPRUEBA lo que le devuelve el cerebro. El cerebro lo escribe
## otro módulo, y una regla de grupo que depende de que el otro módulo se
## porte bien no es una invariante: es una esperanza.
func test_the_port_rejects_a_choice_outside_the_allowed_set() -> void:
	var port := SquadBrainPort.new()
	port.report_violations = false  # la infracción es a propósito
	var brain := SquadFakeBrain.new()
	brain.answer = int(BehaviorKind.Kind.ASSAULT)
	assert_true(port.bind(brain))

	var chosen := port.select(
		BotState.new(), SquadWeightTable.for_enemy(), _allowed_of_a_reserve()
	)
	assert_eq(chosen, int(BehaviorKind.Kind.TAKE_COVER), "se cae al modo seguro")
	assert_eq(port.stat_rejected_choices, 1, "y queda contado, no en silencio")


func test_a_legal_choice_is_respected() -> void:
	var port := SquadBrainPort.new()
	var brain := SquadFakeBrain.new()
	brain.answer = int(BehaviorKind.Kind.ATTACK)
	port.bind(brain)
	assert_eq(
		port.select(BotState.new(), SquadWeightTable.for_enemy(), _allowed_of_a_reserve()),
		int(BehaviorKind.Kind.ATTACK)
	)
	assert_eq(port.stat_rejected_choices, 0)


func test_bind_refuses_something_that_is_not_a_brain() -> void:
	var port := SquadBrainPort.new()
	port.report_violations = false
	assert_false(port.bind(SquadWeightTable.new()), "no expone 'select'")
	assert_false(port.is_bound())


## LO QUE HACE QUE AMIGOS Y ENEMIGOS COMPARTAN CEREBRO: al mismo `select` le
## llegan dos tablas distintas. No hay dos IA; hay una IA y dos tablas.
func test_the_same_brain_receives_a_different_table_for_each_side() -> void:
	var port := SquadBrainPort.new()
	var brain := SquadFakeBrain.new()
	brain.answer = int(BehaviorKind.Kind.TAKE_COVER)
	port.bind(brain)

	port.select(BotState.new(), SquadWeightTable.for_enemy(), _allowed_of_a_reserve())
	assert_eq(brain.last_weights.label, &"enemy")
	port.select(BotState.new(), SquadWeightTable.for_companion(), _allowed_of_a_reserve())
	assert_eq(brain.last_weights.label, &"companion")
	assert_eq(brain.stat_calls, 2, "el mismo cerebro las dos veces")


func test_the_two_tables_prioritize_opposite_things() -> void:
	var enemy := SquadWeightTable.for_enemy()
	var companion := SquadWeightTable.for_companion()
	assert_gt(enemy.weight_for(BehaviorKind.Kind.FLANK),
		companion.weight_for(BehaviorKind.Kind.FLANK),
		"rodear es de enemigo: un compañero que flanquea deja solo al jugador")
	assert_gt(enemy.weight_for(BehaviorKind.Kind.ASSAULT),
		companion.weight_for(BehaviorKind.Kind.ASSAULT))
	assert_gt(companion.weight_for(BehaviorKind.Kind.FOLLOW_LEADER),
		enemy.weight_for(BehaviorKind.Kind.FOLLOW_LEADER),
		"la formación es de compañero")
	assert_gt(companion.weight_for(BehaviorKind.Kind.TAKE_COVER),
		companion.weight_for(BehaviorKind.Kind.ATTACK),
		"cobertura del jugador y fuego de apoyo por delante del tiroteo suelto")


func test_a_table_can_be_copied_without_sharing_state() -> void:
	var original := SquadWeightTable.for_companion()
	var copy := original.duplicate_table()
	copy.set_weight(BehaviorKind.Kind.ATTACK, 9.0)
	assert_almost_eq(copy.weight_for(BehaviorKind.Kind.ATTACK), 9.0, 0.0001)
	assert_lt(original.weight_for(BehaviorKind.Kind.ATTACK), 9.0)


## Camino completo por los dos lados: lo que sale del `SquadDirector` para un
## enemigo y lo que sale del `CompanionController` para un compañero entran
## por el MISMO puerto, y en los dos casos el cerebro sólo puede elegir
## dentro de lo permitido.
func test_both_sides_feed_the_same_port() -> void:
	Blackboard.clear()
	var port := SquadBrainPort.new()
	port.report_violations = false
	var brain := SquadFakeBrain.new()
	brain.answer = int(BehaviorKind.Kind.ASSAULT)
	port.bind(brain)

	var director := SquadTestUtil.director(1, 4)
	var assignment := director.assign_roles(
		SquadTestUtil.squad_of_four(), SquadTestUtil.contacts_at(SquadTestUtil.TARGET),
		false, SquadTestUtil.world_two_accesses()
	)
	for bot_id: int in assignment.bot_ids():
		var chosen := port.select(
			BotState.new(), SquadWeightTable.for_enemy(), assignment.allowed_of(bot_id)
		)
		assert_ne(chosen, int(BehaviorKind.Kind.ASSAULT),
			"sin supresión, ni el cerebro puede colar un asalto")

	var companion := CompanionController.new(1, &"technician", 0, 0)
	var directive := companion.decide(
		SquadTestUtil.companion_state(1, 0.4, 0.9, true),
		SquadOrder.move_to(Vector3(0.0, 0.0, 18.0)), Vector3.ZERO, Vector3.FORWARD
	)
	var companion_choice := port.select(BotState.new(), directive.weights, directive.allowed)
	assert_ne(companion_choice, int(BehaviorKind.Kind.ASSAULT))
	assert_true(directive.allows(companion_choice as BehaviorKind.Kind))
	Blackboard.clear()
