extends Node
const X := preload("res://src/ai/navigation/navmesh_sampler.gd")
func _ready() -> void:
	print("loaded ", X.resource_path)
	get_tree().quit(0)
