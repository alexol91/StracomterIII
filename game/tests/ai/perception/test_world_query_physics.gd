extends TestCase
## El backend de física y su composición con el de navegación.
##
## No hace falta escena para fijar lo que más importa: qué contestan cuando
## están a medio montar. Un `WorldQuery` incompleto no falla, degrada — y la
## dirección en la que degrada es la diferencia entre un bot ciego un instante
## (se nota en cuanto se prueba) y un bot con visión de rayos X (no se nota
## nunca). Este proyecto ya tuvo el segundo por duplicar el raycast.

const WorldQueryFake := preload("res://tests/ai/perception/world_query_fake.gd")

var physics: WorldQueryPhysics = null


func before_each() -> void:
	physics = WorldQueryPhysics.new()


# ---- Backend de física ----

func test_without_a_physics_space_vision_is_denied_never_granted() -> void:
	assert_false(physics.is_ready(), "sin enlazar, no hay espacio de física")
	assert_false(
		physics.has_line_of_sight(Vector3.ZERO, Vector3(10.0, 0.0, 0.0)),
		"un backend de física sin mundo debe NEGAR la visión, no concederla"
	)
	assert_eq(
		physics.raycast(Vector3.ZERO, Vector3(10.0, 0.0, 0.0)),
		Vector3.INF,
		"y no inventarse un impacto"
	)


func test_the_physics_backend_deliberately_does_not_answer_navigation() -> void:
	# Ya no tiene caché de caminos ni servicio de navegación: esas preguntas
	# son de `NavService`, y juntarlas es trabajo del compositor. Dos cachés
	# del mismo dato divergen igual que divergían los dos raycast.
	assert_false(physics.has_method("clear_cache"), "sin caché propia de caminos")
	assert_true(is_inf(physics.path_cost(Vector3.ZERO, Vector3(3.0, 0.0, 4.0))),
		"el coste de camino no es suyo: hereda el INF del contrato")
	assert_size(physics.disjoint_routes(Vector3.ZERO, Vector3(5.0, 0.0, 0.0)), 0)


# ---- Composición ----

func test_the_composite_joins_the_two_halves() -> void:
	var navigation := WorldQueryFake.new()
	var world := WorldQueryComposite.new(physics, navigation)
	assert_true(world.is_complete(), "con las dos mitades enlazadas")
	assert_true(world is WorldQuery, "y sigue siendo un WorldQuery cualquiera")
	# Navegación real (sintética) con física a medio montar: la oclusión se
	# niega, pero el coste de camino sigue respondiendo. Cada mitad por su lado.
	assert_false(world.has_line_of_sight(Vector3.ZERO, Vector3(5.0, 0.0, 0.0)))
	assert_almost_eq(world.path_cost(Vector3.ZERO, Vector3(4.0, 0.0, 0.0)), 4.0, 0.6)


func test_a_composite_missing_a_half_says_so_instead_of_pretending() -> void:
	assert_false(WorldQueryComposite.new(physics, null).is_complete(), "falta navegación")
	assert_false(WorldQueryComposite.new(null, WorldQueryFake.new()).is_complete(), "falta física")
	assert_false(WorldQueryComposite.new(null, null).is_complete(), "faltan las dos")


func test_a_composite_without_physics_denies_vision() -> void:
	var world := WorldQueryComposite.new(null, WorldQueryFake.new())
	assert_false(
		world.has_line_of_sight(Vector3.ZERO, Vector3(5.0, 0.0, 0.0)),
		"sin backend de física no se concede visión: ante la duda, no se ve"
	)


func test_a_composite_without_navigation_hears_by_straight_line_not_by_silence() -> void:
	# INF *afirma* que no hay paso, y eso amortiguaría todos los ruidos de un
	# nivel sin hornear dejando sordos a los bots sin dar un solo error.
	var world := WorldQueryComposite.new(physics, null)
	assert_almost_eq(
		world.path_cost(Vector3.ZERO, Vector3(3.0, 0.0, 4.0)),
		5.0,
		0.0001,
		"sin navegación, el oído cae a la distancia recta"
	)


func test_flanking_routes_are_delegated_to_the_navigation_backend() -> void:
	var navigation := FakeRoutes.new()
	var route_a := PackedVector3Array([Vector3.ZERO, Vector3(0.0, 0.0, -5.0)])
	var route_b := PackedVector3Array([Vector3.ZERO, Vector3(4.0, 0.0, -5.0)])
	navigation.canned = [route_a, route_b]
	var world := WorldQueryComposite.new(physics, navigation)

	var routes := world.disjoint_routes(Vector3.ZERO, Vector3(0.0, 0.0, -9.0), 2)
	assert_size(routes, 2, "las rutas salen del planificador, no del compositor")
	assert_eq(routes[0], route_a, "y llegan tal cual, sin reinterpretar")
	assert_eq(navigation.last_to, Vector3(0.0, 0.0, -9.0), "con el destino que se pidió")


func test_a_single_route_means_no_flanking_not_a_failure() -> void:
	# `RoutePlanner` devuelve UNA ruta cuando el mapa solo tiene un camino, en
	# lugar de dos iguales. La escuadra debe leerlo como "aquí no se flanquea".
	var navigation := FakeRoutes.new()
	navigation.canned = [PackedVector3Array([Vector3.ZERO, Vector3(0.0, 0.0, -5.0)])]
	var world := WorldQueryComposite.new(physics, navigation)
	assert_size(
		world.disjoint_routes(Vector3.ZERO, Vector3(0.0, 0.0, -9.0), 2),
		1,
		"un pasillo único da una ruta, y eso no es un error"
	)


## Doble de navegación que solo sabe de rutas: sirve para comprobar que la
## delegación EXISTE, no para reimplementar el planificador.
class FakeRoutes:
	extends WorldQuery

	var last_to: Vector3 = Vector3.INF
	var canned: Array[PackedVector3Array] = []

	func disjoint_routes(
		_from: Vector3, to: Vector3, _max_routes: int = 2
	) -> Array[PackedVector3Array]:
		last_to = to
		return canned
