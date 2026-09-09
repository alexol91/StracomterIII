extends TestCase
## `UiRoot._refresh()` corre desde `_process`, así que TODO lo que llame se
## llama sesenta veces por segundo. Esta prueba existe porque eso hacía el
## juego injugable de una forma que ninguna otra prueba veía.
##
## El síntoma desde el sofá: «elijo personaje y no me deja empezar partida».
## La pantalla de Estrategia se veía perfecta y era INERTE — `refresh()`
## reconstruía las seis tarjetas de zona (`queue_free()` + `Button.new()`) y
## ponía `_selected_zone = 0` en cada frame. No hay clic humano que sobreviva a
## que el botón se libere entre el botón abajo y el botón arriba.
##
## Ninguna prueba lo cogía porque todas emiten `toggled` a mano sobre el botón
## —un doble más amable que la realidad: no pasa por el reparto de input— y
## ninguna simulaba DOS frames seguidos. Aquí se simulan dos.

const MAIN_SCENE: String = "res://scenes/main.tscn"

var _main: Node = null
var _mode_before: GameState.Mode = GameState.Mode.MENU


func before_each() -> void:
	_mode_before = GameState.mode


func after_each() -> void:
	GameState.set_mode(_mode_before)
	if _main != null and is_instance_valid(_main):
		if _main.get_parent() != null:
			_main.get_parent().remove_child(_main)
		_main.free()
	_main = null


## Hijos que no están esperando a que los liberen.
func _live_children(node: Node) -> Array[Node]:
	var out: Array[Node] = []
	for child: Node in node.get_children():
		if not child.is_queued_for_deletion():
			out.append(child)
	return out


func _ui_root() -> Node:
	var packed := load(MAIN_SCENE) as PackedScene
	_main = packed.instantiate()
	var tree := Engine.get_main_loop() as SceneTree
	tree.root.add_child(_main)
	return _main.get_node("%UiRoot")


func test_the_strategy_screen_is_not_rebuilt_on_every_frame() -> void:
	var ui := _ui_root()
	GameState.set_mode(GameState.Mode.STRATEGY)
	ui.call("_refresh")
	var grid := ui.get_node("%Strategy/%ZoneGrid") as GridContainer
	# Vivas, no todas: `_build_zone_grid` libera las anteriores con
	# `queue_free()`, y eso no se hace efectivo hasta el final del frame. El
	# runner es síncrono, así que las difuntas siguen colgando del árbol.
	var before := _live_children(grid)
	assert_eq(before.size(), GameState.ZONES_PER_FLOOR, "seis zonas")
	var id_before := before[0].get_instance_id() if not before.is_empty() else 0

	# Segundo frame en la misma pantalla.
	ui.call("_refresh")
	var after := _live_children(grid)
	assert_eq(after.size(), GameState.ZONES_PER_FLOOR, "siguen siendo seis")
	assert_eq(after[0].get_instance_id() if not after.is_empty() else 0, id_before,
		"la tarjeta tiene que ser LA MISMA: si se reconstruye, no se puede pulsar")


func test_a_chosen_zone_survives_the_next_frame() -> void:
	var ui := _ui_root()
	GameState.set_mode(GameState.Mode.STRATEGY)
	ui.call("_refresh")
	var screen := ui.get_node("%Strategy") as StrategyScreen
	var grid := ui.get_node("%Strategy/%ZoneGrid") as GridContainer
	(grid.get_child(2) as Button).toggled.emit(true)
	assert_eq(screen.selected_zone(), 3, "se ha elegido la zona 3")

	ui.call("_refresh")
	assert_eq(screen.selected_zone(), 3,
		"y sigue elegida en el frame siguiente: si no, el botón de entrar nunca se activa")


func test_the_screen_is_rebuilt_when_you_come_back_to_it() -> void:
	# Lo otro que no puede romperse: al volver de una planta, la pantalla tiene
	# que reflejar la planta NUEVA, no la anterior.
	var ui := _ui_root()
	GameState.set_mode(GameState.Mode.STRATEGY)
	ui.call("_refresh")
	var screen := ui.get_node("%Strategy") as StrategyScreen
	var grid := ui.get_node("%Strategy/%ZoneGrid") as GridContainer
	(grid.get_child(1) as Button).toggled.emit(true)
	assert_eq(screen.selected_zone(), 2)

	GameState.set_mode(GameState.Mode.ACTION)
	ui.call("_refresh")
	GameState.set_mode(GameState.Mode.STRATEGY)
	ui.call("_refresh")
	assert_eq(screen.selected_zone(), 0,
		"al volver a entrar, la elección anterior no se hereda")


func test_the_focus_is_not_stolen_back_on_every_frame() -> void:
	# Mismo fallo, otra pantalla: `focus_default()` cada frame deja el menú
	# imposible de recorrer — pulsas Tab y el foco vuelve al primer botón antes
	# de que sueltes la tecla. Con mando es peor: no hay forma de llegar a
	# «Menú principal».
	var ui := _ui_root()
	GameState.set_mode(GameState.Mode.ACTION)
	GameState.action_status = GameState.ActionStatus.GAME_OVER
	ui.call("_refresh")
	var over := ui.get_node("%GameOver") as Control
	var buttons: Array[Button] = []
	for node: Node in over.find_children("*", "Button", true, false):
		buttons.append(node as Button)
	assert_gt(buttons.size(), 1, "la pantalla de Game Over tiene dos botones")

	buttons[1].grab_focus()
	var chosen := buttons[1].has_focus()
	ui.call("_refresh")
	assert_eq(buttons[1].has_focus(), chosen,
		"el foco que mueve el jugador no se le puede quitar en el frame siguiente")
	GameState.action_status = GameState.ActionStatus.NORMAL
