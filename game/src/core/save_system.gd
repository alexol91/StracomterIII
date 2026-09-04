extends Node
## Guardado y carga en JSON versionado.
##
## El legacy volcaba structs con fwrite (GameStatus::saveData, legacy/trunk/
## core/lib/GameStatus.cc:172): el fichero dependía del padding del compilador
## y de la plataforma, así que una partida guardada en Linux no se podía leer
## en Windows y cualquier cambio en la clase la invalidaba en silencio.
## Aquí el formato es texto, versionado y migrable.

const SAVE_VERSION: int = 1
const SAVE_PATH: String = "user://savegame.json"
const SETTINGS_PATH: String = "user://settings.json"

signal save_completed(success: bool)
signal load_completed(success: bool)


func save_game(path: String = SAVE_PATH) -> bool:
	var payload := {
		"version": SAVE_VERSION,
		"saved_at": Time.get_datetime_string_from_system(true),
		"state": GameState.to_dict(),
	}
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_error("SaveSystem: no se pudo escribir %s (%d)" % [path, FileAccess.get_open_error()])
		save_completed.emit(false)
		return false
	file.store_string(JSON.stringify(payload, "\t"))
	file.close()
	save_completed.emit(true)
	return true


func load_game(path: String = SAVE_PATH) -> bool:
	if not FileAccess.file_exists(path):
		load_completed.emit(false)
		return false
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		load_completed.emit(false)
		return false
	var text := file.get_as_text()
	file.close()
	var parsed: Variant = JSON.parse_string(text)
	if parsed is not Dictionary:
		push_error("SaveSystem: partida corrupta en %s" % path)
		load_completed.emit(false)
		return false
	var data: Dictionary = parsed
	var version := int(data.get("version", 0))
	if version != SAVE_VERSION:
		data = _migrate(data, version)
		if data.is_empty():
			load_completed.emit(false)
			return false
	GameState.from_dict(data.get("state", {}))
	load_completed.emit(true)
	return true


func has_save(path: String = SAVE_PATH) -> bool:
	return FileAccess.file_exists(path)


func delete_save(path: String = SAVE_PATH) -> void:
	if FileAccess.file_exists(path):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(path))


## Migración entre versiones de formato. Devuelve {} si la partida no es
## recuperable — mejor rechazarla explícitamente que cargar basura.
func _migrate(data: Dictionary, from_version: int) -> Dictionary:
	push_warning("SaveSystem: partida en versión %d, actual %d." % [from_version, SAVE_VERSION])
	if from_version <= 0:
		return {}
	data["version"] = SAVE_VERSION
	return data
