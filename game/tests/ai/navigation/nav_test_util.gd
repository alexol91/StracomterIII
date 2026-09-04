class_name NavTestUtil
extends RefCounted
## Utilidades compartidas por las pruebas de `ai/navigation`.
##
## Lleva `class_name` y no tiene clases internas por un motivo concreto: los
## scripts que sólo se alcanzan por el `const preload` de otro, y las clases
## internas que extienden clases globales, no se descargan limpiamente al
## salir del motor; Godot lo denuncia al final como "ObjectDB instances were
## leaked" / "resources still in use at exit". Verificado en 4.7.2.
##
## La geometría de prueba son cajas (`AABB`). De ahí salen las DOS cosas que
## necesita el sistema y que deben describir el mismo mundo: la geometría de
## origen del navmesh, que hornea Recast, y el `WorldQuery` sintético
## (`NavSyntheticWorld`) que resuelve los rayos analíticamente.


## Construye un escenario a partir de cajas. La primera caja suele ser el
## suelo; el resto, muros y mobiliario.
static func fixture(boxes: Array[AABB]) -> NavSyntheticWorld:
	var out := NavSyntheticWorld.new()
	out.boxes = boxes
	out.nav = NavService.new()
	out.nav.setup()
	# Las pruebas piden más de 4 rutas en el mismo frame a propósito: aquí se
	# mide el resultado del pathfinding, no el reparto de presupuesto (que
	# tiene su propia prueba).
	out.nav.budget_enforced = false
	out.mesh = out.nav.bake_region(&"main", source_from_boxes(boxes))
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


