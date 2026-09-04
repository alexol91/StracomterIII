class_name CoverProviderBaked
extends CoverProvider
## Consulta en ejecución de la nube de cobertura horneada (GDD §8.3).
##
## Puntuación, literal del GDD:
##   protección frente a amenazas conocidas
##   − exposición a las demás
##   − coste de camino
##   + progreso hacia el objetivo
##
## "Las demás" no es retórica: un punto que te tapa del tirador de la puerta
## pero te deja en bandeja al de la ventana no vale, y el término de exposición
## es lo que hace que el bot lo descarte. Por eso cada amenaza suma en UNO de
## los dos términos, no en los dos.
##
## Nunca se consulta por frame: sólo al cambiar de comportamiento (ADR-002).
## El índice espacial es obligatorio; recorrer miles de puntos por consulta es
## exactamente el error que hundiría el frame con 40 bots.

const Tuning := preload("res://src/ai/navigation/nav_tuning.gd")


## Candidato puntuado. Clase interna para no crear diccionarios por punto.
class Scored:
	extends RefCounted

	var index: int = -1
	var score: float = 0.0
	var protection: float = 0.0
	var exposure: float = 0.0
	var travel: float = 0.0
	var progress: float = 0.0


var _cloud: CoverPointCloud = null
## Opcional. Si está, los K finalistas se reordenan con coste de camino REAL
## en lugar de con distancia euclídea.
var _world: WorldQuery = null
var _search_radius_m: float = Tuning.COVER_SEARCH_RADIUS_M

## Candidatos examinados en la última consulta. Es la medida objetiva de que
## la consulta no escala con el tamaño de la nube.
var stat_last_candidates: int = 0
## Candidatos a los que se les pidió un coste de camino real.
var stat_last_refined: int = 0


func setup(cloud: CoverPointCloud, world: WorldQuery = null) -> void:
	_cloud = cloud
	_world = world
	if _cloud != null:
		_cloud.rebuild_index()


func cloud() -> CoverPointCloud:
	return _cloud


func set_search_radius(radius_m: float) -> void:
	_search_radius_m = maxf(radius_m, 1.0)


func point_count() -> int:
	return 0 if _cloud == null else _cloud.size()


# ---------------------------------------------------------------------------
# CoverProvider
# ---------------------------------------------------------------------------

func query(from: Vector3, threats: Array[Vector3], objective: Vector3,
		crouched: bool, k: int = 3) -> Array[CoverProvider.CoverPoint]:
	var out: Array[CoverProvider.CoverPoint] = []
	stat_last_candidates = 0
	stat_last_refined = 0
	if _cloud == null or _cloud.is_empty() or k <= 0:
		return out

	var candidates := _cloud.indices_near(from, _search_radius_m)
	stat_last_candidates = _cloud.stat_last_candidates
	if candidates.is_empty():
		return out

	var has_objective := objective.is_finite()
	var from_to_objective := from.distance_to(objective) if has_objective else 0.0

	var scored: Array[Scored] = []
	scored.resize(candidates.size())
	for i in candidates.size():
		var index := candidates[i]
		var entry := _score(index, from, threats, objective, crouched,
			has_objective, from_to_objective, from.distance_to(_cloud.position_at(index)))
		scored[i] = entry
	scored.sort_custom(func(a: Scored, b: Scored) -> bool: return a.score > b.score)

	# Refinamiento: sólo los finalistas pagan un coste de camino real. Pedir
	# una ruta por candidato reventaría el techo de 4 peticiones por frame.
	var finalists := mini(scored.size(), k * Tuning.SCORE_REFINE_FACTOR)
	if _world != null and finalists > 0:
		for i in finalists:
			var entry := scored[i]
			var real_cost := _world.path_cost(from, _cloud.position_at(entry.index))
			stat_last_refined += 1
			if is_inf(real_cost):
				entry.score = -INF
				continue
			var refined := _score(entry.index, from, threats, objective, crouched,
				has_objective, from_to_objective, real_cost)
			scored[i] = refined
		var head := scored.slice(0, finalists)
		head.sort_custom(func(a: Scored, b: Scored) -> bool: return a.score > b.score)
		for i in head.size():
			scored[i] = head[i]

	var wanted := mini(k, scored.size())
	for i in wanted:
		var entry := scored[i]
		if is_inf(entry.score):
			continue
		var point := _cloud.make_point(entry.index)
		point.last_score = entry.score
		out.append(point)
	return out


## Exposición de una posición arbitraria, 0 = a cubierto, 1 = a pecho
## descubierto. Alimenta `BotState.exposure`.
##
## Una posición sin ningún punto horneado cerca está expuesta por definición:
## la nube sólo contiene puntos que cubren en alguna dirección.
func exposure_at(point: Vector3, threats: Array[Vector3],
		crouched: bool) -> float:
	if _cloud == null or _cloud.is_empty():
		return 1.0
	if threats.is_empty():
		return 0.0
	var index := _cloud.nearest_index(point, Tuning.EXPOSURE_SNAP_RADIUS_M)
	if index < 0:
		return 1.0
	var total := 0.0
	for threat: Vector3 in threats:
		total += Tuning.quality_weight(_cloud.quality_against(index, threat, crouched))
	return clampf(1.0 - total / float(threats.size()), 0.0, 1.0)


# ---------------------------------------------------------------------------
# Puntuación
# ---------------------------------------------------------------------------

func _score(index: int, from: Vector3, threats: Array[Vector3],
		objective: Vector3, crouched: bool, has_objective: bool,
		from_to_objective: float, travel_cost: float) -> Scored:
	var entry := Scored.new()
	entry.index = index
	var position := _cloud.position_at(index)

	var protection := 0.0
	var exposure := 0.0
	for threat: Vector3 in threats:
		var w := Tuning.quality_weight(_cloud.quality_against(index, threat, crouched))
		if w >= Tuning.COVER_EFFECTIVE_PROTECTION:
			protection += w
		else:
			exposure += 1.0 - w
	var divisor := float(maxi(threats.size(), 1))
	entry.protection = protection / divisor
	entry.exposure = exposure / divisor

	entry.travel = travel_cost / Tuning.SCORE_REFERENCE_DISTANCE_M
	entry.progress = 0.0
	if has_objective:
		entry.progress = (from_to_objective - position.distance_to(objective)) \
			/ Tuning.SCORE_REFERENCE_DISTANCE_M

	entry.score = (
		Tuning.SCORE_PROTECTION_WEIGHT * entry.protection
		- Tuning.SCORE_EXPOSURE_WEIGHT * entry.exposure
		- Tuning.SCORE_PATH_COST_WEIGHT * entry.travel
		+ Tuning.SCORE_PROGRESS_WEIGHT * entry.progress
	)
	return entry
