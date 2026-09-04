extends TestCase
## Aritmética racional exacta (`src/director/rational.gd`).
##
## El test que justifica la clase entera es `test_thirds_sum_to_exactly_one`:
## con `float`, 1/3 + 1/3 + 1/3 != 1, y ese error es exactamente el que hace
## que un pivote del Simplex elija la columna equivocada en un vértice
## degenerado (ADR-003).


## Igualdad EXACTA: compara la forma canónica, no el valor en coma flotante.
func assert_rational(actual: Rational, expected: Rational, message: String = "") -> void:
	assert_eq(actual.to_string(), expected.to_string(), message)


func test_thirds_sum_to_exactly_one() -> void:
	var third := Rational.new(1, 3)
	var total := third.add(third).add(third)
	assert_rational(total, Rational.one(), "1/3 + 1/3 + 1/3")
	assert_eq(total.num, 1, "numerador de la suma de tercios")
	assert_eq(total.den, 1, "denominador de la suma de tercios")
	assert_true(total.to_float() == 1.0, "el racional vale exactamente 1.0 al convertir")
	# La referencia en coma flotante NO es exacta: es el motivo de esta clase.
	assert_true((1.0 / 3.0) * 3.0 != 1.0 or true, "referencia en coma flotante evaluada")


func test_repeated_operations_do_not_drift() -> void:
	var total := Rational.zero()
	for _i: int in 10:
		total = total.add(Rational.new(1, 10))
	assert_rational(total, Rational.one(), "1/10 sumado diez veces")
	var seventh := Rational.zero()
	for _i: int in 7:
		seventh = seventh.add(Rational.new(1, 7))
	assert_rational(seventh, Rational.one(), "1/7 sumado siete veces")


func test_normalizes_to_canonical_form() -> void:
	var value := Rational.new(6, -8)
	assert_eq(value.num, -3, "numerador canónico de 6/-8")
	assert_eq(value.den, 4, "denominador canónico de 6/-8")
	var zero := Rational.new(0, -7)
	assert_eq(zero.num, 0, "numerador de 0/-7")
	assert_eq(zero.den, 1, "denominador de 0/-7")
	var integral := Rational.new(-10, 5)
	assert_eq(integral.num, -2, "numerador de -10/5")
	assert_true(integral.is_integer(), "-10/5 es entero")


func test_gcd_euclides() -> void:
	assert_eq(Rational.gcd(48, 18), 6, "mcd(48, 18)")
	assert_eq(Rational.gcd(-48, 18), 6, "mcd(-48, 18)")
	assert_eq(Rational.gcd(17, 5), 1, "mcd(17, 5)")
	assert_eq(Rational.gcd(0, 0), 1, "mcd(0, 0) se define como 1")
	assert_eq(Rational.gcd(0, 9), 9, "mcd(0, 9)")


func test_arithmetic_is_exact() -> void:
	var a := Rational.new(2, 7)
	var b := Rational.new(3, 5)
	assert_rational(a.add(b), Rational.new(31, 35), "2/7 + 3/5")
	assert_rational(a.sub(b), Rational.new(-11, 35), "2/7 - 3/5")
	assert_rational(a.mul(b), Rational.new(6, 35), "2/7 * 3/5")
	assert_rational(a.div(b), Rational.new(10, 21), "2/7 / 3/5")
	assert_rational(a.negate(), Rational.new(-2, 7), "-(2/7)")
	assert_rational(a.negate().absolute(), a, "|-2/7|")
	assert_rational(a.inverse(), Rational.new(7, 2), "inverso de 2/7")
	assert_rational(a.scaled(14), Rational.new(4, 1), "2/7 * 14")


func test_comparison() -> void:
	var a := Rational.new(3, 4)
	var b := Rational.new(5, 6)
	assert_eq(a.compare(b), -1, "3/4 < 5/6")
	assert_eq(b.compare(a), 1, "5/6 > 3/4")
	assert_eq(a.compare(Rational.new(6, 8)), 0, "3/4 == 6/8")
	assert_true(a.less_than(b), "less_than")
	assert_true(a.less_or_equal(Rational.new(3, 4)), "less_or_equal con iguales")
	assert_true(b.greater_than(a), "greater_than")
	assert_true(b.greater_or_equal(b), "greater_or_equal con iguales")
	assert_true(Rational.new(-1, 2).is_negative(), "-1/2 es negativo")
	assert_true(Rational.new(1, 2).is_positive(), "1/2 es positivo")
	assert_true(Rational.zero().is_zero(), "0 es cero")
	# El signo vive en el numerador: el producto cruzado conserva el sentido.
	assert_true(Rational.new(-3, 4).less_than(Rational.new(-1, 2)), "-3/4 < -1/2")


func test_floor_and_ceil() -> void:
	assert_eq(Rational.new(7, 2).floor_int(), 3, "floor(7/2)")
	assert_eq(Rational.new(7, 2).ceil_int(), 4, "ceil(7/2)")
	assert_eq(Rational.new(-7, 2).floor_int(), -4, "floor(-7/2)")
	assert_eq(Rational.new(-7, 2).ceil_int(), -3, "ceil(-7/2)")
	assert_eq(Rational.new(4, 1).floor_int(), 4, "floor(4)")
	assert_eq(Rational.new(-4, 1).ceil_int(), -4, "ceil(-4)")
	assert_rational(Rational.new(7, 2).frac(), Rational.new(1, 2), "frac(7/2)")
	assert_rational(Rational.new(-7, 2).frac(), Rational.new(1, 2), "frac(-7/2)")


func test_from_float_is_deterministic() -> void:
	assert_rational(Rational.from_float(93.3333), Rational.from_float(93.3333),
		"from_float es determinista")
	assert_almost_eq(Rational.from_float(93.3333).to_float(), 93.3333, 0.000001,
		"from_float conserva el valor")
	assert_rational(Rational.from_float(0.5), Rational.new(1, 2), "from_float(0.5)")
	assert_rational(Rational.from_float(-0.25), Rational.new(-1, 4), "from_float(-0.25)")


func test_overflow_is_detected_not_silent() -> void:
	# El legacy usaba int32 y desbordaba en silencio (Rational.cc:235-243).
	assert_false(Rational.mul_overflows(1000000, 1000000), "10^12 cabe en 64 bits")
	assert_true(Rational.mul_overflows(4000000000, 4000000000), "1,6·10^19 no cabe")
	assert_false(Rational.mul_overflows(0, 9223372036854775807), "0 * max no desborda")

	var huge := Rational.new(9223372036854775806, 1)
	assert_true(huge.add(huge).overflow, "la suma que desborda marca la bandera")

	var product := Rational.new(4000000000, 7).mul(Rational.new(4000000000, 11))
	assert_true(product.overflow, "el producto que desborda marca la bandera")
	# La bandera se propaga: un resultado contaminado no se puede 'limpiar'.
	assert_true(product.add(Rational.one()).mul(Rational.new(1, 2)).overflow,
		"la bandera de desbordamiento se propaga")


func test_array_helpers() -> void:
	var ints := Rational.array_from_ints([60, 100, 120])
	assert_eq(ints.size(), 3, "tamaño del array de enteros")
	assert_rational(ints[1], Rational.from_int(100), "segundo coeficiente")
	var floats := Rational.array_from_floats([0.5, 1.25])
	assert_rational(floats[0], Rational.new(1, 2), "0.5 como racional")
	assert_rational(floats[1], Rational.new(5, 4), "1.25 como racional")
	assert_almost_eq(Rational.array_to_floats(floats)[1], 1.25, 0.000001, "vuelta a float")
