class_name TitleScreen
extends Control
## Menú principal (GDD §10 / `legacy-gameplay.md` §9.1, `m_inicio`).
## Solo navegación y una lectura (`SaveSystem.has_save()` para habilitar
## "Continuar"): ninguna decisión de juego se toma aquí.

@onready var _new_game_button: Button = %NewGameButton
@onready var _continue_button: Button = %ContinueButton
@onready var _options_button: Button = %OptionsButton
@onready var _credits_button: Button = %CreditsButton
@onready var _quit_button: Button = %QuitButton


func _ready() -> void:
	Localization.ensure_loaded()
	AutoLocalize.apply(self)
	_continue_button.disabled = not SaveSystem.has_save()
	var intents := UIIntents.get_singleton()
	_new_game_button.pressed.connect(func() -> void: intents.navigate_to_class_select_requested.emit())
	_continue_button.pressed.connect(func() -> void: intents.run_continue_requested.emit())
	_options_button.pressed.connect(func() -> void: intents.navigate_to_options_requested.emit())
	_credits_button.pressed.connect(func() -> void: intents.navigate_to_credits_requested.emit())
	_quit_button.pressed.connect(func() -> void: intents.quit_requested.emit())
	_new_game_button.grab_focus()
