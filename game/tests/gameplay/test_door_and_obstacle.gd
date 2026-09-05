extends GameplayFixture
## Puertas: abren/cierran y publican `EventBus.door_state_changed` — nunca
## tocan la navegación (regla dura de este agente; la navegación real la
## hornea `ai-navegacion` al escuchar la señal, y eso no se puede comprobar
## en negativo desde aquí, pero sí que la señal lleva los datos correctos).
## Obstáculos: la altura de cobertura por defecto de cada subtipo.

func _make_door() -> Door:
	var scene: PackedScene = load("res://scenes/gameplay/door.tscn")
	var d := scene.instantiate() as Door
	spawn(d)
	return d


func test_door_starts_closed_by_default() -> void:
	var door := _make_door()
	assert_false(door.is_open, "réplica: `Door::open = false` al crearse")


func test_toggle_opens_and_closes() -> void:
	var door := _make_door()
	door.toggle()
	assert_true(door.is_open)
	door.toggle()
	assert_false(door.is_open)


func test_toggle_emits_door_state_changed_with_id_and_state() -> void:
	var door := _make_door()
	door.door_id = 7
	var received: Array = []
	var callback := func(door_id: int, is_open: bool) -> void:
		received.append([door_id, is_open])
	EventBus.door_state_changed.connect(callback)
	door.toggle()
	EventBus.door_state_changed.disconnect(callback)
	assert_size(received, 1, "un toggle, una señal")
	assert_eq(received[0][0], 7, "el id de la puerta viaja en la señal")
	assert_eq(received[0][1], true, "ha quedado abierta")


func test_setting_the_same_state_does_not_emit() -> void:
	var door := _make_door()
	var count := 0
	var callback := func(_id: int, _open: bool) -> void:
		count += 1
	EventBus.door_state_changed.connect(callback)
	door.set_open(false) # ya estaba cerrada
	EventBus.door_state_changed.disconnect(callback)
	assert_eq(count, 0, "no debe emitir si el estado no cambia")


func test_open_disables_collision_so_it_can_be_walked_through() -> void:
	var door := _make_door()
	var shape := door.get_node("CollisionShape3D") as CollisionShape3D
	assert_false(shape.disabled, "cerrada, es sólida")
	door.set_open(true)
	assert_true(shape.disabled, "abierta, se atraviesa (réplica: `body->Active(false)`)")


# --- Obstacle: altura de cobertura por defecto de cada subtipo ---

func test_plant_pot_blocks_sight_but_not_bullets() -> void:
	assert_eq(Obstacle.default_cover_for(Obstacle.Kind.PLANT_POT), Obstacle.CoverHeight.NONE,
		"GDD §9: una planta no protege nada, solo rompe línea de visión")


func test_shelf_protects_standing() -> void:
	assert_eq(Obstacle.default_cover_for(Obstacle.Kind.SHELF), Obstacle.CoverHeight.HIGH)


func test_table_protects_crouched_only() -> void:
	assert_eq(Obstacle.default_cover_for(Obstacle.Kind.TABLE), Obstacle.CoverHeight.LOW)


func test_obstacle_scene_registers_in_group() -> void:
	var scene: PackedScene = load("res://scenes/gameplay/obstacle.tscn")
	var o := scene.instantiate() as Obstacle
	spawn(o)
	assert_true(o.is_in_group(&"obstacles"))


# --- Obstacle: modelo real, colisión que le corresponde y estilo ---

const ALL_KINDS: Array[Obstacle.Kind] = [
	Obstacle.Kind.TABLE, Obstacle.Kind.DESK, Obstacle.Kind.COUCH,
	Obstacle.Kind.SOFA, Obstacle.Kind.CHAIR, Obstacle.Kind.SHELF,
	Obstacle.Kind.PLANT_POT, Obstacle.Kind.TABLE_WITH_CHAIRS,
]


func _make_obstacle(kind: Obstacle.Kind) -> Obstacle:
	var scene: PackedScene = load("res://scenes/gameplay/obstacle.tscn")
	var o := scene.instantiate() as Obstacle
	# El mismo orden que usa LevelLoader: primero el subtipo, después el árbol.
	o.kind = kind
	spawn(o)
	return o


func test_every_subtype_brings_the_2012_model() -> void:
	for kind: Obstacle.Kind in ALL_KINDS:
		var obstacle := _make_obstacle(kind)
		assert_not_null(obstacle.get_node_or_null("Model"),
			"'%s' se queda sin modelo" % Obstacle.Kind.keys()[kind])


func test_collision_matches_what_the_player_sees() -> void:
	# Antes todos los muebles bloqueaban la misma caja de 0,9 x 0,75 x 0,6. Un
	# escritorio mide 2,15 m: el jugador se parapetaba detrás de lo que veía y
	# le disparaban por un hueco que en pantalla no existía.
	for kind: Obstacle.Kind in ALL_KINDS:
		var obstacle := _make_obstacle(kind)
		var shape := (obstacle.get_node("CollisionShape3D") as CollisionShape3D).shape as BoxShape3D
		assert_not_null(shape)
		var model_height := Obstacle.model_height_for(kind)
		assert_almost_eq(shape.size.y, model_height, 0.02,
			"'%s': la colisión mide %.2f m y el mueble %.2f m"
				% [Obstacle.Kind.keys()[kind], shape.size.y, model_height])


func test_each_obstacle_gets_its_own_collision_shape() -> void:
	# La forma del .tscn es un SubResource compartido: redimensionarla en sitio
	# cambiaría de golpe el tamaño de todos los muebles del mapa.
	var desk := _make_obstacle(Obstacle.Kind.DESK)
	var chair := _make_obstacle(Obstacle.Kind.CHAIR)
	var desk_shape := (desk.get_node("CollisionShape3D") as CollisionShape3D).shape
	var chair_shape := (chair.get_node("CollisionShape3D") as CollisionShape3D).shape
	assert_ne(desk_shape, chair_shape, "cada mueble necesita su propia forma")


func test_cover_height_survives_being_set_before_entering_the_tree() -> void:
	# Regresión: `LevelLoader` asigna `kind` y solo DESPUÉS hace `add_child`.
	# Con la guarda `is_inside_tree()` que había en el setter, los valores por
	# subtipo no se aplicaban nunca y TODOS los muebles de TODOS los mapas se
	# quedaban con la cobertura de una mesa. Sin ningún error.
	var scene: PackedScene = load("res://scenes/gameplay/obstacle.tscn")
	var shelf := scene.instantiate() as Obstacle
	shelf.kind = Obstacle.Kind.SHELF
	assert_eq(shelf.cover_height, Obstacle.CoverHeight.HIGH,
		"una estantería protege de pie aunque su subtipo se asigne fuera del árbol")
	shelf.free()


func test_declared_cover_never_drifts_from_the_model() -> void:
	# La cobertura sale de la malla justamente para que no puedan contradecirse.
	# Esta prueba vigila que siga siendo así si alguien reintroduce una tabla.
	for kind: Obstacle.Kind in ALL_KINDS:
		if kind == Obstacle.Kind.PLANT_POT:
			continue  # Excepción del GDD: tapa la vista y no para balas.
		var height := Obstacle.model_height_for(kind)
		var declared := Obstacle.default_cover_for(kind)
		if declared == Obstacle.CoverHeight.HIGH:
			assert_true(height >= Obstacle.COVER_HIGH_M,
				"'%s' dice tapar de pie midiendo %.2f m" % [Obstacle.Kind.keys()[kind], height])
		elif declared == Obstacle.CoverHeight.LOW:
			assert_true(height >= Obstacle.COVER_LOW_M,
				"'%s' dice tapar agachado midiendo %.2f m" % [Obstacle.Kind.keys()[kind], height])


func test_furniture_changes_material_with_the_chutaos_switch() -> void:
	var original := PresentationStyle.chutaos_mode
	PresentationStyle.chutaos_mode = false
	var desk := _make_obstacle(Obstacle.Kind.DESK)
	var modern := _first_material(desk)
	PresentationStyle.chutaos_mode = true
	var chutaos := _first_material(desk)
	assert_not_null(modern, "el mueble debe tener material en el remake")
	assert_ne(modern, chutaos, "`chutaos on` también tiene que cambiar el mobiliario")
	PresentationStyle.chutaos_mode = original


func test_a_sofa_is_not_upholstered_like_a_shelf() -> void:
	# Un sofá gris melamina y una planta gris no se leen como lo que son, y en
	# un juego donde parapetarse es la mecánica central eso importa.
	var original := PresentationStyle.chutaos_mode
	PresentationStyle.chutaos_mode = false
	var sofa := _make_obstacle(Obstacle.Kind.SOFA)
	var shelf := _make_obstacle(Obstacle.Kind.SHELF)
	var plant := _make_obstacle(Obstacle.Kind.PLANT_POT)
	assert_ne(_first_material(sofa), _first_material(shelf),
		"la tapicería no es la misma superficie que una estantería")
	assert_ne(_first_material(plant), _first_material(shelf),
		"el follaje tampoco")
	PresentationStyle.chutaos_mode = original


func _first_material(obstacle: Obstacle) -> Material:
	var model := obstacle.get_node_or_null("Model")
	if model == null:
		return null
	for node: Node in Obstacle._mesh_instances(model):
		var mesh_instance := node as MeshInstance3D
		if mesh_instance.get_surface_override_material_count() > 0:
			return mesh_instance.get_surface_override_material(0)
	return null
