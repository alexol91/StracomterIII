extends TestCase
## Remapeo completo de teclado+ratón y mando (GDD §10). `InputMap` es un
## singleton del motor compartido por toda la suite (incluidas las pruebas de
## `gameplay` sobre `DefaultBindings`): cada prueba aquí solo toca acciones
## que restaura ella misma en `after_each`, tomando una foto con
## `InputMap.action_get_events()` antes de empezar.

## `test_reset_all_to_defaults_restores_toggle_console_and_pause` toca las 16
## acciones gestionadas (borra y vuelve a rellenar todas), así que la foto
## debe cubrirlas todas y no solo las que cada prueba toca a mano.
var _snapshot: Dictionary = {}


func before_each() -> void:
	_snapshot.clear()
	for action: StringName in InputRemapService.MANAGED_ACTIONS:
		if InputMap.has_action(action):
			_snapshot[action] = InputMap.action_get_events(action).duplicate()


func after_each() -> void:
	for action: StringName in _snapshot:
		if not InputMap.has_action(action):
			continue
		InputMap.action_erase_events(action)
		for event: InputEvent in (_snapshot[action] as Array):
			InputMap.action_add_event(action, event)


func _key(code: Key) -> InputEventKey:
	var event := InputEventKey.new()
	event.physical_keycode = code
	return event


func _joy_button(button: JoyButton) -> InputEventJoypadButton:
	var event := InputEventJoypadButton.new()
	event.button_index = button
	return event


func test_set_and_get_binding_round_trip_keyboard_slot() -> void:
	InputRemapService.set_binding(&"fire", InputRemapService.Slot.KEYBOARD_MOUSE, _key(KEY_G))
	var bound := InputRemapService.get_binding(&"fire", InputRemapService.Slot.KEYBOARD_MOUSE)
	assert_not_null(bound)
	assert_eq((bound as InputEventKey).physical_keycode, KEY_G)


func test_keyboard_and_gamepad_slots_are_independent() -> void:
	InputRemapService.set_binding(&"fire", InputRemapService.Slot.KEYBOARD_MOUSE, _key(KEY_G))
	InputRemapService.set_binding(&"fire", InputRemapService.Slot.GAMEPAD, _joy_button(JOY_BUTTON_A))
	var kb := InputRemapService.get_binding(&"fire", InputRemapService.Slot.KEYBOARD_MOUSE)
	var pad := InputRemapService.get_binding(&"fire", InputRemapService.Slot.GAMEPAD)
	assert_not_null(kb)
	assert_not_null(pad)
	assert_true(kb is InputEventKey)
	assert_true(pad is InputEventJoypadButton)


func test_set_binding_null_clears_slot() -> void:
	InputRemapService.set_binding(&"aim", InputRemapService.Slot.KEYBOARD_MOUSE, _key(KEY_H))
	InputRemapService.set_binding(&"aim", InputRemapService.Slot.KEYBOARD_MOUSE, null)
	assert_null(InputRemapService.get_binding(&"aim", InputRemapService.Slot.KEYBOARD_MOUSE))


func test_find_conflict_detects_same_key_on_another_action() -> void:
	InputRemapService.set_binding(&"fire", InputRemapService.Slot.KEYBOARD_MOUSE, _key(KEY_J))
	var conflict := InputRemapService.find_conflict(&"aim", _key(KEY_J))
	assert_eq(conflict, &"fire")


func test_find_conflict_is_empty_when_no_collision() -> void:
	InputRemapService.set_binding(&"fire", InputRemapService.Slot.KEYBOARD_MOUSE, _key(KEY_J))
	var conflict := InputRemapService.find_conflict(&"aim", _key(KEY_K))
	assert_eq(conflict, &"")


func test_serialize_and_apply_round_trip() -> void:
	InputRemapService.set_binding(&"fire", InputRemapService.Slot.KEYBOARD_MOUSE, _key(KEY_L))
	var packed := InputRemapService.serialize_all()
	InputRemapService.set_binding(&"fire", InputRemapService.Slot.KEYBOARD_MOUSE, _key(KEY_M))
	InputRemapService.apply_serialized(packed)
	var bound := InputRemapService.get_binding(&"fire", InputRemapService.Slot.KEYBOARD_MOUSE)
	assert_eq((bound as InputEventKey).physical_keycode, KEY_L)


func test_reset_all_to_defaults_restores_toggle_console_and_pause() -> void:
	InputRemapService.set_binding(&"toggle_console", InputRemapService.Slot.KEYBOARD_MOUSE, _key(KEY_Z))
	InputRemapService.set_binding(&"pause", InputRemapService.Slot.KEYBOARD_MOUSE, _key(KEY_X))
	InputRemapService.reset_all_to_defaults()
	var console_bound := InputRemapService.get_binding(&"toggle_console", InputRemapService.Slot.KEYBOARD_MOUSE)
	var pause_bound := InputRemapService.get_binding(&"pause", InputRemapService.Slot.KEYBOARD_MOUSE)
	assert_eq((console_bound as InputEventKey).physical_keycode, KEY_QUOTELEFT)
	assert_eq((pause_bound as InputEventKey).physical_keycode, KEY_ESCAPE)
