extends TestCase
## LA PRUEBA QUE JUSTIFICA EL CAMBIO DE FORMULACIÓN.
##
## No basta con decir "la formulación de 2012 estaba mal": hay que
## demostrarlo, y demostrarlo de forma que no dependa de qué vértice elija
## nuestro solucionador. Lo que se prueba aquí:
##
## 1. El objetivo original `max x1+x2+x3` es INDIFERENTE a la composición:
##    (10, 11, 8) —variada— y (3, 26, 0) —26 Milicianos y ni un Veterano— son
##    AMBAS óptimas, con Z = 29. Cuál sale depende del orden de pivotaje, no
##    del diseño.
## 2. La formulación nueva SÍ las distingue: evaluado su objetivo, el punto
##    variado gana al sesgado por un margen enorme.
## 3. La formulación original es CIEGA a la forma del mapa: tres zonas
##    radicalmente distintas (pasillo, sala media, nave diáfana) producen
##    exactamente la misma composición. Eso es, literalmente, "la misma
##    composición planta tras planta".
## 4. La formulación nueva responde a la geometría en la dirección diseñada y
##    respeta sus cotas por arquetipo, que es lo que hace la degeneración
##    imposible por construcción.

const DAMAGE: Array[int] = [60, 100, 120]
const HEALTH: Array[int] = [45, 50, 65]
const SPEED: Array[int] = [60, 45, 35]
## Presupuestos del legacy para MaxEnemies = 30: 93/51/46 por enemigo, con la
## división entera de C++ (`Optimization.cc:93-95`).
const BUDGET_DAMAGE: int = 2790
const BUDGET_HEALTH: int = 1530
const BUDGET_SPEED: int = 1380

## Una composición variada y una degenerada, ambas factibles con N = 30.
const BALANCED: Array[int] = [10, 11, 8]
const SKEWED: Array[int] = [3, 26, 0]


func _context(area_m2: float, los_m: float, cover: float, entries: int) -> EncounterContext:
	var context := EncounterContext.new()
	context.navigable_area_m2 = area_m2
	context.floor_difficulty = 1.0
	context.skill_multiplier = 1.0
	context.set_map_shape(cover, los_m, entries)
	context.allowed_archetypes = [&"enemy_thug", &"enemy_militiaman", &"enemy_veteran"]
	return context


func _fits(counts: Array[int]) -> bool:
	var damage := DAMAGE[0] * counts[0] + DAMAGE[1] * counts[1] + DAMAGE[2] * counts[2]
	var health := HEALTH[0] * counts[0] + HEALTH[1] * counts[1] + HEALTH[2] * counts[2]
	var speed := SPEED[0] * counts[0] + SPEED[1] * counts[1] + SPEED[2] * counts[2]
	return damage <= BUDGET_DAMAGE and health <= BUDGET_HEALTH and speed <= BUDGET_SPEED


## Desviación total respecto a una composición objetivo: el núcleo del
## objetivo nuevo, calculado a mano para poder comparar los dos puntos.
func _deviation(counts: Array[int], targets: Array[float]) -> float:
	var total: float = 0.0
	for index: int in counts.size():
		total += absf(float(counts[index]) - targets[index])
	return total


## 1. El objetivo de 2012 no distingue una composición variada de una
## degenerada: las dos son óptimas.
func test_legacy_objective_cannot_tell_variety_from_degeneracy() -> void:
	assert_true(_fits(BALANCED), "(10, 11, 8) es factible con los presupuestos del legacy")
	assert_true(_fits(SKEWED), "(3, 26, 0) es factible con los presupuestos del legacy")

	var balanced_z := BALANCED[0] + BALANCED[1] + BALANCED[2]
	var skewed_z := SKEWED[0] + SKEWED[1] + SKEWED[2]
	assert_eq(balanced_z, skewed_z, "el objetivo original da el MISMO valor a las dos")

	# Y ese valor es el óptimo: no son dos puntos cualesquiera.
	var problem := IntegerSimplex.new(3)
	problem.set_objective_ints([1, 1, 1], true)
	problem.add_constraint_ints(DAMAGE, Simplex.Relation.LESS_EQUAL, BUDGET_DAMAGE)
	problem.add_constraint_ints(HEALTH, Simplex.Relation.LESS_EQUAL, BUDGET_HEALTH)
	problem.add_constraint_ints(SPEED, Simplex.Relation.LESS_EQUAL, BUDGET_SPEED)
	problem.solve()
	assert_eq(problem.get_objective_value().to_string(), "29",
		"el óptimo entero de la formulación original vale 29")
	assert_eq(balanced_z, 29, "las dos composiciones alcanzan el óptimo")

	# La degenerada es 90% de un solo arquetipo y CERO de otro. El objetivo
	# original la premia igual que a la variada.
	assert_almost_eq(float(SKEWED[1]) / float(skewed_z), 0.897, 0.001,
		"la composición sesgada es 26 de 29 Milicianos")
	assert_eq(SKEWED[2], 0, "y no trae ni un Veterano")


## 2. El objetivo nuevo sí las distingue, y por un margen que no depende de
## ningún ajuste fino.
func test_new_objective_separates_them() -> void:
	var targets: Array[float] = [10.0, 10.0, 10.0]
	var balanced_deviation := _deviation(BALANCED, targets)
	var skewed_deviation := _deviation(SKEWED, targets)
	assert_lt(balanced_deviation, skewed_deviation,
		"la composición variada se desvía menos del objetivo")
	assert_almost_eq(balanced_deviation, 3.0, 0.001, "desviación de (10, 11, 8)")
	assert_almost_eq(skewed_deviation, 33.0, 0.001, "desviación de (3, 26, 0)")


## 3. La formulación original es ciega a la forma del mapa: pasillo, sala y
## nave diáfana producen la MISMA composición.
func test_legacy_formulation_ignores_map_shape() -> void:
	var composer := EncounterComposer.new()
	composer.mode = EncounterComposer.Mode.LEGACY_SIMPLEX
	var corridor := composer.compose(_context(892.7, 5.0, 1.0, 5))
	var room := composer.compose(_context(892.7, 15.0, 3.0, 2))
	var hall := composer.compose(_context(892.7, 40.0, 8.0, 1))
	assert_eq(corridor.counts, room.counts, "pasillo y sala: misma composición")
	assert_eq(room.counts, hall.counts, "sala y nave diáfana: misma composición")
	assert_eq(corridor.max_enemies, hall.max_enemies, "y el mismo MaxEnemies")


## 4. La formulación nueva responde a la geometría en la dirección diseñada.
func test_new_formulation_responds_to_map_shape() -> void:
	var composer := EncounterComposer.new()
	var corridor := composer.compose(_context(892.7, 5.0, 1.0, 5))
	var hall := composer.compose(_context(892.7, 40.0, 8.0, 1))

	# Pasillo estrecho con muchos accesos: se resuelve con Sicarios.
	assert_gt(float(corridor.counts[0]), float(hall.counts[0]),
		"el pasillo trae más Sicarios que la nave diáfana")
	assert_gt(corridor.share(0), hall.share(0), "y su peso relativo también es mayor")
	# Nave diáfana con líneas de tiro largas: admite Veteranos.
	assert_gt(float(hall.counts[2]), float(corridor.counts[2]),
		"la nave diáfana trae más Veteranos que el pasillo")
	assert_gt(hall.share(2), corridor.share(2), "y su peso relativo también es mayor")


## 5. Ningún arquetipo desaparece ni acapara: las cotas se cumplen para todo
## un barrido de tamaños de zona. Esto es lo que hace que la degeneración del
## original sea imposible por construcción, no improbable.
func test_new_formulation_respects_archetype_bounds() -> void:
	var composer := EncounterComposer.new()
	for area: float in [200.0, 500.0, 892.7, 2000.0, 5000.0, 12000.0]:
		var context := _context(area, 15.0, 3.0, 2)
		var result := composer.compose(context)
		var enemy_total := result.max_enemies
		var profile := Balance.director_profile()
		var minimum := int(floorf(profile.min_share_per_archetype * float(enemy_total)))
		var maximum := int(ceilf(profile.max_share_per_archetype * float(enemy_total)))
		for index: int in 3:
			assert_between(float(result.counts[index]), float(minimum), float(maximum),
				"área %.0f: arquetipo %d dentro de sus cotas" % [area, index])
		assert_lt(result.dominant_share(), 0.7,
			"área %.0f: ningún arquetipo acapara el encuentro" % area)


## 6. Y en el mismo barrido, el original admite como óptimo un punto que
## viola esas cotas: la degeneración no es mala suerte, es lo que el problema
## permite.
func test_legacy_optimum_violates_the_bounds_the_new_one_enforces() -> void:
	var enemy_total := 30
	var profile := Balance.director_profile()
	var maximum := int(ceilf(profile.max_share_per_archetype * float(enemy_total)))
	assert_gt(float(SKEWED[1]), float(maximum),
		"(3, 26, 0) supera la cota máxima por arquetipo (%d)" % maximum)
	var minimum := int(floorf(profile.min_share_per_archetype * float(enemy_total)))
	assert_lt(float(SKEWED[2]), float(minimum),
		"(3, 26, 0) incumple la cota mínima por arquetipo (%d)" % minimum)
	assert_true(_fits(SKEWED), "y aun así es factible y óptimo para el objetivo original")


## 7. LAS DOS VÍAS, SOBRE LOS MISMOS PRESUPUESTOS.
##
## Mismo N, mismas tres restricciones, misma libertad de cotas (0..N). Lo
## único que cambia es CÓMO se elige dentro de ese espacio:
##   * el Simplex de 2012 maximiza `x1+x2+x3` y no distingue una mezcla de un
##     monocultivo,
##   * la búsqueda puntúa variedad, objetivo, forma, novedad y presupuesto.
## El resultado es la justificación del diseño, con números.
func test_search_and_simplex_over_the_same_budgets() -> void:
	# --- Vía A: el Simplex con la formulación de 2012 ---
	var simplex := IntegerSimplex.new(3)
	simplex.set_objective_ints([1, 1, 1], true)
	simplex.add_constraint_ints(DAMAGE, Simplex.Relation.LESS_EQUAL, BUDGET_DAMAGE)
	simplex.add_constraint_ints(HEALTH, Simplex.Relation.LESS_EQUAL, BUDGET_HEALTH)
	simplex.add_constraint_ints(SPEED, Simplex.Relation.LESS_EQUAL, BUDGET_SPEED)
	simplex.solve()
	var simplex_counts := simplex.get_solution_ints()

	# --- Vía B: enumeración + puntuación, mismos presupuestos y cotas ---
	var request := CompositionSearch.Request.new()
	request.lower = [0, 0, 0]
	request.upper = [30, 30, 30]
	request.budgets = [float(BUDGET_DAMAGE), float(BUDGET_HEALTH), float(BUDGET_SPEED)]
	request.apply_profile(Balance.director_profile())
	request.target_counts = [10.0, 10.0, 10.0]
	request.affinity_shares = [0.3334, 0.3333, 0.3333]
	request.max_total = 30
	request.seed = 20120611
	request.top_k = 10
	var search := CompositionSearch.run(request)
	assert_true(search.has_solution(), "la enumeración encuentra composición")

	var searched := search.best.counts
	var search_variety := CompositionSearch.variety_term(searched, request)
	var simplex_variety := CompositionSearch.variety_term(simplex_counts, request)
	var skewed_variety := CompositionSearch.variety_term(SKEWED, request)

	# La búsqueda produce una mezcla; el óptimo sesgado que el objetivo de
	# 2012 admite es casi un monocultivo.
	assert_gt(search_variety, 0.95, "la enumeración devuelve una composición variada")
	assert_lt(search.best.dominant_share(), 0.45,
		"y ningún arquetipo pasa del 45% del encuentro")
	assert_lt(skewed_variety, 0.5,
		"mientras que (3, 26, 0) —óptimo para el objetivo de 2012— casi no tiene variedad")
	assert_gt(search_variety, skewed_variety, "la diferencia es la que buscábamos")
	assert_gt(search_variety, simplex_variety - 0.000001,
		"la enumeración nunca es menos variada que el vértice que devuelve el Simplex")

	# Y el precio: la búsqueda renuncia a algunas cabezas, porque contar
	# cabezas no era el objetivo. Es una decisión, no un defecto.
	var simplex_total := simplex_counts[0] + simplex_counts[1] + simplex_counts[2]
	assert_eq(simplex_total, 29, "el Simplex agota el objetivo de 2012")
	assert_lt(float(search.best.total()), float(simplex_total) + 1.0,
		"la enumeración no trae más enemigos: trae mejores")


## 8. El mecanismo por defecto es la enumeración. Si alguien lo cambia sin
## querer, esto salta.
func test_search_is_the_default_mechanism() -> void:
	var composer := EncounterComposer.new()
	assert_eq(EncounterComposer.mode_name(composer.mode), "SEARCH",
		"el composer arranca en modo búsqueda")
	var result := composer.compose(_context(892.7, 15.0, 3.0, 2))
	assert_eq(EncounterComposer.mode_name(result.mode), "SEARCH",
		"y la composición declara con qué se hizo")
	assert_gt(float(result.ranked.size()), 1.0, "con su ranking y su desglose")
	assert_eq(result.score_terms.size(), 5, "y los cinco términos con nombre")
