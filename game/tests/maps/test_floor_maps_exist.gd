extends TestCase
## Toda escena que una planta promete tiene que existir.
##
## `floor_9.tres` apuntaba a `res://maps/legacy/rooftop.tscn` y ese fichero no
## existía: la azotea del combate final no estaba construida —el original
## acababa la torre en `finalMap` y nunca tuvo azotea—, así que llegar a la
## planta 9 era llegar a un `load()` nulo. Ninguna prueba lo cogía porque las
## de mapas recorren el directorio `legacy/` y comprueban lo que HAY, no lo
## que los datos de balanceo PIDEN.
##
## Esta prueba mira desde el otro lado: de las nueve plantas hacia las escenas.


func test_every_zone_of_every_floor_points_at_a_scene_that_exists() -> void:
	for number: int in range(GameState.FIRST_FLOOR, GameState.ROOFTOP_FLOOR + 1):
		var cfg := Balance.floor_config(number)
		assert_not_null(cfg, "falta la configuración de la planta %d" % number)
		if cfg == null:
			continue
		assert_eq(cfg.zone_maps.size(), GameState.ZONES_PER_FLOOR,
			"la planta %d no declara sus %d zonas" % [number, GameState.ZONES_PER_FLOOR])
		for index: int in range(cfg.zone_maps.size()):
			var path: String = cfg.zone_maps[index]
			assert_true(ResourceLoader.exists(path),
				"planta %d zona %d apunta a '%s', que no existe"
					% [number, index + 1, path])


func test_the_rooftop_is_the_only_open_air_floor() -> void:
	# El marcador `exterior` es lo que apaga las luminarias de techo y enciende
	# la noche. Si un mapa interior lo llevara, la planta se quedaría a oscuras.
	for number: int in range(GameState.FIRST_FLOOR, GameState.ROOFTOP_FLOOR + 1):
		var cfg := Balance.floor_config(number)
		if cfg == null or cfg.zone_maps.is_empty():
			continue
		var scene := load(cfg.zone_maps[0]) as PackedScene
		assert_not_null(scene, "la planta %d no carga" % number)
		if scene == null:
			continue
		var map := scene.instantiate()
		var exterior := bool(map.get_meta(&"exterior", false))
		assert_eq(exterior, number == GameState.ROOFTOP_FLOOR,
			"planta %d: exterior=%s" % [number, str(exterior)])
		map.free()


func test_the_rooftop_can_be_fought_in() -> void:
	# Lo que hace jugable una azotea: suelo, navegación, spawn de jugador y
	# marcador de MegaBoss. Sin el último, el combate final no tiene jefe y la
	# torre se acaba sin acabarse.
	var scene := load("res://maps/rooftop.tscn") as PackedScene
	assert_not_null(scene, "la azotea tiene que cargar")
	if scene == null:
		return
	var map := scene.instantiate()
	assert_true(bool(map.get_meta(&"has_mega_boss", false)), "la azotea trae MegaBoss")
	assert_gt(float(map.get_meta(&"area_m2", 0.0)), 400.0,
		"un combate final no cabe en un pasillo")
	assert_not_null(map.get_node_or_null(^"Spawns/PlayerSpawn"), "spawn de jugador")
	assert_not_null(map.get_node_or_null(^"Spawns/MegaBossSpawn"), "marcador del jefe")
	var region := map.get_node_or_null(^"NavigationRegion3D")
	assert_not_null(region, "sin navegación no llega nadie")
	if region != null:
		var vertices: Variant = region.get(&"nav_vertices")
		assert_true(vertices is PackedVector3Array and (vertices as PackedVector3Array).size() > 0,
			"el navmesh de la azotea no puede estar vacío")
	map.free()
