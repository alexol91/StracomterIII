class_name DirectorTestCase
extends RefCounted
## Caso de prueba mínimo para el runner headless (`res://tests/run_tests.gd`).
##
## No se usa GdUnit4: el proyecto no admite dependencias externas fuera de
## desarrollo y un runner de 120 líneas cubre lo que necesita el director.
## Un caso es una clase que hereda de esta y define métodos `test_*`.
##
## Las aserciones son TIPADAS a propósito (`assert_eq_int`, `assert_eq_float`…)
## en lugar de una única `assert_eq(Variant, Variant)`: el proyecto trata los
## avisos de tipado como errores y comparar Variants los dispara.

## Mensajes de los fallos acumulados en la ejecución actual.
var failures: Array[String] = []
## Número de aserciones evaluadas. Un caso con 0 aserciones es un caso roto.
var assertions: int = 0

var _current_test: String = ""


## Nombre legible de la suite. Sobrescribir en cada caso.
func suite_name() -> String:
	return get_script().resource_path.get_file().get_basename()


## Se ejecuta antes de cada método `test_*`.
func before_each() -> void:
	pass


## Nombres de los métodos de prueba, en orden alfabético (determinismo).
func test_method_names() -> Array[String]:
	var names: Array[String] = []
	for entry: Dictionary in get_method_list():
		var method_name := String(entry.get("name", ""))
		if method_name.begins_with("test_") and not names.has(method_name):
			names.append(method_name)
	names.sort()
	return names


## Ejecuta un método de prueba por nombre.
func run_test(method_name: String) -> void:
	_current_test = method_name
	before_each()
	call(method_name)


# ---- Aserciones ----

func check(condition: bool, message: String) -> void:
	assertions += 1
	if not condition:
		_fail(message)


func fail(message: String) -> void:
	assertions += 1
	_fail(message)


func assert_true(condition: bool, message: String) -> void:
	check(condition, "se esperaba verdadero — " + message)


func assert_false(condition: bool, message: String) -> void:
	check(not condition, "se esperaba falso — " + message)


func assert_eq_int(actual: int, expected: int, message: String) -> void:
	check(actual == expected, "%s: se esperaba %d y se obtuvo %d" % [message, expected, actual])


func assert_eq_bool(actual: bool, expected: bool, message: String) -> void:
	check(actual == expected, "%s: se esperaba %s y se obtuvo %s" % [message, expected, actual])


func assert_eq_str(actual: String, expected: String, message: String) -> void:
	check(actual == expected, "%s: se esperaba '%s' y se obtuvo '%s'" % [message, expected, actual])


func assert_eq_float(actual: float, expected: float, tolerance: float, message: String) -> void:
	check(
		absf(actual - expected) <= tolerance,
		"%s: se esperaba %f ± %f y se obtuvo %f" % [message, expected, tolerance, actual]
	)


func assert_lte_float(actual: float, limit: float, message: String) -> void:
	check(actual <= limit, "%s: se esperaba <= %f y se obtuvo %f" % [message, limit, actual])


func assert_gte_float(actual: float, limit: float, message: String) -> void:
	check(actual >= limit, "%s: se esperaba >= %f y se obtuvo %f" % [message, limit, actual])


func assert_eq_int_array(actual: Array[int], expected: Array[int], message: String) -> void:
	check(
		_int_arrays_equal(actual, expected),
		"%s: se esperaba %s y se obtuvo %s" % [message, str(expected), str(actual)]
	)


## Igualdad EXACTA de racionales: compara la forma canónica, no el float.
func assert_eq_rational(actual: Rational, expected: Rational, message: String) -> void:
	check(
		actual.equals(expected),
		"%s: se esperaba %s y se obtuvo %s" % [message, expected.to_string(), actual.to_string()]
	)


func _int_arrays_equal(a: Array[int], b: Array[int]) -> bool:
	if a.size() != b.size():
		return false
	for i: int in a.size():
		if a[i] != b[i]:
			return false
	return true


func _fail(message: String) -> void:
	failures.append("%s :: %s — %s" % [suite_name(), _current_test, message])
