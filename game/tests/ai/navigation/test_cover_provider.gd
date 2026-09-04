extends TestCase
## Consulta de la nube de cobertura (GDD §8.3).
##
## Lo que se prueba aquí es la diferencia entre "la IA se pone detrás de algo"
## y "la IA se pone detrás de algo QUE LA TAPA DE QUIEN LE DISPARA". Un punto
## de cobertura no es bueno en abstracto: es bueno frente a una amenaza
## concreta, y malo frente a otra que lo pille de lado.
##
## Convención del fichero: escenarios vía `NavTestUtil`, variables locales, sin
## métodos auxiliares que devuelvan objetos del proyecto (ver el aviso de
## `nav_test_util.gd`).

const SECTOR_EAST: int = 0
const SECTOR_WEST: int = 4
const WALL_X: float = 6.0
const FLOOR_HALF_EXTENT_M: float = 15.0
## A 30 m al este: bastante lejos como para que la dirección hacia la amenaza
## sea inequívocamente el sector 0 desde cualquier punto del escenario.
const FAR_EAST: Vector3 = Vector3(30.0, 0.0, 0.0)
const FAR_WEST: Vector3 = Vector3(-30.0, 0.0, 0.0)


func test_devuelve_los_k_mejores_y_no_mas() -> void:
	var world := NavTestUtil.two_wall_scenario(WALL_X, FLOOR_HALF_EXTENT_M)
	var cloud := NavTestUtil.bake_cover(world, &"test_query")
	var provider := CoverProviderBaked.new()
	provider.setup(cloud)
	assert_gt(float(provider.point_count()), 3.0,
		"el escenario debe dar más de 3 puntos para que pedir 3 signifique algo")
	var threats: Array[Vector3] = [FAR_EAST]
	var result := provider.query(Vector3.ZERO, threats, Vector3.INF, false, 3)
	assert_size(result, 3, "query debe devolver exactamente K resultados")
	world.dispose()


func test_prefiere_el_punto_que_cubre_de_la_amenaza_real() -> void:
	# Dos muros simétricos: uno tapa de las amenazas del este, el otro de las
	# del oeste. Con la amenaza al este, la respuesta correcta es el punto
	# pegado al muro del este; el del oeste está igual de cerca y es igual de
	# cómodo, y sirve exactamente para nada.
	var world := NavTestUtil.two_wall_scenario(WALL_X, FLOOR_HALF_EXTENT_M)
	var cloud := NavTestUtil.bake_cover(world, &"test_query")
	var provider := CoverProviderBaked.new()
	provider.setup(cloud)

	var east_threat: Array[Vector3] = [FAR_EAST]
	var best_vs_east := provider.query(Vector3.ZERO, east_threat, Vector3.INF, false, 1)
	assert_size(best_vs_east, 1, "debería haber al menos un punto de cobertura")
	if not best_vs_east.is_empty():
		var point := best_vs_east[0]
		assert_gt(point.position.x, 0.0,
			"con la amenaza al este el punto elegido debe estar en el lado este,"
			+ " y salió %s" % point.position)
		assert_eq(point.quality_against(FAR_EAST, false), CoverProvider.Quality.HIGH,
			"el punto elegido debe cubrir DE LA AMENAZA, no de cualquier cosa")

	# La misma nube, la amenaza en el lado contrario: la respuesta debe
	# invertirse. Si no lo hace, la puntuación está ignorando la dirección.
	var west_threat: Array[Vector3] = [FAR_WEST]
	var best_vs_west := provider.query(Vector3.ZERO, west_threat, Vector3.INF, false, 1)
	assert_size(best_vs_west, 1, "debería haber al menos un punto de cobertura")
	if not best_vs_west.is_empty():
		assert_lt(best_vs_west[0].position.x, 0.0,
			"con la amenaza al oeste el punto elegido debe estar en el lado oeste,"
			+ " y salió %s" % best_vs_west[0].position)
	world.dispose()


func test_penaliza_el_punto_que_deja_expuesto_a_la_segunda_amenaza() -> void:
	# Un punto que te tapa del tirador de la puerta pero te deja en bandeja al
	# de la ventana no vale. Es el término "− exposición a las demás" del GDD.
	var covered_east := NavTestUtil.quality_in_sector(SECTOR_EAST, CoverProvider.Quality.HIGH)
	var cloud := CoverPointCloud.new()
	cloud.append_point(Vector3(5.0, 0.0, 0.0), covered_east, covered_east, 0)
	var covered_both := NavTestUtil.quality_in_sector(SECTOR_EAST, CoverProvider.Quality.HIGH)
	covered_both[SECTOR_WEST] = int(CoverProvider.Quality.HIGH)
	cloud.append_point(Vector3(-5.0, 0.0, 0.0), covered_both, covered_both, 0)
	cloud.rebuild_index()

	var provider := CoverProviderBaked.new()
	provider.setup(cloud)
	var two_threats: Array[Vector3] = [FAR_EAST, FAR_WEST]
	var result := provider.query(Vector3.ZERO, two_threats, Vector3.INF, false, 2)
	assert_size(result, 2, "los dos puntos deben ser candidatos")
	if result.size() == 2:
		assert_gt(result[0].last_score, result[1].last_score,
			"el punto que cubre de las DOS amenazas debe puntuar más alto")
		assert_lt(result[0].position.x, 0.0,
			"el ganador debe ser el que cubre por los dos lados")


func test_el_progreso_hacia_el_objetivo_desempata() -> void:
	# Dos puntos con la misma cobertura y el mismo coste desde el bot: gana el
	# que además acerca al objetivo. Es el término "+ progreso" del GDD, y es
	# lo que evita que un bot se atrinchere de espaldas a la misión.
	var covered := NavTestUtil.quality_in_sector(SECTOR_EAST, CoverProvider.Quality.HIGH)
	var cloud := CoverPointCloud.new()
	cloud.append_point(Vector3(0.0, 0.0, 5.0), covered, covered, 0)
	cloud.append_point(Vector3(0.0, 0.0, -5.0), covered, covered, 0)
	cloud.rebuild_index()

	var provider := CoverProviderBaked.new()
	provider.setup(cloud)
	var threats: Array[Vector3] = [FAR_EAST]
	var objective := Vector3(0.0, 0.0, 40.0)
	var result := provider.query(Vector3.ZERO, threats, objective, false, 2)
	assert_size(result, 2, "los dos puntos deben ser candidatos")
	if result.size() == 2:
		assert_gt(result[0].position.z, 0.0,
			"a igualdad de cobertura y coste, gana el punto que avanza hacia el"
			+ " objetivo; salió %s" % result[0].position)


func test_exposure_at_es_cero_a_cubierto_y_uno_al_descubierto() -> void:
	var covered_east := NavTestUtil.quality_in_sector(SECTOR_EAST, CoverProvider.Quality.HIGH)
	var cloud := NavTestUtil.single_point_cloud(Vector3.ZERO, covered_east)
	var provider := CoverProviderBaked.new()
	provider.setup(cloud)

	var east: Array[Vector3] = [FAR_EAST]
	var west: Array[Vector3] = [FAR_WEST]
	assert_almost_eq(provider.exposure_at(Vector3.ZERO, east, false), 0.0, 0.001,
		"con el muro entre el bot y la amenaza, la exposición es 0")
	assert_almost_eq(provider.exposure_at(Vector3.ZERO, west, false), 1.0, 0.001,
		"con la amenaza por el lado descubierto, la exposición es 1")


func test_exposure_at_lejos_de_toda_cobertura_es_maxima() -> void:
	# La nube sólo contiene puntos que cubren en alguna dirección, así que una
	# posición sin ningún punto cerca está, por definición, al descubierto.
	var covered := NavTestUtil.quality_in_sector(SECTOR_EAST, CoverProvider.Quality.HIGH)
	var cloud := NavTestUtil.single_point_cloud(Vector3.ZERO, covered)
	var provider := CoverProviderBaked.new()
	provider.setup(cloud)
	var east: Array[Vector3] = [FAR_EAST]
	assert_almost_eq(
		provider.exposure_at(Vector3(50.0, 0.0, 50.0), east, false), 1.0, 0.001,
		"en mitad de la nada la exposición debe ser 1")


func test_una_nube_vacia_no_da_puntos_ni_revienta() -> void:
	# Un nivel sin hornear tiene que degradarse a "no hay cobertura", no a un
	# error: la IA se queda sin táctica espacial, pero el juego sigue.
	var provider := CoverProviderBaked.new()
	provider.setup(CoverPointCloud.new())
	var threats: Array[Vector3] = [FAR_EAST]
	assert_eq(provider.point_count(), 0, "la nube vacía tiene 0 puntos")
	assert_size(provider.query(Vector3.ZERO, threats, Vector3.INF, false, 3), 0,
		"sin puntos horneados no hay nada que devolver")
	assert_almost_eq(provider.exposure_at(Vector3.ZERO, threats, false), 1.0, 0.001,
		"sin nube, todo el mundo está expuesto")
