extends TestCase
## La moral modula la obediencia (GDD §3 y §8.5, `[P05]`).
##
## OJO CON EL ORIGINAL, QUE NO ES LO QUE PARECE. La moral de 2012 tenía un
## único efecto: habilitar la regeneración del aura del Capitán
## (`UpdateSanar` exigía `moral == 3`). No había pánico, ni huida, ni
## penalización, y el estado `ComeBack` de los compañeros —lo único parecido a
## una reacción de moral— era código INALCANZABLE (análisis §5.1 y §5.4). El
## aura es paridad y ya vive en `gameplay/`; lo que se prueba aquí es el hueco
## que el original dejó abierto.


func test_the_same_wounded_companion_obeys_next_to_the_captain_and_not_alone() -> void:
	# Mismo compañero, mismas heridas, misma orden. Lo único que cambia es
	# si está dentro del aura del Capitán. Eso es "la moral modula la
	# obediencia" en una sola prueba.
	var alone := CompanionController.new(1, &"technician", 0, 2)
	var covered := CompanionController.new(2, &"technician", 0, 2)
	covered.near_captain = true

	var order := SquadOrder.move_to(Vector3(0.0, 0.0, 18.0))
	var hurt_a := SquadTestUtil.companion_state(1, 0.35, 0.7, true)
	var hurt_b := SquadTestUtil.companion_state(2, 0.35, 0.7, true)

	var d_alone := alone.decide(hurt_a, order, Vector3.ZERO, Vector3.FORWARD)
	var d_covered := covered.decide(hurt_b, order, Vector3.ZERO, Vector3.FORWARD)

	assert_false(d_alone.obeys, "moral 2, herido y bajo fuego: antepone sobrevivir")
	assert_true(d_covered.obeys, "moral 3 junto al Capitán: cruza")
	assert_eq(d_alone.order_kind, SquadOrder.Kind.NONE, "la orden se cae")
	assert_eq(d_covered.order_kind, SquadOrder.Kind.MOVE_TO)


## LA PRUEBA DEL ENUNCIADO: con moral baja, sobrevivir gana a obedecer. No
## basta con que la orden se caiga: la tabla de pesos tiene que cambiar, o el
## cerebro seguiría prefiriendo disparar a cubrirse.
func test_low_morale_prioritizes_surviving_over_obeying() -> void:
	var companion := CompanionController.new(1, &"technician", 0, 0)
	var order := SquadOrder.move_to(Vector3(0.0, 0.0, 18.0))
	var state := SquadTestUtil.companion_state(1, 0.5, 0.8, true)
	var directive := companion.decide(state, order, Vector3.ZERO, Vector3.FORWARD)

	assert_false(directive.obeys)
	assert_false(directive.has_move_target(), "no va a ninguna parte que le hayan mandado")
	assert_false(directive.allows(BehaviorKind.Kind.INVESTIGATE),
		"desaparece el verbo con el que se cumple 'Ir ahí'")
	assert_true(directive.allows(BehaviorKind.Kind.TAKE_COVER))
	assert_gt(
		directive.weights.gain(BehaviorKind.Kind.TAKE_COVER),
		directive.weights.gain(BehaviorKind.Kind.ATTACK),
		"cubrirse pesa más que disparar"
	)


## Desobedecer no es entrar en pánico: sigue disparando desde donde está a
## salvo. Un compañero que se queda mirando la pared es un bug, no una
## decisión.
func test_disobeying_is_not_panicking() -> void:
	var companion := CompanionController.new(1, &"technician", 0, 0)
	var state := SquadTestUtil.companion_state(1, 0.5, 0.8, true)
	var directive := companion.decide(
		state, SquadOrder.move_to(Vector3(0.0, 0.0, 18.0)), Vector3.ZERO, Vector3.FORWARD
	)
	assert_false(directive.obeys)
	assert_true(directive.allows(BehaviorKind.Kind.ATTACK), "puede seguir disparando")
	assert_true(directive.allows(BehaviorKind.Kind.RELOAD))
	assert_false(directive.allows(BehaviorKind.Kind.FOLLOW_LEADER),
		"lo que no hace es salir a campo abierto detrás del jugador")


## Sano y sin nadie disparándole, un compañero normal (moral 2) obedece: la
## moral no puede convertirse en "los compañeros nunca hacen caso".
func test_a_healthy_companion_obeys_a_normal_order() -> void:
	var companion := CompanionController.new(1, &"technician", 0, 2)
	var state := SquadTestUtil.companion_state(1, 1.0, 0.1, false)
	var directive := companion.decide(
		state, SquadOrder.move_to(Vector3(5.0, 0.0, 5.0)), Vector3.ZERO, Vector3.FORWARD
	)
	assert_true(directive.obeys)
	assert_true(directive.has_move_target())
	assert_true(directive.move_target.is_equal_approx(Vector3(5.0, 0.0, 5.0)))


## Órdenes distintas cuestan distinto de obedecer. En el punto justo en el que
## "Ir ahí" ya no se obedece, "Enfocar eso" —que es girar el arma— todavía sí.
func test_a_cheaper_order_is_still_obeyed_where_a_costly_one_is_not() -> void:
	var companion := CompanionController.new(1, &"technician", 0, 2)
	# El punto se elige a propósito DENTRO de la franja que separa las dos
	# órdenes: su anchura es exactamente la diferencia de riesgo entre "Ir
	# ahí" y "Enfocar eso". Si la sintonía cambiara y las dos órdenes
	# costaran lo mismo, esta prueba tiene que fallar.
	var state := SquadTestUtil.companion_state(1, 0.6, 0.5, true)
	var move := companion.decide(
		state, SquadOrder.move_to(Vector3(0.0, 0.0, 18.0)), Vector3.ZERO, Vector3.FORWARD
	)
	var focus := companion.decide(
		state, SquadOrder.focus_target(7, Vector3(0.0, 0.0, 18.0)), Vector3.ZERO, Vector3.FORWARD
	)
	assert_false(move.obeys, "cruzar el vano, no")
	assert_true(focus.obeys, "girar el arma, sí")


## Un compañero a punto de caer puede retirarse aunque obedezca. Un compañero
## muerto lo está para el resto de la campaña (análisis §5.2): no hay
## resurrección, y perderlo por cumplir una orden es el peor intercambio del
## juego.
func test_a_critical_companion_may_always_retreat() -> void:
	var companion := CompanionController.new(1, &"captain", 0, 3)
	companion.near_captain = true
	var state := SquadTestUtil.companion_state(1, 0.15, 0.1, false)
	var directive := companion.decide(state, SquadOrder.none(), Vector3.ZERO, Vector3.FORWARD)
	assert_true(directive.critical)
	assert_true(directive.obeys, "con moral 3 y sin fuego encima sigue obedeciendo")
	assert_true(directive.allows(BehaviorKind.Kind.RETREAT), "pero puede retirarse")


## Cada baja pesa. EXTENSIÓN sobre el original, que no penalizaba nada: es lo
## que convierte la moral en un recurso que el jugador administra.
func test_a_squad_death_costs_morale_to_the_survivors() -> void:
	var squad := CompanionSquad.new(0, &"captain")
	squad.add_companion(1, &"technician", 2)
	squad.add_companion(2, &"specialist", 2)
	squad.add_companion(3, &"demolition", 2)
	assert_eq(squad.companion(1).morale(), 2)

	squad.on_member_died(3)
	assert_eq(squad.size(), 2, "el caído sale de la escuadra")
	assert_eq(squad.companion(1).morale(), 1, "los que quedan lo acusan")
	assert_eq(squad.companion(2).morale(), 1)


## "Cada punto de moral = un compañero": lo que cuenta no es cuántos siguen
## vivos, sino cuántos harían lo que les pides.
func test_obedient_count_is_the_squad_you_really_have() -> void:
	var squad := CompanionSquad.new(0, &"captain")
	squad.add_companion(1, &"technician", 2)
	squad.add_companion(2, &"specialist", 2)
	squad.companion(2).near_captain = true
	squad.order_move_to(Vector3(0.0, 0.0, 18.0))

	var states: Dictionary[int, BotState] = {
		1: SquadTestUtil.companion_state(1, 0.35, 0.7, true),
		2: SquadTestUtil.companion_state(2, 0.35, 0.7, true),
	}
	var directives := squad.decide_all(states, Vector3.ZERO, Vector3.FORWARD)
	assert_size(directives, 2)
	assert_eq(squad.size(), 2, "dos vivos")
	assert_eq(squad.obedient_count(), 1, "pero sólo uno obedece: ese es tu escuadrón real")


## Réplica de `UpdateMoral` / `returnMoral`: cerca de un Capitán la moral sube
## al máximo; al alejarse vuelve al valor de la ficha.
func test_proximity_to_the_captain_raises_and_releases_morale() -> void:
	var squad := CompanionSquad.new(0, &"captain")
	squad.add_companion(1, &"technician", 2)
	var radius := 8.0
	var captains: Array[Vector3] = [Vector3.ZERO]

	var near: Dictionary[int, Vector3] = {1: Vector3(3.0, 0.0, 0.0)}
	squad.refresh_near_captain(near, captains, radius)
	assert_eq(squad.companion(1).morale(), SquadTuning.MORALE_MAX)

	var far: Dictionary[int, Vector3] = {1: Vector3(30.0, 0.0, 0.0)}
	squad.refresh_near_captain(far, captains, radius)
	assert_eq(squad.companion(1).morale(), 2, "vuelve al valor de su ficha")


## El radio de la moral es el MISMO dato que el del aura que cura
## (`CharacterStats.aura_radius_m`), no una copia. Si divergieran, el jugador
## vería a un compañero curándose y desobedeciendo a la vez.
func test_the_morale_radius_is_the_aura_radius() -> void:
	var stats := Balance.character(&"captain")
	assert_not_null(stats)
	assert_almost_eq(CompanionSquad.captain_aura_radius_m(), stats.aura_radius_m, 0.0001)


## Un compañero del que no hay instantánea no recibe órdenes. No saber cómo
## está no es motivo para mandarlo a ninguna parte.
func test_a_companion_without_a_snapshot_is_never_ordered_around() -> void:
	var squad := CompanionSquad.new(0, &"captain")
	squad.add_companion(1, &"technician", 2)
	squad.order_move_to(Vector3(0.0, 0.0, 18.0))
	var empty: Dictionary[int, BotState] = {}
	var directives := squad.decide_all(empty, Vector3.ZERO, Vector3.FORWARD)
	assert_size(directives, 1)
	assert_false(directives[0].obeys)
	assert_false(directives[0].has_move_target())
