class_name Hud
extends Control
## HUD de partida (GDD §10 / `legacy-gameplay.md` §9.3): vida, munición,
## moral/escuadra, puntuación, tiempo, brújula de planta e indicador de
## dirección del daño.
##
## Solo lee: se engancha a las señales de `Character` (vida/munición) y de
## `EventBus` (daño, para el indicador direccional) y sondea `GameState`
## para puntuación y modo. Nunca escribe en ninguno de los dos.

const DAMAGE_FLASH_DURATION_S: float = 1.2

@onready var _health_bar: ProgressBar = %HealthBar
@onready var _health_label: Label = %HealthLabel
@onready var _ammo_label: Label = %AmmoLabel
@onready var _score_label: Label = %ScoreLabel
@onready var _time_label: Label = %TimeLabel
@onready var _compass_label: Label = %CompassLabel
@onready var _squad_box: HBoxContainer = %SquadBox
@onready var _damage_indicator: Control = %DamageIndicator

var _player: Character = null
var _elapsed_s: float = 0.0
var _damage_flash_timer: float = 0.0
var _damage_angle_deg: float = 0.0


func _ready() -> void:
	Localization.ensure_loaded()
	AutoLocalize.apply(self)
	EventBus.character_damaged.connect(_on_character_damaged)
	_damage_indicator.visible = false
	_damage_indicator.draw.connect(_draw_damage_indicator)
	_find_player()
	set_process(true)


func _process(delta: float) -> void:
	if _player == null or not is_instance_valid(_player):
		_find_player()
	if GameState.mode == GameState.Mode.ACTION and GameState.action_status == GameState.ActionStatus.NORMAL:
		_elapsed_s += delta
	_time_label.text = HudFormat.format_time(_elapsed_s)
	_score_label.text = Localization.t(&"HUD_SCORE_FMT") % GameState.score
	_update_compass()
	_update_squad_panel()
	if _damage_flash_timer > 0.0:
		_damage_flash_timer = maxf(0.0, _damage_flash_timer - delta)
		_damage_indicator.visible = _damage_flash_timer > 0.0
		_damage_indicator.queue_redraw()


func _find_player() -> void:
	for node: Node in get_tree().get_nodes_in_group(&"characters"):
		var character := node as Character
		if character != null and character.team == Character.Team.PLAYER:
			_bind_player(character)
			return


func _bind_player(character: Character) -> void:
	if _player == character:
		return
	if _player != null and is_instance_valid(_player):
		if _player.health_changed.is_connected(_on_health_changed):
			_player.health_changed.disconnect(_on_health_changed)
		if _player.ammo_changed.is_connected(_on_ammo_changed):
			_player.ammo_changed.disconnect(_on_ammo_changed)
	_player = character
	character.health_changed.connect(_on_health_changed)
	character.ammo_changed.connect(_on_ammo_changed)
	var max_health := character.stats.max_health if character.stats != null else character.health
	var max_ammo := character.stats.max_ammo if character.stats != null else character.ammo
	_on_health_changed(character.health, max_health)
	_on_ammo_changed(character.ammo, max_ammo)


func _on_health_changed(current: float, maximum: float) -> void:
	_health_label.text = Localization.t(&"HUD_HEALTH_FMT") % [int(current), int(maximum)]
	_health_bar.max_value = maxf(maximum, 1.0)
	_health_bar.value = current


func _on_ammo_changed(current: int, maximum: int) -> void:
	_ammo_label.text = Localization.t(&"HUD_AMMO_FMT") % [current, maximum]


## Solo reacciona si el daño es al jugador: no es la escuadra al completo la
## que necesita saber de dónde viene un disparo a un compañero.
func _on_character_damaged(
	character_id: int, _amount: float, from_position: Vector3, _attacker_id: int, _attacker_team: int
) -> void:
	if _player == null or character_id != _player.get_instance_id():
		return
	_damage_angle_deg = DamageIndicatorMath.screen_angle_deg(
		_player.global_position, -_player.global_transform.basis.z, from_position)
	_damage_flash_timer = DAMAGE_FLASH_DURATION_S
	_damage_indicator.visible = true
	_damage_indicator.queue_redraw()


func _update_compass() -> void:
	var forward := Vector3.FORWARD
	if _player != null and is_instance_valid(_player):
		forward = -_player.global_transform.basis.z
	var heading := HudFormat.heading_deg_from_forward(forward)
	_compass_label.text = Localization.t(HudFormat.cardinal_key_for_heading(heading))


func _update_squad_panel() -> void:
	var companions: Array[Character] = []
	for node: Node in get_tree().get_nodes_in_group(&"characters"):
		var character := node as Character
		if character != null and character.team == Character.Team.COMPANION:
			companions.append(character)
	while _squad_box.get_child_count() < companions.size():
		_squad_box.add_child(_make_squad_icon())
	while _squad_box.get_child_count() > companions.size():
		var extra := _squad_box.get_child(_squad_box.get_child_count() - 1)
		_squad_box.remove_child(extra)
		extra.queue_free()
	for i: int in companions.size():
		_apply_squad_icon(_squad_box.get_child(i) as Label, companions[i])


func _make_squad_icon() -> Label:
	var label := Label.new()
	label.custom_minimum_size = Vector2(28.0, 28.0)
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	return label


func _apply_squad_icon(label: Label, character: Character) -> void:
	var stats := Balance.character(character.archetype)
	var initial := String(character.archetype).left(1).to_upper()
	label.text = initial
	if not character.alive:
		label.modulate = Color(0.4, 0.4, 0.4)
	elif stats != null and character.health <= stats.max_health * 0.3:
		label.modulate = Color(1.0, 0.4, 0.3)
	else:
		label.modulate = Color(0.5, 1.0, 0.6)


func _draw_damage_indicator() -> void:
	if not _damage_indicator.visible:
		return
	var alpha := clampf(_damage_flash_timer / DAMAGE_FLASH_DURATION_S, 0.0, 1.0)
	var size := _damage_indicator.size
	var center := size * 0.5
	var radius := minf(size.x, size.y) * 0.5
	var angle := deg_to_rad(_damage_angle_deg) - PI * 0.5
	var tip := center + Vector2(cos(angle), sin(angle)) * radius
	var left := center + Vector2(cos(angle + 2.6), sin(angle + 2.6)) * radius * 0.4
	var right := center + Vector2(cos(angle - 2.6), sin(angle - 2.6)) * radius * 0.4
	_damage_indicator.draw_colored_polygon(
		PackedVector2Array([tip, left, right]), Color(1.0, 0.15, 0.1, alpha))
