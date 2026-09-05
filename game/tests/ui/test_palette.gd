extends TestCase
## Comprobaciones puras de `Palette` (encargo "listón visual"): que el
## naranja de amenaza sea EXACTAMENTE el especificado y que la curva de color
## de vida vaya de sana a alerta sin overshoot fuera de [0,1].

func test_threat_orange_matches_the_briefed_hex() -> void:
	# #FF7A3D
	assert_almost_eq(Palette.THREAT_ORANGE.r, 1.0, 0.01)
	assert_almost_eq(Palette.THREAT_ORANGE.g, 0.478, 0.01)
	assert_almost_eq(Palette.THREAT_ORANGE.b, 0.239, 0.01)


func test_tower_blue_matches_the_briefed_hex() -> void:
	# #4DA3FF
	assert_almost_eq(Palette.TOWER_BLUE.r, 0.302, 0.01)
	assert_almost_eq(Palette.TOWER_BLUE.g, 0.639, 0.01)
	assert_almost_eq(Palette.TOWER_BLUE.b, 1.0, 0.01)


func test_health_color_is_full_health_tone_at_fraction_one() -> void:
	var c := Palette.health_color(1.0)
	assert_almost_eq(c.r, Palette.HEALTH_FULL.r, 0.05)
	assert_almost_eq(c.g, Palette.HEALTH_FULL.g, 0.05)
	assert_almost_eq(c.b, Palette.HEALTH_FULL.b, 0.05)


func test_health_color_approaches_alert_tone_near_zero() -> void:
	var c := Palette.health_color(0.0)
	assert_almost_eq(c.r, Palette.HEALTH_LOW.r, 0.05)
	assert_almost_eq(c.g, Palette.HEALTH_LOW.g, 0.05)
	assert_almost_eq(c.b, Palette.HEALTH_LOW.b, 0.05)


func test_health_color_never_produces_out_of_range_channels() -> void:
	var steps := 20
	for i: int in range(steps + 1):
		var fraction := float(i) / float(steps)
		var c := Palette.health_color(fraction)
		assert_true(c.r >= 0.0 and c.r <= 1.0, "r fuera de rango en %f" % fraction)
		assert_true(c.g >= 0.0 and c.g <= 1.0, "g fuera de rango en %f" % fraction)
		assert_true(c.b >= 0.0 and c.b <= 1.0, "b fuera de rango en %f" % fraction)
