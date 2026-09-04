extends TestCase
## Órdenes del jugador y formación de la escuadra (GDD §8.5, `[P05]`).
##
## El original tenía UNA orden —tecla V, `ComeBackCompanions`, "venid aquí"—
## y ni foco de fuego ni posiciones (análisis §5.2). Aquí son tres, y las tres
## cambian lo que el compañero tiene PERMITIDO hacer, no sólo lo que prefiere.


func test_move_to_sends_the_companion_to_the_point() -> void:
	var companion := CompanionController.new(1, &"technician", 0, 2)
	var state := SquadTestUtil.companion_state(1, 1.0, 0.1, false)
	var directive := companion.decide(
		state, SquadOrder.move_to(Vector3(7.0, 0.0, 3.0)), Vector3.ZERO, Vector3.FORWARD
	)
	assert_eq(directive.order_kind, SquadOrder.Kind.MOVE_TO)
	assert_true(directive.move_target.is_equal_approx(Vector3(7.0, 0.0, 3.0)))
	assert_false(directive.allows(BehaviorKind.Kind.FOLLOW_LEADER),
		"mientras va al punto no está en formación")


func test_hold_position_drops_following_the_leader() -> void:
	var companion := CompanionController.new(1, &"technician", 0, 2)
	var state := SquadTestUtil.companion_state(1, 1.0, 0.1, false)
	var directive := companion.decide(
		state, SquadOrder.hold_position(), Vector3(10.0, 0.0, 0.0), Vector3.FORWARD
	)
	assert_eq(directive.order_kind, SquadOrder.Kind.HOLD_POSITION)
	assert_true(directive.allows(BehaviorKind.Kind.HOLD_POSITION))
	assert_false(directive.allows(BehaviorKind.Kind.FOLLOW_LEADER),
		"es la orden que permite dejar a alguien cubriendo una puerta")
	assert_true(directive.allows(BehaviorKind.Kind.SUPPRESS), "y sigue dando fuego de apoyo")


func test_focus_target_keeps_the_formation_and_moves_the_fire() -> void:
	var companion := CompanionController.new(1, &"technician", 0, 2)
	var state := SquadTestUtil.companion_state(1, 1.0, 0.1, false)
	var directive := companion.decide(
		state, SquadOrder.focus_target(77, Vector3(4.0, 0.0, 9.0)), Vector3.ZERO, Vector3.FORWARD
	)
	assert_eq(directive.order_kind, SquadOrder.Kind.FOCUS_TARGET)
	assert_eq(directive.focus_target_id, 77)
	assert_true(directive.has_focus())
	assert_true(directive.allows(BehaviorKind.Kind.FOLLOW_LEADER),
		"enfocar no saca a nadie de la formación")


func test_without_an_order_the_companion_returns_to_formation() -> void:
	var companion := CompanionController.new(1, &"technician", 1, 2)
	var state := SquadTestUtil.companion_state(1, 1.0, 0.1, false)
	var directive := companion.decide(state, SquadOrder.none(), Vector3.ZERO, Vector3.FORWARD)
	assert_eq(directive.order_kind, SquadOrder.Kind.NONE)
	assert_true(directive.allows(BehaviorKind.Kind.FOLLOW_LEADER))
	assert_true(directive.move_target.is_equal_approx(directive.formation_slot))


## El hueco de formación se sigue calculando aunque haya orden: es a donde
## vuelve el compañero cuando la orden termina.
func test_the_formation_slot_is_always_computed() -> void:
	var companion := CompanionController.new(1, &"technician", 2, 2)
	var state := SquadTestUtil.companion_state(1, 1.0, 0.1, false)
	var directive := companion.decide(
		state, SquadOrder.move_to(Vector3(20.0, 0.0, 0.0)), Vector3.ZERO, Vector3.FORWARD
	)
	assert_false(is_inf(directive.formation_slot.x))
	assert_false(directive.formation_slot.is_equal_approx(directive.move_target))


# ---------------------------------------------------------------------------
# La habilidad *Órdenes* del Capitán
# ---------------------------------------------------------------------------

## `gameplay/` emite, `ai/` escucha. La habilidad resuelve a qué hostil apunta
## el Capitán y emite `target_marked`; convertir eso en una orden de foco es
## de esta capa. El sentido de la dependencia no se invierte nunca.
func test_the_captain_mark_becomes_a_focus_order() -> void:
	var squad := CompanionSquad.new(0, &"captain")
	squad.add_companion(1, &"technician", 2)
	var source := SquadFakeOrderSource.new()
	assert_true(squad.bind_captain_orders(source))
	assert_eq(squad.order.kind, SquadOrder.Kind.NONE)

	source.mark(Vector3(2.0, 0.0, 12.0), 314)
	assert_eq(squad.order.kind, SquadOrder.Kind.FOCUS_TARGET)
	assert_eq(squad.order.target_id, 314)
	assert_true(squad.order.position.is_equal_approx(Vector3(2.0, 0.0, 12.0)))


func test_binding_the_same_source_twice_does_not_duplicate_the_connection() -> void:
	var squad := CompanionSquad.new(0, &"captain")
	squad.add_companion(1, &"technician", 2)
	var source := SquadFakeOrderSource.new()
	assert_true(squad.bind_captain_orders(source))
	assert_true(squad.bind_captain_orders(source))
	assert_eq(source.get_signal_connection_list(&"target_marked").size(), 1)


# ---------------------------------------------------------------------------
# Formación
# ---------------------------------------------------------------------------

## Réplica de la DISPOSICIÓN del original (`Player.cc:75-85`): dos alas
## simétricas un paso por detrás y un tercero en el eje, al doble de
## profundidad. Los números no sobreviven al cambio de escala; las
## proporciones sí, y son las que hacen que la formación se reconozca.
func test_the_formation_keeps_the_legacy_proportions() -> void:
	var left := CompanionFormation.slot_offset(0)
	var right := CompanionFormation.slot_offset(1)
	var rear := CompanionFormation.slot_offset(2)

	assert_almost_eq(left.x, -right.x, 0.0001, "las alas son simétricas")
	assert_almost_eq(left.z, right.z, 0.0001, "y van a la misma profundidad")
	assert_almost_eq(absf(left.x) / left.z, 2.0, 0.0001, "lateral : profundidad = 120 : 60")
	assert_almost_eq(rear.z / left.z, 2.0, 0.0001, "el tercero va al doble de profundidad")
	assert_almost_eq(rear.x, 0.0, 0.0001, "y en el eje")


## DESVIACIÓN DOCUMENTADA: los offsets son los del original convertidos a
## metros Y multiplicados por `SquadTuning.FORMATION_SCALE`. A escala 1:1 la
## escuadra iría hombro con hombro dentro de 1,6 m, que con un radio de agente
## de 0,4 m es menos que el sitio que ocupan los cuerpos.
func test_the_documented_scale_deviation_is_exactly_that_and_nada_mas() -> void:
	var expected := 120.0 * Balance.LEGACY_TO_METERS * SquadTuning.FORMATION_SCALE
	assert_almost_eq(absf(CompanionFormation.slot_offset(0).x), expected, 0.0001)
	assert_gt(expected, NavTuning.AGENT_RADIUS_M * 4.0,
		"la formación deja sitio para cuatro cuerpos sin empujarse")
	assert_lt(expected, CompanionSquad.captain_aura_radius_m(),
		"y cabe entera dentro del aura del Capitán")


## El offset es LOCAL al líder: gira con él, como el `OffsetPursuit` del
## original (`MovementComp::getWorldOffset`).
func test_the_slot_rotates_with_the_leader() -> void:
	var facing_north := CompanionFormation.world_slot(Vector3.ZERO, Vector3.FORWARD, 2)
	var facing_east := CompanionFormation.world_slot(Vector3.ZERO, Vector3.RIGHT, 2)
	# Mirando a −Z, el que va detrás está en +Z. Mirando a +X, está en −X.
	assert_gt(facing_north.z, 0.0)
	assert_lt(facing_east.x, 0.0)
	assert_almost_eq(facing_north.length(), facing_east.length(), 0.0001)


## Réplica literal de `GameAction::StartUp` (`GameAction.cc:217-239`): el
## reparto de huecos dependía de la clase del jugador, y el "Explosivo" del
## original es `demolition` aquí.
func test_slot_assignment_replicates_the_legacy_table() -> void:
	assert_eq(CompanionFormation.archetype_for_slot(&"captain", 0), &"demolition")
	assert_eq(CompanionFormation.archetype_for_slot(&"captain", 1), &"technician")
	assert_eq(CompanionFormation.archetype_for_slot(&"captain", 2), &"specialist")
	assert_eq(CompanionFormation.archetype_for_slot(&"demolition", 0), &"captain")
	assert_eq(CompanionFormation.archetype_for_slot(&"technician", 2), &"captain")
	assert_eq(CompanionFormation.slot_for_archetype(&"specialist", &"captain"), 2)
	assert_eq(CompanionFormation.slot_for_archetype(&"captain", &"captain"), -1,
		"el jugador no ocupa hueco en su propia formación")


## Una escuadra montada de verdad reparte huecos distintos: dos compañeros en
## el mismo sitio es la formación que se deshace sola.
func test_a_real_squad_gets_three_distinct_slots() -> void:
	var squad := CompanionSquad.new(0, &"captain")
	squad.add_companion(1, &"demolition", 2)
	squad.add_companion(2, &"technician", 2)
	squad.add_companion(3, &"specialist", 2)
	var slots: Array[int] = []
	for id: int in squad.companion_ids():
		slots.append(squad.companion(id).slot)
	slots.sort()
	assert_eq(slots, [0, 1, 2] as Array[int])


## La moral de un compañero recién dado de alta sale de su ficha, no de un
## literal: Capitán 3, resto 2 (`f1.xml`).
func test_default_morale_comes_from_the_data() -> void:
	var squad := CompanionSquad.new(0, &"technician")
	squad.add_companion(1, &"captain")
	squad.add_companion(2, &"specialist")
	assert_eq(squad.companion(1).base_morale, 3)
	assert_eq(squad.companion(2).base_morale, 2)
