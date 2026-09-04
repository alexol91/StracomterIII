extends TestCase
## El índice espacial de la nube de cobertura.
##
## Con 40 bots y varios miles de puntos horneados, una búsqueda lineal por
## consulta es la diferencia entre 60 fps y 20. Esta prueba mide que la
## consulta NO escala con el tamaño de la nube.
##
## Se mide con un contador determinista (`stat_last_candidates`, cuántos puntos
## examina de verdad) y no sólo con un cronómetro: un umbral de milisegundos en
## CI es una prueba que falla los martes. El tiempo se imprime como
## información, y sólo se afirma sobre él con un margen muy holgado.

## Densidad fija: lo que cambia entre las dos nubes es el TAMAÑO del mapa.
const SPACING_M: float = 1.5
const SMALL_COUNT: int = 1000
const LARGE_COUNT: int = 10000
## Con densidad y radio constantes, el número de candidatos debe quedarse
## plano. Se admite algo de holgura por los bordes de las celdas.
const CANDIDATE_GROWTH_TOLERANCE: float = 1.5
## El cronómetro sí necesita margen de sobra: mide una máquina compartida.
const TIME_GROWTH_TOLERANCE: float = 4.0
const QUERY_REPEATS: int = 50


func test_los_candidatos_examinados_no_crecen_con_el_tamano_de_la_nube() -> void:
	var small := NavTestUtil.synthetic_cloud(SMALL_COUNT, SPACING_M)
	var large := NavTestUtil.synthetic_cloud(LARGE_COUNT, SPACING_M)
	assert_gt(float(large.size()), float(small.size()) * 5.0,
		"la nube grande debe ser de verdad mucho mayor")

	small.indices_near(Vector3.ZERO, NavTuning.COVER_SEARCH_RADIUS_M)
	var small_candidates := small.stat_last_candidates
	large.indices_near(Vector3.ZERO, NavTuning.COVER_SEARCH_RADIUS_M)
	var large_candidates := large.stat_last_candidates

	assert_gt(float(small_candidates), 0.0, "algo tendrá que examinar")
	assert_lt(float(large_candidates),
		float(small_candidates) * CANDIDATE_GROWTH_TOLERANCE,
		"la consulta examina %d puntos con %d en la nube y %d con %d: eso es"
		% [small_candidates, small.size(), large_candidates, large.size()]
		+ " escalar linealmente, que es justo lo que el índice debe evitar")
	assert_lt(float(large_candidates), float(large.size()) * 0.25,
		"con 10 000 puntos la consulta no puede tocar ni un cuarto de la nube")


func test_la_consulta_completa_no_escala_con_el_tamano_de_la_nube() -> void:
	var small := NavTestUtil.synthetic_cloud(SMALL_COUNT, SPACING_M)
	var large := NavTestUtil.synthetic_cloud(LARGE_COUNT, SPACING_M)
	var provider_small := CoverProviderBaked.new()
	provider_small.setup(small)
	var provider_large := CoverProviderBaked.new()
	provider_large.setup(large)

	var threats: Array[Vector3] = [Vector3(30.0, 0.0, 0.0)]

	var t0 := Time.get_ticks_usec()
	for _i in QUERY_REPEATS:
		provider_small.query(Vector3.ZERO, threats, Vector3.INF, false, 3)
	var small_usec := Time.get_ticks_usec() - t0

	t0 = Time.get_ticks_usec()
	for _i in QUERY_REPEATS:
		provider_large.query(Vector3.ZERO, threats, Vector3.INF, false, 3)
	var large_usec := Time.get_ticks_usec() - t0

	print("      [índice] %d consultas: %d puntos -> %d us | %d puntos -> %d us"
		% [QUERY_REPEATS, small.size(), small_usec, large.size(), large_usec])
	assert_eq(provider_large.stat_last_candidates, large.stat_last_candidates,
		"el proveedor debe reportar los candidatos que examinó el índice")
	assert_lt(float(large_usec),
		float(maxi(small_usec, 1)) * TIME_GROWTH_TOLERANCE,
		"10× puntos no puede costar 4× tiempo: el índice no está haciendo su"
		+ " trabajo (%d us vs %d us)" % [large_usec, small_usec])


func test_nearest_index_encuentra_el_punto_correcto() -> void:
	var cloud := NavTestUtil.synthetic_cloud(400, SPACING_M)
	var target := cloud.position_at(137)
	var found := cloud.nearest_index(target + Vector3(0.2, 0.0, 0.2), 3.0)
	assert_eq(found, 137, "el punto más cercano a sí mismo es él mismo")
	assert_lt(float(cloud.stat_last_candidates), float(cloud.size()) * 0.5,
		"la búsqueda por anillos no puede recorrer media nube")


func test_nearest_index_devuelve_menos_uno_fuera_de_radio() -> void:
	var cloud := NavTestUtil.synthetic_cloud(100, SPACING_M)
	assert_eq(cloud.nearest_index(Vector3(500.0, 0.0, 500.0), 2.0), -1,
		"fuera del radio no hay punto, y decirlo es mejor que mentir")


func test_el_indice_se_reconstruye_al_anadir_puntos() -> void:
	# Añadir un punto y consultar sin reconstruir a mano debe funcionar: la
	# nube se marca sucia sola. Es la clase de detalle que, si falla, produce
	# un bot que ignora la cobertura recién horneada tras una demolición.
	var cloud := NavTestUtil.synthetic_cloud(100, SPACING_M)
	var before := cloud.indices_near(Vector3(200.0, 0.0, 0.0), 5.0).size()
	assert_eq(before, 0, "ahí no hay nada todavía")
	var q := NavTestUtil.quality_in_sector(0, CoverProvider.Quality.HIGH)
	cloud.append_point(Vector3(200.0, 0.0, 0.0), q, q, 0)
	assert_eq(cloud.indices_near(Vector3(200.0, 0.0, 0.0), 5.0).size(), 1,
		"el punto nuevo debe aparecer sin reconstruir el índice a mano")
