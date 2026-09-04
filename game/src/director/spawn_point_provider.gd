class_name SpawnPointProvider
extends RefCounted
## Contrato de dónde puede aparecer un enemigo. La implementación real es de
## `ai-navegacion` (muestreo de navmesh, rayos de oclusión, accesos reales);
## aquí solo está la INTERFAZ y las reglas de justicia, que son puras y por
## tanto probables sin mundo.
##
## Reparto de responsabilidades, a propósito:
## * El proveedor toca el mundo y propone candidatos con sus datos medidos
##   (navegable, distancia de CAMINO, línea de visión, si es un acceso real).
## * El director no toca el mundo: filtra por justicia y pondera. Eso hace
##   que "ninguna aparición viola las reglas" sea un test de función pura y
##   no un test de integración con navmesh.
##
## Qué hacía el original (`Optimization.cc:144-168`): elegía un incentro de
## triángulo de área >= 2000 px² al azar y lo aceptaba si estaba a más de
## 200 px del jugador —unos 2,7 m—, es decir, prácticamente en su cara; no
## miraba el cono de visión ni la línea de visión, y cuando descartaba un
## candidato CONSUMÍA la iteración, así que aparecían menos enemigos de los
## calculados. Las tres cosas se corrigen aquí.

# TODO(arquitecto): estas tres constantes son balanceo y deberían vivir en
# DirectorProfile, junto a `min_spawn_distance_m`.

## Semiángulo del cono de visión del jugador, en grados. Debería derivarse
## del FOV real de la cámara.
const DEFAULT_PLAYER_FOV_HALF_ANGLE_DEG: float = 55.0
## Distancia de camino a partir de la cual un punto empieza a perder peso.
## Aparecer a 80 m por camino significa llegar cuando el tiroteo ha acabado.
const PATH_DISTANCE_FALLOFF_M: float = 25.0
## Cuánto más probable es un acceso real (puerta, escalera, ascensor) que un
## punto en mitad de una sala.
const ENTRY_POINT_WEIGHT_BONUS: float = 2.0
## Distancia mínima de reserva, solo por si alguien construye una petición a
## mano. La de verdad es `DirectorProfile.min_spawn_distance_m` y la pone el
## director en cada petición.
const FALLBACK_MIN_DISTANCE_M: float = 12.0

## Lo que el director pide.
class SpawnRequest:
	extends RefCounted

	var player_position: Vector3 = Vector3.ZERO
	## Dirección de la mirada del jugador, normalizada.
	var player_forward: Vector3 = Vector3.FORWARD
	var player_fov_half_angle_deg: float = DEFAULT_PLAYER_FOV_HALF_ANGLE_DEG
	## Distancia mínima al jugador, en metros (`min_spawn_distance_m`).
	var min_distance_m: float = FALLBACK_MIN_DISTANCE_M
	## Cuántos puntos se necesitan.
	var count: int = 1
	## Zona de la que se piden puntos.
	var zone_id: int = 0
	var forbid_in_player_fov: bool = true
	var forbid_line_of_sight: bool = true
	var prefer_entry_points: bool = true


## Un punto candidato, con todo lo que el proveedor ya midió en el mundo.
class SpawnCandidate:
	extends RefCounted

	var position: Vector3 = Vector3.ZERO
	## ¿Está sobre navmesh navegable?
	var navigable: bool = true
	## ¿Hay línea de visión directa desde el jugador?
	var has_line_of_sight_to_player: bool = false
	## Distancia de CAMINO al jugador, en metros. INF si no hay ruta: un
	## punto sin ruta es un punto del que nunca saldría nadie.
	var path_distance_m: float = INF
	## ¿Es un acceso real (puerta, hueco de escalera, ascensor)?
	var is_entry_point: bool = false
	## Peso asignado en el último reparto. Solo depuración.
	var last_weight: float = 0.0

	func _init(p_position: Vector3 = Vector3.ZERO) -> void:
		position = p_position


# ---- Interfaz que implementa `ai-navegacion` ----

## Candidatos de aparición para una petición. La implementación real muestrea
## el navmesh de la zona y mide oclusión con rayos.
func sample_candidates(_request: SpawnRequest) -> Array[SpawnCandidate]:
	return []


## Accesos reales de una zona: puertas, huecos de escalera, ascensores.
func entry_points(_zone_id: int) -> PackedVector3Array:
	return PackedVector3Array()


## Distancia de camino entre dos puntos, en metros. INF si no hay ruta.
func path_distance(_from: Vector3, _to: Vector3) -> float:
	return INF


## ¿Está el proveedor listo? Un nivel sin navmesh horneado devuelve false y
## el director debe negarse a generar en lugar de soltar enemigos en el aire.
func is_ready() -> bool:
	return false


# ---- Reglas de justicia (puras) ----

## ¿Es JUSTA esta aparición? Cuatro condiciones, todas del GDD §7:
## navegable, a `min_distance_m` o más en línea recta y con ruta real, fuera
## del cono de visión del jugador y sin línea de visión directa.
##
## Se exige la distancia EUCLÍDEA además de la de camino porque es la única
## que garantiza que nadie aparezca al lado del jugador: la de camino siempre
## es mayor o igual y por sí sola no protege de un spawn al otro lado de un
## tabique.
static func is_fair(candidate: SpawnCandidate, request: SpawnRequest) -> bool:
	if not candidate.navigable:
		return false
	if candidate.position.distance_to(request.player_position) < request.min_distance_m:
		return false
	if not is_finite(candidate.path_distance_m):
		return false
	if candidate.path_distance_m < request.min_distance_m:
		return false
	if request.forbid_line_of_sight and candidate.has_line_of_sight_to_player:
		return false
	if request.forbid_in_player_fov and is_inside_view_cone(candidate.position, request):
		return false
	return true


## ¿Cae el punto dentro del cono de visión del jugador?
static func is_inside_view_cone(position: Vector3, request: SpawnRequest) -> bool:
	var to_point := position - request.player_position
	to_point.y = 0.0
	if to_point.length_squared() < 0.000001:
		return true
	var forward := request.player_forward
	forward.y = 0.0
	if forward.length_squared() < 0.000001:
		return false
	var angle := absf(rad_to_deg(forward.normalized().angle_to(to_point.normalized())))
	return angle <= request.player_fov_half_angle_deg


## Peso de un candidato en el reparto. Decae con la distancia de CAMINO —no
## con la euclídea, que ignora tabiques— y premia los accesos reales.
static func weight_of(candidate: SpawnCandidate, request: SpawnRequest) -> float:
	if not is_finite(candidate.path_distance_m):
		return 0.0
	var excess := maxf(candidate.path_distance_m - request.min_distance_m, 0.0)
	var weight := 1.0 / (1.0 + excess / PATH_DISTANCE_FALLOFF_M)
	if request.prefer_entry_points and candidate.is_entry_point:
		weight *= ENTRY_POINT_WEIGHT_BONUS
	return weight


## Elige `request.count` puntos entre los candidatos JUSTOS, con reparto
## ponderado y sin repetir. Determinista para un `rng` dado: la misma semilla
## produce las mismas apariciones, que es lo que hace reproducible una
## partida entera.
static func select(
	candidates: Array[SpawnCandidate],
	request: SpawnRequest,
	rng: RandomNumberGenerator
) -> Array[SpawnCandidate]:
	var pool: Array[SpawnCandidate] = []
	var weights: Array[float] = []
	for candidate: SpawnCandidate in candidates:
		if not is_fair(candidate, request):
			continue
		var weight := weight_of(candidate, request)
		if weight <= 0.0:
			continue
		candidate.last_weight = weight
		pool.append(candidate)
		weights.append(weight)

	var chosen: Array[SpawnCandidate] = []
	var wanted := mini(request.count, pool.size())
	for _i: int in wanted:
		var total: float = 0.0
		for weight: float in weights:
			total += weight
		if total <= 0.0:
			break
		var target := rng.randf() * total
		var index: int = 0
		var accumulated: float = 0.0
		for candidate_index: int in weights.size():
			accumulated += weights[candidate_index]
			if target <= accumulated:
				index = candidate_index
				break
			index = candidate_index
		chosen.append(pool[index])
		pool.remove_at(index)
		weights.remove_at(index)
	return chosen
