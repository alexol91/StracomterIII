class_name NavService
extends WorldQuery
## Envoltorio de `NavigationServer3D` y única implementación real de
## `WorldQuery` (ADR-004).
##
## El legacy construía su propio grafo: Delaunay incremental + unión de
## polígonos con GPC + expansión de la geometría por el radio del personaje +
## A* con listas lineales y un fallo conocido de relajación
## (`Pathfinder.cc:417-426`, análisis §4.4). Tenía que hacerlo: no tenía motor.
## Aquí eso lo hace Recast y `NavigationServer3D`, con `agent_radius` y
## `agent_height` reales, funnel sobre la malla y evitación local RVO2 entre
## agentes. Lo que se conserva del legacy es la INTENCIÓN, no el código.
##
## Responsabilidades:
##   * hornear el navmesh de un nivel y mantener sus regiones,
##   * servir rutas, coste de camino, proyección al navmesh y línea de visión,
##   * respetar el techo de 4 peticiones de camino por frame (ADR-002) con
##     cola y caché por par (origen, destino) redondeado a rejilla.
##
## NO decide dónde ponerse un bot: eso es `CoverProviderBaked`.
## NO decide por dónde flanquear: eso es `RoutePlanner`.
## NO contesta preguntas de física: eso es `WorldQueryPhysics`. Sigue siendo un
## `WorldQuery` para poder inyectarse como backend de navegación en
## `WorldQueryComposite`, pero no tiene rayo propio.


## Localizador del servicio activo del nivel en curso. Lo necesitan los nodos
## de escena (`DoorNavLink`) que no pueden recibir el servicio por inyección
## porque los instancia el `.tscn` del mapa.
static var _active: NavService = null


## Una petición de camino en espera de presupuesto.
class PendingRequest:
	extends RefCounted

	var key: StringName = &""
	var from: Vector3 = Vector3.ZERO
	var to: Vector3 = Vector3.ZERO
	var queued_frame: int = 0


var _map: RID = RID()
var _owns_map: bool = false
## region_id -> RID
var _regions: Dictionary[StringName, RID] = {}
## region_id -> NavigationMesh horneado
var _meshes: Dictionary[StringName, NavigationMesh] = {}
## region_id -> geometría de origen, para poder rehornear tras una demolición
var _sources: Dictionary[StringName, NavigationMeshSourceGeometryData3D] = {}
## Regiones cuyo RID lo posee un `NavigationRegion3D` de la escena: no se
## liberan al destruir el servicio.
var _adopted: Dictionary[StringName, bool] = {}

var _path_cache: Dictionary[StringName, PackedVector3Array] = {}
var _cost_cache: Dictionary[StringName, float] = {}
var _cache_order: Array[StringName] = []
var _queue: Array[PendingRequest] = []
var _queued_keys: Dictionary[StringName, bool] = {}

## Poner a false en pruebas que necesitan más de 4 rutas en el mismo frame.
var budget_enforced: bool = true

# Telemetría, consultable desde la consola.
var stat_cache_hits: int = 0
var stat_cache_misses: int = 0
var stat_queue_drops: int = 0
var stat_rebakes: int = 0


static func active() -> NavService:
	return _active


static func set_active(service: NavService) -> void:
	_active = service


# ---------------------------------------------------------------------------
# Ciclo de vida
# ---------------------------------------------------------------------------

## Crea un mapa de navegación propio. `existing_map` permite adoptar el mapa
## por defecto del `World3D` del nivel en lugar de crear otro.
func setup(existing_map: RID = RID()) -> void:
	dispose()
	if existing_map.is_valid():
		_map = existing_map
		_owns_map = false
	else:
		_map = NavigationServer3D.map_create()
		_owns_map = true
		NavigationServer3D.map_set_up(_map, Vector3.UP)
		NavigationServer3D.map_set_cell_size(_map, NavTuning.CELL_SIZE_M)
		NavigationServer3D.map_set_cell_height(_map, NavTuning.CELL_HEIGHT_M)
		# Iteraciones síncronas: sin esto el mapa sólo se sincroniza al final
		# del frame físico y todo lo que consulte en el mismo frame en que se
		# hornea (las pruebas, y el arranque de nivel) ve un mapa vacío.
		NavigationServer3D.map_set_use_async_iterations(_map, false)
		NavigationServer3D.map_set_active(_map, true)
		NavigationServer3D.map_force_update(_map)
	_connect_event_bus()


## Libera regiones, mapa y suscripciones.
##
## Desconectar del EventBus NO es opcional: `connect` guarda un `Callable` que
## referencia a este objeto, y `NavService` es `RefCounted`. Sin esto el
## servicio nunca se destruye, y con él se quedan vivos el mapa de navegación,
## las regiones y los navmesh horneados. Se ve al salir como "RID allocations
## were leaked".
func dispose() -> void:
	_disconnect_event_bus()
	_cached_planner = null
	for region_id: StringName in _regions:
		if not _adopted.get(region_id, false):
			NavigationServer3D.free_rid(_regions[region_id])
	_cache_dependents.clear()
	_regions.clear()
	_meshes.clear()
	_sources.clear()
	_adopted.clear()
	if _owns_map and _map.is_valid():
		NavigationServer3D.free_rid(_map)
	_map = RID()
	_owns_map = false
	invalidate_cache()


func map_rid() -> RID:
	return _map


func is_ready() -> bool:
	return _map.is_valid() and not _regions.is_empty()


# ---------------------------------------------------------------------------
# Horneado
# ---------------------------------------------------------------------------

## Hornea una región a partir de geometría ya recogida.
##
## OJO con el bobinado: Recast espera los triángulos en sentido HORARIO vistos
## desde +Y. Con el bobinado contrario el horneado devuelve 0 polígonos y en
## silencio. Verificado empíricamente en 4.7.2.
func bake_region(region_id: StringName,
		source: NavigationMeshSourceGeometryData3D) -> NavigationMesh:
	var mesh := NavigationMesh.new()
	NavTuning.configure_navigation_mesh(mesh)
	NavigationServer3D.bake_from_source_geometry_data(mesh, source)
	_sources[region_id] = source
	_install_region(region_id, mesh)
	return mesh


## Recoge la geometría estática de una escena de nivel y hornea con ella.
## Usa colisionadores y no mallas visuales: parsear mallas en ejecución obliga
## a traer la geometría de vuelta de la GPU y el motor avisa de ello.
func bake_region_from_scene(region_id: StringName, root: Node,
		collision_mask: int = NavTuning.WORLD_COLLISION_MASK) -> NavigationMesh:
	var mesh := NavigationMesh.new()
	NavTuning.configure_navigation_mesh(mesh)
	mesh.geometry_parsed_geometry_type = NavigationMesh.PARSED_GEOMETRY_STATIC_COLLIDERS
	mesh.geometry_collision_mask = collision_mask
	mesh.geometry_source_geometry_mode = NavigationMesh.SOURCE_GEOMETRY_ROOT_NODE_CHILDREN
	var source := NavigationMeshSourceGeometryData3D.new()
	NavigationServer3D.parse_source_geometry_data(mesh, source, root)
	NavigationServer3D.bake_from_source_geometry_data(mesh, source)
	_sources[region_id] = source
	_install_region(region_id, mesh)
	return mesh


## Adopta una región cuyo RID pertenece a un `NavigationRegion3D` de la escena
## del mapa (lo que produce el conversor de mapas legacy). El servicio la
## consulta y la conmuta pero no la libera.
func adopt_region(region_id: StringName, region_rid: RID) -> void:
	if not region_rid.is_valid():
		return
	_regions[region_id] = region_rid
	_adopted[region_id] = true
	invalidate_cache()
	sync()


func region_ids() -> Array[StringName]:
	var out: Array[StringName] = []
	for id: StringName in _regions:
		out.append(id)
	return out


func region_rid(region_id: StringName) -> RID:
	return _regions.get(region_id, RID())


func navigation_mesh(region_id: StringName = &"main") -> NavigationMesh:
	return _meshes.get(region_id, null)


## Conmuta una región entera. Es la forma gruesa de la paridad [P08]: una
## puerta que separa dos regiones deshabilita la de detrás. La forma fina es
## `DoorNavLink`, que conmuta un enlace en lugar de una región.
func set_region_enabled(region_id: StringName, enabled: bool) -> void:
	var rid: RID = _regions.get(region_id, RID())
	if not rid.is_valid():
		return
	NavigationServer3D.region_set_enabled(rid, enabled)
	invalidate_cache()
	sync()


## Fuerza la sincronización del mapa. Sin esto, nada de lo horneado es
## visible hasta el final del frame físico.
func sync() -> void:
	if _map.is_valid():
		NavigationServer3D.map_force_update(_map)


## Rehornea tras un cambio de topología (Demolición del Explosivo, E-01).
##
## Se rehornea la región COMPLETA, no sólo la AABB: partir un navmesh en dos
## regiones por la caja de una explosión deja costuras y el coste de hornear
## una planta es de milisegundos. La AABB sí se usa para lo caro: invalidar
## sólo las entradas de caché afectadas y re-hornear sólo los puntos de
## cobertura de esa zona (`CoverBaker.rebake_area`).
func rebake_aabb(aabb: AABB) -> bool:
	_last_rebake_frame = Engine.get_process_frames()
	_last_rebake_aabb = aabb
	var touched := false
	for region_id: StringName in _regions.keys():
		if _adopted.get(region_id, false):
			continue
		var source: NavigationMeshSourceGeometryData3D = _sources.get(region_id, null)
		if source == null:
			continue
		if not source.get_bounds().intersects(aabb):
			continue
		var mesh := NavigationMesh.new()
		NavTuning.configure_navigation_mesh(mesh)
		NavigationServer3D.bake_from_source_geometry_data(mesh, source)
		_install_region(region_id, mesh)
		touched = true
	if touched:
		stat_rebakes += 1
		invalidate_cache_in(aabb)
	return touched


var _last_rebake_frame: int = -1
var _last_rebake_aabb: AABB = AABB()


## Igual que `rebake_aabb`, pero coalesciendo: varias puertas y varios
## sistemas pueden reaccionar al mismo `level_topology_changed` y el nivel se
## rehornea una sola vez por frame y por zona.
func request_rebake(aabb: AABB) -> bool:
	if _last_rebake_frame == Engine.get_process_frames() \
			and _last_rebake_aabb.encloses(aabb):
		return false
	return rebake_aabb(aabb)


## Sustituye la geometría de origen de una región (la demolición quita muros).
func set_region_source(region_id: StringName,
		source: NavigationMeshSourceGeometryData3D) -> void:
	_sources[region_id] = source


func _install_region(region_id: StringName, mesh: NavigationMesh) -> void:
	_meshes[region_id] = mesh
	var rid: RID = _regions.get(region_id, RID())
	if not rid.is_valid():
		rid = NavigationServer3D.region_create()
		_regions[region_id] = rid
		_adopted[region_id] = false
		# El orden importa y no es evidente: sin `region_set_transform`
		# explícita la región nunca entra en la sincronización del mapa y
		# todas las consultas devuelven (0,0,0) sin dar error.
		NavigationServer3D.region_set_use_async_iterations(rid, false)
		NavigationServer3D.region_set_transform(rid, Transform3D.IDENTITY)
		NavigationServer3D.region_set_enabled(rid, true)
		NavigationServer3D.region_set_map(rid, _map)
	NavigationServer3D.region_set_navigation_mesh(rid, mesh)
	invalidate_cache()
	sync()


# ---------------------------------------------------------------------------
# WorldQuery
# ---------------------------------------------------------------------------

## `NavService` NO responde preguntas de física, y estas dos existen SÓLO para
## que el valor heredado de `WorldQuery` no llegue a un bot por la puerta de
## atrás: el del contrato concede visión, y eso son rayos X.
##
## No hay aquí ningún rayo. Quien contesta a la oclusión es el backend de
## física a través de `WorldQueryComposite`. El rayo estaba duplicado entre
## este servicio y `WorldQueryPhysics`, las dos copias divergieron y una acabó
## concediendo visión sin espacio físico enlazado — el bug del legacy
## resucitado por duplicación. Se quita la copia, no se arregla.
func has_line_of_sight(_from: Vector3, _to: Vector3,
		_collision_mask: int = NavTuning.WORLD_COLLISION_MASK) -> bool:
	return false


func raycast(_from: Vector3, _to: Vector3,
		_collision_mask: int = NavTuning.WORLD_COLLISION_MASK) -> Vector3:
	return Vector3.INF


func snap_to_navmesh(point: Vector3) -> Vector3:
	if not _map.is_valid():
		return Vector3.INF
	var closest := NavigationServer3D.map_get_closest_point(_map, point)
	if closest.distance_to(point) > NavTuning.NAVMESH_SNAP_TOLERANCE_M:
		return Vector3.INF
	return closest


## Coste de camino en metros. Es lo que permite estimar la propagación del
## sonido por la geometría real en lugar de por distancia recta (GDD §8.1):
## un disparo al otro lado de una pared está lejos aunque esté a 3 m.
## Coste de camino en metros, o INF si no hay ruta.
##
## NO pasa por el techo de 4 peticiones por frame, y es deliberado. El techo
## de ADR-002 acota las PETICIONES DE CAMINO —un bot pidiendo una ruta para
## recorrerla, que es `path()` / `request_path()`—, no las consultas sobre el
## mundo. Si `path_cost` se encolara, devolvería INF al agotarse el
## presupuesto, INF es indistinguible de "no hay ruta", y el oído estimaría el
## mismo disparo cerca o lejos según el frame en que cayera. Eso mete no
## determinismo en un módulo cuyo contrato entero es ser una función pura de
## (estado, pizarra, consulta del mundo).
##
## `WorldQuery.path_cost` no tiene forma de decir "todavía no lo sé", así que
## la única respuesta honesta es no tener nunca ese estado. Lo que acota el
## coste es la caché por par (origen, destino): quien consulte en bucle debe
## acotarse él (`SpawnSampler.MAX_MEASURED_CANDIDATES` lo hace).
func path_cost(from: Vector3, to: Vector3) -> float:
	var key := _cache_key(from, to)
	if _cost_cache.has(key):
		return _cost_cache[key]
	# Sin mapa horneado no hay información de topología. Devolver INF sería
	# AFIRMAR que no hay paso, y eso amortiguaría todos los ruidos de un nivel
	# sin hornear; la distancia recta dice "no sé, por lo menos esto".
	if not _map.is_valid():
		return from.distance_to(to)
	_compute_and_store(key, from, to)
	return _cost_cache.get(key, INF)


## Alias explícito de `path_cost`, para quien quiera dejar por escrito en la
## llamada que sabe que esto no pasa por el presupuesto por frame: el director
## al muestrear apariciones, el análisis de forma del mapa para el Simplex.
func path_cost_immediate(from: Vector3, to: Vector3) -> float:
	return path_cost(from, to)


func path(from: Vector3, to: Vector3) -> PackedVector3Array:
	var key := _cache_key(from, to)
	if _path_cache.has(key):
		stat_cache_hits += 1
		return _path_cache[key]
	stat_cache_misses += 1
	if not _consume_budget():
		_enqueue(key, from, to)
		return PackedVector3Array()
	return _compute_and_store(key, from, to)


## Hasta `max_routes` rutas que no comparten tramos. Delegado en
## `RoutePlanner`, que es quien sabe de corredores de polígonos.
func disjoint_routes(from: Vector3, to: Vector3,
		max_routes: int = 2) -> Array[PackedVector3Array]:
	var planner := _planner()
	if planner == null:
		return []
	return planner.disjoint_routes(from, to, max_routes)


var _cached_planner: RoutePlanner = null


func _planner() -> RoutePlanner:
	var mesh := navigation_mesh()
	if mesh == null:
		# Sin región "main" nombrada, se usa la primera que haya.
		for region_id: StringName in _meshes:
			mesh = _meshes[region_id]
			break
	if mesh == null:
		return null
	if _cached_planner == null or _cached_planner.source_mesh() != mesh:
		_cached_planner = RoutePlanner.new()
		_cached_planner.build(mesh)
	return _cached_planner


# ---------------------------------------------------------------------------
# Cola y caché de peticiones de camino (ADR-002)
# ---------------------------------------------------------------------------

## Encola una petición sin consumir presupuesto. Devuelve la clave con la que
## consultar el resultado en `cached_path`.
func request_path(from: Vector3, to: Vector3) -> StringName:
	var key := _cache_key(from, to)
	if not _path_cache.has(key):
		_enqueue(key, from, to)
	return key


func has_cached_path(key: StringName) -> bool:
	return _path_cache.has(key)


func cached_path(key: StringName) -> PackedVector3Array:
	return _path_cache.get(key, PackedVector3Array())


func pending_count() -> int:
	return _queue.size()


func cache_size() -> int:
	return _path_cache.size()


## Despacha peticiones encoladas hasta agotar el presupuesto del frame.
## Devuelve cuántas sirvió. Lo llama el cliente de `AIScheduler` del nivel:
## nada de esto vive en un `_process` propio (ADR-002).
func pump() -> int:
	var served := 0
	while not _queue.is_empty():
		if not _consume_budget():
			break
		var req: PendingRequest = _queue.pop_front()
		_queued_keys.erase(req.key)
		_compute_and_store(req.key, req.from, req.to)
		served += 1
	return served


## Otras cachés que dependen de la topología y hay que vaciar con ella.
##
## El caso concreto es `WorldQueryPhysics`, que el oído usa para estimar la
## propagación del sonido por coste de camino: si una puerta se cierra y esa
## caché no se vacía, los bots siguen oyendo como si estuviera abierta. Quien
## escucha `door_state_changed` y `level_topology_changed` es este servicio,
## así que la invalidación se coordina aquí y no en cinco sitios.
##
## Se acepta cualquier objeto con `clear_cache()`, sin depender del tipo: la
## navegación no tiene por qué conocer a la percepción.
var _cache_dependents: Array[Object] = []


func add_cache_dependent(dependent: Object) -> void:
	if dependent != null and not _cache_dependents.has(dependent):
		_cache_dependents.append(dependent)


func remove_cache_dependent(dependent: Object) -> void:
	_cache_dependents.erase(dependent)


func cache_dependent_count() -> int:
	return _cache_dependents.size()


func invalidate_cache() -> void:
	_path_cache.clear()
	_cost_cache.clear()
	_cache_order.clear()


## Invalida sólo los caminos cuyos extremos caen en la zona afectada.
func invalidate_cache_in(aabb: AABB) -> void:
	var grown := aabb.grow(NavTuning.NAVMESH_SNAP_TOLERANCE_M)
	for key: StringName in _path_cache.keys():
		var route: PackedVector3Array = _path_cache[key]
		var affected := false
		for p: Vector3 in route:
			if grown.has_point(p):
				affected = true
				break
		if affected:
			_path_cache.erase(key)
			_cost_cache.erase(key)
			_cache_order.erase(key)


func _enqueue(key: StringName, from: Vector3, to: Vector3) -> void:
	if _queued_keys.has(key):
		return
	if _queue.size() >= NavTuning.PATH_QUEUE_MAX:
		var dropped: PendingRequest = _queue.pop_front()
		_queued_keys.erase(dropped.key)
		stat_queue_drops += 1
	var req := PendingRequest.new()
	req.key = key
	req.from = from
	req.to = to
	req.queued_frame = Engine.get_process_frames()
	_queue.append(req)
	_queued_keys[key] = true


func _compute_and_store(key: StringName, from: Vector3,
		to: Vector3) -> PackedVector3Array:
	var route := _raw_path(from, to)
	_store(key, route)
	return route


func _raw_path(from: Vector3, to: Vector3) -> PackedVector3Array:
	if not _map.is_valid():
		return PackedVector3Array()
	var route := NavigationServer3D.map_get_path(_map, from, to, true)
	if route.size() < 2:
		return PackedVector3Array()
	# `map_get_path` devuelve el camino hasta el punto alcanzable MÁS CERCANO
	# cuando origen y destino están en islas distintas. Sin esta comprobación
	# un bot "llega" a una sala a la que no hay paso.
	var target := NavigationServer3D.map_get_closest_point(_map, to)
	if route[route.size() - 1].distance_to(target) > NavTuning.NAVMESH_SNAP_TOLERANCE_M:
		return PackedVector3Array()
	return route


func _store(key: StringName, route: PackedVector3Array) -> void:
	_path_cache[key] = route
	_cost_cache[key] = _polyline_length(route) if not route.is_empty() else INF
	_cache_order.append(key)
	while _cache_order.size() > NavTuning.PATH_CACHE_MAX_ENTRIES:
		var oldest: StringName = _cache_order.pop_front()
		_path_cache.erase(oldest)
		_cost_cache.erase(oldest)


func _consume_budget() -> bool:
	if not budget_enforced:
		return true
	var scheduler := _scheduler()
	if scheduler == null:
		return true
	return bool(scheduler.call(&"try_consume_path_request"))


func _scheduler() -> Node:
	var loop := Engine.get_main_loop() as SceneTree
	if loop == null:
		return null
	return loop.root.get_node_or_null(^"/root/AIScheduler")


## Clave de caché: par (origen, destino) redondeado a rejilla. Dos bots a
## menos de medio metro pidiendo ir al mismo sitio comparten la ruta.
func _cache_key(from: Vector3, to: Vector3) -> StringName:
	var a := _quantize(from)
	var b := _quantize(to)
	return StringName("%d,%d,%d>%d,%d,%d" % [a.x, a.y, a.z, b.x, b.y, b.z])


func _quantize(p: Vector3) -> Vector3i:
	var c := NavTuning.PATH_CACHE_CELL_M
	return Vector3i(roundi(p.x / c), roundi(p.y / c), roundi(p.z / c))


static func _polyline_length(line: PackedVector3Array) -> float:
	var total := 0.0
	for i in range(1, line.size()):
		total += line[i - 1].distance_to(line[i])
	return total


# ---------------------------------------------------------------------------
# EventBus
# ---------------------------------------------------------------------------

func _connect_event_bus() -> void:
	var bus := _event_bus()
	if bus == null:
		return
	if not bus.is_connected(&"door_state_changed", _on_door_state_changed):
		bus.connect(&"door_state_changed", _on_door_state_changed)
	if not bus.is_connected(&"level_topology_changed", _on_level_topology_changed):
		bus.connect(&"level_topology_changed", _on_level_topology_changed)


func _disconnect_event_bus() -> void:
	var bus := _event_bus()
	if bus == null:
		return
	if bus.is_connected(&"door_state_changed", _on_door_state_changed):
		bus.disconnect(&"door_state_changed", _on_door_state_changed)
	if bus.is_connected(&"level_topology_changed", _on_level_topology_changed):
		bus.disconnect(&"level_topology_changed", _on_level_topology_changed)


func _event_bus() -> Node:
	var loop := Engine.get_main_loop() as SceneTree
	if loop == null:
		return null
	return loop.root.get_node_or_null(^"/root/EventBus")


## Una puerta que cambia invalida la caché entera: el coste de recalcular
## rutas es menor que el de que un bot cruce una puerta cerrada.
func _on_door_state_changed(_door_id: int, _is_open: bool) -> void:
	invalidate_cache()
	_invalidate_dependents()


func _on_level_topology_changed(region_aabb: AABB) -> void:
	rebake_aabb(region_aabb)
	_invalidate_dependents()


func _invalidate_dependents() -> void:
	for dependent: Object in _cache_dependents:
		if is_instance_valid(dependent) and dependent.has_method(&"clear_cache"):
			dependent.call(&"clear_cache")
