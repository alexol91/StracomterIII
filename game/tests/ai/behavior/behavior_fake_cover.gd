class_name BehaviorFakeCover
extends CoverProvider
## Nube de cobertura sintética para las pruebas de comportamiento.
##
## Se declaran los puntos a mano y se ordenan por distancia, sin reimplementar
## la puntuación de `CoverProviderBaked` (protección − exposición − coste +
## progreso): probar aquí una copia de esa fórmula probaría la copia, no el
## sistema. Lo que este doble tiene que reproducir fielmente son sus MODOS DE
## FALLO, que son los que el comportamiento debe saber encajar:
##
##   * una nube VACÍA devuelve una lista vacía, no un punto inventado — es el
##     caso "no hay dónde cubrirse", que debe acabar en retirada;
##   * `point_count()` a 0 significa nivel sin hornear, y así lo denuncia
##     `BehaviorContext.problems()`;
##   * `query()` puede devolver menos de `k` puntos.

## Puntos disponibles. Vacío = no hay dónde cubrirse.
var points: Array[CoverProvider.CoverPoint] = []
## Radio más allá del cual un punto no se ofrece.
var search_radius_m: float = 20.0
var query_count: int = 0
var last_threats: Array[Vector3] = []


## Añade un punto con cobertura alta en todas las direcciones.
func add_point(position: Vector3) -> CoverProvider.CoverPoint:
	var point := CoverProvider.CoverPoint.new()
	point.position = position
	var chest: Array[CoverProvider.Quality] = []
	var head: Array[CoverProvider.Quality] = []
	for _i: int in range(8):
		chest.append(CoverProvider.Quality.HIGH)
		head.append(CoverProvider.Quality.HIGH)
	point.chest = chest
	point.head = head
	points.append(point)
	return point


func query(from: Vector3, threats: Array[Vector3], _objective: Vector3,
		_crouched: bool, k: int = 3) -> Array[CoverProvider.CoverPoint]:
	query_count += 1
	last_threats = threats.duplicate()
	var reachable: Array[CoverProvider.CoverPoint] = []
	for point: CoverProvider.CoverPoint in points:
		if point.position.distance_to(from) <= search_radius_m:
			reachable.append(point)
	reachable.sort_custom(func(a: CoverProvider.CoverPoint, b: CoverProvider.CoverPoint) -> bool:
		return a.position.distance_to(from) < b.position.distance_to(from))
	return reachable.slice(0, mini(k, reachable.size()))


func exposure_at(point: Vector3, _threats: Array[Vector3], _crouched: bool) -> float:
	for candidate: CoverProvider.CoverPoint in points:
		if candidate.position.distance_to(point) < 1.0:
			return 0.0
	return 1.0


func point_count() -> int:
	return points.size()
