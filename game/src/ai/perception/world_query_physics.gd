class_name WorldQueryPhysics
extends WorldQuery
## Implementación real de `WorldQuery` sobre `PhysicsDirectSpaceState3D` y
## `NavigationServer3D`.
##
## Es el único punto de todo `ai/perception/` que toca el motor. Todo lo demás
## habla con la interfaz, y por eso se prueba sin escena.
##
## AVISO DE HILO: `PhysicsDirectSpaceState3D` solo es válido dentro del paso de
## física. El `AIScheduler` corre en `_process`, así que quien construya esta
## clase debe refrescar el espacio con `bind_space()` desde
## `_physics_process` (o pasar el `World3D` y dejar que se resuelva solo).

## Tolerancia al comparar el final de una ruta con el destino pedido, en
## metros. Por debajo se considera que la ruta llega; por encima,
## `NavigationServer3D` ha devuelto un camino parcial y no hay ruta real.
## TODO(arquitecto): mover a datos si hace falta afinarlo por nivel.
const PATH_ARRIVAL_TOLERANCE_M: float = 1.0
## Entradas máximas de la caché de coste de camino.
const PATH_COST_CACHE_LIMIT: int = 128
## Lado de la celda con que se cuantizan las posiciones para cachear, en
## metros. Dos consultas dentro de la misma celda comparten resultado.
const PATH_COST_CACHE_CELL_M: float = 1.0

var space_state: PhysicsDirectSpaceState3D = null
var navigation_map: RID = RID()
## Cuerpos excluidos de los raycast (el propio bot, típicamente).
var exclude: Array[RID] = []

var _path_cost_cache: Dictionary[int, float] = {}


func _init(p_space: PhysicsDirectSpaceState3D = null, p_map: RID = RID()) -> void:
	space_state = p_space
	navigation_map = p_map


## Refresca el espacio de física. Debe llamarse desde `_physics_process`.
func bind_space(p_space: PhysicsDirectSpaceState3D) -> void:
	space_state = p_space


## Toma el espacio y el mapa de navegación de un `World3D`.
func bind_world(world: World3D) -> void:
	if world == null:
		return
	space_state = world.direct_space_state
	navigation_map = world.navigation_map


## Excluye cuerpos de los raycast (el cuerpo del propio bot).
func set_exclude(bodies: Array[RID]) -> void:
	exclude = bodies


# ---- Visión ----

func has_line_of_sight(from: Vector3, to: Vector3, collision_mask: int = 1) -> bool:
	if space_state == null:
		# Sin espacio de física no se puede afirmar que haya visión. Ante la
		# duda, el bot NO ve: es la única respuesta que no reintroduce el bug
		# del legacy de ver a través de las paredes.
		return false
	var query := PhysicsRayQueryParameters3D.create(from, to, collision_mask, exclude)
	query.hit_from_inside = false
	query.collide_with_areas = false
	query.collide_with_bodies = true
	return space_state.intersect_ray(query).is_empty()


func raycast(from: Vector3, to: Vector3, collision_mask: int = 1) -> Vector3:
	if space_state == null:
		return Vector3.INF
	var query := PhysicsRayQueryParameters3D.create(from, to, collision_mask, exclude)
	query.hit_from_inside = false
	query.collide_with_areas = false
	query.collide_with_bodies = true
	var hit := space_state.intersect_ray(query)
	if hit.is_empty():
		return Vector3.INF
	var hit_position: Vector3 = hit.get("position", Vector3.INF)
	return hit_position


# ---- Navegación ----

func snap_to_navmesh(point: Vector3) -> Vector3:
	if not navigation_map.is_valid():
		return Vector3.INF
	return NavigationServer3D.map_get_closest_point(navigation_map, point)


## Coste de camino en metros, sumando los tramos de la ruta del navmesh.
##
## Es lo que hace que el oído sea información táctica: un disparo al otro lado
## de una pared cuesta dar toda la vuelta, y por eso se oye lejano.
func path_cost(from: Vector3, to: Vector3) -> float:
	if not navigation_map.is_valid():
		# Nivel sin navmesh horneado: no hay información de topología, así que
		# se devuelve la recta en lugar de mentir con un INF.
		return from.distance_to(to)
	var key := _cache_key(from, to)
	if _path_cost_cache.has(key):
		return _path_cost_cache[key]

	var points := NavigationServer3D.map_get_path(navigation_map, from, to, true)
	var cost := _length_of(points)
	if points.size() < 2 or points[points.size() - 1].distance_to(to) > PATH_ARRIVAL_TOLERANCE_M:
		# Ruta parcial: `map_get_path` devuelve el punto alcanzable más cercano
		# cuando el destino es inalcanzable. Eso NO es una ruta.
		cost = INF

	if _path_cost_cache.size() >= PATH_COST_CACHE_LIMIT:
		_path_cost_cache.clear()
	_path_cost_cache[key] = cost
	return cost


func path(from: Vector3, to: Vector3) -> PackedVector3Array:
	if not navigation_map.is_valid():
		return PackedVector3Array()
	return NavigationServer3D.map_get_path(navigation_map, from, to, true)


## Rutas disjuntas para el flanqueo.
##
## NO se implementa aquí: es el ámbito de `ai-navegacion`, que decidirá cómo
## penalizar los tramos ya reclamados en la pizarra. Devolver vacío es la
## respuesta correcta mientras tanto — el director de escuadra simplemente no
## asignará flanqueos, en lugar de asignar dos flanqueos por el mismo pasillo.
func disjoint_routes(
	_from: Vector3, _to: Vector3, _max_routes: int = 2
) -> Array[PackedVector3Array]:
	return []


## Vacía la caché de costes. Obligatorio al cambiar la topología del nivel
## (`EventBus.level_topology_changed`, puertas, demoliciones).
func clear_cache() -> void:
	_path_cost_cache.clear()


func cache_size() -> int:
	return _path_cost_cache.size()


func _length_of(points: PackedVector3Array) -> float:
	if points.size() < 2:
		return INF
	var total := 0.0
	for i: int in range(1, points.size()):
		total += points[i - 1].distance_to(points[i])
	return total


func _cache_key(from: Vector3, to: Vector3) -> int:
	var a := Vector3i(
		roundi(from.x / PATH_COST_CACHE_CELL_M),
		roundi(from.y / PATH_COST_CACHE_CELL_M),
		roundi(from.z / PATH_COST_CACHE_CELL_M)
	)
	var b := Vector3i(
		roundi(to.x / PATH_COST_CACHE_CELL_M),
		roundi(to.y / PATH_COST_CACHE_CELL_M),
		roundi(to.z / PATH_COST_CACHE_CELL_M)
	)
	return hash([a, b])
