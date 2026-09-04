class_name AbilityCaptainOrders
extends Ability
## "Órdenes" (Capitán, `E-01`): marca un objetivo para la escuadra.
##
## Este fichero NO IMPLEMENTA la escuadra — se limita a resolver a qué
## personaje hostil apunta el Capitán y a emitir la señal. Quién reacciona
## (p. ej. hacer que todos los compañeros concentren fuego ahí) es
## `ai-squad`, que se suscribe a esta señal buscando el grupo
## `ability_captain_orders`; este fichero no importa nada de `src/ai/`.

signal target_marked(position: Vector3, target_id: int)

## world | player | companion | enemy | door — igual que `WeaponSystem.HIT_MASK`.
const MARK_RAY_MASK: int = 79
@export var mark_range_m: float = 40.0


func _ready() -> void:
	super._ready()
	add_to_group(&"ability_captain_orders")


func _activate() -> void:
	if character == null or not character.is_inside_tree():
		return
	var origin := character.eye_position()
	var dir := aim_direction_from(origin)
	var to := origin + dir * mark_range_m
	var space_state := character.get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(origin, to, MARK_RAY_MASK)
	query.exclude = [character.get_rid()]
	var result := space_state.intersect_ray(query)
	if result.is_empty():
		return
	var collider: Object = result.get("collider")
	if collider is Character and character.is_hostile_to(collider as Character):
		var target := collider as Character
		target_marked.emit(target.global_position, target.get_instance_id())
