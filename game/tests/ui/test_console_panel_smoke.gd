extends TestCase
## Instancia real de la consola: abre/cierra, ejecuta un comando de verdad
## contra `DevConsole` y comprueba que la salida llega al `RichTextLabel`.

var _node: Node = null


func after_each() -> void:
	UiTestSceneBuilders.free_node(_node)
	_node = null


func test_console_starts_closed() -> void:
	_node = UiTestSceneBuilders.instantiate_in_tree(UiTestSceneBuilders.CONSOLE_SCENE)
	var console := _node as ConsolePanel
	assert_not_null(console)
	assert_false(console.is_open())


func test_toggle_open_and_close() -> void:
	_node = UiTestSceneBuilders.instantiate_in_tree(UiTestSceneBuilders.CONSOLE_SCENE)
	var console := _node as ConsolePanel
	console.set_open(true)
	assert_true(console.is_open())
	console.set_open(false)
	assert_false(console.is_open())


func test_submitting_a_line_reaches_dev_console_and_output_label() -> void:
	_node = UiTestSceneBuilders.instantiate_in_tree(UiTestSceneBuilders.CONSOLE_SCENE)
	var console := _node as ConsolePanel
	console.set_open(true)
	var input := console.get_node("%ConsoleInput") as LineEdit
	input.text = "help"
	input.text_submitted.emit("help")
	var output := console.get_node("%ConsoleOutput") as RichTextLabel
	assert_true(output.text.contains("help"), "el eco del comando debería verse en la salida")
	assert_true(output.text.contains("Comandos:"), "la respuesta de 'help' debería verse en la salida")
	assert_eq(console.history().entries(), ["help"])
