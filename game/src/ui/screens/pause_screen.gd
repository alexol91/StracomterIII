class_name PauseScreen
extends Control
## Pausa (`legacy-gameplay.md` §9.1, `m_pause`). Puramente navegación:
## el congelado real del árbol (`get_tree().paused`) lo decide `UiRoot`.

@onready var _resume_button: Button = %ResumeButton
@onready var _options_button: Button = %OptionsButton
@onready var _restart_button: Button = %RestartButton
@onready var _menu_button: Button = %MenuButton
@onready var _quit_button: Button = %QuitButton


func _ready() -> void:
	Localization.ensure_loaded()
	AutoLocalize.apply(self)
	UiStyle.apply_snapshot(self)
	var intents := UIIntents.get_singleton()
	_resume_button.pressed.connect(func() -> void: intents.pause_toggle_requested.emit())
	_options_button.pressed.connect(func() -> void: intents.navigate_to_options_requested.emit())
	_restart_button.pressed.connect(func() -> void: intents.restart_requested.emit())
	_menu_button.pressed.connect(func() -> void: intents.return_to_menu_requested.emit())
	_quit_button.pressed.connect(func() -> void: intents.quit_requested.emit())
	UiStyle.style_primary_button(_resume_button)
	for button: Button in [_resume_button, _options_button, _restart_button, _menu_button, _quit_button]:
		UiMotion.wire_button_feedback(button)


func focus_default() -> void:
	_resume_button.grab_focus()
