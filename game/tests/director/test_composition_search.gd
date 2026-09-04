extends TestCase
## Búsqueda exhaustiva y función de puntuación.
##
## Dos de estas pruebas son estructurales y no deben relajarse:
##
## * `test_hot_loop_matches_the_reference_scorer`: el bucle de búsqueda tiene
##   la puntuación EN LÍNEA por rendimiento, así que existe dos veces. Esta
##   prueba las compara candidato a candidato. Si alguien toca una y no la
##   otra, salta aquí y no en una partida.
## * `test_search_space_stays_small`: fija el tamaño del espacio. Si alguien
##   añade un arquetipo o afloja las cotas y el espacio explota, salta.


func _request(maximum: int) -> CompositionSearch.Request:
	var request := CompositionSearch.Request.new()
	request.lower = [1, 1, 1]
	request.upper = [maximum, maximum, maximum]
	request.budgets = [93.3333 * float(maximum), 51.6667 * float(maximum), 46.6667 * float(maximum)]
	request.damage_coefficients = [60.0, 100.0, 120.0]
	request.health_coefficients = [45.0, 50.0, 65.0]
	request.speed_coefficients = [60.0, 45.0, 35.0]
	var third := float(maximum) / 3.0
	request.target_counts = [third, third, third]
	request.affinity_shares = [0.34, 0.33, 0.33]
	request.max_total = maximum
	request.seed = 20120611
	request.top_k = 10
	return request


## Enumera y puntúa TODO el espacio con la implementación de referencia
## (`evaluate`), y lo ordena con el mismo criterio que la búsqueda.
func _reference_ranking(request: CompositionSearch.Request) -> Array[CompositionSearch.Candidate]:
	var all: Array[CompositionSearch.Candidate] = []
	for x0: int in range(request.lower[0], request.upper[0] + 1):
		for x1: int in range(request.lower[1], request.upper[1] + 1):
			for x2: int in range(request.lower[2], request.upper[2] + 1):
				var counts: Array[int] = [x0, x1, x2]
				if x0 + x1 + x2 > request.max_total:
					continue
				var spent := CompositionSearch.spend(counts, request)
				if spent[0] > request.budgets[0] or spent[1] > request.budgets[1] \
						or spent[2] > request.budgets[2]:
					continue
				all.append(CompositionSearch.evaluate(counts, request))
	var seed_value := request.seed
	all.sort_custom(func(a: CompositionSearch.Candidate, b: CompositionSearch.Candidate) -> bool:
		var rank_a := roundi(a.score / CompositionSearch.SCORE_EPSILON)
		var rank_b := roundi(b.score / CompositionSearch.SCORE_EPSILON)
		if rank_a != rank_b:
			return rank_a > rank_b
		return CompositionSearch.tie_break_key(a.counts, seed_value) \
			< CompositionSearch.tie_break_key(b.counts, seed_value)
	)
	return all


## El bucle en línea y el marcador de referencia dan el MISMO orden.
func test_hot_loop_matches_the_reference_scorer() -> void:
	var request := _request(12)
	var reference := _reference_ranking(request)
	var found := CompositionSearch.run(request)
	assert_eq(found.feasible_count, reference.size(),
		"la búsqueda visita exactamente las combinaciones viables")
	assert_eq(found.ranked.size(), 10, "devuelve las diez mejores")
	for index: int in found.ranked.size():
		assert_eq(found.ranked[index].counts, reference[index].counts,
			"puesto %d idéntico al de referencia" % index)
		assert_almost_eq(found.ranked[index].score, reference[index].score, 0.0000001,
			"puntuación %d idéntica" % index)


## Ninguna composición devuelta se pasa de presupuesto.
func test_results_never_exceed_the_budgets() -> void:
	var request := _request(20)
	var found := CompositionSearch.run(request)
	assert_true(found.has_solution(), "hay solución")
	for candidate: CompositionSearch.Candidate in found.ranked:
		for row: int in 3:
			assert_lt(candidate.spent[row], request.budgets[row] + 0.001,
				"presupuesto %d respetado por %s" % [row, str(candidate.counts)])


## VARIEDAD: la entropía premia la mezcla y castiga el monocultivo. Es el
## término que la programación lineal no puede expresar.
func test_variety_term_rewards_a_mixed_composition() -> void:
	var request := _request(30)
	var mixed := CompositionSearch.variety_term([10, 10, 10], request)
	var skewed := CompositionSearch.variety_term([28, 1, 1], request)
	var single := CompositionSearch.variety_term([30, 0, 0], request)
	assert_almost_eq(mixed, 1.0, 0.000001, "el reparto perfecto puntúa 1")
	assert_lt(skewed, mixed, "el monocultivo casi puro puntúa menos")
	assert_almost_eq(single, 0.0, 0.000001, "un solo arquetipo puntúa 0")

	# Y con un solo arquetipo DISPONIBLE, la variedad no se castiga: no era
	# una decisión del director.
	var forced := _request(30)
	forced.upper = [30, 0, 0]
	assert_almost_eq(CompositionSearch.variety_term([30, 0, 0], forced), 1.0, 0.000001,
		"sin alternativa, la variedad no penaliza")


## NOVEDAD: repetir la composición anterior puntúa 0.
func test_novelty_term_punishes_repetition() -> void:
	var request := _request(30)
	request.previous_counts = [10, 10, 10]
	assert_almost_eq(CompositionSearch.novelty_term([10, 10, 10], request), 0.0, 0.000001,
		"la misma mezcla otra vez no es novedad")
	assert_gt(CompositionSearch.novelty_term([20, 5, 5], request), 0.0,
		"otra mezcla sí lo es")
	assert_almost_eq(CompositionSearch.novelty_term([30, 0, 0], request), 0.666666, 0.001,
		"la mezcla opuesta puntúa alto")

	var virgin := _request(30)
	assert_almost_eq(CompositionSearch.novelty_term([10, 10, 10], virgin), 1.0, 0.000001,
		"sin composición anterior, todo es nuevo")


## OBJETIVO: cuanto más cerca de la composición objetivo, mejor.
func test_target_term_measures_distance_to_the_goal() -> void:
	var request := _request(30)
	request.target_counts = [10.0, 10.0, 10.0]
	assert_almost_eq(CompositionSearch.target_term([10, 10, 10], request), 1.0, 0.000001,
		"dar en el objetivo puntúa 1")
	assert_lt(CompositionSearch.target_term([3, 26, 0], request),
		CompositionSearch.target_term([10, 11, 8], request),
		"la composición sesgada está más lejos del objetivo")


## PRESUPUESTO: gastar poco penaliza.
func test_budget_term_rewards_using_the_threat() -> void:
	var request := _request(30)
	var small := CompositionSearch.budget_term([1, 1, 1], request)
	var full := CompositionSearch.budget_term([9, 10, 9], request)
	assert_lt(small, full, "dejar el presupuesto sin gastar puntúa menos")
	assert_between(full, 0.0, 1.0, "el término está normalizado")


## FORMA: la composición que se parece a lo que pide la geometría gana.
func test_map_fit_term_follows_the_geometry() -> void:
	var request := _request(30)
	request.affinity_shares = [0.7, 0.2, 0.1]  # pasillo: pide Sicarios
	assert_gt(CompositionSearch.map_fit_term([21, 6, 3], request),
		CompositionSearch.map_fit_term([3, 6, 21], request),
		"la composición que sigue a la geometría puntúa más")


## El desglose suma la puntuación total: si no, el desglose miente y no sirve
## para depurar nada.
func test_breakdown_adds_up_to_the_score() -> void:
	var request := _request(20)
	var candidate := CompositionSearch.evaluate([7, 7, 6], request)
	var total: float = 0.0
	var weight_total := (
		CompositionSearch.WEIGHT_TARGET + CompositionSearch.WEIGHT_VARIETY
		+ CompositionSearch.WEIGHT_NOVELTY + CompositionSearch.WEIGHT_BUDGET
		+ CompositionSearch.WEIGHT_MAP_FIT
	)
	for key: StringName in candidate.weighted:
		total += candidate.weighted[key]
	assert_almost_eq(candidate.score, total / weight_total, 0.000001,
		"la puntuación es la suma ponderada de sus términos")
	assert_eq(candidate.terms.size(), 5, "cinco términos con nombre")


## Determinismo: cien búsquedas idénticas, el mismo ranking.
func test_search_is_deterministic() -> void:
	var reference: String = ""
	for run: int in 100:
		var found := CompositionSearch.run(_request(15))
		var lines: Array[String] = []
		for candidate: CompositionSearch.Candidate in found.ranked:
			lines.append(str(candidate.counts) + "%.9f" % candidate.score)
		var text := "|".join(lines)
		if run == 0:
			reference = text
		assert_eq(text, reference, "mismo ranking en la iteración %d" % run)


## El desempate lo decide la semilla, no el orden del bucle: es estable
## dentro de una partida y distinto entre partidas.
func test_ties_are_broken_by_the_run_seed() -> void:
	var counts: Array[int] = [5, 5, 5]
	var other: Array[int] = [6, 5, 4]
	assert_eq(CompositionSearch.tie_break_key(counts, 111),
		CompositionSearch.tie_break_key(counts, 111), "estable para la misma semilla")
	assert_ne(CompositionSearch.tie_break_key(counts, 111),
		CompositionSearch.tie_break_key(counts, 222), "distinta entre semillas")
	assert_ne(CompositionSearch.tie_break_key(counts, 111),
		CompositionSearch.tie_break_key(other, 111), "distinta entre composiciones")
	for seed_value: int in [0, 1, 999, -4321]:
		assert_gt(float(CompositionSearch.tie_break_key(counts, seed_value)) + 1.0, 0.0,
			"la clave nunca es negativa (semilla %d)" % seed_value)


## Un espacio sin ninguna combinación viable no devuelve nada, y lo dice.
func test_impossible_budgets_yield_no_solution() -> void:
	var request := _request(20)
	request.budgets = [1.0, 1.0, 1.0]
	request.lower = [1, 1, 1]
	var found := CompositionSearch.run(request)
	assert_false(found.has_solution(), "no hay composición viable")
	assert_eq(found.feasible_count, 0, "y ninguna combinación pasó el filtro")


## PRUEBA DE TAMAÑO DEL ESPACIO. Fija el peor caso REAL del juego: la zona
## más grande imaginable (12 000 m²) en la última planta (dificultad 5,2) con
## el jugador al máximo del modelo de habilidad (×1,75). Si alguien añade
## arquetipos o afloja `MAX_SHARE_PER_ARCHETYPE`, el espacio crece como un
## cubo y esta prueba lo dice antes que un tirón en mitad de una partida.
func test_search_space_stays_small() -> void:
	var context := EncounterContext.new()
	context.navigable_area_m2 = 12000.0
	context.floor_difficulty = 5.2
	context.skill_multiplier = 1.75
	context.mean_line_of_sight_m = 15.0
	context.cover_points_per_100m2 = 3.0
	context.entry_count = 2
	context.allowed_archetypes = [&"enemy_thug", &"enemy_militiaman", &"enemy_veteran"]
	context.seed = 20120611

	var composer := EncounterComposer.new()
	var result := composer.compose(context)
	assert_gt(float(result.max_enemies), 60.0, "el caso extremo es de verdad extremo")
	assert_false(result.combinations_visited >= CompositionSearch.MAX_COMBINATIONS,
		"la búsqueda no toca el tope de seguridad")
	assert_lt(float(result.combinations_visited), 40000.0,
		"el espacio de búsqueda sigue siendo pequeño")
	assert_lt(float(result.feasible_count), 30000.0, "y las combinaciones viables también")
	# Cota generosa para no depender de la máquina de CI: el valor medido en
	# desarrollo es de unos 50 ms para este caso, y ~5 ms para una zona
	# normal. Lo que importa es que no se vaya a segundos.
	assert_lt(float(result.search_usec), 1500000.0, "y se resuelve en mucho menos de un segundo")
