class_name NavmeshSampler
extends RefCounted
## Muestreo de un `NavigationMesh` en rejilla. Utilidad interna de
## `ai/navigation`.
##
## Sustituye a `Map::getTriCenters(minArea)` del legacy, que devolvía los
## incentros de los triángulos de área ≥ 2000 px² (análisis §5.3). Aquel
## muestreo heredaba la forma de la triangulación: donde la Delaunay hacía
## triángulos finos no había puntos, y donde hacía uno grande había uno solo
## en medio. Una rejilla anclada al origen del mundo da densidad uniforme
## independientemente de cómo Recast haya partido la malla.


## Puntos de una rejilla de paso `spacing_m` anclada al origen, recortada a
## los polígonos del navmesh. Si `area` tiene tamaño, se limita a ella.
static func sample_grid(mesh: NavigationMesh, spacing_m: float,
		area: AABB = AABB()) -> PackedVector3Array:
	var out := PackedVector3Array()
	var count := mesh.get_polygon_count()
	if count == 0:
		return out
	var vertices := mesh.get_vertices()
	var step := maxf(spacing_m, 0.25)
	var limited := area.size.length_squared() > 0.0
	var seen: Dictionary[Vector2i, bool] = {}

	for poly_index in count:
		var poly := mesh.get_polygon(poly_index)
		var min_x := INF
		var max_x := -INF
		var min_z := INF
		var max_z := -INF
		var sum_y := 0.0
		for vi: int in poly:
			var v := vertices[vi]
			min_x = minf(min_x, v.x)
			max_x = maxf(max_x, v.x)
			min_z = minf(min_z, v.z)
			max_z = maxf(max_z, v.z)
			sum_y += v.y
		var y := sum_y / float(poly.size())
		for gx in range(floori(min_x / step), floori(max_x / step) + 1):
			for gz in range(floori(min_z / step), floori(max_z / step) + 1):
				var key := Vector2i(gx, gz)
				if seen.has(key):
					continue
				var p := Vector3(float(gx) * step, y, float(gz) * step)
				if not point_in_polygon(p, poly, vertices):
					continue
				if limited and not area.has_point(p):
					continue
				seen[key] = true
				out.append(p)
	return out


## Punto dentro de un polígono convexo, proyectado en XZ. Los polígonos de un
## navmesh de Recast son convexos por construcción.
static func point_in_polygon(p: Vector3, poly: PackedInt32Array,
		vertices: PackedVector3Array, epsilon: float = 0.02) -> bool:
	var n := poly.size()
	var positive := false
	var negative := false
	for i in n:
		var a := vertices[poly[i]]
		var b := vertices[poly[(i + 1) % n]]
		var cross := (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)
		if cross > epsilon:
			positive = true
		elif cross < -epsilon:
			negative = true
		if positive and negative:
			return false
	return true


## AABB que cubre todo el navmesh.
static func bounds_of(mesh: NavigationMesh) -> AABB:
	var vertices := mesh.get_vertices()
	if vertices.is_empty():
		return AABB()
	var box := AABB(vertices[0], Vector3.ZERO)
	for v: Vector3 in vertices:
		box = box.expand(v)
	return box
