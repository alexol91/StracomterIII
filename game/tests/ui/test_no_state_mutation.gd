extends TestCase
## Regla dura del ámbito `ui-ux`: "la UI solo lee el estado del juego y emite
## señales de intención. Nunca muta el estado directamente ni contiene
## reglas de juego." Esta prueba escanea el propio código fuente de este
## agente en busca de escrituras directas a `GameState` (asignaciones a sus
## propiedades o llamadas a sus mutadores) y falla si encuentra alguna — la
## única vía de salida permitida es `UIIntents`.
##
## Fichero de prueba, no de producción: no es contradictorio que abra
## `GameState`/`SaveSystem` en otras pruebas de este agente para preparar el
## escenario (eso es el arnés de pruebas, no la UI en ejecución).

const UI_SRC_DIR: String = "res://src/ui/"

## Asignaciones directas a campos públicos de `GameState`.
var _assignment_regex: RegEx = RegEx.create_from_string(
	"GameState\\.(mode|action_status|player_archetype|current_floor|current_zone" \
	+ "|score|experience|run_seed|squad)\\s*(\\[[^\\]]*\\])?\\s*=[^=]")
## Llamadas a métodos de `GameState` que sí son reglas de juego (mutan).
var _mutator_call_regex: RegEx = RegEx.create_from_string(
	"GameState\\.(set_mode|reset_run|advance_floor|from_dict)\\s*\\(")
## `SaveSystem` decide cuándo se carga/guarda una partida real; la UI solo
## pide la acción vía `UIIntents.run_continue_requested`/`restart_requested`.
var _save_system_regex: RegEx = RegEx.create_from_string(
	"SaveSystem\\.(save_game|load_game|delete_save)\\s*\\(")


func test_no_direct_gamestate_field_assignment() -> void:
	_assert_no_matches(_assignment_regex, "asignación directa a un campo de GameState")


func test_no_gamestate_mutator_calls() -> void:
	_assert_no_matches(_mutator_call_regex, "llamada a un mutador de GameState")


func test_no_direct_save_system_calls() -> void:
	_assert_no_matches(_save_system_regex, "llamada directa a SaveSystem (usar UIIntents)")


func _assert_no_matches(regex: RegEx, label: String) -> void:
	var violations: Array[String] = []
	for path: String in _list_files(UI_SRC_DIR, ".gd"):
		var content := FileAccess.get_file_as_string(path)
		for line: String in content.split("\n"):
			var trimmed := line.strip_edges()
			if trimmed.begins_with("##") or trimmed.begins_with("#"):
				continue
			if regex.search(trimmed) != null:
				violations.append("%s → %s" % [path, trimmed])
	assert_true(violations.is_empty(), "%s:\n%s" % [label, "\n".join(violations)])


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
