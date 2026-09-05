class_name ModernAnimator
extends Node3D
## Anima un personaje con `AnimationPlayer`, para los modelos nuevos.
##
## Expone **la misma interfaz** que `FrameAnimator`, que anima intercambiando
## las cinco mallas de 2012. Esa simetría es lo que permite que el truco
## `: retro on|off` cambie de modelos sin que nadie más se entere: quien pide
## "camina más rápido" no sabe ni le importa si detrás hay un esqueleto o cinco
## poses.

## Nombres de clip esperados en los modelos CC0 de Kenney.
const CLIP_IDLE: StringName = &"idle"
const CLIP_WALK: StringName = &"walk"
const CLIP_SPRINT: StringName = &"sprint"
const CLIP_DIE: StringName = &"die"

@export var playing: bool = true
## Velocidad relativa: 0 detiene, 1 es el ritmo nominal. Misma semántica que en
## `FrameAnimator`.
var speed_scale: float = 1.0:
	set(value):
		speed_scale = value
		_refresh()

var _player: AnimationPlayer = null
var _current: StringName = &""


func _ready() -> void:
	_player = _find_animation_player(self)
	if _player == null:
		push_warning("ModernAnimator: el modelo no trae AnimationPlayer")
		return
	_play(CLIP_IDLE)


## Cuántos clips tiene. Equivalente a `FrameAnimator.frame_count()` para que
## las pruebas puedan comprobar que hay animación sin saber de qué tipo es.
func frame_count() -> int:
	return _player.get_animation_list().size() if _player != null else 0


func stop_at_idle() -> void:
	_play(CLIP_IDLE)


func play_death() -> void:
	_play(CLIP_DIE)
	playing = false


func _refresh() -> void:
	if _player == null:
		return
	# El clip se elige por la velocidad real, no por un estado que alguien
	# tenga que acordarse de actualizar.
	if not playing or speed_scale <= 0.05:
		_play(CLIP_IDLE)
	elif speed_scale > 1.4:
		_play(CLIP_SPRINT)
	else:
		_play(CLIP_WALK)
	_player.speed_scale = maxf(speed_scale, 0.1)


func _play(clip: StringName) -> void:
	if _player == null or _current == clip:
		return
	if not _player.has_animation(String(clip)):
		return
	_current = clip
	_player.play(String(clip))


func _find_animation_player(node: Node) -> AnimationPlayer:
	if node is AnimationPlayer:
		return node as AnimationPlayer
	for child: Node in node.get_children():
		var found := _find_animation_player(child)
		if found != null:
			return found
	return null
