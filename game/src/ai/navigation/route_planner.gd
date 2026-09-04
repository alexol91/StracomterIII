class_name RoutePlanner
extends RefCounted
## Rutas alternativas REALMENTE disjuntas sobre el navmesh, para el flanqueo
## de `ai-escuadra` (GDD §8.4).
##
## "Ángulo del objetivo + 90°" no es flanquear: es caminar hacia una pared.
## Un flanqueo de verdad es una segunda ruta por el navmesh que no comparte
## tramo con la primera, y eso el motor no lo da: `map_get_path` devuelve
## siempre la mejor, y pedirla dos veces devuelve la misma.
##
## Por eso —y SÓLO por eso— aquí hay una búsqueda propia. No se reimplementa
## la navegación: `NavService.path()` sigue usando `NavigationServer3D`. Lo
## que se implementa es lo único que el motor no ofrece: k rutas con
## corredores de polígonos disjuntos. La malla, el radio del agente y la
## triangulación siguen siendo del motor; aquí sólo se recorre el grafo dual
## de polígonos que Recast ya ha producido.
##
## Método: A* sobre el grafo de adyacencia de polígonos; encontrada una ruta,
## sus polígonos se EXCLUYEN (no se penalizan) salvo los de los extremos, y
## se vuelve a buscar. La exclusión dura garantiza que no haya tramo
## compartido; la penalización blanda sólo lo haría probable.


## Muestreo al validar que un tramo suavizado sigue dentro del corredor.
const CORRIDOR_VALIDATION_STEP_M: float = 0.5
## Tolerancia del test de punto en polígono, en metros.
const POLYGON_EPSILON: float = 0.02

var _mesh: NavigationMesh = null
var _vertices: PackedVector3Array = PackedVector3Array()
var _polygons: Array[PackedInt32Array] = []
var _centroids: PackedVector3Array = PackedVector3Array()
## poly -> polígonos vecinos
var _neighbors: Array[PackedInt32Array] = []
## poly -> por cada vecino, los 2 índices de vértice del portal (aplanados)
var _portals: Array[PackedInt32Array] = []

# Montículo binario del A*. Parallel arrays para no crear objetos por nodo.
var _heap_poly: PackedInt32Array = PackedInt32Array()
var _heap_f: PackedFloat32Array = PackedFloat32Array()

## Telemetría: polígonos expandidos en la última búsqueda.
var stat_last_expansions: int = 0


func source_mesh() -> NavigationMesh:
	return _mesh


func polygon_count() -> int:
	return _polygons.size()


## Construye el grafo dual de polígonos a partir de un navmesh horneado.
## Se hace una vez por nivel; no por consulta.
func build(mesh: NavigationMesh) -> void:
	_mesh = mesh
	_vertices = mesh.get_vertices()
	_polygons.clear()
	_centroids = PackedVector3Array()
	_neighbors.clear()
	_portals.clear()
	if mesh.get_polygon_count() == 0:
		return

	var count := mesh.get_polygon_count()
	_centroids.resize(count)
	for i in count:
		var poly := mesh.get_polygon(i)
		_polygons.append(poly)
		var c := Vector3.ZERO
		for vi: int in poly:
			c += _vertices[vi]
		_centroids[i] = c / float(poly.size())
		_neighbors.append(PackedInt32Array())
		_portals.append(PackedInt32Array())

	# Aristas compartidas: dos polígonos son vecinos si comparten dos vértices
	# consecutivos. Recast ya deduplica los vértices, así que basta comparar
	# índices, sin tolerancias de posición como hacía el legacy (0.1 en
	# `Point::operator==`, análisis §4.1).
	var stride := _vertices.size() + 1
	var edge_owner: Dictionary[int, int] = {}
	for i in count:
		var poly := _polygons[i]
		var n := poly.size()
		for e in n:
			var a := poly[e]
			var b := poly[(e + 1) % n]
			var key := mini(a, b) * stride + maxi(a, b)
			if edge_owner.has(key):
				var other: int = edge_owner[key]
				if other != i:
					_link(i, other, a, b)
				edge_owner.erase(key)
			else:
				edge_owner[key] = i


func _link(pa: int, pb: int, va: int, vb: int) -> void:
	_neighbors[pa].append(pb)
	_portals[pa].append(va)
	_portals[pa].append(vb)
	_neighbors[pb].append(pa)
	_portals[pb].append(va)
	_portals[pb].append(vb)


# ---------------------------------------------------------------------------
# API pública
# ---------------------------------------------------------------------------

## Hasta `max_routes` rutas que no comparten tramos.
## Índice 0 = la ruta más corta (el Fijador); el resto, flanqueos.
func disjoint_routes(from: Vector3, to: Vector3,
		max_routes: int = 2) -> Array[PackedVector3Array]:
	var out: Array[PackedVector3Array] = []
	if _polygons.is_empty():
		return out
	var start := _locate(from)
	var goal := _locate(to)
	if start < 0 or goal < 0:
		return out

	var wanted := clampi(max_routes, 1, NavTuning.ROUTE_MAX_ROUTES)
	var excluded: Dictionary[int, bool] = {}
	for _i in wanted:
		var corridor := _astar(start, goal, excluded)
		if corridor.is_empty():
			break
		var route := _corridor_to_path(corridor, from, to)
		if route.size() < 2:
			break
		# Garantía dura: sólo se devuelve lo que de verdad no comparte tramo.
		# Excluir polígonos hace la disjunción PROBABLE; comprobarla la hace
		# CIERTA, y es la diferencia entre un flanqueo y dos bots en fila.
		var overlaps := false
		for previous: PackedVector3Array in out:
			if routes_share_segment(route, previous):
				overlaps = true
				break
		if overlaps:
			break
		out.append(route)

		# Los extremos son forzosamente comunes: si se excluyeran, la segunda
		# ruta no podría ni salir del sitio ni llegar al destino.
		#
		# Se preservan los polígonos de origen y destino POR ÍNDICE y no sólo
		# por distancia al centroide: Recast produce polígonos grandes e
		# irregulares y el centroide de aquel en el que está el bot puede caer
		# lejos de él; con el criterio de distancia a secas la segunda búsqueda
		# arrancaba encerrada y el flanqueo desaparecía en silencio.
		var keep := NavTuning.ROUTE_ENDPOINT_KEEP_RADIUS_M
		var newly_excluded := 0
		for poly_index: int in corridor:
			if poly_index == start or poly_index == goal:
				continue
			if excluded.has(poly_index):
				continue
			var c := _centroids[poly_index]
			if c.distance_to(from) <= keep or c.distance_to(to) <= keep:
				continue
			excluded[poly_index] = true
			newly_excluded += 1
		# Si la ruta no ha aportado ni un polígono que excluir (un pasillo
		# recto de un solo polígono), la siguiente búsqueda devolvería
		# exactamente lo mismo. Mejor una ruta menos que una ruta repetida.
		if newly_excluded == 0:
			break
	return out


## Componentes conexas del navmesh: conjuntos de polígonos entre los que
## existe camino. Un nivel bien construido tiene UNA, más las azoteas y
## repisas a las que no se sube. Dos componentes grandes a ras de suelo son
## una zona a la que no se puede llegar, y eso es un fallo de nivel.
func connected_components() -> Array[PackedInt32Array]:
	var out: Array[PackedInt32Array] = []
	var seen: Dictionary[int, bool] = {}
	for i in _polygons.size():
		if seen.has(i):
			continue
		var component := PackedInt32Array()
		var stack := PackedInt32Array([i])
		seen[i] = true
		while not stack.is_empty():
			var current := stack[stack.size() - 1]
			stack.remove_at(stack.size() - 1)
			component.append(current)
			for neighbor: int in _neighbors[current]:
				if not seen.has(neighbor):
					seen[neighbor] = true
					stack.append(neighbor)
		out.append(component)
	return out


## Área de un polígono proyectada en XZ, en m².
func polygon_area(index: int) -> float:
	var poly := _polygons[index]
	var total := 0.0
	for i in poly.size():
		var a := _vertices[poly[i]]
		var b := _vertices[poly[(i + 1) % poly.size()]]
		total += a.x * b.z - b.x * a.z
	return absf(total) * 0.5


## Altura media de un polígono. Sirve para distinguir el suelo de una azotea.
func polygon_height(index: int) -> float:
	var poly := _polygons[index]
	var total := 0.0
	for vi: int in poly:
		total += _vertices[vi].y
	return total / float(poly.size())


## Polígono que CONTIENE el punto, o -1. A diferencia de la localización
## interna, no cae al centroide más cercano: aquí interesa la pertenencia.
func polygon_containing(point: Vector3) -> int:
	for i in _polygons.size():
		if _point_in_polygon(point, i):
			return i
	return -1


## ¿Comparten tramo dos rutas? Se ignoran los entornos de origen y destino,
## que son comunes por construcción.
static func routes_share_segment(a: PackedVector3Array, b: PackedVector3Array,
		clearance_m: float = NavTuning.ROUTE_DISJOINT_CLEARANCE_M,
		endpoint_radius_m: float = NavTuning.ROUTE_ENDPOINT_KEEP_RADIUS_M) -> bool:
	if a.size() < 2 or b.size() < 2:
		return false
	var start := a[0]
	var end := a[a.size() - 1]
	var samples := _sample_polyline(a, clearance_m)
	for p: Vector3 in samples:
		if p.distance_to(start) <= endpoint_radius_m:
			continue
		if p.distance_to(end) <= endpoint_radius_m:
			continue
		if _distance_to_polyline(p, b) < clearance_m:
			return true
	return false


# ---------------------------------------------------------------------------
# A* sobre el grafo de polígonos
# ---------------------------------------------------------------------------

func _astar(start: int, goal: int, excluded: Dictionary[int, bool]) -> PackedInt32Array:
	stat_last_expansions = 0
	if start == goal:
		return PackedInt32Array([start])
	if excluded.has(start) or excluded.has(goal):
		return PackedInt32Array()

	var g_score: Dictionary[int, float] = {start: 0.0}
	var came_from: Dictionary[int, int] = {}
	var closed: Dictionary[int, bool] = {}
	_heap_clear()
	_heap_push(start, _centroids[start].distance_to(_centroids[goal]))

	while not _heap_is_empty():
		var current := _heap_pop()
		if closed.has(current):
			continue
		closed[current] = true
		stat_last_expansions += 1
		if current == goal:
			return _reconstruct(came_from, goal, start)
		if stat_last_expansions > NavTuning.ROUTE_MAX_EXPANSIONS:
			break
		var current_g: float = g_score[current]
		for neighbor: int in _neighbors[current]:
			if closed.has(neighbor) or excluded.has(neighbor):
				continue
			var tentative := current_g + _centroids[current].distance_to(_centroids[neighbor])
			# A* con relajación de verdad. El legacy sólo actualizaba el padre
			# y dejaba `g`/`f` desactualizados (`Pathfinder.cc:417-426`), con
			# lo que su A* no era óptimo. Aquí se actualizan los tres.
			if g_score.has(neighbor) and tentative >= g_score[neighbor]:
				continue
			g_score[neighbor] = tentative
			came_from[neighbor] = current
			_heap_push(neighbor, tentative + _centroids[neighbor].distance_to(_centroids[goal]))
	return PackedInt32Array()


func _reconstruct(came_from: Dictionary[int, int], goal: int,
		start: int) -> PackedInt32Array:
	var out := PackedInt32Array([goal])
	var current := goal
	while current != start:
		if not came_from.has(current):
			return PackedInt32Array()
		current = came_from[current]
		out.append(current)
	out.reverse()
	return out


# ---------------------------------------------------------------------------
# Corredor de polígonos -> polilínea
# ---------------------------------------------------------------------------

func _corridor_to_path(corridor: PackedInt32Array, from: Vector3,
		to: Vector3) -> PackedVector3Array:
	var start := _project_into(corridor[0], from)
	var end := _project_into(corridor[corridor.size() - 1], to)
	if corridor.size() == 1:
		return PackedVector3Array([start, end])

	# Base: los puntos medios de los portales. Están DENTRO del corredor por
	# construcción, así que el camino de partida siempre es válido aunque feo.
	var waypoints := PackedVector3Array([start])
	for i in range(corridor.size() - 1):
		var portal := _portal_between(corridor[i], corridor[i + 1])
		if portal.is_empty():
			return PackedVector3Array()
		waypoints.append((_vertices[portal[0]] + _vertices[portal[1]]) * 0.5)
	waypoints.append(end)
	_last_corridor_hit = -1
	return _string_pull(waypoints, corridor)


func _portal_between(pa: int, pb: int) -> PackedInt32Array:
	var neighbors := _neighbors[pa]
	for i in neighbors.size():
		if neighbors[i] == pb:
			return PackedInt32Array([_portals[pa][i * 2], _portals[pa][i * 2 + 1]])
	return PackedInt32Array()


## Tensado del camino: se salta todo waypoint intermedio mientras el atajo
## siga DENTRO del corredor de polígonos.
##
## Es la misma idea que `Pathfinder::smoothPath` del legacy (`Pathfinder.cc:
## 242-261`), que borraba `p[i+1]` si había visión de `p[i]` a `p[i+2]`. Dos
## diferencias: la comprobación es la pertenencia al corredor y no un rayo
## contra geometría expandida a mano, y el avance es voraz de verdad (el
## legacy sólo saltaba de uno en uno).
##
## Se prefiere esto al algoritmo del embudo por una razón práctica: el embudo
## depende de acertar el signo del área con signo y de orientar cada portal a
## izquierda y derecha; equivocarse produce caminos en zigzag que aun así
## "parecen" caminos y pasan cualquier prueba de que el destino se alcanza.
## Aquí, si el atajo no cabe, no se toma — y eso es verificable punto por
## punto, que es justo lo que hace la prueba `test_las_rutas_se_quedan_sobre_
## el_navmesh`.
func _string_pull(points: PackedVector3Array,
		corridor: PackedInt32Array) -> PackedVector3Array:
	if points.size() <= 2:
		return points
	var out := PackedVector3Array([points[0]])
	var anchor := 0
	while anchor < points.size() - 1:
		var target := anchor + 1
		while target + 1 < points.size() \
				and _segment_in_corridor(points[anchor], points[target + 1], corridor):
			target += 1
		out.append(points[target])
		anchor = target
	return out


func _segment_in_corridor(a: Vector3, b: Vector3,
		corridor: PackedInt32Array) -> bool:
	var steps := maxi(1, int(ceilf(a.distance_to(b) / CORRIDOR_VALIDATION_STEP_M)))
	for s in range(steps + 1):
		if not _point_in_corridor(a.lerp(b, float(s) / float(steps)), corridor):
			return false
	return true


## Coherencia temporal: al recorrer un segmento, cada muestra cae casi siempre
## en el mismo polígono que la anterior. Probar ese primero convierte una
## búsqueda lineal por muestra en una sola comprobación.
var _last_corridor_hit: int = -1


func _point_in_corridor(p: Vector3, corridor: PackedInt32Array) -> bool:
	if _last_corridor_hit >= 0 and _point_in_polygon(p, _last_corridor_hit):
		return true
	for poly_index: int in corridor:
		if _point_in_polygon(p, poly_index):
			_last_corridor_hit = poly_index
			return true
	return false


func _point_in_polygon(p: Vector3, poly_index: int) -> bool:
	return NavmeshSampler.point_in_polygon(p, _polygons[poly_index], _vertices, POLYGON_EPSILON)


## Índice del polígono que contiene el punto; si ninguno, el centroide más
## cercano dentro de la tolerancia de proyección.
func _locate(point: Vector3) -> int:
	for i in _polygons.size():
		if _point_in_polygon(point, i):
			return i
	var best := -1
	var best_d := NavTuning.NAVMESH_SNAP_TOLERANCE_M * NavTuning.NAVMESH_SNAP_TOLERANCE_M
	for i in _centroids.size():
		var d := _centroids[i].distance_squared_to(point)
		if d < best_d:
			best_d = d
			best = i
	if best >= 0:
		return best
	# Último recurso: el polígono más cercano, sin tolerancia. Un bot fuera
	# del navmesh sigue mereciendo una ruta.
	best_d = INF
	for i in _centroids.size():
		var d := _centroids[i].distance_squared_to(point)
		if d < best_d:
			best_d = d
			best = i
	return best


## Lleva el punto al plano del polígono manteniendo XZ si ya está dentro.
func _project_into(poly_index: int, point: Vector3) -> Vector3:
	if _point_in_polygon(point, poly_index):
		return Vector3(point.x, _centroids[poly_index].y, point.z)
	return _centroids[poly_index]


# ---------------------------------------------------------------------------
# Utilidades geométricas
# ---------------------------------------------------------------------------

static func _sample_polyline(line: PackedVector3Array,
		step_m: float) -> PackedVector3Array:
	var out := PackedVector3Array()
	if line.is_empty():
		return out
	for i in range(line.size() - 1):
		var a := line[i]
		var b := line[i + 1]
		var length := a.distance_to(b)
		var steps := maxi(1, int(ceilf(length / maxf(step_m, 0.05))))
		for s in steps:
			out.append(a.lerp(b, float(s) / float(steps)))
	out.append(line[line.size() - 1])
	return out


static func _distance_to_polyline(p: Vector3, line: PackedVector3Array) -> float:
	var best := INF
	for i in range(line.size() - 1):
		var q := Geometry3D.get_closest_point_to_segment(p, line[i], line[i + 1])
		best = minf(best, p.distance_to(q))
	return best


# ---------------------------------------------------------------------------
# Montículo binario
# ---------------------------------------------------------------------------

func _heap_clear() -> void:
	_heap_poly.clear()
	_heap_f.clear()


func _heap_is_empty() -> bool:
	return _heap_poly.is_empty()


func _heap_push(poly_index: int, f: float) -> void:
	_heap_poly.append(poly_index)
	_heap_f.append(f)
	var i := _heap_poly.size() - 1
	while i > 0:
		@warning_ignore("integer_division")
		var parent := (i - 1) / 2
		if _heap_f[parent] <= _heap_f[i]:
			break
		_heap_swap(parent, i)
		i = parent


func _heap_pop() -> int:
	var top := _heap_poly[0]
	var last := _heap_poly.size() - 1
	_heap_swap(0, last)
	_heap_poly.remove_at(last)
	_heap_f.remove_at(last)
	var i := 0
	var size := _heap_poly.size()
	while true:
		var l := i * 2 + 1
		var r := l + 1
		var smallest := i
		if l < size and _heap_f[l] < _heap_f[smallest]:
			smallest = l
		if r < size and _heap_f[r] < _heap_f[smallest]:
			smallest = r
		if smallest == i:
			break
		_heap_swap(i, smallest)
		i = smallest
	return top


func _heap_swap(a: int, b: int) -> void:
	var tp := _heap_poly[a]
	_heap_poly[a] = _heap_poly[b]
	_heap_poly[b] = tp
	var tf := _heap_f[a]
	_heap_f[a] = _heap_f[b]
	_heap_f[b] = tf
