extends TestCase
## La pantalla de Estrategia es la entrega más importante de este agente:
## estas pruebas fijan que las 6 zonas muestran la recompensa EXACTA de
## `FloorConfig`/`Balance` (GDD §6) y no un número inventado.


func test_map_scale_detects_small_medium_large() -> void:
	assert_eq(ZoneThreatReading.map_scale_for_path("res://maps/legacy/mapP1.tscn"),
		ZoneThreatReading.MapScale.SMALL)
	assert_eq(ZoneThreatReading.map_scale_for_path("res://maps/legacy/mapM3.tscn"),
		ZoneThreatReading.MapScale.MEDIUM)
	assert_eq(ZoneThreatReading.map_scale_for_path("res://maps/legacy/mapG2.tscn"),
		ZoneThreatReading.MapScale.LARGE)
	assert_eq(ZoneThreatReading.map_scale_for_path("res://maps/legacy/finalMap.tscn"),
		ZoneThreatReading.MapScale.LARGE)
	assert_eq(ZoneThreatReading.map_scale_for_path("res://maps/legacy/rooftop.tscn"),
		ZoneThreatReading.MapScale.LARGE)


func test_threat_flavor_key_defined_for_all_six_zones() -> void:
	var keys: Array[StringName] = []
	for zone: int in range(1, 7):
		var key := ZoneThreatReading.threat_flavor_key(zone)
		assert_ne(key, &"", "la zona %d debería tener lectura de amenaza" % zone)
		assert_false(keys.has(key), "las 6 zonas deberían tener lecturas distintas")
		keys.append(key)


func test_threat_flavor_key_out_of_range_is_empty() -> void:
	assert_eq(ZoneThreatReading.threat_flavor_key(0), &"")
	assert_eq(ZoneThreatReading.threat_flavor_key(7), &"")


func test_reward_pickup_matches_floor_config_exactly() -> void:
	var cfg := Balance.floor_config(1)
	assert_not_null(cfg, "la planta 1 debe existir en los datos")
	for zone: int in range(1, 7):
		var expected_id: StringName = cfg.zone_rewards[zone - 1]
		var pickup := ZoneThreatReading.reward_pickup(cfg, zone)
		assert_not_null(pickup, "zona %d debería tener recompensa" % zone)
		assert_eq(pickup.id, expected_id)


## GDD §6: zonas 1/3/5 dan munición 20/50/100; zonas 2/4/6 dan vida 20/50/100.
## Esto viene de datos (`Balance.pickup`), no de un literal: si algún día
## cambia `ammo_pack_2.amount`, esta prueba debe seguir en verde con el nuevo
## valor y solo fallar si `FloorConfig`/`Balance` dejan de estar de acuerdo.
func test_floor_1_reward_amounts_match_gdd_table() -> void:
	var cfg := Balance.floor_config(1)
	var expected_amounts := [20.0, 20.0, 50.0, 50.0, 100.0, 100.0]
	for zone: int in range(1, 7):
		var pickup := ZoneThreatReading.reward_pickup(cfg, zone)
		assert_almost_eq(pickup.amount, expected_amounts[zone - 1],
			0.001, "cantidad de recompensa de la zona %d" % zone)


func test_has_boss_presence_only_on_large_maps_of_floors_with_miniboss() -> void:
	var cfg := Balance.floor_config(3) # has_miniboss = true, zonas 3-6 son mapG3
	assert_not_null(cfg)
	assert_true(cfg.has_miniboss)
	assert_false(ZoneThreatReading.has_boss_presence(cfg, 1), "zona 1 es mapa pequeño")
	assert_true(ZoneThreatReading.has_boss_presence(cfg, 3), "zona 3 de la planta 3 es mapa grande")
	assert_true(ZoneThreatReading.has_boss_presence(cfg, 6))

	var floor_without_boss := Balance.floor_config(1)
	assert_false(floor_without_boss.has_miniboss)
	for zone: int in range(1, 7):
		assert_false(ZoneThreatReading.has_boss_presence(floor_without_boss, zone),
			"la planta 1 no tiene miniboss")


func test_reward_format_key_matches_pickup_effect() -> void:
	var ammo := Balance.pickup(&"ammo_pack_1")
	var health := Balance.pickup(&"health_pack_1")
	assert_eq(ZoneThreatReading.reward_format_key(ammo), &"STRATEGY_REWARD_AMMO_FMT")
	assert_eq(ZoneThreatReading.reward_format_key(health), &"STRATEGY_REWARD_HEALTH_FMT")
