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
##
## QUIEN MONTE EL NIVEL debe hacer dos cosas más:
##   1. `nav_service.add_cache_dependent(esta_instancia)`, para que la caché de
##      costes se vacíe al abrirse una puerta o al demolerse un muro. Sin eso el
##      oído seguirá creyendo que una puerta cerrada está abierta.
##   2. asignar `nav_service`, sin el cual no hay rutas de flanqueo.

## Los márgenes del navmesh y el tamaño de la caché salen de `NavTuning`, no de
## constantes propias: si esta clase y `NavService` respondieran con tolerancias
## distintas a la misma pregunta ("¿hay ruta?"), el juego tendría dos verdades.
## No son números de balanceo y por eso no viven en `PerceptionProfile`.

var space_state: PhysicsDirectSpaceState3D = null
var navigation_map: RID = RID()
## Cuerpos excluidos de los raycast (el propio bot, típicamente).
var exclude: Array[RID] = []
## Servicio de navegación del nivel. Lo inyecta quien carga el nivel; sin él no
## hay rutas de flanqueo (ver `disjoint_routes`).
var nav_service: NavService = null

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
	var cost := _length_of(points) if _route_arrives(points, to) else INF

	if _path_cost_cache.size() >= NavTuning.PATH_CACHE_MAX_ENTRIES:
		_path_cost_cache.clear()
	_path_cost_cache[key] = cost
	return cost


func path(from: Vector3, to: Vector3) -> PackedVector3Array:
	if not navigation_map.is_valid():
		return PackedVector3Array()
	return NavigationServer3D.map_get_path(navigation_map, from, to, true)


## Rutas disjuntas para el flanqueo. Delegadas en `NavService`, que es quien
## sabe de corredores de polígonos (`RoutePlanner`); aquí no se reimplementan.
##
## Sin `nav_service` devuelve vacío, y eso NO es un error: el director de
## escuadra debe leer "menos de dos rutas" como "no hay flanqueo posible" y
## asignar otro rol, en lugar de mandar a dos flanqueadores por el mismo
## pasillo — que es lo que pasaría si aquí se devolviera la misma ruta dos
## veces con tal de rellenar el hueco.
func disjoint_routes(
	from: Vector3, to: Vector3, max_routes: int = 2
) -> Array[PackedVector3Array]:
	if nav_service == null:
		return []
	return nav_service.disjoint_routes(from, to, max_routes)


## Vacía la caché de costes. Obligatorio al cambiar la topología del nivel
## (`EventBus.level_topology_changed`, puertas, demoliciones).
func clear_cache() -> void:
	_path_cost_cache.clear()


func cache_size() -> int:
	return _path_cost_cache.size()


## ¿La ruta llega de verdad al destino, o es un camino parcial?
##
## `map_get_path` devuelve el camino hasta el punto alcanzable MÁS CERCANO
## cuando origen y destino están en islas distintas, así que sin esta
## comprobación un destino inalcanzable da una distancia finita y el oído
## estimaría "cerca" un ruido al que no hay paso.
##
## La comparación es contra el punto NAVEGABLE más cercano al destino, no
## contra el destino en bruto: los focos de ruido casi nunca están sobre el
## navmesh (un disparo sale a la altura del pecho, no de los pies), y comparar
## con el destino crudo declararía inalcanzable cualquier disparo por el mero
## hecho de sonar a 1,2 m del suelo.
func _route_arrives(points: PackedVector3Array, to: Vector3) -> bool:
	if points.size() < 2:
		return false
	var last := points[points.size() - 1]
	if last.distance_to(to) <= NavTuning.NAVMESH_SNAP_TOLERANCE_M:
		return true
	var target := NavigationServer3D.map_get_closest_point(navigation_map, to)
	return last.distance_to(target) <= NavTuning.NAVMESH_SNAP_TOLERANCE_M


func _length_of(points: PackedVector3Array) -> float:
	if points.size() < 2:
		return INF
	var total := 0.0
	for i: int in range(1, points.size()):
		total += points[i - 1].distance_to(points[i])
	return total


func _cache_key(from: Vector3, to: Vector3) -> int:
	var cell := NavTuning.PATH_CACHE_CELL_M
	var a := Vector3i(roundi(from.x / cell), roundi(from.y / cell), roundi(from.z / cell))
	var b := Vector3i(roundi(to.x / cell), roundi(to.y / cell), roundi(to.z / cell))
	return hash([a, b])
