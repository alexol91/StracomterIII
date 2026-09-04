class_name NavTestUtil
extends RefCounted
## Utilidades compartidas por las pruebas de `ai/navigation`.
##
## Lleva `class_name` (y no se usa con `preload`) por un motivo concreto: un
## script sin clase global, referenciado sólo desde el `const` de otro script,
## no se descarga limpiamente al salir del motor y Godot lo denuncia como
## "resources still in use at exit". Con clase global lo sostiene el
## ScriptServer y se libera en orden. Verificado en 4.7.2.
##
## La geometría de prueba son cajas (`AABB`). De ahí salen las DOS cosas que
## necesita el sistema y que deben describir el mismo mundo:
##   * la geometría de origen del navmesh, que hornea Recast, y
##   * un `WorldQuery` sintético que resuelve los rayos analíticamente.
##
## Que los rayos sean analíticos y no físicos es deliberado: el horneado de
## cobertura se prueba sin `PhysicsServer3D`, sin escena y sin frames, que es
## exactamente la costura que pide la arquitectura (`world_query.gd`).


## Mundo sintético: intersección rayo-caja, sin motor de físicas.
class SyntheticWorld:
	extends WorldQuery

	var boxes: Array[AABB] = []
	var nav: NavService = null

	func raycast(from: Vector3, to: Vector3, _collision_mask: int = 1) -> Vector3:
		var delta := to - from
		var length := delta.length()
		if length < 0.000001:
			return Vector3.INF
		var dir := delta / length
		var best := INF
		for box: AABB in boxes:
			# `hit_from_inside = false`, como la consulta física real: un rayo
			# que nace dentro de un cuerpo no lo reporta.
			if box.has_point(from):
				continue
			var t := _ray_box(from, dir, length, box)
			if t >= 0.0 and t < best:
				best = t
		if is_inf(best):
			return Vector3.INF
		return from + dir * best

	func has_line_of_sight(from: Vector3, to: Vector3,
			collision_mask: int = 1) -> bool:
		return not raycast(from, to, collision_mask).is_finite()

	func snap_to_navmesh(point: Vector3) -> Vector3:
		return Vector3.INF if nav == null else nav.snap_to_navmesh(point)

	func path(from: Vector3, to: Vector3) -> PackedVector3Array:
		return PackedVector3Array() if nav == null else nav.path(from, to)

	func path_cost(from: Vector3, to: Vector3) -> float:
		return INF if nav == null else nav.path_cost(from, to)

	func disjoint_routes(from: Vector3, to: Vector3,
			max_routes: int = 2) -> Array[PackedVector3Array]:
		return [] if nav == null else nav.disjoint_routes(from, to, max_routes)

	static func _ray_box(from: Vector3, dir: Vector3, length: float,
			box: AABB) -> float:
		var tmin := 0.0
		var tmax := length
		for axis in 3:
			var origin := from[axis]
			var d := dir[axis]
			var lo := box.position[axis]
			var hi := lo + box.size[axis]
			if absf(d) < 0.000000001:
				if origin < lo or origin > hi:
					return -1.0
				continue
			var t1 := (lo - origin) / d
			var t2 := (hi - origin) / d
			if t1 > t2:
				var swap := t1
				t1 = t2
				t2 = swap
			tmin = maxf(tmin, t1)
			tmax = minf(tmax, t2)
			if tmin > tmax:
				return -1.0
		return tmin


## Escenario completo: navmesh horneado + mundo sintético coherente con él.
class Fixture:
	extends RefCounted

	var nav: NavService = null
	var world: SyntheticWorld = null
	var mesh: NavigationMesh = null

	func dispose() -> void:
		if nav != null:
			nav.dispose()
			nav = null


## Construye un escenario a partir de cajas. La primera caja suele ser el
## suelo; el resto, muros y mobiliario.
static func fixture(boxes: Array[AABB]) -> Fixture:
	var out := Fixture.new()
	out.nav = NavService.new()
	out.nav.setup()
	# Las pruebas piden más de 4 rutas por frame a propósito: aquí se mide el
	# resultado del pathfinding, no el reparto de presupuesto (que tiene su
	# propia prueba).
	out.nav.budget_enforced = false
	out.mesh = out.nav.bake_region(&"main", source_from_boxes(boxes))
	out.world = SyntheticWorld.new()
	out.world.boxes = boxes
	out.world.nav = out.nav
	out.nav.set_space(null)
	return out


static func source_from_boxes(boxes: Array[AABB]) -> NavigationMeshSourceGeometryData3D:
	var source := NavigationMeshSourceGeometryData3D.new()
	for box: AABB in boxes:
		source.add_faces(box_faces(box), Transform3D.IDENTITY)
	return source


## Los 12 triángulos de una caja, con normal hacia FUERA.
##
## El bobinado no se escribe a mano: se emite cada triángulo y se comprueba
## que su normal (convenio de Godot: `(a-c) × (a-b)`) apunta en sentido
## contrario al centro. Recast descarta en silencio las caras cuya normal no
## mira hacia arriba, así que equivocarse aquí produce un navmesh vacío sin un
## solo mensaje de error — verificado en 4.7.2.
static func box_faces(box: AABB) -> PackedVector3Array:
	var out := PackedVector3Array()
	var lo := box.position
	var hi := box.position + box.size
	var center := box.get_center()
	var corners: Array[Vector3] = [
		Vector3(lo.x, lo.y, lo.z), Vector3(hi.x, lo.y, lo.z),
		Vector3(hi.x, lo.y, hi.z), Vector3(lo.x, lo.y, hi.z),
		Vector3(lo.x, hi.y, lo.z), Vector3(hi.x, hi.y, lo.z),
		Vector3(hi.x, hi.y, hi.z), Vector3(lo.x, hi.y, hi.z),
	]
	var quads: Array[PackedInt32Array] = [
		PackedInt32Array([0, 1, 2, 3]),  # abajo
		PackedInt32Array([4, 5, 6, 7]),  # arriba
		PackedInt32Array([0, 1, 5, 4]),
		PackedInt32Array([1, 2, 6, 5]),
		PackedInt32Array([2, 3, 7, 6]),
		PackedInt32Array([3, 0, 4, 7]),
	]
	for quad: PackedInt32Array in quads:
		_emit_triangle(out, corners[quad[0]], corners[quad[1]], corners[quad[2]], center)
		_emit_triangle(out, corners[quad[0]], corners[quad[2]], corners[quad[3]], center)
	return out


static func _emit_triangle(out: PackedVector3Array, a: Vector3, b: Vector3,
		c: Vector3, center: Vector3) -> void:
	var normal := (a - c).cross(a - b)
	var outward := (a + b + c) / 3.0 - center
	if normal.dot(outward) >= 0.0:
		out.append_array(PackedVector3Array([a, b, c]))
	else:
		out.append_array(PackedVector3Array([a, c, b]))


## Suelo de 0,5 m de grosor cuya cara superior está en y = 0.
static func floor_box(half_extent_m: float) -> AABB:
	return AABB(
		Vector3(-half_extent_m, -0.5, -half_extent_m),
		Vector3(half_extent_m * 2.0, 0.5, half_extent_m * 2.0))


## Muro/mesa: losa vertical de `thickness` de grosor en X, centrada en `x`.
static func slab_x(x: float, thickness_m: float, height_m: float,
		z_from: float, z_to: float) -> AABB:
	return AABB(
		Vector3(x - thickness_m * 0.5, 0.0, z_from),
		Vector3(thickness_m, height_m, z_to - z_from))


## Punto horneado más cercano a `target`, ignorando los que están muy por
## encima (p. ej. encima de una mesa).
static func nearest_point_index(cloud: CoverPointCloud, target: Vector3,
		max_height_delta_m: float = 1.0) -> int:
	var best := -1
	var best_d := INF
	for i in cloud.size():
		var p := cloud.position_at(i)
		if absf(p.y - target.y) > max_height_delta_m:
			continue
		var d := p.distance_squared_to(target)
		if d < best_d:
			best_d = d
			best = i
	return best


## Nube sintética de `count` puntos en rejilla, con densidad FIJA. Sirve para
## medir el índice espacial: lo que cambia entre dos nubes es el tamaño total,
## no la densidad, que es la comparación que tiene sentido.
static func synthetic_cloud(count: int, spacing_m: float) -> CoverPointCloud:
	var cloud := CoverPointCloud.new()
	cloud.grid_cell_m = NavTuning.COVER_GRID_CELL_M
	var side := int(ceilf(sqrt(float(count))))
	var chest := PackedByteArray()
	var head := PackedByteArray()
	for _s in NavTuning.DIRECTION_COUNT:
		chest.append(int(CoverProvider.Quality.HIGH))
		head.append(int(CoverProvider.Quality.HIGH))
	var added := 0
	for gx in side:
		for gz in side:
			if added >= count:
				break
			var offset := float(side) * spacing_m * 0.5
			cloud.append_point(
				Vector3(float(gx) * spacing_m - offset, 0.0,
					float(gz) * spacing_m - offset),
				chest, head, 0)
			added += 1
	cloud.rebuild_index()
	return cloud
