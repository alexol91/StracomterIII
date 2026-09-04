class_name SquadDirector
extends RefCounted
## Director de escuadra: un grupo, una pizarra, un reparto de roles (GDD §8.4).
##
## Sustituye a la nada. El original no tenía coordinación: cada `Enemy`
## corría su FSM de 5 estados por su cuenta (`Enemy.cc:169-205`, análisis
## §5.5) y "escuadra" significaba únicamente que varios enemigos estaban
## cerca. De ahí venía la sensación de pelear contra individuos y no contra
## un grupo.
##
## LO QUE ESTA CLASE HACE CUMPLIR (no sugiere — hace cumplir):
##   1. Un rol por bot, sin duplicar `Fijador`, y como mucho `MAX_FLANKERS`
##      flanqueadores.
##   2. Un flanqueador por ruta, con rutas de navmesh REALMENTE disjuntas
##      pedidas a `WorldQuery.disjoint_routes()` y verificadas antes de
##      usarlas. "Ángulo del objetivo + 90°" no aparece por ninguna parte:
##      eso no es flanquear, es caminar hacia una pared.
##   3. Nadie asalta sin supresión activa de un COMPAÑERO.
##   4. Por debajo del 40 % de efectivos, el grupo se repliega a la sala
##      anterior y se reagrupa, en vez de morir de uno en uno.
##   5. Los ángulos de cobertura se reparten.
##
## POR QUÉ LOS DEFECTOS SON RESTRICTIVOS. Sin `WorldQuery` no hay flanqueo;
## sin rutas verificadas no hay flanqueo; sin supresión no hay asalto; sin
## fijador capaz no hay asalto. Este proyecto ya pagó una vez el precio de un
## defecto permisivo (un `has_line_of_sight` que devolvía `true` sin física, y
## por tanto rayos X para todos los bots, en silencio). La regla general está
## escrita en el contrato de `WorldQuery` y aquí se aplica igual: ante la
## duda, el grupo no asalta y no flanquea.
##
## PUREZA. `assign_roles()` no lee el reloj, ni la pizarra, ni la escena, ni
## `randf()`. Todo lo que necesita entra por parámetros; su única memoria es
## el estado explícito de este objeto (censo, roles previos, pestillo de
## repliegue, migas de pan), que se puede fijar y limpiar desde fuera. Por eso
## el reparto de una escuadra de ocho bots se prueba entero en `--headless` y
## en microsegundos, sin instanciar un solo nodo.
##
## LA PIZARRA ES LA ÚNICA VÍA. Ningún bot lee el estado interno de otro. El
## director escribe roles y reclamaciones de ruta en `Blackboard` mediante
## `publish()`, y cada bot lee de ahí lo suyo. `assign_roles()` no escribe
## nada: separar el cálculo de la publicación es lo que permite comprobar el
## reparto sin efectos secundarios y auditar la pizarra por separado.

## Escuadra que dirige.
var squad_id: int = 0
## Censo inicial del grupo, para calcular la fracción de efectivos. Se ajusta
## solo hacia arriba: si llegan refuerzos el grupo es más grande, pero las
## bajas no reducen el denominador — si lo hicieran, un grupo de ocho reducido
## a dos tendría "100 % de efectivos" y no se replegaría jamás.
var roster_size: int = 0

## Roles del reparto anterior, para la histéresis.
var _previous_roles: Dictionary[int, Blackboard.Role] = {}
## Pestillo del repliegue: una vez disparado no se suelta hasta que el grupo
## se reagrupa o recupera efectivos por encima de `REGROUP_EXIT_RATIO`.
var _retreat_latched: bool = false
## Salas por las que ha pasado el grupo, de la más antigua a la más reciente.
## La "sala anterior" del GDD §8.4 es la penúltima.
var _breadcrumbs: Array[Vector3] = []


func _init(p_squad_id: int = 0, p_roster_size: int = 0) -> void:
	squad_id = p_squad_id
	roster_size = p_roster_size


## Olvida toda la memoria del director. Las pruebas de determinismo lo usan
## para comprobar que dos directores recién creados con las mismas entradas
## producen exactamente el mismo reparto.
func reset() -> void:
	_previous_roles.clear()
	_retreat_latched = false
	_breadcrumbs.clear()


# ---------------------------------------------------------------------------
# Migas de pan: por dónde se repliega el grupo
# ---------------------------------------------------------------------------

## Registra que el grupo ha entrado en una sala nueva. Lo llama quien mueve al
## grupo por el nivel (director de encuentros o el propio generador). No se
## deduce de las posiciones de los bots a propósito: "sala anterior" es un
## concepto de nivel, no de geometría, y adivinarlo produce repliegues hacia
## el pasillo por el que viene el jugador.
func push_room_anchor(position: Vector3) -> void:
	if not _breadcrumbs.is_empty() and _breadcrumbs[_breadcrumbs.size() - 1].is_equal_approx(position):
		return
	_breadcrumbs.append(position)
	while _breadcrumbs.size() > SquadTuning.BREADCRUMB_CAPACITY:
		_breadcrumbs.remove_at(0)


## El grupo ha llegado al punto de reagrupamiento: suelta el pestillo.
func mark_regrouped() -> void:
	_retreat_latched = false


func is_retreating() -> bool:
	return _retreat_latched


# ---------------------------------------------------------------------------
# Reparto de roles — función pura
# ---------------------------------------------------------------------------

## Reparte roles. `(estados, contactos) -> asignación`.
##
## `suppression_active` y `world` llevan defecto RESTRICTIVO: sin ellos no hay
## asalto y no hay flanqueo. Quien llame de verdad pasa
## `Blackboard.has_active_suppression(squad_id)` y el `WorldQuery` del nivel.
func assign_roles(
	states: Array[BotState],
	contacts: Array[Blackboard.Contact],
	suppression_active: bool = false,
	world: WorldQuery = null
) -> SquadRoleAssignment:
	var out := SquadRoleAssignment.new()
	out.squad_id = squad_id
	out.suppression_active = suppression_active

	var alive := _alive_sorted(states)
	roster_size = maxi(roster_size, alive.size())
	out.strength_ratio = _strength(alive.size())

	if alive.is_empty():
		_previous_roles.clear()
		return out

	var target := _best_contact(contacts)
	if target != null:
		out.has_target = true
		out.target_id = target.target_id
		out.target_position = target.last_known_position

	var anchor := _centroid(alive)

	# --- Regla 4: por debajo del 40 % de efectivos, repliegue. ---
	if _update_retreat_latch(out.strength_ratio):
		out.retreating = true
		out.rally_point = _rally_point(anchor, out.target_position, out.has_target, world)
		out.flank_veto_reason = &"repliegue"
		out.assault_veto_reason = &"repliegue"
		for state: BotState in alive:
			out.roles[state.bot_id] = Blackboard.Role.RESERVE
			out.allowed[state.bot_id] = _allowed_retreating()
		_assign_watch_angles(out, alive, anchor)
		_previous_roles = out.roles.duplicate()
		return out

	# Sin contacto fiable no hay a quién fijar, rodear ni asaltar.
	if not out.has_target:
		out.flank_veto_reason = &"sin_contacto"
		out.assault_veto_reason = &"sin_contacto"
		for state: BotState in alive:
			out.roles[state.bot_id] = Blackboard.Role.RESERVE
			out.allowed[state.bot_id] = _allowed_searching()
		_assign_watch_angles(out, alive, anchor)
		_previous_roles = out.roles.duplicate()
		return out

	# --- Regla 2: rutas de flanqueo realmente disjuntas. ---
	var flank_routes := _usable_flank_routes(out, anchor, out.target_position, alive.size(), world)

	var unassigned := alive.duplicate()

	# --- Regla 1: un Fijador, y solo uno. La presión frontal es lo primero
	# que se cubre: sin ella, ni el flanqueo ni el asalto significan nada. ---
	var pinner := _take_best(unassigned, _pin_score)
	if pinner != null:
		out.roles[pinner.bot_id] = Blackboard.Role.PINNER

	# --- Flanqueadores: uno por ruta, nunca dos en la misma. ---
	var max_flankers := mini(flank_routes.size(), SquadTuning.MAX_FLANKERS)
	max_flankers = mini(max_flankers, _flanker_capacity(alive.size()))
	max_flankers = mini(max_flankers, unassigned.size())
	for i in max_flankers:
		var flanker := _take_best(unassigned, _flank_score)
		if flanker == null:
			break
		var route_id: int = flank_routes[i]
		out.roles[flanker.bot_id] = Blackboard.Role.FLANKER
		out.routes[flanker.bot_id] = route_id

	# --- Regla 3: nadie asalta sin supresión activa de un compañero. ---
	var assault_slots := _assault_slots(out, pinner, suppression_active, unassigned.size())
	for _i in assault_slots:
		var assaulter := _take_best(unassigned, _assault_score)
		if assaulter == null:
			break
		out.roles[assaulter.bot_id] = Blackboard.Role.ASSAULTER

	for state: BotState in unassigned:
		out.roles[state.bot_id] = Blackboard.Role.RESERVE

	for state: BotState in alive:
		out.allowed[state.bot_id] = _allowed_for(
			out.role_of(state.bot_id), out.route_of(state.bot_id) >= 0, suppression_active
		)

	# --- Regla 5: los ángulos de cobertura se reparten. ---
	_assign_watch_angles(out, alive, anchor)

	_previous_roles = out.roles.duplicate()
	return out


# ---------------------------------------------------------------------------
# Publicación en la pizarra
# ---------------------------------------------------------------------------

## Escribe el reparto en `Blackboard`. Es el ÚNICO punto de este módulo que
## toca estado global, y va aparte de `assign_roles()` a propósito.
##
## Las reclamaciones de ruta se sueltan y se rehacen en cada publicación: la
## pizarra no tiene "soltar una ruta", solo `release_routes(squad_id)`, y sin
## esta limpieza la segunda publicación del mismo grupo no podría reclamar
## nada y el flanqueo desaparecería tras el primer tick.
##
## Si una reclamación falla —dos flanqueadores en la misma ruta—, el segundo
## se degrada a RESERVA y se le retira el permiso de flanquear. La regla se
## hace cumplir aunque el cálculo se haya equivocado; no se confía en que el
## cálculo sea correcto solo porque lo hayamos escrito nosotros.
func publish(assignment: SquadRoleAssignment) -> void:
	Blackboard.release_routes(assignment.squad_id)
	for bot_id: int in assignment.routes.keys():
		var route_id: int = assignment.routes[bot_id]
		if Blackboard.claim_route(assignment.squad_id, route_id):
			continue
		push_error(
			"SquadDirector: ruta %d ya reclamada en la escuadra %d; el bot %d pasa a RESERVA."
			% [route_id, assignment.squad_id, bot_id]
		)
		assignment.routes.erase(bot_id)
		assignment.roles[bot_id] = Blackboard.Role.RESERVE
		assignment.allowed[bot_id] = _allowed_for(
			Blackboard.Role.RESERVE, false, assignment.suppression_active
		)
	for bot_id: int in assignment.roles:
		Blackboard.set_role(bot_id, assignment.role_of(bot_id))


# ---------------------------------------------------------------------------
# Efectivos y repliegue
# ---------------------------------------------------------------------------

func _strength(alive_count: int) -> float:
	if roster_size <= 0:
		return 1.0
	return clampf(float(alive_count) / float(roster_size), 0.0, 1.0)


## Devuelve si el grupo debe replegarse, aplicando histéresis. Entra por
## debajo de `RETREAT_STRENGTH_RATIO` y no sale hasta superar
## `REGROUP_EXIT_RATIO` (o hasta que alguien llame a `mark_regrouped()`).
func _update_retreat_latch(strength: float) -> bool:
	if strength < SquadTuning.RETREAT_STRENGTH_RATIO:
		_retreat_latched = true
	elif strength >= SquadTuning.REGROUP_EXIT_RATIO:
		_retreat_latched = false
	return _retreat_latched


## Punto de reagrupamiento: la sala anterior. Se recorren las migas de la más
## reciente a la más antigua y se coge la primera que esté lo bastante lejos
## de la amenaza; retroceder a una sala que el enemigo ya bate no es
## replegarse.
##
## Si no hay ninguna miga utilizable se genera un punto de emergencia
## alejándose del contacto y se PROYECTA al navmesh. Si la proyección falla,
## se devuelve el propio centroide del grupo: reagruparse donde ya se está es
## peor que replegarse, pero es mejor que mandar a cuatro bots a un punto que
## no existe sobre la malla.
func _rally_point(
	anchor: Vector3, threat: Vector3, has_threat: bool, world: WorldQuery
) -> Vector3:
	for i in range(_breadcrumbs.size() - 1, -1, -1):
		var candidate := _breadcrumbs[i]
		if candidate.is_equal_approx(anchor):
			continue
		if not has_threat:
			return candidate
		if candidate.distance_to(threat) >= SquadTuning.RALLY_MIN_DISTANCE_M:
			return candidate
	var away := Vector3.ZERO
	if has_threat:
		away = anchor - threat
		away.y = 0.0
	if away.length_squared() < 0.0001:
		return anchor
	var emergency := anchor + away.normalized() * SquadTuning.RALLY_FALLBACK_DISTANCE_M
	if world == null:
		return emergency
	var snapped := world.snap_to_navmesh(emergency)
	if is_inf(snapped.x):
		return anchor
	return snapped


# ---------------------------------------------------------------------------
# Rutas de flanqueo
# ---------------------------------------------------------------------------

## Ids de las rutas utilizables para flanquear (índices en el array que
## devuelve `WorldQuery.disjoint_routes`, que es lo que se reclama en la
## pizarra). Nunca incluye la 0: esa es la aproximación frontal del Fijador.
##
## Una ruta solo entra si:
##   * existe y tiene al menos dos puntos,
##   * LLEGA al objetivo (una ruta parcial manda al flanqueador contra una
##     pared, y el motor devuelve rutas parciales de verdad),
##   * es lo bastante larga para rodear algo,
##   * y no comparte tramo con ninguna ruta ya aceptada, verificado con
##     `RoutePlanner.routes_share_segment` — el mismo criterio con el que
##     `ai/navegacion` construye la garantía, aplicado aquí otra vez porque
##     confiar en el proveedor sin comprobar es exactamente cómo se cuela un
##     flanqueo que no flanquea.
func _usable_flank_routes(
	out: SquadRoleAssignment,
	anchor: Vector3,
	target: Vector3,
	alive_count: int,
	world: WorldQuery
) -> PackedInt32Array:
	var usable := PackedInt32Array()
	if world == null:
		out.flank_veto_reason = &"sin_consulta_de_mundo"
		return usable
	var wanted := 1 + mini(SquadTuning.MAX_FLANKERS, _flanker_capacity(alive_count))
	if wanted < 2:
		out.flank_veto_reason = &"grupo_demasiado_pequeno"
		return usable
	var routes := world.disjoint_routes(anchor, target, wanted)
	if routes.size() < 2:
		out.flank_veto_reason = &"sin_rutas_alternativas"
		return usable
	if not _route_is_complete(routes[0], target):
		# Si ni la aproximación frontal llega, la geometría que ha devuelto el
		# navmesh no describe este combate. No se flanquea a ciegas.
		out.flank_veto_reason = &"ruta_frontal_parcial"
		return usable

	var accepted: Array[PackedVector3Array] = [routes[0]]
	out.route_paths[0] = routes[0]
	for i in range(1, routes.size()):
		var route := routes[i]
		if not _route_is_complete(route, target):
			out.flank_veto_reason = &"ruta_parcial"
			continue
		if _polyline_length(route) < SquadTuning.ROUTE_MIN_LENGTH_M:
			out.flank_veto_reason = &"ruta_demasiado_corta"
			continue
		var overlaps := false
		for previous: PackedVector3Array in accepted:
			if RoutePlanner.routes_share_segment(route, previous):
				overlaps = true
				break
		if overlaps:
			out.flank_veto_reason = &"rutas_no_disjuntas"
			continue
		accepted.append(route)
		out.route_paths[i] = route
		usable.append(i)
	if not usable.is_empty():
		out.flank_veto_reason = &""
	return usable


func _route_is_complete(route: PackedVector3Array, target: Vector3) -> bool:
	if route.size() < 2:
		return false
	var last := route[route.size() - 1]
	return last.distance_to(target) <= SquadTuning.ROUTE_ARRIVAL_TOLERANCE_M


static func _polyline_length(route: PackedVector3Array) -> float:
	var total := 0.0
	for i in range(1, route.size()):
		total += route[i - 1].distance_to(route[i])
	return total


# ---------------------------------------------------------------------------
# Asalto
# ---------------------------------------------------------------------------

## Cuántos asaltantes se pueden nombrar.
##
## Hacen falta DOS cosas, no una: la marca de supresión de la pizarra y un
## Fijador que de verdad pueda sostenerla (con línea de visión y munición).
## El GDD dice "supresión activa DE UN COMPAÑERO", y la marca de la pizarra
## por sí sola no dice de quién es —`Blackboard.mark_suppression()` no guarda
## el id del que suprime—, así que la condición del compañero se comprueba
## por el rol. Si `mark_suppression` llegara a guardar el emisor, esta
## comprobación se puede sustituir por la directa.
func _assault_slots(
	out: SquadRoleAssignment, pinner: BotState, suppression_active: bool, remaining: int
) -> int:
	if not suppression_active:
		out.assault_veto_reason = &"sin_supresion"
		return 0
	if pinner == null:
		out.assault_veto_reason = &"sin_fijador"
		return 0
	if not pinner.has_line_of_sight:
		out.assault_veto_reason = &"fijador_sin_vision"
		return 0
	if pinner.ammo_ratio <= SquadTuning.MIN_USEFUL_AMMO_RATIO:
		out.assault_veto_reason = &"fijador_sin_municion"
		return 0
	if remaining <= 0:
		out.assault_veto_reason = &"sin_efectivos_libres"
		return 0
	out.assault_veto_reason = &""
	return mini(SquadTuning.MAX_ASSAULTERS, remaining)


# ---------------------------------------------------------------------------
# Puntuaciones de rol
# ---------------------------------------------------------------------------

## Saca de `pool` el mejor candidato según `scorer` y lo devuelve. Desempate
## por `bot_id` ascendente: sin él, dos bots idénticos producirían repartos
## distintos según el orden de llegada del array, y la prueba de determinismo
## fallaría una vez de cada cien.
func _take_best(pool: Array[BotState], scorer: Callable) -> BotState:
	if pool.is_empty():
		return null
	var best_index := -1
	var best_score := -INF
	for i in pool.size():
		var state := pool[i]
		var score: float = scorer.call(state)
		if score > best_score:
			best_score = score
			best_index = i
	var chosen := pool[best_index]
	pool.remove_at(best_index)
	return chosen


func _hysteresis(state: BotState, role: Blackboard.Role) -> float:
	if _previous_roles.get(state.bot_id, Blackboard.Role.NONE) == role:
		return SquadTuning.ROLE_HYSTERESIS_BONUS
	return 0.0


func _normalized_distance(state: BotState) -> float:
	if is_inf(state.distance_to_target_m):
		return 1.0
	return clampf(state.distance_to_target_m / SquadTuning.REFERENCE_DISTANCE_M, 0.0, 1.0)


## El Fijador quiere ver al objetivo, desde cobertura y con munición.
func _pin_score(state: BotState) -> float:
	var score := 0.0
	score += SquadTuning.PIN_W_LINE_OF_SIGHT * (1.0 if state.has_line_of_sight else 0.0)
	score += SquadTuning.PIN_W_IN_COVER * (1.0 if state.in_cover else 0.0)
	score += SquadTuning.PIN_W_AMMO * state.ammo_ratio
	score += SquadTuning.PIN_W_HEALTH * state.health_ratio
	score -= SquadTuning.PIN_W_DISTANCE * _normalized_distance(state)
	return score + _hysteresis(state, Blackboard.Role.PINNER)


## El Flanqueador quiere estar entero, con munición y LIBRE. El que ya está
## intercambiando fuego no puede irse a rodear: si se va, la presión frontal
## desaparece y el flanqueo llega a un objetivo que ya se ha movido.
func _flank_score(state: BotState) -> float:
	var score := 0.0
	score += SquadTuning.FLANK_W_HEALTH * state.health_ratio
	score += SquadTuning.FLANK_W_AMMO * state.ammo_ratio
	score += SquadTuning.FLANK_W_UNEXPOSED * (1.0 - clampf(state.exposure, 0.0, 1.0))
	score += SquadTuning.FLANK_W_FREE_OF_CONTACT * (0.0 if state.has_line_of_sight else 1.0)
	return score + _hysteresis(state, Blackboard.Role.FLANKER)


## El Asaltante quiere estar entero, con munición y ya cerca.
func _assault_score(state: BotState) -> float:
	var score := 0.0
	score += SquadTuning.ASSAULT_W_HEALTH * state.health_ratio
	score += SquadTuning.ASSAULT_W_AMMO * state.ammo_ratio
	score += SquadTuning.ASSAULT_W_PROXIMITY * (1.0 - _normalized_distance(state))
	return score + _hysteresis(state, Blackboard.Role.ASSAULTER)


# ---------------------------------------------------------------------------
# Comportamientos permitidos
# ---------------------------------------------------------------------------

## Lo que puede hacer un bot según su rol. Es el contrato que `ai/behavior`
## debe respetar: elige DENTRO de esta lista, no fuera.
func _allowed_for(
	role: Blackboard.Role, has_route: bool, suppression_active: bool
) -> PackedInt32Array:
	match role:
		Blackboard.Role.PINNER:
			return PackedInt32Array([
				BehaviorKind.Kind.SUPPRESS,
				BehaviorKind.Kind.ATTACK,
				BehaviorKind.Kind.TAKE_COVER,
				BehaviorKind.Kind.RELOAD,
			])
		Blackboard.Role.FLANKER:
			# FLANK solo si hay ruta reclamada. Un flanqueador sin ruta es un
			# bot corriendo en diagonal hacia una pared.
			if not has_route:
				return _allowed_reserve()
			return PackedInt32Array([
				BehaviorKind.Kind.FLANK,
				BehaviorKind.Kind.ATTACK,
				BehaviorKind.Kind.TAKE_COVER,
				BehaviorKind.Kind.RELOAD,
			])
		Blackboard.Role.ASSAULTER:
			if not suppression_active:
				return _allowed_reserve()
			return PackedInt32Array([
				BehaviorKind.Kind.ASSAULT,
				BehaviorKind.Kind.ATTACK,
				BehaviorKind.Kind.TAKE_COVER,
				BehaviorKind.Kind.RELOAD,
			])
		_:
			return _allowed_reserve()


func _allowed_reserve() -> PackedInt32Array:
	return PackedInt32Array([
		BehaviorKind.Kind.TAKE_COVER,
		BehaviorKind.Kind.ATTACK,
		BehaviorKind.Kind.RELOAD,
		BehaviorKind.Kind.REGROUP,
		BehaviorKind.Kind.INVESTIGATE,
	])


func _allowed_retreating() -> PackedInt32Array:
	return PackedInt32Array([
		BehaviorKind.Kind.RETREAT,
		BehaviorKind.Kind.REGROUP,
		BehaviorKind.Kind.TAKE_COVER,
		BehaviorKind.Kind.RELOAD,
	])


func _allowed_searching() -> PackedInt32Array:
	return PackedInt32Array([
		BehaviorKind.Kind.PATROL,
		BehaviorKind.Kind.INVESTIGATE,
		BehaviorKind.Kind.TAKE_COVER,
		BehaviorKind.Kind.RELOAD,
		BehaviorKind.Kind.IDLE,
	])


# ---------------------------------------------------------------------------
# Reparto de ángulos de cobertura (GDD §8.4)
# ---------------------------------------------------------------------------

## Reparte hacia dónde mira cada bot.
##
## Un grupo entero mirando al mismo sitio es un grupo al que se rodea andando.
## El reparto no es cosmético: es lo que hace que acercarse por detrás cueste,
## y es una decisión de GRUPO, así que la toma el director y no cada bot.
##
##   * Fijador y asaltantes cubren el objetivo, en abanico estrecho: siguen
##     mirando al vano, pero no exactamente al mismo píxel.
##   * Cada flanqueador mira hacia donde va, a lo largo de su ruta.
##   * La reserva se reparte el arco que queda, el que nadie vigila.
##   * Sin nadie en contacto (repliegue, o grupo a ciegas) el reparto es el
##     círculo entero.
func _assign_watch_angles(
	out: SquadRoleAssignment, alive: Array[BotState], anchor: Vector3
) -> void:
	var engaged := PackedInt32Array()
	var flankers := PackedInt32Array()
	var reserves := PackedInt32Array()
	for state: BotState in alive:
		match out.role_of(state.bot_id):
			Blackboard.Role.PINNER, Blackboard.Role.ASSAULTER:
				engaged.append(state.bot_id)
			Blackboard.Role.FLANKER:
				flankers.append(state.bot_id)
			_:
				reserves.append(state.bot_id)

	var base := 0.0
	if out.has_target:
		base = _bearing(anchor, out.target_position)
	elif not alive.is_empty():
		var forward := alive[0].forward
		base = atan2(forward.z, forward.x) if forward.length_squared() > 0.0 else 0.0

	var fan := SquadTuning.ENGAGED_FAN_RAD
	for i in engaged.size():
		var offset := 0.0
		if engaged.size() > 1:
			offset = -fan + 2.0 * fan * float(i) / float(engaged.size() - 1)
		out.watch_yaw[engaged[i]] = wrapf(base + offset, -PI, PI)

	for i in flankers.size():
		var bot_id := flankers[i]
		var state := _state_of(alive, bot_id)
		var route := out.path_of_route(out.route_of(bot_id))
		var yaw := _route_bearing(state, route)
		if is_inf(yaw):
			# Sin ruta legible, el flanqueador cubre un borde del abanico.
			var side := 1.0 if (i % 2) == 0 else -1.0
			yaw = base + side * (fan + SquadTuning.RESERVE_ARC_MARGIN_RAD)
		out.watch_yaw[bot_id] = wrapf(yaw, -PI, PI)

	if reserves.is_empty():
		return
	if engaged.is_empty():
		# Nadie en contacto: círculo completo. El primero cubre la amenaza
		# conocida (o el frente del grupo) y el resto se reparte el resto.
		for i in reserves.size():
			out.watch_yaw[reserves[i]] = wrapf(
				base + TAU * float(i) / float(reserves.size()), -PI, PI
			)
		return
	# Arco complementario: lo que el abanico de combate no cubre.
	var margin := fan + SquadTuning.RESERVE_ARC_MARGIN_RAD
	var arc := TAU - 2.0 * margin
	for i in reserves.size():
		var t := (float(i) + 0.5) / float(reserves.size())
		out.watch_yaw[reserves[i]] = wrapf(base + margin + arc * t, -PI, PI)


static func _bearing(from: Vector3, to: Vector3) -> float:
	var d := to - from
	d.y = 0.0
	if d.length_squared() < 0.0001:
		return 0.0
	return atan2(d.z, d.x)


## Rumbo del siguiente tramo de la ruta, o INF si la ruta no dice nada útil.
static func _route_bearing(state: BotState, route: PackedVector3Array) -> float:
	if state == null or route.size() < 2:
		return INF
	for i in route.size():
		var point := route[i]
		var d := point - state.position
		d.y = 0.0
		if d.length_squared() >= SquadTuning.ROUTE_LOOKAHEAD_M * SquadTuning.ROUTE_LOOKAHEAD_M:
			return atan2(d.z, d.x)
	return INF


static func _state_of(alive: Array[BotState], bot_id: int) -> BotState:
	for state: BotState in alive:
		if state.bot_id == bot_id:
			return state
	return null


# ---------------------------------------------------------------------------
# Entradas
# ---------------------------------------------------------------------------

## Bots vivos, ordenados por `bot_id`. El orden es la base del determinismo:
## el reparto no puede depender de en qué orden le lleguen los estados.
func _alive_sorted(states: Array[BotState]) -> Array[BotState]:
	var out: Array[BotState] = []
	for state: BotState in states:
		if state != null and state.health_ratio > 0.0:
			out.append(state)
	out.sort_custom(func(a: BotState, b: BotState) -> bool: return a.bot_id < b.bot_id)
	return out


## Contacto de mayor confianza por encima del umbral. Con dos contactos
## empatados gana el de menor `target_id`, otra vez por determinismo.
func _best_contact(contacts: Array[Blackboard.Contact]) -> Blackboard.Contact:
	var best: Blackboard.Contact = null
	for c: Blackboard.Contact in contacts:
		if c == null or c.confidence < SquadTuning.MIN_TARGET_CONFIDENCE:
			continue
		if best == null:
			best = c
			continue
		if c.confidence > best.confidence:
			best = c
		elif is_equal_approx(c.confidence, best.confidence) and c.target_id < best.target_id:
			best = c
	return best


static func _centroid(alive: Array[BotState]) -> Vector3:
	var sum := Vector3.ZERO
	for state: BotState in alive:
		sum += state.position
	return sum / float(alive.size())


## Cuántos flanqueadores admite un grupo de este tamaño. Con dos bots, uno
## rodea y otro fija: mandar a los dos a rodear deja el frente vacío y el
## objetivo se limita a andar hacia el hueco.
static func _flanker_capacity(alive_count: int) -> int:
	return floori(float(alive_count) / float(SquadTuning.BOTS_PER_FLANKER))
