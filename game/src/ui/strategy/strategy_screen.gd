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
	_back_button.pressed.connect(_on_back_pressed)
	_confirm_button.pressed.connect(_on_confirm_pressed)
	refresh()


## Reconstruye toda la pantalla desde `Balance`/`GameState`. Público para que
## las pruebas puedan forzar un refresco tras cambiar la planta simulada.
func refresh() -> void:
	_squad_snapshot = GameState.squad.duplicate()
	_selected_zone = 0
	_squad_included = SquadReassignment.default_included(_squad_snapshot, GameState.player_archetype)
	_floor_label.text = Localization.t(&"STRATEGY_FLOOR_FMT") % GameState.current_floor
	_build_zone_grid()
	_build_squad_list()
	_update_footer()


func _build_zone_grid() -> void:
	for child: Node in _zone_grid.get_children():
		child.queue_free()
	var floor_config := Balance.floor_config(GameState.current_floor)
	for entry: Dictionary in StrategyViewModel.zone_entries(floor_config):
		_zone_grid.add_child(_make_zone_button(entry))


func _make_zone_button(entry: Dictionary) -> Button:
	var button := Button.new()
	button.toggle_mode = true
	button.button_group = _zone_button_group
	button.focus_mode = Control.FOCUS_ALL
	button.custom_minimum_size = Vector2(220.0, 120.0)
	button.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	button.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS

	var reward_amount: int = int(entry.get("reward_amount", 0.0))
	var reward_line := ""
	var reward_format_key: StringName = entry.get("reward_format_key", &"")
	if reward_format_key == &"STRATEGY_REWARD_WEAPON_FMT":
		# Sin cantidad que formatear: sería un arma, no munición/vida.
		reward_line = Localization.t(reward_format_key)
	elif not String(reward_format_key).is_empty():
		reward_line = Localization.t(reward_format_key) % reward_amount

	var lines: Array[String] = [
		Localization.t(&"STRATEGY_ZONE_FMT") % int(entry.get("zone", 0)),
		reward_line,
		Localization.t(entry.get("map_scale_key", &"") as StringName),
		Localization.t(entry.get("threat_key", &"") as StringName),
	]
	if bool(entry.get("boss_possible", false)):
		lines.append(Localization.t(&"STRATEGY_BOSS_WARNING"))
	button.text = "\n".join(lines)

	var zone_index: int = int(entry.get("zone", 0))
	button.toggled.connect(func(pressed: bool) -> void:
		if pressed:
			_selected_zone = zone_index
			_update_footer())
	return button


func _build_squad_list() -> void:
	for child: Node in _squad_list.get_children():
		child.queue_free()
	for entry: Dictionary in StrategyViewModel.squad_entries(GameState.player_archetype):
		_squad_list.add_child(_make_squad_row(entry))


func _make_squad_row(entry: Dictionary) -> Control:
	var row := HBoxContainer.new()
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL

	var name_label := Label.new()
	name_label.text = Localization.t(StringName(entry.get("display_name_key", "")))
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(name_label)

	var status_label := Label.new()
	var alive: bool = bool(entry.get("alive", false))
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
	return row


func _update_footer() -> void:
	var cost := SquadReassignment.total_xp_cost(_squad_snapshot, _squad_included)
	var affordable := cost <= GameState.experience
	_xp_label.text = Localization.t(&"STRATEGY_XP_FMT") % GameState.experience
	_cost_label.text = Localization.t(&"STRATEGY_COST_FMT") % cost
	_cost_label.modulate = Color.WHITE if affordable else Color(1.0, 0.45, 0.45)
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
