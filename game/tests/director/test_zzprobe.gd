extends TestCase

func _ctx(area_m2: float, dif: float, los: float, cover: float, entries: int, pool: Array[StringName]) -> EncounterContext:
	var c := EncounterContext.new()
	c.navigable_area_m2 = area_m2
	c.floor_difficulty = dif
	c.mean_line_of_sight_m = los
	c.cover_points_per_100m2 = cover
	c.entry_count = entries
	c.allowed_archetypes = pool
	return c

func test_probe() -> void:
	var all: Array[StringName] = [&"enemy_thug", &"enemy_militiaman", &"enemy_veteran"]
	var composer := EncounterComposer.new()
	for area: float in [200.0, 500.0, 892.7, 2000.0, 5000.0]:
		var c := _ctx(area, 1.0, 15.0, 3.0, 2, all)
		var r := composer.compose(c)
		print("area=%.0f N=%d -> %s spent=%s budgets=%s nodes=%d" % [area, r.max_enemies, str(r.counts), str(r.spent), str(r.budgets), r.nodes_explored])
	print("--- forma del mapa, N fijo (area 892.7) ---")
	for shape: Array in [[5.0, 1.0, 5], [15.0, 3.0, 2], [40.0, 8.0, 1]]:
		var c := _ctx(892.7, 1.0, shape[0], shape[1], int(shape[2]), all)
		var r := composer.compose(c)
		print("los=%.0f cover=%.0f entries=%d -> %s objetivo=%s dom=%.2f" % [shape[0], shape[1], int(shape[2]), str(r.counts), str(r.target_counts), r.dominant_share()])
	print("--- legacy vs nueva ---")
	composer.legacy_formulation = true
	for area: float in [500.0, 892.7, 2000.0]:
		var r := composer.compose(_ctx(area, 1.0, 15.0, 3.0, 2, all))
		print("LEGACY area=%.0f N=%d -> %s dom=%.2f estado=%s" % [area, r.max_enemies, str(r.counts), r.dominant_share(), IntegerSimplex.status_name(r.solver_status)])
	print("--- pools restringidos (formulacion nueva) ---")
	composer.legacy_formulation = false
	for pool: Array[StringName] in [[&"enemy_thug"] as Array[StringName], [&"enemy_militiaman", &"enemy_veteran"] as Array[StringName], [&"enemy_veteran"] as Array[StringName]]:
		var r := composer.compose(_ctx(892.7, 1.0, 15.0, 3.0, 2, pool))
		print("pool=%s -> %s total=%d estado=%s" % [str(pool), str(r.counts), r.total(), IntegerSimplex.status_name(r.solver_status)])
	assert_true(true, "sonda")
