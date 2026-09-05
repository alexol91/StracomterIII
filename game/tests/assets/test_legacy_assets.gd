extends TestCase
## Comprueba que los assets del proyecto de 2012 están de verdad en el juego.
##
## No basta con que los ficheros existan: un .gltf mal generado importa sin
## quejarse y produce una malla vacía. Aquí se cuentan vértices.

const CHARACTERS: Array[StringName] = [
	&"captain", &"technician", &"specialist", &"demolition",
	&"enemy_thug", &"enemy_militiaman", &"enemy_veteran",
	&"miniboss", &"megaboss",
]

const PROPS: Array[String] = [
	"mesa", "desk", "sillon", "sofa", "sillaEspera",
	"estanteria", "plant", "mesaSillas", "hpack", "ammo_pack",
]


func test_every_archetype_has_its_five_animation_frames() -> void:
	# El original animaba con cinco mallas por personaje
	# (ResourceManager registraba los modelos como tipo * 5 + fotograma).
	for arch: StringName in CHARACTERS:
		var dir := "res://assets/models/characters/%s/" % arch
		var found := 0
		for file: String in DirAccess.get_files_at(dir):
			if file.trim_suffix(".remap").ends_with(".gltf"):
				found += 1
		assert_eq(found, 5, "el arquetipo '%s' debe tener 5 fotogramas" % arch)


func test_character_scenes_load_and_have_geometry() -> void:
	for arch: StringName in CHARACTERS:
		var path := "res://scenes/models/%s.tscn" % arch
		assert_true(ResourceLoader.exists(path), "falta la escena de '%s'" % arch)
		if not ResourceLoader.exists(path):
			continue
		var packed := load(path) as PackedScene
		assert_not_null(packed, "la escena de '%s' no carga" % arch)
		if packed == null:
			continue
		var node := packed.instantiate()
		assert_gt(float(_count_vertices(node)), 0.0,
			"el modelo de '%s' no tiene geometría" % arch)
		node.free()


func test_characters_are_roughly_human_sized() -> void:
	# Los modelos de 2012 medían ~93 unidades y a escala de mapa habrían salido
	# de 1,24 m: enanos junto a puertas de 2,1 m. Se normalizaron a 1,80 m.
	for arch: StringName in [&"captain", &"enemy_thug", &"megaboss"]:
		var packed := load("res://scenes/models/%s.tscn" % arch) as PackedScene
		if packed == null:
			continue
		var node := packed.instantiate()
		var aabb := _merged_aabb(node)
		assert_between(aabb.size.y, 1.5, 2.1,
			"la altura de '%s' debe ser de persona, y es %.2f m" % [arch, aabb.size.y])
		node.free()


func test_prop_models_exist_and_have_real_world_sizes() -> void:
	# El mobiliario sí venía en unidades del mapa, y a escala 1/75 da medidas
	# creíbles: escritorio ~1 m, estantería ~1,4 m.
	var expected_heights := {"desk": 1.02, "estanteria": 1.40, "mesa": 0.53}
	for prop: String in PROPS:
		var path := "res://assets/models/props/%s.gltf" % prop
		assert_true(ResourceLoader.exists(path), "falta el modelo '%s'" % prop)
	for prop: String in expected_heights:
		var packed := load("res://assets/models/props/%s.gltf" % prop) as PackedScene
		if packed == null:
			continue
		var node := packed.instantiate()
		var aabb := _merged_aabb(node)
		assert_almost_eq(aabb.size.y, float(expected_heights[prop]), 0.15,
			"la altura de '%s' no cuadra" % prop)
		node.free()


func test_both_sound_packs_are_complete() -> void:
	# El original elegía paquete por la presencia de un fichero joke.txt. Los
	# dos paquetes deben tener los mismos efectos o cambiar de uno a otro
	# dejaría mudo algún sonido.
	for pack: String in ["normal", "chutaos"]:
		for effect: String in ["pistol", "machine", "knife", "step", "dead", "ouch", "explosion"]:
			var path := "res://assets/audio/sfx/%s/%s.ogg" % [pack, effect]
			assert_true(ResourceLoader.exists(path),
				"falta '%s' en el paquete '%s'" % [effect, pack])


func test_the_team_own_credits_music_is_present() -> void:
	# credits.ogg lleva en sus metadatos ARTIST=Chutaos Team: la compuso el
	# equipo. Es la única música del original que se puede distribuir.
	assert_true(ResourceLoader.exists("res://assets/audio/music/credits.ogg"),
		"falta la música de créditos del equipo original")


func test_no_third_party_assets_were_imported() -> void:
	# Las texturas de personaje del original eran skins de Team Fortress 2 y su
	# música de menú y acción, dos temas de The Prodigy. Nada de eso entra.
	var forbidden: Array[String] = [
		"res://assets/textures/scout_flat.tga", "res://assets/textures/pyro_flat.tga",
		"res://assets/textures/medic_flat.tga", "res://assets/textures/spy_flat.tga",
		"res://assets/audio/music/LegendsOfLiberty.ogg",
		"res://assets/audio/music/andorga.ogg",
		"res://assets/audio/music/acdc.ogg",
		"res://assets/fonts/TF2.ttf", "res://assets/fonts/tf2build.ttf",
	]
	for path: String in forbidden:
		assert_false(ResourceLoader.exists(path),
			"se ha colado un asset de terceros: %s" % path)


func _count_vertices(node: Node) -> int:
	var total := 0
	var mesh_instance := node as MeshInstance3D
	if mesh_instance != null and mesh_instance.mesh != null:
		for surface: int in range(mesh_instance.mesh.get_surface_count()):
			total += mesh_instance.mesh.surface_get_arrays(surface)[Mesh.ARRAY_VERTEX].size()
	for child: Node in node.get_children():
		total += _count_vertices(child)
	return total


func _merged_aabb(node: Node) -> AABB:
	var result := AABB()
	var started := false
	for instance: Node in _all_mesh_instances(node):
		var mi := instance as MeshInstance3D
		if mi == null or mi.mesh == null:
			continue
		var box := mi.mesh.get_aabb()
		if not started:
			result = box
			started = true
		else:
			result = result.merge(box)
	return result


func _all_mesh_instances(node: Node) -> Array[Node]:
	var out: Array[Node] = []
	if node is MeshInstance3D:
		out.append(node)
	for child: Node in node.get_children():
		out.append_array(_all_mesh_instances(child))
	return out
