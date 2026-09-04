extends TestCase
## Ramificación y acotación sobre el Simplex exacto.


func assert_rational(actual: Rational, expected: Rational, message: String = "") -> void:
	assert_eq(actual.to_string(), expected.to_string(), message)


## Mochila entera clásica: max 5x1 + 4x2, 6x1 + 4x2 <= 24, x1 + 2x2 <= 6.
## La relajación da (3, 3/2) con z = 21; el óptimo ENTERO es (4, 0) con z = 20.
## Un solucionador que redondee la relajación devuelve (3, 1) con z = 19 y se
## equivoca: por eso hace falta ramificar.
func test_knapsack_integer_optimum() -> void:
	var problem := IntegerSimplex.new(2)
	problem.set_objective_ints([5, 4], true)
	problem.add_constraint_ints([6, 4], Simplex.Relation.LESS_EQUAL, 24)
	problem.add_constraint_ints([1, 2], Simplex.Relation.LESS_EQUAL, 6)
	assert_eq(IntegerSimplex.status_name(problem.solve()),
		IntegerSimplex.status_name(IntegerSimplex.Status.OPTIMAL), "estado de la mochila")
	assert_eq(problem.get_solution_ints(), [4, 0] as Array[int], "óptimo entero de la mochila")
	assert_rational(problem.get_objective_value(), Rational.from_int(20), "z entero de la mochila")


## Formulación ORIGINAL del juego con MaxEnemies = 30 y los presupuestos
## enteros del legacy: el óptimo entero vale 29 (la relajación vale 355/12).
func test_legacy_formulation_integer_optimum() -> void:
	var problem := IntegerSimplex.new(3)
	problem.set_objective_ints([1, 1, 1], true)
	problem.add_constraint_ints([60, 100, 120], Simplex.Relation.LESS_EQUAL, 2790)
	problem.add_constraint_ints([45, 50, 65], Simplex.Relation.LESS_EQUAL, 1530)
	problem.add_constraint_ints([60, 45, 35], Simplex.Relation.LESS_EQUAL, 1380)
	assert_eq(IntegerSimplex.status_name(problem.solve()),
		IntegerSimplex.status_name(IntegerSimplex.Status.OPTIMAL), "estado de la formulación legacy")
	assert_rational(problem.get_objective_value(), Rational.from_int(29), "Z entero = 29")
	var counts := problem.get_solution_ints()
	assert_eq(counts[0] + counts[1] + counts[2], 29, "la suma de enemigos es 29")


## Las cotas por variable se respetan, y son la pieza que hace que la
## formulación nueva no pueda degenerar.
func test_bounds_are_respected() -> void:
	var problem := IntegerSimplex.new(3)
	problem.set_objective_ints([1, 1, 1], true)
	problem.add_constraint_ints([60, 100, 120], Simplex.Relation.LESS_EQUAL, 2790)
	problem.add_constraint_ints([45, 50, 65], Simplex.Relation.LESS_EQUAL, 1530)
	problem.add_constraint_ints([60, 45, 35], Simplex.Relation.LESS_EQUAL, 1380)
	problem.set_bounds(0, 5, 12)
	problem.set_bounds(1, 4, 10)
	problem.set_bounds(2, 3, 9)
	assert_eq(IntegerSimplex.status_name(problem.solve()),
		IntegerSimplex.status_name(IntegerSimplex.Status.OPTIMAL), "estado con cotas")
	var counts := problem.get_solution_ints()
	assert_between(float(counts[0]), 5.0, 12.0, "x1 dentro de sus cotas")
	assert_between(float(counts[1]), 4.0, 10.0, "x2 dentro de sus cotas")
	assert_between(float(counts[2]), 3.0, 9.0, "x3 dentro de sus cotas")


## LP factible pero SIN puntos enteros: 2x1 + 2x2 = 1 tiene solución continua
## (1/2, 0) y ninguna entera.
func test_integer_infeasible_is_reported() -> void:
	var problem := IntegerSimplex.new(2)
	problem.set_objective_ints([1, 1], true)
	problem.add_constraint_ints([2, 2], Simplex.Relation.EQUAL, 1)
	assert_eq(IntegerSimplex.status_name(problem.solve()),
		IntegerSimplex.status_name(IntegerSimplex.Status.INFEASIBLE), "sin puntos enteros")
	assert_false(problem.has_solution(), "no hay solución que devolver")


## Relajación no acotada.
func test_unbounded_relaxation_is_reported() -> void:
	var problem := IntegerSimplex.new(2)
	problem.set_objective_ints([1, 1], true)
	problem.add_constraint_ints([1, -1], Simplex.Relation.LESS_EQUAL, 1)
	assert_eq(IntegerSimplex.status_name(problem.solve()),
		IntegerSimplex.status_name(IntegerSimplex.Status.UNBOUNDED), "relajación no acotada")


## Con el tope de nodos agotado se devuelve la RESERVA determinista (el
## redondeo a la baja de la relajación), y el estado lo dice. El legacy
## agotaba su tope de 30 nodos y devolvía el resultado como si fuera óptimo.
func test_node_limit_falls_back_to_deterministic_rounding() -> void:
	var problem := IntegerSimplex.new(3)
	problem.max_nodes = 1
	problem.set_objective_ints([1, 1, 1], true)
	problem.add_constraint_ints([60, 100, 120], Simplex.Relation.LESS_EQUAL, 2790)
	problem.add_constraint_ints([45, 50, 65], Simplex.Relation.LESS_EQUAL, 1530)
	problem.add_constraint_ints([60, 45, 35], Simplex.Relation.LESS_EQUAL, 1380)
	var status := problem.solve()
	assert_true(
		status == IntegerSimplex.Status.FALLBACK_ROUNDED or status == IntegerSimplex.Status.NODE_LIMIT,
		"el tope de nodos se declara: %s" % IntegerSimplex.status_name(status)
	)
	assert_true(problem.has_solution(), "la reserva sí devuelve una composición")
	var counts := problem.get_solution_ints()
	# La reserva es FACTIBLE: es la diferencia entre una reserva y un apaño.
	assert_true(60 * counts[0] + 100 * counts[1] + 120 * counts[2] <= 2790, "reserva dentro del daño")
	assert_true(45 * counts[0] + 50 * counts[1] + 65 * counts[2] <= 1530, "reserva dentro de la vida")
	assert_true(60 * counts[0] + 45 * counts[1] + 35 * counts[2] <= 1380, "reserva dentro de la velocidad")


## Variables mixtas: x1 entera, x2 continua.
func test_mixed_integer_and_continuous_variables() -> void:
	var problem := IntegerSimplex.new(2)
	problem.set_objective_ints([1, 1], true)
	problem.set_integer(1, false)
	problem.add_constraint_ints([2, 2], Simplex.Relation.LESS_EQUAL, 5)
	assert_eq(IntegerSimplex.status_name(problem.solve()),
		IntegerSimplex.status_name(IntegerSimplex.Status.OPTIMAL), "estado del problema mixto")
	assert_rational(problem.get_objective_value(), Rational.new(5, 2), "z = 5/2 con x2 continua")
	var values := problem.get_solution_rationals()
	assert_true(values[0].is_integer(), "x1 sale entera")


## Determinismo: cien resoluciones, el mismo árbol y la misma respuesta.
func test_branch_and_bound_is_deterministic() -> void:
	var reference: Array[int] = []
	var reference_nodes: int = 0
	for run: int in 100:
		var problem := IntegerSimplex.new(3)
		problem.set_objective_ints([1, 1, 1], true)
		problem.add_constraint_ints([60, 100, 120], Simplex.Relation.LESS_EQUAL, 2790)
		problem.add_constraint_ints([45, 50, 65], Simplex.Relation.LESS_EQUAL, 1530)
		problem.add_constraint_ints([60, 45, 35], Simplex.Relation.LESS_EQUAL, 1380)
		problem.solve()
		var counts := problem.get_solution_ints()
		if run == 0:
			reference = counts
			reference_nodes = problem.nodes_explored()
		assert_eq(counts, reference, "misma composición en la iteración %d" % run)
		assert_eq(problem.nodes_explored(), reference_nodes, "mismo número de nodos explorados")
