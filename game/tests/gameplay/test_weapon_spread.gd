extends TestCase
## Dispersión de `weapon.gd`: sube con cada disparo, se recupera con el
## tiempo, y nunca sale del rango [spread_base_deg, spread_max_deg].

func _make_stats() -> WeaponStats:
	var stats := WeaponStats.new()
	stats.cadence_ms = 100.0
	stats.spread_base_deg = 0.5
	stats.spread_max_deg = 4.0
	stats.spread_per_shot_deg = 1.0
	stats.spread_recovery_deg_per_s = 2.0
	return stats


func test_spread_starts_at_base() -> void:
	var w := Weapon.new(_make_stats())
	assert_almost_eq(w.spread_deg, 0.5, 0.0001, "la dispersión inicial es la de reposo")


func test_spread_grows_with_each_shot() -> void:
	var w := Weapon.new(_make_stats())
	w.register_shot()
	assert_almost_eq(w.spread_deg, 1.5, 0.0001, "sube spread_per_shot_deg tras un disparo")
	w.register_shot()
	assert_almost_eq(w.spread_deg, 2.5, 0.0001, "sigue subiendo con el segundo disparo")


func test_spread_is_clamped_to_max() -> void:
	var w := Weapon.new(_make_stats())
	for i: int in range(10):
		w.register_shot()
	assert_almost_eq(w.spread_deg, 4.0, 0.0001, "no debe superar spread_max_deg pase lo que pase")


func test_spread_recovers_over_time() -> void:
	var w := Weapon.new(_make_stats())
	w.register_shot()
	w.register_shot()
	assert_almost_eq(w.spread_deg, 2.5, 0.0001)
	w.tick(1.0) # 2 deg/s de recuperación durante 1 s
	assert_almost_eq(w.spread_deg, 0.5, 0.0001, "tras 1 s a 2 deg/s recupera hasta la base")


func test_spread_never_recovers_below_base() -> void:
	var w := Weapon.new(_make_stats())
	w.tick(100.0) # mucho tiempo sin disparar
	assert_almost_eq(w.spread_deg, 0.5, 0.0001, "el reposo nunca baja de spread_base_deg")


func test_spread_partial_recovery_between_shots() -> void:
	var w := Weapon.new(_make_stats())
	w.register_shot() # 1.5
	w.tick(0.25) # recupera 0.5 -> 1.0
	assert_almost_eq(w.spread_deg, 1.0, 0.0001, "la recuperación es proporcional al tiempo transcurrido")
