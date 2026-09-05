extends TestCase
## La biblioteca de materiales del mundo y el nodo que la aplica.

const SURFACES: Array[WorldSurface.Kind] = [
	WorldSurface.Kind.FLOOR, WorldSurface.Kind.WALL, WorldSurface.Kind.CEILING,
	WorldSurface.Kind.DOOR, WorldSurface.Kind.GLASS, WorldSurface.Kind.TRIM,
	WorldSurface.Kind.PROP,
]


func test_every_surface_has_a_material_in_both_styles() -> void:
	var original := PresentationStyle.chutaos_mode
	for chutaos: bool in [false, true]:
		PresentationStyle.chutaos_mode = chutaos
		for surface: WorldSurface.Kind in SURFACES:
			assert_not_null(PresentationStyle.surface_material(surface),
				"falta el material de %d en el estilo %s" % [surface, PresentationStyle.style_name()])
	PresentationStyle.chutaos_mode = original


func test_the_two_styles_paint_the_world_differently() -> void:
	# Es el motivo de que exista el eje: si los dos estilos devolvieran el
	# mismo material, `: chutaos on` no cambiaría el mundo y el truco mentiría.
	var original := PresentationStyle.chutaos_mode
	for surface: WorldSurface.Kind in SURFACES:
		PresentationStyle.chutaos_mode = false
		var modern := PresentationStyle.surface_material(surface)
		PresentationStyle.chutaos_mode = true
		var chutaos := PresentationStyle.surface_material(surface)
		assert_ne(modern, chutaos, "la superficie %d se pinta igual en los dos estilos" % surface)
	PresentationStyle.chutaos_mode = original


func test_no_material_uses_a_godot_3_property_name() -> void:
	# Godot 4 acepta nombres de Godot 3 con un remapeo silencioso — silencioso
	# salvo por un WARNING que no rompe nada y por eso pasa desapercibido. Ya
	# costó una vez (`specular`, que en Godot 4 es `metallic_specular`): el
	# material cargaba, el test pasaba y el arranque no estaba limpio.
	var known := {}
	for entry: Dictionary in StandardMaterial3D.new().get_property_list():
		known[String(entry["name"])] = true
	for path: String in _material_paths():
		var file := FileAccess.open(path, FileAccess.READ)
		assert_not_null(file, "no se puede leer %s" % path)
		if file == null:
			continue
		var in_resource := false
		while not file.eof_reached():
			var line := file.get_line().strip_edges()
			if line.begins_with("["):
				in_resource = line.begins_with("[resource]")
				continue
			if not in_resource or line.is_empty():
				continue
			# El formato de recurso en texto solo entiende ';' como comentario,
			# y una línea con '#' dentro de [resource] no se ignora: se pega al
			# nombre de la propiedad siguiente. El motor lo avisa y sigue, así
			# que la propiedad se pierde en silencio para quien no lea el log.
			assert_false(line.begins_with("#"),
				"%s usa '#' dentro de [resource]; el comentario debe ir arriba con ';'" % path)
			if line.begins_with(";") or line.begins_with("#"):
				continue
			var eq := line.find(" = ")
			if eq < 0:
				continue
			var property := line.substr(0, eq)
			assert_true(known.has(property),
				"%s escribe '%s', que no es una propiedad de StandardMaterial3D" % [path, property])


func test_the_modern_world_stays_desaturated_so_characters_read() -> void:
	# Regla de dirección de arte de TF2, y no es cosmética: los personajes van
	# saturados, así que el mundo tiene que callarse. Sin un límite escrito,
	# cada material nuevo sube un poco la saturación y en diez cambios el
	# enemigo ya no se distingue del mobiliario.
	var original := PresentationStyle.chutaos_mode
	PresentationStyle.chutaos_mode = false
	for surface: WorldSurface.Kind in SURFACES:
		var material := PresentationStyle.surface_material(surface) as StandardMaterial3D
		assert_not_null(material)
		if material == null:
			continue
		# La puerta es la excepción con nombre y motivo: la regla no es "todo
		# apagado", es "todo apagado salvo lo que el jugador tiene que
		# encontrar". Una puerta es información táctica, y el color es la forma
		# más barata de darla. Si algún día hay una segunda excepción, tendrá
		# que justificarse aquí igual que esta.
		var ceiling := 0.55 if surface == WorldSurface.Kind.DOOR else 0.35
		var albedo := _effective_albedo(material)
		assert_lt(albedo.s, ceiling,
			"la superficie %d está demasiado saturada (%.2f)" % [surface, albedo.s])
	PresentationStyle.chutaos_mode = original


func test_furniture_is_darker_than_the_wall_behind_it() -> void:
	# Si la cobertura no se recorta contra la pared, el jugador no ve dónde
	# parapetarse y el sistema de coberturas de la IA no le sirve de nada.
	var original := PresentationStyle.chutaos_mode
	for chutaos: bool in [false, true]:
		PresentationStyle.chutaos_mode = chutaos
		var wall := PresentationStyle.surface_material(WorldSurface.Kind.WALL) as StandardMaterial3D
		var prop := PresentationStyle.surface_material(WorldSurface.Kind.PROP) as StandardMaterial3D
		assert_lt(_effective_albedo(prop).v, _effective_albedo(wall).v,
			"el mobiliario debe ser más oscuro que la pared en el estilo %s"
				% PresentationStyle.style_name())
	PresentationStyle.chutaos_mode = original


func test_the_dresser_paints_by_node_name_and_tells_walls_apart() -> void:
	var world := _fake_map()
	var tree := Engine.get_main_loop() as SceneTree
	tree.root.add_child(world)

	var perimeter := world.get_node("Walls/PerimeterWall_0/Mesh") as MeshInstance3D
	var interior := world.get_node("Walls/Wall_0/Mesh") as MeshInstance3D
	var prop := world.get_node("Obstacles/Obstacle_0/Mesh") as MeshInstance3D
	assert_not_null(perimeter.get_surface_override_material(0), "el perímetro se queda sin pintar")
	assert_ne(perimeter.get_surface_override_material(0), interior.get_surface_override_material(0),
		"el borde del edificio y un tabique deben distinguirse a simple vista")
	assert_ne(prop.get_surface_override_material(0), interior.get_surface_override_material(0),
		"el mobiliario debe distinguirse de la pared")

	tree.root.remove_child(world)
	world.queue_free()


func test_the_dresser_repaints_when_the_style_changes() -> void:
	# Sin esto, `: chutaos on` solo afectaría a las plantas cargadas después y
	# el truco parecería roto justo donde el jugador está mirando.
	var original := PresentationStyle.chutaos_mode
	PresentationStyle.chutaos_mode = false
	var world := _fake_map()
	var tree := Engine.get_main_loop() as SceneTree
	tree.root.add_child(world)

	var wall := world.get_node("Walls/Wall_0/Mesh") as MeshInstance3D
	var before := wall.get_surface_override_material(0)
	PresentationStyle.chutaos_mode = true
	var after := wall.get_surface_override_material(0)
	assert_ne(before, after, "cambiar de estilo debe repintar lo que ya está en pantalla")

	tree.root.remove_child(world)
	world.queue_free()
	PresentationStyle.chutaos_mode = original


func test_an_unknown_node_is_left_alone() -> void:
	# Ante la duda, no se pinta: un nodo que el vestidor no reconoce puede ser
	# de otro sistema, y pisarle el material sería peor que dejarlo como está.
	var world := _fake_map()
	var stranger := MeshInstance3D.new()
	stranger.name = "SomethingElse"
	stranger.mesh = BoxMesh.new()
	world.add_child(stranger)
	var tree := Engine.get_main_loop() as SceneTree
	tree.root.add_child(world)

	assert_null(stranger.get_surface_override_material(0),
		"un nodo sin prefijo conocido no debe recibir material")

	tree.root.remove_child(world)
	world.queue_free()


## Maqueta con la misma forma que los mapas convertidos: nombres de nodo y
## `Mesh` colgando de cada cuerpo. No reproduce ni el suelo ni el navmesh —
## el vestidor no los toca.
func _fake_map() -> Node3D:
	var root := Node3D.new()
	root.name = "FakeMap"
	var walls := Node3D.new()
	walls.name = "Walls"
	root.add_child(walls)
	for wall_name: String in ["PerimeterWall_0", "Wall_0"]:
		var body := StaticBody3D.new()
		body.name = wall_name
		walls.add_child(body)
		var mesh := MeshInstance3D.new()
		mesh.name = "Mesh"
		mesh.mesh = BoxMesh.new()
		body.add_child(mesh)
	var obstacles := Node3D.new()
	obstacles.name = "Obstacles"
	root.add_child(obstacles)
	var obstacle := Node3D.new()
	obstacle.name = "Obstacle_0"
	obstacles.add_child(obstacle)
	var prop_mesh := MeshInstance3D.new()
	prop_mesh.name = "Mesh"
	prop_mesh.mesh = BoxMesh.new()
	obstacle.add_child(prop_mesh)
	var dressing := Node.new()
	dressing.name = "Dressing"
	dressing.set_script(load("res://src/gameplay/world_dressing.gd"))
	root.add_child(dressing)
	return root


func test_a_textured_material_can_actually_be_measured() -> void:
	# Las dos pruebas de dirección de arte miden el color medio de la textura.
	# Si esa lectura fallara, `_effective_albedo` se conformaría con el tinte y
	# las pruebas seguirían en verde midiendo otra cosa — que es justo cómo se
	# descubrió que `NoiseTexture2D` genera en un hilo y no tiene imagen a
	# tiempo. Esta prueba vigila al vigilante.
	var original := PresentationStyle.chutaos_mode
	for chutaos: bool in [false, true]:
		PresentationStyle.chutaos_mode = chutaos
		for surface: WorldSurface.Kind in SURFACES:
			var material := PresentationStyle.surface_material(surface) as StandardMaterial3D
			if material == null or material.albedo_texture == null:
				continue
			assert_not_null(material.albedo_texture.get_image(),
				("la textura de la superficie %d no se puede leer: las pruebas de "
					+ "arte estarían midiendo el tinte y no el color real") % surface)
	PresentationStyle.chutaos_mode = original


## El color que un jugador ve de verdad: el tinte multiplicado por el color
## medio de la textura. Mirar solo `albedo_color` mide el estilo moderno bien y
## el de 2012 fatal —allí el tinte es blanco y todo el color está en el .jpg—,
## y una regla de arte que solo vale para la mitad de los casos no es una regla.
func _effective_albedo(material: StandardMaterial3D) -> Color:
	var tint := material.albedo_color
	var texture := material.albedo_texture
	if texture == null:
		return tint
	var image := texture.get_image()
	if image == null:
		return tint
	# Reducir a un píxel es la media aritmética que interesa, sin recorrer la
	# imagen entera desde GDScript.
	var thumb := image.duplicate() as Image
	if thumb.is_compressed():
		thumb.decompress()
	thumb.resize(1, 1, Image.INTERPOLATE_LANCZOS)
	var average := thumb.get_pixel(0, 0)
	return Color(tint.r * average.r, tint.g * average.g, tint.b * average.b, tint.a)


func _material_paths() -> Array[String]:
	var paths: Array[String] = []
	for root: String in [PresentationStyle.MATERIALS_CHUTAOS, PresentationStyle.MATERIALS_MODERN]:
		var dir := DirAccess.open(root)
		if dir == null:
			continue
		for file_name: String in dir.get_files():
			if file_name.ends_with(".tres"):
				paths.append(root + file_name)
	return paths
