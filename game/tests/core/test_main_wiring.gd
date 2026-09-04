extends TestCase
## Comprueba que la escena principal existe y engancha las piezas.
##
## Es la prueba que faltaba para poder decir "esto es un juego" en vez de "esto
## es un conjunto de sistemas probados": hasta que algo montaba la planta y
## escuchaba a la interfaz, todo lo demás eran piezas sueltas verdes.

const MAIN_SCENE: String = "res://scenes/main.tscn"

var _main: Node = null


func after_each() -> void:
	if _main != null and is_instance_valid(_main):
		if _main.get_parent() != null:
			_main.get_parent().remove_child(_main)
		_main.free()
	_main = null


func _instantiate_main() -> Node:
	var packed := load(MAIN_SCENE) as PackedScene
	if packed == null:
		return null
	var node := packed.instantiate()
	var tree := Engine.get_main_loop() as SceneTree
	if tree != null:
		tree.root.add_child(node)
	return node


func test_the_project_boots_into_the_main_scene() -> void:
	assert_eq(ProjectSettings.get_setting("application/run/main_scene"), MAIN_SCENE,
		"la escena principal debe ser el juego, no el diagnóstico de arranque")


func test_main_scene_wires_ui_loader_and_runner() -> void:
	_main = _instantiate_main()
	assert_not_null(_main, "la escena principal no instancia")
	if _main == null:
		return
	assert_not_null(_main.get_node_or_null("%UiRoot"), "falta la interfaz")
	assert_not_null(_main.get_node_or_null("%LevelLoader"), "falta el cargador de niveles")
	assert_not_null(_main.get_node_or_null("%FloorRunner"), "falta el bucle de planta")


func test_starting_a_run_moves_the_game_into_strategy() -> void:
	_main = _instantiate_main()
	if _main == null:
		assert_true(false, "la escena principal no instancia")
		return
	UIIntents.get_singleton().run_start_requested.emit(&"technician")
	assert_eq(GameState.mode, GameState.Mode.STRATEGY,
		"empezar partida debe llevar a Estrategia, que es donde se elige zona")
	assert_eq(GameState.player_archetype, &"technician",
		"la clase elegida debe quedar registrada")
	assert_eq(GameState.current_floor, GameState.FIRST_FLOOR,
		"una partida nueva empieza en la primera planta")


func test_console_commands_of_the_run_are_registered() -> void:
	_main = _instantiate_main()
	if _main == null:
		assert_true(false, "la escena principal no instancia")
		return
	for command: String in ["floor", "zone", "start", "status"]:
		assert_true(DevConsole.has_command(command),
			"falta el comando de consola '%s'" % command)


func test_floor_command_rejects_out_of_range() -> void:
	_main = _instantiate_main()
	if _main == null:
		assert_true(false, "la escena principal no instancia")
		return
	var before := GameState.current_floor
	var out := DevConsole.execute("floor 99")
	assert_true(out.contains("rango"), "debe rechazar una planta fuera de rango")
	assert_eq(GameState.current_floor, before, "no debe cambiar la planta al rechazar")
