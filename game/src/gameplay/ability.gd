class_name Ability
extends Node
## Base de la HABILIDAD ACTIVA de clase (`E-01`, GDD §3): *Órdenes* (Capitán),
## *Hackeo* (Técnico), *Supresión* (Especialista), *Demolición* (Explosivo).
##
## Se activa con `character.intent_ability`, exactamente igual si lo puso el
## input humano (`player_input.gd`) o la IA de un compañero — este fichero no
## sabe ni le importa cuál de los dos fue, y no importa nada de `src/ai/`.
##
## Orden de ejecución: las habilidades ESCRIBEN intenciones adicionales sobre
## el `Character` (p. ej. Supresión llama a `character.fire()`), así que
## deben procesarse ANTES que `WeaponSystem`/`CharacterController`, que las
## CONSUMEN. Se fuerza con `process_physics_priority` (más bajo = antes);
## ver la misma convención en `player_input.gd`.

const SETTER_PHYSICS_PRIORITY: int = -100

@export var character_path: NodePath
## Segundos de reutilización tras activarse. No existe en `CharacterStats`.
## TODO(arquitecto): mover a datos (p. ej. `CharacterStats.ability_cooldown_s`).
@export var cooldown_s: float = 8.0
## Si no está vacío, la habilidad se autodesactiva salvo que
## `character.archetype` coincida. Así `player.tscn`/`enemy.tscn` pueden
## llevar las cuatro habilidades de clase como hijos y solo se activa la que
## corresponde al arquetipo realmente instanciado — el mismo patrón que
## `AuraEmitter.required_archetype`, y por la misma razón: un único cuerpo
## sirve para las cuatro clases sin escenas por clase.
@export var required_archetype: StringName = &""

var character: Character = null
var _cooldown_remaining_s: float = 0.0

## Inyectable SOLO para pruebas: sustituye el raycast físico real de
## `_raycast()`. Misma idea y mismo motivo que `WeaponSystem.raycast_override`
## (ver su comentario): los cuerpos recién creados no son consultables por
## raycast dentro del mismo tick de física en el que se crean, y el runner de
## pruebas nunca avanza un frame real.
var raycast_override: Callable = Callable()


func _ready() -> void:
	process_physics_priority = SETTER_PHYSICS_PRIORITY
	character = get_node_or_null(character_path) as Character
	if character == null:
		character = get_parent() as Character
	if character == null:
		push_error("Ability (%s): no se encontró el Character propietario." % get_script().resource_path)
		return
	if required_archetype != &"" and character.archetype != required_archetype:
		set_physics_process(false)


func _physics_process(delta: float) -> void:
	if character == null or not character.alive:
		return
	if _cooldown_remaining_s > 0.0:
		_cooldown_remaining_s = maxf(_cooldown_remaining_s - delta, 0.0)
	_on_tick(delta)
	if character.intent_ability and is_ready():
		_cooldown_remaining_s = cooldown_s
		_activate()


func is_ready() -> bool:
	return _cooldown_remaining_s <= 0.0


## 0 = recién usada, 1 = lista. Para que el HUD (`ui/`) pinte el cooldown.
func cooldown_ratio() -> float:
	if cooldown_s <= 0.0:
		return 1.0
	return 1.0 - clampf(_cooldown_remaining_s / cooldown_s, 0.0, 1.0)


## Dirección de puntería común a varias habilidades: hacia `intent_look_at`
## si hay uno, si no hacia donde mira el personaje.
func aim_direction_from(origin: Vector3) -> Vector3:
	if character.intent_look_at != Vector3.INF:
		var to_target := character.intent_look_at - origin
		if to_target.length_squared() > 0.0001:
			return to_target.normalized()
	return -character.global_transform.basis.z


## Raycast común a las habilidades que apuntan (Órdenes, Demolición). Excluye
## siempre al propio `character`.
func _raycast(from: Vector3, to: Vector3, mask: int) -> Dictionary:
	if raycast_override.is_valid():
		var result: Variant = raycast_override.call(from, to, mask)
		return result if result is Dictionary else {}
	if character == null or not character.is_inside_tree():
		return {}
	var space_state := character.get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(from, to, mask)
	query.exclude = [character.get_rid()]
	return space_state.intersect_ray(query)


## Hook opcional para habilidades con efecto sostenido (p. ej. Supresión).
func _on_tick(_delta: float) -> void:
	pass


## Las subclases DEBEN sobrescribir esto.
func _activate() -> void:
	push_warning("Ability._activate() sin implementar en %s" % get_script().resource_path)
