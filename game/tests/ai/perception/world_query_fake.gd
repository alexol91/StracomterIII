extends WorldQuery
## `WorldQuery` sintético para las pruebas de percepción.
##
## La geometría se describe A MANO como una lista de cajas opacas, y la
## navegación se resuelve con un A* sobre una rejilla derivada de esas mismas
## cajas. No hay escena, ni física, ni navmesh horneado, ni GPU: por eso toda
## la suite de percepción corre en milisegundos en `--headless`.
##
## Es la contrapartida de `WorldQueryPhysics` + `NavService`: misma interfaz,
## mismo contrato, implementación sintética. Esa costura es la razón por la que
## la IA de este proyecto se puede probar de verdad.
##
## REGLA DE ESTE DOBLE: no puede ser más amable que el motor. Un doble que no
## reproduce los modos de fallo del original deja costuras verdes sobre
## sistemas rotos — ya pasó una vez en este proyecto: la versión anterior
## devolvía el destino EXACTO como último punto de la ruta, cosa que
## `NavigationServer3D` no hace nunca, y por eso ninguna prueba pudo ver que
## todo disparo por encima del suelo se estaba tratando como "sin ruta". Cada
## aspereza del motor que se imita lleva abajo el comentario de qué imita.

## Cajas que bloquean la visión Y el paso.
var blockers: Array[AABB] = []
## Capa de física de cada caja, en paralelo a `blockers`. El motor solo detiene
## un rayo si la capa del cuerpo está en la máscara de la consulta; un doble que
## ignore la máscara aprobaría código que pregunta con la capa equivocada.
var blocker_layers: Array[int] = []
## Radio máximo al que se puede proyectar un punto sobre el navmesh. El motor
## no proyecta a cualquier distancia: `map_get_closest_point` da el punto más
## cercano y hay que decidir si está lo bastante cerca.
var snap_tolerance_m: float = 1.5
## Región navegable de la rejilla de A*.
var bounds: AABB = AABB(Vector3(-20.0, -1.0, -20.0), Vector3(40.0, 4.0, 40.0))
## Lado de celda de la rejilla, en metros.
var cell_m: float = 1.0

## Telemetría: cuántos raycasts se han pedido. Es lo que permite comprobar que
## se respeta el presupuesto del `AIScheduler`.
var raycast_count: int = 0
## Cuántas consultas de coste de camino se han pedido.
var path_cost_count: int = 0

var _grid_dirty: bool = true
var _blocked: PackedByteArray = PackedByteArray()
var _width: int = 0
var _depth: int = 0


# ---- Construcción de la escena de prueba ----

## Añade una caja opaca. `layer` por defecto: 1 ("world").
func add_box(box: AABB, layer: int = 1) -> void:
	blockers.append(box)
	blocker_layers.append(layer)
	_grid_dirty = true


## Añade un muro vertical entre dos puntos del plano XZ.
func add_wall(from: Vector3, to: Vector3, thickness_m: float = 0.4, height_m: float = 3.0) -> void:
	var min_x := minf(from.x, to.x) - thickness_m * 0.5
	var max_x := maxf(from.x, to.x) + thickness_m * 0.5
	var min_z := minf(from.z, to.z) - thickness_m * 0.5
	var max_z := maxf(from.z, to.z) + thickness_m * 0.5
	add_box(AABB(
		Vector3(min_x, 0.0, min_z),
		Vector3(max_x - min_x, height_m, max_z - min_z)
	))


func clear_geometry() -> void:
	blockers.clear()
	blocker_layers.clear()
	_grid_dirty = true


func reset_counters() -> void:
	raycast_count = 0
	path_cost_count = 0


# ---- WorldQuery ----

func has_line_of_sight(from: Vector3, to: Vector3, collision_mask: int = 1) -> bool:
	raycast_count += 1
	for i: int in blockers.size():
		if not _matches_mask(i, collision_mask):
			continue
		if blockers[i].intersects_segment(from, to) != null:
			return false
	return true


func raycast(from: Vector3, to: Vector3, collision_mask: int = 1) -> Vector3:
	raycast_count += 1
	var best := Vector3.INF
	var best_distance := INF
	for i: int in blockers.size():
		if not _matches_mask(i, collision_mask):
			continue
		var hit: Variant = blockers[i].intersects_segment(from, to)
		if hit == null:
			continue
		var point: Vector3 = hit
		var d := from.distance_to(point)
		if d < best_distance:
			best_distance = d
			best = point
	return best


## Proyecta al "navmesh". Como el motor: devuelve el punto NAVEGABLE más
## cercano, que casi nunca es el que se pidió, y falla si no hay ninguno
## lo bastante cerca.
func snap_to_navmesh(point: Vector3) -> Vector3:
	_rebuild_grid()
	var projected := _nearest_free_center(point)
	if is_inf(projected.x):
		return Vector3.INF
	if Vector2(projected.x - point.x, projected.z - point.z).length() > snap_tolerance_m:
		return Vector3.INF
	return projected


func _nearest_free_center(point: Vector3) -> Vector3:
	var cell := _cell_of(point)
	if _is_free(cell.x, cell.y):
		return _center_of(cell.x, cell.y)
	# Búsqueda en anillos crecientes: determinista y suficiente para pruebas.
	for radius: int in range(1, maxi(_width, _depth)):
		for dz: int in range(-radius, radius + 1):
			for dx: int in range(-radius, radius + 1):
				if absi(dx) != radius and absi(dz) != radius:
					continue
				if _is_free(cell.x + dx, cell.y + dz):
					return _center_of(cell.x + dx, cell.y + dz)
	return Vector3.INF


## Coste de camino real sobre la rejilla. Con una pared en medio hay que dar
## la vuelta, y eso es exactamente lo que debe notar el oído.
func path_cost(from: Vector3, to: Vector3) -> float:
	path_cost_count += 1
	var route := path(from, to)
	if route.size() < 2:
		return INF
	var total := 0.0
	for i: int in range(1, route.size()):
		total += route[i - 1].distance_to(route[i])
	return total


func path(from: Vector3, to: Vector3) -> PackedVector3Array:
	_rebuild_grid()
	var start := _cell_of(from)
	var goal := _cell_of(to)
	if not _is_free(start.x, start.y) or not _is_free(goal.x, goal.y):
		return PackedVector3Array()
	if start == goal:
		var direct := PackedVector3Array()
		direct.append(_center_of(start.x, start.y))
		direct.append(_center_of(goal.x, goal.y))
		return direct

	var came_from: Dictionary[Vector2i, Vector2i] = {}
	var cost_so_far: Dictionary[Vector2i, float] = {start: 0.0}
	var open: Array[Vector2i] = [start]
	var found := false

	while not open.is_empty():
		var current := _pop_best(open, cost_so_far, goal)
		if current == goal:
			found = true
			break
		for dz: int in [-1, 0, 1]:
			for dx: int in [-1, 0, 1]:
				if dx == 0 and dz == 0:
					continue
				var neighbour := Vector2i(current.x + dx, current.y + dz)
				if not _is_free(neighbour.x, neighbour.y):
					continue
				# No se atraviesan esquinas en diagonal.
				if dx != 0 and dz != 0:
					if not _is_free(current.x + dx, current.y) or not _is_free(current.x, current.y + dz):
						continue
				var step := cell_m * (sqrt(2.0) if dx != 0 and dz != 0 else 1.0)
				var new_cost: float = cost_so_far[current] + step
				if not cost_so_far.has(neighbour) or new_cost < cost_so_far[neighbour]:
					cost_so_far[neighbour] = new_cost
					came_from[neighbour] = current
					if not open.has(neighbour):
						open.append(neighbour)

	if not found:
		return PackedVector3Array()

	# El último punto es el centro de celda alcanzado, NO el destino pedido:
	# `NavigationServer3D.map_get_path` devuelve puntos sobre el navmesh, y un
	# foco de ruido casi nunca está sobre él (un disparo suena a la altura del
	# pecho). Devolver `to` aquí es lo que ocultó ese fallo la primera vez.
	var reversed_points: Array[Vector3] = []
	var node := goal
	while node != start:
		reversed_points.append(_center_of(node.x, node.y))
		node = came_from[node]
	reversed_points.append(_center_of(start.x, start.y))
	var out := PackedVector3Array()
	for i: int in range(reversed_points.size() - 1, -1, -1):
		out.append(reversed_points[i])
	return out


## Las rutas disjuntas son ámbito de `ai-navegacion`; aquí no se simulan.
func disjoint_routes(
	_from: Vector3, _to: Vector3, _max_routes: int = 2
) -> Array[PackedVector3Array]:
	return []


# ---- Rejilla ----

func _rebuild_grid() -> void:
	if not _grid_dirty:
		return
	_grid_dirty = false
	_width = maxi(1, int(ceil(bounds.size.x / cell_m)))
	_depth = maxi(1, int(ceil(bounds.size.z / cell_m)))
	_blocked = PackedByteArray()
	_blocked.resize(_width * _depth)
	for z: int in _depth:
		for x: int in _width:
			var cell_box := AABB(
				Vector3(bounds.position.x + x * cell_m, bounds.position.y, bounds.position.z + z * cell_m),
				Vector3(cell_m, bounds.size.y, cell_m)
			)
			var blocked := false
			for box: AABB in blockers:
				if box.intersects(cell_box):
					blocked = true
					break
			_blocked[z * _width + x] = 1 if blocked else 0


func _cell_of(point: Vector3) -> Vector2i:
	return Vector2i(
		int(floor((point.x - bounds.position.x) / cell_m)),
		int(floor((point.z - bounds.position.z) / cell_m))
	)


func _center_of(x: int, z: int) -> Vector3:
	return Vector3(
		bounds.position.x + (float(x) + 0.5) * cell_m,
		bounds.position.y,
		bounds.position.z + (float(z) + 0.5) * cell_m
	)


## ¿Detiene esta caja un rayo lanzado con `collision_mask`? El motor compara
## la capa del cuerpo con la máscara de la consulta; aquí igual.
func _matches_mask(index: int, collision_mask: int) -> bool:
	var layer := blocker_layers[index] if index < blocker_layers.size() else 1
	return (layer & collision_mask) != 0


func _is_free(x: int, z: int) -> bool:
	_rebuild_grid()
	if x < 0 or z < 0 or x >= _width or z >= _depth:
		return false
	return _blocked[z * _width + x] == 0


## A* con conjunto abierto lineal: la rejilla de una prueba es diminuta y esto
## es trivial de leer, que es lo que importa en código de pruebas.
func _pop_best(open: Array[Vector2i], cost_so_far: Dictionary[Vector2i, float], goal: Vector2i) -> Vector2i:
	var best_index := 0
	var best_score := INF
	for i: int in open.size():
		var node := open[i]
		var dx := absi(node.x - goal.x)
		var dz := absi(node.y - goal.y)
		var heuristic := cell_m * (float(maxi(dx, dz)) + (sqrt(2.0) - 1.0) * float(mini(dx, dz)))
		var score: float = cost_so_far[node] + heuristic
		if score < best_score:
			best_score = score
			best_index = i
	var chosen := open[best_index]
	open.remove_at(best_index)
	return chosen
