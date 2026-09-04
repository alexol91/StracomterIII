extends TestCase
## Formato puro del HUD: tiempo y brújula de planta (GDD §10).

func test_format_time_basic_cases() -> void:
	assert_eq(HudFormat.format_time(0.0), "00:00")
	assert_eq(HudFormat.format_time(5.0), "00:05")
	assert_eq(HudFormat.format_time(65.0), "01:05")
	assert_eq(HudFormat.format_time(600.0), "10:00")


func test_format_time_clamps_negative_to_zero() -> void:
	assert_eq(HudFormat.format_time(-3.0), "00:00")


func test_format_time_caps_at_5959_instead_of_overflowing_to_hours() -> void:
	assert_eq(HudFormat.format_time(4000.0), "59:59")


func test_heading_from_forward_cardinal_directions() -> void:
	# Convención del proyecto: -Z es "norte" (0°), sentido horario visto desde arriba.
	assert_almost_eq(HudFormat.heading_deg_from_forward(Vector3(0, 0, -1)), 0.0, 0.01)
	assert_almost_eq(HudFormat.heading_deg_from_forward(Vector3(1, 0, 0)), 90.0, 0.01)
	assert_almost_eq(HudFormat.heading_deg_from_forward(Vector3(0, 0, 1)), 180.0, 0.01)
	assert_almost_eq(HudFormat.heading_deg_from_forward(Vector3(-1, 0, 0)), 270.0, 0.01)


func test_heading_from_zero_vector_defaults_to_north() -> void:
	assert_almost_eq(HudFormat.heading_deg_from_forward(Vector3.ZERO), 0.0, 0.01)


func test_cardinal_key_for_heading_matches_eight_points() -> void:
	assert_eq(HudFormat.cardinal_key_for_heading(0.0), &"HUD_COMPASS_N")
	assert_eq(HudFormat.cardinal_key_for_heading(45.0), &"HUD_COMPASS_NE")
	assert_eq(HudFormat.cardinal_key_for_heading(90.0), &"HUD_COMPASS_E")
	assert_eq(HudFormat.cardinal_key_for_heading(135.0), &"HUD_COMPASS_SE")
	assert_eq(HudFormat.cardinal_key_for_heading(180.0), &"HUD_COMPASS_S")
	assert_eq(HudFormat.cardinal_key_for_heading(225.0), &"HUD_COMPASS_SW")
	assert_eq(HudFormat.cardinal_key_for_heading(270.0), &"HUD_COMPASS_W")
	assert_eq(HudFormat.cardinal_key_for_heading(315.0), &"HUD_COMPASS_NW")
	# Envolvente: 359° debe redondear de vuelta a norte, no a un índice fuera de rango.
	assert_eq(HudFormat.cardinal_key_for_heading(359.0), &"HUD_COMPASS_N")
