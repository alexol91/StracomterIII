class_name Rational
extends RefCounted
## Número racional exacto `num / den` sobre enteros de 64 bits.
##
## Por qué existe (ADR-003): el Simplex del director pivota sobre estos
## números. Con coma flotante, el pivote degenera y cicla justo en los casos
## límite —presupuestos ajustados, vértices degenerados— que son precisamente
## los que decide el director. Un solucionador exacto es además un
## solucionador determinista, y eso es lo que hace que un fallo de balanceo
## sea reproducible en un test.
##
## Diferencia con el original (`legacy/trunk/Math/lib/Rational.cc`): aquél
## usaba `int` de 32 bits, calculaba el MCD por fuerza bruta O(max) y
## desbordaba EN SILENCIO al multiplicar numeradores grandes. Aquí el MCD es
## Euclides y todo desbordamiento se detecta y se propaga en `overflow`.

## Mayor valor representable en un entero de 64 bits con signo.
const INT64_MAX: int = 9223372036854775807
## Cota por debajo de la cual dos factores nunca desbordan: floor(sqrt(2^63-1)).
const SAFE_FACTOR_LIMIT: int = 3037000499
## Denominador por defecto al convertir desde coma flotante. Determinista:
## el mismo `float` produce siempre el mismo racional.
const DEFAULT_FLOAT_SCALE: int = 1000000

## Numerador. Lleva el signo (invariante de forma canónica).
var num: int = 0
## Denominador. Siempre > 0 tras normalizar.
var den: int = 1
## Se pone a `true` en cuanto una operación desborda o se divide por cero, y
## se propaga a todo resultado derivado. El valor numérico deja de ser fiable;
## quien lo consume debe abortar, no redondear.
var overflow: bool = false


func _init(numerator: int = 0, denominator: int = 1) -> void:
	num = numerator
	den = denominator
	if denominator == 0:
		push_error("Rational: denominador cero (%d/0)." % numerator)
		num = 0
		den = 1
		overflow = true
		return
	_normalize()


# ---- Construcción ----

static func zero() -> Rational:
	return Rational.new(0, 1)


static func one() -> Rational:
	return Rational.new(1, 1)


static func from_int(value: int) -> Rational:
	return Rational.new(value, 1)


## Convierte un `float` a racional con un denominador fijo. Determinista y
## reproducible: es la única puerta de entrada de los datos de balanceo
## (que son `float` en los `.tres`) al mundo exacto del Simplex.
static func from_float(value: float, scale: int = DEFAULT_FLOAT_SCALE) -> Rational:
	if scale <= 0:
		push_error("Rational.from_float: escala inválida %d." % scale)
		return Rational.zero()
	return Rational.new(roundi(value * float(scale)), scale)


static func array_from_ints(values: Array[int]) -> Array[Rational]:
	var out: Array[Rational] = []
	for v: int in values:
		out.append(Rational.from_int(v))
	return out


static func array_from_floats(values: Array[float], scale: int = DEFAULT_FLOAT_SCALE) -> Array[Rational]:
	var out: Array[Rational] = []
	for v: float in values:
		out.append(Rational.from_float(v, scale))
	return out


static func array_to_floats(values: Array[Rational]) -> Array[float]:
	var out: Array[float] = []
	for v: Rational in values:
		out.append(v.to_float())
	return out


func duplicate_value() -> Rational:
	var copy := Rational.new(num, den)
	copy.overflow = overflow
	return copy


# ---- Aritmética ----

func add(other: Rational) -> Rational:
	var g: int = gcd(den, other.den)
	var mine: int = _idiv(other.den, g)
	var theirs: int = _idiv(den, g)
	var flag: bool = overflow or other.overflow
	flag = flag or mul_overflows(num, mine) or mul_overflows(other.num, theirs)
	var left: int = num * mine
	var right: int = other.num * theirs
	var n: int = left + right
	flag = flag or add_overflows(left, right, n)
	flag = flag or mul_overflows(den, mine)
	var d: int = den * mine
	return _make(n, d, flag)


func sub(other: Rational) -> Rational:
	return add(other.negate())


func mul(other: Rational) -> Rational:
	# Reducción cruzada antes de multiplicar: mantiene los factores pequeños,
	# que es la mitad de la defensa contra el desbordamiento.
	var g1: int = gcd(num, other.den)
	var g2: int = gcd(den, other.num)
	var a: int = _idiv(num, g1)
	var b: int = _idiv(other.num, g2)
	var c: int = _idiv(den, g2)
	var d: int = _idiv(other.den, g1)
	var flag: bool = overflow or other.overflow
	flag = flag or mul_overflows(a, b) or mul_overflows(c, d)
	return _make(a * b, c * d, flag)


func div(other: Rational) -> Rational:
	if other.num == 0:
		push_error("Rational.div: división por cero.")
		var bad := Rational.zero()
		bad.overflow = true
		return bad
	return mul(other.inverse())


func inverse() -> Rational:
	if num == 0:
		push_error("Rational.inverse: 0 no tiene inverso.")
		var bad := Rational.zero()
		bad.overflow = true
		return bad
	return _make(den, num, overflow)


func negate() -> Rational:
	return _make(-num, den, overflow)


func absolute() -> Rational:
	return _make(absi(num), den, overflow)


## Multiplica por un entero sin pasar por un `Rational` intermedio.
func scaled(factor: int) -> Rational:
	var g: int = gcd(den, factor)
	var f: int = _idiv(factor, g)
	var d: int = _idiv(den, g)
	var flag: bool = overflow or mul_overflows(num, f)
	return _make(num * f, d, flag)


# ---- Comparación ----

## −1 si `self < other`, 0 si iguales, 1 si mayor.
func compare(other: Rational) -> int:
	# Los denominadores son positivos por invariante, así que el producto
	# cruzado conserva el sentido de la desigualdad.
	var g: int = gcd(den, other.den)
	var left: int = num * _idiv(other.den, g)
	var right: int = other.num * _idiv(den, g)
	if left < right:
		return -1
	if left > right:
		return 1
	return 0


func equals(other: Rational) -> bool:
	return num == other.num and den == other.den


func less_than(other: Rational) -> bool:
	return compare(other) < 0


func less_or_equal(other: Rational) -> bool:
	return compare(other) <= 0


func greater_than(other: Rational) -> bool:
	return compare(other) > 0


func greater_or_equal(other: Rational) -> bool:
	return compare(other) >= 0


func is_zero() -> bool:
	return num == 0


func is_positive() -> bool:
	return num > 0


func is_negative() -> bool:
	return num < 0


func is_integer() -> bool:
	return den == 1


# ---- Conversión ----

func to_float() -> float:
	return float(num) / float(den)


func floor_int() -> int:
	if num >= 0:
		return _idiv(num, den)
	return -_idiv(-num + den - 1, den)


func ceil_int() -> int:
	return -negate().floor_int()


## Parte fraccionaria `self − floor(self)`, siempre en [0, 1).
func frac() -> Rational:
	return sub(Rational.from_int(floor_int()))


func _to_string() -> String:
	var text := "%d/%d" % [num, den] if den != 1 else str(num)
	return text + ("!" if overflow else "")


# ---- Utilidades numéricas ----

## Máximo común divisor por Euclides. El legacy iteraba desde 1 hasta el
## menor de los dos operandos (`Rational.cc:316-345`): O(max) en cada
## operación, lo que hacía que el coste explotase con numeradores grandes.
static func gcd(a: int, b: int) -> int:
	var x: int = absi(a)
	var y: int = absi(b)
	while y != 0:
		var t: int = y
		y = x % y
		x = t
	return x if x != 0 else 1


## ¿Desborda `a * b` en 64 bits?
static func mul_overflows(a: int, b: int) -> bool:
	if a == 0 or b == 0:
		return false
	if absi(a) <= SAFE_FACTOR_LIMIT and absi(b) <= SAFE_FACTOR_LIMIT:
		return false
	var product: int = a * b
	return _idiv(product, a) != b


## ¿Desborda `a + b`, siendo `sum` el resultado ya calculado?
static func add_overflows(a: int, b: int, sum_value: int) -> bool:
	if a > 0 and b > 0:
		return sum_value < 0
	if a < 0 and b < 0:
		return sum_value >= 0
	return false


static func _idiv(a: int, b: int) -> int:
	@warning_ignore("integer_division")
	var quotient: int = a / b
	return quotient


static func _make(n: int, d: int, flag: bool) -> Rational:
	if d == 0:
		var bad := Rational.zero()
		bad.overflow = true
		return bad
	var value := Rational.new(n, d)
	value.overflow = value.overflow or flag
	return value


func _normalize() -> void:
	if den < 0:
		num = -num
		den = -den
	if num == 0:
		den = 1
		return
	var g: int = gcd(num, den)
	if g > 1:
		num = _idiv(num, g)
		den = _idiv(den, g)
