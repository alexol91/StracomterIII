class_name OptionsScreen
extends Control
## Opciones y accesibilidad (GDD §10): idioma, audio, subtítulos, escala de
## HUD, modo daltónico, FOV, sensibilidad, sacudida de cámara y remapeo
## completo de teclado+ratón y mando. Todo se guarda en
## `SettingsService`/`user://settings.json` y se aplica en caliente — nunca
## toca `GameState`.

const LOCALES: Array[StringName] = [&"es", &"en"]
const COLORBLIND_MODES: Array[SettingsService.ColorblindMode] = [
	SettingsService.ColorblindMode.NONE,
	SettingsService.ColorblindMode.PROTANOPIA,
	SettingsService.ColorblindMode.DEUTERANOPIA,
	SettingsService.ColorblindMode.TRITANOPIA,
]

@onready var _locale_option: OptionButton = %LocaleOption
@onready var _master_slider: HSlider = %MasterSlider
@onready var _music_slider: HSlider = %MusicSlider
@onready var _sfx_slider: HSlider = %SfxSlider
@onready var _voice_slider: HSlider = %VoiceSlider
@onready var _subtitles_check: CheckBox = %SubtitlesCheck
@onready var _hud_scale_slider: HSlider = %HudScaleSlider
@onready var _colorblind_option: OptionButton = %ColorblindOption
@onready var _fov_slider: HSlider = %FovSlider
@onready var _mouse_sens_slider: HSlider = %MouseSensSlider
@onready var _gamepad_sens_slider: HSlider = %GamepadSensSlider
@onready var _shake_check: CheckBox = %ShakeCheck
@onready var _remap_list: VBoxContainer = %RemapList
@onready var _rebind_hint_label: Label = %RebindHintLabel
@onready var _reset_bindings_button: Button = %ResetBindingsButton
@onready var _back_button: Button = %BackButton

var _settings: SettingsService = null
## Cuando no está vacío, el próximo evento de teclado/ratón/mando capturado
## en `_input` se convierte en el binding de `{action, slot}`.
var _awaiting_rebind: Dictionary = {}


func _ready() -> void:
	Localization.ensure_loaded()
	AutoLocalize.apply(self)
	_settings = SettingsService.get_singleton()
	_populate_locale_option()
	_populate_colorblind_option()
	_load_values_into_controls()
	_build_remap_list()
	_wire_controls()


func _wire_controls() -> void:
	_locale_option.item_selected.connect(_on_locale_selected)
	_master_slider.value_changed.connect(func(v: float) -> void: _settings.master_volume = v)
	_music_slider.value_changed.connect(func(v: float) -> void: _settings.music_volume = v)
	_sfx_slider.value_changed.connect(func(v: float) -> void: _settings.sfx_volume = v)
	_voice_slider.value_changed.connect(func(v: float) -> void: _settings.voice_volume = v)
	_subtitles_check.toggled.connect(func(v: bool) -> void: _settings.subtitles_enabled = v)
	_hud_scale_slider.value_changed.connect(func(v: float) -> void: _settings.hud_scale = v)
	_colorblind_option.item_selected.connect(_on_colorblind_selected)
	_fov_slider.value_changed.connect(func(v: float) -> void: _settings.fov_deg = v)
	_mouse_sens_slider.value_changed.connect(func(v: float) -> void: _settings.mouse_sensitivity = v)
	_gamepad_sens_slider.value_changed.connect(func(v: float) -> void: _settings.gamepad_sensitivity_rad_s = v)
	_shake_check.toggled.connect(func(v: bool) -> void: _settings.camera_shake_enabled = v)
	_reset_bindings_button.pressed.connect(_on_reset_bindings_pressed)
	_back_button.pressed.connect(_on_back_pressed)


func _populate_locale_option() -> void:
	_locale_option.clear()
	for locale: StringName in LOCALES:
		_locale_option.add_item(Localization.t(StringName("OPTIONS_LOCALE_" + String(locale).to_upper())))


func _populate_colorblind_option() -> void:
	_colorblind_option.clear()
	for mode: SettingsService.ColorblindMode in COLORBLIND_MODES:
		_colorblind_option.add_item(Localization.t(_colorblind_key(mode)))


func _colorblind_key(mode: SettingsService.ColorblindMode) -> StringName:
	match mode:
		SettingsService.ColorblindMode.PROTANOPIA:
			return &"OPTIONS_COLORBLIND_PROTANOPIA"
		SettingsService.ColorblindMode.DEUTERANOPIA:
			return &"OPTIONS_COLORBLIND_DEUTERANOPIA"
		SettingsService.ColorblindMode.TRITANOPIA:
			return &"OPTIONS_COLORBLIND_TRITANOPIA"
		_:
			return &"OPTIONS_COLORBLIND_NONE"


func _load_values_into_controls() -> void:
	_locale_option.select(maxi(0, LOCALES.find(_settings.locale)))
	_master_slider.value = _settings.master_volume
	_music_slider.value = _settings.music_volume
	_sfx_slider.value = _settings.sfx_volume
	_voice_slider.value = _settings.voice_volume
	_subtitles_check.button_pressed = _settings.subtitles_enabled
	_hud_scale_slider.min_value = SettingsService.HUD_SCALE_MIN
	_hud_scale_slider.max_value = SettingsService.HUD_SCALE_MAX
	_hud_scale_slider.value = _settings.hud_scale
	_colorblind_option.select(maxi(0, COLORBLIND_MODES.find(_settings.colorblind_mode)))
	_fov_slider.min_value = SettingsService.FOV_MIN_DEG
	_fov_slider.max_value = SettingsService.FOV_MAX_DEG
	_fov_slider.value = _settings.fov_deg
	_mouse_sens_slider.value = _settings.mouse_sensitivity
	_gamepad_sens_slider.value = _settings.gamepad_sensitivity_rad_s
	_shake_check.button_pressed = _settings.camera_shake_enabled


func _on_locale_selected(index: int) -> void:
	_settings.locale = LOCALES[index]
	# El idioma se ve al momento, incluso sin guardar: es lo que se espera
	# de un selector de idioma, no hace falta "Aplicar".
	Localization.set_locale(_settings.locale)
	AutoLocalize.apply(self)
	_populate_locale_option()
	_populate_colorblind_option()
	_locale_option.select(maxi(0, LOCALES.find(_settings.locale)))
	_colorblind_option.select(maxi(0, COLORBLIND_MODES.find(_settings.colorblind_mode)))
	_build_remap_list()


func _on_colorblind_selected(index: int) -> void:
	_settings.colorblind_mode = COLORBLIND_MODES[index]


## --- Remapeo --------------------------------------------------------------

func _build_remap_list() -> void:
	for child: Node in _remap_list.get_children():
		child.queue_free()
	for action: StringName in InputRemapService.MANAGED_ACTIONS:
		_remap_list.add_child(_make_remap_row(action))


func _make_remap_row(action: StringName) -> Control:
	var row := HBoxContainer.new()
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL

	var name_label := Label.new()
	name_label.text = Localization.t(_action_name_key(action))
	name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(name_label)

	row.add_child(_make_rebind_button(action, InputRemapService.Slot.KEYBOARD_MOUSE))
	row.add_child(_make_rebind_button(action, InputRemapService.Slot.GAMEPAD))
	return row


func _make_rebind_button(action: StringName, slot: InputRemapService.Slot) -> Button:
	var button := Button.new()
	button.focus_mode = Control.FOCUS_ALL
	button.custom_minimum_size = Vector2(140.0, 0.0)
	button.text = _binding_label(action, slot)
	button.pressed.connect(func() -> void: _begin_rebind(action, slot, button))
	return button


func _binding_label(action: StringName, slot: InputRemapService.Slot) -> String:
	var event := InputRemapService.get_binding(action, slot)
	return event.as_text() if event != null else Localization.t(&"OPTIONS_BINDING_EMPTY")


func _begin_rebind(action: StringName, slot: InputRemapService.Slot, button: Button) -> void:
	_awaiting_rebind = {"action": action, "slot": slot, "button": button}
	button.text = Localization.t(&"OPTIONS_BINDING_WAITING")
	_rebind_hint_label.visible = true


func _input(event: InputEvent) -> void:
	if _awaiting_rebind.is_empty():
		return
	if not _is_bindable_event(event):
		return
	var action: StringName = _awaiting_rebind["action"]
	var slot: InputRemapService.Slot = _awaiting_rebind["slot"]
	var button: Button = _awaiting_rebind["button"]
	InputRemapService.set_binding(action, slot, event)
	button.text = _binding_label(action, slot)
	_awaiting_rebind.clear()
	_rebind_hint_label.visible = false
	get_viewport().set_input_as_handled()


func _is_bindable_event(event: InputEvent) -> bool:
	if event is InputEventKey:
		return (event as InputEventKey).is_pressed()
	if event is InputEventMouseButton:
		return (event as InputEventMouseButton).is_pressed()
	if event is InputEventJoypadButton:
		return (event as InputEventJoypadButton).is_pressed()
	if event is InputEventJoypadMotion:
		return absf((event as InputEventJoypadMotion).axis_value) > 0.6
	return false


func _action_name_key(action: StringName) -> StringName:
	return StringName("INPUT_ACTION_" + String(action).to_upper())


func _on_reset_bindings_pressed() -> void:
	InputRemapService.reset_all_to_defaults()
	_build_remap_list()


func _on_back_pressed() -> void:
	_settings.input_bindings = InputRemapService.serialize_all()
	_settings.save()
	_settings.apply_global()
	UIIntents.get_singleton().navigate_back_requested.emit()
