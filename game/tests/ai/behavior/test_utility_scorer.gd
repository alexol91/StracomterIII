extends TestCase
## Selector por utilidad: las decisiones que el subsistema promete.
##
## Todo esto corre sin escena, sin GPU y sin instanciar un solo nodo, porque
## las funciones de puntuación son puras. Ésa es la razón de que sean puras.

const BlackboardScript := preload("res://src/core/blackboard.gd")

var board: BlackboardScript = null


func before_each() -> void:
	board = BehaviorTestUtil.make_board()


func after_each() -> void:
	# La pizarra es un Node: sin esto la ejecución acaba denunciando objetos
	# filtrados aunque todas las pruebas pasen.
	if board != null:
		board.free()
		board = null


# ---------------------------------------------------------------------------
# Las tres decisiones obligatorias
# ---------------------------------------------------------------------------

## Vida baja y sin cobertura ⇒ se retira. Para los TRES arquetipos enemigos:
## el Sicario aguanta más que el Veterano, pero ninguno se queda a pecho
## descubierto agonizando, que es lo que hacía el bot del original —su FSM no
## tenía ni estado de retirada.
func test_low_health_without_cover_retreats() -> void:
	for archetype: StringName in [&"enemy_thug", &"enemy_militiaman", &"enemy_veteran"]:
		var state := BehaviorTestUtil.make_state({
			"archetype": archetype,
			"health_ratio": 0.12,
			"exposure": 1.0,
			"in_cover": false,
		})
		var weights := BehaviorTestUtil.weights_for(archetype, state.health_ratio)
		var chosen := UtilityScorer.select(state, weights, board)
		assert_eq(BehaviorKind.name_of(chosen), BehaviorKind.name_of(BehaviorKind.Kind.RETREAT),
			"el arquetipo '%s' debería retirarse con vida 0,12 y sin cobertura" % archetype)


## El margen con el que gana la retirada tiene que superar la histéresis. Si
## ganase por 0,01 el bot NO cambiaría de comportamiento en juego —el margen
## de conmutación se lo impediría— y esta prueba estaría consagrando un bug:
## verde en el selector, inútil en el bot.
func test_retreat_beats_the_alternatives_by_more_than_the_switch_margin() -> void:
	for archetype: StringName in [&"enemy_thug", &"enemy_militiaman", &"enemy_veteran"]:
		var state := BehaviorTestUtil.make_state({
			"archetype": archetype,
			"health_ratio": 0.12,
			"exposure": 1.0,
			"in_cover": false,
		})
		var weights := BehaviorTestUtil.weights_for(archetype, state.health_ratio)
		var scores := UtilityScorer.score_all(state, weights, board)
		var retreat: float = scores[BehaviorKind.Kind.RETREAT]
		for kind: BehaviorKind.Kind in scores:
			if kind == BehaviorKind.Kind.RETREAT:
				continue
			assert_lt(scores[kind], retreat - BehaviorKind.SWITCH_MARGIN + 0.0001,
				"%s de '%s' debería quedar al menos el margen de conmutación por debajo"
					% [BehaviorKind.name_of(kind), archetype])


## Sin munición y a cubierto ⇒ recarga.
func test_out_of_ammo_in_cover_reloads() -> void:
	var state := BehaviorTestUtil.make_state({
		"ammo_ratio": 0.0,
		"in_cover": true,
		"exposure": 0.05,
		"has_line_of_sight": false,
	})
	var weights := BehaviorTestUtil.weights_for(&"enemy_militiaman")
	var chosen := UtilityScorer.select(state, weights, board)
	assert_eq(BehaviorKind.name_of(chosen), BehaviorKind.name_of(BehaviorKind.Kind.RELOAD),
		"a cubierto y sin balas se recarga")


## Sin munición y a pecho descubierto ⇒ PRIMERO cobertura, no recarga.
## Recargar de pie delante del jugador es la definición de bot tonto.
func test_out_of_ammo_exposed_takes_cover_before_reloading() -> void:
	var state := BehaviorTestUtil.make_state({
		"ammo_ratio": 0.0,
		"in_cover": false,
		"exposure": 1.0,
	})
	var weights := BehaviorTestUtil.weights_for(&"enemy_militiaman")
	var scores := UtilityScorer.score_all(state, weights, board)
	assert_gt(scores[BehaviorKind.Kind.TAKE_COVER], scores[BehaviorKind.Kind.RELOAD],
		"expuesto y sin balas, cubrirse gana a recargar")
	assert_eq(BehaviorKind.name_of(UtilityScorer.select(state, weights, board)),
		BehaviorKind.name_of(BehaviorKind.Kind.TAKE_COVER))


# ---------------------------------------------------------------------------
# Puertas duras
# ---------------------------------------------------------------------------

## Sin línea de visión no se dispara. Es una puerta, no un peso bajo: el bug
## del legacy era exactamente éste (comprobaba inclusión en un triángulo sin
## mirar si había pared en medio).
func test_without_line_of_sight_attack_is_impossible() -> void:
	var state := BehaviorTestUtil.make_state({"has_line_of_sight": false})
	var weights := BehaviorTestUtil.weights_for(&"enemy_thug")
	var entry := UtilityScorer.breakdown(BehaviorKind.Kind.ATTACK, state, weights, board)
	assert_false(entry.gate_open, "la puerta de ATTACK debe cerrarse sin visión")
	assert_eq(entry.total, 0.0, "sin visión, ATTACK vale exactamente 0")
	assert_true(entry.gate_reason.contains("visión"), "el motivo debe decir de qué se trata")
	assert_ne(UtilityScorer.select(state, weights, board), BehaviorKind.Kind.ATTACK)


## Lo mismo para suprimir: fuego sostenido contra algo que no ves es gastar
## munición contra una pared.
func test_without_line_of_sight_suppress_is_impossible() -> void:
	var state := BehaviorTestUtil.make_state({"has_line_of_sight": false})
	var weights := BehaviorTestUtil.weights_for(&"enemy_veteran")
	assert_eq(UtilityScorer.score(BehaviorKind.Kind.SUPPRESS, state, weights, board), 0.0)


## Nadie asalta sin supresión activa de un compañero (GDD §8.4).
func test_without_squad_suppression_assault_is_impossible() -> void:
	var state := BehaviorTestUtil.make_state({"role": Blackboard.Role.ASSAULTER})
	var weights := BehaviorTestUtil.weights_for(&"enemy_veteran")
	var closed := UtilityScorer.breakdown(BehaviorKind.Kind.ASSAULT, state, weights, board)
	assert_false(closed.gate_open, "sin supresión, ASSAULT está cerrado")
	assert_eq(closed.total, 0.0)

	board.mark_suppression(state.squad_id, 3.0)
	var open := UtilityScorer.breakdown(BehaviorKind.Kind.ASSAULT, state, weights, board)
	assert_true(open.gate_open, "con supresión activa, ASSAULT es posible")
	assert_gt(open.total, 0.0)


## La pizarra manda sobre la instantánea en lo que es del GRUPO. Un bot que
## lleva en su copia "hay supresión" pero cuya escuadra ya no la tiene NO
## puede asaltar: avanzar creyendo que te cubren es la peor forma de
## equivocarse, y la copia caduca.
func test_blackboard_overrides_a_stale_suppression_snapshot() -> void:
	var state := BehaviorTestUtil.make_state({"squad_has_suppression": true})
	var weights := BehaviorTestUtil.weights_for(&"enemy_veteran")
	assert_eq(UtilityScorer.score(BehaviorKind.Kind.ASSAULT, state, weights, board), 0.0,
		"la pizarra dice que no hay supresión: la copia del bot no vale")
	# Sin pizarra sí se usa la copia: es la única información disponible y el
	# llamante ha elegido explícitamente no pasar ninguna.
	assert_gt(UtilityScorer.score(BehaviorKind.Kind.ASSAULT, state, weights, null), 0.0)


## Investigar es para cuando NO se ve al objetivo. Con el objetivo delante no
## hay nada que buscar.
func test_investigate_is_impossible_while_the_target_is_visible() -> void:
	var state := BehaviorTestUtil.make_state({"has_line_of_sight": true})
	var weights := BehaviorTestUtil.weights_for(&"enemy_militiaman")
	assert_eq(UtilityScorer.score(BehaviorKind.Kind.INVESTIGATE, state, weights, board), 0.0)


# ---------------------------------------------------------------------------
# Propiedades de la puntuación
# ---------------------------------------------------------------------------

## El desglose suma la puntuación. Sin esta invariante el desglose sería
## decorativo, y un desglose decorativo es peor que ninguno: da confianza
## falsa al balancear.
func test_breakdown_sums_the_total() -> void:
	var scenarios: Array[Dictionary] = [
		{},
		{"health_ratio": 0.1, "ammo_ratio": 0.0, "exposure": 1.0},
		{"has_line_of_sight": false, "target_confidence": 0.3, "squad_strength": 0.2},
		{"in_cover": true, "exposure": 0.0, "distance_to_target_m": 30.0},
	]
	for overrides: Dictionary in scenarios:
		var state := BehaviorTestUtil.make_state(overrides)
		var weights := BehaviorTestUtil.weights_for(&"enemy_veteran", state.health_ratio)
		for entry: UtilityScorer.Breakdown in UtilityScorer.breakdown_all(state, weights, board):
			if entry.gate_open:
				assert_almost_eq(entry.sum_of_contributions(), entry.total, 0.000001,
					"el desglose de %s debe sumar su puntuación" % BehaviorKind.name_of(entry.kind))
			else:
				assert_eq(entry.total, 0.0,
					"%s tiene la puerta cerrada: debe valer 0" % BehaviorKind.name_of(entry.kind))


## Ninguna puntuación se sale de [0,1], que es lo que hace comparables el
## margen de conmutación y las tablas entre arquetipos.
func test_scores_stay_normalised() -> void:
	var scenarios: Array[Dictionary] = [
		{},
		{"health_ratio": 0.0, "ammo_ratio": 0.0, "exposure": 1.0, "squad_strength": 0.0,
			"known_threat_count": 9, "distance_to_target_m": 0.5},
		{"health_ratio": 1.0, "ammo_ratio": 1.0, "exposure": 0.0, "in_cover": true,
			"target_confidence": 0.0, "distance_to_target_m": INF,
			"time_since_last_seen_s": INF, "has_line_of_sight": false},
	]
	for overrides: Dictionary in scenarios:
		var state := BehaviorTestUtil.make_state(overrides)
		var weights := BehaviorTestUtil.weights_for(&"enemy_militiaman", state.health_ratio)
		for kind: BehaviorKind.Kind in BehaviorKind.Kind.values():
			var value := UtilityScorer.score(kind, state, weights, board)
			assert_between(value, 0.0, 1.0,
				"%s fuera de rango" % BehaviorKind.name_of(kind))


## Sin contacto de ningún tipo, un bot entero patrulla. No se queda quieto ni
## se pone a investigar fantasmas.
func test_with_no_contact_the_bot_patrols() -> void:
	var state := BehaviorTestUtil.make_state({
		"target_confidence": 0.0,
		"has_line_of_sight": false,
		"distance_to_target_m": INF,
		"time_since_last_seen_s": INF,
		"known_threat_count": 0,
		"exposure": 0.2,
	})
	var weights := BehaviorTestUtil.weights_for(&"enemy_militiaman")
	assert_eq(BehaviorKind.name_of(UtilityScorer.select(state, weights, board)),
		BehaviorKind.name_of(BehaviorKind.Kind.PATROL))


## Un contacto perdido hace rato se investiga: el bot va a buscarte donde CREE
## que estás. El del original volvía a patrullar y se olvidaba.
func test_a_lost_contact_is_investigated() -> void:
	var state := BehaviorTestUtil.make_state({
		"has_line_of_sight": false,
		"target_confidence": 0.6,
		"time_since_last_seen_s": 4.0,
		"exposure": 0.3,
	})
	var weights := BehaviorTestUtil.weights_for(&"enemy_militiaman")
	var scores := UtilityScorer.score_all(state, weights, board)
	assert_gt(scores[BehaviorKind.Kind.INVESTIGATE], scores[BehaviorKind.Kind.PATROL],
		"con una pista fresca se investiga antes que patrullar")


# ---------------------------------------------------------------------------
# Rol y veto de la escuadra
# ---------------------------------------------------------------------------

## El rol asignado sesga la elección sin decidirla. Es lo que hace que dos
## bots idénticos ante la misma situación hagan cosas distintas y coordinadas.
func test_the_assigned_role_biases_the_choice() -> void:
	var state := BehaviorTestUtil.make_state({"has_line_of_sight": false,
		"target_confidence": 0.8, "distance_to_target_m": 18.0})
	var weights := BehaviorTestUtil.weights_for(&"enemy_militiaman")
	var neutral := UtilityScorer.score(BehaviorKind.Kind.FLANK, state, weights, board)
	board.set_role(state.bot_id, Blackboard.Role.FLANKER)
	var as_flanker := UtilityScorer.score(BehaviorKind.Kind.FLANK, state, weights, board)
	assert_gt(as_flanker, neutral, "el rol de flanqueador debe subir FLANK")


## El veto de la escuadra es DURO. Una regla de grupo que sólo bajase la
## utilidad se colaría en cuanto el resto de utilidades bajaran.
func test_the_squad_veto_is_hard() -> void:
	var state := BehaviorTestUtil.make_state()
	var weights := BehaviorTestUtil.weights_for(&"enemy_thug")
	assert_eq(BehaviorKind.name_of(UtilityScorer.select(state, weights, board)),
		BehaviorKind.name_of(BehaviorKind.Kind.ATTACK), "sin veto, este sicario ataca")
	var filter := BehaviorFilter.denying([BehaviorKind.Kind.ATTACK], "el director lo prohíbe")
	assert_ne(UtilityScorer.select(state, weights, board, filter), BehaviorKind.Kind.ATTACK)


## Una lista blanca vacía no permite NADA. El valor por defecto de una
## consulta de la que depende una decisión de justicia nunca puede ser el
## permisivo: si la escuadra calcula mal, el bot se queda quieto, que es
## visible y depurable.
func test_an_empty_allowlist_leaves_the_bot_idle() -> void:
	var state := BehaviorTestUtil.make_state()
	var weights := BehaviorTestUtil.weights_for(&"enemy_thug")
	var empty: Array[BehaviorKind.Kind] = []
	var filter := BehaviorFilter.allow_only(empty)
	assert_false(filter.allows_anything(), "una lista blanca vacía no permite nada")
	assert_eq(BehaviorKind.name_of(UtilityScorer.select(state, weights, board, filter)),
		BehaviorKind.name_of(BehaviorKind.Kind.IDLE))


## Sin tabla de pesos no se puntúa nada. Un montaje incompleto debe fallar de
## forma visible, no elegir un comportamiento cualquiera.
func test_without_weights_nothing_scores() -> void:
	var state := BehaviorTestUtil.make_state()
	var entry := UtilityScorer.breakdown(BehaviorKind.Kind.ATTACK, state, null, board)
	assert_false(entry.gate_open)
	assert_eq(entry.total, 0.0)
