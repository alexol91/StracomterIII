class_name SquadFakeRoutes
extends WorldQuery
## `WorldQuery` sintético para las pruebas de escuadra: rutas descritas a mano.
##
## REGLA DE ESTE DOBLE: NO PUEDE SER MÁS AMABLE QUE EL MOTOR. Un doble que
## siempre devuelve dos rutas perfectas, completas y disjuntas deja verde un
## `SquadDirector` que no comprueba nada, y el flanqueo se rompe en el juego
## real sin que ninguna prueba se entere. Por eso este doble sabe hacer
## exactamente lo que hace `NavigationServer3D` cuando las cosas van mal:
##
##   * devolver MENOS rutas de las que se le piden (o ninguna),
##   * devolver rutas PARCIALES, que se quedan a medio camino del objetivo
##     porque el corredor se corta,
##   * devolver rutas que se PARECEN demasiado entre sí (no disjuntas), que es
##     lo que pasa cuando sólo hay un pasillo y el planificador se empeña,
##   * y negarse a proyectar un punto al navmesh (`Vector3.INF`).
##
## Cada aspereza tiene su interruptor y su prueba. Lo que este doble NO hace
## es planificar: las rutas son datos de la prueba. Calcularlas es de
## `ai/navegacion` (`RoutePlanner`), y duplicar su A* aquí sería tener dos
## implementaciones que divergen.

## Rutas que se devolverán, en orden. La 0 es la frontal.
var routes: Array[PackedVector3Array] = []
## Región dentro de la cual se puede proyectar al navmesh.
var snap_bounds: AABB = AABB(Vector3(-50.0, -5.0, -50.0), Vector3(100.0, 10.0, 100.0))
## Si es true, `snap_to_navmesh` siempre falla. Un nivel sin hornear se
## comporta así, y el repliegue tiene que sobrevivirlo.
var snap_always_fails: bool = false

## Telemetría.
var stat_disjoint_calls: int = 0
var stat_snap_calls: int = 0
## Último `max_routes` que se pidió, para comprobar que el director no pide
## más rutas de las que su grupo puede aprovechar.
var stat_last_max_routes: int = 0


## Como el motor: devuelve lo que tiene, nunca más de lo que se le pide, y no
## rellena huecos. Si sólo hay una ruta, sólo hay una ruta.
func disjoint_routes(
	_from: Vector3, _to: Vector3, max_routes: int = 2
) -> Array[PackedVector3Array]:
	stat_disjoint_calls += 1
	stat_last_max_routes = max_routes
	var out: Array[PackedVector3Array] = []
	for route: PackedVector3Array in routes:
		if out.size() >= max_routes:
			break
		out.append(route)
	return out


## Como el motor: el punto más cercano NAVEGABLE, o `Vector3.INF` si no lo
## hay. Nunca el punto pedido tal cual.
func snap_to_navmesh(point: Vector3) -> Vector3:
	stat_snap_calls += 1
	if snap_always_fails:
		return Vector3.INF
	if not snap_bounds.has_point(point):
		return Vector3.INF
	# El motor devuelve un punto sobre la malla, que casi nunca coincide con
	# el que se le pasó: se redondea a la rejilla para que ninguna prueba
	# pueda depender de la igualdad exacta.
	return Vector3(roundf(point.x), 0.0, roundf(point.z))


func path(from: Vector3, to: Vector3) -> PackedVector3Array:
	var snapped_from := snap_to_navmesh(from)
	var snapped_to := snap_to_navmesh(to)
	if is_inf(snapped_from.x) or is_inf(snapped_to.x):
		return PackedVector3Array()
	return PackedVector3Array([snapped_from, snapped_to])


func path_cost(from: Vector3, to: Vector3) -> float:
	var route := path(from, to)
	if route.size() < 2:
		return INF
	return route[0].distance_to(route[1])
