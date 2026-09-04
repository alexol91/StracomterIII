class_name FloorEndScreen
extends Control
## Fin de planta: resumen tras limpiar la zona elegida, antes de volver a
## Estrategia para la siguiente. No existía en el original más que como
## paso mudo de `incrementLevel()`; aquí se hace visible al jugador.
## Se rellena con `show_summary()`; solo lee `GameState`/lo que le pasan.

@onready var _summary_label: Label = %SummaryLabel
@onready var _continue_button: Button = %ContinueButton


func _ready() -> void:
	Localization.ensure_loaded()
	AutoLocalize.apply(self)
	_continue_button.pressed.connect(
		func() -> void: UIIntents.get_singleton().floor_end_acknowledged.emit())


func show_summary(floor_number: int, zone: int, elapsed_s: float) -> void:
	_summary_label.text = Localization.t(&"FLOOR_END_SUMMARY_FMT") % [
		floor_number, zone, HudFormat.format_time(elapsed_s), GameState.score, GameState.experience,
	]


func focus_default() -> void:
	_continue_button.grab_focus()
