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


# --- Arrancar la primera planta de verdad ---

func test_floor_one_actually_starts_from_the_menu() -> void:
	# La prueba que faltaba, y que costó cara: el juego arrancaba, la interfaz
	# respondía, la planta se cargaba... y `FloorRunner` fallaba con "no se
	# pudo montar mapP1" porque el jugador no aparecía. Es decir, el juego era
	# INJUGABLE desde el menú, y ninguna prueba lo notaba porque todas cargaban
	# el nivel con `spawn_player = false` o comprobaban piezas por separado.
	_main = _instantiate_main()
	assert_not_null(_main, "no se pudo instanciar la escena principal")
	if _main == null:
		return
	var intents := UIIntents.get_singleton()
	intents.run_start_requested.emit(&"captain")
	intents.strategy_confirmed.emit(1, 0, {})

	var loader := _main.get_node_or_null("LevelLoader") as LevelLoader
	assert_not_null(loader, "la escena principal debe traer LevelLoader")
	if loader == null:
		return
	var level := loader.current()
	assert_not_null(level, "la planta 1 no llegó a montarse")
	if level == null:
		return
	assert_not_null(level.player, "sin jugador no hay partida que jugar")


func test_a_spawn_at_the_world_origin_still_counts_as_a_spawn() -> void:
	# La causa de lo anterior: `Transform3D.IDENTITY` se usaba como centinela
	# de «este mapa no trae marcador de jugador», y SEIS de los mapas
	# convertidos —mapP1 incluido, que es la zona 1 de la planta 1— tienen su
	# marcador exactamente en el origen. El centinela era un valor legítimo del
	# dato. Es el principio de los valores por defecto de CLAUDE.md en su forma
	# más cara.
	var loader := LevelLoader.new()
	var tree := Engine.get_main_loop() as SceneTree
	tree.root.add_child(loader)
	var level := loader.load_level("res://maps/legacy/mapP1.tscn", &"captain", false)
	assert_not_null(level, "mapP1 debe cargar")
	if level != null:
		assert_eq(level.player_spawn, Transform3D.IDENTITY,
			"este mapa tiene el spawn en el origen: es el caso que rompía")
		assert_true(level.has_player_spawn(),
			"un marcador en el origen sigue siendo un marcador")
	tree.root.remove_child(loader)
	loader.queue_free()
