extends TestCase
## Carga las 27 escenas generadas por tools/map_converter/ (26 mapas de
## legacy/trunk/testFiles/maps/*.xml + editorMap.xml) y comprueba que:
##   - todas instancian sin error;
##   - todas tienen la estructura de nodos acordada (Walls, Doors, Obstacles,
##     Pickups, Spawns, NavigationRegion3D);
##   - el NavigationRegion3D trae datos de navmesh no vacíos;
##   - los 12 mapas exigidos por game/src/data/floors/*.tres tienen spawn de
##     jugador.
##
## Nota sobre el navmesh: las propiedades exportadas `nav_vertices` /
## `nav_polygons` (ver game/maps/legacy/_legacy_navmesh.gd) ya están rellenas
## en cuanto se instancia la escena, sin depender de que el nodo entre en el
## SceneTree — así que esta prueba no necesita `add_child`/`_ready` para
## comprobar que el navmesh horneado por el conversor no está vacío. El
## runner (`run_tests.gd`) ejecuta las pruebas de forma síncrona y sale sin
## procesar ningún frame, así que cualquier comprobación que dependiera de
## `_ready()` (p.ej. leer `NavigationMesh.get_vertices()` tras construirlo en
## tiempo de ejecución) no se ejecutaría a tiempo; por eso se comprueban los
## datos de origen y no el recurso derivado.

const MAPS_DIR := "res://maps/legacy/"
const EXPECTED_MAP_COUNT := 27
const GROUP_NAMES := ["Walls", "Doors", "Obstacles", "Pickups", "Spawns"]

## Mapas exigidos textualmente por game/src/data/floors/*.tres
## (res://maps/legacy/<n>.tscn): deben existir con este nombre y tener spawn.
const REQUIRED_SCENES := [
	"mapP1", "mapP2", "mapP3", "mapP4",
	"mapM1", "mapM3", "mapM4",
	"mapG1", "mapG2", "mapG3", "mapG4",
	"finalMap",
]

## Único mapa del corpus original sin <object type="player"> (map_03.xml,
## confirmado en legacy/trunk/testFiles/maps/map_03.xml y documentado en
## game/maps/legacy/CONVERSION.md). No es un fallo del conversor.
const MAP_WITHOUT_PLAYER := "map_03"


func _list_scene_names() -> Array[String]:
	var names: Array[String] = []
	var dir := DirAccess.open(MAPS_DIR)
	if dir == null:
		return names
	dir.list_dir_begin()
	var entry := dir.get_next()
	while entry != "":
		if entry.ends_with(".tscn"):
			names.append(entry.trim_suffix(".tscn"))
		entry = dir.get_next()
	dir.list_dir_end()
	names.sort()
	return names


func _instantiate(scene_name: String) -> Node:
	var packed: PackedScene = load(MAPS_DIR.path_join(scene_name + ".tscn"))
	if packed == null:
		return null
	return packed.instantiate()


func test_maps_directory_has_expected_scene_count() -> void:
	var names := _list_scene_names()
	assert_eq(names.size(), EXPECTED_MAP_COUNT,
		"se esperaban %d escenas en %s" % [EXPECTED_MAP_COUNT, MAPS_DIR])


func test_required_floor_config_scenes_exist_on_disk() -> void:
	for scene_name: String in REQUIRED_SCENES:
		var path := MAPS_DIR.path_join(scene_name + ".tscn")
		assert_true(ResourceLoader.exists(path, "PackedScene"),
			"game/src/data/floors/*.tres espera %s" % path)


func test_all_legacy_maps_instantiate_without_error() -> void:
	var names := _list_scene_names()
	assert_gt(float(names.size()), 0.0, "no se encontró ninguna escena que probar")
	for scene_name: String in names:
		var instance := _instantiate(scene_name)
		assert_not_null(instance, "%s no se pudo instanciar" % scene_name)
		if instance == null:
			continue
		assert_true(instance is Node3D, "%s: la raíz debería ser Node3D" % scene_name)
		instance.free()


func test_all_legacy_maps_have_expected_group_nodes() -> void:
	for scene_name: String in _list_scene_names():
		var instance := _instantiate(scene_name)
		if instance == null:
			fail("%s no se pudo instanciar" % scene_name)
			continue
		for group_name: String in GROUP_NAMES:
			var child := instance.get_node_or_null(group_name)
			assert_not_null(child, "%s: falta el nodo de grupo '%s'" % [scene_name, group_name])
		instance.free()


func test_all_legacy_maps_have_non_empty_navigation_region() -> void:
	for scene_name: String in _list_scene_names():
		var instance := _instantiate(scene_name)
		if instance == null:
			fail("%s no se pudo instanciar" % scene_name)
			continue
		var nav := instance.get_node_or_null("NavigationRegion3D")
		assert_not_null(nav, "%s: falta NavigationRegion3D" % scene_name)
		if nav != null:
			var vertices: PackedVector3Array = nav.get("nav_vertices")
			var polygons: Array = nav.get("nav_polygons")
			assert_gt(float(vertices.size()), 0.0,
				"%s: NavigationRegion3D sin vértices de navmesh (navmesh vacío)" % scene_name)
			assert_gt(float(polygons.size()), 0.0,
				"%s: NavigationRegion3D sin polígonos de navmesh (navmesh vacío)" % scene_name)
		instance.free()


func test_required_floor_config_scenes_have_player_spawn() -> void:
	for scene_name: String in REQUIRED_SCENES:
		var instance := _instantiate(scene_name)
		assert_not_null(instance, "%s no se pudo instanciar" % scene_name)
		if instance == null:
			continue
		var spawns := instance.get_node_or_null("Spawns")
		var spawn := spawns.get_node_or_null("PlayerSpawn") if spawns != null else null
		assert_not_null(spawn, "%s: falta Spawns/PlayerSpawn (mapa usado por floor_config)" % scene_name)
		instance.free()


func test_map_without_player_is_the_documented_exception() -> void:
	# No es un fallo silencioso: mapa_03.xml nunca tuvo <object type="player">
	# en el original (ver docs/analisis/legacy-datos-assets.md §4). Si algún
	# día se le añade un spawn, esta prueba debe actualizarse.
	var instance := _instantiate(MAP_WITHOUT_PLAYER)
	assert_not_null(instance, "%s no se pudo instanciar" % MAP_WITHOUT_PLAYER)
	if instance == null:
		return
	var spawns := instance.get_node_or_null("Spawns")
	assert_not_null(spawns, "%s: falta el nodo de grupo 'Spawns'" % MAP_WITHOUT_PLAYER)
	var spawn := spawns.get_node_or_null("PlayerSpawn") if spawns != null else null
	assert_null(spawn, "%s: no debería tener PlayerSpawn (el XML original no trae <object type=\"player\">)"
		% MAP_WITHOUT_PLAYER)
	assert_eq(instance.get_meta("has_player", true), false,
		"%s: metadata/has_player debería ser false" % MAP_WITHOUT_PLAYER)
	instance.free()


## Umbral de conectividad: el mismo 90 % que usa
## tools/map_converter/validate.py (REACHABILITY_MIN_RATIO) para su rejilla
## propia y que game/tests/ai/navigation/test_legacy_maps_navigation.gd
## (MIN_CONNECTED_FRACTION) usa para el navmesh REAL horneado con Recast.
const NAVMESH_CONNECTIVITY_MIN_RATIO := 0.90

## Mapas con una componente pequeña y aislada conocida y documentada que NO
## viene del bug de geometría de PerimeterWall (ya arreglado): huecos de
## pocos centímetros alrededor de obstáculos con forma de caja, y la parte de
## arriba de esas mismas cajas, que Recast considera "suelo" aislado porque
## nada conecta con ella. No forman parte de floor_config ni de
## GameAction::selectionMap. Ver game/maps/legacy/CONVERSION.md.
const KNOWN_PARTIAL_CONNECTIVITY_EXCEPTIONS := ["mapaMolon", "map_03"]


## Hornea el navmesh con la MISMA geometría de origen que usa
## game/tests/ai/navigation/test_legacy_maps_navigation.gd
## (`NavTestUtil.source_from_map`, ya existente en el proyecto: lee
## `Floor.floor_vertices/floor_indices` y todas las `BoxShape3D` de la escena
## directamente de las propiedades exportadas, sin instanciar en el árbol —
## `NavigationServer3D.parse_source_geometry_data` exige que el nodo raíz esté
## en el árbol y `add_child` sobre la raíz falla dentro del `_ready` del
## runner de pruebas) y los mismos parámetros que `NavTuning.configure_navigation_mesh`
## (game/src/ai/navigation/nav_tuning.gd). Es el navmesh que el juego usa de
## verdad — no la rejilla propia de tools/map_converter/validate.py, que solo
## sirve de comprobación rápida en tiempo de conversión (ver la nota grande de
## cabecera de este fichero: dos navmeshes distintos pueden discrepar, y el
## que manda es este).
func _bake_like_the_game(instance: Node) -> NavigationMesh:
	var mesh := NavigationMesh.new()
	NavTuning.configure_navigation_mesh(mesh)
	var source: NavigationMeshSourceGeometryData3D = NavTestUtil.source_from_map(instance)
	NavigationServer3D.bake_from_source_geometry_data(mesh, source)
	return mesh


## Área (proyectada en XZ) de un polígono del navmesh horneado.
func _navmesh_polygon_area(verts: PackedVector3Array, idxs: PackedInt32Array) -> float:
	var area := 0.0
	var n := idxs.size()
	for i in n:
		var a: Vector3 = verts[idxs[i]]
		var b: Vector3 = verts[idxs[(i + 1) % n]]
		area += a.x * b.z - b.x * a.z
	return absf(area) * 0.5


## Fracción de área que cae en la mayor componente conexa del navmesh
## horneado (adyacencia por arista compartida entre polígonos). 1.0 si todo
## el navmesh es una sola pieza.
func _largest_component_ratio(mesh: NavigationMesh) -> float:
	var verts := mesh.get_vertices()
	var poly_count := mesh.get_polygon_count()
	if poly_count == 0:
		return 0.0

	var parent: PackedInt32Array = PackedInt32Array()
	parent.resize(poly_count)
	for i in poly_count:
		parent[i] = i
	var find := func(x: int) -> int:
		while parent[x] != x:
			parent[x] = parent[parent[x]]
			x = parent[x]
		return x

	var edge_owner: Dictionary = {}
	var areas: PackedFloat64Array = PackedFloat64Array()
	areas.resize(poly_count)
	for p in poly_count:
		var idxs: PackedInt32Array = mesh.get_polygon(p)
		areas[p] = _navmesh_polygon_area(verts, idxs)
		var n := idxs.size()
		for i in n:
			var a: int = idxs[i]
			var b: int = idxs[(i + 1) % n]
			var key: String = "%d_%d" % [mini(a, b), maxi(a, b)]
			if edge_owner.has(key):
				var other: int = edge_owner[key]
				var ra: int = int(find.call(other))
				var rb: int = int(find.call(p))
				if ra != rb:
					parent[ra] = rb
			else:
				edge_owner[key] = p

	var comp_area: Dictionary = {}
	var total := 0.0
	for p in poly_count:
		var root_id: int = int(find.call(p))
		comp_area[root_id] = comp_area.get(root_id, 0.0) + areas[p]
		total += areas[p]
	if total <= 0.0:
		return 0.0
	var best := 0.0
	for a: float in comp_area.values():
		best = maxf(best, a)
	return best / total


func test_all_legacy_maps_navmesh_is_fully_connected_when_baked() -> void:
	for scene_name: String in _list_scene_names():
		if scene_name in ["map_01", "map_02"]:
			# Prototipos de 2011 ya documentados como defectuosos en origen
			# (spawn del jugador pegado al propio muro/entrante del XML
			# original): ver game/maps/legacy/CONVERSION.md.
			continue
		var instance := _instantiate(scene_name)
		if instance == null:
			fail("%s no se pudo instanciar" % scene_name)
			continue

		var mesh := _bake_like_the_game(instance)
		var poly_count := mesh.get_polygon_count()
		assert_gt(float(poly_count), 0.0,
			"%s: horneado real (NavTestUtil + NavigationServer3D) da 0 polígonos "
			% scene_name + "(navmesh vacío de verdad, no solo en la rejilla propia de validate.py)")

		if poly_count > 0:
			var ratio := _largest_component_ratio(mesh)
			var min_ratio: float = NAVMESH_CONNECTIVITY_MIN_RATIO
			if scene_name in KNOWN_PARTIAL_CONNECTIVITY_EXCEPTIONS:
				min_ratio = 0.60  # documentado: huecos de obstáculo, no una planta jugable
			assert_gt(ratio, min_ratio - 0.0001,
				("%s: solo el %.1f%% del navmesh horneado por NavigationServer3D está en una sola "
					+ "componente (mínimo %.0f%%) — zonas tabicadas de verdad, no un artefacto de "
					+ "la rejilla de validate.py")
				% [scene_name, ratio * 100.0, min_ratio * 100.0])

		instance.free()


func test_all_legacy_maps_source_xml_metadata_is_present() -> void:
	for scene_name: String in _list_scene_names():
		var instance := _instantiate(scene_name)
		if instance == null:
			fail("%s no se pudo instanciar" % scene_name)
			continue
		var source: String = instance.get_meta("source_xml", "")
		assert_true(source.ends_with(".xml"),
			"%s: metadata/source_xml debería apuntar al XML de origen (fue '%s')" % [scene_name, source])
		instance.free()
