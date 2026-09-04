class_name DefaultBindings
extends RefCounted
## Bindings por defecto de teclado+ratón y mando para las acciones de
## gameplay ya DECLARADAS en `project.godot` (`[input]`) pero sin eventos.
##
## `project.godot` no es de este agente (`ui-ux` es quien posee el remapeo
## definitivo — GDD §10, "Accesibilidad: remapeo completo"), así que aquí solo
## se rellena el `InputMap` EN CALIENTE, al arrancar, y SOLO si la acción
## sigue vacía — un remapeo guardado por `ui-ux`/`Settings` nunca se pisa.
## Por el mismo motivo esto no es un autoload (añadir uno también es tocar
## `project.godot`): lo invoca `player_input.gd._ready()`, que es lo primero
## de este agente que necesita que existan bindings para funcionar.
##
## Réplica de la asignación de teclas del legacy donde tiene sentido
## conservarla (p. ej. `squad_order` en V, como `ComeBackCompanions`,
## `HIDControl.cc:217-218`; `toggle_camera` en F5, como el `mode3D` original,
## `HIDControl.cc:215-216`); el resto son convenciones habituales de shooter
## en tercera persona, pensadas para remapearse sin sorpresas.

## Acciones que este fichero puede rellenar. Deben existir ya en
## `project.godot`; si no existen, `InputMap.action_get_events` devuelve un
## array vacío y simplemente no se añade nada (no se crea la acción: eso
## rompería el contrato de quien sí la posee).
const MANAGED_ACTIONS: Array[StringName] = [
	&"move_forward", &"move_back", &"move_left", &"move_right",
	&"sprint", &"crouch",
	&"fire", &"aim", &"melee", &"reload", &"ability",
	&"interact", &"squad_order", &"toggle_camera",
]


## Añade los eventos por defecto a cada acción gestionada CUYA lista de
## eventos siga vacía. Idempotente: llamarlo varias veces no duplica eventos.
static func ensure_defaults() -> void:
	for action: StringName in MANAGED_ACTIONS:
		if not InputMap.has_action(action):
			continue
		if not InputMap.action_get_events(action).is_empty():
			continue
		for event: InputEvent in _default_events_for(action):
			InputMap.action_add_event(action, event)


static func _default_events_for(action: StringName) -> Array[InputEvent]:
	match action:
		&"move_forward":
			return [_key(KEY_W), _joy_axis(JOY_AXIS_LEFT_Y, -1.0)]
		&"move_back":
			return [_key(KEY_S), _joy_axis(JOY_AXIS_LEFT_Y, 1.0)]
		&"move_left":
			return [_key(KEY_A), _joy_axis(JOY_AXIS_LEFT_X, -1.0)]
		&"move_right":
			return [_key(KEY_D), _joy_axis(JOY_AXIS_LEFT_X, 1.0)]
		&"sprint":
			return [_key(KEY_SHIFT), _joy_button(JOY_BUTTON_LEFT_STICK)]
		&"crouch":
			return [_key(KEY_CTRL), _joy_button(JOY_BUTTON_RIGHT_STICK)]
		&"fire":
			return [_mouse_button(MOUSE_BUTTON_LEFT), _joy_axis(JOY_AXIS_TRIGGER_RIGHT, 1.0)]
		&"aim":
			return [_mouse_button(MOUSE_BUTTON_RIGHT), _joy_axis(JOY_AXIS_TRIGGER_LEFT, 1.0)]
		&"melee":
			return [_key(KEY_F), _joy_button(JOY_BUTTON_B)]
		&"reload":
			return [_key(KEY_R), _joy_button(JOY_BUTTON_X)]
		&"ability":
			return [_key(KEY_Q), _joy_button(JOY_BUTTON_Y)]
		&"interact":
			return [_key(KEY_E), _joy_button(JOY_BUTTON_A)]
		&"squad_order":
			# "V" = ComeBackCompanions en el legacy (HIDControl.cc:217-218).
			return [_key(KEY_V), _joy_button(JOY_BUTTON_DPAD_DOWN)]
		&"toggle_camera":
			# F5 = toggle `mode3D` en el legacy (HIDControl.cc:215-216); es
			# el mismo par de modos que P17 (cenital / 3D).
			return [_key(KEY_F5), _joy_button(JOY_BUTTON_DPAD_UP)]
		_:
			return []


static func _key(keycode: Key) -> InputEventKey:
	var event := InputEventKey.new()
	event.physical_keycode = keycode
	return event


static func _mouse_button(button: MouseButton) -> InputEventMouseButton:
	var event := InputEventMouseButton.new()
	event.button_index = button
	return event


static func _joy_button(button: JoyButton) -> InputEventJoypadButton:
	var event := InputEventJoypadButton.new()
	event.button_index = button
	return event


static func _joy_axis(axis: JoyAxis, axis_value: float) -> InputEventJoypadMotion:
	var event := InputEventJoypadMotion.new()
	event.axis = axis
	event.axis_value = axis_value
	return event
