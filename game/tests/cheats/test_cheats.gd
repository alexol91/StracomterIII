extends TestCase
## Pruebas del sistema de trucos y del conmutador retro.

var _registered: Array[String] = []


func after_each() -> void:
	for name: String in _registered:
		Cheats.unregister(name)
	_registered.clear()
	Cheats.reset_usage()


func _register(name: String, min_args: int, callable: Callable) -> void:
	Cheats.register(name, "prueba", min_args, callable)
	_registered.append(name)


func test_a_line_with_colon_is_recognised_as_a_cheat() -> void:
	assert_true(Cheats.is_cheat_line(": retro on"))
	assert_true(Cheats.is_cheat_line(":retro on"), "sin espacio también vale")
	assert_true(Cheats.is_cheat_line("   : god   "), "con espacios alrededor también")
	assert_false(Cheats.is_cheat_line("status"), "un comando normal no es un truco")


func test_a_registered_cheat_runs_and_receives_its_arguments() -> void:
	# El contador va en un Array porque las lambdas de GDScript capturan por
	# valor: con un int, la mutación se quedaría dentro de la lambda.
	var seen: Array = []
	_register("prueba", 0, func(args: Array[String]) -> String:
		seen.append(args.duplicate())
		return "hecho")
	var out := Cheats.execute(": prueba uno dos")
	assert_eq(out, "hecho")
	assert_size(seen, 1, "el truco debe ejecutarse una vez")
	assert_eq(seen[0], ["uno", "dos"], "debe recibir sus argumentos")


func test_an_unknown_cheat_says_so_instead_of_failing_silently() -> void:
	var out := Cheats.execute(": noexiste")
	assert_true(out.contains("desconocido"), "debe avisar de que no existe")


func test_a_cheat_missing_arguments_explains_its_usage() -> void:
	_register("necesita", 2, func(_a: Array[String]) -> String: return "no debería llegar")
	var out := Cheats.execute(": necesita solo_uno")
	assert_true(out.contains("Faltan argumentos"), "debe explicar qué falta")


func test_using_a_cheat_is_recorded() -> void:
	# Una partida con trucos no debería competir con una sin ellos, así que
	# queda constancia.
	assert_false(Cheats.cheats_were_used(), "al empezar no hay trucos usados")
	_register("marca", 0, func(_a: Array[String]) -> String: return "ok")
	Cheats.execute(": marca")
	assert_true(Cheats.cheats_were_used(), "usar un truco debe quedar registrado")


func test_an_unknown_cheat_does_not_count_as_used() -> void:
	Cheats.execute(": estonoexiste")
	assert_false(Cheats.cheats_were_used(),
		"escribir mal un truco no es hacer trampa")


func test_the_console_routes_colon_lines_to_the_cheats() -> void:
	var seen: Array = []
	_register("desdeconsola", 0, func(_a: Array[String]) -> String:
		seen.append(true)
		return "ejecutado")
	var out := DevConsole.execute(": desdeconsola")
	assert_size(seen, 1, "la consola debe enrutar la línea al truco")
	assert_true(out.contains("ejecutado"))


func test_a_normal_command_is_not_treated_as_a_cheat() -> void:
	var out := DevConsole.execute("help")
	assert_true(out.contains("Comandos"), "'help' sigue siendo un comando")
	assert_false(Cheats.cheats_were_used(), "un comando normal no marca trucos")


func test_help_lists_the_registered_cheats() -> void:
	_register("listado", 0, func(_a: Array[String]) -> String: return "")
	var out := Cheats.execute(": help")
	assert_true(out.contains("listado"), "el truco registrado debe aparecer")


func test_chutaos_cheat_moves_models_audio_and_materials_together() -> void:
	# El motivo de unificar los dos trucos: antes se podía tener modelos de
	# 2012 con audio serio, o al revés, y ninguna de esas mezclas es un estado
	# que nadie quisiera. Un solo eje o no hay eje.
	var original := PresentationStyle.chutaos_mode
	DevConsole.execute(": chutaos on")
	assert_true(PresentationStyle.chutaos_mode, "'chutaos on' debe activar el modo de 2012")
	assert_true(AudioDirector.joke_pack_enabled, "las voces de broma van en el mismo eje")
	assert_true(PresentationStyle.scene_path_for(&"captain").contains("scenes/models/"),
		"en modo chutaos el personaje usa el modelo de 2012")
	var chutaos_floor := PresentationStyle.surface_material(WorldSurface.Kind.FLOOR)

	DevConsole.execute(": chutaos off")
	assert_false(PresentationStyle.chutaos_mode, "'chutaos off' debe volver al remake")
	assert_false(AudioDirector.joke_pack_enabled, "el audio serio vuelve con el remake")
	var modern_floor := PresentationStyle.surface_material(WorldSurface.Kind.FLOOR)
	assert_ne(chutaos_floor, modern_floor, "cada estilo pinta el suelo con su material")

	PresentationStyle.chutaos_mode = original


func test_retro_still_works_as_an_alias_and_teaches_the_new_name() -> void:
	# Quien ya tenía 'retro' en los dedos merece que le funcione; el mensaje
	# le enseña que ahora el truco se llama de otra forma y hace más cosas.
	var original := PresentationStyle.chutaos_mode
	DevConsole.execute(": retro off")
	assert_false(PresentationStyle.chutaos_mode, "'retro off' sigue apagando el estilo de 2012")
	var out := DevConsole.execute(": retro on")
	assert_true(PresentationStyle.chutaos_mode, "'retro on' sigue encendiéndolo")
	assert_true(out.contains("chutaos"), "el alias debe nombrar el truco bueno")
	PresentationStyle.chutaos_mode = original


func test_the_remake_style_never_leaves_a_character_invisible() -> void:
	# Sin modelo nuevo para un arquetipo, apagar el estilo de 2012 no puede
	# dejarlo sin escena: se cae al modelo original antes que a la nada.
	var original := PresentationStyle.chutaos_mode
	PresentationStyle.chutaos_mode = false
	for id: StringName in Balance.character_ids():
		var path := PresentationStyle.scene_path_for(id)
		assert_true(ResourceLoader.exists(path),
			"la escena de '%s' debe existir siempre, haya modelo nuevo o no" % id)
	PresentationStyle.chutaos_mode = original


func test_the_remake_style_warns_when_a_model_is_still_missing() -> void:
	var original := PresentationStyle.chutaos_mode
	PresentationStyle.chutaos_mode = true
	var out := DevConsole.execute(": chutaos off")
	if PresentationStyle.archetypes_without_modern().is_empty():
		assert_true(out.contains("REMAKE"), "sin huecos, confirma el modo remake")
	else:
		assert_true(out.contains("sin modelo nuevo"),
			"debe nombrar los arquetipos que aún no tienen modelo nuevo")
	PresentationStyle.chutaos_mode = original


func test_xp_cheat_adds_experience() -> void:
	var before := GameState.experience
	DevConsole.execute(": xp 50")
	assert_eq(GameState.experience, before + 50)
	GameState.experience = before
