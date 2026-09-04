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
