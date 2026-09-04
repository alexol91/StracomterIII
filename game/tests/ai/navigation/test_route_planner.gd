extends TestCase
## Rutas alternativas realmente disjuntas (GDD §8.4).
##
## El criterio no es "dos rutas distintas": es que NO COMPARTAN TRAMO. Dos
## flanqueadores enviados por el mismo pasillo con dos metros de diferencia no
## son un flanqueo, son una cola. Y "ángulo del objetivo + 90°" no es flanquear:
## es caminar hacia una pared.

## Anillo: explanada de 32×32 m con un bloque macizo de 20×20 en el centro.
## Deja dos corredores de 6 m entre cualquier par de puntos opuestos.
const OUTER_HALF_M: float = 16.0
const BLOCK_HALF_M: float = 10.0
## Puntos enfrentados, dentro del corredor oeste y del este.
const WEST_POINT: Vector3 = Vector3(-13.0, 0.0, 0.0)
const EAST_POINT: Vector3 = Vector3(13.0, 0.0, 0.0)
## Un corredor sin alternativa: pasillo recto, una sola ruta posible.
const CORRIDOR_HALF_LENGTH_M: float = 12.0
const CORRIDOR_HALF_WIDTH_M: float = 2.0


func test_el_anillo_produce_dos_rutas_sin_tramos_comunes() -> void:
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var routes := world.nav.disjoint_routes(WEST_POINT, EAST_POINT, 2)
	assert_size(routes, 2,
		"un anillo tiene dos corredores: deben salir dos rutas")
	if routes.size() == 2:
		assert_false(RoutePlanner.routes_share_segment(routes[0], routes[1]),
			"las dos rutas comparten tramo: eso no es un flanqueo")
		# Una rodea por el norte y la otra por el sur. Si las dos rodean por el
		# mismo lado, la exclusión de polígonos no está funcionando.
		var first_z := _extreme_z(routes[0])
		var second_z := _extreme_z(routes[1])
		assert_lt(first_z * second_z, 0.0,
			"las dos rutas rodean por el mismo lado (z extremos %f y %f)"
			% [first_z, second_z])
	world.dispose()


func test_las_rutas_empiezan_y_acaban_donde_se_pidio() -> void:
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var routes := world.nav.disjoint_routes(WEST_POINT, EAST_POINT, 2)
	assert_gt(float(routes.size()), 0.0, "debería haber al menos una ruta")
	for route: PackedVector3Array in routes:
		assert_gt(float(route.size()), 1.0, "una ruta necesita al menos 2 puntos")
		if route.size() > 1:
			var start := route[0]
			var end := route[route.size() - 1]
			assert_lt(Vector2(start.x - WEST_POINT.x, start.z - WEST_POINT.z).length(),
				NavTuning.ROUTE_ENDPOINT_KEEP_RADIUS_M,
				"la ruta debe salir de donde está el bot, y sale de %s" % start)
			assert_lt(Vector2(end.x - EAST_POINT.x, end.z - EAST_POINT.z).length(),
				NavTuning.ROUTE_ENDPOINT_KEEP_RADIUS_M,
				"la ruta debe acabar en el objetivo, y acaba en %s" % end)
	world.dispose()


func test_las_rutas_se_quedan_sobre_el_navmesh() -> void:
	# El suavizado (embudo) no puede cortar por dentro del bloque central. Si
	# lo hiciera, el flanqueador saldría andando a través de una pared.
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var routes := world.nav.disjoint_routes(WEST_POINT, EAST_POINT, 2)
	assert_gt(float(routes.size()), 0.0, "debería haber al menos una ruta")
	var checked := 0
	for route: PackedVector3Array in routes:
		for i in range(route.size() - 1):
			var steps := maxi(1, int(ceilf(route[i].distance_to(route[i + 1]) / 0.5)))
			for s in range(steps + 1):
				var p: Vector3 = route[i].lerp(route[i + 1], float(s) / float(steps))
				checked += 1
				assert_true(world.nav.snap_to_navmesh(p).is_finite(),
					"la ruta pasa por %s, que no está sobre el navmesh" % p)
	assert_gt(float(checked), 0.0, "no se comprobó ni un punto de la ruta")
	world.dispose()


func test_un_pasillo_sin_alternativa_devuelve_una_sola_ruta() -> void:
	# Es la respuesta honesta: mejor un flanqueo menos que dos bots enfilados
	# por el mismo pasillo creyéndose que se están abriendo en abanico.
	var boxes: Array[AABB] = [
		AABB(Vector3(-CORRIDOR_HALF_LENGTH_M, -0.5, -CORRIDOR_HALF_WIDTH_M),
			Vector3(CORRIDOR_HALF_LENGTH_M * 2.0, 0.5, CORRIDOR_HALF_WIDTH_M * 2.0)),
	]
	var world := NavTestUtil.fixture(boxes)
	var routes := world.nav.disjoint_routes(
		Vector3(-10.0, 0.0, 0.0), Vector3(10.0, 0.0, 0.0), 3)
	assert_size(routes, 1, "en un pasillo recto no hay dos caminos disjuntos")
	world.dispose()


func test_el_grafo_dual_se_construye_del_navmesh_del_motor() -> void:
	# La malla la hornea Recast; aquí sólo se recorre el grafo de polígonos que
	# ya ha producido. Si el grafo sale vacío, no hay nada que planificar.
	var world := NavTestUtil.ring_scenario(OUTER_HALF_M, BLOCK_HALF_M)
	var planner := RoutePlanner.new()
	planner.build(world.mesh)
	assert_eq(planner.polygon_count(), world.mesh.get_polygon_count(),
		"el grafo debe tener un nodo por polígono del navmesh")
	assert_gt(float(planner.polygon_count()), 3.0,
		"un anillo necesita varios polígonos para tener dos corredores")
	world.dispose()


func test_routes_share_segment_detecta_el_caso_evidente() -> void:
	# Comprobación del propio detector: dos rutas idénticas comparten tramo, y
	# dos separadas no. Sin esto, la prueba principal podría estar pasando
	# porque el detector no detecta nada.
	var a := PackedVector3Array([
		Vector3(0.0, 0.0, 0.0), Vector3(20.0, 0.0, 0.0)])
	var b := PackedVector3Array([
		Vector3(0.0, 0.0, 0.0), Vector3(20.0, 0.0, 0.0)])
	var c := PackedVector3Array([
		Vector3(0.0, 0.0, 0.0), Vector3(10.0, 0.0, 30.0), Vector3(20.0, 0.0, 0.0)])
	assert_true(RoutePlanner.routes_share_segment(a, b),
		"dos rutas idénticas comparten tramo")
	assert_false(RoutePlanner.routes_share_segment(a, c),
		"dos rutas que sólo coinciden en los extremos no comparten tramo")


func _extreme_z(route: PackedVector3Array) -> float:
	var extreme := 0.0
	for p: Vector3 in route:
		if absf(p.z) > absf(extreme):
			extreme = p.z
	return extreme
