class_name FrameAnimator
extends Node3D
## Anima un personaje intercambiando mallas, como hacía el original.
##
## En 2012 no había esqueleto: cada personaje eran **cinco mallas completas**
## que el motor iba mostrando por turnos (`ResourceManager.cc` registraba los
## modelos como `tipo * 5 + fotograma`). Se conserva esa técnica en vez de
## rehacer el rigging, por dos razones: la geometría original es la que es —los
## cinco fotogramas ya están modelados y son el trabajo del equipo—, y un ciclo
## de cinco poses a 10 fps es exactamente el aspecto que tenía el juego.
##
## Los cinco fotogramas comparten topología (misma cuenta de vértices), así que
## en el futuro se podrían convertir en objetivos de mezcla para interpolar.
## Hoy se muestran a saltos, que es lo fiel.

## Fotogramas por segundo del ciclo. El original no fijaba una tasa; diez da un
## paso legible sin parecer una animación rota.
@export var frames_per_second: float = 10.0
## Si es false, se queda quieto en el fotograma de reposo.
@export var playing: bool = true
## Fotograma que se muestra en reposo.
@export var idle_frame: int = 0

var _frames: Array[Node3D] = []
var _current: int = 0
var _accumulated_s: float = 0.0


func _ready() -> void:
	for child: Node in get_children():
		var mesh := child as Node3D
		if mesh != null:
			_frames.append(mesh)
	_show_only(idle_frame)
	set_process(not _frames.is_empty())


func frame_count() -> int:
	return _frames.size()


func current_frame() -> int:
	return _current


## Velocidad de reproducción relativa: 0 detiene, 1 es el ritmo nominal. La usa
## el controlador para que la animación siga al movimiento real y no vaya a su
## aire mientras el personaje está parado.
var speed_scale: float = 1.0


func _process(delta: float) -> void:
	if not playing or _frames.size() < 2 or speed_scale <= 0.0:
		return
	_accumulated_s += delta * speed_scale
	var period := 1.0 / maxf(frames_per_second, 0.001)
	while _accumulated_s >= period:
		_accumulated_s -= period
		_show_only((_current + 1) % _frames.size())


func stop_at_idle() -> void:
	_show_only(idle_frame)
	_accumulated_s = 0.0


func _show_only(index: int) -> void:
	if _frames.is_empty():
		return
	_current = clampi(index, 0, _frames.size() - 1)
	for i: int in range(_frames.size()):
		_frames[i].visible = (i == _current)
