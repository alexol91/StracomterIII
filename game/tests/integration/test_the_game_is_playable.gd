extends TestCase
## Las piezas que convierten «un montón de sistemas probados» en un juego.
##
## Todo lo que hay aquí estuvo escrito, probado y DESCONECTADO durante mucho
## tiempo: el director sin nodo en la escena, los cerebros sin nadie que los
## montara, los modelos sin nadie que los instanciara. Cada prueba de este
## fichero fija una de esas conexiones, porque el fallo de una conexión que
## falta no se parece a un fallo: se parece a un juego vacío.

const MAP: String = "res://maps/legacy/mapP1.tscn"


func _tree() -> SceneTree:
	return Engine.get_main_loop() as SceneTree


# --- La escena principal trae todas las piezas ---

func test_the_main_scene_wires_director_ai_and_encounter() -> void:
	var main := (load("res://scenes/main.tscn") as PackedScene).instantiate()
	_tree().root.add_child(main)
	for node_name: String in ["AIRuntime", "EncounterDirector", "EncounterRuntime"]:
		assert_not_null(main.get_node_or_null(node_name),
			"sin %s la planta se carga vacía" % node_name)
	var runner := main.get_node("FloorRunner") as FloorRunner
	assert_not_null(runner.get_node_or_null(runner.director_path),
		"`FloorRunner.director_path` apuntaba a la nada y toda zona se daba por limpia")
	_tree().root.remove_child(main)
	main.free()


# --- La IA se monta sobre una planta de verdad ---

func test_the_ai_stack_builds_on_a_real_floor() -> void:
	var map := (load(MAP) as PackedScene).instantiate() as Node3D
	_tree().root.add_child(map)
	var runtime := AIRuntime.new()
	_tree().root.add_child(runtime)
	runtime.build_for_level(map)

	assert_true(runtime.is_ready_for_bots(), "la pila de IA debe quedar completa")
	assert_gt(runtime.navigable_area_m2(), 10.0, "el navmesh no puede salir vacío")
	assert_not_null(runtime.cover, "sin nube de coberturas los bots no se parapetan")
	assert_gt(float(runtime.cover.point_count()), 0.0, "la nube no puede estar vacía")
	assert_not_null(runtime.spawn_provider, "sin muestreador no hay apariciones")
	assert_true(runtime.spawn_provider.is_ready(), "el muestreador debe declararse listo")

	runtime.teardown()
	_tree().root.remove_child(runtime)
	runtime.free()
	_tree().root.remove_child(map)
	map.queue_free()


func test_bots_get_a_patrol_route_so_they_are_not_statues() -> void:
	# Sin ruta, el árbol de PATROL no tiene a dónde ir: un enemigo que no ha
	# visto ni oído nada no se mueve JAMÁS y el jugador recorre la planta
	# encontrándose maniquíes.
	var map := (load(MAP) as PackedScene).instantiate() as Node3D
	_tree().root.add_child(map)
	var runtime := AIRuntime.new()
	_tree().root.add_child(runtime)
	runtime.build_for_level(map)

	var enemy := (load("res://scenes/gameplay/enemy.tscn") as PackedScene).instantiate() as Character
	map.add_child(enemy)
	var brain := runtime.brain_of(enemy)
	assert_not_null(brain, "todo enemigo debe recibir su cerebro al nacer")
	if brain != null:
		assert_true(brain.is_registered(), "y quedar registrado en el planificador")
		assert_gt(float(brain.context.patrol_points.size()), 1.0,
			"con menos de dos puntos no hay ronda que recorrer")

	runtime.teardown()
	_tree().root.remove_child(runtime)
	runtime.free()
	_tree().root.remove_child(map)
	map.queue_free()


# --- El director pide enemigos para la primera zona del juego ---

func test_floor_one_zone_one_is_not_empty() -> void:
	# La regresión más cara de todas: con el área del NAVMESH (53 m²) en vez de
	# la del plano (112 m²), el Simplex pedía CERO enemigos justo en la primera
	# zona del juego, y la planta se daba por limpia al instante.
	var cfg := Balance.floor_config(1)
	assert_not_null(cfg)
	var context := EncounterContext.new()
	context.floor_number = 1
	context.zone = 1
	context.navigable_area_m2 = 111.98  # metadata/area_m2 de mapP1
	context.floor_difficulty = cfg.base_difficulty
	context.allowed_archetypes = cfg.enemy_pool.duplicate()
	context.seed = 12345
	var composer := EncounterComposer.new(Balance.director_profile())
	var composition := composer.compose(context)
	assert_gt(float(composition.total()), 0.0,
		"la primera zona del juego no puede componerse vacía")


# --- Aparecer es justo, también en un mapa pequeño ---

func test_a_small_zone_still_admits_enemies_without_becoming_unfair() -> void:
	# En `mapP1` (14 × 9 m) ningún punto llega a estar a los 12 m nominales del
	# jugador. Sin relajación acotada la zona no admite un solo enemigo; con
	# ella, sigue sin admitir nada por debajo del suelo del perfil.
	var profile := Balance.director_profile()
	assert_not_null(profile)
	assert_gt(profile.min_spawn_distance_m, profile.min_spawn_distance_floor_m,
		"el suelo tiene que ser más permisivo que el valor nominal, no al revés")
	assert_gt(profile.min_spawn_distance_floor_m, 0.0,
		"un suelo de cero sería aparecer encima del jugador")


func test_the_relaxation_never_touches_the_other_three_rules() -> void:
	# La distancia se puede negociar con el tamaño del mapa. Que el punto sea
	# navegable, que esté fuera del cono de visión y que no tenga línea de
	# visión, no.
	var profile := Balance.director_profile()
	assert_true(profile.forbid_spawn_in_player_fov,
		"nadie debe materializarse dentro del cono de visión del jugador")
	assert_true(profile.forbid_spawn_with_line_of_sight,
		"ni a la vista")


# --- Los personajes llevan su modelo ---

func test_characters_wear_their_model_instead_of_a_coloured_capsule() -> void:
	var enemy := (load("res://scenes/gameplay/enemy.tscn") as PackedScene).instantiate() as Character
	_tree().root.add_child(enemy)
	assert_not_null(enemy.get_node_or_null("Model"),
		"el personaje debe montar el modelo de su arquetipo")
	var capsule := enemy.get_node_or_null("BodyMesh") as MeshInstance3D
	if capsule != null:
		assert_false(capsule.visible, "y esconder la cápsula de bloqueo")
	_tree().root.remove_child(enemy)
	enemy.queue_free()


func test_a_character_standing_on_the_floor_has_its_feet_on_the_floor() -> void:
	# El origen del personaje tiene que ser SUS PIES. Antes la cápsula del
	# torso empezaba 0,4 m por encima del origen, así que al apoyarse el origen
	# quedaba enterrado y cualquier modelo colocado ahí aparecía medio metro
	# dentro del suelo.
	var enemy := (load("res://scenes/gameplay/enemy.tscn") as PackedScene).instantiate() as Character
	_tree().root.add_child(enemy)
	var shape := enemy.get_node_or_null("TorsoShape") as CollisionShape3D
	assert_not_null(shape)
	if shape != null:
		var capsule := shape.shape as CapsuleShape3D
		assert_not_null(capsule)
		if capsule != null:
			var lowest := shape.position.y - capsule.height * 0.5
			assert_almost_eq(lowest, 0.0, 0.02,
				"la parte baja del cuerpo debe coincidir con el origen")
	_tree().root.remove_child(enemy)
	enemy.queue_free()
