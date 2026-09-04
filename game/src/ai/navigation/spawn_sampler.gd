class_name SpawnSampler
extends RefCounted
## Muestreo de puntos de aparición JUSTOS para el director (GDD §7).
##
## Reglas del legacy, y por qué no se repiten: `Optimization::CargarEnemigos`
## tomaba incentros de triángulos de área ≥ 2000 px² a más de **200 px** del
## jugador (`Optimization.cc:144,152`). 200 unidades son 2,7 m a la escala del
## remake: los enemigos aparecían literalmente en la cara del jugador, y a
## veces dentro de su cono de visión. Eso no es dificultad, es tramposo.
##
## Aquí un punto sólo vale si:
##   1. es navegable,
##   2. está a ≥ 12 m del jugador en línea recta Y en distancia de camino,
##   3. NO está dentro del cono de visión del jugador,
##   4. NO tiene línea de visión directa con el jugador,
##   5. está a distancia de camino alcanzable (no al otro lado del mapa).
##
## Y el reparto se pondera por **distancia de camino**, no euclídea: dos
## puntos a 15 m en línea recta no son igual de buenos si a uno se llega por
## la puerta de al lado y al otro dando la vuelta a la planta.
##
## HERENCIA: cuando `res://src/director/spawn_point_provider.gd` exista, esta
## clase debe pasar a `extends SpawnPointProvider`. La API de abajo
## (`sample`, `is_fair`, `rejection_reason`) está pensada para encajar en ella
## sin cambios de firma. Ver el informe al arquitecto.

const Tuning := preload("res://src/ai/navigation/nav_tuning.gd")
const Sampler := preload("res://src/ai/navigation/navmesh_sampler.gd")

## Separación de la rejilla de candidatos. Más gruesa que la de cobertura:
## aquí no hace falta resolución fina, hace falta cubrir el mapa.
const CANDIDATE_SPACING_M: float = 3.0
## Tope de consultas de camino por lote. El coste de camino es caro y esto es
## una operación del director, no de un bot: se acota explícitamente en lugar
## de gastar el presupuesto por frame de ADR-002.
const MAX_PATH_QUERIES_PER_BATCH: int = 32

## Motivos de descarte. Los devuelve `rejection_reason` para que las pruebas
## digan QUÉ regla se ha roto y no sólo que algo falló.
enum Rejection {
	NONE,
	TOO_CLOSE,
	IN_VIEW_CONE,
	HAS_LINE_OF_SIGHT,
	UNREACHABLE,
	TOO_FAR,
}


## Un punto candidato con su peso.
class Candidate:
	extends RefCounted

	var position: Vector3 = Vector3.ZERO
	var path_distance_m: float = INF
	var weight: float = 0.0
	## true si el punto está en un acceso real (puerta, escalera, ascensor).
	var is_access: bool = false


var _nav: NavService = null
var _world: WorldQuery = null
var _candidates: PackedVector3Array = PackedVector3Array()
var _access_points: PackedVector3Array = PackedVector3Array()

## Candidatos descartados por cada motivo en el último `sample`. Telemetría
## para la consola: si el director se queda sin sitios, esto dice por qué.
var stat_rejections: Dictionary[Rejection, int] = {}


func setup(nav: NavService, world: WorldQuery = null) -> void:
	_nav = nav
	_world = world if world != null else nav


## Construye el conjunto de candidatos a partir del navmesh del nivel.
func build_candidates(mesh: NavigationMesh,
		spacing_m: float = CANDIDATE_SPACING_M) -> int:
	_candidates = Sampler.sample_grid(mesh, spacing_m)
	return _candidates.size()


func candidate_count() -> int:
	return _candidates.size()


## Accesos reales del mapa: puertas, huecos de escalera, ascensores. Un
## enemigo que sale por una puerta se lee como refuerzo; uno que se
## materializa en medio de una sala se lee como un fallo del motor.
func set_access_points(points: PackedVector3Array) -> void:
	_access_points = points


func access_point_count() -> int:
	return _access_points.size()


## Recoge los accesos de una escena de mapa. Acepta la estructura del
## conversor (`Doors/Door_N` como `Marker3D` con `metadata/type = "door"`) y
## cualquier nodo `DoorNavLink`.
static func collect_access_points(root: Node) -> PackedVector3Array:
	var out := PackedVector3Array()
	if root == null:
		return out
	var pending: Array[Node] = [root]
	while not pending.is_empty():
		var node: Node = pending.pop_back()
		for child: Node in node.get_children():
			pending.append(child)
		var link := node as DoorNavLink
		if link != null:
			out.append(link.global_position)
			continue
		var marker := node as Node3D
		if marker == null:
			continue
		if not marker.has_meta(&"type"):
			continue
		var kind := StringName(str(marker.get_meta(&"type")))
		if kind == &"door" or kind == &"stairs" or kind == &"elevator":
			out.append(marker.global_position)
	return out


# ---------------------------------------------------------------------------
# Muestreo
# ---------------------------------------------------------------------------

## Devuelve hasta `count` posiciones de aparición justas, sin repetir zona.
func sample(count: int, player_position: Vector3, player_forward: Vector3,
		rng: RandomNumberGenerator = null) -> PackedVector3Array:
	var out := PackedVector3Array()
	stat_rejections = {}
	if count <= 0 or _candidates.is_empty() or _nav == null:
		return out
	var generator := rng if rng != null else RandomNumberGenerator.new()

	var pool := _viable_candidates(player_position, player_forward, generator)
	if pool.is_empty():
		return out

	for _i in count:
		var chosen := _pick_weighted(pool, generator)
		if chosen < 0:
			break
		out.append(pool[chosen].position)
		# Un lote de refuerzos no aparece todo en el mismo metro cuadrado.
		var picked := pool[chosen].position
		var filtered: Array[Candidate] = []
		for c: Candidate in pool:
			if c.position.distance_to(picked) >= Tuning.SPAWN_MIN_SEPARATION_M:
				filtered.append(c)
		pool = filtered
		if pool.is_empty():
			break
	return out


## ¿Cumple este punto todas las reglas de justicia?
func is_fair(position: Vector3, player_position: Vector3,
		player_forward: Vector3) -> bool:
	return rejection_reason(position, player_position, player_forward) == Rejection.NONE


## Primer motivo por el que un punto no vale, o NONE si vale.
func rejection_reason(position: Vector3, player_position: Vector3,
		player_forward: Vector3) -> Rejection:
	if position.distance_to(player_position) < Tuning.SPAWN_MIN_PLAYER_DISTANCE_M:
		return Rejection.TOO_CLOSE
	if is_inside_view_cone(position, player_position, player_forward):
		return Rejection.IN_VIEW_CONE
	if _has_line_of_sight_to_player(position, player_position):
		return Rejection.HAS_LINE_OF_SIGHT
	var cost := _path_distance(player_position, position)
	if is_inf(cost):
		return Rejection.UNREACHABLE
	if cost < Tuning.SPAWN_MIN_PLAYER_DISTANCE_M:
		return Rejection.TOO_CLOSE
	if cost > Tuning.SPAWN_MAX_PATH_DISTANCE_M:
		return Rejection.TOO_FAR
	return Rejection.NONE


## Cono de visión del jugador, en el plano horizontal. Deliberadamente más
## ancho que el FOV de la cámara: aparecer justo fuera del encuadre y entrar
## en él medio segundo después se lee igual de tramposo que aparecer dentro.
static func is_inside_view_cone(position: Vector3, player_position: Vector3,
		player_forward: Vector3) -> bool:
	var to_point := position - player_position
	to_point.y = 0.0
	if to_point.length_squared() < 0.0001:
		return true
	var forward := player_forward
	forward.y = 0.0
	if forward.length_squared() < 0.0001:
		return false
	var angle := rad_to_deg(forward.normalized().angle_to(to_point.normalized()))
	return angle <= Tuning.SPAWN_PLAYER_CONE_HALF_ANGLE_DEG


func _viable_candidates(player_position: Vector3, player_forward: Vector3,
		rng: RandomNumberGenerator) -> Array[Candidate]:
	var out: Array[Candidate] = []
	# Filtros baratos primero (distancia, cono, visión); el coste de camino,
	# que es el caro, sólo para los que ya han pasado.
	var cheap: Array[Vector3] = []
	for position: Vector3 in _candidates:
		if position.distance_to(player_position) < Tuning.SPAWN_MIN_PLAYER_DISTANCE_M:
			_reject(Rejection.TOO_CLOSE)
			continue
		if is_inside_view_cone(position, player_position, player_forward):
			_reject(Rejection.IN_VIEW_CONE)
			continue
		if _has_line_of_sight_to_player(position, player_position):
			_reject(Rejection.HAS_LINE_OF_SIGHT)
			continue
		cheap.append(position)
	if cheap.is_empty():
		return out

	# Barajar antes de recortar: si no, el tope de consultas siempre miraría
	# la misma esquina del mapa (la primera de la rejilla).
	_shuffle(cheap, rng)
	var budget := mini(cheap.size(), MAX_PATH_QUERIES_PER_BATCH)
	for i in budget:
		var position := cheap[i]
		var cost := _path_distance(player_position, position)
		if is_inf(cost):
			_reject(Rejection.UNREACHABLE)
			continue
		if cost < Tuning.SPAWN_MIN_PLAYER_DISTANCE_M:
			_reject(Rejection.TOO_CLOSE)
			continue
		if cost > Tuning.SPAWN_MAX_PATH_DISTANCE_M:
			_reject(Rejection.TOO_FAR)
			continue
		var candidate := Candidate.new()
		candidate.position = position
		candidate.path_distance_m = cost
		candidate.is_access = _is_access(position)
		# Ponderación por distancia de CAMINO: cuanto más lejos por el
		# navmesh, menos probable, porque el refuerzo tarda más en llegar y
		# el encuentro se muere de aburrimiento esperándolo.
		var closeness := Tuning.SPAWN_MAX_PATH_DISTANCE_M - cost
		candidate.weight = maxf(closeness, 0.01)
		if candidate.is_access:
			candidate.weight *= Tuning.SPAWN_ACCESS_POINT_BONUS
		out.append(candidate)
	return out


func _is_access(position: Vector3) -> bool:
	for access: Vector3 in _access_points:
		if access.distance_to(position) <= Tuning.SPAWN_ACCESS_RADIUS_M:
			return true
	return false


func _has_line_of_sight_to_player(position: Vector3,
		player_position: Vector3) -> bool:
	if _world == null:
		return false
	var eye := player_position + Vector3.UP * Tuning.SPAWN_EYE_HEIGHT_M
	var target := position + Vector3.UP * Tuning.SPAWN_EYE_HEIGHT_M
	return _world.has_line_of_sight(eye, target, Tuning.WORLD_COLLISION_MASK)


## Distancia de camino, no euclídea. Se pide directamente al servicio: el
## muestreo de aparición es una operación del director, no de un bot, y no
## debe competir por el techo de 4 peticiones por frame. Lo que la acota es
## `MAX_PATH_QUERIES_PER_BATCH`.
func _path_distance(from: Vector3, to: Vector3) -> float:
	if _nav == null:
		return INF
	return _nav.path_cost_immediate(from, to)


func _reject(reason: Rejection) -> void:
	stat_rejections[reason] = stat_rejections.get(reason, 0) + 1


static func _pick_weighted(pool: Array[Candidate],
		rng: RandomNumberGenerator) -> int:
	var total := 0.0
	for c: Candidate in pool:
		total += c.weight
	if total <= 0.0:
		return -1
	var roll := rng.randf() * total
	var accumulated := 0.0
	for i in pool.size():
		accumulated += pool[i].weight
		if roll <= accumulated:
			return i
	return pool.size() - 1


static func _shuffle(items: Array[Vector3], rng: RandomNumberGenerator) -> void:
	for i in range(items.size() - 1, 0, -1):
		var j := rng.randi_range(0, i)
		var tmp := items[i]
		items[i] = items[j]
		items[j] = tmp
