class_name InputRemapService
extends RefCounted
## Remapeo completo de teclado+ratón y mando (GDD §10, accesibilidad).
##
## `game/src/gameplay/default_bindings.gd` (de `gameplay-ux`... en realidad
## de `godot-gameplay`, ver su cabecera) solo rellena `InputMap` al arrancar
## y SOLO si la acción está vacía, precisamente para no pisar un remapeo
## guardado por este servicio. Este fichero es la otra mitad del contrato:
## el remapeo definitivo, que sí puede sobrescribir.
##
## Cada acción tiene como máximo dos eventos gestionados por slot:
## `SLOT_KEYBOARD_MOUSE` y `SLOT_GAMEPAD`. Reasignar un slot solo toca los
## eventos de esa clase de dispositivo; el otro slot no se ve afectado. Es lo
## que permite remapear teclado y mando de forma independiente.

enum Slot { KEYBOARD_MOUSE, GAMEPAD }

## Todas las acciones remapeables: las 14 de gameplay
## (`DefaultBindings.MANAGED_ACTIONS`) más las dos que son de este agente
## (la consola y la pausa no son "gameplay", son UI).
const MANAGED_ACTIONS: Array[StringName] = [
	&"move_forward", &"move_back", &"move_left", &"move_right",
	&"sprint", &"crouch",
	&"fire", &"aim", &"melee", &"reload", &"ability",
	&"interact", &"squad_order", &"toggle_camera",
	&"toggle_console", &"pause",
]


## Devuelve el evento activo de una acción para un slot, o null si no hay.
static func get_binding(action: StringName, slot: Slot) -> InputEvent:
	if not InputMap.has_action(action):
		return null
	for event: InputEvent in InputMap.action_get_events(action):
		if _slot_of(event) == slot:
			return event
	return null


## Sustituye el evento de un slot por uno nuevo. Si `event` es null, borra el
## slot (deja la acción sin binding para esa clase de dispositivo).
static func set_binding(action: StringName, slot: Slot, event: InputEvent) -> void:
	if not InputMap.has_action(action):
		push_error("InputRemapService: acción desconocida '%s'." % action)
		return
	for existing: InputEvent in InputMap.action_get_events(action):
		if _slot_of(existing) == slot:
			InputMap.action_erase_event(action, existing)
	if event != null:
		InputMap.action_add_event(action, event)


## ¿Ya hay otra acción gestionada usando este mismo evento en el mismo slot?
## Los menús de remapeo deben avisar del choque antes de confirmar, no
## después: reasignar sin avisar dejaría dos acciones inalcanzables por el
## mismo botón sin que el jugador se entere de cuál perdió el suyo.
static func find_conflict(action: StringName, event: InputEvent) -> StringName:
	var slot := _slot_of(event)
	for other: StringName in MANAGED_ACTIONS:
		if other == action:
			continue
		var bound := get_binding(other, slot)
		if bound != null and _events_match(bound, event):
			return other
	return &""


## Restaura los valores de fábrica de TODAS las acciones gestionadas.
static func reset_all_to_defaults() -> void:
	for action: StringName in MANAGED_ACTIONS:
		if InputMap.has_action(action):
			InputMap.action_erase_events(action)
	DefaultBindings.ensure_defaults()
	for action: StringName in [&"toggle_console", &"pause"]:
		for event: InputEvent in _ui_default_events(action):
			InputMap.action_add_event(action, event)


## --- Serialización para `user://settings.json` --------------------------

static func serialize_all() -> Dictionary:
	var out: Dictionary = {}
	for action: StringName in MANAGED_ACTIONS:
		if not InputMap.has_action(action):
			continue
		var events: Array = []
		for event: InputEvent in InputMap.action_get_events(action):
			var packed := _pack_event(event)
			if not packed.is_empty():
				events.append(packed)
		out[String(action)] = events
	return out


## Reemplaza los bindings de todas las acciones gestionadas presentes en
## `data` (formato de `serialize_all`). Las acciones ausentes no se tocan.
static func apply_serialized(data: Dictionary) -> void:
	for action_name: String in data.keys():
		var action := StringName(action_name)
		if not MANAGED_ACTIONS.has(action) or not InputMap.has_action(action):
			continue
		InputMap.action_erase_events(action)
		for packed: Variant in (data[action_name] as Array):
			var event := _unpack_event(packed as Dictionary)
			if event != null:
				InputMap.action_add_event(action, event)


static func _slot_of(event: InputEvent) -> Slot:
	if event is InputEventJoypadButton or event is InputEventJoypadMotion:
		return Slot.GAMEPAD
	return Slot.KEYBOARD_MOUSE


static func _events_match(a: InputEvent, b: InputEvent) -> bool:
	if a.get_class() != b.get_class():
		return false
	if a is InputEventKey and b is InputEventKey:
		return (a as InputEventKey).physical_keycode == (b as InputEventKey).physical_keycode
	if a is InputEventMouseButton and b is InputEventMouseButton:
		return (a as InputEventMouseButton).button_index == (b as InputEventMouseButton).button_index
	if a is InputEventJoypadButton and b is InputEventJoypadButton:
		return (a as InputEventJoypadButton).button_index == (b as InputEventJoypadButton).button_index
	if a is InputEventJoypadMotion and b is InputEventJoypadMotion:
		var ja := a as InputEventJoypadMotion
		var jb := b as InputEventJoypadMotion
		return ja.axis == jb.axis and signf(ja.axis_value) == signf(jb.axis_value)
	return false


static func _pack_event(event: InputEvent) -> Dictionary:
	if event is InputEventKey:
		return {"t": "key", "keycode": int((event as InputEventKey).physical_keycode)}
	if event is InputEventMouseButton:
		return {"t": "mouse", "button": int((event as InputEventMouseButton).button_index)}
	if event is InputEventJoypadButton:
		return {"t": "joy_button", "button": int((event as InputEventJoypadButton).button_index)}
	if event is InputEventJoypadMotion:
		var motion := event as InputEventJoypadMotion
		return {"t": "joy_axis", "axis": int(motion.axis), "sign": signf(motion.axis_value)}
	return {}


static func _unpack_event(packed: Dictionary) -> InputEvent:
	match String(packed.get("t", "")):
		"key":
			var key_event := InputEventKey.new()
			key_event.physical_keycode = int(packed.get("keycode", 0)) as Key
			return key_event
		"mouse":
			var mouse_event := InputEventMouseButton.new()
			mouse_event.button_index = int(packed.get("button", 0)) as MouseButton
			return mouse_event
		"joy_button":
			var joy_event := InputEventJoypadButton.new()
			joy_event.button_index = int(packed.get("button", 0)) as JoyButton
			return joy_event
		"joy_axis":
			var axis_event := InputEventJoypadMotion.new()
			axis_event.axis = int(packed.get("axis", 0)) as JoyAxis
			axis_event.axis_value = float(packed.get("sign", 1.0))
			return axis_event
		_:
			return null


static func _ui_default_events(action: StringName) -> Array[InputEvent]:
	match action:
		&"toggle_console":
			# Convención estándar de consola de depuración. Solo teclado: es
			# herramienta de agentes/desarrollo, no una acción jugable que
			# deba alcanzarse con mando.
			var key := InputEventKey.new()
			key.physical_keycode = KEY_QUOTELEFT
			return [key]
		&"pause":
			var key := InputEventKey.new()
			key.physical_keycode = KEY_ESCAPE
			var joy := InputEventJoypadButton.new()
			joy.button_index = JOY_BUTTON_START
			return [key, joy]
		_:
			return []
