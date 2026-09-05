extends TestCase
## Los modelos CC0 nuevos y el conmutador entre estilos.

const ARCHETYPES: Array[StringName] = [
	&"captain", &"technician", &"specialist", &"demolition",
	&"enemy_thug", &"enemy_militiaman", &"enemy_veteran",
	&"miniboss", &"megaboss",
]


func test_every_archetype_has_a_modern_model() -> void:
	for arch: StringName in ARCHETYPES:
		assert_true(PresentationStyle.has_modern_model(arch),
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
	var original := PresentationStyle.chutaos_mode
	PresentationStyle.chutaos_mode = true
	var retro := PresentationStyle.scene_path_for(&"captain")
	PresentationStyle.chutaos_mode = false
	var modern := PresentationStyle.scene_path_for(&"captain")
	assert_ne(retro, modern, "cada estilo debe dar una escena distinta")
	assert_true(retro.contains("scenes/models/"))
	assert_true(modern.contains("models_modern"))
	PresentationStyle.chutaos_mode = original


func test_the_switch_emits_a_signal_so_the_world_can_react() -> void:
	# Los personajes ya instanciados tienen que poder cambiar de modelo en
	# caliente: sin señal, el truco solo afectaría a los que nazcan después.
	var seen: Array = []
	var original := PresentationStyle.chutaos_mode
	var cb := func(retro: bool) -> void: seen.append(retro)
	PresentationStyle.style_changed.connect(cb)
	PresentationStyle.chutaos_mode = not original
	PresentationStyle.style_changed.disconnect(cb)
	assert_size(seen, 1, "cambiar de estilo debe emitir la señal una vez")
	PresentationStyle.chutaos_mode = original


func test_setting_the_same_style_twice_does_not_emit() -> void:
	var seen: Array = []
	var cb := func(_r: bool) -> void: seen.append(true)
	PresentationStyle.style_changed.connect(cb)
	var current := PresentationStyle.chutaos_mode
	PresentationStyle.chutaos_mode = current
	PresentationStyle.style_changed.disconnect(cb)
	assert_size(seen, 0, "no debe emitir si el estilo no cambia")


func test_the_cc0_licence_travels_with_the_models() -> void:
	# Los modelos son CC0 de Kenney: la licencia va al lado, no en un README
	# que alguien pueda separar de los ficheros.
	assert_true(ResourceLoader.exists(
		"res://assets/models/characters_modern/LICENSE-Kenney-CC0.txt")
		or FileAccess.file_exists(
			"res://assets/models/characters_modern/LICENSE-Kenney-CC0.txt"),
		"la licencia CC0 debe acompañar a los modelos")


func test_every_modern_character_actually_has_its_texture() -> void:
	# Los nueve comparten cuerpo: son el mismo modelo de Kenney con nueve
	# skins. La textura es LO ÚNICO que distingue a un compañero de un enemigo,
	# así que un material sin ella no es un detalle de acabado — deja el juego
	# sin la información más básica que necesita el jugador.
	#
	# Pasó de verdad: las texturas se copiaron después de la primera
	# importación, la caché no se refrescó y los nueve salían de un blanco
	# idéntico. Cargaban, traían sus 27 animaciones y todas las pruebas
	# pasaban. Se vio en una captura.
	for arch: StringName in ARCHETYPES:
		for material: StandardMaterial3D in _materials_of(arch):
			assert_not_null(material.albedo_texture,
				"'%s' se queda sin textura: sería un muñeco blanco más" % arch)


func test_no_two_archetypes_share_the_same_skin() -> void:
	# Si dos arquetipos acabaran con la misma skin, serían indistinguibles en
	# pantalla aunque cada uno cargue su propio fichero.
	var seen: Dictionary[String, StringName] = {}
	for arch: StringName in ARCHETYPES:
		for material: StandardMaterial3D in _materials_of(arch):
			if material.albedo_texture == null:
				continue
			var path := material.albedo_texture.resource_path
			if path.is_empty():
				continue
			assert_false(seen.has(path) and seen[path] != arch,
				"'%s' y '%s' usan la misma skin (%s)" % [seen.get(path, &""), arch, path])
			seen[path] = arch
	assert_gt(float(seen.size()), 1.0, "no se ha podido leer ninguna skin")


func _materials_of(archetype: StringName) -> Array[StandardMaterial3D]:
	var out: Array[StandardMaterial3D] = []
	var packed := load("res://scenes/models_modern/%s.tscn" % archetype) as PackedScene
	if packed == null:
		return out
	var node := packed.instantiate()
	for mesh_node: Node in _mesh_instances(node):
		var mesh := (mesh_node as MeshInstance3D).mesh
		if mesh == null:
			continue
		for i: int in range(mesh.get_surface_count()):
			var material := mesh.surface_get_material(i) as StandardMaterial3D
			if material != null:
				out.append(material)
	node.free()
	return out


func _mesh_instances(node: Node) -> Array[Node]:
	var out: Array[Node] = []
	if node is MeshInstance3D:
		out.append(node)
	for child: Node in node.get_children():
		out.append_array(_mesh_instances(child))
	return out
