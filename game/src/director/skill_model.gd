class_name SkillModel
extends RefCounted
## Modelo vivo de habilidad del jugador (DDA). Es la entrada que el Simplex
## de 2012 no tenía: allí `dificultad` era una constante por planta
## (`legacy/trunk/core/lib/GameAction.cc:189-197`) y el solucionador, un
## ejercicio correcto con entradas muertas.
##
## Observa cinco señales por encuentro —precisión, daño recibido por minuto,
## tiempo de limpieza, bajas de escuadra y uso de cobertura—, las promedia en
## una ventana móvil y produce un multiplicador acotado a
## `[skill_multiplier_min, skill_multiplier_max]` que multiplica a la
## dificultad de la planta.
##
## [b]Invariante que se prueba, y que manda sobre cualquier otra cosa[/b]
##
## JUGAR PEOR NUNCA AUMENTA EL PRESUPUESTO DE AMENAZA. Cada señal se
## normaliza a "0 = jugó mal, 1 = jugó bien" y la puntuación es una
## combinación convexa de pesos no negativos, así que degradar cualquier
## señal solo puede bajar (o dejar igual) el multiplicador.
##
## Ese invariante es la razón por la que el tiempo de limpieza NO se compara
## con la mediana observada del propio jugador, que es lo que sugiere el GDD
## §7: una referencia que sube cuando el jugador tarda más haría que tardar
## más mejorase la puntuación de los encuentros siguientes, y el invariante
## se rompería. Se compara con un tiempo ESPERADO por tamaño de encuentro.
## La mediana observada se conserva, pero como diagnóstico
## (`observed_median_clear_time_s`). Ver el informe al arquitecto.

# TODO(arquitecto): estas cinco referencias son balanceo y deberían vivir en
# DirectorProfile (src/data/ no es ámbito del director).

## Daño por minuto que se considera "encajar lo normal". Recibir esto o más
## puntúa 0 en esa señal.
const REFERENCE_DAMAGE_PER_MINUTE: float = 60.0
## Tiempo esperado de limpieza: una parte fija más otra por enemigo.
const EXPECTED_CLEAR_TIME_BASE_S: float = 20.0
const EXPECTED_CLEAR_TIME_PER_ENEMY_S: float = 4.0
## Fracción de tiempo a cubierto que se considera uso pleno de la cobertura.
const REFERENCE_COVER_USAGE: float = 0.45
## Puntuación que corresponde a un jugador neutro; ahí el multiplicador vale
## exactamente 1.0 y la dificultad es la de la planta.
const NEUTRAL_SCORE: float = 0.5
## Efectivos de escuadra que se suponen si nadie los dice. El valor real lo
## pasa el director desde `GameState.squad`; esto solo evita dividir por cero.
const DEFAULT_SQUAD_SIZE: int = 3

## Una foto del rendimiento del jugador en un encuentro.
class EncounterSample:
	extends RefCounted

	## Aciertos / disparos, 0..1.
	var accuracy: float = 0.0
	## Daño recibido por minuto durante el encuentro.
	var damage_taken_per_minute: float = 0.0
	## Segundos que costó limpiar la zona.
	var clear_time_s: float = 0.0
	## Segundos que se esperaba que costase, por tamaño del encuentro.
	var expected_clear_time_s: float = 1.0
	## Compañeros caídos durante el encuentro.
	var squad_losses: int = 0
	## Efectivos de la escuadra al empezar. Nunca 0 al dividir.
	var squad_size: int = DEFAULT_SQUAD_SIZE
	## Fracción de tiempo a cubierto, 0..1.
	var cover_usage: float = 0.0

	func duplicate_sample() -> EncounterSample:
		var copy := EncounterSample.new()
		copy.accuracy = accuracy
		copy.damage_taken_per_minute = damage_taken_per_minute
		copy.clear_time_s = clear_time_s
		copy.expected_clear_time_s = expected_clear_time_s
		copy.squad_losses = squad_losses
		copy.squad_size = squad_size
		copy.cover_usage = cover_usage
		return copy


## Identificador del jugador. Lo fija `gameplay` al instanciar el personaje.
var player_id: int = 0
## Identificadores de los compañeros vivos al empezar el encuentro.
var squad_ids: Array[int] = []

var _profile: DirectorProfile = null
var _samples: Array[EncounterSample] = []
## Todos los tiempos de limpieza registrados. Solo diagnóstico.
var _clear_times: Array[float] = []

# Acumuladores del encuentro en curso.
var _shots_fired: int = 0
var _shots_hit: int = 0
var _damage_taken: float = 0.0
var _squad_losses: int = 0
var _squad_size: int = DEFAULT_SQUAD_SIZE
var _cover_time_s: float = 0.0
var _elapsed_s: float = 0.0
var _expected_clear_time_s: float = EXPECTED_CLEAR_TIME_BASE_S
var _connected: bool = false


func _init(profile: DirectorProfile = null) -> void:
	_profile = profile if profile != null else Balance.director_profile()
	if _profile == null:
		_profile = DirectorProfile.new()


# ---- Conexión al bus ----

## Se suscribe a las señales del juego. Lo llama el `EncounterDirector`; en
## los tests no se llama y el modelo se alimenta con `push_sample`, que es lo
## que lo hace probable sin escena.
func connect_event_bus() -> void:
	if _connected:
		return
	EventBus.shot_resolved.connect(_on_shot_resolved)
	EventBus.character_damaged.connect(_on_character_damaged)
	EventBus.character_died.connect(_on_character_died)
	EventBus.zone_cleared.connect(_on_zone_cleared)
	_connected = true


func disconnect_event_bus() -> void:
	if not _connected:
		return
	EventBus.shot_resolved.disconnect(_on_shot_resolved)
	EventBus.character_damaged.disconnect(_on_character_damaged)
	EventBus.character_died.disconnect(_on_character_died)
	EventBus.zone_cleared.disconnect(_on_zone_cleared)
	_connected = false


# ---- Ciclo del encuentro ----

## Empieza a observar un encuentro de `enemy_count` enemigos.
func begin_encounter(enemy_count: int, squad_size: int = DEFAULT_SQUAD_SIZE) -> void:
	_shots_fired = 0
	_shots_hit = 0
	_damage_taken = 0.0
	_squad_losses = 0
	_squad_size = maxi(squad_size, 1)
	_cover_time_s = 0.0
	_elapsed_s = 0.0
	_expected_clear_time_s = expected_clear_time_s(enemy_count)


## Avance de tiempo del encuentro. `in_cover` alimenta el uso de cobertura,
## que no es un evento sino un estado y por eso no puede venir del bus.
func tick(delta_s: float, in_cover: bool) -> void:
	_elapsed_s += maxf(delta_s, 0.0)
	if in_cover:
		_cover_time_s += maxf(delta_s, 0.0)


## Cierra el encuentro y lo incorpora a la ventana móvil.
func end_encounter(elapsed_s: float = -1.0) -> void:
	var duration := _elapsed_s if elapsed_s < 0.0 else elapsed_s
	var sample := EncounterSample.new()
	sample.accuracy = 0.0 if _shots_fired == 0 else float(_shots_hit) / float(_shots_fired)
	var minutes := maxf(duration, 1.0) / 60.0
	sample.damage_taken_per_minute = _damage_taken / minutes
	sample.clear_time_s = duration
	sample.expected_clear_time_s = _expected_clear_time_s
	sample.squad_losses = _squad_losses
	sample.squad_size = _squad_size
	sample.cover_usage = 0.0 if duration <= 0.0 else clampf(_cover_time_s / duration, 0.0, 1.0)
	push_sample(sample)
	begin_encounter(0, _squad_size)


## Añade una muestra a la ventana móvil. Puerta de entrada pura: los tests
## entran por aquí y no necesitan ni escena ni bus.
func push_sample(sample: EncounterSample) -> void:
	_samples.append(sample.duplicate_sample())
	_clear_times.append(sample.clear_time_s)
	var window := maxi(_profile.skill_window, 1)
	while _samples.size() > window:
		_samples.remove_at(0)


func reset() -> void:
	_samples.clear()
	_clear_times.clear()
	begin_encounter(0, _squad_size)


# ---- Salida ----

## Multiplicador de dificultad. 1.0 = jugador neutro. Acotado al rango del
## perfil. Es lo único que el director consume de esta clase.
func skill_multiplier() -> float:
	return multiplier_for_score(current_score(), _profile)


## Puntuación media de la ventana, 0..1. 0.5 si no hay muestras.
func current_score() -> float:
	if _samples.is_empty():
		return NEUTRAL_SCORE
	var total: float = 0.0
	for sample: EncounterSample in _samples:
		total += score_of(sample, _profile)
	return total / float(_samples.size())


func sample_count() -> int:
	return _samples.size()


## Mediana observada de los tiempos de limpieza. DIAGNÓSTICO: no entra en la
## puntuación, porque una referencia que depende del propio rendimiento
## rompería la monotonía del modelo.
func observed_median_clear_time_s() -> float:
	if _clear_times.is_empty():
		return 0.0
	var sorted := _clear_times.duplicate()
	sorted.sort()
	@warning_ignore("integer_division")
	var middle: int = sorted.size() / 2
	if sorted.size() % 2 == 1:
		return sorted[middle]
	return (sorted[middle - 1] + sorted[middle]) * 0.5


func profile() -> DirectorProfile:
	return _profile


# ---- Funciones puras ----

## Tiempo esperado de limpieza para un encuentro de `enemy_count` enemigos.
static func expected_clear_time_s(enemy_count: int) -> float:
	return EXPECTED_CLEAR_TIME_BASE_S + EXPECTED_CLEAR_TIME_PER_ENEMY_S * float(maxi(enemy_count, 0))


## Puntuación de una muestra, 0..1. Mayor = jugó mejor.
##
## Cada término está normalizado para que CRECER signifique JUGAR MEJOR, y
## los pesos del perfil son no negativos: de ahí sale la monotonía.
static func score_of(sample: EncounterSample, profile: DirectorProfile) -> float:
	var accuracy := clampf(sample.accuracy, 0.0, 1.0)
	var damage := 1.0 - clampf(
		sample.damage_taken_per_minute / REFERENCE_DAMAGE_PER_MINUTE, 0.0, 1.0)
	# El doble del tiempo esperado puntúa 0; la mitad, 0,75.
	var reference_time := maxf(sample.expected_clear_time_s, 0.0001)
	var time := 1.0 - clampf(sample.clear_time_s / (2.0 * reference_time), 0.0, 1.0)
	var squad := 1.0 - clampf(
		float(sample.squad_losses) / float(maxi(sample.squad_size, 1)), 0.0, 1.0)
	var cover := clampf(sample.cover_usage / REFERENCE_COVER_USAGE, 0.0, 1.0)

	var weights: Array[float] = [
		maxf(profile.weight_accuracy, 0.0),
		maxf(profile.weight_damage_taken, 0.0),
		maxf(profile.weight_clear_time, 0.0),
		maxf(profile.weight_squad_losses, 0.0),
		maxf(profile.weight_cover_usage, 0.0),
	]
	var values: Array[float] = [accuracy, damage, time, squad, cover]
	var total: float = 0.0
	var weight_sum: float = 0.0
	for index: int in weights.size():
		total += weights[index] * values[index]
		weight_sum += weights[index]
	if weight_sum <= 0.0:
		return NEUTRAL_SCORE
	return clampf(total / weight_sum, 0.0, 1.0)


## Traduce puntuación a multiplicador. Tramo doble para que la puntuación
## neutra caiga EXACTAMENTE en 1.0: con un `lerp` simple, un jugador
## mediocre ya jugaría por encima de la dificultad nominal de la planta.
static func multiplier_for_score(score: float, profile: DirectorProfile) -> float:
	var low := profile.skill_multiplier_min
	var high := profile.skill_multiplier_max
	var clamped := clampf(score, 0.0, 1.0)
	if clamped <= NEUTRAL_SCORE:
		return clampf(lerpf(low, 1.0, clamped / NEUTRAL_SCORE), low, high)
	var upper := (clamped - NEUTRAL_SCORE) / (1.0 - NEUTRAL_SCORE)
	return clampf(lerpf(1.0, high, upper), low, high)


# ---- Señales del juego ----

func _on_shot_resolved(shooter_id: int, hit: bool, _is_headshot: bool) -> void:
	if shooter_id != player_id:
		return
	_shots_fired += 1
	if hit:
		_shots_hit += 1


func _on_character_damaged(character_id: int, amount: float, _from_position: Vector3) -> void:
	if character_id != player_id:
		return
	_damage_taken += maxf(amount, 0.0)


func _on_character_died(character_id: int, _team: int, _killer_id: int, _xp: int) -> void:
	if squad_ids.has(character_id):
		_squad_losses += 1


func _on_zone_cleared(_floor_number: int, _zone: int, elapsed_s: float) -> void:
	end_encounter(elapsed_s)
