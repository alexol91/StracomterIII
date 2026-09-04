extends TestCase
## El oído se atenúa por COSTE DE CAMINO, no por distancia recta.
##
## Es la prueba que da sentido al oído como información táctica: a la misma
## distancia euclídea, un disparo al otro lado de una pared se oye lejano y el
## mismo disparo al final de un pasillo recto se oye encima.

const WorldQueryFake := preload("res://tests/ai/perception/world_query_fake.gd")

var sensor: HearingSensor = null
var profile: PerceptionProfile = null


func before_each() -> void:
	sensor = HearingSensor.new()
	sensor.listener_id = 7
	profile = PerceptionProfile.new()
	sensor.profile = profile


func _open_world() -> WorldQueryFake:
	var world := WorldQueryFake.new()
	world.bounds = AABB(Vector3(-16.0, 0.0, -16.0), Vector3(32.0, 3.0, 32.0))
	return world


func test_same_euclidean_distance_sounds_farther_behind_a_wall() -> void:
	var listener := Vector3(-6.0, 0.0, 0.0)
	var source := Vector3(6.0, 0.0, 0.0)  # 12 m en línea recta en ambos casos.
	var event := HearingSensor.NoiseEvent.make(source, 1.0, 30.0, 99)

	var open_world := _open_world()
	var open_heard := sensor.evaluate(listener, event, open_world)
	assert_not_null(open_heard, "en campo abierto se oye")

	# Misma geometría, pero con un muro largo que obliga a rodear por el norte.
	var walled := _open_world()
	walled.add_wall(Vector3(0.0, 0.0, -14.0), Vector3(0.0, 0.0, 6.0))
	sensor.push_noise(event)
	var walled_heard := sensor.evaluate(listener, event, walled)
	assert_not_null(walled_heard, "detrás del muro también se oye, pero peor")

	assert_almost_eq(
		open_heard.straight_distance_m,
		walled_heard.straight_distance_m,
		0.0001,
		"la distancia recta es idéntica en los dos casos"
	)
	assert_gt(
		walled_heard.path_cost_m,
		open_heard.path_cost_m + 5.0,
		"rodear el muro cuesta bastante más"
	)
	assert_lt(
		walled_heard.loudness,
		open_heard.loudness,
		"y por tanto se oye más flojo: eso es lo que se quería"
	)


func test_straight_corridor_sounds_close() -> void:
	# Pasillo recto de 2 m de ancho: el coste de camino es casi la recta.
	var world := _open_world()
	world.add_wall(Vector3(-14.0, 0.0, -2.0), Vector3(14.0, 0.0, -2.0))
	world.add_wall(Vector3(-14.0, 0.0, 2.0), Vector3(14.0, 0.0, 2.0))
	var listener := Vector3(-6.0, 0.0, 0.0)
	var event := HearingSensor.NoiseEvent.make(Vector3(6.0, 0.0, 0.0), 1.0, 30.0, 99)
	var heard := sensor.evaluate(listener, event, world)
	assert_not_null(heard, "en un pasillo recto se oye")
	assert_lt(
		heard.path_cost_m,
		heard.straight_distance_m * 1.35,
		"el coste de camino apenas supera la recta"
	)
	assert_gt(heard.loudness, 0.4, "y por eso suena encima")


func test_attenuation_falls_monotonically_with_path_cost() -> void:
	var previous := 1.1
	for cost: int in range(0, 20):
		var value := HearingSensor.attenuation(float(cost), 20.0, profile)
		assert_lt(value, previous, "la atenuación debe caer con el coste")
		previous = value
	assert_almost_eq(
		HearingSensor.attenuation(25.0, 20.0, profile), 0.0, 0.0001, "más allá del radio, nada"
	)


func test_noise_beyond_radius_is_not_heard() -> void:
	var world := _open_world()
	var event := HearingSensor.NoiseEvent.make(Vector3(12.0, 0.0, 0.0), 1.0, 5.0, 99)
	assert_null(sensor.evaluate(Vector3.ZERO, event, world), "12 m con radio 5 m: nada")
	assert_eq(world.path_cost_count, 0, "y ni siquiera se paga la consulta de camino")


func test_without_navmesh_route_the_sound_is_muffled_not_silenced() -> void:
	# Sala sellada: no hay ruta posible hasta el foco.
	var world := _open_world()
	world.add_wall(Vector3(2.0, 0.0, -4.0), Vector3(2.0, 0.0, 4.0))
	world.add_wall(Vector3(2.0, 0.0, -4.0), Vector3(10.0, 0.0, -4.0))
	world.add_wall(Vector3(2.0, 0.0, 4.0), Vector3(10.0, 0.0, 4.0))
	world.add_wall(Vector3(10.0, 0.0, -4.0), Vector3(10.0, 0.0, 4.0))
	var event := HearingSensor.NoiseEvent.make(Vector3(6.0, 0.0, 0.0), 1.0, 40.0, 99)
	var heard := sensor.evaluate(Vector3.ZERO, event, world)
	assert_not_null(heard, "una explosión en una sala sellada se sigue oyendo")
	assert_gt(
		heard.path_cost_m,
		heard.straight_distance_m,
		"pero con el coste penalizado de atravesar geometría"
	)


func test_localization_error_shrinks_as_the_sound_gets_louder() -> void:
	assert_almost_eq(
		HearingSensor.localization_error_m(1.0, profile), 0.0, 0.0001, "a bocajarro, sin error"
	)
	assert_gt(
		HearingSensor.localization_error_m(0.1, profile),
		HearingSensor.localization_error_m(0.9, profile),
		"cuanto más flojo, peor se localiza"
	)


func test_scatter_is_deterministic() -> void:
	var seed_value := HearingSensor.scatter_seed(7, 99, Vector3(3.0, 0.0, -2.0))
	var a := HearingSensor.scatter(Vector3(3.0, 0.0, -2.0), 4.0, seed_value)
	var b := HearingSensor.scatter(Vector3(3.0, 0.0, -2.0), 4.0, seed_value)
	assert_eq(a, b, "el mismo bot se equivoca igual ante la misma situación")
	assert_lt(a.distance_to(Vector3(3.0, 0.0, -2.0)), 4.0001, "el error está acotado al radio")
	var other := HearingSensor.scatter(
		Vector3(3.0, 0.0, -2.0), 4.0, HearingSensor.scatter_seed(8, 99, Vector3(3.0, 0.0, -2.0))
	)
	assert_ne(a, other, "pero dos bots distintos no se equivocan igual")


func test_queue_is_consumed_within_the_tick_budget() -> void:
	var world := _open_world()
	for i: int in 5:
		sensor.push_noise(
			HearingSensor.NoiseEvent.make(Vector3(float(i), 0.0, 1.0), 1.0, 20.0, 100 + i)
		)
	assert_eq(sensor.pending_count(), 5)
	var heard := sensor.process(Vector3.ZERO, world, 2)
	assert_size(heard, 2, "solo se procesan los que caben en el presupuesto")
	assert_eq(sensor.pending_count(), 3, "el resto espera al siguiente tick")


func test_hearing_never_gives_the_certainty_of_seeing() -> void:
	assert_almost_eq(
		HearingSensor.confidence_from(1.0, profile),
		profile.max_sound_confidence,
		0.0001,
		"oír a alguien no es verlo"
	)
	assert_lt(HearingSensor.confidence_from(1.0, profile), 1.0, "y nunca da confianza plena")
