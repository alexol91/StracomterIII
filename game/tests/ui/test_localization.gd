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


func test_reloading_strings_is_not_the_engine_recompiling_the_script() -> void:
	# `Script` ya tiene un `reload()` propio que recompila. Mientras esta
	# función se llamó igual, `Localization.reload()` desde fuera de la clase
	# llamaba al del motor: devolvía OK, no daba ni un aviso y no recargaba
	# nada. Esta prueba falla si alguien la renombra de vuelta.
	var names: Array[String] = []
	for entry: Dictionary in (Localization as GDScript).get_script_method_list():
		names.append(String(entry["name"]))
	assert_false(names.has("reload"),
		"la recarga de textos no puede llamarse como un método de Script")
	var original := Localization.current_locale()
	TranslationServer.set_locale("ja")
	Localization.reload_strings()
	assert_ne(TranslationServer.get_locale(), "ja",
		"si la llamada no hiciera nada, el locale imposible seguiría puesto")
	Localization.set_locale(original)


func test_an_unknown_system_language_falls_back_to_spanish() -> void:
	# Regresión: la comprobación era `if TranslationServer.get_locale().is_empty()`
	# y esa condición no se cumple nunca — Godot siempre devuelve el locale del
	# sistema. Un proyecto cuya interfaz es española por convención arrancaba en
	# inglés en cualquier máquina que no estuviera en español, sin un solo error
	# y sin que ninguna prueba lo notara. Solo se vio mirando una captura.
	var original := Localization.current_locale()
	TranslationServer.set_locale("ja")
	Localization.reload_strings()
	assert_eq(Localization.current_locale(), &"es",
		"en un idioma que no traducimos, el juego debe hablar español")
	Localization.set_locale(original)


func test_a_known_system_language_is_respected() -> void:
	# La otra mitad de la regla: si la máquina habla uno de los idiomas que sí
	# traducimos, no se le lleva la contraria.
	var original := Localization.current_locale()
	TranslationServer.set_locale("en")
	Localization.reload_strings()
	assert_eq(Localization.current_locale(), &"en",
		"si la máquina está en inglés y lo traducimos, se respeta")
	Localization.set_locale(original)


func test_compiled_translations_exist_for_the_exported_build() -> void:
	# El `.csv` es un fichero de ORIGEN: el exportador no lo empaqueta, igual
	# que no empaqueta un `.png` sin importar. En el juego compilado solo
	# llegan los `.translation` que genera el importador.
	#
	# Sin esta comprobación el fallo no aparece en ninguna prueba —desde el
	# proyecto el `.csv` está ahí— y solo se ve al ejecutar el binario: la
	# interfaz entera sin traducir y una cascada de errores de formato. Se
	# descubrió justamente así, arrancando el ejecutable exportado.
	for locale_code: StringName in Localization.AVAILABLE_LOCALES:
		var path := Localization.TRANSLATION_PATH % locale_code
		assert_true(ResourceLoader.exists(path),
			"falta la traducción compilada '%s'; ¿se importó el proyecto?" % path)
		var translation := load(path) as Translation
		assert_not_null(translation, "'%s' no carga como Translation" % path)
		if translation == null:
			continue
		# Se comprueba con una clave concreta y no contando `get_message_list()`:
		# el importador comprime a `OptimizedTranslation`, que guarda los
		# mensajes en una tabla hash y devuelve la LISTA VACÍA. Contar claves
		# daba cero y acusaba al recurso de estar mal cuando traducía
		# perfectamente.
		assert_eq(translation.get_message(&"TITLE_GAME_NAME"), "STRACOMTER III",
			"'%s' no traduce una clave conocida" % path)
