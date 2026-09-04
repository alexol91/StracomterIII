extends Node
const X := preload("res://src/ai/navigation/nav_service.gd")
func _ready() -> void:
	print("loaded ", X.resource_path)
	get_tree().quit(0)
