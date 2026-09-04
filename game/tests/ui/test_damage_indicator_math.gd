extends TestCase
## Geometría del indicador de dirección del daño. El original no tenía nada
## parecido (`legacy-gameplay.md` §9.3); en tercera persona es imprescindible.

func test_damage_from_directly_in_front_is_zero() -> void:
	var angle := DamageIndicatorMath.screen_angle_deg(
		Vector3.ZERO, Vector3(0, 0, -1), Vector3(0, 0, -5))
	assert_almost_eq(angle, 0.0, 0.01)


func test_damage_from_the_right_is_ninety() -> void:
	var angle := DamageIndicatorMath.screen_angle_deg(
		Vector3.ZERO, Vector3(0, 0, -1), Vector3(5, 0, 0))
	assert_almost_eq(angle, 90.0, 0.01)


func test_damage_from_the_left_is_minus_ninety() -> void:
	var angle := DamageIndicatorMath.screen_angle_deg(
		Vector3.ZERO, Vector3(0, 0, -1), Vector3(-5, 0, 0))
	assert_almost_eq(angle, -90.0, 0.01)


func test_damage_from_behind_is_180() -> void:
	var angle := DamageIndicatorMath.screen_angle_deg(
		Vector3.ZERO, Vector3(0, 0, -1), Vector3(0, 0, 5))
	assert_almost_eq(absf(angle), 180.0, 0.01)


func test_is_independent_of_player_position_offset() -> void:
	var angle := DamageIndicatorMath.screen_angle_deg(
		Vector3(10, 0, 20), Vector3(0, 0, -1), Vector3(15, 0, 20))
	assert_almost_eq(angle, 90.0, 0.01)


func test_source_at_player_position_is_zero_not_a_crash() -> void:
	var angle := DamageIndicatorMath.screen_angle_deg(
		Vector3(3, 0, 3), Vector3(0, 0, -1), Vector3(3, 0, 3))
	assert_almost_eq(angle, 0.0, 0.01)
