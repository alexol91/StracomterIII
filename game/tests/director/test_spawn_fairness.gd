extends TestCase
## Reglas de aparición justa.
##
## El original elegía un incentro de triángulo al azar y lo aceptaba si
## estaba a más de 200 px del jugador —unos 2,7 m, o sea, en su cara— sin
## mirar el cono de visión ni la línea de visión
## (`legacy/trunk/Optimization/lib/Optimization.cc:144-168`). Aquí se
## comprueba que ninguna aparición viola las cuatro reglas del GDD §7.


## Doble de prueba del proveedor. Devuelve candidatos descritos a mano: la
## implementación real (navmesh, rayos) es de `ai-navegacion`, y la costura
## está puesta justo para no necesitarla aquí.
class FakeProvider:
	extends SpawnPointProvider

	var candidates: Array[SpawnPointProvider.SpawnCandidate] = []
	var ready: bool = true

	func sample_candidates(_request: SpawnPointProvider.SpawnRequest) -> Array[SpawnPointProvider.SpawnCandidate]:
		return candidates

	func is_ready() -> bool:
		return ready


func _request() -> SpawnPointProvider.SpawnRequest:
	var request := SpawnPointProvider.SpawnRequest.new()
	# Las reglas de justicia salen del perfil, como en el juego.
	request.apply_profile(Balance.director_profile())
	request.player_position = Vector3.ZERO
	request.player_forward = Vector3(0.0, 0.0, -1.0)
	request.count = 4
	return request


func _candidate(
	position: Vector3,
	path_distance: float,
	line_of_sight: bool,
	navigable: bool = true,
	entry: bool = false
) -> SpawnPointProvider.SpawnCandidate:
	var candidate := SpawnPointProvider.SpawnCandidate.new(position)
	candidate.path_distance_m = path_distance
	candidate.has_line_of_sight_to_player = line_of_sight
	candidate.navigable = navigable
	candidate.is_entry_point = entry
	return candidate


## Las cuatro reglas, una a una.
func test_each_fairness_rule_rejects_on_its_own() -> void:
	var request := _request()
	var good := _candidate(Vector3(0.0, 0.0, 20.0), 25.0, false)
	assert_true(SpawnPointProvider.is_fair(good, request), "un punto correcto se acepta")

	assert_false(
		SpawnPointProvider.is_fair(_candidate(Vector3(0.0, 0.0, 20.0), 25.0, false, false), request),
		"fuera del navmesh se rechaza")
	assert_false(
		SpawnPointProvider.is_fair(_candidate(Vector3(0.0, 0.0, 5.0), 25.0, false), request),
		"a menos de 12 m en línea recta se rechaza")
	assert_false(
		SpawnPointProvider.is_fair(_candidate(Vector3(0.0, 0.0, 20.0), 25.0, true), request),
		"con línea de visión directa se rechaza")
	assert_false(
		SpawnPointProvider.is_fair(_candidate(Vector3(0.0, 0.0, -20.0), 25.0, false), request),
		"dentro del cono de visión del jugador se rechaza")
	assert_false(
		SpawnPointProvider.is_fair(_candidate(Vector3(0.0, 0.0, 20.0), INF, false), request),
		"sin ruta hasta el jugador se rechaza")


## La distancia mínima se mide TAMBIÉN en línea recta: la de camino, por sí
## sola, aceptaría un punto pegado al jugador al otro lado de un tabique.
func test_euclidean_distance_is_checked_not_only_path_distance() -> void:
	var request := _request()
	var behind_a_wall := _candidate(Vector3(0.0, 0.0, 3.0), 40.0, false)
	assert_gt(behind_a_wall.path_distance_m, request.min_distance_m,
		"el punto está lejos por camino")
	assert_false(SpawnPointProvider.is_fair(behind_a_wall, request),
		"pero a 3 m en recta sigue siendo injusto")


## El cono se mide en el plano horizontal, como la cámara del jugador.
func test_view_cone_geometry() -> void:
	var request := _request()
	assert_true(SpawnPointProvider.is_inside_view_cone(Vector3(0.0, 0.0, -30.0), request),
		"justo delante está dentro")
	assert_true(SpawnPointProvider.is_inside_view_cone(Vector3(-20.0, 0.0, -30.0), request),
		"a 34° del eje está dentro")
	assert_false(SpawnPointProvider.is_inside_view_cone(Vector3(30.0, 0.0, 0.0), request),
		"a 90° está fuera")
	assert_false(SpawnPointProvider.is_inside_view_cone(Vector3(0.0, 0.0, 30.0), request),
		"a la espalda está fuera")
	assert_true(SpawnPointProvider.is_inside_view_cone(Vector3(0.0, 40.0, -30.0), request),
		"la altura no saca del cono: se mide en planta")


## FUZZ: mil candidatos aleatorios con semilla fija. NINGUNO de los elegidos
## puede violar ninguna regla.
func test_no_selected_spawn_ever_violates_the_rules() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 20120611
	var request := _request()
	request.count = 8

	var candidates: Array[SpawnPointProvider.SpawnCandidate] = []
	for _i: int in 1000:
		var position := Vector3(
			rng.randf_range(-60.0, 60.0), rng.randf_range(-5.0, 5.0), rng.randf_range(-60.0, 60.0))
		var candidate := _candidate(
			position,
			position.length() * rng.randf_range(1.0, 2.5),
			rng.randf() < 0.4,
			rng.randf() < 0.9,
			rng.randf() < 0.15
		)
		candidates.append(candidate)

	var chosen := SpawnPointProvider.select(candidates, request, rng)
	assert_gt(float(chosen.size()), 0.0, "se elige algo")
	for candidate: SpawnPointProvider.SpawnCandidate in chosen:
		assert_true(candidate.navigable, "elegido navegable")
		assert_gte(candidate.position.distance_to(request.player_position), request.min_distance_m,
			"elegido a 12 m o más")
		assert_false(candidate.has_line_of_sight_to_player, "elegido sin línea de visión")
		assert_false(SpawnPointProvider.is_inside_view_cone(candidate.position, request),
			"elegido fuera del cono")
		assert_true(is_finite(candidate.path_distance_m), "elegido con ruta")


func assert_gte(actual: float, limit: float, message: String) -> void:
	assert_true(actual >= limit, "%s (%.3f >= %.3f)" % [message, actual, limit])


## No se elige dos veces el mismo punto: dos enemigos no aparecen encima uno
## del otro.
func test_selection_has_no_repeats() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	var request := _request()
	request.count = 5
	var candidates: Array[SpawnPointProvider.SpawnCandidate] = []
	for index: int in 12:
		candidates.append(_candidate(
			Vector3(20.0 + float(index), 0.0, 20.0), 25.0 + float(index), false))
	var chosen := SpawnPointProvider.select(candidates, request, rng)
	assert_eq(chosen.size(), 5, "se eligen los cinco pedidos")
	var seen: Array[Vector3] = []
	for candidate: SpawnPointProvider.SpawnCandidate in chosen:
		assert_false(seen.has(candidate.position), "sin repetir posición")
		seen.append(candidate.position)


## El peso decae con la distancia de CAMINO y premia los accesos reales.
func test_weighting_prefers_close_paths_and_real_entrances() -> void:
	var request := _request()
	var near := _candidate(Vector3(0.0, 0.0, 20.0), 15.0, false)
	var far := _candidate(Vector3(0.0, 0.0, 20.0), 90.0, false)
	assert_gt(SpawnPointProvider.weight_of(near, request),
		SpawnPointProvider.weight_of(far, request),
		"un punto a 90 m de camino pesa menos que uno a 15")

	var entrance := _candidate(Vector3(0.0, 0.0, 20.0), 15.0, false, true, true)
	assert_almost_eq(
		SpawnPointProvider.weight_of(entrance, request),
		SpawnPointProvider.weight_of(near, request) * request.entry_point_weight_bonus,
		0.000001,
		"un acceso real pesa el doble")

	request.prefer_entry_points = false
	assert_almost_eq(SpawnPointProvider.weight_of(entrance, request),
		SpawnPointProvider.weight_of(near, request), 0.000001,
		"si no se prefieren accesos, el bono no se aplica")


## Determinismo: la misma semilla elige exactamente los mismos puntos.
func test_selection_is_deterministic_for_a_given_seed() -> void:
	var request := _request()
	var candidates: Array[SpawnPointProvider.SpawnCandidate] = []
	for index: int in 30:
		candidates.append(_candidate(
			Vector3(15.0 + float(index), 0.0, 15.0 + float(index)),
			20.0 + float(index) * 3.0,
			false,
			true,
			index % 5 == 0
		))
	var reference: Array[Vector3] = []
	for run: int in 100:
		var rng := RandomNumberGenerator.new()
		rng.seed = 4242
		var chosen := SpawnPointProvider.select(candidates, request, rng)
		var positions: Array[Vector3] = []
		for candidate: SpawnPointProvider.SpawnCandidate in chosen:
			positions.append(candidate.position)
		if run == 0:
			reference = positions
		assert_eq(positions, reference, "misma selección en la iteración %d" % run)


## La clase base es un contrato vacío a propósito: si alguien la usa sin
## implementarla, no genera nada en lugar de generar en el sitio equivocado.
func test_base_provider_is_an_empty_contract() -> void:
	var provider := SpawnPointProvider.new()
	assert_false(provider.is_ready(), "la base no está lista")
	assert_size(provider.sample_candidates(_request()), 0, "no propone candidatos")
	assert_size(provider.entry_points(0), 0, "no conoce accesos")
	assert_false(is_finite(provider.path_distance(Vector3.ZERO, Vector3.ONE)),
		"no sabe medir caminos")

	var fake := FakeProvider.new()
	fake.candidates = [_candidate(Vector3(0.0, 0.0, 20.0), 25.0, false)]
	assert_true(fake.is_ready(), "el doble sí está listo")
	assert_size(fake.sample_candidates(_request()), 1, "y propone su candidato")


## Una petición sin perfil aplicado no genera NADA. El valor por defecto de
## una regla de justicia no puede ser permisivo.
func test_unconfigured_request_spawns_nothing() -> void:
	var raw := SpawnPointProvider.SpawnRequest.new()
	raw.count = 4
	var candidate := _candidate(Vector3(0.0, 0.0, 40.0), 45.0, false)
	assert_false(raw.configured, "la petición en crudo no está configurada")
	assert_false(SpawnPointProvider.is_fair(candidate, raw),
		"y por tanto ningún punto le parece justo")
	var rng := RandomNumberGenerator.new()
	rng.seed = 1
	assert_size(SpawnPointProvider.select([candidate], raw, rng), 0, "no elige nada")

	raw.apply_profile(Balance.director_profile())
	assert_true(raw.configured, "aplicando el perfil sí queda configurada")
	assert_true(SpawnPointProvider.is_fair(candidate, raw), "y el punto pasa")
