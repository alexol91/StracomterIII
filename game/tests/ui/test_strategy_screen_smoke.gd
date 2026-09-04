extends TestCase
## Instancia la pantalla de Estrategia de verdad (no solo el modelo puro) y
## comprueba que arranca con las 6 zonas, permite elegir una y no cambia
## `GameState` al hacerlo — la comprobación de comportamiento que
## `test_no_state_mutation.gd` no puede hacer por análisis estático porque
## pasa por señales conectadas con `func(...) -> void:` en tiempo de
## ejecución.

var _node: Node = null
var _snapshot: Dictionary = {}


func before_each() -> void:
	_snapshot = GameState.to_dict()
	GameState.player_archetype = &"captain"
	GameState.current_floor = 1


func after_each() -> void:
	UiTestSceneBuilders.free_node(_node)
	_node = null
	GameState.from_dict(_snapshot)


func test_strategy_screen_builds_six_zone_buttons() -> void:
	_node = UiTestSceneBuilders.instantiate_in_tree(UiTestSceneBuilders.STRATEGY_SCENE)
	assert_not_null(_node)
	var screen := _node as StrategyScreen
	assert_not_null(screen, "la raíz debería llevar el script StrategyScreen")
	var grid := screen.get_node("%ZoneGrid") as GridContainer
	assert_eq(grid.get_child_count(), GameState.ZONES_PER_FLOOR)


func test_selecting_a_zone_does_not_touch_gamestate() -> void:
	_node = UiTestSceneBuilders.instantiate_in_tree(UiTestSceneBuilders.STRATEGY_SCENE)
	var screen := _node as StrategyScreen
	var grid := screen.get_node("%ZoneGrid") as GridContainer
	var before := GameState.to_dict()
	(grid.get_child(2) as Button).button_pressed = true
	(grid.get_child(2) as Button).toggled.emit(true)
	assert_eq(screen.selected_zone(), 3)
	assert_eq(GameState.to_dict(), before, "elegir zona no debe mutar GameState")


func test_confirm_emits_intent_instead_of_mutating_state() -> void:
	_node = UiTestSceneBuilders.instantiate_in_tree(UiTestSceneBuilders.STRATEGY_SCENE)
	var screen := _node as StrategyScreen
	var grid := screen.get_node("%ZoneGrid") as GridContainer
	(grid.get_child(0) as Button).toggled.emit(true)

	var received: Array = []
	var callable := func(zone: int, xp: int, squad: Dictionary) -> void:
		received.append([zone, xp, squad])
	UIIntents.get_singleton().strategy_confirmed.connect(callable)
	var before := GameState.to_dict()
	screen.get_node("%ConfirmButton").pressed.emit()
	UIIntents.get_singleton().strategy_confirmed.disconnect(callable)

	assert_size(received, 1)
	assert_eq(int(received[0][0]), 1)
	assert_eq(GameState.to_dict(), before, "confirmar no debe mutar GameState directamente")
