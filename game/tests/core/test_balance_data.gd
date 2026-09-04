extends TestCase
## Comprueba la integridad de los datos de balanceo (ADR-005).
## El original tenía las estadísticas triplicadas y contradictorias en tres
## ficheros; esta prueba existe para que eso no vuelva a pasar.

func test_playable_archetypes_exist() -> void:
	for id: StringName in [&"captain", &"technician", &"specialist", &"demolition"]:
		assert_not_null(Balance.character(id), "falta el arquetipo jugable '%s'" % id)


func test_enemy_archetypes_exist() -> void:
	for id: StringName in [&"enemy_thug", &"enemy_militiaman", &"enemy_veteran",
			&"miniboss", &"megaboss"]:
		assert_not_null(Balance.character(id), "falta el arquetipo '%s'" % id)


func test_canonical_values_match_f1_xml() -> void:
	# Valores en vigor del original: legacy/trunk/testFiles/features/f1.xml.
	# Las constantes de CoreNamespace.h vivían en una rama inalcanzable.
	var captain := Balance.character(&"captain")
	assert_eq(captain.max_health, 160.0, "HP del capitán según f1.xml")
	assert_eq(captain.speed_legacy, 400.0, "velocidad del capitán según f1.xml")
	assert_eq(captain.cadence_ms, 100.0, "cadencia del capitán según f1.xml")
	var veteran := Balance.character(&"enemy_veteran")
	assert_eq(veteran.damage, 2.0, "daño del veterano según f1.xml (no 4, que era el header)")
	assert_eq(veteran.cadence_ms, 600.0, "cadencia del veterano según f1.xml")


func test_every_floor_has_six_zones() -> void:
	for n: int in range(GameState.FIRST_FLOOR, GameState.ROOFTOP_FLOOR + 1):
		var cfg := Balance.floor_config(n)
		assert_not_null(cfg, "falta la planta %d" % n)
		if cfg == null:
			continue
		assert_size(cfg.zone_maps, GameState.ZONES_PER_FLOOR, "mapas de la planta %d" % n)
		assert_size(cfg.zone_rewards, GameState.ZONES_PER_FLOOR, "recompensas de la planta %d" % n)


func test_zone_rewards_match_original() -> void:
	# Réplica exacta de GameStatus::selectZona (legacy).
	var expected: Array[StringName] = [
		&"ammo_pack_1", &"health_pack_1", &"ammo_pack_2",
		&"health_pack_2", &"ammo_pack_3", &"health_pack_3",
	]
	var cfg := Balance.floor_config(1)
	assert_not_null(cfg)
	if cfg == null:
		return
	for i: int in range(expected.size()):
		assert_eq(cfg.zone_rewards[i], expected[i], "recompensa de la zona %d" % (i + 1))


func test_director_profile_keeps_legacy_coefficients() -> void:
	# ADR-003: los coeficientes originales se conservan como dato para poder
	# comparar la formulación de 2012 con la nueva.
	var profile := Balance.director_profile()
	assert_not_null(profile)
	if profile == null:
		return
	assert_eq(profile.damage_coefficients[0], 60.0)
	assert_eq(profile.damage_coefficients[1], 100.0)
	assert_eq(profile.damage_coefficients[2], 120.0)
	assert_eq(profile.health_coefficients[1], 50.0)
	assert_eq(profile.speed_coefficients[2], 35.0)


func test_speed_conversion_to_meters() -> void:
	# Radio de personaje 30 u = 0,4 m  ⇒  1 u = 1/75 m
	var captain := Balance.character(&"captain")
	assert_almost_eq(captain.speed_mps(), 400.0 / 75.0, 0.001,
		"velocidad del capitán en m/s")
