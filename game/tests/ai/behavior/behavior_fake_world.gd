class_name BehaviorFakeWorld
extends WorldQuery
## `WorldQuery` sintético para las pruebas de comportamiento.
##
## REGLA DE ESTE DOBLE: no puede ser más amable que el motor. Un doble que no
## reproduce los modos de fallo del original deja costuras verdes sobre
## sistemas rotos. Cada aspereza imitada lleva su comentario de qué imita:
##
##   * `path()` devuelve un array VACÍO en dos casos que no se distinguen —"no
##     hay ruta" y "el presupuesto de 4 peticiones por frame de ADR-002 aún no
##     la ha despachado"—, exactamente como `NavService.path()`;
##   * el último punto de una ruta NO es el destino exacto, sino el centro de
##     celda más cercano: `NavigationServer3D` devuelve puntos sobre la malla,
##     nunca el punto que le pediste;
##   * `snap_to_navmesh()` devuelve INF fuera de tolerancia en lugar de
##     acercar un punto cualquiera;
##   * `has_line_of_sight()` respeta la máscara de colisión: un cuerpo cuya
##     capa no está en la máscara NO detiene el rayo, igual que en Jolt;
##   * `disjoint_routes()` puede devolver menos rutas de las pedidas, incluida
##     ninguna, que es lo que pasa en un pasillo sin alternativa.

## Cajas que bloquean la visión y el paso.
var blockers: Array[AABB] = []
## Capa física de cada caja, en paralelo a `blockers`.
var blocker_layers: Array[int] = []
## Región navegable.
var bounds: AABB = AABB(Vector3(-25.0, -1.0, -25.0), Vector3(50.0, 4.0, 50.0))
## Lado de celda de la rejilla de búsqueda.
var cell_m: float = 1.0
## Distancia máxima a la que se acepta proyectar sobre el navmesh.
var snap_tolerance_m: float = 1.5

## Peticiones de ruta que quedan en este "frame". Negativo = sin límite.
## Ponerlo a 0 reproduce el frame en el que el techo de ADR-002 ya se gastó.
var path_budget: int = -1
## Rutas alternativas que este mundo es capaz de ofrecer, por encima de la
## directa. 0 = pasillo sin alternativa: no se puede flanquear.
var alternative_routes: int = 0

var raycast_count: int = 0
var path_count: int = 0
var disjoint_count: int = 0


func add_box(box: AABB, layer: int = 1) -> void:
	blockers.append(box)
	blocker_layers.append(layer)


## Muro vertical entre dos puntos del plano XZ.
func add_wall(from: Vector3, to: Vector3, thickness_m: float = 0.4,
		height_m: float = 3.0, layer: int = 1) -> void:
	var min_x := minf(from.x, to.x) - thickness_m * 0.5
	var max_x := maxf(from.x, to.x) + thickness_m * 0.5
	var min_z := minf(from.z, to.z) - thickness_m * 0.5
	var max_z := maxf(from.z, to.z) + thickness_m * 0.5
	add_box(AABB(Vector3(min_x, 0.0, min_z),
		Vector3(max_x - min_x, height_m, max_z - min_z)), layer)


# ---------------------------------------------------------------------------
# WorldQuery
# ---------------------------------------------------------------------------

func has_line_of_sight(from: Vector3, to: Vector3, collision_mask: int = 1) -> bool:
	raycast_count += 1
	for index: int in range(blockers.size()):
		var layer: int = blocker_layers[index]
		# El motor sólo detiene el rayo si la capa del cuerpo está en la
		# máscara. Un doble que ignorase esto aprobaría código que pregunta
		# con la capa equivocada.
		if (layer & collision_mask) == 0:
			continue
		if blockers[index].intersects_segment(from, to):
			return false
	return true


func raycast(from: Vector3, to: Vector3, collision_mask: int = 1) -> Vector3:
	raycast_count += 1
	var best := Vector3.INF
	var best_distance := INF
	for index: int in range(blockers.size()):
		if (blocker_layers[index] & collision_mask) == 0:
			continue
		var hit: Variant = blockers[index].intersects_segment(from, to)
		if hit is Vector3:
			var point: Vector3 = hit
			var distance := from.distance_to(point)
			if distance < best_distance:
				best_distance = distance
				best = point
	return best


func snap_to_navmesh(point: Vector3) -> Vector3:
	var candidate := _cell_center(point)
	if not _is_navigable(candidate):
		# Se busca en anillos crecientes, como haría el mapa del motor, y se
		# renuncia pasada la tolerancia en lugar de devolver cualquier cosa.
		var rings := int(ceil(snap_tolerance_m / cell_m))
		for ring: int in range(1, rings + 1):
			for dx: int in range(-ring, ring + 1):
				for dz: int in range(-ring, ring + 1):
					if absi(dx) != ring and absi(dz) != ring:
						continue
					var probe := candidate + Vector3(float(dx) * cell_m, 0.0, float(dz) * cell_m)
					if _is_navigable(probe) and probe.distance_to(point) <= snap_tolerance_m:
						return probe
		return Vector3.INF
	if candidate.distance_to(point) > snap_tolerance_m:
		return Vector3.INF
	return candidate


func path_cost(from: Vector3, to: Vector3) -> float:
	var route := _search(from, to)
	if route.is_empty():
		return INF
	var total := 0.0
	for index: int in range(1, route.size()):
		total += route[index - 1].distance_to(route[index])
	return total


func path(from: Vector3, to: Vector3) -> PackedVector3Array:
	path_count += 1
	if path_budget == 0:
		# Igual que `NavService.path()`: se encola y se devuelve vacío. El
		# llamante NO puede distinguirlo de "no hay ruta", y ése es justo el
		# modo de fallo que hay que reproducir.
		return PackedVector3Array()
	if path_budget > 0:
		path_budget -= 1
	return _search(from, to)


func disjoint_routes(from: Vector3, to: Vector3,
		max_routes: int = 2) -> Array[PackedVector3Array]:
	disjoint_count += 1
	var out: Array[PackedVector3Array] = []
	var direct := _search(from, to)
	if direct.is_empty():
		return out
	out.append(direct)
	# Las alternativas se declaran en el escenario: un pasillo recto no tiene
	# ninguna, y el planificador real tampoco se las inventa.
	for index: int in range(alternative_routes):
		if out.size() >= max_routes:
			break
		var detour := _detour(from, to, index + 1)
		if not detour.is_empty():
			out.append(detour)
	return out


# ---------------------------------------------------------------------------
# Interno
# ---------------------------------------------------------------------------

func _cell_center(point: Vector3) -> Vector3:
	var x := (floorf((point.x - bounds.position.x) / cell_m) + 0.5) * cell_m + bounds.position.x
	var z := (floorf((point.z - bounds.position.z) / cell_m) + 0.5) * cell_m + bounds.position.z
	return Vector3(x, bounds.position.y + bounds.size.y * 0.5, z)


func _is_navigable(point: Vector3) -> bool:
	if point.x < bounds.position.x or point.x > bounds.position.x + bounds.size.x:
		return false
	if point.z < bounds.position.z or point.z > bounds.position.z + bounds.size.z:
		return false
	for index: int in range(blockers.size()):
		var box := blockers[index]
		var flat := AABB(Vector3(box.position.x, bounds.position.y, box.position.z),
			Vector3(box.size.x, bounds.size.y, box.size.z))
		if flat.has_point(Vector3(point.x, point.y, point.z)):
			return false
	return true


## A* sobre la rejilla. Devuelve puntos en CENTROS DE CELDA, nunca el destino
## exacto: el motor tampoco lo hace.
func _search(from: Vector3, to: Vector3) -> PackedVector3Array:
	var start := _cell_center(from)
	var goal := _cell_center(to)
	if not _is_navigable(start) or not _is_navigable(goal):
		return PackedVector3Array()
	if start.distance_to(goal) < cell_m * 0.5:
		var single := PackedVector3Array()
		single.append(goal)
		return single

	var open: Array[Vector3] = [start]
	var came: Dictionary[Vector3, Vector3] = {}
	var cost: Dictionary[Vector3, float] = {start: 0.0}
	var guard := 0
	while not open.is_empty():
		guard += 1
		if guard > 20000:
			return PackedVector3Array()
		var best_index := 0
		var best_f := INF
		for index: int in range(open.size()):
			var f: float = cost[open[index]] + open[index].distance_to(goal)
			if f < best_f:
				best_f = f
				best_index = index
		var current: Vector3 = open[best_index]
		open.remove_at(best_index)
		if current.distance_to(goal) < cell_m * 0.5:
			return _rebuild(came, current)
		for offset: Vector3 in _neighbors():
			var next := current + offset
			if not _is_navigable(next):
				continue
			var tentative: float = cost[current] + offset.length()
			if not cost.has(next) or tentative < cost[next]:
				cost[next] = tentative
				came[next] = current
				if not open.has(next):
					open.append(next)
	return PackedVector3Array()


func _neighbors() -> Array[Vector3]:
	return [
		Vector3(cell_m, 0.0, 0.0), Vector3(-cell_m, 0.0, 0.0),
		Vector3(0.0, 0.0, cell_m), Vector3(0.0, 0.0, -cell_m),
	]


func _rebuild(came: Dictionary[Vector3, Vector3], goal: Vector3) -> PackedVector3Array:
	var out := PackedVector3Array()
	var current := goal
	out.append(current)
	while came.has(current):
		current = came[current]
		out.append(current)
	out.reverse()
	return out


## Ruta alternativa sintética: el mismo trayecto con un desvío lateral. No
## pretende ser óptima, sólo NO compartir el tramo central con la directa,
## que es lo que el flanqueo necesita comprobar.
func _detour(from: Vector3, to: Vector3, index: int) -> PackedVector3Array:
	var side := Vector3(0.0, 0.0, 1.0) if index % 2 == 1 else Vector3(0.0, 0.0, -1.0)
	var offset := side * cell_m * float(3 * index)
	var waypoint := _cell_center((from + to) * 0.5 + offset)
	if not _is_navigable(waypoint):
		return PackedVector3Array()
	var first := _search(from, waypoint)
	var second := _search(waypoint, to)
	if first.is_empty() or second.is_empty():
		return PackedVector3Array()
	var out := PackedVector3Array(first)
	for point: Vector3 in second:
		out.append(point)
	return out
