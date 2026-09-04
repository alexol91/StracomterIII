class_name TestCase
extends RefCounted
## Caso de prueba mínimo. Sin dependencias externas: el proyecto no lleva
## GdUnit4 ni ningún addon, porque la IA y el director están diseñados para
## ser funciones puras y no necesitan un framework para probarse.
##
## Convención: cada método público que empiece por `test_` es una prueba.
## `before_each` / `after_each` se ejecutan alrededor de cada una.

## Fallos acumulados en la prueba en curso. El runner los lee y los limpia.
var failures: Array[String] = []
## Aserciones ejecutadas, para detectar pruebas vacías.
var assertions: int = 0


func before_each() -> void:
	pass


func after_each() -> void:
	pass


func fail(message: String) -> void:
	failures.append(message)


func assert_true(condition: bool, message: String = "") -> void:
	assertions += 1
	if not condition:
		fail("se esperaba true. %s" % message)


func assert_false(condition: bool, message: String = "") -> void:
	assertions += 1
	if condition:
		fail("se esperaba false. %s" % message)


func assert_eq(actual: Variant, expected: Variant, message: String = "") -> void:
	assertions += 1
	if actual != expected:
		fail("se esperaba %s pero se obtuvo %s. %s" % [expected, actual, message])


func assert_ne(actual: Variant, unexpected: Variant, message: String = "") -> void:
	assertions += 1
	if actual == unexpected:
		fail("no se esperaba %s. %s" % [unexpected, message])


func assert_almost_eq(actual: float, expected: float, tolerance: float = 0.0001,
		message: String = "") -> void:
	assertions += 1
	if absf(actual - expected) > tolerance:
		fail("se esperaba %f ± %f pero se obtuvo %f. %s"
			% [expected, tolerance, actual, message])


func assert_gt(actual: float, threshold: float, message: String = "") -> void:
	assertions += 1
	if actual <= threshold:
		fail("se esperaba > %f pero se obtuvo %f. %s" % [threshold, actual, message])


func assert_lt(actual: float, threshold: float, message: String = "") -> void:
	assertions += 1
	if actual >= threshold:
		fail("se esperaba < %f pero se obtuvo %f. %s" % [threshold, actual, message])


func assert_between(actual: float, low: float, high: float, message: String = "") -> void:
	assertions += 1
	if actual < low or actual > high:
		fail("se esperaba dentro de [%f, %f] pero se obtuvo %f. %s"
			% [low, high, actual, message])


func assert_not_null(value: Variant, message: String = "") -> void:
	assertions += 1
	if value == null:
		fail("se esperaba un valor no nulo. %s" % message)


func assert_null(value: Variant, message: String = "") -> void:
	assertions += 1
	if value != null:
		fail("se esperaba null pero se obtuvo %s. %s" % [value, message])


func assert_has(collection: Variant, element: Variant, message: String = "") -> void:
	assertions += 1
	var contained := false
	if collection is Array:
		contained = (collection as Array).has(element)
	elif collection is Dictionary:
		contained = (collection as Dictionary).has(element)
	if not contained:
		fail("se esperaba que contuviera %s. %s" % [element, message])


func assert_size(collection: Variant, expected: int, message: String = "") -> void:
	assertions += 1
	var actual := -1
	if collection is Array:
		actual = (collection as Array).size()
	elif collection is Dictionary:
		actual = (collection as Dictionary).size()
	elif collection is PackedVector3Array:
		actual = (collection as PackedVector3Array).size()
	if actual != expected:
		fail("se esperaban %d elementos pero hay %d. %s" % [expected, actual, message])
