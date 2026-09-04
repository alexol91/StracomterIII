extends TestCase
## El controlador: utilidad para decidir, árbol para ejecutar, histéresis para
## no parecer epiléptico.
##
## Aquí viven las pruebas que ninguna función pura puede dar: las que hablan
## del TIEMPO. Que un bot no cambie de idea cinco veces por segundo, que
## abandone lo imposible sin esperar, y que un árbol que falla acabe
## produciendo una decisión distinta.

const BlackboardScript := preload("res://src/core/blackboard.gd")
const DECISION_DT: float = 1.0 / AIScheduler.DECISION_HZ
const BEHAVIOR_DT: float = 1.0 / AIScheduler.BEHAVIOR_HZ
const FRAME: float = 1.0 / 60.0

var board: BlackboardScript = null
var state: BotState = null
var world: BehaviorFakeWorld = null
var cover: BehaviorFakeCover = null
var actuator: BehaviorFakeActuator = null
var ctx: BehaviorContext = null
var controller: BehaviorController = null


func before_each() -> void:
	AIScheduler.clear()
	AIScheduler.set_focus(Vector3.ZERO)
	board = BehaviorTestUtil.make_board()
	state = BehaviorTestUtil.make_state()
	world = BehaviorTestUtil.open_world()
	cover = BehaviorTestUtil.cover_with_points(2)
	actuator = BehaviorTestUtil.make_actuator(Vector3.ZERO)
	ctx = BehaviorTestUtil.make_context(state, world, cover, actuator, board)
	BehaviorTestUtil.report_contact(board, state.squad_id, Vector3(0.0, 0.0, 12.0))
	ctx.refresh_from_board()
	controller = BehaviorTestUtil.make_controller(
		state, ctx, BehaviorTestUtil.weights_for(&"enemy_militiaman"), board)


func after_each() -> void:
	if controller != null:
		controller.unregister()
		controller = null
	AIScheduler.clear()
	if board != null:
		board.free()
		board = null


## Un ciclo completo de reloj de IA: una decisión y los cuatro ticks de
## comportamiento que caben entre dos decisiones (5 Hz frente a 20 Hz).
func _cycle(count: int = 1) -> void:
	for _i: int in range(count):
		controller.tick_decision(DECISION_DT)
		for _j: int in range(4):
			controller.tick_behavior(BEHAVIOR_DT)
			actuator.advance(BEHAVIOR_DT)


# ---------------------------------------------------------------------------
# ADR-002: el planificador manda
# ---------------------------------------------------------------------------

## Nada en `_process`. El bot no tiene bucle propio: se registra y espera turno.
func test_the_controller_has_no_process_loop_of_its_own() -> void:
	assert_false(controller.has_method("_process"),
		"un cliente del planificador no procesa por su cuenta")
	assert_false(controller.has_method("_physics_process"))
	controller.register()
	assert_true(controller.is_registered())


## El planificador reparte: 5 Hz de decisión y 20 Hz de comportamiento. Es el
## presupuesto de ADR-002 medido, no prometido.
func test_the_scheduler_drives_decision_at_5hz_and_behavior_at_20hz() -> void:
	controller.register()
	for _i: int in range(60):
		AIScheduler._process(FRAME)
	# El acumulador del planificador es de coma flotante y 12/60 no llega
	# exactamente a 0,2: en un segundo caben 4 o 5 decisiones, nunca 60.
	assert_between(float(controller.stat_decisions), 4.0, 5.0,
		"decisión a 5 Hz, no por frame")
	assert_between(float(controller.stat_behavior_ticks), 19.0, 20.0,
		"comportamiento a 20 Hz, no por frame")


## Darse de baja detiene el trabajo: un bot muerto no piensa.
func test_unregistering_stops_the_work() -> void:
	controller.register()
	for _i: int in range(60):
		AIScheduler._process(FRAME)
	var decisions := controller.stat_decisions
	controller.unregister()
	for _i: int in range(60):
		AIScheduler._process(FRAME)
	assert_eq(controller.stat_decisions, decisions, "ya no se le llama")


# ---------------------------------------------------------------------------
# Histéresis
# ---------------------------------------------------------------------------

## LA PRUEBA OBLIGATORIA: con dos comportamientos casi empatados y entradas que
## bailan, el bot NO oscila en 100 ticks de decisión.
##
## La prueba mide además lo que pasaría SIN histéresis, recontando el ganador
## instantáneo tick a tick. Sin esa segunda medida la prueba sería tramposa:
## verde también con un escenario en el que nada oscilaba.
func test_it_does_not_oscillate_over_100_decision_ticks() -> void:
	state.in_cover = false
	var weights := BehaviorTestUtil.weights_for(&"enemy_militiaman")
	# ATTACK y TAKE_COVER se igualan a mano hasta rozarse: es el peor caso para
	# un selector por utilidad, dos comportamientos separados por centésimas.
	# La exposición los mueve en sentidos CONTRARIOS —cubrirse sube cuando
	# atacar baja—, así que basta un temblor de 0,1 para que el ganador cambie.
	weights.set_gain(BehaviorKind.Kind.ATTACK, 0.645)
	weights.set_gain(BehaviorKind.Kind.TAKE_COVER, 1.0)
	controller.weights = weights

	var raw_flips := 0
	var previous_raw := UtilityScorer.select(state, weights, board)
	for i: int in range(100):
		# El temblor de entrada que hace bailar al selector: la exposición
		# estimada cambia una décima entre decisión y decisión, que es lo que
		# hace de verdad una nube de cobertura consultada con contactos que
		# decaen.
		state.exposure = 0.5 + (0.05 if i % 2 == 0 else -0.05)
		var raw := UtilityScorer.select(state, weights, board)
		if raw != previous_raw:
			raw_flips += 1
		previous_raw = raw
		_cycle()

	assert_gt(float(raw_flips), 20.0,
		"el escenario SÍ hace bailar al selector instantáneo: si no, esta prueba no prueba nada")
	assert_lt(float(controller.stat_switches), 3.0,
		"pero el bot sólo cambia de comportamiento al empezar, no una vez por tick")
	assert_gt(float(controller.stat_blocked_by_margin + controller.stat_blocked_by_commitment),
		10.0, "y la histéresis es la que lo impide, no la casualidad")


## El tiempo mínimo de compromiso impide abandonar un comportamiento recién
## empezado aunque otro puntúe más. Flanquear y volverse a la mitad del rodeo
## no es adaptarse: es no haber flanqueado.
func test_the_minimum_commitment_blocks_an_early_switch() -> void:
	controller.force_behavior(BehaviorKind.Kind.FLANK)
	var commitment := BehaviorKind.min_commitment(BehaviorKind.Kind.FLANK)
	assert_gt(commitment, 0.0)
	# Situación que haría preferible cubrirse... pero acaba de empezar a rodear.
	state.exposure = 1.0
	state.in_cover = false
	var switches := controller.stat_switches
	controller.tick_decision(DECISION_DT)
	assert_eq(controller.stat_switches, switches, "no se abandona lo recién empezado")
	assert_gt(float(controller.stat_blocked_by_commitment), 0.0)

	# Cumplido el compromiso, sí se cambia.
	for _i: int in range(int(ceil(commitment / BEHAVIOR_DT)) + 1):
		controller.tick_behavior(BEHAVIOR_DT)
	controller.tick_decision(DECISION_DT)
	assert_gt(float(controller.stat_switches), float(switches),
		"pasado el compromiso, la mejor opción gana")


## El compromiso no es cabezonería: un comportamiento que se vuelve IMPOSIBLE
## se abandona en la primera decisión, sin esperar.
func test_an_impossible_behavior_is_abandoned_at_once() -> void:
	controller.force_behavior(BehaviorKind.Kind.ATTACK)
	var switches := controller.stat_switches
	# El objetivo se mete detrás de una pared: ATTACK deja de ser posible.
	state.has_line_of_sight = false
	controller.tick_decision(DECISION_DT)
	assert_gt(float(controller.stat_switches), float(switches),
		"sin visión no se sigue 'atacando' por compromiso")
	assert_ne(controller.active_behavior(), BehaviorKind.Kind.ATTACK)


# ---------------------------------------------------------------------------
# El fallo del árbol es información
# ---------------------------------------------------------------------------

## LA OTRA PRUEBA OBLIGATORIA, en su versión fuerte: "sin cobertura" no es sólo
## "estoy expuesto", es "no hay ningún punto al que ir". El árbol de TAKE_COVER
## falla, el controlador lo veta un rato y el selector acaba en RETREAT.
##
## Nadie ha escrito la regla "si no hay cobertura, retírate": sale de que el
## fallo del árbol vuelve al selector.
func test_low_health_and_nowhere_to_hide_ends_in_retreat() -> void:
	ctx.cover = BehaviorTestUtil.empty_cover()
	state.health_ratio = 0.55
	state.exposure = 1.0
	state.in_cover = false
	controller.weights = BehaviorTestUtil.weights_for(&"enemy_militiaman", state.health_ratio)

	# Dos ciclos: el primero lo consume el compromiso mínimo del IDLE inicial.
	_cycle(2)
	assert_eq(BehaviorKind.name_of(controller.active_behavior()),
		BehaviorKind.name_of(BehaviorKind.Kind.TAKE_COVER),
		"primero lo intenta: expuesto y bajo fuego, cubrirse es lo mejor que puntúa")
	assert_gt(controller.cooldown_of(BehaviorKind.Kind.TAKE_COVER), 0.0,
		"el árbol ha fallado y el comportamiento queda vetado un rato")

	# Ahora la vida cae de verdad y la cobertura sigue sin existir.
	state.health_ratio = 0.12
	controller.weights = BehaviorTestUtil.weights_for(&"enemy_militiaman", state.health_ratio)
	_cycle(2)
	assert_eq(BehaviorKind.name_of(controller.active_behavior()),
		BehaviorKind.name_of(BehaviorKind.Kind.RETREAT),
		"vida baja y sin cobertura: se retira")
	_cycle(10)
	assert_gt(actuator.distance_travelled_m, 1.0, "y se retira de verdad, moviéndose")


## Un comportamiento vetado por fallo no se reintenta cinco veces por segundo:
## el veto dura, y luego caduca.
func test_the_failure_veto_expires() -> void:
	ctx.cover = BehaviorTestUtil.empty_cover()
	state.exposure = 1.0
	# Con la vida entera, un miliciano expuesto responde al fuego; hay que
	# estar tocado para que cubrirse gane, y es lo que se quiere probar aquí.
	state.health_ratio = 0.55
	controller.weights = BehaviorTestUtil.weights_for(&"enemy_militiaman", state.health_ratio)
	_cycle(2)
	assert_gt(controller.cooldown_of(BehaviorKind.Kind.TAKE_COVER), 0.0)
	_cycle()
	assert_ne(controller.active_behavior(), BehaviorKind.Kind.TAKE_COVER,
		"vetado, el selector elige otra cosa")
	_cycle(int(ceil(BehaviorTuning.FAILURE_COOLDOWN_S / DECISION_DT)) + 1)
	assert_eq(controller.cooldown_of(BehaviorKind.Kind.TAKE_COVER), 0.0,
		"pasado el veto, el comportamiento vuelve a estar disponible")


## Cambiar de comportamiento ABORTA el anterior, y abortar suelta lo que
## tuviera reservado. Un flanqueo abandonado que no suelta su ruta deja a la
## escuadra creyendo que alguien está rodeando por ahí.
func test_switching_aborts_the_previous_tree_and_releases_its_route() -> void:
	world.alternative_routes = 1
	controller.force_behavior(BehaviorKind.Kind.FLANK)
	for _i: int in range(3):
		controller.tick_behavior(BEHAVIOR_DT)
	assert_gt(float(ctx.claimed_route_id), 0.0, "el flanqueo ha reclamado una ruta")

	controller.force_behavior(BehaviorKind.Kind.ATTACK)
	assert_eq(ctx.claimed_route_id, -1, "al abortar, el contexto la suelta")
	assert_true(board.claim_route(state.squad_id, 1), "y la pizarra la da por libre")


# ---------------------------------------------------------------------------
# Escuadra, arquetipos y depuración
# ---------------------------------------------------------------------------

## El veto de la escuadra se respeta en el controlador, no sólo en el selector.
func test_the_squad_filter_is_honoured() -> void:
	controller.filter = BehaviorFilter.denying(
		[BehaviorKind.Kind.ATTACK, BehaviorKind.Kind.SUPPRESS], "orden del director")
	_cycle(3)
	assert_ne(controller.active_behavior(), BehaviorKind.Kind.ATTACK)
	assert_ne(controller.active_behavior(), BehaviorKind.Kind.SUPPRESS)


## Si la escuadra veta el comportamiento activo, se abandona sin esperar al
## compromiso: una orden de grupo no espera a que al bot le apetezca.
func test_a_veto_on_the_active_behavior_takes_effect_immediately() -> void:
	controller.force_behavior(BehaviorKind.Kind.ATTACK)
	controller.filter = BehaviorFilter.denying([BehaviorKind.Kind.ATTACK], "alto el fuego")
	controller.tick_decision(DECISION_DT)
	assert_ne(controller.active_behavior(), BehaviorKind.Kind.ATTACK)


## Un jefe cambia de tabla al bajar de umbral, y lo hace en el tick de
## decisión: no hay una comprobación de fase por frame.
func test_a_boss_changes_phase_mid_fight() -> void:
	controller.configure_archetype(&"miniboss")
	assert_eq(controller.weights.phase, 0)
	state.health_ratio = 0.3
	controller.tick_decision(DECISION_DT)
	assert_eq(controller.weights.phase, 1, "el MiniBoss herido cambia de tabla")


## El desglose es la herramienta de depuración: sin él, "¿por qué hace eso?"
## no tiene respuesta.
func test_explain_reports_the_decision_with_its_breakdown() -> void:
	_cycle()
	var text := controller.explain()
	assert_true(text.contains(BehaviorKind.name_of(controller.active_behavior())),
		"dice qué está haciendo")
	assert_true(text.contains(BehaviorTuning.TERM_LINE_OF_SIGHT),
		"y con qué términos lo decidió")
	assert_true(text.contains("margen de conmutación"), "y con qué histéresis")


## El controlador escribe en la instantánea lo único que es suyo: qué está
## haciendo y desde cuándo. Es lo que leen la escuadra y el HUD.
func test_the_controller_publishes_its_behavior_in_the_snapshot() -> void:
	controller.force_behavior(BehaviorKind.Kind.SUPPRESS)
	controller.tick_behavior(BEHAVIOR_DT)
	assert_eq(state.current_behavior, int(BehaviorKind.Kind.SUPPRESS))
	assert_almost_eq(state.time_in_behavior_s, BEHAVIOR_DT, 0.0001)


## Cambiar de comportamiento avisa. `ai-escuadra` lo usa para reasignar roles
## y la consola para seguir a un bot.
func test_the_controller_announces_its_changes() -> void:
	var seen: Array[int] = []
	controller.behavior_changed.connect(
		func(_previous: BehaviorKind.Kind, next: BehaviorKind.Kind) -> void:
			seen.append(int(next)))
	_cycle(2)
	assert_gt(float(seen.size()), 0.0)
	assert_eq(seen[seen.size() - 1], int(controller.active_behavior()))
