class_name VictoryScreen
extends Control
## Victoria final (`legacy-gameplay.md` §9.1, `m_theend`: "¡ENHORABUENA!"),
## tras limpiar la azotea (`GameState.is_on_rooftop()`). Distinta de "Fin de
## planta": esta es el final de la partida, no el paso a la siguiente.

@onready var _credits_button: Button = %CreditsButton
@onready var _menu_button: Button = %MenuButton


func _ready() -> void:
	Localization.ensure_loaded()
	AutoLocalize.apply(self)
	UiStyle.apply_snapshot(self)
	var intents := UIIntents.get_singleton()
	_credits_button.pressed.connect(func() -> void: intents.navigate_to_credits_requested.emit())
	_menu_button.pressed.connect(func() -> void: intents.return_to_menu_requested.emit())
	UiStyle.style_primary_button(_credits_button)
	UiMotion.wire_button_feedback(_credits_button)
	UiMotion.wire_button_feedback(_menu_button)


func focus_default() -> void:
	_credits_button.grab_focus()
