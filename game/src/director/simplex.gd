class_name Simplex
extends RefCounted
## Simplex de DOS FASES con aritmética racional exacta (ADR-003).
##
## Qué se conserva del original (`legacy/trunk/Optimization/lib/Simplex.cc`):
## el algoritmo y la aritmética exacta sobre racionales.
##
## Qué se corrige, y por qué:
##
## * **Fase I en lugar de Big-M.** El legacy penalizaba las variables
##   artificiales con `M = 999999` (`Simplex.cc:515`). Con aritmética exacta
##   no hace falta ninguna M: la fase I minimiza la suma de artificiales y
##   decide la factibilidad sin mezclar escalas en la misma función objetivo,
##   que es lo que hace frágil a Big-M.
## * **Regla de Bland.** El legacy entraba por Dantzig (mayor `Zj−Cj`,
##   `Simplex.cc:439-450`) y salía por razón mínima inicializada a `min = 99`
##   (`Simplex.cc:426`): con presupuestos grandes ninguna razón se elegía, la
##   base no cambiaba y el bucle NO TERMINABA. Bland garantiza terminación
##   finita incluso en vértices degenerados, que es justo donde vive el
##   problema del director (los tres presupuestos se saturan a la vez).
## * **Desbordamiento detectado.** `Rational` propaga la bandera; si el
##   tablero se contamina, el estado es `NUMERIC_OVERFLOW` y no una respuesta
##   plausible pero falsa.
##
## Uso:
## [codeblock]
## var lp := Simplex.new(3)
## lp.set_objective(Rational.array_from_ints([1, 1, 1]), true)
## lp.add_constraint(Rational.array_from_ints([60, 100, 120]),
##     Simplex.Relation.LESS_EQUAL, Rational.from_int(2790))
## if lp.solve() == Simplex.Status.OPTIMAL:
##     var x := lp.get_solution()
## [/codeblock]

enum Relation {
	LESS_EQUAL,
	GREATER_EQUAL,
	EQUAL,
}

enum Status {
	NOT_SOLVED,
	OPTIMAL,
	INFEASIBLE,
	UNBOUNDED,
	## Se agotó el tope de pivotes. Con Bland no debería ocurrir nunca; si
	## ocurre, es un fallo del solucionador y no una propiedad del problema.
	ITERATION_LIMIT,
	## Algún racional del tablero desbordó los 64 bits. El resultado se
	## descarta: el legacy, con int32, devolvía basura sin avisar.
	NUMERIC_OVERFLOW,
}

## Restricción tal y como la declara quien plantea el problema.
class Constraint:
	extends RefCounted

	var coefficients: Array[Rational] = []
	var relation: Relation = Relation.LESS_EQUAL
	var rhs: Rational = null

	func _init(p_coefficients: Array[Rational], p_relation: Relation, p_rhs: Rational) -> void:
		coefficients = p_coefficients
		relation = p_relation
		rhs = p_rhs


## Margen de pivotes por encima del cual se considera que el solucionador se
## ha ido de las manos. No es una constante de balanceo: es un cinturón de
## seguridad sobre una garantía teórica (Bland termina).
const ITERATION_MARGIN: int = 500
const ITERATIONS_PER_DIMENSION: int = 20

var variable_count: int = 0

var _objective: Array[Rational] = []
var _maximize: bool = true
var _constraints: Array[Constraint] = []

var _status: Status = Status.NOT_SOLVED
var _solution: Array[Rational] = []
var _objective_value: Rational = null
var _iterations: int = 0

# Tablero plano: fila `i`, columna `j` -> `_tableau[i * _stride + j]`.
# Plano y no anidado a propósito: un `Array[Array]` devuelve Variant al
# indexar y el proyecto trata los accesos sin tipo como avisos.
var _tableau: Array[Rational] = []
var _stride: int = 0
var _row_count: int = 0
var _column_count: int = 0
var _basis: PackedInt64Array = PackedInt64Array()
var _artificial_start: int = 0
var _overflowed: bool = false


func _init(p_variable_count: int) -> void:
	variable_count = maxi(p_variable_count, 0)
	_objective = []
	for _i: int in variable_count:
		_objective.append(Rational.zero())
	_objective_value = Rational.zero()


# ---- Declaración del problema ----

## Función objetivo. `maximize = false` minimiza.
func set_objective(coefficients: Array[Rational], maximize: bool) -> void:
	_objective = _fit(coefficients)
	_maximize = maximize
	_status = Status.NOT_SOLVED


func set_objective_ints(coefficients: Array[int], maximize: bool) -> void:
	set_objective(Rational.array_from_ints(coefficients), maximize)


func add_constraint(coefficients: Array[Rational], relation: Relation, rhs: Rational) -> void:
	_constraints.append(Constraint.new(_fit(coefficients), relation, rhs))
	_status = Status.NOT_SOLVED


func add_constraint_ints(coefficients: Array[int], relation: Relation, rhs: int) -> void:
	add_constraint(Rational.array_from_ints(coefficients), relation, Rational.from_int(rhs))


## Traduce `"<="`, `">="`, `"="` a la relación correspondiente.
static func relation_from_string(text: String) -> Relation:
	match text.strip_edges():
		"<=", "=<":
			return Relation.LESS_EQUAL
		">=", "=>":
			return Relation.GREATER_EQUAL
		"=", "==":
			return Relation.EQUAL
		_:
			push_error("Simplex: relación desconocida '%s'." % text)
			return Relation.LESS_EQUAL


func constraint_count() -> int:
	return _constraints.size()


# ---- Resolución ----

func solve() -> Status:
	_overflowed = false
	_iterations = 0
	_solution = []
	_objective_value = Rational.zero()
	_build_tableau()

	var phase_one := _solve_phase_one()
	if phase_one != Status.OPTIMAL:
		_status = phase_one
		return _status
	if not _phase_one_value().is_zero():
		_status = Status.INFEASIBLE
		return _status
	_drive_artificials_out()

	var phase_two := _solve_phase_two()
	if phase_two != Status.OPTIMAL:
		_status = phase_two
		return _status

	_extract_solution()
	if _overflowed:
		_status = Status.NUMERIC_OVERFLOW
		return _status
	_status = Status.OPTIMAL
	return _status


func get_status() -> Status:
	return _status


## Valores de las variables estructurales. Vacío si no hay solución.
func get_solution() -> Array[Rational]:
	return _solution


func get_solution_floats() -> Array[float]:
	return Rational.array_to_floats(_solution)


## Valor de la función objetivo TAL Y COMO SE DECLARÓ (sin invertir signos).
func get_objective_value() -> Rational:
	return _objective_value


func iterations() -> int:
	return _iterations


static func status_name(status: Status) -> String:
	return Status.keys()[int(status)]


# ---- Construcción del tablero ----

func _build_tableau() -> void:
	var row_total := _constraints.size()
	var slack_total: int = 0
	var artificial_total: int = 0
	var normalized: Array[Constraint] = []

	for constraint: Constraint in _constraints:
		var coefficients := constraint.coefficients
		var relation := constraint.relation
		var rhs := constraint.rhs
		# El lado derecho debe ser >= 0 para que la base inicial sea factible.
		if rhs.is_negative():
			var flipped: Array[Rational] = []
			for value: Rational in coefficients:
				flipped.append(value.negate())
			coefficients = flipped
			rhs = rhs.negate()
			if relation == Relation.LESS_EQUAL:
				relation = Relation.GREATER_EQUAL
			elif relation == Relation.GREATER_EQUAL:
				relation = Relation.LESS_EQUAL
		normalized.append(Constraint.new(coefficients, relation, rhs))
		match relation:
			Relation.LESS_EQUAL:
				slack_total += 1
			Relation.GREATER_EQUAL:
				slack_total += 1
				artificial_total += 1
			Relation.EQUAL:
				artificial_total += 1

	_artificial_start = variable_count + slack_total
	_column_count = _artificial_start + artificial_total
	_stride = _column_count + 1
	_row_count = row_total
	_basis = PackedInt64Array()
	_basis.resize(row_total)

	_tableau = []
	_tableau.resize((row_total + 1) * _stride)
	for i: int in _tableau.size():
		_tableau[i] = Rational.zero()

	var slack_cursor := variable_count
	var artificial_cursor := _artificial_start
	for row: int in row_total:
		var constraint := normalized[row]
		for column: int in variable_count:
			_put(row, column, constraint.coefficients[column])
		_put(row, _column_count, constraint.rhs)
		match constraint.relation:
			Relation.LESS_EQUAL:
				_put(row, slack_cursor, Rational.one())
				_basis[row] = slack_cursor
				slack_cursor += 1
			Relation.GREATER_EQUAL:
				_put(row, slack_cursor, Rational.from_int(-1))
				slack_cursor += 1
				_put(row, artificial_cursor, Rational.one())
				_basis[row] = artificial_cursor
				artificial_cursor += 1
			Relation.EQUAL:
				_put(row, artificial_cursor, Rational.one())
				_basis[row] = artificial_cursor
				artificial_cursor += 1


# ---- Fases ----

func _solve_phase_one() -> Status:
	if _artificial_start >= _column_count:
		# Sin variables artificiales la base de holguras ya es factible.
		return Status.OPTIMAL
	var cost: Array[Rational] = []
	for column: int in _column_count:
		cost.append(Rational.one() if column >= _artificial_start else Rational.zero())
	_set_cost_row(cost)
	var forbidden: Array[bool] = []
	forbidden.resize(_column_count)
	forbidden.fill(false)
	return _pivot_loop(forbidden)


func _phase_one_value() -> Rational:
	if _artificial_start >= _column_count:
		return Rational.zero()
	return _cell(_row_count, _column_count).negate()


## Saca de la base las variables artificiales que hayan quedado en ella con
## valor 0. Si la fila no tiene ningún coeficiente no nulo en las columnas
## reales, la restricción era redundante y se deja: su artificial vale 0 y su
## columna queda prohibida, así que no puede volver a entrar ni salir.
func _drive_artificials_out() -> void:
	for row: int in _row_count:
		if _basis[row] < _artificial_start:
			continue
		for column: int in _artificial_start:
			if not _cell(row, column).is_zero():
				_pivot(row, column)
				break


func _solve_phase_two() -> Status:
	var cost: Array[Rational] = []
	for column: int in _column_count:
		if column < variable_count:
			# Internamente siempre se MINIMIZA; maximizar es minimizar −c.
			cost.append(_objective[column].negate() if _maximize else _objective[column])
		else:
			cost.append(Rational.zero())
	_set_cost_row(cost)
	var forbidden: Array[bool] = []
	forbidden.resize(_column_count)
	forbidden.fill(false)
	for column: int in range(_artificial_start, _column_count):
		forbidden[column] = true
	return _pivot_loop(forbidden)


# ---- Núcleo del Simplex ----

## Escribe la fila de costes reducidos `c_j − z_j` para la base actual.
func _set_cost_row(cost: Array[Rational]) -> void:
	for column: int in _column_count:
		_put(_row_count, column, cost[column])
	_put(_row_count, _column_count, Rational.zero())
	for row: int in _row_count:
		var basic_cost := cost[_basis[row]]
		if basic_cost.is_zero():
			continue
		for column: int in _stride:
			_put(_row_count, column, _cell(_row_count, column).sub(basic_cost.mul(_cell(row, column))))


func _pivot_loop(forbidden: Array[bool]) -> Status:
	var limit := ITERATION_MARGIN + ITERATIONS_PER_DIMENSION * (_row_count + _column_count)
	var guard: int = 0
	while guard < limit:
		guard += 1
		_iterations += 1
		# REGLA DE BLAND: entra la columna admisible de MENOR ÍNDICE con
		# coste reducido negativo. Es lo que impide ciclar en degenerados.
		var entering: int = -1
		for column: int in _column_count:
			if forbidden[column]:
				continue
			if _cell(_row_count, column).is_negative():
				entering = column
				break
		if entering < 0:
			return Status.OPTIMAL

		var leaving: int = -1
		var best_ratio: Rational = null
		for row: int in _row_count:
			var pivot_value := _cell(row, entering)
			if not pivot_value.is_positive():
				continue
			var ratio := _cell(row, _column_count).div(pivot_value)
			if best_ratio == null:
				best_ratio = ratio
				leaving = row
				continue
			var comparison := ratio.compare(best_ratio)
			# Empate de razón mínima: sale la variable básica de menor índice
			# (segunda mitad de la regla de Bland).
			if comparison < 0 or (comparison == 0 and _basis[row] < _basis[leaving]):
				best_ratio = ratio
				leaving = row
		if leaving < 0:
			return Status.UNBOUNDED

		_pivot(leaving, entering)
		if _overflowed:
			return Status.NUMERIC_OVERFLOW
	return Status.ITERATION_LIMIT


func _pivot(row: int, column: int) -> void:
	var pivot_value := _cell(row, column)
	for j: int in _stride:
		_put(row, j, _cell(row, j).div(pivot_value))
	for i: int in _row_count + 1:
		if i == row:
			continue
		var factor := _cell(i, column)
		if factor.is_zero():
			continue
		for j: int in _stride:
			_put(i, j, _cell(i, j).sub(factor.mul(_cell(row, j))))
	_basis[row] = column


func _extract_solution() -> void:
	_solution = []
	for _i: int in variable_count:
		_solution.append(Rational.zero())
	for row: int in _row_count:
		var basic := _basis[row]
		if basic < variable_count:
			_solution[basic] = _cell(row, _column_count)
	# El valor se recalcula sobre la solución, no se lee del tablero: así el
	# signo de una maximización resuelta como minimización no puede colarse.
	var total := Rational.zero()
	for column: int in variable_count:
		total = total.add(_objective[column].mul(_solution[column]))
	_objective_value = total
	if total.overflow:
		_overflowed = true


# ---- Acceso al tablero ----

func _cell(row: int, column: int) -> Rational:
	return _tableau[row * _stride + column]


func _put(row: int, column: int, value: Rational) -> void:
	if value.overflow:
		_overflowed = true
	_tableau[row * _stride + column] = value


## Ajusta un vector de coeficientes al número de variables del problema.
func _fit(coefficients: Array[Rational]) -> Array[Rational]:
	var out: Array[Rational] = []
	for column: int in variable_count:
		out.append(coefficients[column] if column < coefficients.size() else Rational.zero())
	return out
