extends TestCase
## `SpawnSampler` como implementación de `SpawnPointProvider` (GDD §7).
##
## El reparto es: el muestreador MIDE el mundo, el director DECIDE. Así que
## aquí se prueban dos cosas distintas y ninguna es "reimplementar la justicia":
##   1. que los datos medidos son correctos (navegable, distancia de CAMINO,
##      línea de visión, acceso real),
##   2. que la combinación muestreador + reglas del director no produce ni una
##      sola aparición injusta.
##
## El legacy hacía aparecer enemigos a más de **200 unidades** del jugador
## (`Optimization.cc:152`), que a la escala del remake son 2,7 m: literalmente
## en su cara, a veces dentro de su campo de visión. Esta prueba existe para
## que eso no vuelva a pasar por accidente.
##
## Escenario: anillo de 32×32 m con un bloque macizo de 20×20 en el centro. El
## jugador está en el corredor oeste mirando al norte, así que hay:
##   * corredor norte -> dentro del cono de visión,
##   * corredor sur   -> con línea de visión directa por el pasillo,
##   * corredor este  -> lejos, sin visión y sin cono: el sitio correcto.

const OUTER_HALF_M: float = 16.0
const BLOCK_HALF_M: float = 10.0
const PLAYER_POSITION: Vector3 = Vector3(-13.0, 0.0, 0.0)
## Mirando al norte (−Z), que es el convenio de Godot para "hacia delante".
const PLAYER_FORWARD: Vector3 = Vector3(0.0, 0.0, -1.0)
const RNG_SEED: int = 20261234
## Valores de perfil de la petición. Se fijan en la prueba y NO en `NavTuning`:
## las reglas de justicia son del `DirectorProfile`.
const REQUEST_MIN_DISTANCE_M: float = 12.0
const REQUEST_FOV_HALF_ANGLE_DEG: float = 70.0
const REQUEST_FALLOFF_M: float = 20.0
const REQUEST_ENTRY_BONUS: float = 4.0


func test_los_candidatos_medidos_pasan_el_filtro_del_director() -> void:
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var sampler := SpawnSampler.new()
	sampler.setup(world.nav, world)
	assert_gt(float(sampler.build_candidates(world.mesh)), 0.0,
		"el muestreo del navmesh no puede salir vacío")
	var rng := RandomNumberGenerator.new()
	rng.seed = RNG_SEED
	sampler.set_rng(rng)

	var request := NavTestUtil.spawn_request(
		PLAYER_POSITION, PLAYER_FORWARD, 4, REQUEST_MIN_DISTANCE_M,
		REQUEST_FOV_HALF_ANGLE_DEG, REQUEST_FALLOFF_M, REQUEST_ENTRY_BONUS)
	var candidates := sampler.sample_candidates(request)
	assert_gt(float(candidates.size()), 0.0, "no se midió ni un candidato")

	var chosen := SpawnPointProvider.select(candidates, request, rng)
	assert_gt(float(chosen.size()), 0.0,
		"un anillo de 32 m tiene sitios legales de sobra; no salió ninguno")
	for candidate: SpawnPointProvider.SpawnCandidate in chosen:
		var p := candidate.position
		assert_gt(p.distance_to(PLAYER_POSITION), REQUEST_MIN_DISTANCE_M,
			"aparición a %f m del jugador: el mínimo son %f"
			% [p.distance_to(PLAYER_POSITION), REQUEST_MIN_DISTANCE_M])
		assert_false(SpawnPointProvider.is_inside_view_cone(p, request),
			"aparición dentro del cono de visión del jugador, en %s" % p)
		assert_false(world.has_line_of_sight(
				PLAYER_POSITION + Vector3.UP * NavTuning.SPAWN_EYE_HEIGHT_M,
				p + Vector3.UP * NavTuning.SPAWN_EYE_HEIGHT_M),
			"aparición a la vista del jugador, en %s" % p)
	world.dispose()


func test_la_distancia_medida_es_de_camino_y_no_euclidea() -> void:
	# Es la diferencia entre "a 26 m en línea recta" y "a 52 m rodeando el
	# bloque". El reparto del director pondera con la de camino, así que si
	# aquí se midiera la euclídea el peso estaría mal en todo el mapa.
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var sampler := SpawnSampler.new()
	sampler.setup(world.nav, world)
	sampler.build_candidates(world.mesh)
	var far_side := Vector3(13.0, 0.0, 0.0)
	var straight := PLAYER_POSITION.distance_to(far_side)
	var walked := sampler.path_distance(PLAYER_POSITION, far_side)
	assert_false(is_inf(walked), "por el anillo se llega")
	assert_gt(walked, straight * 1.5,
		"rodeando el bloque se anda mucho más (recta %f, camino %f)"
		% [straight, walked])
	world.dispose()


func test_marca_la_linea_de_vision_y_la_navegabilidad_de_cada_candidato() -> void:
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var sampler := SpawnSampler.new()
	sampler.setup(world.nav, world)
	sampler.build_candidates(world.mesh)
	var rng := RandomNumberGenerator.new()
	rng.seed = RNG_SEED
	sampler.set_rng(rng)
	var request := NavTestUtil.spawn_request(
		PLAYER_POSITION, PLAYER_FORWARD, 4, REQUEST_MIN_DISTANCE_M,
		REQUEST_FOV_HALF_ANGLE_DEG, REQUEST_FALLOFF_M, REQUEST_ENTRY_BONUS)
	var candidates := sampler.sample_candidates(request)
	assert_gt(float(candidates.size()), 0.0, "no se midió ni un candidato")
	var checked := 0
	for candidate: SpawnPointProvider.SpawnCandidate in candidates:
		assert_true(candidate.navigable,
			"un candidato salido del navmesh tiene que ser navegable")
		var expected := world.has_line_of_sight(
			PLAYER_POSITION + Vector3.UP * NavTuning.SPAWN_EYE_HEIGHT_M,
			candidate.position + Vector3.UP * NavTuning.SPAWN_EYE_HEIGHT_M)
		assert_eq(candidate.has_line_of_sight_to_player, expected,
			"la línea de visión medida no coincide con el mundo en %s"
			% candidate.position)
		checked += 1
	assert_gt(float(checked), 0.0, "no se comprobó ni un candidato")
	world.dispose()


func test_una_peticion_sin_perfil_no_produce_nada() -> void:
	# Regla del director: el valor por defecto de una regla de justicia no
	# puede ser permisivo. Si nadie aplicó el perfil, no se mide ni se genera.
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var sampler := SpawnSampler.new()
	sampler.setup(world.nav, world)
	sampler.build_candidates(world.mesh)
	var request := SpawnPointProvider.SpawnRequest.new()
	request.player_position = PLAYER_POSITION
	request.player_forward = PLAYER_FORWARD
	request.count = 4
	assert_false(request.configured, "la petición no lleva perfil aplicado")
	assert_size(sampler.sample_candidates(request), 0,
		"sin perfil no se mide el mundo ni se proponen apariciones")
	world.dispose()


func test_marca_los_accesos_reales() -> void:
	# Un enemigo que sale por una puerta se lee como un refuerzo; uno que se
	# materializa en mitad de la sala se lee como un fallo del motor. El
	# muestreador sólo marca cuáles son accesos; ponderarlos es del director.
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var sampler := SpawnSampler.new()
	sampler.setup(world.nav, world)
	sampler.build_candidates(world.mesh, 1.5)
	var door := Vector3(13.5, 0.0, 0.0)
	sampler.set_access_points(PackedVector3Array([door]))
	assert_eq(sampler.access_point_count(), 1, "el acceso debe registrarse")
	assert_eq(sampler.entry_points(0).size(), 1,
		"el contrato del director pide los accesos por zona")

	var rng := RandomNumberGenerator.new()
	rng.seed = RNG_SEED
	sampler.set_rng(rng)
	var request := NavTestUtil.spawn_request(
		PLAYER_POSITION, PLAYER_FORWARD, 4, REQUEST_MIN_DISTANCE_M,
		REQUEST_FOV_HALF_ANGLE_DEG, REQUEST_FALLOFF_M, REQUEST_ENTRY_BONUS)
	var marked := 0
	var mismarked := 0
	for _run in 8:
		for candidate: SpawnPointProvider.SpawnCandidate in sampler.sample_candidates(request):
			var near := candidate.position.distance_to(door) <= NavTuning.SPAWN_ACCESS_RADIUS_M
			if candidate.is_entry_point:
				marked += 1
				if not near:
					mismarked += 1
	assert_gt(float(marked), 0.0,
		"ningún candidato junto a la puerta se marcó como acceso")
	assert_eq(mismarked, 0,
		"se marcaron como acceso puntos que no están junto a ninguno")
	world.dispose()


func test_no_gasta_consultas_de_camino_en_puntos_demasiado_cercanos() -> void:
	# El atajo usa el `min_distance_m` DE LA PETICIÓN, no una constante propia:
	# no puede divergir de la regla del director, sólo le ahorra trabajo.
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var sampler := SpawnSampler.new()
	sampler.setup(world.nav, world)
	sampler.build_candidates(world.mesh)
	var rng := RandomNumberGenerator.new()
	rng.seed = RNG_SEED
	sampler.set_rng(rng)
	var request := NavTestUtil.spawn_request(
		PLAYER_POSITION, PLAYER_FORWARD, 4, REQUEST_MIN_DISTANCE_M,
		REQUEST_FOV_HALF_ANGLE_DEG, REQUEST_FALLOFF_M, REQUEST_ENTRY_BONUS)
	var candidates := sampler.sample_candidates(request)
	assert_gt(float(sampler.stat_last_skipped_near), 0.0,
		"con el jugador dentro del mapa tiene que haber puntos demasiado cerca")
	for candidate: SpawnPointProvider.SpawnCandidate in candidates:
		assert_gt(candidate.position.distance_to(PLAYER_POSITION),
			REQUEST_MIN_DISTANCE_M - 0.001,
			"se midió un punto que el atajo debería haber saltado")
	world.dispose()


func test_collect_access_points_lee_los_marcadores_del_conversor() -> void:
	# El conversor de mapas emite `Doors/Door_N` como `Marker3D` con
	# `metadata/type = "door"`. Esto comprueba que se leen tal cual, sin
	# obligar al conversor a saber nada de navegación.
	var root := Node3D.new()
	var doors := Node3D.new()
	doors.name = "Doors"
	root.add_child(doors)
	var door := Marker3D.new()
	door.position = Vector3(4.0, 0.0, 5.0)
	door.set_meta(&"type", "door")
	doors.add_child(door)
	var pickup := Marker3D.new()
	pickup.set_meta(&"type", "pickup")
	doors.add_child(pickup)

	var found := SpawnSampler.collect_access_points(root)
	assert_size(found, 1, "sólo la puerta es un acceso; el botiquín no")
	if found.size() == 1:
		assert_true(found[0].is_equal_approx(Vector3(4.0, 0.0, 5.0)),
			"la posición del acceso debe ser la del marcador")
	root.free()


func test_sin_navmesh_horneado_el_proveedor_se_declara_no_listo() -> void:
	# El director debe negarse a generar en lugar de soltar enemigos en el
	# aire. Decirlo es responsabilidad del proveedor.
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var sampler := SpawnSampler.new()
	sampler.setup(world.nav, world)
	assert_false(sampler.is_ready(),
		"sin candidatos construidos el proveedor no está listo")
	sampler.build_candidates(world.mesh)
	assert_true(sampler.is_ready(), "con navmesh y candidatos, sí lo está")
	var request := NavTestUtil.spawn_request(
		PLAYER_POSITION, PLAYER_FORWARD, 4, REQUEST_MIN_DISTANCE_M,
		REQUEST_FOV_HALF_ANGLE_DEG, REQUEST_FALLOFF_M, REQUEST_ENTRY_BONUS)
	world.nav.dispose()
	assert_false(sampler.is_ready(), "sin mapa de navegación, deja de estarlo")
	assert_size(sampler.sample_candidates(request), 0,
		"y no propone nada en lugar de proponer cualquier cosa")


func test_sin_backend_de_fisica_el_proveedor_no_esta_listo() -> void:
	# Medir la línea de visión al jugador es física, y `NavService` dejó de
	# contestar preguntas de física. Sin backend de física el muestreador NO
	# puede saber qué se ve; declararse no listo es la respuesta honesta.
	# Contestar "no se ve nada" daría por buenas apariciones a la vista.
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var sampler := SpawnSampler.new()
	sampler.setup(world.nav, null)
	sampler.build_candidates(world.mesh)
	assert_gt(float(sampler.candidate_count()), 0.0, "hay candidatos de sobra")
	assert_false(sampler.is_ready(),
		"sin quien mida la oclusión, el proveedor no está listo")
	var request := NavTestUtil.spawn_request(
		PLAYER_POSITION, PLAYER_FORWARD, 4, REQUEST_MIN_DISTANCE_M,
		REQUEST_FOV_HALF_ANGLE_DEG, REQUEST_FALLOFF_M, REQUEST_ENTRY_BONUS)
	assert_size(sampler.sample_candidates(request), 0,
		"y no propone nada en lugar de proponer sin medir")
	world.dispose()
