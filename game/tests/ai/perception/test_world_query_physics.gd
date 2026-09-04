extends TestCase
## El adaptador real de `WorldQuery` sobre el motor.
##
## No hace falta escena para fijar lo que más importa de él: qué contesta
## cuando NO tiene mundo al que preguntar. Un `WorldQuery` a medio construir es
## la vía más silenciosa de reintroducir el bug del legacy — bots que ven a
## través de las paredes — así que el comportamiento degradado se prueba
## explícitamente en lugar de dejarse a la suerte.

var query: WorldQueryPhysics = null


func before_each() -> void:
	query = WorldQueryPhysics.new()


func test_without_a_physics_space_vision_is_denied_never_granted() -> void:
	# La regla: ante la duda, el bot NO ve. Si esto devolviera true, cualquier
	# bot creado antes de que el nivel enlace el espacio de física tendría
	# visión de rayos X hasta que alguien se diera cuenta.
	assert_null(query.space_state, "sin enlazar, no hay espacio")
	assert_false(
		query.has_line_of_sight(Vector3.ZERO, Vector3(10.0, 0.0, 0.0)),
		"un WorldQuery sin mundo debe NEGAR la visión, no concederla"
	)
	assert_eq(
		query.raycast(Vector3.ZERO, Vector3(10.0, 0.0, 0.0)),
		Vector3.INF,
		"y no inventarse un impacto"
	)


func test_without_a_navmesh_the_sound_falls_back_to_the_straight_line() -> void:
	# Un nivel sin navmesh horneado no tiene información de topología. Devolver
	# la recta es decir "no sé"; devolver INF sería afirmar que no hay paso, y
	# amortiguaría todos los ruidos del nivel.
	assert_false(query.navigation_map.is_valid(), "sin mapa de navegación")
	assert_almost_eq(
		query.path_cost(Vector3.ZERO, Vector3(3.0, 0.0, 4.0)),
		5.0,
		0.0001,
		"sin navmesh, el coste es la distancia recta"
	)
	assert_size(query.path(Vector3.ZERO, Vector3(3.0, 0.0, 4.0)), 0, "pero no hay ruta que dar")


func test_snapping_without_a_navmesh_reports_failure_instead_of_guessing() -> void:
	assert_eq(
		query.snap_to_navmesh(Vector3(1.0, 0.0, 1.0)),
		Vector3.INF,
		"sin navmesh no se puede proyectar, y decirlo es mejor que devolver el punto tal cual"
	)


func test_flanking_routes_need_a_nav_service_and_say_so_by_being_empty() -> void:
	# `ai-navegacion` es quien sabe de corredores de polígonos: aquí solo se
	# delega. Sin servicio, cero rutas — que la escuadra debe leer como "no hay
	# flanqueo", no como error.
	assert_null(query.nav_service, "de partida no hay servicio de navegación")
	assert_size(query.disjoint_routes(Vector3.ZERO, Vector3(5.0, 0.0, 0.0), 2), 0)


func test_the_cost_cache_is_reusable_and_clearable() -> void:
	# La caché es lo que hace barato el oído; `clear_cache()` es lo que hace que
	# una puerta al abrirse no deje al bot oyendo el mapa de ayer. Quien monta
	# el nivel lo engancha con `NavService.add_cache_dependent`.
	query.navigation_map = RID()
	assert_eq(query.cache_size(), 0, "empieza vacía")
	query.path_cost(Vector3.ZERO, Vector3(3.0, 0.0, 4.0))
	# Sin navmesh no se cachea nada: la recta se calcula siempre, es gratis.
	assert_eq(query.cache_size(), 0, "la reserva sin navmesh no ensucia la caché")
	query.clear_cache()
	assert_eq(query.cache_size(), 0)
	assert_true(query.has_method("clear_cache"), "el contrato que espera NavService")


func test_it_is_a_world_query_and_can_be_injected_anywhere_one_is_expected() -> void:
	assert_true(query is WorldQuery, "es la implementación real del mismo contrato que el falso")
	var sensor := VisionSensor.new()
	var stats := CharacterStats.new()
	stats.vision_range_m = 24.0
	stats.vision_fov_primary_deg = 35.0
	var targets: Array[VisionSensor.Target] = [VisionSensor.Target.new()]
	targets[0].target_id = 1
	targets[0].position = Vector3(0.0, 0.0, -5.0)
	# Con el adaptador sin mundo, la percepción se degrada a ciega. Nunca a
	# omnisciente.
	var result := sensor.evaluate(
		Vector3.ZERO, Vector3.FORWARD, stats, targets, query, 0.1, 4
	)
	assert_false(result.sightings[0].detected, "sin mundo, el bot no ve nada")


## Doble de `NavService` que no necesita navmesh: sirve para comprobar que la
## delegación EXISTE, no para reimplementar el planificador de rutas.
class FakeNavService:
	extends NavService

	var last_from: Vector3 = Vector3.INF
	var last_to: Vector3 = Vector3.INF
	var last_max_routes: int = -1
	var canned: Array[PackedVector3Array] = []

	func disjoint_routes(
		from: Vector3, to: Vector3, max_routes: int = 2
	) -> Array[PackedVector3Array]:
		last_from = from
		last_to = to
		last_max_routes = max_routes
		return canned


func test_flanking_routes_are_delegated_to_the_nav_service_verbatim() -> void:
	var service := FakeNavService.new()
	var route_a := PackedVector3Array([Vector3.ZERO, Vector3(0.0, 0.0, -5.0)])
	var route_b := PackedVector3Array([Vector3.ZERO, Vector3(4.0, 0.0, -5.0)])
	service.canned = [route_a, route_b]
	query.nav_service = service

	var routes := query.disjoint_routes(Vector3.ZERO, Vector3(0.0, 0.0, -9.0), 2)
	assert_size(routes, 2, "las rutas salen del planificador, no de aquí")
	assert_eq(routes[0], route_a, "y llegan tal cual, sin reinterpretar")
	assert_eq(service.last_to, Vector3(0.0, 0.0, -9.0), "con el destino que se pidió")
	assert_eq(service.last_max_routes, 2)


func test_a_single_route_means_no_flanking_not_a_failure() -> void:
	# `RoutePlanner` devuelve UNA ruta cuando el mapa solo tiene un camino, en
	# lugar de dos iguales. La escuadra debe leerlo como "aquí no se flanquea".
	var service := FakeNavService.new()
	service.canned = [PackedVector3Array([Vector3.ZERO, Vector3(0.0, 0.0, -5.0)])]
	query.nav_service = service
	var routes := query.disjoint_routes(Vector3.ZERO, Vector3(0.0, 0.0, -9.0), 2)
	assert_size(routes, 1, "un pasillo único da una ruta, y eso no es un error")
