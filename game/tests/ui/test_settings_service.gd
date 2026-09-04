extends TestCase
## Persistencia de accesibilidad/opciones (GDD §10). Se prueba contra un
## fichero de prueba propio (`user://settings_test_uiux.json`), nunca contra
## `SettingsService.SETTINGS_PATH`: ese es el fichero real del jugador y
## `SaveSystem.SETTINGS_PATH` lo reserva para producción, no para pruebas.

const TEST_PATH: String = "user://settings_test_uiux.json"


func after_each() -> void:
	if FileAccess.file_exists(TEST_PATH):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(TEST_PATH))


func test_defaults_when_no_file_exists() -> void:
	var settings := SettingsService.new()
	var loaded := settings.load_or_defaults(TEST_PATH)
	assert_false(loaded, "no debería haber fichero todavía")
	assert_eq(settings.locale, Localization.DEFAULT_LOCALE)
	assert_true(settings.subtitles_enabled)
	assert_almost_eq(settings.fov_deg, 75.0, 0.001)


func test_save_and_reload_round_trip() -> void:
	var settings := SettingsService.new()
	settings.locale = &"en"
	settings.hud_scale = 1.25
	settings.colorblind_mode = SettingsService.ColorblindMode.DEUTERANOPIA
	settings.subtitles_enabled = false
	settings.camera_shake_enabled = false
	settings.fov_deg = 90.0
	settings.mouse_sensitivity = 0.004
	settings.master_volume = 0.6
	assert_true(settings.save(TEST_PATH))

	var reloaded := SettingsService.new()
	assert_true(reloaded.load_or_defaults(TEST_PATH))
	assert_eq(reloaded.locale, &"en")
	assert_almost_eq(reloaded.hud_scale, 1.25, 0.001)
	assert_eq(reloaded.colorblind_mode, SettingsService.ColorblindMode.DEUTERANOPIA)
	assert_false(reloaded.subtitles_enabled)
	assert_false(reloaded.camera_shake_enabled)
	assert_almost_eq(reloaded.fov_deg, 90.0, 0.001)
	assert_almost_eq(reloaded.mouse_sensitivity, 0.004, 0.0001)
	assert_almost_eq(reloaded.master_volume, 0.6, 0.001)


func test_load_rejects_corrupt_file_and_keeps_defaults() -> void:
	var file := FileAccess.open(TEST_PATH, FileAccess.WRITE)
	file.store_string("esto no es json valido {{{")
	file.close()
	var settings := SettingsService.new()
	var loaded := settings.load_or_defaults(TEST_PATH)
	assert_false(loaded)
	assert_eq(settings.locale, Localization.DEFAULT_LOCALE)


func test_load_rejects_mismatched_version() -> void:
	var payload := {"version": 999, "settings": {"locale": "en"}}
	var file := FileAccess.open(TEST_PATH, FileAccess.WRITE)
	file.store_string(JSON.stringify(payload))
	file.close()
	var settings := SettingsService.new()
	assert_false(settings.load_or_defaults(TEST_PATH))
	assert_eq(settings.locale, Localization.DEFAULT_LOCALE)


func test_hud_scale_clamped_on_load() -> void:
	var payload := {"version": SettingsService.SETTINGS_VERSION, "settings": {"hud_scale": 99.0}}
	var file := FileAccess.open(TEST_PATH, FileAccess.WRITE)
	file.store_string(JSON.stringify(payload))
	file.close()
	var settings := SettingsService.new()
	settings.load_or_defaults(TEST_PATH)
	assert_almost_eq(settings.hud_scale, SettingsService.HUD_SCALE_MAX, 0.001)


func test_input_bindings_round_trip_through_settings() -> void:
	var settings := SettingsService.new()
	settings.input_bindings = {"fire": [{"t": "key", "keycode": int(KEY_G)}]}
	assert_true(settings.save(TEST_PATH))
	var reloaded := SettingsService.new()
	reloaded.load_or_defaults(TEST_PATH)
	assert_true(reloaded.input_bindings.has("fire"))
