extends TestCase
## Envoltorio de `NavigationServer3D`: horneado, rutas, caché y presupuesto
## (ADR-004 y ADR-002).
##
## Lo que se prueba aquí no es que Recast funcione —eso es cosa del motor—
## sino que este servicio no miente: que no da por navegable lo que no lo es,
## que no da por alcanzable lo que está al otro lado de una pared, y que
## respeta el techo de 4 peticiones de camino por frame.

const FLOOR_HALF_EXTENT_M: float = 10.0
const OUTER_HALF_M: float = 16.0
const BLOCK_HALF_M: float = 10.0


func test_hornea_con_el_radio_y_la_altura_del_personaje() -> void:
	var world := NavTestUtil.fixture(
		[NavTestUtil.floor_box(FLOOR_HALF_EXTENT_M)] as Array[AABB])
	assert_almost_eq(world.mesh.agent_radius, NavTuning.AGENT_RADIUS_M, 0.001,
		"el navmesh debe hornearse con el radio del personaje (0,4 m)")
	assert_almost_eq(world.mesh.agent_height, NavTuning.AGENT_HEIGHT_M, 0.001,
		"el navmesh debe hornearse con la altura del personaje (1,8 m)")
	assert_gt(float(world.mesh.get_polygon_count()), 0.0, "navmesh vacío")
	world.dispose()


func test_el_navmesh_se_retrae_el_radio_del_agente_junto_al_muro() -> void:
	# Es lo que el legacy hacía a mano expandiendo la geometría con un offset
	# de tipo "miter" sin límite (`Polygon::Expand`, análisis §5.2), con picos
	# en los ángulos agudos. Aquí lo hace Recast, y esta prueba comprueba que
	# de verdad está pasando: sin retranqueo, los bots se pegan a las paredes
	# y se quedan atascados en las esquinas.
	var world := NavTestUtil.cover_scenario(2.4, 3.0, FLOOR_HALF_EXTENT_M)
	# La cara del muro está en x = 2,2; con radio 0,4 lo navegable acaba antes.
	assert_true(world.nav.snap_to_navmesh(Vector3(2.15, 0.0, 0.0)).is_finite() == false
			or absf(world.nav.snap_to_navmesh(Vector3(2.15, 0.0, 0.0)).x) < 2.0,
		"el navmesh no puede llegar hasta la cara del muro")
	assert_true(world.nav.snap_to_navmesh(Vector3(0.0, 0.0, 0.0)).is_finite(),
		"el centro de la sala sí debe ser navegable")
	world.dispose()


func test_snap_to_navmesh_devuelve_infinito_fuera_del_mapa() -> void:
	# El contrato de `WorldQuery` dice INF si no es navegable. Devolver el
	# punto más cercano del mapa sería peor que no responder: un bot creería
	# que puede ir a un sitio al que no puede.
	var world := NavTestUtil.fixture(
		[NavTestUtil.floor_box(FLOOR_HALF_EXTENT_M)] as Array[AABB])
	assert_false(world.nav.snap_to_navmesh(Vector3(500.0, 0.0, 500.0)).is_finite(),
		"fuera del mapa no hay proyección posible")
	assert_true(world.nav.snap_to_navmesh(Vector3(1.0, 0.0, 1.0)).is_finite(),
		"dentro del mapa sí la hay")
	world.dispose()


func test_una_zona_inalcanzable_no_devuelve_ruta() -> void:
	# `map_get_path` devuelve el camino hasta el punto alcanzable MÁS CERCANO
	# cuando origen y destino están en islas distintas. Sin la comprobación del
	# extremo, un bot "llegaría" a una sala a la que no hay paso, y se quedaría
	# dando vueltas contra la pared.
	var boxes: Array[AABB] = [
		AABB(Vector3(-10.0, -0.5, -10.0), Vector3(8.0, 0.5, 20.0)),
		AABB(Vector3(10.0, -0.5, -10.0), Vector3(8.0, 0.5, 20.0)),
	]
	var world := NavTestUtil.fixture(boxes)
	var here := Vector3(-6.0, 0.0, 0.0)
	var there := Vector3(14.0, 0.0, 0.0)
	assert_true(world.nav.snap_to_navmesh(here).is_finite(), "la isla A existe")
	assert_true(world.nav.snap_to_navmesh(there).is_finite(), "la isla B existe")
	assert_size(world.nav.path(here, there), 0,
		"entre dos islas sin conexión no hay ruta, y hay que decirlo")
	assert_true(is_inf(world.nav.path_cost(here, there)),
		"el coste de un camino que no existe es infinito")
	world.dispose()


func test_el_coste_de_camino_rodea_la_geometria() -> void:
	# Es lo que permite que el oído estime la propagación por la geometría real
	# y no por distancia recta (GDD §8.1): un disparo al otro lado de un muro
	# se oye lejano aunque esté a tres metros.
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var west := Vector3(-13.0, 0.0, 0.0)
	var east := Vector3(13.0, 0.0, 0.0)
	var straight := west.distance_to(east)
	var walked := world.nav.path_cost(west, east)
	assert_false(is_inf(walked), "por el anillo se llega")
	assert_gt(walked, straight * 1.5,
		"rodeando el bloque se anda mucho más que en línea recta"
		+ " (recta %f, camino %f)" % [straight, walked])
	world.dispose()


func test_la_cache_sirve_el_segundo_camino_sin_recalcularlo() -> void:
	var world := NavTestUtil.fixture(
		[NavTestUtil.floor_box(FLOOR_HALF_EXTENT_M)] as Array[AABB])
	var a := Vector3(-8.0, 0.0, -8.0)
	var b := Vector3(8.0, 0.0, 8.0)
	world.nav.path(a, b)
	var misses := world.nav.stat_cache_misses
	world.nav.path(a, b)
	assert_eq(world.nav.stat_cache_misses, misses,
		"la segunda petición idéntica no puede volver a calcular")
	assert_gt(float(world.nav.stat_cache_hits), 0.0, "debería haber acertado")
	# Dos bots a menos de media celda de distancia comparten ruta: la clave se
	# redondea a rejilla a propósito.
	world.nav.path(a + Vector3(0.1, 0.0, 0.1), b)
	assert_eq(world.nav.stat_cache_misses, misses,
		"un origen a 10 cm debe caer en la misma celda de caché")
	world.dispose()


func test_la_cache_se_invalida_al_cambiar_una_puerta() -> void:
	# Una puerta que se cierra cambia la topología: servir rutas viejas
	# significa bots cruzando puertas cerradas.
	var world := NavTestUtil.fixture(
		[NavTestUtil.floor_box(FLOOR_HALF_EXTENT_M)] as Array[AABB])
	world.nav.path(Vector3(-8.0, 0.0, 0.0), Vector3(8.0, 0.0, 0.0))
	assert_gt(float(world.nav.cache_size()), 0.0, "la caché debería tener algo")
	var tree := Engine.get_main_loop() as SceneTree
	var bus: Node = tree.root.get_node_or_null(^"/root/EventBus")
	assert_not_null(bus, "hace falta el EventBus para esta prueba")
	if bus != null:
		bus.emit_signal(&"door_state_changed", 7, false)
		assert_eq(world.nav.cache_size(), 0,
			"al cambiar una puerta la caché de rutas deja de valer")
	world.dispose()


func test_el_presupuesto_de_cuatro_rutas_por_frame_encola_el_resto() -> void:
	# ADR-002: máximo 4 peticiones de camino por frame. La quinta no se
	# atiende, se encola — y se sirve en cuanto hay presupuesto.
	var world := NavTestUtil.fixture(
		[NavTestUtil.floor_box(FLOOR_HALF_EXTENT_M)] as Array[AABB])
	world.nav.budget_enforced = true
	var served := 0
	for i in 8:
		# Destinos distintos: cada uno es una petición nueva, no un acierto de
		# caché.
		var to := Vector3(-8.0 + float(i) * 2.0, 0.0, 8.0)
		if not world.nav.path(Vector3(-8.0, 0.0, -8.0), to).is_empty():
			served += 1
	assert_lt(float(served), 5.0,
		"se sirvieron %d rutas en un frame; el techo son 4" % served)
	assert_gt(float(world.nav.pending_count()), 0.0,
		"lo que no cabe en el presupuesto se encola, no se pierde")

	# Con presupuesto nuevo, la cola se vacía sola.
	world.nav.budget_enforced = false
	var drained := world.nav.pump()
	assert_gt(float(drained), 0.0, "pump debe servir lo encolado")
	assert_eq(world.nav.pending_count(), 0, "la cola debe quedar vacía")
	world.dispose()


func test_request_path_no_consume_presupuesto_y_deja_la_ruta_en_cache() -> void:
	var world := NavTestUtil.fixture(
		[NavTestUtil.floor_box(FLOOR_HALF_EXTENT_M)] as Array[AABB])
	var key := world.nav.request_path(Vector3(-8.0, 0.0, -8.0), Vector3(8.0, 0.0, 8.0))
	assert_false(world.nav.has_cached_path(key),
		"encolar no calcula: eso es lo que hace que el techo sirva de algo")
	world.nav.pump()
	assert_true(world.nav.has_cached_path(key),
		"tras el pump la ruta debe estar disponible")
	assert_gt(float(world.nav.cached_path(key).size()), 1.0,
		"y debe ser una ruta de verdad")
	world.dispose()


func test_sin_espacio_fisico_se_niega_la_vision_no_se_concede() -> void:
	# `NavService` implementa `WorldQuery` entero, así que antes o después
	# alguien lo inyecta como consulta del mundo de un bot — y este método es
	# el test de oclusión de la percepción. Conceder visión por defecto da
	# rayos X a cualquier bot creado antes de que el nivel enlace el espacio de
	# física, sin error ni aviso. Es el bug del legacy, en su forma más
	# silenciosa.
	var world := NavTestUtil.fixture(
		[NavTestUtil.floor_box(FLOOR_HALF_EXTENT_M)] as Array[AABB])
	assert_null(world.nav.space(), "el escenario sintético no inyecta física")
	assert_false(world.nav.has_line_of_sight(Vector3.ZERO, Vector3(5.0, 0.0, 0.0)),
		"sin espacio físico la visión se NIEGA: ante la duda, el bot no ve")
	assert_false(world.nav.raycast(Vector3.ZERO, Vector3(5.0, 0.0, 0.0)).is_finite(),
		"sin espacio físico ningún rayo impacta")
	world.dispose()


func test_el_coste_de_camino_no_depende_del_presupuesto_del_frame() -> void:
	# Si `path_cost` se encolara, devolvería INF al agotarse el presupuesto,
	# INF es indistinguible de "no hay ruta", y el oído estimaría el mismo
	# disparo cerca o lejos según el frame. La IA debe ser una función pura de
	# (estado, pizarra, consulta del mundo): eso excluye depender del frame.
	var world := NavTestUtil.fixture(
		[NavTestUtil.floor_box(FLOOR_HALF_EXTENT_M)] as Array[AABB])
	world.nav.budget_enforced = true
	var costs: Array[float] = []
	for i in 12:
		var to := Vector3(-8.0 + float(i) * 1.4, 0.0, 8.0)
		costs.append(world.nav.path_cost(Vector3(-8.0, 0.0, -8.0), to))
	for i in costs.size():
		assert_false(is_inf(costs[i]),
			"la consulta %d devolvió INF por falta de presupuesto, no por falta"
			% i + " de ruta: son indistinguibles y eso es el problema")
	world.dispose()


func test_sin_navmesh_el_coste_es_la_recta_y_no_infinito() -> void:
	# INF AFIRMA que no hay paso. En un nivel sin hornear no se sabe, y decir
	# "no hay paso" amortiguaría todos los ruidos del nivel. La recta dice "no
	# sé, por lo menos esto". Coincide con lo que hace `WorldQueryPhysics`.
	var service := NavService.new()
	var from := Vector3(0.0, 0.0, 0.0)
	var to := Vector3(3.0, 0.0, 4.0)
	assert_false(service.is_ready(), "servicio sin horneado ni mapa")
	assert_almost_eq(service.path_cost(from, to), 5.0, 0.001,
		"sin mapa, el coste es la distancia en línea recta")
	service.dispose()


func test_vacia_las_caches_dependientes_al_cambiar_la_topologia() -> void:
	# `WorldQueryPhysics` (percepción) cachea el coste de camino por celda y el
	# oído lo usa. Si una puerta se cierra y esa caché no se vacía, los bots
	# siguen oyendo como si estuviera abierta: un disparo al otro lado de una
	# puerta cerrada se oiría al lado.
	var world := NavTestUtil.fixture(
		[NavTestUtil.floor_box(FLOOR_HALF_EXTENT_M)] as Array[AABB])
	var perception := WorldQueryPhysics.new()
	perception.navigation_map = world.nav.map_rid()
	world.nav.add_cache_dependent(perception)
	assert_eq(world.nav.cache_dependent_count(), 1, "el dependiente se registra")

	perception.path_cost(Vector3(-8.0, 0.0, 0.0), Vector3(8.0, 0.0, 0.0))
	assert_gt(float(perception.cache_size()), 0.0,
		"la caché de percepción debería tener algo")

	var tree := Engine.get_main_loop() as SceneTree
	var bus: Node = tree.root.get_node_or_null(^"/root/EventBus")
	assert_not_null(bus, "hace falta el EventBus para esta prueba")
	if bus != null:
		bus.emit_signal(&"door_state_changed", 11, false)
		assert_eq(perception.cache_size(), 0,
			"al cambiar una puerta se vacía también la caché del oído")
	world.dispose()
