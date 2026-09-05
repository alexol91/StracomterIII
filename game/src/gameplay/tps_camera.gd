class_name TPSCamera
extends Node3D
## Cámara en tercera persona sobre el hombro, con `SpringArm3D` para colisión
## contra el entorno, y modo cenital conmutable (paridad `[P17]` / evolutivo
## `E-11` del GDD §2).
##
## Estructura de nodos esperada (la crea `player.tscn`):
##   TPSCamera (este script)
##   └── SpringArm3D  (colisión automática contra la capa "world")
##        └── Camera3D
##
## El remapeo de sensibilidad definitivo (GDD §10, accesibilidad) lo expone
## `Settings`/`ui-ux`; este nodo solo publica `mouse_sensitivity` y
## `gamepad_sensitivity_rad_s` como propiedades ajustables en caliente.

enum Mode { THIRD_PERSON, TOP_DOWN }

@export var target_path: NodePath
@export var mouse_sensitivity: float = 0.0025
@export var gamepad_sensitivity_rad_s: float = 3.0
## Desplazamiento del brazo respecto al objetivo: X = al hombro, Y = altura.
@export var shoulder_offset: Vector3 = Vector3(0.5, 1.5, 0.0)
@export var min_pitch_deg: float = -60.0
@export var max_pitch_deg: float = 70.0
@export var tps_spring_length_m: float = 4.0
@export var aim_spring_length_m: float = 2.4
@export var top_down_height_m: float = 14.0
@export var top_down_pitch_deg: float = -80.0
## Velocidad de interpolación al cambiar de modo o al apuntar (ADS).
@export var transition_speed: float = 6.0

const GAMEPAD_LOOK_DEADZONE: float = 0.2
## world | player | companion | enemy | door — igual que `WeaponSystem.HIT_MASK`
## (ver `project.godot` → `[layer_names]`). Duplicada a propósito: este nodo
## no depende de `weapon_system.gd`, solo comparte el mismo mapa de capas.
const AIM_RAY_MASK: int = 79

var mode: Mode = Mode.THIRD_PERSON
var target: Node3D = null
var _yaw: float = 0.0
var _pitch: float = 0.0

@onready var _spring_arm: SpringArm3D = $SpringArm3D
@onready var _camera: Camera3D = $SpringArm3D/Camera3D


func _ready() -> void:
	target = get_node_or_null(target_path) as Node3D
	_spring_arm.collision_mask = 1 # solo "world": el entorno empuja la cámara
	_spring_arm.spring_length = tps_spring_length_m
	# El brazo coloca la cámara EN el punto de impacto, es decir, pegada a la
	# superficie: con el plano cercano por delante, medio fotograma queda
	# dentro del muro. Con el margen se para antes. Se vio arrancando el juego
	# en la planta 1, donde el jugador aparece junto a una esquina cóncava y la
	# vista salía llena de pared.
	_spring_arm.margin = 0.35
	_spring_arm.position = Vector3(shoulder_offset.x, 0.0, 0.0)
	if _camera != null:
		_camera.current = true


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and mode == Mode.THIRD_PERSON:
		var motion := event as InputEventMouseMotion
		_yaw -= motion.relative.x * mouse_sensitivity
		_pitch = clampf(_pitch - motion.relative.y * mouse_sensitivity,
			deg_to_rad(min_pitch_deg), deg_to_rad(max_pitch_deg))
	if event.is_action_pressed(&"toggle_camera"):
		toggle_mode()


func _physics_process(delta: float) -> void:
	if target == null:
		return
	_apply_gamepad_look(delta)
	global_position = target.global_position + Vector3.UP * shoulder_offset.y

	var t := clampf(transition_speed * delta, 0.0, 1.0)
	match mode:
		Mode.THIRD_PERSON:
			rotation = Vector3(_pitch, _yaw, 0.0)
			var desired_length := aim_spring_length_m if Input.is_action_pressed(&"aim") else tps_spring_length_m
			_spring_arm.spring_length = lerpf(_spring_arm.spring_length, desired_length, t)
		Mode.TOP_DOWN:
			rotation = Vector3(deg_to_rad(top_down_pitch_deg), _yaw, 0.0)
			_spring_arm.spring_length = lerpf(_spring_arm.spring_length, top_down_height_m, t)


func toggle_mode() -> void:
	mode = Mode.TOP_DOWN if mode == Mode.THIRD_PERSON else Mode.THIRD_PERSON


func _apply_gamepad_look(delta: float) -> void:
	var rx := Input.get_joy_axis(0, JOY_AXIS_RIGHT_X)
	var ry := Input.get_joy_axis(0, JOY_AXIS_RIGHT_Y)
	if absf(rx) < GAMEPAD_LOOK_DEADZONE:
		rx = 0.0
	if absf(ry) < GAMEPAD_LOOK_DEADZONE:
		ry = 0.0
	if rx == 0.0 and ry == 0.0:
		return
	_yaw -= rx * gamepad_sensitivity_rad_s * delta
	_pitch = clampf(_pitch - ry * gamepad_sensitivity_rad_s * delta,
		deg_to_rad(min_pitch_deg), deg_to_rad(max_pitch_deg))


## Punto al que apunta la cámara ahora mismo: el primer impacto a lo largo de
## su eje de visión, o un punto lejano si no hay nada. Lo usa `player_input.gd`
## para construir `intent_look_at` — así el jugador dispara adonde mira la
## cámara sobre el hombro, sea cual sea el esquema de control.
func get_aim_point(max_distance_m: float = 100.0) -> Vector3:
	if _camera == null or not _camera.is_inside_tree():
		return global_position - global_transform.basis.z * max_distance_m
	var from := _camera.global_position
	var to := from - _camera.global_transform.basis.z * max_distance_m
	var space_state := _camera.get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(from, to, AIM_RAY_MASK)
	if target is CollisionObject3D:
		query.exclude = [(target as CollisionObject3D).get_rid()]
	var result := space_state.intersect_ray(query)
	if result.is_empty():
		return to
	return result.get("position", to)
