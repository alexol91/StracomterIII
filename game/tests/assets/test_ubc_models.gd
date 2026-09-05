extends TestCase
## Los personajes del paquete por defecto: cuerpos CC0 de Quaternius vestidos
## con los uniformes que hornea `tools/character_skins/`.
##
## Casi todo lo que puede salir mal aquí **no da error**: un rig que deja de
## coincidir da un personaje inmóvil, un material mal enrutado da nueve
## personajes vestidos igual, y un uniforme que no se aplicó deja al enemigo en
## ropa interior. Ninguna de las tres cosas rompe el juego, así que la única
## defensa es medirlas.

const ARCHETYPES: Array[StringName] = [
	&"captain", &"technician", &"specialist", &"demolition",
	&"enemy_thug", &"enemy_militiaman", &"enemy_veteran",
	&"miniboss", &"megaboss",
]


func test_every_archetype_has_a_body_and_a_uniform() -> void:
	for arch: StringName in ARCHETYPES:
		assert_true(UbcModel.has(arch), "'%s' no tiene cuerpo o uniforme" % arch)


func test_the_animation_library_matches_the_body_rig() -> void:
	# El fallo silencioso número uno: si los huesos dejaran de llamarse igual,
	# las pistas no resolverían y los nueve personajes se quedarían quietos sin
	# una sola línea en consola.
	var library := PresentationStyle.animation_library()
	assert_not_null(library, "no se pudo cargar la biblioteca de animaciones")
	if library == null:
		return
	var clips := library.get_animation_list()
	assert_gt(float(clips.size()), 30.0, "la biblioteca trae muy pocos clips")

	var animation := library.get_animation(clips[0])
	var bones: Dictionary[String, bool] = {}
	for index: int in range(animation.get_track_count()):
		var path := String(animation.track_get_path(index))
		var bone := path.get_slice(":", 1)
		if not bone.is_empty():
			bones[bone] = true
	assert_gt(float(bones.size()), 20.0, "el primer clip anima muy pocos huesos")

	var skeleton := _skeleton_of(&"captain")
	assert_not_null(skeleton, "el cuerpo no trae Skeleton3D")
	if skeleton == null:
		return
	var missing: Array[String] = []
	for bone: String in bones:
		if skeleton.find_bone(bone) < 0:
			missing.append(bone)
	assert_size(missing, 0,
		"la biblioteca anima huesos que el cuerpo no tiene: %s" % ", ".join(missing))


func test_the_locomotion_clips_loop() -> void:
	# Sin bucle, el personaje da un paso y se queda congelado en la última
	# pose. No falla nada; simplemente se ve absurdo.
	#
	# Se comprueban los clips POR SU NOMBRE EN EL JUEGO, no por el del fichero:
	# el importador de Godot recorta el sufijo `_Loop` al importar, así que
	# `Walk_Loop` aquí dentro ya se llama `Walk`. Buscar el sufijo dejaba la
	# prueba comprobando cero clips y dándose por buena.
	var library := PresentationStyle.animation_library()
	if library == null:
		return
	for clip: StringName in [&"Idle", &"Walk", &"Sprint", &"Pistol_Idle"]:
		assert_true(library.has_animation(clip), "falta el clip '%s'" % clip)
		if library.has_animation(clip):
			assert_ne(int(library.get_animation(clip).loop_mode), int(Animation.LOOP_NONE),
				"'%s' debería estar en bucle" % clip)
	assert_eq(int(library.get_animation(&"Death01").loop_mode), int(Animation.LOOP_NONE),
		"morirse no se repite")


func test_a_built_character_resolves_the_four_locomotion_clips() -> void:
	var node := _build(&"captain")
	assert_not_null(node)
	if node == null:
		return
	var animator := node as ModernAnimator
	assert_gt(float(animator.frame_count()), 30.0, "el personaje no trae clips")
	for clip: StringName in [ModernAnimator.CLIP_IDLE, ModernAnimator.CLIP_WALK,
			ModernAnimator.CLIP_SPRINT, ModernAnimator.CLIP_DIE,
			ModernAnimator.CLIP_SHOOT]:
		assert_false(animator.resolve_clip(clip).is_empty(),
			"no se resuelve el clip '%s'" % clip)
	_drop(node)


func test_the_body_is_scaled_to_the_collision_capsule() -> void:
	# Si el modelo no mide lo que su cuerpo físico, o flota o se hunde, y el
	# jugador dispara a un sitio distinto del que ve.
	var node := _build(&"captain")
	if node == null:
		return
	assert_almost_eq((node as ModernAnimator).standing_height(),
		ModernAnimator.TARGET_HEIGHT_M, 0.05, "el personaje no mide 1,8 m")
	_drop(node)


func test_the_uniform_is_actually_worn() -> void:
	# El material del `.gltf` es COMPARTIDO por todos los que usen el mismo
	# cuerpo. Si el uniforme no se pusiera como override, el enemigo saldría en
	# ropa interior y no habría ningún aviso.
	for arch: StringName in ARCHETYPES:
		var node := _build(arch)
		assert_not_null(node, "'%s' no se construye" % arch)
		if node == null:
			continue
		var mesh := _body_mesh(node)
		assert_not_null(mesh, "'%s' no tiene malla de cuerpo" % arch)
		if mesh != null:
			var material := mesh.get_surface_override_material(0)
			assert_not_null(material, "'%s' no lleva uniforme puesto" % arch)
			if material != null:
				assert_eq(material.resource_name, String(arch),
					"'%s' lleva el uniforme de otro" % arch)
		_drop(node)


func test_the_nine_uniforms_are_nine_different_textures() -> void:
	# Un error de ruta en el generador daría nueve personajes idénticos, que es
	# exactamente lo que el paquete base ya hacía.
	var seen: Dictionary[String, StringName] = {}
	for arch: StringName in ARCHETYPES:
		var material := load(UbcModel.material_path_for(arch)) as StandardMaterial3D
		assert_not_null(material, "falta el material de '%s'" % arch)
		if material == null or material.albedo_texture == null:
			assert_true(false, "'%s' no tiene textura de albedo" % arch)
			continue
		var path := material.albedo_texture.resource_path
		assert_false(seen.has(path),
			"'%s' comparte textura con '%s'" % [arch, seen.get(path, &"")])
		seen[path] = arch


func test_the_uniforms_are_clothes_and_not_skin() -> void:
	# El cuerpo base viene en ropa interior. Se mide que el torso del uniforme
	# se aleja del tono de piel del original: sin esta comprobación, un
	# horneado que fallara en silencio dejaría a los nueve desnudos.
	var base := (load("res://assets/models/characters_ubc/T_Superhero_Male_Dark.png")
		as Texture2D).get_image()
	var painted := ((load(UbcModel.material_path_for(&"captain")) as StandardMaterial3D)
		.albedo_texture as Texture2D).get_image()
	assert_eq(painted.get_width(), base.get_width(), "las dos texturas deben medir igual")
	var different := 0
	var total := 0
	for y: int in range(0, base.get_height(), 8):
		for x: int in range(0, base.get_width(), 8):
			total += 1
			var a := base.get_pixel(x, y)
			var b := painted.get_pixel(x, y)
			var delta := absf(a.r - b.r) + absf(a.g - b.g) + absf(a.b - b.b)
			if delta > 0.12:
				different += 1
	assert_gt(float(different) / float(maxi(total, 1)), 0.30,
		"el uniforme apenas cambia el cuerpo: ¿se horneó de verdad?")


func test_pbr_bodies_do_not_use_the_pixel_filter() -> void:
	# NEAREST es lo que necesita el atlas diminuto de KayKit y lo que arruina
	# una textura PBR de 1024. Es un dato del paquete, no una preferencia.
	var node := _build(&"captain")
	if node == null:
		return
	assert_false((node as ModernAnimator).atlas_filter,
		"los cuerpos PBR deben usar filtrado lineal")
	_drop(node)


func test_the_default_pack_is_the_quaternius_one() -> void:
	assert_eq(int(PresentationStyle.character_pack), int(PresentationStyle.Pack.UBC))


func test_the_cc0_licence_travels_with_the_assets() -> void:
	var licence := FileAccess.open(
		"res://assets/models/characters_ubc/LICENCIA-Quaternius-CC0.txt", FileAccess.READ)
	assert_not_null(licence, "falta el fichero de licencia del paquete")
	if licence != null:
		assert_true(licence.get_as_text().contains("CC0"),
			"la licencia debe decir CC0")


# --- utilidades -------------------------------------------------------------

func _build(archetype: StringName) -> Node3D:
	var node := UbcModel.build(archetype, PresentationStyle.animation_library())
	if node == null:
		return null
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	return node


func _drop(node: Node3D) -> void:
	(Engine.get_main_loop() as SceneTree).root.remove_child(node)
	node.free()


func _skeleton_of(archetype: StringName) -> Skeleton3D:
	var packed := load(UbcModel.base_path_for(archetype)) as PackedScene
	if packed == null:
		return null
	var root := packed.instantiate()
	var skeleton := root.get_node_or_null(UbcModel.SKELETON_PATH) as Skeleton3D
	var copy: Skeleton3D = null
	if skeleton != null:
		copy = skeleton.duplicate() as Skeleton3D
	root.free()
	return copy


func _body_mesh(node: Node) -> MeshInstance3D:
	var mesh := node as MeshInstance3D
	if mesh != null and UbcModel.BODY_MESH_NAMES.has(String(mesh.name)):
		return mesh
	for child: Node in node.get_children():
		var found := _body_mesh(child)
		if found != null:
			return found
	return null
