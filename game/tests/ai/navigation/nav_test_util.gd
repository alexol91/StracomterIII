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


## AVISO PARA QUIEN AÑADA PRUEBAS AQUÍ: los constructores de escenario viven
## en esta clase y no en los ficheros `test_*.gd` por un motivo medido, no por
## estilo. Un método declarado en un `TestCase` cuyo tipo de RETORNO es una
## clase de GDScript (`-> CoverPointCloud`, `-> NavSyntheticWorld`) impide que
## Godot descargue ese script al cerrar, y la ejecución termina con "ObjectDB
## instances were leaked at exit" / "resources still in use at exit" aunque
## todas las pruebas pasen. Ocurre con métodos normales y estáticos por igual;
## los PARÁMETROS de ese tipo no dan problema. Verificado en 4.7.2.
##
## Regla práctica: en un `test_*.gd`, tipos de clase sólo en variables locales
## y en parámetros. Todo lo que devuelva un objeto del proyecto, aquí.


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




## Escenario canónico de cobertura: explanada con una losa vertical a `x`.
## Con 3 m de alto es un muro; con 1,2 m, una mesa.
static func cover_scenario(obstacle_x: float, obstacle_height_m: float,
		floor_half_extent_m: float = 10.0) -> NavSyntheticWorld:
	var boxes: Array[AABB] = [
		floor_box(floor_half_extent_m),
		slab_x(obstacle_x, 0.4, obstacle_height_m, -3.0, 3.0),
	]
	return fixture(boxes)


## Hornea la nube de cobertura de un escenario con los ajustes por defecto.
static func bake_cover(world: NavSyntheticWorld,
		map_id: StringName = &"test") -> CoverPointCloud:
	var baker := CoverBaker.new()
	var options := CoverBaker.Options.new()
	options.map_id = map_id
	return baker.bake(world.mesh, world, options)


## Explanada con DOS muros enfrentados: uno al este (+X) y otro al oeste (−X).
## Sirve para comprobar que la consulta elige el punto que cubre frente a la
## amenaza REAL y no frente a cualquier otra.
static func two_wall_scenario(wall_x: float = 6.0,
		floor_half_extent_m: float = 15.0) -> NavSyntheticWorld:
	var boxes: Array[AABB] = [
		floor_box(floor_half_extent_m),
		slab_x(wall_x, 0.4, 3.0, -3.0, 3.0),
		slab_x(-wall_x, 0.4, 3.0, -3.0, 3.0),
	]
	return fixture(boxes)


## Anillo: explanada con un bloque macizo en el centro. Deja dos corredores
## entre cualquier par de puntos opuestos, que es lo mínimo que hace falta
## para que exista un flanqueo de verdad.
static func ring_scenario(outer_half_extent_m: float = 16.0,
		block_half_extent_m: float = 10.0,
		block_height_m: float = 3.0) -> NavSyntheticWorld:
	var boxes: Array[AABB] = [
		floor_box(outer_half_extent_m),
		AABB(Vector3(-block_half_extent_m, 0.0, -block_half_extent_m),
			Vector3(block_half_extent_m * 2.0, block_height_m,
				block_half_extent_m * 2.0)),
	]
	return fixture(boxes)


## Nube sintética de `count` puntos en rejilla, con densidad FIJA y cobertura
## alta en todas las direcciones.
##
## La densidad es fija a propósito: al medir el índice espacial lo que debe
## cambiar entre dos nubes es el TAMAÑO del mapa, no cuántos puntos hay por
## metro cuadrado. Comparar 1 000 puntos apretados con 10 000 apretados en la
## misma superficie mediría otra cosa.
static func synthetic_cloud(count: int, spacing_m: float) -> CoverPointCloud:
	var cloud := CoverPointCloud.new()
	var side := int(ceilf(sqrt(float(count))))
	var chest := PackedByteArray()
	var head := PackedByteArray()
	for _s in NavTuning.DIRECTION_COUNT:
		chest.append(int(CoverProvider.Quality.HIGH))
		head.append(int(CoverProvider.Quality.HIGH))
	var offset := float(side) * spacing_m * 0.5
	var added := 0
	for gx in side:
		for gz in side:
			if added >= count:
				break
			cloud.append_point(
				Vector3(float(gx) * spacing_m - offset, 0.0,
					float(gz) * spacing_m - offset),
				chest, head, 0)
			added += 1
	cloud.rebuild_index()
	return cloud


## Nube de un solo punto con las calidades que se le pasen, para probar la
## puntuación sin depender del horneado.
static func single_point_cloud(position: Vector3,
		qualities: PackedByteArray) -> CoverPointCloud:
	var cloud := CoverPointCloud.new()
	cloud.append_point(position, qualities, qualities, 0)
	cloud.rebuild_index()
	return cloud


## 8 calidades con `quality` en `sector` y NONE en el resto.
static func quality_in_sector(sector: int,
		quality: CoverProvider.Quality) -> PackedByteArray:
	var out := PackedByteArray()
	for s in NavTuning.DIRECTION_COUNT:
		out.append(int(quality) if s == sector else int(CoverProvider.Quality.NONE))
	return out


## Geometría de origen para hornear el navmesh de una escena de mapa
## convertida, LEÍDA SIN ÁRBOL DE ESCENA.
##
## `NavigationServer3D.parse_source_geometry_data` exige que el nodo raíz esté
## dentro del árbol, y las pruebas corren dentro del `_ready` del ejecutor,
## donde `add_child` está prohibido. Como el conversor exporta la geometría en
## propiedades de texto (`floor_vertices`/`floor_indices` y los `BoxShape3D` de
## cada muro), se puede leer directamente: menos cómodo, pero determinista y
## sin depender del ciclo de vida de los nodos.
static func source_from_map(root: Node) -> NavigationMeshSourceGeometryData3D:
	var source := NavigationMeshSourceGeometryData3D.new()
	var floor_node := root.get_node_or_null(^"Floor")
	if floor_node != null:
		var vertices: PackedVector3Array = floor_node.get(&"floor_vertices")
		var indices: PackedInt32Array = floor_node.get(&"floor_indices")
		var faces := PackedVector3Array()
		for i in range(0, indices.size() - 2, 3):
			_emit_upward(faces, vertices[indices[i]], vertices[indices[i + 1]],
				vertices[indices[i + 2]])
		if not faces.is_empty():
			source.add_faces(faces, Transform3D.IDENTITY)
	for entry: Array in collect_map_boxes(root):
		var transform: Transform3D = entry[0]
		var size: Vector3 = entry[1]
		source.add_faces(box_faces(AABB(-size * 0.5, size)), transform)
	return source


## Emite un triángulo con la normal hacia ARRIBA. El conversor ya orienta el
## suelo, pero Recast descarta en silencio las caras que miran hacia abajo, así
## que no se da por supuesto.
static func _emit_upward(out: PackedVector3Array, a: Vector3, b: Vector3,
		c: Vector3) -> void:
	if ((a - c).cross(a - b)).y >= 0.0:
		out.append_array(PackedVector3Array([a, b, c]))
	else:
		out.append_array(PackedVector3Array([a, c, b]))


## Todos los `BoxShape3D` de la escena, con su transformada acumulada. Es la
## geometría que bloquea rayos y navegación en los mapas convertidos.
static func collect_map_boxes(root: Node) -> Array[Array]:
	var out: Array[Array] = []
	_collect_boxes_into(out, root, Transform3D.IDENTITY)
	return out


static func _collect_boxes_into(out: Array[Array], node: Node,
		parent_transform: Transform3D) -> void:
	var transform := parent_transform
	var spatial := node as Node3D
	if spatial != null:
		transform = parent_transform * spatial.transform
	var collision := node as CollisionShape3D
	if collision != null:
		var box := collision.shape as BoxShape3D
		if box != null:
			out.append([transform, box.size])
	for child: Node in node.get_children():
		_collect_boxes_into(out, child, transform)


## Mundo sintético equivalente a una escena de mapa: los muros como cajas
## orientadas y una losa de suelo bajo el navmesh, para que la sonda vertical
## del horneado de cobertura encuentre el suelo real.
static func world_from_map(root: Node, mesh: NavigationMesh) -> NavSyntheticWorld:
	var world := NavSyntheticWorld.new()
	world.mesh = mesh
	var bounds := NavmeshSampler.bounds_of(mesh).grow(2.0)
	world.boxes = [AABB(
		Vector3(bounds.position.x, -0.5, bounds.position.z),
		Vector3(bounds.size.x, 0.5, bounds.size.z))] as Array[AABB]
	for entry: Array in collect_map_boxes(root):
		world.add_oriented_box(entry[0] as Transform3D, entry[1] as Vector3)
	return world
