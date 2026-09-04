class_name VisionSensor
extends RefCounted
## Vista de un bot: dos conos con RAYCAST DE OCLUSIÓN OBLIGATORIO (GDD §8.1).
##
## La diferencia crítica con el original: el legacy comprobaba la inclusión del
## objetivo en un TRIÁNGULO (`Tri::isInside`, Bot.cc:441) y por eso sus bots
## "veían" a través de las paredes en cuanto el test de rayo Box2D fallaba o no
## se aplicaba. Aquí un objetivo dentro del cono pero detrás de geometría opaca
## NO se detecta. Nunca. `detected` exige línea de visión confirmada en ESTE
## tick; sin presupuesto de raycast no hay confirmación, y sin confirmación no
## hay detección.
##
## Además el cono secundario SÍ existe: en el legacy era código inalcanzable
## (`isInsideFOV` nunca devolvía 2, análisis §3.2) y la banda 500-700 px solo
## servía para dibujar depuración.
##
## Todas las consultas al mundo pasan por `WorldQuery`, que es inyectable: por
## eso este sensor se prueba en `--headless` sin escena, sin física y sin GPU.
##
## PUREZA: `evaluate()` es determinista dados (observador, objetivos, mundo,
## dt, presupuesto) y el acumulador de conciencia del propio sensor. Toda la
## geometría y la curva de adquisición viven en funciones `static` puras.

## En qué cono cae un objetivo.
enum Cone {
	NONE,       ## Fuera de visión.
	PRIMARY,    ## Foco: detección rápida.
	SECONDARY,  ## Periférico: detección lenta.
}

# --- Números sin dato en `CharacterStats`. ---
# TODO(arquitecto): mover a datos (CharacterStats o un PerceptionProfile).

## Altura de los ojos sobre el origen del cuerpo, en metros.
const EYE_HEIGHT_M: float = 1.6
## Altura del punto al que se dispara el rayo de oclusión (pecho del objetivo).
const TARGET_CHEST_HEIGHT_M: float = 1.1
## Lo mismo, con el objetivo agachado.
const TARGET_CROUCHED_CHEST_HEIGHT_M: float = 0.65
## El cono periférico alcanza menos lejos que el foco.
const SECONDARY_RANGE_FACTOR: float = 0.75
## Segundos de exposición continua para adquirir un objetivo en el foco.
const PRIMARY_ACQUIRE_S: float = 0.25
## Lo mismo en el cono periférico: mirar de reojo cuesta más.
const SECONDARY_ACQUIRE_S: float = 1.10
## Segundos que tarda la conciencia en caer a cero al perder de vista.
const AWARENESS_DECAY_S: float = 0.60
## Factor de velocidad de adquisición en el límite del alcance (1 = sin penalización).
const FAR_ACQUIRE_FACTOR: float = 0.45
## Un objetivo agachado se adquiere más despacio.
const CROUCHED_ACQUIRE_FACTOR: float = 0.70
## Tolerancia vertical, en metros. El juego pasa en una torre por plantas: un
## bot no ve a quien está un piso por encima aunque caiga dentro del cono.
const VERTICAL_VISION_M: float = 3.0
## Capa de colisión que bloquea la visión (`3d_physics/layer_1 = "world"`).
const OCCLUDER_MASK: int = 1
## Conciencia a partir de la cual el objetivo se considera adquirido.
const DETECTION_THRESHOLD: float = 1.0


## Candidato a ser visto. Lo construye quien conoce la escena (el cerebro del
## bot); el sensor solo lee datos, nunca nodos.
class Target:
	extends RefCounted

	var target_id: int = 0
	var team: int = 0
	## Origen del cuerpo (a los pies), no el centro de masa.
	var position: Vector3 = Vector3.ZERO
	## Velocidad estimada, para que la memoria pueda extrapolar.
	var velocity: Vector3 = Vector3.ZERO
	var is_alive: bool = true
	var is_crouched: bool = false


## Resultado de evaluar un candidato en un tick.
class Sighting:
	extends RefCounted

	var target_id: int = 0
	var team: int = 0
	var position: Vector3 = Vector3.ZERO
	var velocity: Vector3 = Vector3.ZERO
	var distance_m: float = INF
	var cone: Cone = Cone.NONE
	## ¿Se confirmó línea de visión con un raycast en ESTE tick?
	var has_line_of_sight: bool = false
	## ¿Se gastó un raycast en este candidato? Si no, no está confirmado.
	var was_tested: bool = false
	var is_crouched: bool = false
	## 0..1. Acumulador de adquisición.
	var awareness: float = 0.0
	## Detección firme: conciencia completa Y línea de visión confirmada ahora.
	var detected: bool = false


## Lo que devuelve un tick de visión.
class Result:
	extends RefCounted

	var sightings: Array[Sighting] = []
	var raycasts_used: int = 0
	## Mejor objetivo detectado (cono primario primero, luego el más cercano).
	var best: Sighting = null


## Altura de ojos efectiva. Los tests la ponen a 0 para razonar en un plano.
var eye_height_m: float = EYE_HEIGHT_M
## Capa que bloquea la visión.
var occluder_mask: int = OCCLUDER_MASK

## target_id -> conciencia 0..1. Es el único estado del sensor.
var _awareness: Dictionary[int, float] = {}


# ---- Geometría pura ----

## ¿En qué cono cae `target_position` para un observador en `observer_position`
## mirando hacia `forward`? El ángulo se mide en el plano XZ (el juego es de
## plantas); la altura entra como tolerancia vertical, no como cono sólido.
static func cone_for(
	observer_position: Vector3,
	forward: Vector3,
	target_position: Vector3,
	range_m: float,
	primary_half_deg: float,
	secondary_half_deg: float
) -> Cone:
	var to_target := target_position - observer_position
	if absf(to_target.y) > VERTICAL_VISION_M:
		return Cone.NONE
	var distance := to_target.length()
	if distance > range_m:
		return Cone.NONE
	# A quemarropa y en cualquier dirección: el contacto es inevitable.
	if distance < 0.001:
		return Cone.PRIMARY
	var flat_to_target := Vector3(to_target.x, 0.0, to_target.z)
	var flat_forward := Vector3(forward.x, 0.0, forward.z)
	if flat_to_target.length_squared() < 0.000001 or flat_forward.length_squared() < 0.000001:
		return Cone.PRIMARY if distance <= range_m else Cone.NONE
	var angle_deg := rad_to_deg(flat_forward.normalized().angle_to(flat_to_target.normalized()))
	if angle_deg <= primary_half_deg:
		return Cone.PRIMARY
	if angle_deg <= secondary_half_deg and distance <= range_m * SECONDARY_RANGE_FACTOR:
		return Cone.SECONDARY
	return Cone.NONE


## Conciencia ganada por segundo de exposición continua.
static func acquire_rate(cone: Cone, distance_m: float, range_m: float, crouched: bool) -> float:
	if cone == Cone.NONE or range_m <= 0.0:
		return 0.0
	var base := 1.0 / PRIMARY_ACQUIRE_S if cone == Cone.PRIMARY else 1.0 / SECONDARY_ACQUIRE_S
	var t := clampf(distance_m / range_m, 0.0, 1.0)
	var distance_factor := lerpf(1.0, FAR_ACQUIRE_FACTOR, t)
	var crouch_factor := CROUCHED_ACQUIRE_FACTOR if crouched else 1.0
	return base * distance_factor * crouch_factor


## Un paso del acumulador de adquisición. Sube solo si hay visión CONFIRMADA.
static func step_awareness(awareness: float, rate_per_s: float, dt: float, visible: bool) -> float:
	if visible:
		return clampf(awareness + rate_per_s * dt, 0.0, 1.0)
	return clampf(awareness - dt / AWARENESS_DECAY_S, 0.0, 1.0)


## Punto al que se lanza el rayo de oclusión: el pecho del objetivo.
## Un objetivo agachado ofrece un punto más bajo, así que una cobertura a la
## altura del pecho lo esconde de verdad.
static func aim_point(position: Vector3, crouched: bool) -> Vector3:
	var height := TARGET_CROUCHED_CHEST_HEIGHT_M if crouched else TARGET_CHEST_HEIGHT_M
	return position + Vector3.UP * height


# ---- Tick ----

## Evalúa todos los candidatos gastando como mucho `raycast_budget` rayos.
##
## El orden de gasto no es arbitrario: primero el cono primario, luego los ya
## adquiridos, luego los más cercanos. Si el presupuesto se agota, el bot deja
## de confirmar a los candidatos irrelevantes — nunca al que tiene delante.
func evaluate(
	observer_position: Vector3,
	forward: Vector3,
	stats: CharacterStats,
	targets: Array[Target],
	world: WorldQuery,
	dt: float,
	raycast_budget: int
) -> Result:
	var result := Result.new()
	if world == null or stats == null:
		return result

	var range_m := stats.vision_range_m
	var primary_half := stats.vision_fov_primary_deg
	var secondary_half := stats.vision_fov_secondary_deg
	var eye := observer_position + Vector3.UP * eye_height_m

	var candidates: Array[Sighting] = []
	var live_ids: Dictionary[int, bool] = {}

	for target: Target in targets:
		if target == null or not target.is_alive:
			continue
		live_ids[target.target_id] = true
		var sighting := Sighting.new()
		sighting.target_id = target.target_id
		sighting.team = target.team
		sighting.position = target.position
		sighting.velocity = target.velocity
		sighting.is_crouched = target.is_crouched
		sighting.distance_m = observer_position.distance_to(target.position)
		sighting.cone = cone_for(
			observer_position, forward, target.position, range_m, primary_half, secondary_half
		)
		sighting.awareness = _awareness.get(target.target_id, 0.0)
		candidates.append(sighting)

	# Los que ya no están en la lista de candidatos pierden conciencia sola.
	for known_id: int in _awareness.keys():
		if not live_ids.has(known_id):
			_awareness.erase(known_id)

	candidates.sort_custom(_compare_priority)

	var rays := 0
	for sighting: Sighting in candidates:
		var in_cone := sighting.cone != Cone.NONE
		var visible := false
		if in_cone and rays < raycast_budget:
			# Aquí está la corrección del legacy: sin rayo despejado no hay
			# detección, aunque el objetivo esté centradísimo en el cono.
			var chest := aim_point(sighting.position, sighting.is_crouched)
			visible = world.has_line_of_sight(eye, chest, occluder_mask)
			sighting.was_tested = true
			rays += 1
		sighting.has_line_of_sight = visible
		var rate := acquire_rate(sighting.cone, sighting.distance_m, range_m, sighting.is_crouched)
		sighting.awareness = step_awareness(sighting.awareness, rate, dt, visible)
		sighting.detected = visible and sighting.awareness >= DETECTION_THRESHOLD
		_awareness[sighting.target_id] = sighting.awareness
		result.sightings.append(sighting)
		if sighting.detected and (result.best == null or _is_better(sighting, result.best)):
			result.best = sighting

	result.raycasts_used = rays
	return result


## Conciencia actual sobre un objetivo, 0..1. Para depuración y para los tests.
func awareness_of(target_id: int) -> float:
	return _awareness.get(target_id, 0.0)


func reset() -> void:
	_awareness.clear()


# ---- Orden de prioridad ----

func _compare_priority(a: Sighting, b: Sighting) -> bool:
	var pa := _priority_of(a)
	var pb := _priority_of(b)
	if not is_equal_approx(pa, pb):
		return pa > pb
	# Desempate estable: el mismo escenario da siempre el mismo orden.
	return a.target_id < b.target_id


func _priority_of(s: Sighting) -> float:
	var score := 0.0
	if s.cone == Cone.PRIMARY:
		score += 2.0
	elif s.cone == Cone.SECONDARY:
		score += 1.0
	if s.awareness >= DETECTION_THRESHOLD:
		score += 1.0
	score -= minf(s.distance_m, 1000.0) * 0.001
	return score


func _is_better(a: Sighting, b: Sighting) -> bool:
	var rank_a := 1 if a.cone == Cone.PRIMARY else 0
	var rank_b := 1 if b.cone == Cone.PRIMARY else 0
	if rank_a != rank_b:
		return rank_a > rank_b
	return a.distance_m < b.distance_m
