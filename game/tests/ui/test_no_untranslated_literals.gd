extends TestCase
## "Ningún literal de texto en el código, siempre claves de traducción"
## (GDD §10). Dos comprobaciones sobre el ÁMBITO de este agente
## (`game/src/ui/**`, `game/scenes/ui/**`):
##
## 1. Ninguna propiedad de texto de un `.gd`/`.tscn` contiene una frase en
##    minúsculas: solo debe haber claves (`MAYUSCULAS_CON_GUION_BAJO`) o
##    símbolos sin letras (":", ">", "—"). Una clave nunca lleva minúsculas,
##    así que "contiene una letra minúscula" es un detector fiable de que
##    alguien escribió texto de verdad donde debía ir una clave.
## 2. Toda clave que el código SÍ referencia (`Localization.t(&"...")`,
##    `tr(&"...")`, un `text = "CLAVE"` de `.tscn` traducido por
##    `AutoLocalize`, o `display_name_key` de los datos de `Balance`) existe
##    de verdad en `strings.csv`, en español Y en inglés. Una clave sin
##    traducción es tan literal como una frase suelta: el jugador vería la
##    clave en pantalla.

const UI_SRC_DIR: String = "res://src/ui/"
const UI_SCENES_DIR: String = "res://scenes/ui/"

## Ancla el final (`$`, aplicado línea a línea) para no confundir un literal
## de verdad con algo como `button.text = "\n".join(lines)`, donde la
## comilla que cierra "\n" no es el final de la asignación.
var _text_property_regex: RegEx = RegEx.create_from_string(
	"\\.(text|placeholder_text|tooltip_text)\\s*=\\s*\"([^\"]*)\"\\s*(#.*)?$")
var _tscn_text_regex: RegEx = RegEx.create_from_string(
	"^(text|placeholder_text)\\s*=\\s*\"([^\"]*)\"")
## El `&` es obligatorio a propósito: distingue una clave de traducción real
## (siempre `&"CLAVE"`, StringName, en este código) de un fragmento de
## literal usado para CONSTRUIR una clave en tiempo de ejecución (p. ej.
## `"INPUT_ACTION_" + accion.to_upper()`), que no lleva `&` porque todavía no
## es la clave completa y no debe confundirse con una.
var _key_literal_regex: RegEx = RegEx.create_from_string("&\"([A-Z][A-Z0-9_]*)\"")
var _lowercase_regex: RegEx = RegEx.create_from_string("[a-z]")


func test_no_gd_file_assigns_a_literal_phrase_to_a_text_property() -> void:
	var violations: Array[String] = []
	for path: String in _list_files(UI_SRC_DIR, ".gd"):
		var content := FileAccess.get_file_as_string(path)
		for m: RegExMatch in _text_property_regex.search_all(content):
			var value := m.get_string(2)
			if not value.is_empty() and _lowercase_regex.search(value) != null:
				violations.append("%s → %s = \"%s\"" % [path, m.get_string(1), value])
	assert_true(violations.is_empty(),
		"literales sin traducir en código:\n" + "\n".join(violations))


func test_no_tscn_file_hardcodes_a_literal_phrase() -> void:
	var violations: Array[String] = []
	for path: String in _list_files(UI_SCENES_DIR, ".tscn"):
		var content := FileAccess.get_file_as_string(path)
		for line: String in content.split("\n"):
			var trimmed := line.strip_edges()
			var m := _tscn_text_regex.search(trimmed)
			if m == null:
				continue
			var value := m.get_string(2)
			if not value.is_empty() and _lowercase_regex.search(value) != null:
				violations.append("%s → %s" % [path, trimmed])
	assert_true(violations.is_empty(),
		"literales sin traducir en escenas:\n" + "\n".join(violations))


func test_every_key_referenced_in_code_has_es_and_en_translation() -> void:
	var keys := _collect_referenced_keys()
	# Familias de claves construidas dinámicamente (concatenación en tiempo de
	# ejecución), que el escaneo estático de arriba no puede ver.
	for action: StringName in InputRemapService.MANAGED_ACTIONS:
		keys[StringName("INPUT_ACTION_" + String(action).to_upper())] = true
	for locale: StringName in [&"es", &"en"]:
		keys[StringName("OPTIONS_LOCALE_" + String(locale).to_upper())] = true

	assert_gt(keys.size(), 20, "se esperaban muchas claves referenciadas")
	var es_keys := Localization.keys_for_locale(&"es")
	var en_keys := Localization.keys_for_locale(&"en")
	var missing: Array[String] = []
	for key: Variant in keys.keys():
		if not es_keys.has(key):
			missing.append("%s (falta ES)" % key)
		if not en_keys.has(key):
			missing.append("%s (falta EN)" % key)
	assert_true(missing.is_empty(), "claves sin traducción:\n" + "\n".join(missing))


## Cobertura de datos: toda `display_name_key` de personajes/objetos/plantas
## que la UI puede llegar a mostrar debe existir en el `.csv`, aunque la
## clave en sí la elija `src/data/` y no este agente.
func test_every_data_display_name_key_has_translation() -> void:
	var es_keys := Localization.keys_for_locale(&"es")
	var en_keys := Localization.keys_for_locale(&"en")
	var missing: Array[String] = []
	for archetype: StringName in Balance.character_ids():
		var stats := Balance.character(archetype)
		_check_data_key(stats.display_name_key, es_keys, en_keys, missing)
	for n: int in range(GameState.FIRST_FLOOR, GameState.ROOFTOP_FLOOR + 1):
		var cfg := Balance.floor_config(n)
		if cfg != null:
			_check_data_key(cfg.display_name_key, es_keys, en_keys, missing)
	for pickup_id: StringName in [
		&"ammo_pack_1", &"ammo_pack_2", &"ammo_pack_3",
		&"health_pack_1", &"health_pack_2", &"health_pack_3", &"sniper",
	]:
		var pickup := Balance.pickup(pickup_id)
		if pickup != null:
			_check_data_key(pickup.display_name_key, es_keys, en_keys, missing)
	assert_true(missing.is_empty(), "claves de datos sin traducción:\n" + "\n".join(missing))


func _check_data_key(
	key: String, es_keys: Array[StringName], en_keys: Array[StringName], missing: Array[String]
) -> void:
	if key.is_empty():
		return
	if not es_keys.has(StringName(key)):
		missing.append("%s (falta ES)" % key)
	if not en_keys.has(StringName(key)):
		missing.append("%s (falta EN)" % key)


func _collect_referenced_keys() -> Dictionary:
	var keys: Dictionary = {}
	for path: String in _list_files(UI_SRC_DIR, ".gd"):
		var content := FileAccess.get_file_as_string(path)
		for m: RegExMatch in _key_literal_regex.search_all(content):
			keys[StringName(m.get_string(1))] = true
	for path: String in _list_files(UI_SCENES_DIR, ".tscn"):
		var content := FileAccess.get_file_as_string(path)
		# `_tscn_text_regex` ancla `^` al inicio de línea a propósito (para no
		# confundir un valor con un `text = "..."` que aparezca a mitad de
		# otra cadena); por eso se aplica línea a línea y no con `search_all`
		# sobre el fichero entero, donde `^` solo casaría al principio del
		# fichero.
		for line: String in content.split("\n"):
			var m := _tscn_text_regex.search(line.strip_edges())
			if m == null:
				continue
			var value := m.get_string(2)
			if AutoLocalize.is_key(value):
				keys[StringName(value)] = true
	return keys


func _list_files(dir_path: String, suffix: String) -> Array[String]:
	var out: Array[String] = []
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return out
	dir.list_dir_begin()
	var entry := dir.get_next()
	while entry != "":
		var full := dir_path.path_join(entry)
		if dir.current_is_dir():
			if not entry.begins_with("."):
				out.append_array(_list_files(full, suffix))
		elif entry.ends_with(suffix):
			out.append(full)
		entry = dir.get_next()
	dir.list_dir_end()
	return out
