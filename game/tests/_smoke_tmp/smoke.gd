extends Node

func _ready() -> void:
	var scene: PackedScene = load("res://scenes/gameplay/character.tscn")
	var a := scene.instantiate() as Character
	a.archetype = &"captain"
	add_child(a)
	a.global_position = Vector3(0,0,0)

	var b := scene.instantiate() as Character
	b.archetype = &"enemy_thug"
	add_child(b)
	b.global_position = Vector3(5,0,0)

	var origin: Vector3 = a.eye_position()
	var to: Vector3 = origin + Vector3(1,0,0) * 40.0
	var space_state := a.get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(origin, to, 79)
	query.exclude = [a.get_rid()]
	var result := space_state.intersect_ray(query)
	print("SYNC raycast result (same tick, no frame elapsed): ", result)

	await get_tree().physics_frame
	await get_tree().physics_frame
	var result2 := space_state.intersect_ray(query)
	print("AFTER 2 physics frames raycast result: ", result2)

	get_tree().quit(0)
