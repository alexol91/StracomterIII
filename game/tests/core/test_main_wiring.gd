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


func test_acknowledging_the_floor_summary_is_what_returns_to_strategy() -> void:
	# El resumen de fin de planta se ponía a la vista y desaparecía en el mismo
	# frame: `FloorRunner` entraba en Estrategia sin esperar a nadie y `UiRoot`
	# solo muestra el resumen en modo Acción. Nadie escuchaba esta intención —
	# la propia cabecera de `UiRoot` lo dejaba escrito.
	_main = _instantiate_main()
	if _main == null:
		assert_true(false, "la escena principal no instancia")
		return
	GameState.set_mode(GameState.Mode.ACTION)
	GameState.action_status = GameState.ActionStatus.NORMAL
	UIIntents.get_singleton().floor_end_acknowledged.emit()
	assert_eq(GameState.mode, GameState.Mode.STRATEGY,
		"leer el resumen tiene que llevar a elegir la siguiente zona")


func test_the_victory_screen_is_what_leads_to_the_credits() -> void:
	# La azotea limpia saltaba directa a los créditos, así que la pantalla de
	# Victoria —escrita, con sus dos botones y su prueba de estilo— no se veía
	# jamás. Ahora los créditos son una decisión del jugador desde ella.
	_main = _instantiate_main()
	if _main == null:
		assert_true(false, "la escena principal no instancia")
		return
	GameState.set_mode(GameState.Mode.ACTION)
	GameState.action_status = GameState.ActionStatus.WIN
	UIIntents.get_singleton().navigate_to_credits_requested.emit()
	assert_eq(GameState.mode, GameState.Mode.CREDITS, "desde la Victoria, a los créditos")


func test_the_credits_of_the_menu_do_not_end_a_run() -> void:
	# La misma intención la usa el menú principal como superposición. Si `Main`
	# no distinguiera, abrir los créditos desde el menú desmontaría la partida.
	_main = _instantiate_main()
	if _main == null:
		assert_true(false, "la escena principal no instancia")
		return
	GameState.set_mode(GameState.Mode.MENU)
	GameState.action_status = GameState.ActionStatus.NORMAL
	UIIntents.get_singleton().navigate_to_credits_requested.emit()
	assert_eq(GameState.mode, GameState.Mode.MENU,
		"los créditos del menú son una superposición, no el final de una partida")


func test_opening_the_console_stops_the_game_from_reading_the_keyboard() -> void:
	# La señal `console_toggled` existía y no la escuchaba NADIE, así que con la
	# consola delante el juego seguía leyendo el teclado: escribir «chutaos»
	# hacía caminar al personaje —la `a` es izquierda, la `s` es atrás— y el
	# ratón seguía girando la cámara. `ActionStatus.CONSOLE` estaba reservado
	# para esto desde el principio.
	_main = _instantiate_main()
	if _main == null:
		assert_true(false, "la escena principal no instancia")
		return
	GameState.set_mode(GameState.Mode.ACTION)
	GameState.action_status = GameState.ActionStatus.NORMAL

	UIIntents.get_singleton().console_toggled.emit(true)
	assert_eq(GameState.action_status, GameState.ActionStatus.CONSOLE,
		"con la consola abierta, el juego no está en modo normal")
	assert_false(UiRoot.cursor_should_be_captured(GameState.mode, false, false,
		GameState.action_status, false),
		"y el cursor vuelve, que es lo que hace falta para escribir")

	UIIntents.get_singleton().console_toggled.emit(false)
	assert_eq(GameState.action_status, GameState.ActionStatus.NORMAL,
		"al cerrarla se vuelve a jugar")
	GameState.action_status = GameState.ActionStatus.NORMAL


func test_the_console_does_not_resurrect_a_dead_player() -> void:
	# Cerrar la consola devuelve el estado a NORMAL, pero no puede pisar un
	# Game Over: se murió mientras la tenía abierta.
	_main = _instantiate_main()
	if _main == null:
		assert_true(false, "la escena principal no instancia")
		return
	GameState.set_mode(GameState.Mode.ACTION)
	GameState.action_status = GameState.ActionStatus.GAME_OVER
	UIIntents.get_singleton().console_toggled.emit(false)
	assert_eq(GameState.action_status, GameState.ActionStatus.GAME_OVER,
		"cerrar la consola no revive a nadie")
	GameState.action_status = GameState.ActionStatus.NORMAL


func test_the_interface_keys_are_bound_from_the_start() -> void:
	# `toggle_console` y `pause` no tenían tecla NUNCA. Los controles de juego
	# los rellena `PlayerInput` al aparecer el jugador, así que aparecen al
	# bajar a una planta; estos dos solo se asignaban dentro de
	# `reset_all_to_defaults()`, y a eso solo se llega pulsando «Restaurar
	# controles de fábrica» en Ajustes. Resultado: la consola y la PAUSA no
	# respondían a nada, y la lista de controles salía con guiones si no habías
	# jugado antes.
	for action: StringName in [&"toggle_console", &"pause"]:
		InputMap.action_erase_events(action)
	_main = _instantiate_main()
	if _main == null:
		assert_true(false, "la escena principal no instancia")
		return
	for action: StringName in [&"toggle_console", &"pause", &"move_forward", &"fire"]:
		assert_true(InputMap.has_action(action), "falta la acción '%s'" % action)
		assert_false(InputMap.action_get_events(action).is_empty(),
			"'%s' se queda sin tecla: pulsarla no hace nada y nadie sabe por qué" % action)


func test_the_quick_run_skips_the_class_screen_and_lands_in_strategy() -> void:
	# El «modo libre» del menú de 2012 (`Aplication.cc:183-192`): Capitán,
	# zona 3, puntuación a cero y directo a Estrategia. `GameState.Mode.FREE`
	# estaba declarado y no lo usaba nadie: era el último hueco de P14.
	_main = _instantiate_main()
	if _main == null:
		assert_true(false, "la escena principal no instancia")
		return
	GameState.score = 500
	UIIntents.get_singleton().quick_run_requested.emit()
	assert_eq(GameState.mode, GameState.Mode.STRATEGY,
		"la partida rápida salta la elección de clase y va a Estrategia")
	assert_eq(GameState.player_archetype, &"captain", "el original ponía Capitán")
	assert_eq(GameState.current_zone, GameState.DEFAULT_ZONE,
		"y la zona 3, que es la de arranque del legacy")
	assert_eq(GameState.score, 0, "una partida nueva empieza a cero")
	assert_true(GameState.free_mode, "y queda marcada como escaramuza")


func test_a_normal_run_is_not_free_mode() -> void:
	_main = _instantiate_main()
	if _main == null:
		assert_true(false, "la escena principal no instancia")
		return
	UIIntents.get_singleton().quick_run_requested.emit()
	assert_true(GameState.free_mode, "primero, partida rápida")
	# Empezar una campaña detrás tiene que limpiar la bandera: si no, la torre
	# no subiría de planta y el jugador se quedaría dando vueltas a la 1.
	UIIntents.get_singleton().run_start_requested.emit(&"technician")
	assert_false(GameState.free_mode, "una partida nueva no es una escaramuza")
