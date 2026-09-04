extends TestCase
## `default_bindings.gd`: teclado+ratón Y mando para las acciones que ya
## declara `project.godot` sin eventos, y nunca pisa un binding existente.

func after_each() -> void:
	# Deja el InputMap en un estado consistente para el resto de la tanda,
	# sea cual sea el orden en que se ejecuten los ficheros de prueba.
	for action: StringName in DefaultBindings.MANAGED_ACTIONS:
		for event: InputEvent in InputMap.action_get_events(action).duplicate():
			InputMap.action_erase_event(action, event)
	DefaultBindings.ensure_defaults()


func test_fills_every_managed_action_when_empty() -> void:
	for action: StringName in DefaultBindings.MANAGED_ACTIONS:
		for event: InputEvent in InputMap.action_get_events(action).duplicate():
			InputMap.action_erase_event(action, event)
	DefaultBindings.ensure_defaults()
	for action: StringName in DefaultBindings.MANAGED_ACTIONS:
		assert_false(InputMap.action_get_events(action).is_empty(),
			"'%s' debe tener al menos un evento por defecto" % action)


func test_move_forward_works_with_keyboard_and_gamepad() -> void:
	for event: InputEvent in InputMap.action_get_events(&"move_forward").duplicate():
		InputMap.action_erase_event(&"move_forward", event)
	DefaultBindings.ensure_defaults()

	var has_keyboard := false
	var has_gamepad := false
	for event: InputEvent in InputMap.action_get_events(&"move_forward"):
		if event is InputEventKey:
			has_keyboard = true
		if event is InputEventJoypadMotion or event is InputEventJoypadButton:
			has_gamepad = true
	assert_true(has_keyboard, "debe funcionar con teclado+ratón")
	assert_true(has_gamepad, "debe funcionar con mando")


func test_does_not_override_an_existing_binding() -> void:
	for event: InputEvent in InputMap.action_get_events(&"fire").duplicate():
		InputMap.action_erase_event(&"fire", event)
	var custom := InputEventKey.new()
	custom.physical_keycode = KEY_Z
	InputMap.action_add_event(&"fire", custom)

	DefaultBindings.ensure_defaults()

	var events := InputMap.action_get_events(&"fire")
	assert_size(events, 1, "no debe tocar una acción que ya tiene un binding, sea cual sea")
	var kept := events[0] as InputEventKey
	assert_not_null(kept)
	if kept != null:
		assert_eq(kept.physical_keycode, KEY_Z, "el remapeo de ui-ux/Settings no se pisa")


func test_is_idempotent() -> void:
	for action: StringName in DefaultBindings.MANAGED_ACTIONS:
		for event: InputEvent in InputMap.action_get_events(action).duplicate():
			InputMap.action_erase_event(action, event)
	DefaultBindings.ensure_defaults()
	var first_count := InputMap.action_get_events(&"fire").size()
	DefaultBindings.ensure_defaults()
	DefaultBindings.ensure_defaults()
	assert_eq(InputMap.action_get_events(&"fire").size(), first_count,
		"llamarlo varias veces no debe duplicar eventos")
