extends TestCase
## Los arquetipos son TABLAS DE PESOS, no clases con lógica.
##
## Estas pruebas comprueban que la personalidad de cada enemigo sale de los
## números y no de un `if` escondido: ante EXACTAMENTE el mismo estado, tres
## tablas distintas deciden tres cosas distintas.

const BlackboardScript := preload("res://src/core/blackboard.gd")

var board: BlackboardScript = null


func before_each() -> void:
	board = BehaviorTestUtil.make_board()


func after_each() -> void:
	if board != null:
		board.free()
		board = null


## Mismo estado, tres arquetipos, tres decisiones. Es la prueba de que la
## personalidad vive en la tabla.
func test_the_same_situation_produces_different_choices_per_archetype() -> void:
	var overrides := {
		"exposure": 1.0,
		"in_cover": false,
		"health_ratio": 0.8,
		"distance_to_target_m": 16.0,
	}
	var thug := BehaviorTestUtil.make_state(overrides)
	var veteran := BehaviorTestUtil.make_state(overrides)

	var thug_choice := UtilityScorer.select(
		thug, BehaviorTestUtil.weights_for(&"enemy_thug"), board)
	var veteran_choice := UtilityScorer.select(
		veteran, BehaviorTestUtil.weights_for(&"enemy_veteran"), board)

	assert_eq(BehaviorKind.name_of(thug_choice), BehaviorKind.name_of(BehaviorKind.Kind.ATTACK),
		"el sicario presiona: ataca a pecho descubierto")
	assert_eq(BehaviorKind.name_of(veteran_choice),
		BehaviorKind.name_of(BehaviorKind.Kind.TAKE_COVER),
		"el veterano se cubre antes de responder")


## El sicario se cubre mucho menos que el veterano. Es "poca cobertura"
## expresado como número, no como excepción en el código.
func test_the_thug_values_cover_far_less_than_the_veteran() -> void:
	var thug := BehaviorTestUtil.weights_for(&"enemy_thug")
	var veteran := BehaviorTestUtil.weights_for(&"enemy_veteran")
	assert_lt(thug.gain(BehaviorKind.Kind.TAKE_COVER),
		veteran.gain(BehaviorKind.Kind.TAKE_COVER))
	assert_gt(thug.gain(BehaviorKind.Kind.ATTACK), veteran.gain(BehaviorKind.Kind.ATTACK))


## El veterano suprime y avanza; el miliciano flanquea. GDD §4.
func test_the_veteran_suppresses_and_the_militiaman_flanks() -> void:
	var veteran := BehaviorTestUtil.weights_for(&"enemy_veteran")
	var militiaman := BehaviorTestUtil.weights_for(&"enemy_militiaman")
	assert_gt(veteran.gain(BehaviorKind.Kind.SUPPRESS),
		militiaman.gain(BehaviorKind.Kind.SUPPRESS))
	assert_gt(militiaman.gain(BehaviorKind.Kind.FLANK), veteran.gain(BehaviorKind.Kind.FLANK))


## Desde cobertura y con visión, el veterano suprime en vez de disparar suelto.
func test_the_veteran_suppresses_from_cover() -> void:
	var state := BehaviorTestUtil.make_state({
		"in_cover": true,
		"exposure": 0.1,
		"distance_to_target_m": 18.0,
	})
	var weights := BehaviorTestUtil.weights_for(&"enemy_veteran")
	var scores := UtilityScorer.score_all(state, weights, board)
	assert_gt(scores[BehaviorKind.Kind.SUPPRESS], scores[BehaviorKind.Kind.ATTACK],
		"el veterano prefiere fuego sostenido desde cobertura")


## Un enemigo no sigue al líder ni mantiene posición, y no porque haya una
## comprobación de bando escondida: porque su tabla les da ganancia 0.
func test_enemies_have_no_companion_behaviors() -> void:
	var weights := BehaviorTestUtil.weights_for(&"enemy_veteran")
	assert_false(weights.enabled(BehaviorKind.Kind.FOLLOW_LEADER))
	assert_false(weights.enabled(BehaviorKind.Kind.HOLD_POSITION))
	var state := BehaviorTestUtil.make_state()
	assert_eq(UtilityScorer.score(BehaviorKind.Kind.FOLLOW_LEADER, state, weights, board), 0.0)


## Los compañeros corren el MISMO cerebro con otra tabla (GDD §8.5).
func test_the_companion_table_enables_formation_behaviors() -> void:
	var companion := BehaviorTestUtil.companion_weights()
	assert_true(companion.enabled(BehaviorKind.Kind.FOLLOW_LEADER))
	assert_true(companion.enabled(BehaviorKind.Kind.HOLD_POSITION))
	var state := BehaviorTestUtil.make_state({
		"target_confidence": 0.0,
		"has_line_of_sight": false,
		"distance_to_target_m": INF,
		"time_since_last_seen_s": INF,
		"known_threat_count": 0,
		"exposure": 0.2,
	})
	# Sin contacto, un compañero mantiene la formación en vez de patrullar.
	var scores := UtilityScorer.score_all(state, companion, board)
	assert_gt(scores[BehaviorKind.Kind.FOLLOW_LEADER], scores[BehaviorKind.Kind.PATROL])


## Un jefe no es un arquetipo con más vida: cambia de tabla al bajar de
## umbral. Al MiniBoss herido se le acaba la paciencia de guardián de planta.
func test_boss_phases_change_the_table() -> void:
	var fresh := BehaviorTestUtil.weights_for(&"miniboss", 0.9)
	var wounded := BehaviorTestUtil.weights_for(&"miniboss", 0.3)
	assert_eq(fresh.phase, 0)
	assert_eq(wounded.phase, 1)
	assert_gt(wounded.gain(BehaviorKind.Kind.ASSAULT), fresh.gain(BehaviorKind.Kind.ASSAULT))
	assert_lt(wounded.gain(BehaviorKind.Kind.RETREAT), fresh.gain(BehaviorKind.Kind.RETREAT))


## El MegaBoss de la azotea tiene tres fases y en la última no se cubre ni se
## retira: es el final del juego, no una pelea de pasillo.
func test_the_megaboss_has_three_phases() -> void:
	assert_eq(BehaviorTuning.boss_phase(&"megaboss", 1.0), 0)
	assert_eq(BehaviorTuning.boss_phase(&"megaboss", 0.5), 1)
	assert_eq(BehaviorTuning.boss_phase(&"megaboss", 0.1), 2)
	var final_phase := BehaviorTestUtil.weights_for(&"megaboss", 0.1)
	assert_eq(final_phase.gain(BehaviorKind.Kind.RETREAT), 0.0)
	assert_eq(final_phase.gain(BehaviorKind.Kind.REGROUP), 0.0)


## Un arquetipo desconocido no rompe nada: hereda la tabla base. Un enemigo
## nuevo del director no debe dejar de pensar por no tener fila propia.
func test_an_unknown_archetype_falls_back_to_the_base_table() -> void:
	var weights := BehaviorTestUtil.weights_for(&"enemy_inventado")
	assert_eq(weights.gain(BehaviorKind.Kind.ATTACK),
		BehaviorTuning.BASE_GAIN[BehaviorKind.Kind.ATTACK])
	var state := BehaviorTestUtil.make_state()
	assert_gt(UtilityScorer.score(BehaviorKind.Kind.ATTACK, state, weights, board), 0.0)


## Los pesos son datos que se pueden tocar en caliente: es lo que permitirá
## rebalancear desde la consola sin reiniciar, y lo que hará trivial moverlos
## a `.tres` cuando el arquitecto cree el recurso.
func test_weights_are_data_and_can_be_retuned() -> void:
	var weights := BehaviorTestUtil.weights_for(&"enemy_militiaman")
	var state := BehaviorTestUtil.make_state()
	var before := UtilityScorer.score(BehaviorKind.Kind.ATTACK, state, weights, board)
	weights.set_gain(BehaviorKind.Kind.ATTACK, weights.gain(BehaviorKind.Kind.ATTACK) * 0.5)
	var after := UtilityScorer.score(BehaviorKind.Kind.ATTACK, state, weights, board)
	assert_almost_eq(after, before * 0.5, 0.000001, "la ganancia escala la puntuación")


## Un peso negativo no existe: rompería la normalización y con ella la
## invariante de que el desglose suma la puntuación.
func test_negative_weights_are_clamped_to_zero() -> void:
	var weights := BehaviorTestUtil.weights_for(&"enemy_militiaman")
	weights.set_weight(BehaviorKind.Kind.ATTACK, BehaviorTuning.TERM_HEALTH, -5.0)
	assert_eq(weights.weight(BehaviorKind.Kind.ATTACK, BehaviorTuning.TERM_HEALTH), 0.0)
