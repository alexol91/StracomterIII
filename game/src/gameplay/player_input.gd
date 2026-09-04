class_name PlayerInput
extends Node
## Traduce input HUMANO (teclado+ratón y mando) a las intenciones del
## `Character` que controla.
##
## Este es el único lugar de `gameplay/` donde importa si hay una persona
## delante del teclado: todo lo que hace es llamar a la misma API pública de
## `Character` (`move_to`, `look_at_point`, `fire`, `melee`, `reload`,
## `use_ability`) que llamaría un cerebro de IA. No importa nada de `src/ai/`.
##
## Funciona con las DOS entradas simultáneamente: `Input.get_vector` y
## `Input.is_action_*` leen cualquier evento mapeado a la acción, sea tecla,
## ratón o mando — no hay ninguna rama "si hay mando, si no...".

signal squad_order_requested(position: Vector3)

@export var character_path: NodePath
@export var camera_path: NodePath
@export var aim_max_distance_m: float = 100.0

## Radio de interacción con puertas. Réplica del legacy:
## `Core::Radius × 3 = 90` unidades (`HIDControl.cc:244-257`), convertidas a
## metros con el factor de escala canónico de `Balance`.
var door_interact_range_m: float = 90.0 * Balance.LEGACY_TO_METERS

var character: Character = null
var camera: TPSCamera = null


## Debe procesarse ANTES que `WeaponSystem`/`CharacterController` (que
## consumen las intenciones que esto escribe). Misma convención que
## `Ability.SETTER_PHYSICS_PRIORITY`.
const SETTER_PHYSICS_PRIORITY: int = -100


func _ready() -> void:
	process_physics_priority = SETTER_PHYSICS_PRIORITY
	character = get_node_or_null(character_path) as Character
	if character == null:
		character = get_parent() as Character
	if character == null:
		push_error("PlayerInput: no se encontró el Character controlado.")
	camera = get_node_or_null(camera_path) as TPSCamera
	# El remapeo definitivo es de `ui-ux`; esto solo asegura que el juego es
	# jugable de fábrica en un checkout limpio (ver cabecera de
	# `default_bindings.gd`).
	DefaultBindings.ensure_defaults()
	add_to_group(&"player_input")


func _physics_process(_delta: float) -> void:
	if character == null:
		return

	_read_movement()
	_read_aim()
	character.intent_sprint = Input.is_action_pressed(&"sprint")
	character.intent_crouch = Input.is_action_pressed(&"crouch")

	if Input.is_action_pressed(&"fire"):
		character.fire()
	if Input.is_action_just_pressed(&"melee"):
		character.melee()
	if Input.is_action_just_pressed(&"reload"):
		character.reload()
	if Input.is_action_just_pressed(&"ability"):
		character.use_ability()
	if Input.is_action_just_pressed(&"interact"):
		_interact()
	if Input.is_action_just_pressed(&"squad_order"):
		squad_order_requested.emit(_aim_point())


func _read_movement() -> void:
	var input_vec := Input.get_vector(&"move_left", &"move_right", &"move_forward", &"move_back")
	if input_vec.length_squared() <= 0.0001:
		character.move_to(Vector3.ZERO)
		return
	var cam_forward := Vector3.FORWARD
	var cam_right := Vector3.RIGHT
	if camera != null:
		cam_forward = -camera.global_transform.basis.z
		cam_right = camera.global_transform.basis.x
		cam_forward.y = 0.0
		cam_right.y = 0.0
	# `Input.get_vector` con `move_forward` como parámetro "negative_y" hace
	# que avanzar dé `y = -1`; de ahí el signo invertido.
	var move_dir := cam_right * input_vec.x - cam_forward * input_vec.y
	character.move_to(move_dir)


func _read_aim() -> void:
	character.look_at_point(_aim_point())


func _aim_point() -> Vector3:
	if camera != null:
		return camera.get_aim_point(aim_max_distance_m)
	return character.global_position - character.global_transform.basis.z * aim_max_distance_m


## Abre/cierra las puertas al alcance. Réplica de `HIDControl.cc:244-257`
## ("E" abre TODAS las puertas a ≤ 90 u): la navegación la actualiza
## `ai-navegacion` al escuchar `EventBus.door_state_changed`, no este fichero.
func _interact() -> void:
	for node: Node in character.get_tree().get_nodes_in_group(&"doors"):
		var door := node as Door
		if door == null:
			continue
		if door.global_position.distance_to(character.global_position) <= door_interact_range_m:
			door.toggle()
