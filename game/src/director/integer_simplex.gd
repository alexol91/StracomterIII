class_name IntegerSimplex
extends RefCounted
## Ramificación y acotación sobre [Simplex], con racionales exactos.
##
## El original (`legacy/trunk/Optimization/lib/Simplex.cc:696-752`) hacía esto
## mismo con tres defectos que aquí se corrigen:
##
## | Legacy | Aquí | Por qué importa |
## |---|---|---|
## | Cola FIFO de nodos | **Mejor-primero por cota** | FIFO explora ramas malas antes que buenas; con 30 nodos de tope, eso significa devolver una solución peor por agotamiento |
## | Tope fijo de 30 iteraciones | Tope configurable, y el estado dice si se agotó | Un tope silencioso convierte "no me ha dado tiempo" en "este es el óptimo" |
## | Poda por `Z <= nodo->Z` con `floor(Z_LP)` de la raíz | Poda exacta contra la mejor solución entera conocida | La poda del legacy podía **descartar el óptimo**: comparaba contra la cota de la raíz, no contra el incumbente |
## | Ramificación por la primera variable fraccionaria | Variable **más fraccionaria**, desempate por índice | Menos nodos para la misma respuesta, y sigue siendo determinista |
##
## Se conserva del legacy la idea de la RESERVA: si no hay solución entera
## demostrada, se devuelve algo utilizable en lugar de una planta vacía. Aquí
## la reserva es el redondeo determinista a la baja de la relajación, y el
## estado lo declara (`FALLBACK_ROUNDED`), en vez de confundirse con un óptimo.

enum Status {
	NOT_SOLVED,
	## Óptimo entero demostrado.
	OPTIMAL,
	## No existe ningún punto entero factible.
	INFEASIBLE,
	## La relajación continua no está acotada.
	UNBOUNDED,
	## Se agotó el tope de nodos. Hay solución (la mejor encontrada), pero no
	## está demostrado que sea la óptima.
	NODE_LIMIT,
	## Se agotó el tope de nodos sin ninguna solución entera; se devuelve el
	## redondeo determinista de la relajación, que sí es factible.
	FALLBACK_ROUNDED,
	## Desbordamiento numérico en algún nodo.
	NUMERIC_OVERFLOW,
}

## Valor de `upper` que significa "sin cota superior".
const NO_UPPER_BOUND: int = -1
## Tope de nodos por defecto. No es una constante de balanceo: acota el coste
## del solucionador, no el juego. Con 3 arquetipos sobra de largo.
const DEFAULT_MAX_NODES: int = 512

## Un nodo del árbol de ramificación, ya resuelto en su relajación continua.
class BranchNode:
	extends RefCounted

	var lower: PackedInt64Array = PackedInt64Array()
	var upper: PackedInt64Array = PackedInt64Array()
	## Valor de la relajación: cota superior (maximizando) de todo lo que
	## cuelga de este nodo.
	var bound: Rational = null
	var relaxed: Array[Rational] = []
	## Orden de creación. Desempata la cola sin recurrir al azar.
	var sequence: int = 0

	func _init(p_lower: PackedInt64Array, p_upper: PackedInt64Array, p_sequence: int) -> void:
		lower = p_lower
		upper = p_upper
		sequence = p_sequence


var variable_count: int = 0
var max_nodes: int = DEFAULT_MAX_NODES

var _objective: Array[Rational] = []
var _maximize: bool = true
var _constraints: Array[Simplex.Constraint] = []
var _lower: PackedInt64Array = PackedInt64Array()
var _upper: PackedInt64Array = PackedInt64Array()
var _is_integer: Array[bool] = []

var _status: Status = Status.NOT_SOLVED
var _solution: Array[Rational] = []
var _objective_value: Rational = null
var _nodes_explored: int = 0
var _sequence: int = 0
## Estado del último LP resuelto. Sirve para distinguir por qué murió la raíz.
var _last_lp_status: Status = Status.NOT_SOLVED


func _init(p_variable_count: int) -> void:
	variable_count = maxi(p_variable_count, 0)
	_objective = []
	_lower = PackedInt64Array()
	_upper = PackedInt64Array()
	_is_integer = []
	for _i: int in variable_count:
		_objective.append(Rational.zero())
		_lower.append(0)
		_upper.append(NO_UPPER_BOUND)
		_is_integer.append(true)
	_objective_value = Rational.zero()


# ---- Declaración del problema ----

func set_objective(coefficients: Array[Rational], maximize: bool) -> void:
	_objective = _fit(coefficients)
	_maximize = maximize


func set_objective_ints(coefficients: Array[int], maximize: bool) -> void:
	set_objective(Rational.array_from_ints(coefficients), maximize)


func add_constraint(coefficients: Array[Rational], relation: Simplex.Relation, rhs: Rational) -> void:
	_constraints.append(Simplex.Constraint.new(_fit(coefficients), relation, rhs))


func add_constraint_ints(coefficients: Array[int], relation: Simplex.Relation, rhs: int) -> void:
	add_constraint(Rational.array_from_ints(coefficients), relation, Rational.from_int(rhs))


## Cotas por variable. `upper = NO_UPPER_BOUND` deja la variable sin techo.
func set_bounds(index: int, lower: int, upper: int) -> void:
	if index < 0 or index >= variable_count:
		push_error("IntegerSimplex.set_bounds: índice %d fuera de rango." % index)
		return
	_lower[index] = maxi(lower, 0)
	_upper[index] = upper


## Marca una variable como continua. Por defecto todas son enteras; las
## variables de desviación de la formulación nueva no lo son.
func set_integer(index: int, is_integer: bool) -> void:
	if index < 0 or index >= variable_count:
		push_error("IntegerSimplex.set_integer: índice %d fuera de rango." % index)
		return
	_is_integer[index] = is_integer


# ---- Resolución ----

func solve() -> Status:
	_nodes_explored = 0
	_sequence = 0
	_solution = []
	_objective_value = Rational.zero()

	var root := _make_node(_lower.duplicate(), _upper.duplicate())
	if root == null:
		# La raíz no es factible o no está acotada: el estado del LP lo dice.
		_status = _last_lp_status
		return _status

	var open: Array[BranchNode] = [root]
	var incumbent: Array[Rational] = []
	var incumbent_value: Rational = null
	var exhausted := false

	while not open.is_empty():
		if _nodes_explored >= max_nodes:
			exhausted = true
			break
		var index := _pick_best(open)
		var node: BranchNode = open[index]
		open.remove_at(index)
		_nodes_explored += 1

		# Poda: si ni la relajación mejora al incumbente, la rama entera sobra.
		if incumbent_value != null and not _is_better(node.bound, incumbent_value):
			continue

		var fractional := _pick_branching_variable(node.relaxed)
		if fractional < 0:
			if incumbent_value == null or _is_better(node.bound, incumbent_value):
				incumbent = node.relaxed
				incumbent_value = node.bound
			continue

		var value := node.relaxed[fractional]
		var floor_value := value.floor_int()

		var down_upper := node.upper.duplicate()
		down_upper[fractional] = floor_value
		var down := _make_node(node.lower.duplicate(), down_upper)
		if down != null and (incumbent_value == null or _is_better(down.bound, incumbent_value)):
			open.append(down)

		var up_lower := node.lower.duplicate()
		up_lower[fractional] = floor_value + 1
		# Si la cota superior del nodo ya es menor, la rama es vacía: el LP
		# saldrá infactible y `_make_node` devolverá null.
		var up := _make_node(up_lower, node.upper.duplicate())
		if up != null and (incumbent_value == null or _is_better(up.bound, incumbent_value)):
			open.append(up)

	if incumbent_value != null:
		_solution = incumbent
		_objective_value = incumbent_value
		_status = Status.NODE_LIMIT if exhausted else Status.OPTIMAL
		return _status

	if not exhausted:
		_status = Status.INFEASIBLE
		return _status

	# Reserva: redondeo determinista a la baja de la relajación de la raíz.
	var rounded := _round_down(root.relaxed)
	if _is_feasible(rounded):
		_solution = rounded
		_objective_value = _evaluate(rounded)
		_status = Status.FALLBACK_ROUNDED
		return _status
	_status = Status.NODE_LIMIT
	return _status


func get_status() -> Status:
	return _status


## Solución como enteros. Las variables continuas se truncan; quien las
## necesite exactas debe leer `get_solution_rationals`.
func get_solution_ints() -> Array[int]:
	var out: Array[int] = []
	for value: Rational in _solution:
		out.append(value.floor_int())
	return out


func get_solution_rationals() -> Array[Rational]:
	return _solution


func get_objective_value() -> Rational:
	return _objective_value


func nodes_explored() -> int:
	return _nodes_explored


## ¿Hay una solución utilizable, esté o no demostrada como óptima?
func has_solution() -> bool:
	return not _solution.is_empty()


static func status_name(status: Status) -> String:
	return Status.keys()[int(status)]


# ---- Interno ----

## Resuelve la relajación continua de un nodo. Devuelve null si el nodo es
## infactible (rama muerta) o si el LP no da un óptimo utilizable.
func _make_node(lower: PackedInt64Array, upper: PackedInt64Array) -> BranchNode:
	var lp := Simplex.new(variable_count)
	lp.set_objective(_objective, _maximize)
	for constraint: Simplex.Constraint in _constraints:
		lp.add_constraint(constraint.coefficients, constraint.relation, constraint.rhs)
	for index: int in variable_count:
		if lower[index] > 0:
			lp.add_constraint(_unit_vector(index), Simplex.Relation.GREATER_EQUAL,
				Rational.from_int(lower[index]))
		if upper[index] != NO_UPPER_BOUND:
			lp.add_constraint(_unit_vector(index), Simplex.Relation.LESS_EQUAL,
				Rational.from_int(upper[index]))
	var status := lp.solve()
	_last_lp_status = _translate(status)
	if status != Simplex.Status.OPTIMAL:
		return null
	var node := BranchNode.new(lower, upper, _sequence)
	_sequence += 1
	node.relaxed = lp.get_solution()
	node.bound = lp.get_objective_value()
	return node


static func _translate(status: Simplex.Status) -> Status:
	match status:
		Simplex.Status.INFEASIBLE:
			return Status.INFEASIBLE
		Simplex.Status.UNBOUNDED:
			return Status.UNBOUNDED
		Simplex.Status.NUMERIC_OVERFLOW:
			return Status.NUMERIC_OVERFLOW
		Simplex.Status.OPTIMAL:
			return Status.OPTIMAL
		_:
			return Status.NODE_LIMIT


## Mejor-primero: el nodo con la cota más prometedora. Empate por orden de
## creación, para que dos ejecuciones idénticas exploren el mismo árbol.
func _pick_best(open: Array[BranchNode]) -> int:
	var best: int = 0
	for index: int in range(1, open.size()):
		var comparison := open[index].bound.compare(open[best].bound)
		if comparison == 0:
			if open[index].sequence < open[best].sequence:
				best = index
			continue
		if _maximize and comparison > 0:
			best = index
		elif not _maximize and comparison < 0:
			best = index
	return best


## Variable entera más fraccionaria (la más cercana a x,5). Desempate por
## índice menor: mismo árbol en cada ejecución.
func _pick_branching_variable(values: Array[Rational]) -> int:
	var chosen: int = -1
	var best_distance: Rational = null
	var half := Rational.new(1, 2)
	for index: int in variable_count:
		if not _is_integer[index]:
			continue
		var fraction := values[index].frac()
		if fraction.is_zero():
			continue
		var distance := fraction.sub(half).absolute()
		if best_distance == null or distance.less_than(best_distance):
			best_distance = distance
			chosen = index
	return chosen


func _is_better(candidate: Rational, reference: Rational) -> bool:
	var comparison := candidate.compare(reference)
	return comparison > 0 if _maximize else comparison < 0


func _round_down(values: Array[Rational]) -> Array[Rational]:
	var out: Array[Rational] = []
	for index: int in variable_count:
		if not _is_integer[index]:
			out.append(values[index])
			continue
		out.append(Rational.from_int(maxi(values[index].floor_int(), _lower[index])))
	return out


func _is_feasible(values: Array[Rational]) -> bool:
	for index: int in variable_count:
		if values[index].is_negative():
			return false
		if values[index].less_than(Rational.from_int(_lower[index])):
			return false
		if _upper[index] != NO_UPPER_BOUND and values[index].greater_than(Rational.from_int(_upper[index])):
			return false
	for constraint: Simplex.Constraint in _constraints:
		var total := Rational.zero()
		for index: int in variable_count:
			total = total.add(constraint.coefficients[index].mul(values[index]))
		match constraint.relation:
			Simplex.Relation.LESS_EQUAL:
				if total.greater_than(constraint.rhs):
					return false
			Simplex.Relation.GREATER_EQUAL:
				if total.less_than(constraint.rhs):
					return false
			Simplex.Relation.EQUAL:
				if not total.equals(constraint.rhs):
					return false
	return true


func _evaluate(values: Array[Rational]) -> Rational:
	var total := Rational.zero()
	for index: int in variable_count:
		total = total.add(_objective[index].mul(values[index]))
	return total


func _unit_vector(index: int) -> Array[Rational]:
	var out: Array[Rational] = []
	for column: int in variable_count:
		out.append(Rational.one() if column == index else Rational.zero())
	return out


func _fit(coefficients: Array[Rational]) -> Array[Rational]:
	var out: Array[Rational] = []
	for column: int in variable_count:
		out.append(coefficients[column] if column < coefficients.size() else Rational.zero())
	return out
