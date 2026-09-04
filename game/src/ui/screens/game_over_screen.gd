class_name GameOverScreen
extends Control
## Game Over (`legacy-gameplay.md` §9.1, `m_gameover`: "¡Segmentation Fault!").
## Guiño intencionado al original conservado como clave de traducción, no
## como literal — así sigue pudiendo desactivarse por idioma/tono sin tocar
## código.

@onready var _restart_button: Button = %RestartButton
@onready var _menu_button: Button = %MenuButton


func _ready() -> void:
	Localization.ensure_loaded()
	AutoLocalize.apply(self)
	var intents := UIIntents.get_singleton()
	_restart_button.pressed.connect(func() -> void: intents.restart_requested.emit())
	_menu_button.pressed.connect(func() -> void: intents.return_to_menu_requested.emit())


func focus_default() -> void:
	_restart_button.grab_focus()
