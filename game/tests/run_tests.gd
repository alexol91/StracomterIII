extends Node
## Ejecutor de pruebas. Corre en headless, sin ventana ni GPU:
##   godot --headless --path game res://tests/run_tests.tscn
##
## Se ejecuta como escena (no con --script) a propósito: así los autoloads
## (Balance, EventBus, GameState, Blackboard, AIScheduler...) están cargados
## y las pruebas ven el proyecto tal y como es en ejecución.
##
## Descubre recursivamente todo `tests/**/test_*.gd` cuyo script extienda
## TestCase, y sale con código 1 si algo falla — que es lo que hace que CI
## sirva de algo.
##
## Filtro opcional por subcadena:
##   godot --headless --path game res://tests/run_tests.tscn -- --filter=simplex

const TESTS_ROOT: String = "res://tests/"
## Se precarga en lugar de usar el nombre global `TestCase`: el registro de
## clases globales depende de que el proyecto esté reimportado, y el runner
## debe funcionar en un checkout limpio de CI a la primera.
const TEST_CASE_SCRIPT: GDScript = preload("res://tests/test_case.gd")

var _total: int = 0
var _passed: int = 0
var _failed: int = 0
var _skipped_files: Array[String] = []
## Ficheros que deberían haber corrido y no pudieron. Son fallos duros.
var _broken_files: Array[String] = []
var _failure_lines: Array[String] = []


func _ready() -> void:
	# Las pruebas NO se ejecutan aquí. Durante el `_ready` inicial el árbol está
	# dentro de `propagate_notification`, y un `add_child` sobre la raíz en ese
	# momento no dispara el `_ready` del hijo: cualquier prueba que instancie
	# una escena la vería vacía —controles sin construir, `@onready` sin
	# resolver— y fallaría por un motivo que no tiene nada que ver con lo que
	# mide. Se espera un frame para que el árbol esté asentado.
	set_process(true)


func _process(_delta: float) -> void:
	set_process(false)
	_run_all()


func _run_all() -> void:
	var filter := _read_filter()
	var files := _discover(TESTS_ROOT)
	files.sort()

	print("")
	print("== Pruebas de Stracomter III ==")
	if not filter.is_empty():
		print("   filtro: '%s'" % filter)
	print("   %d ficheros descubiertos" % files.size())
	print("")

	for path: String in files:
		if not filter.is_empty() and not path.contains(filter):
			continue
		_run_file(path)

	print("")
	if _failure_lines.is_empty():
		print("== %d pruebas, todas correctas ==" % _total)
	else:
		print("== FALLOS (%d de %d) ==" % [_failed, _total])
		for line: String in _failure_lines:
			print("   %s" % line)
	if not _broken_files.is_empty():
		print("")
		print("== FICHEROS ROTOS (%d) ==" % _broken_files.size())
		for path: String in _broken_files:
			print("   %s" % path)
	if not _skipped_files.is_empty():
		print("")
		print("   Omitidos:")
		for path: String in _skipped_files:
			print("     %s" % path)
	print("")

	# Un fichero que no carga cuenta como fallo: salir con 0 tras un error de
	# parseo es la peor clase de prueba verde que existe.
	get_tree().quit(1 if (_failed > 0 or not _broken_files.is_empty()) else 0)


func _read_filter() -> String:
	for arg: String in OS.get_cmdline_user_args():
		if arg.begins_with("--filter="):
			return arg.trim_prefix("--filter=")
	return ""


func _discover(dir_path: String) -> Array[String]:
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
				out.append_array(_discover(full))
		else:
			var clean := entry.trim_suffix(".remap")
			# `test_case.gd` es la clase base, no una prueba.
			if clean == "test_case.gd":
				entry = dir.get_next()
				continue
			if clean.begins_with("test_") and clean.ends_with(".gd"):
				out.append(dir_path.path_join(clean))
		entry = dir.get_next()
	dir.list_dir_end()
	return out


## ¿Hereda este script de TestCase, directa o indirectamente?
func _extends_test_case(script: GDScript) -> bool:
	var current: GDScript = script.get_base_script()
	while current != null:
		if current == TEST_CASE_SCRIPT or current.resource_path == TEST_CASE_SCRIPT.resource_path:
			return true
		current = current.get_base_script()
	return false


func _run_file(path: String) -> void:
	var script: Variant = load(path)
	if script == null:
		_broken_files.append("%s (no se pudo cargar: error de parseo o dependencia rota)" % path)
		return
	var gd_script := script as GDScript
	if not _extends_test_case(gd_script):
		_broken_files.append("%s (no extiende TestCase)" % path)
		return
	var test_case: Object = gd_script.new()
	var name := path.trim_prefix(TESTS_ROOT).trim_suffix(".gd")

	var methods: Array[String] = []
	for m: Dictionary in test_case.get_method_list():
		var method_name: String = m.get("name", "")
		if method_name.begins_with("test_") and not methods.has(method_name):
			methods.append(method_name)
	methods.sort()

	if methods.is_empty():
		_broken_files.append("%s (sin métodos test_*)" % path)
		return

	print("-- %s" % name)
	for method_name: String in methods:
		_total += 1
		test_case.failures.clear()
		test_case.assertions = 0
		test_case.before_each()
		test_case.call(method_name)
		test_case.after_each()

		if test_case.assertions == 0:
			test_case.failures.append("la prueba no ejecutó ninguna aserción")

		if test_case.failures.is_empty():
			_passed += 1
			print("   OK    %s" % method_name)
		else:
			_failed += 1
			print("   FALLO %s" % method_name)
			for f: String in test_case.failures:
				print("         %s" % f)
				_failure_lines.append("%s::%s — %s" % [name, method_name, f])
