class_name Door
extends StaticBody3D
## Puerta que abre/cierra y publica su estado por `EventBus`.
##
## REGLA DURA: este fichero NO TOCA LA NAVEGACIÓN. Réplica de `Door.cc` del
## legacy (estado inicial cerrada, `Switch()` alterna, fundido de 1000 ms),
## pero aquí solo se ocupa del cuerpo físico y del aviso; quien reacciona
## conmutando el `NavigationLink3D`/rehorneando regiones es `ai-navegacion`,
## que escucha `EventBus.door_state_changed` (ADR-004, `02-arquitectura.md`).
##
## Estructura de nodos esperada (`door.tscn`):
##   Door (StaticBody3D, este script)
##   ├── CollisionShape3D   — se desactiva al abrir (réplica: `body->Active(false)`)
##   └── Hinge (Node3D)      — pivote de la hoja
##        └── DoorLeaf (MeshInstance3D)  — gira al abrir

signal opened
signal closed

## Identificador estable para `EventBus.door_state_changed` y para la
## consola de depuración. Debe ser único por nivel.
@export var door_id: int = 0
@export var start_open: bool = false
## Grados que gira la hoja al abrir. El legacy no animaba rotación (fundía
## opacidad); aquí se elige una rotación visible porque el bloqueo con
## primitivas no tiene textura que fundir.
@export var open_angle_deg: float = 100.0
## Duración de la animación de apertura/cierre. Réplica del fundido de 1000 ms
## del legacy (`AnimationControl::addFadeOut`, `Door.cc:94-111`).
const TRANSITION_DURATION_S: float = 1.0

var is_open: bool = false

@onready var _collision: CollisionShape3D = get_node_or_null("CollisionShape3D")
@onready var _hinge: Node3D = get_node_or_null("Hinge")
var _tween: Tween = null


func _ready() -> void:
	add_to_group(&"doors")
	# Se viste sola: `WorldDressing` recorre el mapa cuando la planta entra en
	# el árbol, y para entonces las puertas todavía son marcadores que
	# `LevelLoader` no ha sustituido. Quien nace tarde se pinta él.
	add_to_group(&"self_dressed")
	is_open = start_open
	_apply_state(true)
	_apply_style()
	PresentationStyle.style_changed.connect(_on_style_changed)


func _apply_style() -> void:
	var leaf := get_node_or_null("Hinge/DoorLeaf") as MeshInstance3D
	if leaf == null:
		return
	var material := PresentationStyle.surface_material(WorldSurface.Kind.DOOR)
	if material == null:
		return
	for i: int in range(leaf.get_surface_override_material_count()):
		leaf.set_surface_override_material(i, material)


func _on_style_changed(_chutaos: bool) -> void:
	_apply_style()


## Alterna el estado. Réplica de `Door::Switch()` (legacy).
func toggle() -> void:
	set_open(not is_open)


func set_open(open: bool) -> void:
	if open == is_open:
		return
	is_open = open
	_apply_state(false)
	EventBus.door_state_changed.emit(door_id, is_open)
	if is_open:
		opened.emit()
	else:
		closed.emit()


func _apply_state(instant: bool) -> void:
	# Cerrada = sólida (réplica: `body->Active(true)`); abierta = se atraviesa.
	if _collision != null:
		_collision.disabled = is_open
	if _hinge == null:
		return
	var target_deg := open_angle_deg if is_open else 0.0
	if instant:
		_hinge.rotation_degrees.y = target_deg
		return
	if _tween != null and _tween.is_valid():
		_tween.kill()
	_tween = create_tween()
	_tween.tween_property(_hinge, "rotation_degrees:y", target_deg, TRANSITION_DURATION_S)
