extends TestCase
## Composición de encuentros: fórmula de MaxEnemies, presupuestos, cotas,
## reparto por planta y reserva.


func _profile() -> DirectorProfile:
	# Copia del perfil real: los tests no deben depender de que alguien
	# rebalancee el .tres, pero sí de que los valores por defecto sean estos.
	var profile := DirectorProfile.new()
	profile.max_enemies_area_divisor = 250.0
	profile.max_enemies_multiplier = 10.0
	profile.damage_coefficients = PackedFloat32Array([60.0, 100.0, 120.0])
	profile.health_coefficients = PackedFloat32Array([45.0, 50.0, 65.0])
	profile.speed_coefficients = PackedFloat32Array([60.0, 45.0, 35.0])
	profile.damage_budget_per_enemy = 93.3333
	profile.health_budget_per_enemy = 51.6667
	profile.speed_budget_per_enemy = 46.6667
	return profile


func _context(area_m2: float, difficulty: float, pool: Array[StringName]) -> EncounterContext:
	var context := EncounterContext.new()
	context.navigable_area_m2 = area_m2
	context.floor_difficulty = difficulty
	context.skill_multiplier = 1.0
	context.mean_line_of_sight_m = 15.0
	context.cover_points_per_100m2 = 3.0
	context.entry_count = 2
	context.allowed_archetypes = pool
	return context


func _all() -> Array[StringName]:
	return [&"enemy_thug", &"enemy_militiaman", &"enemy_veteran"]


## La conversión de área usa el ÚNICO factor del proyecto: 1 m = 75 u del
## legacy, luego 1 m² = 5,625 unidades de área (miles de px²).
func test_area_conversion_matches_the_projects_scale() -> void:
	assert_almost_eq(EncounterComposer.area_in_legacy_units(1.0), 5.625, 0.0001,
		"un metro cuadrado en unidades del legacy")
	assert_almost_eq(EncounterComposer.area_in_legacy_units(0.0), 0.0, 0.0001, "área nula")


## MaxEnemies = ln((área/250) · dificultad) · 10, exactamente como
## `Optimization.cc:91`.
func test_max_enemies_replicates_the_legacy_formula() -> void:
	var composer := EncounterComposer.new(_profile())
	for area: float in [200.0, 892.7, 5000.0]:
		for difficulty: float in [1.0, 1.5, 4.0]:
			var context := _context(area, difficulty, _all())
			var units := EncounterComposer.area_in_legacy_units(area)
			var expected := int(log((units / 250.0) * difficulty) * 10.0)
			assert_eq(composer.max_enemies(context), maxi(expected, 0),
				"MaxEnemies para %.0f m² y dificultad %.1f" % [area, difficulty])


## Con `(área/250)·dif <= 1` no hay enemigos. El legacy dejaba el logaritmo
## en negativo y `CalcularEnemigos` no hacía nada (`Optimization.cc:113`).
func test_tiny_zone_produces_no_enemies() -> void:
	var composer := EncounterComposer.new(_profile())
	var result := composer.compose(_context(10.0, 1.0, _all()))
	assert_eq(composer.max_enemies(_context(10.0, 1.0, _all())), 0, "MaxEnemies nulo")
	assert_eq(result.total(), 0, "no se genera ningún enemigo")
	assert_eq(int(result.source), int(EncounterComposer.Source.EMPTY), "la fuente lo declara")


## El modelo de habilidad multiplica a la dificultad de la planta: es la
## línea que convierte el Simplex de 2012 en un director vivo.
func test_skill_multiplier_moves_the_budget() -> void:
	var composer := EncounterComposer.new(_profile())
	var weak := _context(2000.0, 2.0, _all())
	weak.skill_multiplier = 0.65
	var strong := _context(2000.0, 2.0, _all())
	strong.skill_multiplier = 1.75
	assert_lt(float(composer.max_enemies(weak)), float(composer.max_enemies(strong)),
		"jugar mejor trae más enemigos")
	assert_almost_eq(weak.effective_difficulty(), 1.3, 0.0001, "dificultad efectiva del débil")
	assert_almost_eq(strong.effective_difficulty(), 3.5, 0.0001, "dificultad efectiva del fuerte")


## La solución consume los presupuestos sin pasarse. Es la restricción que se
## hereda literalmente del original.
func test_solution_never_exceeds_the_budgets() -> void:
	var composer := EncounterComposer.new(_profile())
	for area: float in [300.0, 892.7, 3000.0, 9000.0]:
		var result := composer.compose(_context(area, 1.0, _all()))
		for row: int in 3:
			assert_lt(result.spent[row], result.budgets[row] + 0.001,
				"área %.0f: presupuesto %d respetado" % [area, row])


## La forma del mapa modula los presupuestos dentro del margen declarado.
func test_map_shape_modulates_budgets_within_its_gain() -> void:
	var composer := EncounterComposer.new(_profile())
	var open_zone := _context(892.7, 1.0, _all())
	open_zone.mean_line_of_sight_m = 60.0
	open_zone.cover_points_per_100m2 = 12.0
	open_zone.entry_count = 8
	var tight := _context(892.7, 1.0, _all())
	tight.mean_line_of_sight_m = 0.0
	tight.cover_points_per_100m2 = 0.0
	tight.entry_count = 0

	var enemy_total := composer.max_enemies(open_zone)
	var open_budgets := composer.budgets_for(open_zone, enemy_total)
	var tight_budgets := composer.budgets_for(tight, enemy_total)
	var gain := _profile().budget_shape_gain
	var base: Array[float] = [93.3333, 51.6667, 46.6667]
	for row: int in 3:
		var nominal := base[row] * float(enemy_total)
		assert_almost_eq(open_budgets[row], nominal * (1.0 + gain), nominal * 0.01,
			"zona abierta: presupuesto %d en el máximo del margen" % row)
		assert_almost_eq(tight_budgets[row], nominal * (1.0 - gain), nominal * 0.01,
			"zona cerrada: presupuesto %d en el mínimo del margen" % row)


## Un arquetipo fuera del reparto de la planta no aparece. El legacy no tenía
## este concepto: mezclaba los tres tipos en todas las plantas.
func test_floor_pool_is_respected() -> void:
	var composer := EncounterComposer.new(_profile())
	var only_thugs := composer.compose(_context(892.7, 1.0, [&"enemy_thug"]))
	assert_gt(float(only_thugs.counts[0]), 0.0, "hay Sicarios")
	assert_eq(only_thugs.counts[1], 0, "no hay Milicianos")
	assert_eq(only_thugs.counts[2], 0, "no hay Veteranos")

	var veterans := composer.compose(_context(892.7, 1.0, [&"enemy_militiaman", &"enemy_veteran"]))
	assert_eq(veterans.counts[0], 0, "sin Sicarios en una planta que no los admite")
	assert_gt(float(veterans.counts[1]), 0.0, "hay Milicianos")
	assert_gt(float(veterans.counts[2]), 0.0, "hay Veteranos")


## A cada arquetipo lo limita un presupuesto DISTINTO, y eso es lo que hace
## que las tres restricciones del original signifiquen algo:
##   * al Sicario lo frena la VELOCIDAD (coeficiente 60, el más caro de los
##     tres en esa fila),
##   * al Veterano lo frena el DAÑO (coeficiente 120).
## Con un solo presupuesto, o con uno solo activo, la formulación se
## reduciría a dividir y no habría nada que optimizar.
func test_each_archetype_is_limited_by_a_different_budget() -> void:
	var composer := EncounterComposer.new(_profile())
	var thugs := composer.compose(_context(2000.0, 1.0, [&"enemy_thug"]))
	var veterans := composer.compose(_context(2000.0, 1.0, [&"enemy_veteran"]))

	var thug_speed := thugs.spent[2] / thugs.budgets[2]
	var thug_damage := thugs.spent[0] / thugs.budgets[0]
	assert_gt(thug_speed, thug_damage, "al Sicario lo limita la velocidad, no el daño")
	assert_gt(thug_speed, 0.9, "y lo limita de verdad: agota ese presupuesto")

	var veteran_damage := veterans.spent[0] / veterans.budgets[0]
	var veteran_speed := veterans.spent[2] / veterans.budgets[2]
	assert_gt(veteran_damage, veteran_speed, "al Veterano lo limita el daño, no la velocidad")
	assert_gt(veteran_damage, 0.9, "y también agota el suyo")


## Si el problema sale infactible se cae a la reserva uniforme, como el
## `E1=E2=E3=MaxEnemies/3` del legacy — pero recortada para CABER en los
## presupuestos, que es lo que el original no hacía.
func test_infeasible_problem_falls_back_to_uniform() -> void:
	var profile := _profile()
	profile.damage_budget_per_enemy = 20.0  # presupuesto imposible a propósito
	var composer := EncounterComposer.new(profile)
	var result := composer.compose(_context(892.7, 1.0, _all()))
	assert_eq(int(result.source), int(EncounterComposer.Source.FALLBACK_UNIFORM),
		"la fuente declara la reserva")
	assert_lt(result.spent[0], result.budgets[0] + 0.001,
		"la reserva cabe en el presupuesto de daño")
	assert_eq(result.counts[0], result.counts[1], "reparto uniforme entre arquetipos")
	assert_eq(result.counts[1], result.counts[2], "reparto uniforme entre arquetipos")


## La composición objetivo suma MaxEnemies y sigue a la forma del mapa.
func test_target_shares_sum_to_one() -> void:
	var composer := EncounterComposer.new(_profile())
	var context := _context(892.7, 1.0, _all())
	var shares := composer.target_shares(context)
	assert_almost_eq(shares[0] + shares[1] + shares[2], 1.0, 0.000001, "los repartos suman 1")
	for index: int in 3:
		assert_between(shares[index], 0.0, 1.0, "reparto %d en rango" % index)

	var restricted := composer.target_shares(_context(892.7, 1.0, [&"enemy_veteran"]))
	assert_almost_eq(restricted[2], 1.0, 0.000001, "con un solo arquetipo, todo el reparto es suyo")
	assert_almost_eq(restricted[0], 0.0, 0.000001, "y los demás no reciben nada")


## El resultado trae los diagnósticos que la consola necesita.
func test_result_carries_diagnostics() -> void:
	var composer := EncounterComposer.new(_profile())
	var result := composer.compose(_context(892.7, 1.0, _all()))
	assert_eq(int(result.source), int(EncounterComposer.Source.SOLVER), "lo decidió el mecanismo")
	assert_gt(float(result.combinations_visited), 0.0, "se recorrió el espacio de búsqueda")
	assert_gt(float(result.feasible_count), 0.0, "y hubo combinaciones viables")
	assert_eq(result.score_terms.size(), 5, "con el desglose de puntuación")
	assert_eq(result.total(), result.counts[0] + result.counts[1] + result.counts[2], "total")
	assert_eq(result.count_for(&"enemy_militiaman"), result.counts[1], "acceso por arquetipo")
	assert_eq(result.count_for(&"no_existe"), 0, "arquetipo desconocido")
	assert_size(result.to_archetype_list(), result.total(), "lista plana de arquetipos")
	assert_true(result.describe().contains("enemigos"), "descripción legible")


## Las referencias de la forma del mapa son DATO: cambiar
## `reference_line_of_sight_m` cambia qué se considera una zona diáfana, y con
## ello la composición. Si alguien vuelve a meter el 30 en código, esto salta.
func test_shape_references_come_from_the_profile() -> void:
	var context := _context(892.7, 1.0, _all())
	context.mean_line_of_sight_m = 30.0

	var strict := _profile()
	strict.reference_line_of_sight_m = 30.0
	var affinity_strict := EncounterComposer.new(strict).shape_affinities(context)

	var lax := _profile()
	lax.reference_line_of_sight_m = 120.0  # ahora 30 m es una zona cerrada
	var affinity_lax := EncounterComposer.new(lax).shape_affinities(context)

	assert_gt(affinity_strict[2], affinity_lax[2],
		"con la referencia estricta, 30 m es diáfano y el Veterano encaja")
	assert_gt(affinity_lax[0], affinity_strict[0],
		"con la referencia laxa, 30 m es cerrado y encaja el Sicario")


## Los pesos de afinidad también son dato: moverlos cambia a qué geometría
## responde cada arquetipo, y por tanto la composición de la misma zona.
func test_affinity_weights_come_from_the_profile() -> void:
	var hall := _context(892.7, 1.0, _all())
	hall.mean_line_of_sight_m = 40.0
	hall.cover_points_per_100m2 = 8.0
	hall.entry_count = 1

	var normal := EncounterComposer.new(_profile()).compose(hall)

	var tuned := _profile()
	# Al Sicario se le sube lo que le atrae de esta zona (los accesos) y al
	# Veterano se le baja (las líneas de tiro largas).
	tuned.thug_entry_weight = 1.0
	tuned.veteran_openness_weight = 0.1
	var retuned := EncounterComposer.new(tuned).compose(hall)

	assert_gt(retuned.share(0), normal.share(0),
		"subir la afinidad del Sicario por los accesos le da más peso")
	assert_lt(retuned.share(2), normal.share(2),
		"bajar la del Veterano por lo diáfano se lo quita")
