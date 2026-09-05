class_name Localization
extends RefCounted
## Carga de idiomas ES/EN desde `strings.csv` (GDD §10: "ningún literal de
## texto en el código, siempre claves de traducción").
##
## El proyecto no tiene editor disponible en este flujo de trabajo (se prueba
## en `--headless` desde CLI), así que en vez de depender del importador de
## `.csv` → `.translation` de Godot (que exige un paso de importación en el
## editor y no es fiable en este entorno headless multi-agente), este loader
## lee el `.csv` directamente con `FileAccess.get_csv_line` y construye los
## recursos `Translation` en tiempo de ejecución, registrándolos en
## `TranslationServer`. El `.csv` sigue siendo la única fuente de verdad de
## los textos — es la vía pedida por el GDD — solo cambia CUÁNDO se compila.
##
## Idempotente: llamarlo muchas veces (cada pantalla lo hace en `_ready`) no
## recarga ni duplica mensajes salvo que se pida explícitamente con `reload`.

const CSV_PATH: String = "res://src/ui/i18n/strings.csv"
const DEFAULT_LOCALE: StringName = &"es"
const AVAILABLE_LOCALES: Array[StringName] = [&"es", &"en"]

static var _loaded: bool = false
## Claves vistas en el CSV, por locale. Lo usan las pruebas de cobertura de
## traducción para no releer el fichero cada vez.
static var _keys_by_locale: Dictionary[StringName, Dictionary] = {}


## Garantiza que las traducciones están cargadas en `TranslationServer`.
## Segura de llamar desde el `_ready()` de cualquier pantalla.
static func ensure_loaded() -> void:
	if _loaded:
		return
	reload_strings()


## Fuerza la relectura del `.csv`. Útil para pruebas y para iterar textos sin
## reiniciar el proceso.
##
## Se llama `reload_strings` y no `reload` por una razón que costó una tarde
## encontrar: `Localization` es un `GDScript`, y `Script` ya tiene un método
## `reload()` propio del motor que RECOMPILA el script. Desde dentro de la
## clase, `reload()` resolvía a esta función; desde fuera,
## `Localization.reload()` llamaba al del motor, recompilaba y devolvía OK.
## Ningún error, ningún aviso, y las traducciones sin recargar. El síntoma era
## absurdo —una función que no imprimía ni su primera línea— hasta caer en que
## no era esta función la que se estaba ejecutando.
##
## Regla que se lleva: una función estática en una clase con `class_name` no
## puede llamarse como un método de `Object`, `Resource` o `Script`. El motor
## gana y lo hace en silencio.
static func reload_strings() -> void:
	_keys_by_locale.clear()
	var rows := _read_csv(CSV_PATH)
	if rows.is_empty():
		push_error("Localization: '%s' vacío o no encontrado." % CSV_PATH)
		_loaded = true
		return
	var header: PackedStringArray = rows[0]
	# Columna 0 = "keys"; el resto son códigos de locale (es, en, ...).
	var locale_columns: Dictionary[int, StringName] = {}
	for col: int in range(1, header.size()):
		var locale_code := StringName(header[col].strip_edges())
		if locale_code == &"":
			continue
		locale_columns[col] = locale_code
		_keys_by_locale[locale_code] = {}

	var translations: Dictionary[StringName, Translation] = {}
	for locale_code: StringName in locale_columns.values():
		var t := Translation.new()
		t.locale = String(locale_code)
		translations[locale_code] = t

	for row_idx: int in range(1, rows.size()):
		var row: PackedStringArray = rows[row_idx]
		if row.is_empty() or row[0].strip_edges() == "":
			continue
		var key := StringName(row[0].strip_edges())
		for col: int in locale_columns:
			if col >= row.size():
				continue
			var locale_code: StringName = locale_columns[col]
			var value := row[col]
			translations[locale_code].add_message(key, value)
			(_keys_by_locale[locale_code] as Dictionary)[key] = true

	for locale_code: StringName in translations:
		TranslationServer.add_translation(translations[locale_code])

	_apply_default_locale_if_needed()
	_loaded = true


## Deja el juego en español salvo que la máquina esté en un idioma que sí
## traducimos.
##
## Antes esto preguntaba `if TranslationServer.get_locale().is_empty()`, y esa
## condición NO SE CUMPLE NUNCA: Godot siempre devuelve un locale, el del
## sistema, y en headless o en una máquina en inglés eso es "en". Resultado: un
## proyecto cuya UI es española por convención arrancaba en inglés, sin ningún
## error, y solo se veía mirando una captura del menú.
##
## Es el mismo patrón contra el que avisa CLAUDE.md —el valor por defecto de un
## dato que no ha llegado— con el agravante de que el centinela elegido era
## imposible. Aquí la pregunta correcta no es "¿me han dicho el idioma?" sino
## "¿el idioma que me han dicho es uno de los que hablo?".
static func _apply_default_locale_if_needed() -> void:
	var language := TranslationServer.get_locale().get_slice("_", 0)
	if AVAILABLE_LOCALES.has(StringName(language)):
		return
	TranslationServer.set_locale(String(DEFAULT_LOCALE))


## Cambia el idioma activo. `locale_code` es "es" o "en".
static func set_locale(locale_code: StringName) -> void:
	ensure_loaded()
	TranslationServer.set_locale(String(locale_code))


static func current_locale() -> StringName:
	return StringName(TranslationServer.get_locale())


## Todas las claves declaradas para un locale (para pruebas de cobertura).
static func keys_for_locale(locale_code: StringName) -> Array[StringName]:
	ensure_loaded()
	var keys: Array[StringName] = []
	for key: Variant in _keys_by_locale.get(locale_code, {}).keys():
		keys.append(key as StringName)
	return keys


## Traduce una clave. Envoltorio explícito sobre `tr()` para que quede claro
## en el código que un texto SIEMPRE pasa por aquí, nunca como literal.
static func t(key: StringName) -> String:
	ensure_loaded()
	# `tr()` es un método de Object y no se puede llamar desde un contexto
	# estático. `TranslationServer.translate` es la vía equivalente y además
	# deja esta función utilizable desde cualquier sitio, no solo desde un nodo.
	return TranslationServer.translate(key)


static func _read_csv(path: String) -> Array[PackedStringArray]:
	var rows: Array[PackedStringArray] = []
	if not FileAccess.file_exists(path):
		return rows
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return rows
	while not file.eof_reached():
		var line := file.get_csv_line()
		if line.size() == 1 and line[0].is_empty():
			continue
		rows.append(line)
	file.close()
	return rows
