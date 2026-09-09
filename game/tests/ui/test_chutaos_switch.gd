extends TestCase
## El modo Chutaos se puede cambiar de dos formas: en Ajustes (y se recuerda)
## y con la consola a mitad de partida (y no se recuerda, que es lo que se
## espera de un truco).

const MAIN_SCENE: String = "res://scenes/main.tscn"

var _main: Node = null
var _style_before: bool = false


func before_each() -> void:
	_style_before = PresentationStyle.chutaos_mode


func after_each() -> void:
	PresentationStyle.chutaos_mode = _style_before
	if _main != null and is_instance_valid(_main):
		if _main.get_parent() != null:
			_main.get_parent().remove_child(_main)
		_main.free()
	_main = null


func test_the_setting_is_saved_and_restored() -> void:
	# Es una preferencia, no un truco: tiene que sobrevivir a cerrar el juego.
	var settings := SettingsService.get_singleton()
	var before := settings.chutaos_mode
	settings.chutaos_mode = true
	var saved := settings.to_dict()
	settings.chutaos_mode = false
	settings.call("_from_dict", saved)
	assert_true(settings.chutaos_mode, "el ajuste tiene que persistir")
	settings.chutaos_mode = before


func test_applying_the_settings_moves_the_presentation_style() -> void:
	var settings := SettingsService.get_singleton()
	var before := settings.chutaos_mode
	PresentationStyle.chutaos_mode = false
	settings.chutaos_mode = true
	settings.apply_global()
	assert_true(PresentationStyle.chutaos_mode,
		"aplicar ajustes tiene que llevar el estilo al juego, no solo guardarlo")
	settings.chutaos_mode = before


func test_the_console_cheat_still_works_mid_run() -> void:
	# La otra mitad de lo que se pidió: cambiarlo sin pasar por menús.
	PresentationStyle.chutaos_mode = false
	var answer := Cheats.execute(":chutaos on")
	assert_true(PresentationStyle.chutaos_mode, "«:chutaos on» tiene que encenderlo")
	assert_false(answer.is_empty(), "y contestar algo: un truco mudo parece roto")
	Cheats.execute(":chutaos off")
	assert_false(PresentationStyle.chutaos_mode, "y apagarlo")


func test_the_pause_screen_offers_a_way_into_the_console() -> void:
	# La tecla de la consola es la tilde grave, que en un teclado español está
	# donde nadie la busca. Desde la pausa tiene que haber un botón.
	var packed := load("res://scenes/ui/pause_screen.tscn") as PackedScene
	assert_not_null(packed)
	var screen := packed.instantiate()
	var tree := Engine.get_main_loop() as SceneTree
	tree.root.add_child(screen)
	var button := screen.get_node_or_null("%ConsoleButton") as Button
	assert_not_null(button, "falta el botón de consola en la pausa")
	tree.root.remove_child(screen)
	screen.free()


func test_the_console_button_opens_the_console_and_unpauses() -> void:
	# Con la pausa Y la consola encima habría que cerrar dos ventanas para
	# volver a jugar. La consola ya congela el juego por su cuenta.
	var packed := load(MAIN_SCENE) as PackedScene
	_main = packed.instantiate()
	var tree := Engine.get_main_loop() as SceneTree
	tree.root.add_child(_main)
	var ui := _main.get_node("%UiRoot")
	var console := ui.get_node("%Console") as ConsolePanel
	assert_false(console.is_open(), "de partida está cerrada")

	tree.paused = true
	UIIntents.get_singleton().console_open_requested.emit()
	assert_true(console.is_open(), "el botón tiene que abrirla")
	assert_false(tree.paused, "y quitar la pausa, o hay que cerrar dos cosas")
	console.set_open(false)
	tree.paused = false
	GameState.action_status = GameState.ActionStatus.NORMAL
