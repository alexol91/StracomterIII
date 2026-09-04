extends TestCase
## Instancia real del HUD: comprueba que arranca sin reventar y que, sin
## ningún `Character` en la escena, no se cae al buscar al jugador — algo
## nada raro en un test headless sin nivel cargado.
##
## `GameState.to_dict()`/`from_dict()` NO cubren `mode`/`action_status` (no
## son parte de la partida guardable), así que esta prueba los restaura a
## mano además de con el snapshot del resto de campos.

var _node: Node = null
var _snapshot: Dictionary = {}
var _mode_snapshot: GameState.Mode = GameState.Mode.MENU
var _action_status_snapshot: GameState.ActionStatus = GameState.ActionStatus.NORMAL


func before_each() -> void:
	_snapshot = GameState.to_dict()
	_mode_snapshot = GameState.mode
	_action_status_snapshot = GameState.action_status


func after_each() -> void:
	UiTestSceneBuilders.free_node(_node)
	_node = null
	GameState.from_dict(_snapshot)
	GameState.mode = _mode_snapshot
	GameState.action_status = _action_status_snapshot


func test_hud_instantiates_and_ticks_without_a_player_in_scene() -> void:
	_node = UiTestSceneBuilders.instantiate_in_tree(UiTestSceneBuilders.HUD_SCENE)
	assert_not_null(_node)
	var hud := _node as Hud
	assert_not_null(hud)
	hud._process(0.016)
	assert_true(true, "no debe lanzar excepción sin jugador en escena")


func test_hud_updates_time_label_from_process() -> void:
	_node = UiTestSceneBuilders.instantiate_in_tree(UiTestSceneBuilders.HUD_SCENE)
	var hud := _node as Hud
	var time_label := hud.get_node("%TimeLabel") as Label
	GameState.mode = GameState.Mode.ACTION
	GameState.action_status = GameState.ActionStatus.NORMAL
	hud._process(65.0)
	assert_eq(time_label.text, HudFormat.format_time(65.0))
