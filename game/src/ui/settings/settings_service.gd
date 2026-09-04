class_name SettingsService
extends RefCounted
## Preferencias de usuario: accesibilidad, audio e idioma (GDD §10).
##
## Persiste en `user://settings.json`, la misma ruta que ya reserva
## `SaveSystem.SETTINGS_PATH` — se replica aquí el patrón de JSON versionado
## de `SaveSystem` (en vez de añadir métodos a ese fichero, que no es de este
## agente) para que ambos ficheros convivan en la misma ruta con el mismo
## formato de fallo explícito: una versión que no se entiende no se carga a
## medias.
##
## Todo lo que guarda esta clase es preferencia de presentación, no estado de
## partida ni regla de juego: aplica valores a nodos de escena que ya existen
## (cámara activa, HUD, buses de audio, `InputMap`) tal como autoriza la
## cabecera de `TPSCamera` ("este nodo solo publica `mouse_sensitivity` y
## `gamepad_sensitivity_rad_s` como propiedades ajustables en caliente").

const SETTINGS_PATH: String = "user://settings.json"
const SETTINGS_VERSION: int = 1

enum ColorblindMode { NONE, PROTANOPIA, DEUTERANOPIA, TRITANOPIA }

## Escala del HUD. El original dibujaba a resolución fija (800×600) con
## posiciones absolutas (`docs/analisis/legacy-gameplay.md` §9.1); aquí es un
## factor sobre el layout base para que sea legible en cualquier resolución.
const HUD_SCALE_MIN: float = 0.75
const HUD_SCALE_MAX: float = 1.5

const FOV_MIN_DEG: float = 60.0
const FOV_MAX_DEG: float = 110.0

var locale: StringName = Localization.DEFAULT_LOCALE
var hud_scale: float = 1.0
var colorblind_mode: ColorblindMode = ColorblindMode.NONE
var subtitles_enabled: bool = true
var camera_shake_enabled: bool = true
var fov_deg: float = 75.0
var mouse_sensitivity: float = 0.0025
var gamepad_sensitivity_rad_s: float = 3.0
var master_volume: float = 1.0
var music_volume: float = 0.8
var sfx_volume: float = 1.0
var voice_volume: float = 1.0
## Bindings de `InputMap`, en el formato de `InputRemapService.serialize_all`.
var input_bindings: Dictionary = {}

static var _instance: SettingsService = null


static func get_singleton() -> SettingsService:
	if _instance == null:
		_instance = SettingsService.new()
		_instance.load_or_defaults()
	return _instance


## Carga desde disco; si no hay partida de opciones guardada, se queda con
## los valores de fábrica declarados arriba (no es un fallo).
func load_or_defaults(path: String = SETTINGS_PATH) -> bool:
	if not FileAccess.file_exists(path):
		return false
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return false
	var text := file.get_as_text()
	file.close()
	var parsed: Variant = JSON.parse_string(text)
	if parsed is not Dictionary:
		push_warning("SettingsService: '%s' corrupto, se usan valores de fábrica." % path)
		return false
	var data: Dictionary = parsed
	if int(data.get("version", 0)) != SETTINGS_VERSION:
		push_warning("SettingsService: versión de settings distinta, se usan valores de fábrica.")
		return false
	_from_dict(data.get("settings", {}))
	return true


func save(path: String = SETTINGS_PATH) -> bool:
	var payload := {
		"version": SETTINGS_VERSION,
		"settings": to_dict(),
	}
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_error("SettingsService: no se pudo escribir '%s' (%d)."
			% [path, FileAccess.get_open_error()])
		return false
	file.store_string(JSON.stringify(payload, "\t"))
	file.close()
	return true


## Aplica las preferencias vivas al `InputMap`, a `TranslationServer` y a los
## buses de `AudioDirector`. Los settings que dependen de un nodo de escena
## concreto (FOV/sensibilidad de cámara, escala de HUD, daltonismo) se
## consultan bajo demanda desde esos nodos (`apply_to_camera`, HUD propio):
## no hay garantía de que existan en el momento de cargar settings.
func apply_global() -> void:
	Localization.set_locale(locale)
	if not input_bindings.is_empty():
		InputRemapService.apply_serialized(input_bindings)
	AudioDirector.set_bus_volume_db(AudioDirector.BUS_MASTER, linear_to_db(maxf(master_volume, 0.0001)))
	AudioDirector.set_bus_volume_db(AudioDirector.BUS_MUSIC, linear_to_db(maxf(music_volume, 0.0001)))
	AudioDirector.set_bus_volume_db(AudioDirector.BUS_SFX, linear_to_db(maxf(sfx_volume, 0.0001)))
	AudioDirector.set_bus_volume_db(AudioDirector.BUS_VOICE, linear_to_db(maxf(voice_volume, 0.0001)))
	UIIntents.get_singleton().settings_applied.emit()


## Aplica FOV y sensibilidad a una cámara viva. Es la mitad "consumidora" del
## contrato que declara `TPSCamera` en su propia cabecera.
func apply_to_camera(camera: TPSCamera) -> void:
	if camera == null:
		return
	camera.mouse_sensitivity = mouse_sensitivity
	camera.gamepad_sensitivity_rad_s = gamepad_sensitivity_rad_s
	var cam3d := camera.get_node_or_null("SpringArm3D/Camera3D") as Camera3D
	if cam3d != null:
		cam3d.fov = fov_deg


func to_dict() -> Dictionary:
	return {
		"locale": String(locale),
		"hud_scale": hud_scale,
		"colorblind_mode": int(colorblind_mode),
		"subtitles_enabled": subtitles_enabled,
		"camera_shake_enabled": camera_shake_enabled,
		"fov_deg": fov_deg,
		"mouse_sensitivity": mouse_sensitivity,
		"gamepad_sensitivity_rad_s": gamepad_sensitivity_rad_s,
		"master_volume": master_volume,
		"music_volume": music_volume,
		"sfx_volume": sfx_volume,
		"voice_volume": voice_volume,
		"input_bindings": input_bindings,
	}


func _from_dict(d: Dictionary) -> void:
	locale = StringName(d.get("locale", String(Localization.DEFAULT_LOCALE)))
	hud_scale = clampf(float(d.get("hud_scale", 1.0)), HUD_SCALE_MIN, HUD_SCALE_MAX)
	var raw_mode := clampi(int(d.get("colorblind_mode", 0)), 0, int(ColorblindMode.TRITANOPIA))
	colorblind_mode = raw_mode as ColorblindMode
	subtitles_enabled = bool(d.get("subtitles_enabled", true))
	camera_shake_enabled = bool(d.get("camera_shake_enabled", true))
	fov_deg = clampf(float(d.get("fov_deg", 75.0)), FOV_MIN_DEG, FOV_MAX_DEG)
	mouse_sensitivity = float(d.get("mouse_sensitivity", 0.0025))
	gamepad_sensitivity_rad_s = float(d.get("gamepad_sensitivity_rad_s", 3.0))
	master_volume = clampf(float(d.get("master_volume", 1.0)), 0.0, 1.0)
	music_volume = clampf(float(d.get("music_volume", 0.8)), 0.0, 1.0)
	sfx_volume = clampf(float(d.get("sfx_volume", 1.0)), 0.0, 1.0)
	voice_volume = clampf(float(d.get("voice_volume", 1.0)), 0.0, 1.0)
	input_bindings = (d.get("input_bindings", {}) as Dictionary).duplicate(true)
