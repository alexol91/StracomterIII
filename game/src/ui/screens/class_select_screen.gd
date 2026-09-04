class_name ClassSelectScreen
extends Control
## Selección de clase (GDD §3 / `legacy-gameplay.md` §9.1, retratos 11-14).
## Las estadísticas mostradas son las reales de `Balance.character()` — nunca
## un número escrito a mano aquí (ADR-005).

const ARCHETYPES: Array[StringName] = [&"captain", &"technician", &"specialist", &"demolition"]

@onready var _cards_box: HBoxContainer = %CardsBox
@onready var _stats_label: Label = %StatsLabel
@onready var _confirm_button: Button = %ConfirmButton
@onready var _back_button: Button = %BackButton

var _selected: StringName = &""
var _group: ButtonGroup = ButtonGroup.new()


func _ready() -> void:
	Localization.ensure_loaded()
	AutoLocalize.apply(self)
	var intents := UIIntents.get_singleton()
	_back_button.pressed.connect(func() -> void: intents.navigate_back_requested.emit())
	_confirm_button.pressed.connect(_on_confirm_pressed)
	_build_cards()


func _build_cards() -> void:
	for child: Node in _cards_box.get_children():
		child.queue_free()
	for archetype: StringName in ARCHETYPES:
		_cards_box.add_child(_make_card(archetype))
	if not ARCHETYPES.is_empty():
		_select(ARCHETYPES[0])


func _make_card(archetype: StringName) -> Button:
	var stats := Balance.character(archetype)
	var button := Button.new()
	button.toggle_mode = true
	button.button_group = _group
	button.focus_mode = Control.FOCUS_ALL
	button.custom_minimum_size = Vector2(180.0, 80.0)
	button.text = Localization.t(stats.display_name_key) if stats != null else String(archetype)
	button.toggled.connect(func(pressed: bool) -> void:
		if pressed:
			_select(archetype))
	return button


func _select(archetype: StringName) -> void:
	_selected = archetype
	var stats := Balance.character(archetype)
	if stats == null:
		_stats_label.text = ""
		return
	_stats_label.text = Localization.t(&"CLASS_STATS_FMT") % [
		int(stats.max_health), stats.speed_mps(), int(stats.max_ammo),
		stats.shots_per_second(), int(stats.damage), int(stats.ability_cooldown_s),
	]
	UIIntents.get_singleton().class_previewed.emit(archetype)


func _on_confirm_pressed() -> void:
	if _selected == &"":
		return
	UIIntents.get_singleton().run_start_requested.emit(_selected)


func selected_archetype() -> StringName:
	return _selected
