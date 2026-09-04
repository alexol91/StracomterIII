class_name BehaviorActions
extends RefCounted
## Hojas de los árboles de comportamiento: condiciones y acciones.
##
## Todas son FUNCIONES ESTÁTICAS sobre `(BehaviorContext, delta)`. No guardan
## estado propio —el estado del árbol vive en el contexto— y por eso el mismo
## árbol se puede compartir entre bots o reconstruir sin consecuencias.
##
## NINGUNA ACCIÓN LANZA UN RAYO. La línea de visión la calcula
## `ai-percepcion` a 10 Hz con el techo de 48 rayos/frame de ADR-002, y aquí
## se LEE de `BotState.has_line_of_sight`. Un árbol que confirmase la visión
## por su cuenta a 20 Hz por bot duplicaría el trabajo caro del subsistema
## caro, se saltaría el presupuesto sin que el planificador se enterara, y
## abriría una segunda implementación del mismo rayo — que es exactamente la
## duplicación que ya costó un bug de rayos X en este proyecto.
##
## NINGUNA ACCIÓN CALCULA COBERTURA NI RUTAS. La cobertura la sirve
## `CoverProvider.query()` y las rutas de flanqueo `WorldQuery.disjoint_routes()`.
## Aquí sólo se consumen.



# ---------------------------------------------------------------------------
# Condiciones
# ---------------------------------------------------------------------------

## ¿Sabe la escuadra dónde está el objetivo?
static func has_target(ctx: BehaviorContext) -> bool:
	return ctx != null and ctx.has_target()


## ¿Hay línea de visión al objetivo, según la última percepción?
static func has_line_of_sight(ctx: BehaviorContext) -> bool:
	return ctx != null and ctx.state != null and ctx.state.has_line_of_sight


## ¿Queda munición?
static func has_ammo(ctx: BehaviorContext) -> bool:
	return ctx != null and ctx.state != null and ctx.state.ammo_ratio > 0.0


## ¿Falta munición por cargar?
static func needs_reload(ctx: BehaviorContext) -> bool:
	if ctx == null or ctx.state == null:
		return false
	return ctx.state.ammo_ratio < BehaviorTuning.RELOAD_SATISFIED_RATIO


## ¿Tiene la escuadra supresión activa? Es la condición de grupo que habilita
## el asalto (GDD §8.4). Se pregunta a la PIZARRA y no a la instantánea: la
## instantánea es una copia que puede haber caducado, y avanzar a pecho
## descubierto creyendo que un compañero te cubre es la peor forma de
## equivocarse.
static func squad_has_suppression(ctx: BehaviorContext) -> bool:
	if ctx == null or ctx.state == null:
		return false
	if ctx.board != null:
		return ctx.board.has_active_suppression(ctx.state.squad_id)
	return ctx.state.squad_has_suppression


## ¿Está el bot en un punto de cobertura?
static func is_in_cover(ctx: BehaviorContext) -> bool:
	return ctx != null and ctx.state != null and ctx.state.in_cover


## ¿Hay un punto de reunión al que replegarse?
static func has_rally_point(ctx: BehaviorContext) -> bool:
	return ctx != null and BehaviorContext.is_finite_point(ctx.rally_point)


## ¿Hay algo que investigar (un ruido o una última posición conocida)?
static func has_investigation_point(ctx: BehaviorContext) -> bool:
	return ctx != null and BehaviorContext.is_finite_point(ctx.investigation_point())


## ¿Hay recorrido de patrulla?
static func has_patrol_route(ctx: BehaviorContext) -> bool:
	return ctx != null and ctx.patrol_points.size() > 0


## ¿Está el actuador enlazado a un cuerpo? Sin esto, todas las acciones de
## movimiento fallan, y conviene que falle una condición con nombre y no una
## acción a mitad de una secuencia.
static func is_embodied(ctx: BehaviorContext) -> bool:
	return ctx != null and ctx.actuator != null and ctx.actuator.is_embodied()


# ---------------------------------------------------------------------------
# Acciones de orientación y fuego
# ---------------------------------------------------------------------------

## Encara el objetivo conocido.
static func face_target(ctx: BehaviorContext, _delta: float) -> BehaviorTree.Status:
	if ctx == null or ctx.actuator == null or not ctx.has_target():
		return BehaviorTree.Status.FAILURE
	ctx.actuator.face(ctx.target_position)
	return BehaviorTree.Status.SUCCESS


## Dispara al objetivo. RUNNING mientras se pueda seguir disparando: es un
## comportamiento continuo, no un disparo suelto.
##
## Comprueba la visión ANTES de disparar aunque el selector ya la haya
## comprobado en su puerta. No es redundancia inútil: entre la decisión (5 Hz)
## y la ejecución (20 Hz) pasan hasta cuatro ticks de comportamiento, y en ese
## tiempo el objetivo puede haberse metido detrás de una pared. Sin esta
## comprobación el bot seguiría disparando a la pared durante 200 ms — que es,
## a escala pequeña, el bug del legacy.
static func fire_at_target(ctx: BehaviorContext, _delta: float) -> BehaviorTree.Status:
	if ctx == null or ctx.state == null or ctx.actuator == null:
		return BehaviorTree.Status.FAILURE
	if not ctx.has_target():
		return BehaviorTree.Status.FAILURE
	if not ctx.state.has_line_of_sight:
		return BehaviorTree.Status.FAILURE
	if ctx.state.ammo_ratio <= 0.0:
		return BehaviorTree.Status.FAILURE
	ctx.actuator.face(ctx.target_position)
	ctx.actuator.fire()
	return BehaviorTree.Status.RUNNING


## Fuego sostenido para fijar al objetivo, y marca de supresión en la pizarra
## para que los compañeros puedan asaltar. Termina al agotar la ráfaga, para
## que el selector pueda reevaluar.
static func suppress_burst(ctx: BehaviorContext, delta: float) -> BehaviorTree.Status:
	if ctx == null or ctx.state == null or ctx.actuator == null:
		return BehaviorTree.Status.FAILURE
	if not ctx.has_target() or not ctx.state.has_line_of_sight:
		return BehaviorTree.Status.FAILURE
	if ctx.state.ammo_ratio < BehaviorTuning.SUPPRESS_MIN_AMMO_RATIO:
		return BehaviorTree.Status.FAILURE
	ctx.actuator.face(ctx.target_position)
	ctx.actuator.fire()
	if ctx.board != null:
		ctx.board.mark_suppression(ctx.state.squad_id, BehaviorTuning.SUPPRESSION_MARK_S)
	ctx.burst_s += delta
	if ctx.burst_s >= BehaviorTuning.SUPPRESS_BURST_S:
		ctx.burst_s = 0.0
		return BehaviorTree.Status.SUCCESS
	return BehaviorTree.Status.RUNNING


## Dispara sólo si hay visión, sin fallar si no la hay. Es lo que permite
## "avanza mientras disparas" en un `Parallel` sin que la falta de visión
## tumbe el avance.
static func fire_if_visible(ctx: BehaviorContext, _delta: float) -> BehaviorTree.Status:
	if ctx == null or ctx.state == null or ctx.actuator == null:
		return BehaviorTree.Status.FAILURE
	if not ctx.has_target() or not ctx.state.has_line_of_sight or ctx.state.ammo_ratio <= 0.0:
		return BehaviorTree.Status.RUNNING
	ctx.actuator.face(ctx.target_position)
	ctx.actuator.fire()
	return BehaviorTree.Status.RUNNING


## Recarga. RUNNING hasta que la munición sube o se agota la paciencia.
##
## El original no tenía recarga: un enemigo que gastaba sus 50 balas quedaba
## inútil el resto de la partida (GDD §4).
static func reload(ctx: BehaviorContext, delta: float) -> BehaviorTree.Status:
	if ctx == null or ctx.state == null or ctx.actuator == null:
		return BehaviorTree.Status.FAILURE
	if ctx.reload_s <= 0.0:
		ctx.reload_start_ammo = ctx.state.ammo_ratio
	ctx.reload_s += delta
	ctx.actuator.reload()
	if ctx.state.ammo_ratio > ctx.reload_start_ammo:
		ctx.reload_s = 0.0
		return BehaviorTree.Status.SUCCESS
	if ctx.reload_s >= BehaviorTuning.RELOAD_TIMEOUT_S:
		ctx.reload_s = 0.0
		return BehaviorTree.Status.FAILURE
	return BehaviorTree.Status.RUNNING


## Se agacha si está en cobertura. Agacharse cuesta movilidad y mejora la
## cobertura efectiva: es el intercambio que hace interesante el mobiliario.
static func crouch_if_in_cover(ctx: BehaviorContext, _delta: float) -> BehaviorTree.Status:
	if ctx == null or ctx.actuator == null or ctx.state == null:
		return BehaviorTree.Status.FAILURE
	ctx.actuator.set_crouch(ctx.state.in_cover)
	return BehaviorTree.Status.SUCCESS


## Barrido del entorno al llegar a un punto investigado.
static func scan_area(ctx: BehaviorContext, delta: float) -> BehaviorTree.Status:
	if ctx == null or ctx.actuator == null:
		return BehaviorTree.Status.FAILURE
	var origin := ctx.self_position()
	if not BehaviorContext.is_finite_point(origin):
		return BehaviorTree.Status.FAILURE
	ctx.scan_s += delta
	var angle := ctx.scan_s * BehaviorTuning.SCAN_RATE_RAD_S
	var offset := Vector3(cos(angle), 0.0, sin(angle)) * BehaviorTuning.SCAN_LOOK_DISTANCE_M
	ctx.actuator.face(origin + offset)
	ctx.actuator.stop()
	if ctx.scan_s >= BehaviorTuning.INVESTIGATE_SCAN_S:
		ctx.scan_s = 0.0
		return BehaviorTree.Status.SUCCESS
	return BehaviorTree.Status.RUNNING


## Deja el cuerpo quieto. Se usa como `on_abort` de las acciones de
## movimiento: un árbol que se abandona a medias no debe dejar al bot
## caminando hacia un destino que ya no le interesa.
static func stop_moving(ctx: BehaviorContext) -> void:
	if ctx != null and ctx.actuator != null:
		ctx.actuator.stop()


# ---------------------------------------------------------------------------
# Acciones de movimiento
# ---------------------------------------------------------------------------

## Fija el destino y, si ha cambiado lo suficiente, invalida la ruta actual.
static func set_move_goal(ctx: BehaviorContext, goal: Vector3) -> void:
	if not BehaviorContext.is_finite_point(goal):
		ctx.move_goal = Vector3.INF
		ctx.move_path = PackedVector3Array()
		ctx.move_index = 0
		return
	if not BehaviorContext.is_finite_point(ctx.move_goal) \
			or planar_distance(ctx.move_goal, goal) > BehaviorTuning.REPATH_THRESHOLD_M:
		ctx.move_path = PackedVector3Array()
		ctx.move_index = 0
		ctx.move_wait_s = 0.0
	ctx.move_goal = goal


## Recorre la ruta hacia `ctx.move_goal`. SUCCESS al llegar, RUNNING mientras
## camina, FAILURE si no hay forma de llegar.
##
## La ruta la da `WorldQuery.path()`, es decir `NavigationServer3D`. Aquí no
## hay búsqueda de caminos: el legacy tuvo que escribir la suya porque no
## tenía motor (análisis §4.4, con su fallo de relajación incluido); nosotros
## sí lo tenemos.
static func move_along_path(ctx: BehaviorContext, delta: float) -> BehaviorTree.Status:
	if ctx == null or ctx.actuator == null:
		return BehaviorTree.Status.FAILURE
	if not BehaviorContext.is_finite_point(ctx.move_goal):
		return BehaviorTree.Status.FAILURE
	var from := ctx.self_position()
	if not BehaviorContext.is_finite_point(from):
		return BehaviorTree.Status.FAILURE

	var arrival := ctx.actuator.arrival_radius_m()
	if planar_distance(from, ctx.move_goal) <= arrival:
		ctx.actuator.stop()
		return BehaviorTree.Status.SUCCESS

	if ctx.move_path.is_empty():
		if ctx.world == null:
			return BehaviorTree.Status.FAILURE
		ctx.move_path = ctx.world.path(from, ctx.move_goal)
		ctx.move_index = 0
		if ctx.move_path.is_empty():
			# Vacío significa DOS cosas distintas en el contrato actual: "no
			# hay ruta" y "el presupuesto de caminos por frame aún no la ha
			# despachado". Se espera un poco antes de declarar imposible el
			# comportamiento. Ver BehaviorTuning.PATH_WAIT_S.
			ctx.move_wait_s += delta
			if ctx.move_wait_s >= BehaviorTuning.PATH_WAIT_S:
				return BehaviorTree.Status.FAILURE
			return BehaviorTree.Status.RUNNING
		ctx.move_wait_s = 0.0

	while ctx.move_index < ctx.move_path.size() \
			and planar_distance(from, ctx.move_path[ctx.move_index]) <= arrival:
		ctx.move_index += 1
	if ctx.move_index >= ctx.move_path.size():
		ctx.actuator.stop()
		return BehaviorTree.Status.SUCCESS
	ctx.actuator.move_towards(ctx.move_path[ctx.move_index])
	return BehaviorTree.Status.RUNNING


## Pide cobertura al `CoverProvider` y la fija como destino.
##
## FAILURE cuando no hay ningún punto: es la señal que hace que el controlador
## vete TAKE_COVER un rato y el selector elija otra cosa —normalmente
## retirarse—. "No hay dónde cubrirse" tiene que producir una decisión
## distinta, no un bot parado intentándolo cinco veces por segundo.
static func pick_cover(ctx: BehaviorContext, _delta: float) -> BehaviorTree.Status:
	if ctx == null or ctx.cover == null or ctx.state == null:
		return BehaviorTree.Status.FAILURE
	var from := ctx.self_position()
	if not BehaviorContext.is_finite_point(from):
		return BehaviorTree.Status.FAILURE
	if ctx.cover_point != null:
		return BehaviorTree.Status.SUCCESS

	var objective := ctx.objective if BehaviorContext.is_finite_point(ctx.objective) else from
	var points := ctx.cover.query(
		from, ctx.threats, objective, ctx.state.is_crouched, BehaviorTuning.COVER_QUERY_K)
	if points.is_empty():
		ctx.last_cover_query_empty = true
		return BehaviorTree.Status.FAILURE
	ctx.last_cover_query_empty = false
	ctx.cover_point = points[0]
	set_move_goal(ctx, ctx.cover_point.position)
	return BehaviorTree.Status.SUCCESS


## Cobertura para retirarse: la misma consulta, pero el "objetivo" es alejarse
## de la amenaza en lugar de acercarse a ella. Reutiliza la puntuación de
## `CoverProvider` (protección − exposición − coste + progreso) sin duplicar
## una sola línea de ella.
static func pick_retreat_cover(ctx: BehaviorContext, _delta: float) -> BehaviorTree.Status:
	if ctx == null or ctx.state == null:
		return BehaviorTree.Status.FAILURE
	var from := ctx.self_position()
	if not BehaviorContext.is_finite_point(from):
		return BehaviorTree.Status.FAILURE
	if BehaviorContext.is_finite_point(ctx.move_goal):
		return BehaviorTree.Status.SUCCESS

	var away := retreat_direction(ctx, from)
	var fallback := from + away * BehaviorTuning.RETREAT_DISTANCE_M
	if ctx.cover != null:
		var points := ctx.cover.query(
			from, ctx.threats, fallback, ctx.state.is_crouched, BehaviorTuning.COVER_QUERY_K)
		if not points.is_empty():
			ctx.cover_point = points[0]
			set_move_goal(ctx, ctx.cover_point.position)
			return BehaviorTree.Status.SUCCESS

	# Sin cobertura útil se retira igualmente: alejarse sin cubrirse sigue
	# siendo mejor que quedarse. Se proyecta al navmesh para no mandar al bot
	# contra una pared.
	var goal := fallback
	if ctx.world != null:
		var snapped := ctx.world.snap_to_navmesh(fallback)
		if BehaviorContext.is_finite_point(snapped):
			goal = snapped
		else:
			return BehaviorTree.Status.FAILURE
	set_move_goal(ctx, goal)
	return BehaviorTree.Status.SUCCESS


## Dirección de huida: la media de "alejarse de cada amenaza conocida".
static func retreat_direction(ctx: BehaviorContext, from: Vector3) -> Vector3:
	var away := Vector3.ZERO
	for threat: Vector3 in ctx.threats:
		var delta := from - threat
		delta.y = 0.0
		if delta.length_squared() > 0.0001:
			away += delta.normalized()
	if away.length_squared() <= 0.0001 and BehaviorContext.is_finite_point(ctx.rally_point):
		away = ctx.rally_point - from
		away.y = 0.0
	if away.length_squared() <= 0.0001:
		# Sin amenazas conocidas ni punto de reunión, la única dirección
		# defendible es la contraria a donde mira: no hay información mejor.
		away = -ctx.state.forward
		away.y = 0.0
	if away.length_squared() <= 0.0001:
		return Vector3.FORWARD
	return away.normalized()


## Reclama una ruta de flanqueo disjunta en la pizarra y la fija como camino.
##
## Las rutas las calcula `WorldQuery.disjoint_routes()` (RoutePlanner, sobre
## el grafo dual de polígonos del navmesh). Aquí sólo se elige una libre y se
## reclama: "máximo un flanqueador por ruta" es una regla de grupo y se hace
## cumplir en la pizarra, no con buena voluntad.
##
## "Ángulo del objetivo + 90°" no es flanquear: es caminar hacia una pared.
static func claim_flank_route(ctx: BehaviorContext, _delta: float) -> BehaviorTree.Status:
	if ctx == null or ctx.state == null or ctx.world == null:
		return BehaviorTree.Status.FAILURE
	if ctx.claimed_route_id >= 0 and not ctx.move_path.is_empty():
		return BehaviorTree.Status.SUCCESS
	var from := ctx.self_position()
	if not BehaviorContext.is_finite_point(from) or not ctx.has_target():
		return BehaviorTree.Status.FAILURE

	var routes := ctx.world.disjoint_routes(
		from, ctx.target_position, BehaviorTuning.COVER_QUERY_K)
	if routes.is_empty():
		return BehaviorTree.Status.FAILURE
	# La ruta 0 es la directa: flanquear es tomar OTRA.
	for index: int in range(1, routes.size()):
		var route: PackedVector3Array = routes[index]
		if route.is_empty():
			continue
		if ctx.board != null and not ctx.board.claim_route(ctx.state.squad_id, index):
			continue
		ctx.claimed_route_id = index
		ctx.move_path = route
		ctx.move_index = 0
		ctx.move_goal = route[route.size() - 1]
		return BehaviorTree.Status.SUCCESS
	return BehaviorTree.Status.FAILURE


## Suelta la ruta reclamada. Se llama al abortar el flanqueo: si no, la
## escuadra sigue creyendo que alguien está rodeando por ahí y no manda a
## nadie más.
static func release_flank_route(ctx: BehaviorContext) -> void:
	if ctx == null:
		return
	if ctx.claimed_route_id >= 0 and ctx.board != null and ctx.state != null:
		ctx.board.release_routes(ctx.state.squad_id)
	ctx.claimed_route_id = -1
	ctx.move_path = PackedVector3Array()
	ctx.move_index = 0
	stop_moving(ctx)


## Avanza hacia el objetivo conocido.
static func advance_on_target(ctx: BehaviorContext, delta: float) -> BehaviorTree.Status:
	if ctx == null or not ctx.has_target():
		return BehaviorTree.Status.FAILURE
	set_move_goal(ctx, ctx.target_position)
	return move_along_path(ctx, delta)


## Va al punto que hay que investigar.
static func move_to_investigation(ctx: BehaviorContext, delta: float) -> BehaviorTree.Status:
	if ctx == null:
		return BehaviorTree.Status.FAILURE
	var point := ctx.investigation_point()
	if not BehaviorContext.is_finite_point(point):
		return BehaviorTree.Status.FAILURE
	set_move_goal(ctx, point)
	return move_along_path(ctx, delta)


## Va al punto de reunión de la escuadra.
static func move_to_rally(ctx: BehaviorContext, delta: float) -> BehaviorTree.Status:
	if ctx == null or not BehaviorContext.is_finite_point(ctx.rally_point):
		return BehaviorTree.Status.FAILURE
	set_move_goal(ctx, ctx.rally_point)
	return move_along_path(ctx, delta)


## Siguiente punto de patrulla. El legacy elegía el siguiente vértice del
## triángulo al azar (`Enemy.cc:54-55`) y viajaba en línea recta sin A*; aquí
## el recorrido es un ciclo y el camino sale del navmesh.
static func patrol_step(ctx: BehaviorContext, delta: float) -> BehaviorTree.Status:
	if ctx == null or ctx.patrol_points.is_empty():
		return BehaviorTree.Status.FAILURE
	if not BehaviorContext.is_finite_point(ctx.move_goal):
		ctx.patrol_index = ctx.patrol_index % ctx.patrol_points.size()
		set_move_goal(ctx, ctx.patrol_points[ctx.patrol_index])
	var status := move_along_path(ctx, delta)
	if status == BehaviorTree.Status.SUCCESS:
		ctx.patrol_index = (ctx.patrol_index + 1) % ctx.patrol_points.size()
		set_move_goal(ctx, ctx.patrol_points[ctx.patrol_index])
		return BehaviorTree.Status.RUNNING
	return status


## Mantener la posición: quieto, encarado a la amenaza si se conoce.
static func hold_position(ctx: BehaviorContext, _delta: float) -> BehaviorTree.Status:
	if ctx == null or ctx.actuator == null:
		return BehaviorTree.Status.FAILURE
	ctx.actuator.stop()
	if ctx.has_target():
		ctx.actuator.face(ctx.target_position)
	return BehaviorTree.Status.RUNNING


## Seguir al líder: mantenerse cerca del punto de formación que fija
## `ai-escuadra` en `objective`.
static func follow_leader(ctx: BehaviorContext, delta: float) -> BehaviorTree.Status:
	if ctx == null or not BehaviorContext.is_finite_point(ctx.objective):
		return BehaviorTree.Status.FAILURE
	set_move_goal(ctx, ctx.objective)
	var status := move_along_path(ctx, delta)
	if status == BehaviorTree.Status.SUCCESS:
		return BehaviorTree.Status.RUNNING
	return status


## No hacer nada, a la espera de que el selector encuentre algo mejor.
static func idle(ctx: BehaviorContext, _delta: float) -> BehaviorTree.Status:
	if ctx != null and ctx.actuator != null:
		ctx.actuator.stop()
	return BehaviorTree.Status.RUNNING


## Distancia en el plano. La altura no cuenta: los puntos del navmesh quedan
## unos centímetros por encima del suelo y comparar en 3D haría que un bot no
## se diera nunca por llegado.
static func planar_distance(a: Vector3, b: Vector3) -> float:
	var delta := b - a
	delta.y = 0.0
	return delta.length()
