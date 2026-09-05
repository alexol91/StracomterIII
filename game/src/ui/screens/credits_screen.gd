class_name CreditsScreen
extends Control
## Créditos (`legacy-gameplay.md` §9.1, `m_credits`). Los cuatro nombres del
## equipo original de 2012 son un requisito explícito del GDD/atribución del
## proyecto — se muestran vía claves de traducción como el resto de la UI,
## no como caso especial.

@onready var _back_button: Button = %BackButton


func _ready() -> void:
	Localization.ensure_loaded()
	AutoLocalize.apply(self)
	UiStyle.apply_snapshot(self)
	_back_button.pressed.connect(
		func() -> void: UIIntents.get_singleton().navigate_back_requested.emit())
	UiMotion.wire_button_feedback(_back_button)


func focus_default() -> void:
	_back_button.grab_focus()
