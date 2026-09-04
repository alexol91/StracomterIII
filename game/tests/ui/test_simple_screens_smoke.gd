extends TestCase
## Pantallas sencillas (Título, Selección de clase, Créditos): arrancan sin
## reventar y sus botones emiten intención en vez de tocar `GameState`.
## Pausa/Fin de planta/Game Over/Victoria/Opciones ya tienen su propia
## prueba dedicada donde hacía falta algo más que "no revienta".

var _node: Node = null
var _snapshot: Dictionary = {}
## `test_title_screen_continue_disabled_without_save` necesita comprobar el
## caso "sin partida guardada" contra la ruta REAL de `SaveSystem`
## (`title_screen.gd` no acepta una ruta de prueba): se hace una copia de
## seguridad de bytes si ya había una partida y se restaura después, en vez
## de arriesgarse a borrar para siempre la partida de quien ejecute esto.
var _save_backup: PackedByteArray = PackedByteArray()
var _had_save: bool = false


func before_each() -> void:
	_snapshot = GameState.to_dict()
	_had_save = SaveSystem.has_save()
	if _had_save:
		_save_backup = FileAccess.get_file_as_bytes(SaveSystem.SAVE_PATH)


func after_each() -> void:
	UiTestSceneBuilders.free_node(_node)
	_node = null
	GameState.from_dict(_snapshot)
	if _had_save:
		var file := FileAccess.open(SaveSystem.SAVE_PATH, FileAccess.WRITE)
		file.store_buffer(_save_backup)
		file.close()


func test_title_screen_new_game_emits_navigation_intent() -> void:
	_node = UiTestSceneBuilders.instantiate_in_tree(UiTestSceneBuilders.TITLE_SCENE)
	var received := 0
	var callable := func() -> void: received += 1
	UIIntents.get_singleton().navigate_to_class_select_requested.connect(callable)
	(_node.get_node("%NewGameButton") as Button).pressed.emit()
	UIIntents.get_singleton().navigate_to_class_select_requested.disconnect(callable)
	assert_eq(received, 1)


func test_title_screen_continue_disabled_without_save() -> void:
	SaveSystem.delete_save()
	_node = UiTestSceneBuilders.instantiate_in_tree(UiTestSceneBuilders.TITLE_SCENE)
	assert_true((_node.get_node("%ContinueButton") as Button).disabled)


func test_class_select_confirm_emits_run_start_with_chosen_archetype() -> void:
	_node = UiTestSceneBuilders.instantiate_in_tree(UiTestSceneBuilders.CLASS_SELECT_SCENE)
	var screen := _node as ClassSelectScreen
	var cards := _node.get_node("%CardsBox") as HBoxContainer
	(cards.get_child(1) as Button).toggled.emit(true)
	assert_eq(screen.selected_archetype(), ClassSelectScreen.ARCHETYPES[1])

	var received: Array = []
	var callable := func(archetype: StringName) -> void: received.append(archetype)
	UIIntents.get_singleton().run_start_requested.connect(callable)
	var before := GameState.to_dict()
	(_node.get_node("%ConfirmButton") as Button).pressed.emit()
	UIIntents.get_singleton().run_start_requested.disconnect(callable)

	assert_eq(received, [ClassSelectScreen.ARCHETYPES[1]])
	assert_eq(GameState.to_dict(), before, "elegir clase no debe mutar GameState")


func test_class_select_shows_four_archetypes_with_real_stats() -> void:
	_node = UiTestSceneBuilders.instantiate_in_tree(UiTestSceneBuilders.CLASS_SELECT_SCENE)
	var cards := _node.get_node("%CardsBox") as HBoxContainer
	assert_eq(cards.get_child_count(), 4)
	var stats_label := _node.get_node("%StatsLabel") as Label
	var captain_stats := Balance.character(&"captain")
	assert_true(stats_label.text.contains(str(int(captain_stats.max_health))))
