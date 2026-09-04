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
##
## FRONTERA ENTRE EL DOBLE Y LA REALIDAD, y no es una preferencia de estilo:
##   * `NavSyntheticWorld` vale para ESCENARIOS SINTÉTICOS PEQUEÑOS construidos
##     a mano (`fixture`, `cover_scenario`, `ring_scenario`), donde las cajas
##     son toda la geometría que hay y describirlas es lo cómodo y lo correcto.
##   * NUNCA vale para validar los mapas reales, y para eso está
##     `NavPhysicsWorld`: registra las formas de colisión de verdad y consulta
##     el `PhysicsDirectSpaceState3D`, que es lo que hace el juego.
##
## Aquí hubo un mundo de cajas para mapas reales (`world_from_map`,
## `collect_map_boxes`) y está BORRADO a propósito, no jubilado: se quedó VERDE
## cuando el conversor fundió el zócalo del perímetro en el trimesh del suelo,
## porque un mundo hecho sólo de `BoxShape3D` dejó de parecerse al mapa sin que
## ninguna prueba lo dijera. Medido después con física real, además subestimaba
## la cobertura en TODOS los mapas (mapP4: 15 puntos contra 33). Dejarlo
## disponible era dejar puesta la trampa.
##
## La regla general, que en este proyecto ya ha mordido tres veces: un doble
## más amable —o simplemente DISTINTO— de la realidad hace que las pruebas
## mientan, y el caso peor no es el doble mal escrito, es el doble que se
## queda atrás cuando la realidad cambia debajo.


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
## donde `add_child` está prohibido. Así que se leen las FORMAS DE COLISIÓN
## REALES —las mismas que parsearía el motor— tras construir las que la escena
## crea en su `_ready`.
##
## Se leen las formas y no las propiedades exportadas (`floor_vertices`) por lo
## mismo que el mundo de rayos usa física real: en cuanto el conversor movió el
## zócalo del perímetro al trimesh del suelo, cualquier lectura que sólo mirase
## cajas dejó de describir el mapa. Un origen de geometría que no es el del
## juego produce un navmesh que no es el del juego.
static func source_from_map(root: Node) -> NavigationMeshSourceGeometryData3D:
	var source := NavigationMeshSourceGeometryData3D.new()
	ensure_colliders_built(root)
	for entry: Array in collect_collision_shapes(root):
		var transform: Transform3D = entry[0]
		var shape: Shape3D = entry[1]
		var trimesh := shape as ConcavePolygonShape3D
		if trimesh != null:
			var faces := PackedVector3Array()
			var raw := trimesh.get_faces()
			for i in range(0, raw.size() - 2, 3):
				_emit_face(faces, raw[i], raw[i + 1], raw[i + 2])
			if not faces.is_empty():
				source.add_faces(faces, transform)
			continue
		var box := shape as BoxShape3D
		if box != null:
			source.add_faces(box_faces(AABB(-box.size * 0.5, box.size)), transform)
	return source


## Emite un triángulo sin suponer nada del bobinado de origen.
##
## Recast descarta EN SILENCIO las caras cuya normal no mira hacia arriba, así
## que las caras casi horizontales se fuerzan hacia +Y. Las verticales —el
## zócalo del perímetro, los laterales de un muro— se dejan como vienen: ahí la
## normal no decide si es caminable, y forzarlas hacia arriba sería inventar.
static func _emit_face(out: PackedVector3Array, a: Vector3, b: Vector3,
		c: Vector3) -> void:
	var normal := (a - c).cross(a - b)
	var horizontal := absf(normal.y) > 0.5 * normal.length()
	if horizontal and normal.y < 0.0:
		out.append_array(PackedVector3Array([a, c, b]))
	else:
		out.append_array(PackedVector3Array([a, b, c]))


## Emite un triángulo con la normal hacia ARRIBA. El conversor ya orienta el
## suelo, pero Recast descarta en silencio las caras que miran hacia abajo, así
## que no se da por supuesto.
static func _emit_upward(out: PackedVector3Array, a: Vector3, b: Vector3,
		c: Vector3) -> void:
	if ((a - c).cross(a - b)).y >= 0.0:
		out.append_array(PackedVector3Array([a, b, c]))
	else:
		out.append_array(PackedVector3Array([a, c, b]))



## Petición de aparición ya configurada. Los valores son de la prueba, no de
## `NavTuning`: las reglas de justicia son del `DirectorProfile` y quien las
## aplica es `SpawnPointProvider`.
static func spawn_request(player_position: Vector3, player_forward: Vector3,
		count: int, min_distance_m: float, fov_half_angle_deg: float,
		falloff_m: float, entry_bonus: float) -> SpawnPointProvider.SpawnRequest:
	var request := SpawnPointProvider.SpawnRequest.new()
	request.player_position = player_position
	request.player_forward = player_forward
	request.count = count
	request.min_distance_m = min_distance_m
	request.player_fov_half_angle_deg = fov_half_angle_deg
	request.path_distance_falloff_m = falloff_m
	request.entry_point_weight_bonus = entry_bonus
	request.forbid_in_player_fov = true
	request.forbid_line_of_sight = true
	request.prefer_entry_points = true
	request.configured = true
	return request


## Construye la colisión que las escenas de mapa crean en su `_ready`.
##
## `_legacy_floor_mesh.gd` monta su `ConcavePolygonShape3D` ahí, y las pruebas
## corren dentro del `_ready` del ejecutor, donde no se puede meter nada en el
## árbol. Llamar al `_ready` del nodo suelto sí funciona: lo que fallaba era
## `propagate_notification`, porque añade hijos mientras itera y el padre queda
## marcado como ocupado.
##
## Se limita a los `CollisionObject3D`: es donde vive la colisión perezosa y
## evita disparar `_ready` de nodos que no tienen nada que construir.
static func ensure_colliders_built(root: Node) -> int:
	var built := 0
	var pending: Array[Node] = [root]
	while not pending.is_empty():
		var node: Node = pending.pop_back()
		for child: Node in node.get_children():
			pending.append(child)
		if node is CollisionObject3D and node.get_script() != null \
				and node.has_method(&"_ready"):
			node.call(&"_ready")
			built += 1
	return built


## Todas las formas de colisión de la escena con su transformada acumulada,
## como `[Transform3D, Shape3D]`. Incluye el trimesh del suelo, que es
## justamente lo que un mundo de cajas se dejaba fuera.
static func collect_collision_shapes(root: Node) -> Array[Array]:
	var out: Array[Array] = []
	_collect_shapes_into(out, root, Transform3D.IDENTITY)
	return out


static func _collect_shapes_into(out: Array[Array], node: Node,
		parent_transform: Transform3D) -> void:
	var transform := parent_transform
	var spatial := node as Node3D
	if spatial != null:
		transform = parent_transform * spatial.transform
	var collision := node as CollisionShape3D
	if collision != null and collision.shape != null:
		out.append([transform, collision.shape])
	for child: Node in node.get_children():
		_collect_shapes_into(out, child, transform)
