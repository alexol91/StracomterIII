class_name AbilityTechnicianHack
extends Ability
## "Hackeo" (Técnico, `E-01`): abre las puertas cerradas al alcance.
##
## Usa exactamente la misma API pública que `player_input.gd` para
## interactuar con puertas (`Door.set_open`), así que la navegación se
## actualiza igual en ambos casos: `door.gd` emite
## `EventBus.door_state_changed` y es `ai-navegacion` quien reacciona. Este
## fichero no toca la navegación.

@export var hack_radius_m: float = 10.0


func _activate() -> void:
	if character == null or not character.is_inside_tree():
		return
	for node: Node in character.get_tree().get_nodes_in_group(&"doors"):
		var door := node as Door
		if door == null or door.is_open:
			continue
		if door.global_position.distance_to(character.global_position) <= hack_radius_m:
			door.set_open(true)
