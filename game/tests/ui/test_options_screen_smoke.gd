extends TestCase
## Instancia real de Opciones: arranca sin reventar, construye la lista de
## remapeo completa y el flujo de "pulsa una tecla nueva" funciona de
## verdad contra `InputMap`.

var _node: Node = null
var _fire_snapshot: Array = []


func before_each() -> void:
	if InputMap.has_action(&"fire"):
		_fire_snapshot = InputMap.action_get_events(&"fire").duplicate()


func after_each() -> void:
	UiTestSceneBuilders.free_node(_node)
	_node = null
	if InputMap.has_action(&"fire"):
		InputMap.action_erase_events(&"fire")
		for event: InputEvent in _fire_snapshot:
			InputMap.action_add_event(&"fire", event)


func test_options_screen_builds_one_row_per_managed_action() -> void:
	_node = UiTestSceneBuilders.instantiate_in_tree(UiTestSceneBuilders.OPTIONS_SCENE)
	assert_not_null(_node)
	var remap_list := _node.get_node("%RemapList") as VBoxContainer
	assert_eq(remap_list.get_child_count(), InputRemapService.MANAGED_ACTIONS.size())


func test_rebind_flow_captures_next_key_press() -> void:
	_node = UiTestSceneBuilders.instantiate_in_tree(UiTestSceneBuilders.OPTIONS_SCENE)
	var options := _node as OptionsScreen
	var remap_list := _node.get_node("%RemapList") as VBoxContainer
	var fire_row_index := InputRemapService.MANAGED_ACTIONS.find(&"fire")
	var row := remap_list.get_child(fire_row_index) as HBoxContainer
	var kb_button := row.get_child(1) as Button
	kb_button.pressed.emit()
	assert_eq(kb_button.text, Localization.t(&"OPTIONS_BINDING_WAITING"))

	var key_event := InputEventKey.new()
	key_event.physical_keycode = KEY_N
	key_event.pressed = true
	options._input(key_event)

	var bound := InputRemapService.get_binding(&"fire", InputRemapService.Slot.KEYBOARD_MOUSE)
	assert_eq((bound as InputEventKey).physical_keycode, KEY_N)
	assert_eq(kb_button.text, (bound as InputEventKey).as_text())
