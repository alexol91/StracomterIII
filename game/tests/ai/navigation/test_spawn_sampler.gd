extends TestCase
## Reglas de aparición justa (GDD §7).
##
## El legacy hacía aparecer a los enemigos en incentros de triángulos a más de
## **200 unidades** del jugador (`Optimization.cc:152`). A la escala del remake
## eso son 2,7 m: los enemigos salían literalmente en la cara del jugador, a
## veces dentro de su campo de visión. Esta prueba existe para que eso no
## vuelva a pasar por accidente.
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
const BATCH: int = 4
const RNG_SEED: int = 20261234


func test_ningun_punto_muestreado_viola_las_reglas_de_justicia() -> void:
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var sampler := SpawnSampler.new()
	sampler.setup(world.nav, world)
	assert_gt(float(sampler.build_candidates(world.mesh)), 0.0,
		"el muestreo del navmesh no puede salir vacío")

	var rng := RandomNumberGenerator.new()
	rng.seed = RNG_SEED
	var points := sampler.sample(BATCH, PLAYER_POSITION, PLAYER_FORWARD, rng)
	assert_gt(float(points.size()), 0.0,
		"un anillo de 32 m tiene sitios legales de sobra; no salió ninguno")
	for p: Vector3 in points:
		assert_gt(p.distance_to(PLAYER_POSITION), NavTuning.SPAWN_MIN_PLAYER_DISTANCE_M,
			"aparición a %f m del jugador: el mínimo son %f"
			% [p.distance_to(PLAYER_POSITION), NavTuning.SPAWN_MIN_PLAYER_DISTANCE_M])
		assert_false(
			SpawnSampler.is_inside_view_cone(p, PLAYER_POSITION, PLAYER_FORWARD),
			"aparición dentro del cono de visión del jugador, en %s" % p)
		assert_false(world.has_line_of_sight(
				PLAYER_POSITION + Vector3.UP * NavTuning.SPAWN_EYE_HEIGHT_M,
				p + Vector3.UP * NavTuning.SPAWN_EYE_HEIGHT_M),
			"aparición a la vista del jugador, en %s" % p)
		assert_true(sampler.is_fair(p, PLAYER_POSITION, PLAYER_FORWARD),
			"el propio muestreador considera injusto un punto que ha devuelto")
	world.dispose()


func test_el_muestreo_no_repite_el_mismo_metro_cuadrado() -> void:
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var sampler := SpawnSampler.new()
	sampler.setup(world.nav, world)
	sampler.build_candidates(world.mesh)
	var rng := RandomNumberGenerator.new()
	rng.seed = RNG_SEED
	var points := sampler.sample(BATCH, PLAYER_POSITION, PLAYER_FORWARD, rng)
	assert_gt(float(points.size()), 1.0, "hacen falta al menos dos para comparar")
	for i in points.size():
		for j in range(i + 1, points.size()):
			assert_gt(points[i].distance_to(points[j]),
				NavTuning.SPAWN_MIN_SEPARATION_M * 0.99,
				"dos refuerzos del mismo lote aparecen encima el uno del otro")
	world.dispose()


func test_rechaza_por_cercania_el_error_del_legacy() -> void:
	# 2,7 m es lo que permitía el original. Aquí tiene que salir TOO_CLOSE.
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var sampler := SpawnSampler.new()
	sampler.setup(world.nav, world)
	var legacy_distance := PLAYER_POSITION + Vector3(0.0, 0.0, 2.7)
	assert_eq(sampler.rejection_reason(legacy_distance, PLAYER_POSITION, PLAYER_FORWARD),
		SpawnSampler.Rejection.TOO_CLOSE,
		"2,7 m es la distancia del legacy y es demasiado cerca")
	world.dispose()


func test_rechaza_lo_que_esta_dentro_del_cono_de_vision() -> void:
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var sampler := SpawnSampler.new()
	sampler.setup(world.nav, world)
	var ahead := PLAYER_POSITION + Vector3(0.0, 0.0, -13.0)
	assert_gt(ahead.distance_to(PLAYER_POSITION), NavTuning.SPAWN_MIN_PLAYER_DISTANCE_M,
		"el punto de prueba debe pasar el filtro de distancia para que el"
		+ " motivo de rechazo sea el cono y no otra cosa")
	assert_eq(sampler.rejection_reason(ahead, PLAYER_POSITION, PLAYER_FORWARD),
		SpawnSampler.Rejection.IN_VIEW_CONE,
		"aparecer justo delante del jugador es el peor de los casos")
	world.dispose()


func test_rechaza_lo_que_esta_a_la_vista_aunque_este_lejos() -> void:
	# Detrás del jugador, a 14 m por el mismo pasillo: fuera del cono, pero se
	# ve. Aparecer ahí es aparecer en un sitio al que el jugador sólo tiene que
	# girarse para mirar.
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var sampler := SpawnSampler.new()
	sampler.setup(world.nav, world)
	var behind := PLAYER_POSITION + Vector3(0.0, 0.0, 14.0)
	assert_false(SpawnSampler.is_inside_view_cone(behind, PLAYER_POSITION, PLAYER_FORWARD),
		"el punto de prueba está a la espalda: no es el cono lo que lo rechaza")
	assert_eq(sampler.rejection_reason(behind, PLAYER_POSITION, PLAYER_FORWARD),
		SpawnSampler.Rejection.HAS_LINE_OF_SIGHT,
		"a la espalda pero a la vista por el pasillo: no vale")
	world.dispose()


func test_los_accesos_reales_pesan_mas_que_el_medio_de_una_sala() -> void:
	# Un enemigo que sale por una puerta se lee como un refuerzo; uno que se
	# materializa en mitad de la sala se lee como un fallo del motor.
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var sampler := SpawnSampler.new()
	sampler.setup(world.nav, world)
	sampler.build_candidates(world.mesh)

	var door := Vector3(13.0, 0.0, 0.0)
	sampler.set_access_points(PackedVector3Array([door]))
	assert_eq(sampler.access_point_count(), 1, "el acceso debe registrarse")

	var rng := RandomNumberGenerator.new()
	rng.seed = RNG_SEED
	var near_door := 0
	var total := 0
	for _run in 40:
		var points := sampler.sample(1, PLAYER_POSITION, PLAYER_FORWARD, rng)
		for p: Vector3 in points:
			total += 1
			if p.distance_to(door) <= NavTuning.SPAWN_ACCESS_RADIUS_M:
				near_door += 1
	assert_gt(float(total), 0.0, "debería haber muestreado algo")
	assert_gt(float(near_door), 0.0,
		"con bonificación ×%f el acceso debe salir elegido alguna vez"
		% NavTuning.SPAWN_ACCESS_POINT_BONUS)
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


func test_sin_candidatos_no_inventa_apariciones() -> void:
	# Preferible a colocar enemigos "donde sea": el director se queda sin
	# oleada, que es un problema de diseño de nivel, no un enemigo dentro de
	# una pared.
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var sampler := SpawnSampler.new()
	sampler.setup(world.nav, world)
	# Sin `build_candidates`: no hay de dónde elegir.
	assert_eq(sampler.candidate_count(), 0, "no se han construido candidatos")
	var rng := RandomNumberGenerator.new()
	rng.seed = RNG_SEED
	assert_size(sampler.sample(BATCH, PLAYER_POSITION, PLAYER_FORWARD, rng), 0,
		"sin candidatos no se devuelve nada")
	world.dispose()
