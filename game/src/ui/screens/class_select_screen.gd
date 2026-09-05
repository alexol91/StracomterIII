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
	UiStyle.apply_snapshot(self)
	var intents := UIIntents.get_singleton()
	_back_button.pressed.connect(func() -> void: intents.navigate_back_requested.emit())
	_confirm_button.pressed.connect(_on_confirm_pressed)
	UiStyle.style_primary_button(_confirm_button)
	UiMotion.wire_button_feedback(_back_button)
	UiMotion.wire_button_feedback(_confirm_button)
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
	button.custom_minimum_size = Vector2(190.0, 140.0)
	button.text = ""

	var accent := Palette.ELITE_BLUE
	button.add_theme_stylebox_override("normal", UiStyle.zone_card_stylebox(Palette.ELITE_BLUE_DIM, false))
	button.add_theme_stylebox_override("hover", UiStyle.zone_card_stylebox(accent, false))
	button.add_theme_stylebox_override("pressed", UiStyle.zone_card_stylebox(accent, true))
	button.add_theme_stylebox_override("focus", UiStyle.zone_card_stylebox(accent, true))

	var card := VBoxContainer.new()
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card.alignment = BoxContainer.ALIGNMENT_CENTER
	card.set_anchors_preset(Control.PRESET_FULL_RECT)
	card.offset_left = 12.0
	card.offset_top = 10.0
	card.offset_right = -12.0
	card.offset_bottom = -10.0
	card.add_theme_constant_override("separation", 8)
	button.add_child(card)

	# Emblema: iniciales sobre un círculo del azul Elite. Sin arte de
	# personaje disponible en este ámbito (`ui-ux` no genera assets 3D), el
	## mismo lenguaje del icono de escuadra del HUD (`hud.gd::_apply_squad_icon`).
	var emblem := PanelContainer.new()
	emblem.mouse_filter = Control.MOUSE_FILTER_IGNORE
	emblem.custom_minimum_size = Vector2(56.0, 56.0)
	emblem.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	var emblem_box := StyleBoxFlat.new()
	emblem_box.bg_color = Palette.ELITE_BLUE_DIM
	emblem_box.set_corner_radius_all(28)
	emblem.add_theme_stylebox_override("panel", emblem_box)
	var initial_label := Label.new()
	initial_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	initial_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	initial_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	initial_label.theme_type_variation = &"SectionLabel"
	initial_label.text = String(archetype).left(1).to_upper()
	emblem.add_child(initial_label)
	card.add_child(emblem)

	var name_label := Label.new()
	name_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_label.theme_type_variation = &"SectionLabel"
	name_label.text = Localization.t(stats.display_name_key) if stats != null else String(archetype)
	card.add_child(name_label)

	button.toggled.connect(func(pressed: bool) -> void:
		if pressed:
			_select(archetype))
	UiMotion.wire_button_feedback(button)
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
