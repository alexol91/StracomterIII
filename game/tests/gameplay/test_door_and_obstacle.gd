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
