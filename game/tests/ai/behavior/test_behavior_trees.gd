extends TestCase
## Los árboles de cada comportamiento, ejecutados de punta a punta sin escena,
## sin física y sin navmesh horneado.
##
## Aquí se comprueba lo que el selector no puede comprobar: que la ejecución
## respeta las mismas reglas que la decisión —no se dispara sin visión, no se
## asalta sin supresión— y que un comportamiento imposible FALLA en vez de
## dejar al bot atascado fingiendo que trabaja.

const BlackboardScript := preload("res://src/core/blackboard.gd")

var board: BlackboardScript = null
var state: BotState = null
var world: BehaviorFakeWorld = null
var cover: BehaviorFakeCover = null
var actuator: BehaviorFakeActuator = null
var ctx: BehaviorContext = null


func before_each() -> void:
	board = BehaviorTestUtil.make_board()
	state = BehaviorTestUtil.make_state()
	world = BehaviorTestUtil.open_world()
	cover = BehaviorTestUtil.empty_cover()
	actuator = BehaviorTestUtil.make_actuator(Vector3.ZERO)
	ctx = BehaviorTestUtil.make_context(state, world, cover, actuator, board)


func after_each() -> void:
	if board != null:
		board.free()
		board = null


# ---------------------------------------------------------------------------
# Atacar
# ---------------------------------------------------------------------------

## Sin línea de visión NO se dispara, aunque el bot sepa dónde está el
## objetivo. Es el bug del legacy —comprobaba inclusión en un triángulo sin
## mirar si había pared en medio— comprobado en la ejecución y no sólo en la
## decisión.
func test_the_attack_tree_never_fires_without_line_of_sight() -> void:
	BehaviorTestUtil.report_contact(board, state.squad_id, Vector3(0.0, 0.0, 10.0))
	ctx.refresh_from_board()
	state.has_line_of_sight = false
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.ATTACK)
	var status := BehaviorTestUtil.run_tree(tree, ctx, actuator, 10)
	assert_eq(status, int(BehaviorTree.Status.FAILURE))
	assert_eq(actuator.fire_count, 0, "ni un solo disparo a ciegas")


## Con visión sí dispara, y encara antes de disparar.
func test_the_attack_tree_fires_at_the_known_target() -> void:
	var target := Vector3(0.0, 0.0, 10.0)
	BehaviorTestUtil.report_contact(board, state.squad_id, target)
	ctx.refresh_from_board()
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.ATTACK)
	var status := BehaviorTestUtil.run_tree(tree, ctx, actuator, 5)
	assert_eq(status, int(BehaviorTree.Status.RUNNING), "disparar es continuo, no un acto")
	assert_gt(float(actuator.fire_count), 0.0)
	# A la ALTURA DEL PECHO, no al punto de contacto tal cual: ese punto son
	# los pies del objetivo (el origen de un `Character` está a ras de suelo) y
	# apuntar ahí hacía que los bots dispararan al suelo.
	assert_eq(actuator.last_look_target, target + Vector3.UP * BehaviorTuning.AIM_HEIGHT_M,
		"se encara al pecho antes de disparar")


## Sin munición tampoco se dispara: el árbol no da por hecho lo que el
## selector ya comprobó.
func test_the_attack_tree_stops_when_the_magazine_is_empty() -> void:
	BehaviorTestUtil.report_contact(board, state.squad_id, Vector3(0.0, 0.0, 10.0))
	ctx.refresh_from_board()
	state.ammo_ratio = 0.0
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.ATTACK)
	assert_eq(BehaviorTestUtil.run_tree(tree, ctx, actuator, 5),
		int(BehaviorTree.Status.FAILURE))
	assert_eq(actuator.fire_count, 0)


# ---------------------------------------------------------------------------
# Cubrirse
# ---------------------------------------------------------------------------

## Sin puntos horneados, buscar cobertura FALLA. Ese fallo es información: es
## lo que el controlador convierte en "pues me retiro".
func test_the_cover_tree_fails_when_there_is_nowhere_to_hide() -> void:
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.TAKE_COVER)
	assert_eq(BehaviorTestUtil.run_tree(tree, ctx, actuator, 5),
		int(BehaviorTree.Status.FAILURE))
	assert_true(ctx.last_cover_query_empty, "queda constancia de por qué falló")


## Con cobertura disponible, el bot camina hasta ella de verdad: no se
## teletransporta ni se queda pensando.
func test_the_cover_tree_walks_to_the_cover_point() -> void:
	cover.add_point(Vector3(-4.0, 0.0, 0.0))
	BehaviorTestUtil.report_contact(board, state.squad_id, Vector3(0.0, 0.0, 10.0))
	ctx.refresh_from_board()
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.TAKE_COVER)
	BehaviorTestUtil.run_tree(tree, ctx, actuator, 80)
	assert_lt(actuator.position().distance_to(Vector3(-4.0, 0.0, 0.0)),
		BehaviorTuning.ARRIVAL_RADIUS_M + 0.1,
		"el bot llega al punto de cobertura, no a un metro de él")
	assert_gt(actuator.distance_travelled_m, 3.0, "y llega andando, no de un salto")


## La consulta de cobertura recibe las amenazas conocidas: un punto que te
## tapa de uno y te deja en bandeja a otro no vale, y eso lo puntúa el
## `CoverProvider` — pero sólo si le llegan las amenazas.
func test_the_cover_query_receives_the_known_threats() -> void:
	cover.add_point(Vector3(-4.0, 0.0, 0.0))
	BehaviorTestUtil.report_contact(board, state.squad_id, Vector3(0.0, 0.0, 10.0), 1.0, 1)
	BehaviorTestUtil.report_contact(board, state.squad_id, Vector3(8.0, 0.0, 0.0), 0.5, 2)
	ctx.refresh_from_board()
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.TAKE_COVER)
	BehaviorTestUtil.run_tree(tree, ctx, actuator, 3)
	assert_eq(cover.last_threats.size(), 2, "las dos amenazas llegan a la consulta")


# ---------------------------------------------------------------------------
# Recargar
# ---------------------------------------------------------------------------

## Recargar termina cuando sube la munición, y se hace agachado si se está a
## cubierto.
func test_the_reload_tree_finishes_when_ammo_comes_back() -> void:
	state.ammo_ratio = 0.0
	state.in_cover = true
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.RELOAD)
	assert_eq(tree.tick(ctx, 0.05), BehaviorTree.Status.RUNNING)
	assert_true(actuator.crouching, "a cubierto se recarga agachado")
	assert_gt(float(actuator.reload_count), 0.0)
	state.ammo_ratio = 1.0
	assert_eq(tree.tick(ctx, 0.05), BehaviorTree.Status.SUCCESS)


## Una recarga que nunca llega no deja al bot colgado para siempre: se agota
## la paciencia y el comportamiento falla, para que el selector reaccione.
func test_the_reload_tree_gives_up_eventually() -> void:
	state.ammo_ratio = 0.0
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.RELOAD)
	var ticks := int(ceil(BehaviorTuning.RELOAD_TIMEOUT_S / 0.05)) + 2
	assert_eq(BehaviorTestUtil.run_tree(tree, ctx, actuator, ticks),
		int(BehaviorTree.Status.FAILURE))


# ---------------------------------------------------------------------------
# Asaltar
# ---------------------------------------------------------------------------

## Nadie asalta sin supresión activa (GDD §8.4), y se pregunta a la PIZARRA.
func test_the_assault_tree_requires_suppression_from_the_blackboard() -> void:
	BehaviorTestUtil.report_contact(board, state.squad_id, Vector3(0.0, 0.0, 12.0))
	ctx.refresh_from_board()
	# La copia del bot dice que sí; la pizarra manda y dice que no.
	state.squad_has_suppression = true
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.ASSAULT)
	assert_eq(BehaviorTestUtil.run_tree(tree, ctx, actuator, 5),
		int(BehaviorTree.Status.FAILURE))
	assert_eq(actuator.distance_travelled_m, 0.0, "no se avanza a pecho descubierto")

	board.mark_suppression(state.squad_id, 3.0)
	var status := BehaviorTestUtil.run_tree(tree, ctx, actuator, 10)
	assert_eq(status, int(BehaviorTree.Status.RUNNING))
	assert_gt(actuator.distance_travelled_m, 0.0, "con supresión aliada sí se avanza")


## Avanzar y disparar a la vez es un `Parallel`, no dos comportamientos.
func test_the_assault_tree_fires_while_advancing() -> void:
	BehaviorTestUtil.report_contact(board, state.squad_id, Vector3(0.0, 0.0, 12.0))
	ctx.refresh_from_board()
	board.mark_suppression(state.squad_id, 3.0)
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.ASSAULT)
	BehaviorTestUtil.run_tree(tree, ctx, actuator, 10)
	assert_gt(float(actuator.fire_count), 0.0)
	assert_gt(actuator.distance_travelled_m, 0.0)


# ---------------------------------------------------------------------------
# Suprimir
# ---------------------------------------------------------------------------

## Suprimir deja marca en la pizarra: es lo que habilita el asalto de los
## compañeros. Sin esa marca, la regla de grupo no se puede cumplir nunca.
func test_suppressing_marks_the_blackboard_for_the_squad() -> void:
	BehaviorTestUtil.report_contact(board, state.squad_id, Vector3(0.0, 0.0, 16.0))
	ctx.refresh_from_board()
	assert_false(board.has_active_suppression(state.squad_id))
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.SUPPRESS)
	BehaviorTestUtil.run_tree(tree, ctx, actuator, 3)
	assert_true(board.has_active_suppression(state.squad_id),
		"la ráfaga habilita el asalto de los compañeros")


## La ráfaga termina, para que el selector pueda reevaluar en lugar de dejar a
## un bot vaciando el cargador para siempre.
func test_the_suppression_burst_ends() -> void:
	BehaviorTestUtil.report_contact(board, state.squad_id, Vector3(0.0, 0.0, 16.0))
	ctx.refresh_from_board()
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.SUPPRESS)
	var ticks := int(ceil(BehaviorTuning.SUPPRESS_BURST_S / 0.05)) + 2
	assert_eq(BehaviorTestUtil.run_tree(tree, ctx, actuator, ticks),
		int(BehaviorTree.Status.SUCCESS))


# ---------------------------------------------------------------------------
# Flanquear
# ---------------------------------------------------------------------------

## Flanquear es tomar una ruta de navmesh REALMENTE disjunta y reclamarla en
## la pizarra. "Ángulo del objetivo + 90°" no es flanquear: es caminar hacia
## una pared.
func test_flanking_claims_a_disjoint_route() -> void:
	world.alternative_routes = 1
	BehaviorTestUtil.report_contact(board, state.squad_id, Vector3(10.0, 0.0, 0.0))
	ctx.refresh_from_board()
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.FLANK)
	BehaviorTestUtil.run_tree(tree, ctx, actuator, 5)
	assert_gt(float(ctx.claimed_route_id), 0.0, "la ruta 0 es la directa: flanquear es otra")
	assert_gt(float(world.disjoint_count), 0.0)


## En un pasillo sin alternativa no se puede flanquear, y el comportamiento lo
## dice en vez de fingir un rodeo imposible.
func test_flanking_fails_in_a_corridor_without_alternatives() -> void:
	world.alternative_routes = 0
	BehaviorTestUtil.report_contact(board, state.squad_id, Vector3(10.0, 0.0, 0.0))
	ctx.refresh_from_board()
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.FLANK)
	assert_eq(BehaviorTestUtil.run_tree(tree, ctx, actuator, 5),
		int(BehaviorTree.Status.FAILURE))
	assert_eq(ctx.claimed_route_id, -1)


## Máximo un flanqueador por ruta: el segundo bot de la misma escuadra no
## puede reclamar la que ya está cogida.
func test_only_one_flanker_per_route() -> void:
	world.alternative_routes = 1
	BehaviorTestUtil.report_contact(board, state.squad_id, Vector3(10.0, 0.0, 0.0))
	ctx.refresh_from_board()
	var first := BehaviorLibrary.build(BehaviorKind.Kind.FLANK)
	BehaviorTestUtil.run_tree(first, ctx, actuator, 3)
	assert_gt(float(ctx.claimed_route_id), 0.0)

	var mate_state := BehaviorTestUtil.make_state({"bot_id": 2})
	var mate_actuator := BehaviorTestUtil.make_actuator(Vector3(1.0, 0.0, 1.0))
	var mate_ctx := BehaviorTestUtil.make_context(mate_state, world, cover, mate_actuator, board)
	var second := BehaviorLibrary.build(BehaviorKind.Kind.FLANK)
	assert_eq(BehaviorTestUtil.run_tree(second, mate_ctx, mate_actuator, 3),
		int(BehaviorTree.Status.FAILURE), "la ruta ya está reclamada")


## Abortar un flanqueo SUELTA la ruta. Si no, la escuadra sigue creyendo que
## alguien está rodeando por ahí y no manda a nadie más.
func test_aborting_a_flank_releases_the_route() -> void:
	world.alternative_routes = 1
	BehaviorTestUtil.report_contact(board, state.squad_id, Vector3(10.0, 0.0, 0.0))
	ctx.refresh_from_board()
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.FLANK)
	BehaviorTestUtil.run_tree(tree, ctx, actuator, 3)
	assert_gt(float(ctx.claimed_route_id), 0.0)
	tree.abort(ctx)
	assert_eq(ctx.claimed_route_id, -1, "el contexto olvida la ruta")
	assert_true(board.claim_route(state.squad_id, 1), "y la pizarra la da por libre")


# ---------------------------------------------------------------------------
# Investigar, patrullar y retirarse
# ---------------------------------------------------------------------------

## Investigar lleva al bot al origen del RUIDO cuando es más reciente que el
## último contacto visual, y allí barre el entorno.
func test_investigating_goes_to_the_freshest_lead_and_scans() -> void:
	ctx.noise_position = Vector3(6.0, 0.0, 6.0)
	ctx.noise_age_s = 1.0
	state.time_since_last_seen_s = 8.0
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.INVESTIGATE)
	var status := BehaviorTestUtil.run_tree(tree, ctx, actuator, 200)
	assert_eq(status, int(BehaviorTree.Status.SUCCESS))
	assert_lt(actuator.position().distance_to(Vector3(6.0, 0.0, 6.0)), 1.5)


## Patrullar recorre el CICLO entero y vuelve a empezar. El legacy elegía el
## siguiente vértice al azar entre los otros dos (`Enemy.cc:54-55`), así que un
## bot podía quedarse rebotando entre dos puntos indefinidamente.
func test_patrolling_cycles_through_its_points() -> void:
	ctx.patrol_points = PackedVector3Array([
		Vector3(6.0, 0.0, 0.0), Vector3(6.0, 0.0, 6.0), Vector3(0.0, 0.0, 6.0)])
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.PATROL)
	var visited: Array[int] = []
	for _i: int in range(200):
		tree.tick(ctx, 0.05)
		actuator.advance(0.05)
		if not visited.has(ctx.patrol_index):
			visited.append(ctx.patrol_index)
	assert_size(visited, 3, "visita los tres puntos del recorrido")
	assert_gt(actuator.distance_travelled_m, 12.0, "y los recorre andando")


## Retirarse aleja de la amenaza conocida. Sin cobertura útil se huye
## igualmente: alejarse sin cubrirse sigue siendo mejor que quedarse.
func test_retreating_moves_away_from_the_threat() -> void:
	BehaviorTestUtil.report_contact(board, state.squad_id, Vector3(0.0, 0.0, -10.0))
	ctx.refresh_from_board()
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.RETREAT)
	BehaviorTestUtil.run_tree(tree, ctx, actuator, 60)
	assert_gt(actuator.position().z, 2.0, "se aleja en la dirección contraria a la amenaza")


# ---------------------------------------------------------------------------
# Modos de fallo del mundo
# ---------------------------------------------------------------------------

## `WorldQuery.path()` devuelve vacío en DOS casos que no se distinguen: "no
## hay ruta" y "el presupuesto de 4 caminos por frame de ADR-002 aún no la ha
## despachado". Fallar al primer vacío convertiría un frame ocupado en un
## cambio de comportamiento; el movimiento espera un poco antes de rendirse.
func test_movement_waits_for_the_path_budget_before_giving_up() -> void:
	world.path_budget = 0
	cover.add_point(Vector3(-6.0, 0.0, 0.0))
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.TAKE_COVER)
	var patient := int(BehaviorTuning.PATH_WAIT_S / 0.05) - 2
	assert_eq(BehaviorTestUtil.run_tree(tree, ctx, actuator, patient),
		int(BehaviorTree.Status.RUNNING), "todavía espera: el presupuesto se recupera")
	assert_eq(BehaviorTestUtil.run_tree(tree, ctx, actuator, 10),
		int(BehaviorTree.Status.FAILURE), "pero no espera indefinidamente")


## Un actuador sin cuerpo no mueve nada, y el árbol lo dice en vez de simular
## un bot que camina en el vacío.
func test_a_disembodied_actuator_fails_loudly() -> void:
	var bodiless := BotActuator.new()
	var lonely := BehaviorTestUtil.make_context(state, world, cover, bodiless, board)
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.TAKE_COVER)
	assert_eq(int(tree.tick(lonely, 0.05)), int(BehaviorTree.Status.FAILURE))


## Un montaje incompleto se denuncia al arrancar, no por comportamiento raro
## tres semanas después.
func test_the_context_reports_an_incomplete_assembly() -> void:
	var broken := BehaviorContext.new(state, world, cover, null, null)
	var problems := broken.problems()
	assert_gt(float(problems.size()), 1.0)
	var joined := "\n".join(problems)
	assert_true(joined.contains("BotActuator"), "falta el actuador")
	assert_true(joined.contains("horneado"), "y la nube de cobertura está vacía")
	cover.add_point(Vector3(-4.0, 0.0, 0.0))
	assert_size(ctx.problems(), 0, "el montaje completo no tiene nada que denunciar")


# ---------------------------------------------------------------------------
# Patrullar
# ---------------------------------------------------------------------------

## Un bot que patrulla tiene que MIRAR alrededor.
##
## `move_along_path` mueve por dirección y no fija punto de mira, y
## `CharacterController` solo rota el cuerpo si alguien se lo pide. Sin barrido,
## el bot recorre la planta con el rumbo congelado al que tenía al nacer: se
## midió en partida con cuatro enemigos a menos de siete metros del jugador
## treinta segundos seguidos, el ángulo clavado en 81° y cero contactos.
func test_a_patrolling_bot_sweeps_its_look_around_the_heading() -> void:
	ctx.patrol_points = PackedVector3Array([Vector3(0.0, 0.0, -12.0), Vector3(12.0, 0.0, 0.0)])
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.PATROL)

	var angles: Array[float] = []
	for step: int in range(40):
		tree.tick(ctx, 0.1)
		actuator.advance(0.1)
		var look := actuator.last_look_target
		if BehaviorContext.is_finite_point(look):
			var direction := look - actuator.position()
			direction.y = 0.0
			if direction.length_squared() > 0.0001:
				angles.append(atan2(direction.x, direction.z))

	assert_gt(float(angles.size()), 10.0, "el bot debería estar mirando a algún sitio")
	if angles.is_empty():
		return
	var lowest := angles[0]
	var highest := angles[0]
	for angle: float in angles:
		lowest = minf(lowest, angle)
		highest = maxf(highest, angle)
	var swept_deg := rad_to_deg(highest - lowest)
	assert_gt(swept_deg, 60.0,
		"barrió solo %.0f grados: con un cono de 65° eso es un túnel" % swept_deg)


func test_the_sweep_does_not_steer_the_bot_off_its_route() -> void:
	# Mirar a un lado no puede desviar la marcha: el contrato de `Character` es
	# direccional y el punto de mira es otra intención distinta. Si el barrido
	# cambiara el rumbo, el bot patrullaría en zigzag.
	ctx.patrol_points = PackedVector3Array([Vector3(0.0, 0.0, -12.0)])
	var tree := BehaviorLibrary.build(BehaviorKind.Kind.PATROL)
	for step: int in range(40):
		tree.tick(ctx, 0.1)
		actuator.advance(0.1)
	var position := actuator.position()
	assert_lt(absf(position.x), 1.0,
		"se desvió %.2f m en X yendo a un punto que está recto" % position.x)
	assert_lt(position.z, -3.0, "y tiene que haber avanzado")


func test_the_bot_aims_at_the_chest_and_not_at_the_floor() -> void:
	# Un contacto se guarda con la posición del CUERPO, y el origen de un
	# `Character` está a ras de suelo. Apuntando ahí tal cual, los enemigos
	# disparaban al suelo: en partida los impactos salían a 27 cm de altura,
	# entre el pie y la rodilla, y las zonas de impacto —cabeza, torso— no se
	# tocaban jamás.
	BehaviorTestUtil.report_contact(board, state.squad_id, Vector3(0.0, 0.0, -6.0))
	ctx.refresh_from_board()
	state.has_line_of_sight = true
	state.ammo_ratio = 1.0

	var tree := BehaviorLibrary.build(BehaviorKind.Kind.ATTACK)
	tree.tick(ctx, 0.1)

	var look := actuator.last_look_target
	assert_true(BehaviorContext.is_finite_point(look), "el bot debería estar apuntando")
	if BehaviorContext.is_finite_point(look):
		assert_gt(look.y, 0.8, "apunta a %.2f m: eso es el suelo, no un torso" % look.y)
		assert_lt(look.y, 1.8, "y tampoco por encima de la cabeza")
