extends TestCase
## Carga de `strings.csv` → `TranslationServer` (GDD §10: ES/EN desde el
## primer día). No depende del importador de `.csv` de Godot (ver la
## cabecera de `Localization`): lee el `.csv` a mano, así que esta prueba
## vale igual en este entorno headless sin editor.

var _previous_locale: String = ""


func before_each() -> void:
	Localization.ensure_loaded()
	_previous_locale = TranslationServer.get_locale()


func after_each() -> void:
	TranslationServer.set_locale(_previous_locale)


func test_keys_loaded_for_both_locales() -> void:
	assert_gt(Localization.keys_for_locale(&"es").size(), 10)
	assert_gt(Localization.keys_for_locale(&"en").size(), 10)


func test_translation_differs_between_locales_for_a_known_key() -> void:
	Localization.set_locale(&"es")
	var es_text := Localization.t(&"STRATEGY_ZONE_FMT")
	Localization.set_locale(&"en")
	var en_text := Localization.t(&"STRATEGY_ZONE_FMT")
	assert_ne(es_text, en_text)
	assert_true(es_text.contains("ZONA"))
	assert_true(en_text.contains("ZONE"))


func test_translate_unknown_key_does_not_crash() -> void:
	var result := Localization.t(&"THIS_KEY_DOES_NOT_EXIST_IN_ANY_LOCALE")
	assert_not_null(result)


func test_credits_names_are_present_and_identical_across_locales() -> void:
	# Los cuatro nombres del equipo original no se traducen: deben existir en
	# el csv en las dos columnas (GDD/atribución del proyecto).
	var names := [
		"Sergio Gallardo Sales", "Alejandro Oñate Latorre",
		"Martín Candela Calabuig", "Rubén Pardo Millá",
	]
	var keys := [&"CREDITS_NAME_1", &"CREDITS_NAME_2", &"CREDITS_NAME_3", &"CREDITS_NAME_4"]
	Localization.set_locale(&"es")
	var es_names: Array[String] = []
	for key: StringName in keys:
		es_names.append(Localization.t(key))
	for expected: String in names:
		assert_true(es_names.has(expected), "falta el nombre '%s' en los créditos" % expected)
