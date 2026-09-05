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


func test_retro_cheat_switches_the_model_style() -> void:
	var original := ModelStyle.retro_enabled
	DevConsole.execute(": retro off")
	assert_false(ModelStyle.retro_enabled, "'retro off' debe desactivar el modo retro")
	DevConsole.execute(": retro on")
	assert_true(ModelStyle.retro_enabled, "'retro on' debe activarlo")
	ModelStyle.retro_enabled = original


func test_retro_off_falls_back_when_there_is_no_modern_model() -> void:
	# Sin modelos nuevos instalados, apagar el retro no puede dejar al
	# personaje invisible: se sigue usando el de 2012.
	var original := ModelStyle.retro_enabled
	ModelStyle.retro_enabled = false
	var path := ModelStyle.scene_path_for(&"captain")
	assert_true(ResourceLoader.exists(path),
		"la escena elegida debe existir siempre, haya modelo nuevo o no")
	ModelStyle.retro_enabled = original


func test_retro_off_warns_when_nothing_will_change() -> void:
	var original := ModelStyle.retro_enabled
	var out := DevConsole.execute(": retro off")
	if ModelStyle.archetypes_without_modern().size() >= Balance.character_ids().size():
		assert_true(out.contains("no hay modelos nuevos"),
			"debe avisar de que no se verá ningún cambio")
	else:
		assert_true(out.contains("DESACTIVADO"))
	ModelStyle.retro_enabled = original


func test_chutaos_cheat_switches_the_sound_pack() -> void:
	var original := AudioDirector.joke_pack_enabled
	DevConsole.execute(": chutaos on")
	assert_true(AudioDirector.joke_pack_enabled, "debe activar el paquete de broma")
	assert_true(AudioDirector.loaded_effects().size() > 0,
		"el paquete activo debe tener efectos cargados")
	DevConsole.execute(": chutaos off")
	assert_false(AudioDirector.joke_pack_enabled)
	AudioDirector.joke_pack_enabled = original


func test_xp_cheat_adds_experience() -> void:
	var before := GameState.experience
	DevConsole.execute(": xp 50")
	assert_eq(GameState.experience, before + 50)
	GameState.experience = before
