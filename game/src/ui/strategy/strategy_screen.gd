class_name StrategyScreen
extends Control
## Pantalla de Estrategia (GDD §6) — la entrega más importante de este agente.
##
## Muestra el plano de la planta siguiente con sus 6 zonas (recompensa +
## lectura de amenaza), el estado de la escuadra y el gasto de experiencia.
## Todo el cálculo vive en clases puras (`StrategyViewModel`,
## `SquadReassignment`, `ZoneThreatReading`): este script solo las llama,
## construye controles y traduce. No decide nada de reglas.
##
## Regla dura: esta pantalla SOLO LEE `Balance`/`GameState`. Al confirmar,
## emite `UIIntents.strategy_confirmed` — nunca escribe en `GameState`.

@onready var _floor_label: Label = %FloorLabel
@onready var _floor_theme_label: Label = %FloorThemeLabel
@onready var _xp_label: Label = %XpLabel
@onready var _zone_grid: GridContainer = %ZoneGrid
@onready var _squad_list: VBoxContainer = %SquadList
@onready var _cost_label: Label = %CostLabel
@onready var _confirm_button: Button = %ConfirmButton
@onready var _back_button: Button = %BackButton

var _zone_button_group: ButtonGroup = ButtonGroup.new()
var _selected_zone: int = 0
var _squad_included: Dictionary = {}
## `Dictionary[StringName, GameState.CharacterSnapshot]` congelado al abrir la
## pantalla: la escuadra no debe cambiar bajo los pies del jugador mientras
## decide, aunque algo más la actualizara en segundo plano.
var _squad_snapshot: Dictionary = {}


func _ready() -> void:
	Localization.ensure_loaded()
	AutoLocalize.apply(self)
	UiStyle.apply_snapshot(self)
	_back_button.pressed.connect(_on_back_pressed)
	_confirm_button.pressed.connect(_on_confirm_pressed)
	UiStyle.style_primary_button(_confirm_button)
	UiMotion.wire_button_feedback(_back_button)
	UiMotion.wire_button_feedback(_confirm_button)
	refresh()


## Reconstruye toda la pantalla desde `Balance`/`GameState`. Público para que
## las pruebas puedan forzar un refresco tras cambiar la planta simulada.
func refresh() -> void:
	_squad_snapshot = GameState.squad.duplicate()
	_selected_zone = 0
	_squad_included = SquadReassignment.default_included(_squad_snapshot, GameState.player_archetype)
	var floor_config := Balance.floor_config(GameState.current_floor)
	_floor_label.text = Localization.t(&"STRATEGY_FLOOR_FMT") % GameState.current_floor
	_floor_theme_label.text = Localization.t(floor_config.display_name_key) if floor_config != null else ""
	_build_zone_grid(floor_config)
	_build_squad_list()
	_update_footer()


func _build_zone_grid(floor_config: FloorConfig) -> void:
	for child: Node in _zone_grid.get_children():
		child.queue_free()
	for entry: Dictionary in StrategyViewModel.zone_entries(floor_config):
		_zone_grid.add_child(_make_zone_button(entry))


## Lectura de amenaza -> acento de color (dirección de arte: el naranja/rojo
## se reserva a avisos de peligro, nunca decorativo). El jefe posible es la
## lectura más grave, por delante incluso del tamaño de mapa.
func _accent_for_entry(entry: Dictionary) -> Color:
	if bool(entry.get("boss_possible", false)):
		return Palette.THREAT_RED
	match int(entry.get("map_scale", ZoneThreatReading.MapScale.MEDIUM)):
		ZoneThreatReading.MapScale.LARGE:
			return Palette.THREAT_ORANGE
		ZoneThreatReading.MapScale.SMALL:
			return Palette.TOWER_BLUE_DIM
		_:
			return Palette.TOWER_BLUE


func _make_zone_button(entry: Dictionary) -> Button:
	var button := Button.new()
	button.toggle_mode = true
	button.button_group = _zone_button_group
	button.focus_mode = Control.FOCUS_ALL
	button.custom_minimum_size = Vector2(240.0, 168.0)
	button.text = ""

	var accent := _accent_for_entry(entry)
	button.add_theme_stylebox_override("normal", UiStyle.zone_card_stylebox(accent, false))
	button.add_theme_stylebox_override("hover", UiStyle.zone_card_stylebox(accent, false))
	button.add_theme_stylebox_override("pressed", UiStyle.zone_card_stylebox(accent, true))
	button.add_theme_stylebox_override("focus", UiStyle.zone_card_stylebox(accent, true))

	# Los hijos de un `Button` no pasan por ningún `Container`: se posicionan
	# por sus propios anchors/offsets. `PRESET_FULL_RECT` los hace ocupar todo
	# el botón, así que el relleno se añade a mano con offsets para no pisar
	# el borde de color del `StyleBoxFlat` de arriba.
	var card := VBoxContainer.new()
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card.set_anchors_preset(Control.PRESET_FULL_RECT)
	card.offset_left = 14.0
	card.offset_top = 12.0
	card.offset_right = -14.0
	card.offset_bottom = -12.0
	card.add_theme_constant_override("separation", 4)
	button.add_child(card)

	var zone_index: int = int(entry.get("zone", 0))
	var zone_label := Label.new()
	zone_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	zone_label.theme_type_variation = &"SectionLabel"
	zone_label.text = Localization.t(&"STRATEGY_ZONE_FMT") % zone_index
	card.add_child(zone_label)

	var reward_label := Label.new()
	reward_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	reward_label.add_theme_color_override("font_color", Palette.TOWER_BLUE_BRIGHT)
	reward_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var reward_format_key: StringName = entry.get("reward_format_key", &"")
	var reward_amount: int = int(entry.get("reward_amount", 0.0))
	if reward_format_key == &"STRATEGY_REWARD_WEAPON_FMT":
		# Sin cantidad que formatear: sería un arma, no munición/vida.
		reward_label.text = Localization.t(reward_format_key)
	elif not String(reward_format_key).is_empty():
		reward_label.text = Localization.t(reward_format_key) % reward_amount
	card.add_child(reward_label)

	var scale_label := Label.new()
	scale_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	scale_label.theme_type_variation = &"SubtitleLabel"
	scale_label.text = Localization.t(entry.get("map_scale_key", &"") as StringName)
	card.add_child(scale_label)

	var threat_label := Label.new()
	threat_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	threat_label.theme_type_variation = &"SubtitleLabel"
	threat_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	threat_label.text = Localization.t(entry.get("threat_key", &"") as StringName)
	card.add_child(threat_label)

	if bool(entry.get("boss_possible", false)):
		var boss_label := Label.new()
		boss_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
		boss_label.theme_type_variation = &"ThreatLabel"
		boss_label.text = Localization.t(&"STRATEGY_BOSS_WARNING")
		card.add_child(boss_label)

	button.toggled.connect(func(pressed: bool) -> void:
		if pressed:
			_selected_zone = zone_index
			_update_footer())
	UiMotion.wire_button_feedback(button)
	return button


func _build_squad_list() -> void:
	for child: Node in _squad_list.get_children():
		child.queue_free()
	for entry: Dictionary in StrategyViewModel.squad_entries(GameState.player_archetype):
		_squad_list.add_child(_make_squad_row(entry))


func _make_squad_row(entry: Dictionary) -> Control:
	var row := HBoxContainer.new()
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_theme_constant_override("separation", 10)

	var alive: bool = bool(entry.get("alive", false))
	var max_health := maxf(float(entry.get("max_health", 0.0)), 1.0)
	var fraction := float(entry.get("health", 0.0)) / max_health if alive else 0.0

	# Chip de estado: un punto de color en vez de solo texto, con el mismo
	# criterio de color que la barra de vida del HUD (`Palette.health_color`).
	var chip := PanelContainer.new()
	chip.custom_minimum_size = Vector2(14.0, 14.0)
	var chip_box := StyleBoxFlat.new()
	chip_box.bg_color = Palette.health_color(fraction) if alive else Palette.NEUTRAL_500
	chip_box.set_corner_radius_all(7)
	chip.add_theme_stylebox_override("panel", chip_box)
	row.add_child(chip)

	var name_label := Label.new()
	name_label.text = Localization.t(StringName(entry.get("display_name_key", "")))
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if not alive:
		name_label.add_theme_color_override("font_color", Palette.TEXT_DISABLED)
	row.add_child(name_label)

	var status_label := Label.new()
	status_label.theme_type_variation = &"SubtitleLabel"
	if alive:
		status_label.text = Localization.t(&"STRATEGY_SQUAD_ALIVE_FMT") % [
			int(entry.get("health", 0.0)), int(entry.get("max_health", 0.0)),
		]
	else:
		status_label.text = Localization.t(&"STRATEGY_SQUAD_KIA")
	row.add_child(status_label)

	var archetype: StringName = entry.get("archetype", &"")
	var toggle := CheckBox.new()
	toggle.focus_mode = Control.FOCUS_ALL
	toggle.text = Localization.t(&"STRATEGY_SQUAD_REVIVE" if not alive else &"STRATEGY_SQUAD_INCLUDE")
	toggle.button_pressed = bool(_squad_included.get(archetype, false))
	toggle.toggled.connect(func(pressed: bool) -> void:
		_squad_included[archetype] = pressed
		_update_footer())
	row.add_child(toggle)
	UiMotion.wire_button_feedback(toggle)
	return row


func _update_footer() -> void:
	var cost := SquadReassignment.total_xp_cost(_squad_snapshot, _squad_included)
	var affordable := cost <= GameState.experience
	_xp_label.text = Localization.t(&"STRATEGY_XP_FMT") % GameState.experience
	_cost_label.text = Localization.t(&"STRATEGY_COST_FMT") % cost
	_cost_label.add_theme_color_override(
		"font_color", Palette.TEXT_PRIMARY if affordable else Palette.THREAT_ORANGE)
	_confirm_button.disabled = _selected_zone <= 0 or not affordable


func _on_confirm_pressed() -> void:
	if _selected_zone <= 0:
		return
	var cost := SquadReassignment.total_xp_cost(_squad_snapshot, _squad_included)
	if cost > GameState.experience:
		return
	UIIntents.get_singleton().strategy_confirmed.emit(
		_selected_zone, cost, _squad_included.duplicate())


func _on_back_pressed() -> void:
	UIIntents.get_singleton().return_to_menu_requested.emit()


## --- Acceso de solo lectura para pruebas --------------------------------

func selected_zone() -> int:
	return _selected_zone


func squad_included() -> Dictionary:
	return _squad_included.duplicate()
