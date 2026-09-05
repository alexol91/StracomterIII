extends TestCase
## Los modelos CC0 nuevos y el conmutador entre estilos.

const ARCHETYPES: Array[StringName] = [
	&"captain", &"technician", &"specialist", &"demolition",
	&"enemy_thug", &"enemy_militiaman", &"enemy_veteran",
	&"miniboss", &"megaboss",
]


func test_every_archetype_has_a_modern_model() -> void:
	for arch: StringName in ARCHETYPES:
		assert_true(ModelStyle.has_modern(arch),
			"falta el modelo nuevo de '%s'" % arch)


func test_modern_scenes_load_and_bring_animations() -> void:
	# La ventaja real de los modelos nuevos sobre los cinco fotogramas de 2012
	# es que traen animación de verdad. Si un modelo entra sin clips, el cambio
	# no aporta nada y conviene saberlo.
	for arch: StringName in ARCHETYPES:
		var packed := load("res://scenes/models_modern/%s.tscn" % arch) as PackedScene
		assert_not_null(packed, "la escena moderna de '%s' no carga" % arch)
		if packed == null:
			continue
		var node := packed.instantiate()
		var tree := Engine.get_main_loop() as SceneTree
		tree.root.add_child(node)
		assert_gt(float(node.frame_count()), 1.0,
			"'%s' debería traer varios clips de animación" % arch)
		tree.root.remove_child(node)
		node.free()


func test_both_styles_expose_the_same_interface() -> void:
	# Es lo que permite conmutar sin que el resto del juego se entere.
	for method: String in ["frame_count", "stop_at_idle"]:
		for path: String in ["res://scenes/models/captain.tscn",
				"res://scenes/models_modern/captain.tscn"]:
			var node := (load(path) as PackedScene).instantiate()
			assert_true(node.has_method(method),
				"%s debe exponer %s()" % [path, method])
			node.free()


func test_the_style_switch_picks_a_different_scene() -> void:
	var original := ModelStyle.retro_enabled
	ModelStyle.retro_enabled = true
	var retro := ModelStyle.scene_path_for(&"captain")
	ModelStyle.retro_enabled = false
	var modern := ModelStyle.scene_path_for(&"captain")
	assert_ne(retro, modern, "cada estilo debe dar una escena distinta")
	assert_true(retro.contains("scenes/models/"))
	assert_true(modern.contains("models_modern"))
	ModelStyle.retro_enabled = original


func test_the_switch_emits_a_signal_so_the_world_can_react() -> void:
	# Los personajes ya instanciados tienen que poder cambiar de modelo en
	# caliente: sin señal, el truco solo afectaría a los que nazcan después.
	var seen: Array = []
	var original := ModelStyle.retro_enabled
	var cb := func(retro: bool) -> void: seen.append(retro)
	ModelStyle.style_changed.connect(cb)
	ModelStyle.retro_enabled = not original
	ModelStyle.style_changed.disconnect(cb)
	assert_size(seen, 1, "cambiar de estilo debe emitir la señal una vez")
	ModelStyle.retro_enabled = original


func test_setting_the_same_style_twice_does_not_emit() -> void:
	var seen: Array = []
	var cb := func(_r: bool) -> void: seen.append(true)
	ModelStyle.style_changed.connect(cb)
	var current := ModelStyle.retro_enabled
	ModelStyle.retro_enabled = current
	ModelStyle.style_changed.disconnect(cb)
	assert_size(seen, 0, "no debe emitir si el estilo no cambia")


func test_the_cc0_licence_travels_with_the_models() -> void:
	# Los modelos son CC0 de Kenney: la licencia va al lado, no en un README
	# que alguien pueda separar de los ficheros.
	assert_true(ResourceLoader.exists(
		"res://assets/models/characters_modern/LICENSE-Kenney-CC0.txt")
		or FileAccess.file_exists(
			"res://assets/models/characters_modern/LICENSE-Kenney-CC0.txt"),
		"la licencia CC0 debe acompañar a los modelos")
