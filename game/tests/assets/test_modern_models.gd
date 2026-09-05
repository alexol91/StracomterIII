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
	# Los modelos son CC0 de KayKit: la licencia va al lado, no en un README
	# que alguien pueda separar de los ficheros.
	var licence := "res://assets/models/characters_kaykit/LICENSE-KayKit-CC0.txt"
	assert_true(ResourceLoader.exists(licence) or FileAccess.file_exists(licence),
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
		var textured := 0
		for material: StandardMaterial3D in _materials_of(arch):
			if material.albedo_texture != null:
				textured += 1
		# Al menos uno, no todos: un modelo puede traer un material extra de
		# color liso —los ojos de los esqueletos de KayKit— y eso no es un
		# personaje sin textura. Lo que no puede es no traer NINGUNO.
		assert_gt(float(textured), 0.0,
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


func test_every_model_resolves_the_four_animation_intents() -> void:
	# Un paquete nuevo con otros nombres de clip no da error: `_play` comprueba
	# `has_animation`, no encuentra nada y se calla. El personaje se queda
	# inmóvil y parece un maniquí. Pasó al cambiar de Kenney a KayKit, y esta
	# prueba es la que lo habría dicho.
	var tree := Engine.get_main_loop() as SceneTree
	for arch: StringName in ARCHETYPES:
		var node := (load("res://scenes/models_modern/%s.tscn" % arch) as PackedScene).instantiate()
		tree.root.add_child(node)
		for intent: StringName in [&"idle", &"walk", &"sprint", &"die"]:
			assert_false(String(node.call("resolve_clip", intent)).is_empty(),
				"'%s' no tiene ningún clip para '%s'" % [arch, intent])
		tree.root.remove_child(node)
		node.free()


func test_the_models_are_roughly_human_sized() -> void:
	# Un modelo importado con la escala de otro programa entra a 1/100 o a 100x
	# y no da error: sale un personaje del tamaño de una silla, o uno que no
	# cabe en la planta. Los de KayKit vienen a 1,1 m y `ModernAnimator` los
	# normaliza a la altura del colisionador.
	var tree := Engine.get_main_loop() as SceneTree
	for arch: StringName in ARCHETYPES:
		var node := (load("res://scenes/models_modern/%s.tscn" % arch) as PackedScene).instantiate()
		tree.root.add_child(node)
		var height: float = node.call("standing_height")
		assert_almost_eq(height, ModernAnimator.TARGET_HEIGHT_M, 0.15,
			"'%s' mide %.2f m en pantalla" % [arch, height])
		tree.root.remove_child(node)
		node.free()


func test_the_gradient_atlas_is_sampled_without_blending() -> void:
	# El atlas de KayKit es diminuto y cada color son unos pocos píxeles: con
	# filtrado lineal los téxeles vecinos se mezclan y salen rosas y verdes que
	# no están en la paleta. No da ningún error, solo un personaje de otro
	# color.
	var tree := Engine.get_main_loop() as SceneTree
	for arch: StringName in ARCHETYPES:
		var node := (load("res://scenes/models_modern/%s.tscn" % arch) as PackedScene).instantiate()
		tree.root.add_child(node)
		for material: StandardMaterial3D in _materials_of(arch):
			assert_eq(int(material.texture_filter),
				int(BaseMaterial3D.TEXTURE_FILTER_NEAREST),
				"'%s' mezcla téxeles del atlas" % arch)
		tree.root.remove_child(node)
		node.free()


# --- Paquete de TF2, importado por el jugador y fuera del repositorio ---

func test_without_imported_models_the_game_falls_back_instead_of_emptying() -> void:
	# La carpeta de TF2 está en `.gitignore` y en una copia recién clonada está
	# vacía. Encender el paquete no puede dejar a los personajes invisibles: se
	# sigue viendo el modelo CC0. Ante la duda, algo en pantalla.
	var original := PresentationStyle.character_pack
	PresentationStyle.character_pack = PresentationStyle.Pack.TF2
	for arch: StringName in ARCHETYPES:
		var node := PresentationStyle.instantiate_model(arch)
		assert_not_null(node, "'%s' se queda sin modelo con el paquete TF2" % arch)
		if node != null:
			node.free()
	PresentationStyle.character_pack = original


func test_the_tf2_cheat_says_so_instead_of_turning_on_an_empty_mode() -> void:
	# Un truco que se declara activo y no cambia nada en pantalla es peor que
	# uno que se niega: el jugador se queda pensando que el juego está roto.
	var original := PresentationStyle.character_pack
	var out := DevConsole.execute(": tf2 on")
	if PresentationStyle.tf2_available():
		assert_true(out.contains("TF2"), "con modelos importados debe activarlos")
	else:
		assert_true(out.contains("import"),
			"sin modelos debe explicar cómo se importan")
		assert_eq(int(PresentationStyle.character_pack), int(PresentationStyle.Pack.UBC),
			"y no debe quedarse en un paquete vacío")
	PresentationStyle.character_pack = original


func test_the_valve_models_are_never_committed() -> void:
	# El repositorio es público: meter los modelos de Valve aquí no sería uso
	# privado no comercial sino redistribución. Esta prueba es la red por si
	# alguien los copia a mano y hace `git add -A` sin mirar.
	var dir := DirAccess.open(PresentationStyle.MODELS_TF2)
	if dir == null:
		return  # la carpeta ni existe: perfecto
	var ignore := FileAccess.open("res://../.gitignore", FileAccess.READ)
	assert_not_null(ignore, "hace falta un .gitignore que excluya esa carpeta")
	if ignore != null:
		assert_true(ignore.get_as_text().contains("characters_tf2"),
			"la carpeta de modelos de TF2 debe estar en .gitignore")
