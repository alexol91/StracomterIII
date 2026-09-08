extends TestCase
## Un bot que oye un disparo va a mirar. Es la cadena que la sonda de combate
## encontró rota de punta a punta, y cada pieza de aquí es uno de sus eslabones.
##
## El síntoma medido: en la planta 3 zona 5, un Sicario oye al jugador disparar
## a tres metros, se le crea un contacto de confianza 0,2 y se va a patrullar.
## Treinta segundos, cero disparos enemigos, ningún error en consola. Y no
## fallaba siempre: dependía de que alguien pillara línea de visión de rebote,
## así que la sonda pasaba una vez de cada dos y no había manera de saber si un
## cambio ayudaba o era suerte.
##
## Estas pruebas son puras: no hacen falta escena, física ni GPU, porque toda
## la puntuación de utilidad es `(BotState, Blackboard) -> float`.


func test_investigating_beats_patrolling_with_only_a_faint_lead() -> void:
	# Confianza 0,11: lo que deja un disparo oído a veinte metros a través de
	# un par de tabiques. Sin línea de visión, entero y con munición.
	var state := BehaviorTestUtil.make_state({
		"target_confidence": 0.11,
		"has_line_of_sight": false,
		"distance_to_target_m": 20.0,
		"known_threat_count": 0,
		"time_since_last_seen_s": INF,
	})
	var weights := UtilityWeights.for_archetype(&"enemy_thug")
	var scores := UtilityScorer.score_all(state, weights)
	var investigate: float = scores[BehaviorKind.Kind.INVESTIGATE]
	var patrol: float = scores[BehaviorKind.Kind.PATROL]
	# No basta con ganar: hay que ganar por más que el margen de conmutación,
	# porque si no `BehaviorController` no cambia de comportamiento. Con
	# `calm = 1 − confianza` la diferencia era de 0,04 y el bot seguía su ronda
	# con el tiroteo a veinte metros.
	assert_gt(investigate - patrol, BehaviorKind.SWITCH_MARGIN,
		"ir a mirar (%.2f) tiene que superar a patrullar (%.2f) por más de %.2f"
			% [investigate, patrol, BehaviorKind.SWITCH_MARGIN])


func test_a_bot_that_knows_nothing_patrols() -> void:
	# La otra mitad del mismo balanceo: sin ningún contacto, patrullar gana.
	# Si esto falla, el arreglo de arriba se ha llevado por delante la calma.
	var state := BehaviorTestUtil.make_state({
		"target_confidence": 0.0,
		"has_line_of_sight": false,
		"distance_to_target_m": INF,
		"known_threat_count": 0,
		"time_since_last_seen_s": INF,
	})
	var weights := UtilityWeights.for_archetype(&"enemy_thug")
	var scores := UtilityScorer.score_all(state, weights)
	var patrol: float = scores[BehaviorKind.Kind.PATROL]
	for kind: BehaviorKind.Kind in scores:
		if kind == BehaviorKind.Kind.PATROL:
			continue
		assert_true(patrol >= scores[kind] as float,
			"sin contacto, patrullar (%.2f) no puede perder contra %s (%.2f)"
				% [patrol, BehaviorKind.name_of(kind), scores[kind]])


func test_calm_collapses_as_soon_as_there_is_a_contact() -> void:
	# La calma no es el complemento de la certeza: oír algo la rompe de golpe.
	var quiet := BehaviorTestUtil.make_state({"target_confidence": 0.0})
	var faint := BehaviorTestUtil.make_state(
		{"target_confidence": BehaviorTuning.CALM_BREAK_CONFIDENCE})
	var weights := UtilityWeights.for_archetype(&"enemy_militiaman")
	var calm_patrol: float = UtilityScorer.score_all(quiet, weights)[BehaviorKind.Kind.PATROL]
	var alert_patrol: float = UtilityScorer.score_all(faint, weights)[BehaviorKind.Kind.PATROL]
	assert_gt(calm_patrol - alert_patrol, 0.1,
		"con un contacto en el umbral de amenaza, patrullar tiene que hundirse")


## Lo que el bot sabe manda sobre lo que ha contado. La pizarra es para
## COMPARTIR: a ella solo llegan los contactos por encima de
## `min_broadcast_confidence` (0,45 en el perfil descuidado), y el árbol de
## comportamiento leía el objetivo SOLO de la pizarra. Así que un bot con un
## contacto propio de 0,2 —el que deja un disparo oído— puntuaba «ve a mirar» y
## luego no tenía ningún punto al que ir: dependía de habérselo contado a
## alguien para poder actuar.
func test_the_tree_uses_what_the_bot_knows_when_the_squad_knows_nothing() -> void:
	var state := BehaviorTestUtil.make_state({
		"target_confidence": 0.2,
		"has_line_of_sight": false,
		"believed_target_position": Vector3(6.0, 0.0, -9.0),
	})
	var board := BehaviorTestUtil.make_board()
	var ctx := BehaviorTestUtil.make_context(
		state, BehaviorTestUtil.open_world(), BehaviorTestUtil.empty_cover(),
		BehaviorTestUtil.make_actuator(), board)
	assert_true(ctx.has_target(), "con la pizarra vacía, el bot sigue sabiendo dónde mirar")
	assert_eq(ctx.target_position, Vector3(6.0, 0.0, -9.0), "y es lo que él cree")
	assert_true(ctx.is_finite_point(ctx.aim_point()), "hay a dónde apuntar")
	board.free()


## Y la pizarra sigue mandando cuando SÍ sabe algo: lo que ha visto un
## compañero es mejor información que lo que este bot cree.
func test_the_squad_board_still_wins_when_it_has_a_contact() -> void:
	var state := BehaviorTestUtil.make_state({
		"believed_target_position": Vector3(6.0, 0.0, -9.0),
	})
	var board := BehaviorTestUtil.make_board()
	var contact := Blackboard.Contact.new()
	contact.target_id = 99
	contact.team = 0
	contact.last_known_position = Vector3(-3.0, 0.0, 2.0)
	contact.confidence = 0.9
	board.report_contact(state.squad_id, contact)
	var ctx := BehaviorTestUtil.make_context(
		state, BehaviorTestUtil.open_world(), BehaviorTestUtil.empty_cover(),
		BehaviorTestUtil.make_actuator(), board)
	assert_eq(ctx.target_position, Vector3(-3.0, 0.0, 2.0),
		"lo que ha visto la escuadra manda sobre lo que este bot cree")
	board.free()
