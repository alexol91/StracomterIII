extends TestCase
## Simplex de dos fases contra problemas resueltos A MANO.
##
## Cada caso lleva su solución exacta comprobada fuera del código (vértices
## enumerados con aritmética de fracciones). Incluye los tres casos que
## rompían al solucionador de 2012: vértice degenerado, problema infactible y
## problema no acotado, más el ejemplo de Beale, que hace ciclar a la regla de
## Dantzig que usaba el legacy (`Simplex.cc:439-450`) y que la regla de Bland
## resuelve en un número finito de pivotes.


func assert_rational(actual: Rational, expected: Rational, message: String = "") -> void:
	assert_eq(actual.to_string(), expected.to_string(), message)


func assert_status(actual: Simplex.Status, expected: Simplex.Status, message: String = "") -> void:
	assert_eq(Simplex.status_name(actual), Simplex.status_name(expected), message)


## 1. Manual clásico: max 3x + 5y, x <= 4, 2y <= 12, 3x + 2y <= 18.
## Óptimo en el vértice (2, 6) con z = 36.
func test_classic_textbook_maximum() -> void:
	var lp := Simplex.new(2)
	lp.set_objective_ints([3, 5], true)
	lp.add_constraint_ints([1, 0], Simplex.Relation.LESS_EQUAL, 4)
	lp.add_constraint_ints([0, 2], Simplex.Relation.LESS_EQUAL, 12)
	lp.add_constraint_ints([3, 2], Simplex.Relation.LESS_EQUAL, 18)
	assert_status(lp.solve(), Simplex.Status.OPTIMAL, "estado del problema clásico")
	var x := lp.get_solution()
	assert_rational(x[0], Rational.from_int(2), "x del óptimo")
	assert_rational(x[1], Rational.from_int(6), "y del óptimo")
	assert_rational(lp.get_objective_value(), Rational.from_int(36), "z del óptimo")


## 2. Óptimo FRACCIONARIO: max x1 + x2, x1 + 2x2 <= 4, 4x1 + 2x2 <= 12.
## Vértice (8/3, 2/3), z = 10/3. En coma flotante z sale 3.3333333333333335.
func test_fractional_vertex_is_exact() -> void:
	var lp := Simplex.new(2)
	lp.set_objective_ints([1, 1], true)
	lp.add_constraint_ints([1, 2], Simplex.Relation.LESS_EQUAL, 4)
	lp.add_constraint_ints([4, 2], Simplex.Relation.LESS_EQUAL, 12)
	assert_status(lp.solve(), Simplex.Status.OPTIMAL, "estado del óptimo fraccionario")
	var x := lp.get_solution()
	assert_rational(x[0], Rational.new(8, 3), "x1 = 8/3 exacto")
	assert_rational(x[1], Rational.new(2, 3), "x2 = 2/3 exacto")
	assert_rational(lp.get_objective_value(), Rational.new(10, 3), "z = 10/3 exacto")


## 3. DEGENERADO: max x + y, x <= 2, y <= 2, x + y <= 4.
## El óptimo (2, 2) satura las tres restricciones: en el vértice hay una
## variable básica a cero. Es la situación en la que un Simplex mal reglado
## cicla, y es exactamente la del director (los tres presupuestos se saturan
## a la vez con la composición uniforme).
func test_degenerate_vertex_terminates() -> void:
	var lp := Simplex.new(2)
	lp.set_objective_ints([1, 1], true)
	lp.add_constraint_ints([1, 0], Simplex.Relation.LESS_EQUAL, 2)
	lp.add_constraint_ints([0, 1], Simplex.Relation.LESS_EQUAL, 2)
	lp.add_constraint_ints([1, 1], Simplex.Relation.LESS_EQUAL, 4)
	assert_status(lp.solve(), Simplex.Status.OPTIMAL, "estado del degenerado")
	var x := lp.get_solution()
	assert_rational(x[0], Rational.from_int(2), "x del degenerado")
	assert_rational(x[1], Rational.from_int(2), "y del degenerado")
	assert_rational(lp.get_objective_value(), Rational.from_int(4), "z del degenerado")
	assert_lt(float(lp.iterations()), 50.0, "termina en pocos pivotes")


## 4. BEALE (1955), el contraejemplo canónico de ciclado con regla de Dantzig,
## escalado x100 para trabajar con enteros:
##   max 75x1 - 15000x2 + 2x3 - 600x4
##   25x1 - 6000x2 - 4x3 + 900x4 <= 0
##   50x1 - 9000x2 - 2x3 + 300x4 <= 0
##   x3 <= 1
## Óptimo z = 5 en (1/25, 0, 1, 0).
func test_beale_cycling_example() -> void:
	var lp := Simplex.new(4)
	lp.set_objective_ints([75, -15000, 2, -600], true)
	lp.add_constraint_ints([25, -6000, -4, 900], Simplex.Relation.LESS_EQUAL, 0)
	lp.add_constraint_ints([50, -9000, -2, 300], Simplex.Relation.LESS_EQUAL, 0)
	lp.add_constraint_ints([0, 0, 1, 0], Simplex.Relation.LESS_EQUAL, 1)
	assert_status(lp.solve(), Simplex.Status.OPTIMAL, "Beale termina")
	var x := lp.get_solution()
	assert_rational(x[0], Rational.new(1, 25), "x1 = 1/25")
	assert_rational(x[1], Rational.zero(), "x2 = 0")
	assert_rational(x[2], Rational.one(), "x3 = 1")
	assert_rational(x[3], Rational.zero(), "x4 = 0")
	assert_rational(lp.get_objective_value(), Rational.from_int(5), "z de Beale")


## 5. INFACTIBLE: x + y <= 1 y x + y >= 3 no pueden cumplirse a la vez.
## La fase I termina con suma de artificiales > 0.
func test_infeasible_is_reported() -> void:
	var lp := Simplex.new(2)
	lp.set_objective_ints([1, 1], true)
	lp.add_constraint_ints([1, 1], Simplex.Relation.LESS_EQUAL, 1)
	lp.add_constraint_ints([1, 1], Simplex.Relation.GREATER_EQUAL, 3)
	assert_status(lp.solve(), Simplex.Status.INFEASIBLE, "problema infactible")
	assert_true(lp.get_solution().is_empty(), "un infactible no devuelve solución")


## 6. NO ACOTADO: max x + y con x - y <= 1 crece sin límite por la diagonal.
func test_unbounded_is_reported() -> void:
	var lp := Simplex.new(2)
	lp.set_objective_ints([1, 1], true)
	lp.add_constraint_ints([1, -1], Simplex.Relation.LESS_EQUAL, 1)
	assert_status(lp.solve(), Simplex.Status.UNBOUNDED, "problema no acotado")


## 7. IGUALDAD: max 2x + 3y, x + y = 10, y <= 4. Óptimo (6, 4), z = 24.
func test_equality_constraint() -> void:
	var lp := Simplex.new(2)
	lp.set_objective_ints([2, 3], true)
	lp.add_constraint_ints([1, 1], Simplex.Relation.EQUAL, 10)
	lp.add_constraint_ints([0, 1], Simplex.Relation.LESS_EQUAL, 4)
	assert_status(lp.solve(), Simplex.Status.OPTIMAL, "estado con igualdad")
	var x := lp.get_solution()
	assert_rational(x[0], Rational.from_int(6), "x con igualdad")
	assert_rational(x[1], Rational.from_int(4), "y con igualdad")
	assert_rational(lp.get_objective_value(), Rational.from_int(24), "z con igualdad")


## 8. MINIMIZACIÓN con >= (necesita fase I de verdad):
##    min 2x + 3y, x + y >= 4, x >= 1. Óptimo (4, 0), z = 8.
func test_minimization_with_phase_one() -> void:
	var lp := Simplex.new(2)
	lp.set_objective_ints([2, 3], false)
	lp.add_constraint_ints([1, 1], Simplex.Relation.GREATER_EQUAL, 4)
	lp.add_constraint_ints([1, 0], Simplex.Relation.GREATER_EQUAL, 1)
	assert_status(lp.solve(), Simplex.Status.OPTIMAL, "estado de la minimización")
	var x := lp.get_solution()
	assert_rational(x[0], Rational.from_int(4), "x de la minimización")
	assert_rational(x[1], Rational.zero(), "y de la minimización")
	assert_rational(lp.get_objective_value(), Rational.from_int(8), "z de la minimización")


## 9. Lado derecho NEGATIVO: -x - y <= -4 es x + y >= 4. El tablero se
## normaliza invirtiendo la fila; el legacy delegaba en un Simplex dual
## aparte (`Simplex.cc:570`) para este caso.
func test_negative_right_hand_side_is_normalized() -> void:
	var lp := Simplex.new(2)
	lp.set_objective_ints([1, 1], false)
	lp.add_constraint_ints([-1, -1], Simplex.Relation.LESS_EQUAL, -4)
	assert_status(lp.solve(), Simplex.Status.OPTIMAL, "estado con RHS negativo")
	assert_rational(lp.get_objective_value(), Rational.from_int(4), "z con RHS negativo")


## 10. La formulación ORIGINAL del juego, relajación continua con
## MaxEnemies = 30 y los presupuestos enteros del legacy (93/51/46 por
## enemigo, `Optimization.cc:93-95`):
##   max x1 + x2 + x3
##   60x1 + 100x2 + 120x3 <= 2790
##   45x1 +  50x2 +  65x3 <= 1530
##   60x1 +  45x2 +  35x3 <= 1380
## Óptimo continuo z = 355/12 en (85/12, 67/4, 23/4).
func test_legacy_formulation_relaxation() -> void:
	var lp := Simplex.new(3)
	lp.set_objective_ints([1, 1, 1], true)
	lp.add_constraint_ints([60, 100, 120], Simplex.Relation.LESS_EQUAL, 2790)
	lp.add_constraint_ints([45, 50, 65], Simplex.Relation.LESS_EQUAL, 1530)
	lp.add_constraint_ints([60, 45, 35], Simplex.Relation.LESS_EQUAL, 1380)
	assert_status(lp.solve(), Simplex.Status.OPTIMAL, "estado de la formulación legacy")
	assert_rational(lp.get_objective_value(), Rational.new(355, 12), "z = 355/12 exacto")
	var x := lp.get_solution()
	assert_rational(x[0], Rational.new(85, 12), "x1 = 85/12")
	assert_rational(x[1], Rational.new(67, 4), "x2 = 67/4")
	assert_rational(x[2], Rational.new(23, 4), "x3 = 23/4")


## 11. Trivial pero necesario: sin restricciones que aten, el óptimo de una
## minimización con costes positivos es el origen.
func test_origin_is_optimal_when_costs_are_positive() -> void:
	var lp := Simplex.new(2)
	lp.set_objective_ints([5, 7], false)
	lp.add_constraint_ints([1, 1], Simplex.Relation.LESS_EQUAL, 10)
	assert_status(lp.solve(), Simplex.Status.OPTIMAL, "estado del origen")
	assert_rational(lp.get_objective_value(), Rational.zero(), "z en el origen")


## 12. Determinismo: el mismo problema resuelto cien veces da exactamente el
## mismo vértice. Es el requisito que hace reproducible un fallo de balanceo.
func test_solver_is_deterministic() -> void:
	var reference: String = ""
	for run: int in 100:
		var lp := Simplex.new(3)
		lp.set_objective_ints([1, 1, 1], true)
		lp.add_constraint_ints([60, 100, 120], Simplex.Relation.LESS_EQUAL, 2790)
		lp.add_constraint_ints([45, 50, 65], Simplex.Relation.LESS_EQUAL, 1530)
		lp.add_constraint_ints([60, 45, 35], Simplex.Relation.LESS_EQUAL, 1380)
		lp.solve()
		var signature := "%s|%s|%s" % [
			lp.get_solution()[0].to_string(),
			lp.get_solution()[1].to_string(),
			lp.get_solution()[2].to_string(),
		]
		if run == 0:
			reference = signature
		assert_eq(signature, reference, "vértice idéntico en la iteración %d" % run)
