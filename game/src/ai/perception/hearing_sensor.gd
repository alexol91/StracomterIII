class_name HearingSensor
extends RefCounted
## Oído de un bot: atenuación por COSTE DE CAMINO EN NAVMESH (GDD §8.1).
##
## Los disparos, explosiones, puertas y pasos publican `EventBus.noise_emitted`
## con posición, intensidad y radio. La distancia que importa NO es la
## euclídea: es lo que cuesta LLEGAR hasta el foco del ruido. Un disparo al
## otro lado de una pared se oye lejano porque hay que dar la vuelta; el mismo
## disparo al final de un pasillo recto se oye encima.
##
## Esa distinción es lo que convierte el sonido en información táctica en
## lugar de en ruido: el bot que oye fuerte sabe que puede llegar, y va.
##
## PUREZA: la atenuación, el error de localización y la dispersión son
## funciones `static` deterministas que reciben el `PerceptionProfile` por
## parámetro. La única consulta al mundo es `WorldQuery.path_cost`, inyectable.
## Ningún número de balanceo vive aquí dentro (ADR-005).


## Un ruido emitido en el mundo.
class NoiseEvent:
	extends RefCounted

	var position: Vector3 = Vector3.ZERO
	## 0..1.
	var intensity: float = 1.0
	## Alcance máximo del sonido, en metros de COSTE DE CAMINO.
	var radius_m: float = 0.0
	## Quién lo produjo. 0 = anónimo.
	var source_id: int = 0

	static func make(
		p_position: Vector3, p_intensity: float, p_radius_m: float, p_source_id: int
	) -> NoiseEvent:
		var e := NoiseEvent.new()
		e.position = p_position
		e.intensity = clampf(p_intensity, 0.0, 1.0)
		e.radius_m = maxf(p_radius_m, 0.0)
		e.source_id = p_source_id
		return e


## Un ruido efectivamente oído por este bot.
class Heard:
	extends RefCounted

	var source_id: int = 0
	## Dónde CREE el bot que sonó. No es la posición real: cuanto más flojo se
	## oye, más se equivoca.
	var estimated_position: Vector3 = Vector3.ZERO
	## Posición real del foco. Solo para depuración y para los tests.
	var true_position: Vector3 = Vector3.ZERO
	## 0..1. Intensidad percibida tras la atenuación.
	var loudness: float = 0.0
	## Coste de camino usado para atenuar, en metros.
	var path_cost_m: float = INF
	## Distancia recta, para poder comparar. Nunca se usa para atenuar.
	var straight_distance_m: float = INF


## Identificador del oyente. Entra en la semilla del error de localización para
## que dos bots no se equivoquen exactamente igual.
var listener_id: int = 0
## Parámetros del arquetipo. Lo inyecta el `PerceptionSystem`.
var profile: PerceptionProfile = null

var _queue: Array[NoiseEvent] = []


# ---- Modelo puro ----

## Atenuación 0..1 en función del coste de camino y del alcance del sonido.
static func attenuation(
	path_cost_m: float, radius_m: float, profile: PerceptionProfile
) -> float:
	if radius_m <= 0.0:
		return 0.0
	if is_inf(path_cost_m) or path_cost_m >= radius_m:
		return 0.0
	var t := 1.0 - path_cost_m / radius_m
	return pow(clampf(t, 0.0, 1.0), profile.attenuation_exponent)


## Sonoridad percibida 0..1.
static func loudness_of(
	intensity: float, path_cost_m: float, radius_m: float, profile: PerceptionProfile
) -> float:
	return clampf(intensity, 0.0, 1.0) * attenuation(path_cost_m, radius_m, profile)


## Coste de camino efectivo. Si no hay ruta de navmesh, el sonido llega
## atravesando geometría: se estima con la recta penalizada.
static func effective_cost(
	path_cost_m: float, straight_distance_m: float, profile: PerceptionProfile
) -> float:
	if is_inf(path_cost_m) or path_cost_m < 0.0:
		return straight_distance_m * profile.no_route_cost_factor
	# Un camino nunca puede ser más corto que la recta: si el navmesh lo dice,
	# es que la malla está mal horneada. Se toma la recta como suelo.
	return maxf(path_cost_m, straight_distance_m)


## Radio de incertidumbre de la localización, en metros.
static func localization_error_m(loudness: float, profile: PerceptionProfile) -> float:
	return lerpf(profile.max_localization_error_m, 0.0, clampf(loudness, 0.0, 1.0))


## Desplaza un punto dentro de un disco horizontal de radio `error_m`, de forma
## DETERMINISTA: la misma semilla da siempre el mismo error. Un bot se equivoca
## siempre igual ante la misma situación, lo cual hace el bug reproducible.
static func scatter(origin: Vector3, error_m: float, seed_value: int) -> Vector3:
	if error_m <= 0.0:
		return origin
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var angle := rng.randf() * TAU
	var radius := sqrt(rng.randf()) * error_m
	return origin + Vector3(cos(angle) * radius, 0.0, sin(angle) * radius)


## Semilla estable para el error de localización.
static func scatter_seed(listener: int, source_id: int, position: Vector3) -> int:
	var cell := Vector3i(roundf(position.x * 2.0), roundf(position.y * 2.0), roundf(position.z * 2.0))
	return hash([listener, source_id, cell])


# ---- Cola de eventos ----

## Encola un ruido. Lo llama el `PerceptionSystem` al recibir la señal del
## `EventBus`; el sensor no se suscribe a nada por su cuenta para poder
## probarse sin autoloads.
func push_noise(event: NoiseEvent) -> void:
	if event == null or event.radius_m <= 0.0 or event.intensity <= 0.0:
		return
	if _queue.size() >= effective_profile().max_sound_queue:
		_queue.pop_front()
	_queue.append(event)


## Perfil en uso, con los valores por defecto del recurso si nadie inyectó uno.
func effective_profile() -> PerceptionProfile:
	if profile == null:
		profile = PerceptionProfile.new()
	return profile


func pending_count() -> int:
	return _queue.size()


func clear() -> void:
	_queue.clear()


## Procesa hasta `max_events` ruidos pendientes y devuelve los que se oyen.
## Consume la cola: lo que no cabe en este tick se procesa en el siguiente.
## `max_events` negativo = el que diga el perfil.
func process(
	listener_position: Vector3, world: WorldQuery, max_events: int = -1
) -> Array[Heard]:
	var out: Array[Heard] = []
	if world == null:
		_queue.clear()
		return out
	var budget := max_events if max_events >= 0 else effective_profile().max_sound_events_per_tick
	var processed := 0
	while not _queue.is_empty() and processed < budget:
		var event: NoiseEvent = _queue.pop_front()
		processed += 1
		var heard := evaluate(listener_position, event, world)
		if heard != null:
			out.append(heard)
	return out


## Evalúa un solo ruido. Determinista dados (oyente, evento, mundo).
func evaluate(listener_position: Vector3, event: NoiseEvent, world: WorldQuery) -> Heard:
	if event == null or world == null:
		return null
	var straight := listener_position.distance_to(event.position)
	# Descarte barato antes de pagar una consulta de camino: el coste de
	# camino nunca es menor que la recta, así que fuera del radio recto es
	# imposible que se oiga.
	if straight > event.radius_m:
		return null
	var tuning := effective_profile()
	var raw_cost := world.path_cost(listener_position, event.position)
	var cost := effective_cost(raw_cost, straight, tuning)
	var loudness := loudness_of(event.intensity, cost, event.radius_m, tuning)
	if loudness < tuning.hearing_threshold:
		return null
	var heard := Heard.new()
	heard.source_id = event.source_id
	heard.true_position = event.position
	heard.loudness = loudness
	heard.path_cost_m = cost
	heard.straight_distance_m = straight
	var error := localization_error_m(loudness, tuning)
	var seed_value := scatter_seed(listener_id, event.source_id, event.position)
	heard.estimated_position = scatter(event.position, error, seed_value)
	return heard


## Confianza que aporta un ruido a la memoria de contactos. Oír nunca da la
## certeza de ver: por eso está acotada.
static func confidence_from(loudness: float, profile: PerceptionProfile) -> float:
	return clampf(loudness, 0.0, 1.0) * profile.max_sound_confidence
