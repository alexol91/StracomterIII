class_name UiMotion
extends RefCounted
## Movimiento compartido de la interfaz (encargo: "transiciones de 150-250 ms
## con Tween. Nada instantáneo, nada lento").
##
## Todas las duraciones caen dentro de ese rango a propósito. No son datos de
## balanceo (ADR-005 habla de vida/daño/cadencia de JUEGO): son constantes de
## presentación, del mismo tipo que ya fija `DAMAGE_FLASH_DURATION_S` en
## `hud.gd`.
##
## Cada tween se crea con `Node.create_tween()`, que Godot mata solo cuando
## el nodo dueño sale del árbol — no hay ningún temporizador ni `Callable`
## que sobreviva al nodo, así que no hace falta ningún registro que vaciar.

const TRANSITION_DURATION_S: float = 0.2
const FEEDBACK_DURATION_S: float = 0.12
const FEEDBACK_SCALE: float = 1.045


## Aparición de una pantalla completa al hacerse visible (`UiRoot`, en la
## transición de oculta a visible). Empieza transparente y se desvanece a
## opaca: "nada instantáneo" en la propia navegación del menú.
static func fade_in(control: Control) -> void:
	if control == null or not is_instance_valid(control):
		return
	control.modulate.a = 0.0
	var tween := control.create_tween()
	tween.tween_property(control, ^"modulate:a", 1.0, TRANSITION_DURATION_S)


## Respuesta de foco/hover de un botón: un pulso de escala breve. Se llama
## una vez por botón tras crearlo (estático en un `.tscn` vía `@onready`, o
## recién construido en un bucle como las tarjetas de clase/zona).
static func wire_button_feedback(button: BaseButton) -> void:
	if button == null:
		return
	button.pivot_offset = button.size * 0.5
	button.resized.connect(func() -> void: button.pivot_offset = button.size * 0.5)
	button.focus_entered.connect(func() -> void: _pulse(button))
	button.mouse_entered.connect(func() -> void: _pulse(button))


static func _pulse(button: BaseButton) -> void:
	var tween := button.create_tween()
	tween.tween_property(button, ^"scale", Vector2.ONE * FEEDBACK_SCALE, FEEDBACK_DURATION_S)
	tween.tween_property(button, ^"scale", Vector2.ONE, FEEDBACK_DURATION_S)
