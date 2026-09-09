extends TestCase
## Los personajes tienen que mirar hacia donde miran.
##
## Los modelos de Quaternius miran hacia +Z y el frente de un `Node3D` de Godot
## es −Z, así que TODOS los personajes del juego se dibujaban de espaldas a
## donde iban: veías la cara de tu propio personaje en vez de su espalda, y a
## los enemigos acercándose de culo. Reportado jugando; medido aquí.
##
## Y no daba error: 744 pruebas en verde, arranque limpio y el juego entero al
## revés. Ninguna prueba miraba la ORIENTACIÓN de la malla porque ninguna
## prueba mira nada — se ve, no se comprueba. Esta sí, y sin renderizar: la
## malla de los ojos dice dónde está la cara.

const CHARACTER_SCENE: String = "res://scenes/gameplay/character.tscn"
const EYE_MESH_NAME: String = "Eyes"

var _spawned: Array[Node] = []


func after_each() -> void:
	for node: Node in _spawned:
		if is_instance_valid(node):
			if node.get_parent() != null:
				node.get_parent().remove_child(node)
			node.free()
	_spawned.clear()


func _eyes_of(archetype: StringName) -> MeshInstance3D:
	var scene := load(CHARACTER_SCENE) as PackedScene
	var body := scene.instantiate() as Node3D
	body.set("archetype", archetype)
	var tree := Engine.get_main_loop() as SceneTree
	var parent: Node = tree.current_scene if tree.current_scene != null else tree.root
	parent.add_child(body)
	_spawned.append(body)
	body.position = Vector3.ZERO
	body.rotation = Vector3.ZERO
	return _find_mesh(body, EYE_MESH_NAME)


func _find_mesh(node: Node, name_part: String) -> MeshInstance3D:
	var mesh := node as MeshInstance3D
	if mesh != null and name_part.to_lower() in String(mesh.name).to_lower():
		return mesh
	for child: Node in node.get_children():
		var found := _find_mesh(child, name_part)
		if found != null:
			return found
	return null


func test_every_archetype_looks_where_it_walks() -> void:
	# Con el cuerpo sin rotar, el frente es -Z: la cara tiene que quedar del
	# lado negativo de Z, no del positivo.
	var checked := 0
	for archetype: StringName in Balance.character_ids():
		var eyes := _eyes_of(archetype)
		if eyes == null:
			continue  # paquete sin malla de ojos: no se puede medir así
		checked += 1
		var centre: Vector3 = eyes.global_transform * eyes.get_aabb().get_center()
		assert_lt(centre.z, 0.0,
			"'%s' tiene la cara detrás: la malla mira al revés que el cuerpo" % archetype)
		assert_gt(centre.y, 1.0, "y a la altura de una cabeza, no en los pies")
	assert_gt(checked, 0,
		"si ningún arquetipo trae malla de ojos, esta prueba no está comprobando nada")
