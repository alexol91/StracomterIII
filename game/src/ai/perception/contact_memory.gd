class_name ContactMemory
extends RefCounted
## Memoria de contactos de un bot: posición, antigüedad y CONFIANZA QUE DECAE
## (GDD §8.1).
##
## El legacy no tenía memoria: `selectObjetive` borraba de `memory` todo lo que
## dejaba de estar visible ese mismo frame (análisis §3.3), y la única
## persistencia real era `currentObj`, un punto suelto. El resultado era el
## bot que te pierde de vista y se queda tonto, o el que va exactamente a donde
## estás porque nunca dudó.
##
## Aquí un bot no olvida de golpe: la confianza decae con el tiempo y con el
## movimiento estimado del objetivo, la posición creída se extrapola un rato y
## luego se congela. Va a buscarte donde CREE que estás y se equivoca de forma
## creíble. Eso es exactamente lo que hace que parezca vivo.
##
## PUREZA: `decay()` y `extrapolate()` son `static` y deterministas, y reciben
## el `PerceptionProfile` por parámetro; se prueban en aislamiento sin
## instanciar nada. Ningún número de balanceo vive aquí dentro (ADR-005).

## De dónde vino la última actualización de un contacto.
enum Source {
	NONE,
	SIGHT,   ## Visto con línea de visión confirmada.
	SOUND,   ## Oído.
	DAMAGE,  ## Me han disparado desde ahí.
	SQUAD,   ## Me lo ha contado un compañero por la pizarra.
}

## Lo que el bot cree saber de un objetivo.
class Entry:
	extends RefCounted

	var target_id: int = 0
	var team: int = 0
	## Dónde cree el bot que está AHORA (última posición conocida + extrapolación).
	var believed_position: Vector3 = Vector3.ZERO
	## Última posición realmente observada.
	var last_known_position: Vector3 = Vector3.ZERO
	## Velocidad estimada en el momento del último refuerzo.
	var estimated_velocity: Vector3 = Vector3.ZERO
	## 0..1.
	var confidence: float = 0.0
	## Segundos desde el último refuerzo de cualquier tipo.
	var age_s: float = 0.0
	## Segundos desde el último contacto VISUAL. INF si nunca se ha visto.
	var time_since_seen_s: float = INF
	## ¿Se refuerza en este mismo tick?
	var seen_now: bool = false
	var source: Source = Source.NONE

	func duplicate_entry() -> Entry:
		var copy := Entry.new()
		copy.target_id = target_id
		copy.team = team
		copy.believed_position = believed_position
		copy.last_known_position = last_known_position
		copy.estimated_velocity = estimated_velocity
		copy.confidence = confidence
		copy.age_s = age_s
		copy.time_since_seen_s = time_since_seen_s
		copy.seen_now = seen_now
		copy.source = source
		return copy


## Parámetros del arquetipo. Lo inyecta el `PerceptionSystem`.
var profile: PerceptionProfile = null

var _entries: Dictionary[int, Entry] = {}


## Perfil en uso, con los valores por defecto del recurso si nadie inyectó uno.
func effective_profile() -> PerceptionProfile:
	if profile == null:
		profile = PerceptionProfile.new()
	return profile


# ---- Modelo puro ----

## Un paso de decaimiento de la confianza.
##
## Es estrictamente decreciente para `confidence > 0` y `dt > 0`: esa es la
## propiedad que garantiza que un bot sin contactos nuevos acabe dudando, y la
## que comprueba el test de monotonía.
static func decay(
	confidence: float, dt: float, profile: PerceptionProfile, estimated_speed_mps: float = 0.0
) -> float:
	if dt <= 0.0:
		return clampf(confidence, 0.0, 1.0)
	var rate := (
		profile.time_decay_rate
		+ profile.motion_decay_per_mps * maxf(estimated_speed_mps, 0.0)
	)
	return clampf(confidence * exp(-rate * dt), 0.0, 1.0)


## Dónde estaría el objetivo si hubiera seguido su rumbo, con amortiguación y
## con un tope de tiempo. Determinista.
static func extrapolate(
	last_known_position: Vector3,
	velocity: Vector3,
	elapsed_s: float,
	profile: PerceptionProfile
) -> Vector3:
	var t := clampf(elapsed_s, 0.0, profile.max_extrapolation_s)
	if t <= 0.0 or velocity.length_squared() < 0.000001:
		return last_known_position
	return last_known_position + velocity * t * profile.extrapolation_damping


# ---- Estado ----

## Envejece y decae TODOS los contactos. Debe llamarse una vez por tick, ANTES
## de los refuerzos de este tick.
func update(dt: float) -> void:
	var tuning := effective_profile()
	for entry: Entry in _entries.values():
		entry.seen_now = false
		entry.age_s += dt
		if not is_inf(entry.time_since_seen_s):
			entry.time_since_seen_s += dt
		entry.confidence = decay(
			entry.confidence, dt, tuning, entry.estimated_velocity.length()
		)
		entry.believed_position = extrapolate(
			entry.last_known_position, entry.estimated_velocity, entry.age_s, tuning
		)


## Refuerzo por contacto VISUAL confirmado. La confianza vuelve a tope: al
## volver a verte, el bot deja de dudar.
func reinforce_sight(
	target_id: int, team: int, position: Vector3, velocity: Vector3, confidence: float = 1.0
) -> Entry:
	var entry := _get_or_create(target_id, team)
	entry.last_known_position = position
	entry.believed_position = position
	entry.estimated_velocity = velocity
	entry.confidence = maxf(entry.confidence, clampf(confidence, 0.0, 1.0))
	entry.age_s = 0.0
	entry.time_since_seen_s = 0.0
	entry.seen_now = true
	entry.source = Source.SIGHT
	return entry


## Refuerzo por oído. Nunca sube la confianza tanto como ver, y la posición es
## la que el bot CREE, ya dispersada por `HearingSensor`.
func reinforce_sound(
	target_id: int, team: int, estimated_position: Vector3, confidence: float
) -> Entry:
	var entry := _get_or_create(target_id, team)
	var new_confidence := clampf(confidence, 0.0, 1.0)
	if new_confidence <= entry.confidence:
		# Un ruido flojo no degrada un contacto visual fresco, pero tampoco lo
		# refresca: la posición sigue envejeciendo.
		return entry
	entry.last_known_position = estimated_position
	entry.believed_position = estimated_position
	entry.estimated_velocity = Vector3.ZERO
	entry.confidence = new_confidence
	entry.age_s = 0.0
	entry.source = Source.SOUND
	return entry


## Refuerzo por daño recibido: sé de dónde me disparan aunque no lo vea.
func reinforce_damage(target_id: int, team: int, from_position: Vector3, confidence: float) -> Entry:
	var entry := reinforce_sound(target_id, team, from_position, confidence)
	if entry.source == Source.SOUND:
		entry.source = Source.DAMAGE
	return entry


## Contacto recibido de un compañero por la pizarra. Vale menos que el propio.
func reinforce_from_squad(
	target_id: int, team: int, position: Vector3, confidence: float
) -> Entry:
	var entry := reinforce_sound(
		target_id, team, position, confidence * effective_profile().squad_confidence_factor
	)
	if entry.source == Source.SOUND:
		entry.source = Source.SQUAD
	return entry


## Elimina los contactos por debajo del umbral. Devuelve cuántos se olvidaron.
## Umbral negativo = el que diga el perfil.
func prune(min_confidence: float = -1.0) -> int:
	var threshold := min_confidence if min_confidence >= 0.0 else effective_profile().prune_confidence
	var removed := 0
	for key: int in _entries.keys():
		var entry: Entry = _entries[key]
		if entry.confidence < threshold:
			_entries.erase(key)
			removed += 1
	return removed


## Contacto de mayor confianza, o null si el bot está a ciegas.
## Desempate por `target_id` para que el resultado sea determinista.
func best() -> Entry:
	var winner: Entry = null
	for entry: Entry in _entries.values():
		if winner == null:
			winner = entry
			continue
		if entry.confidence > winner.confidence:
			winner = entry
		elif is_equal_approx(entry.confidence, winner.confidence) and entry.target_id < winner.target_id:
			winner = entry
	return winner


func get_entry(target_id: int) -> Entry:
	return _entries.get(target_id, null)


func has(target_id: int) -> bool:
	return _entries.has(target_id)


## Contactos ordenados por confianza descendente. Copia defensiva: nadie
## modifica la memoria de un bot desde fuera.
func entries() -> Array[Entry]:
	var out: Array[Entry] = []
	for entry: Entry in _entries.values():
		out.append(entry)
	out.sort_custom(
		func(a: Entry, b: Entry) -> bool:
			if is_equal_approx(a.confidence, b.confidence):
				return a.target_id < b.target_id
			return a.confidence > b.confidence
	)
	return out


func count() -> int:
	return _entries.size()


## Contactos que cuentan como amenaza conocida (alimenta `BotState`).
## Umbral negativo = el que diga el perfil.
func threat_count(min_confidence: float = -1.0) -> int:
	var threshold := (
		min_confidence if min_confidence >= 0.0 else effective_profile().threat_confidence
	)
	var n := 0
	for entry: Entry in _entries.values():
		if entry.confidence >= threshold:
			n += 1
	return n


func forget(target_id: int) -> void:
	_entries.erase(target_id)


func clear() -> void:
	_entries.clear()


func _get_or_create(target_id: int, team: int) -> Entry:
	var entry: Entry = _entries.get(target_id, null)
	if entry == null:
		entry = Entry.new()
		entry.target_id = target_id
		_entries[target_id] = entry
	entry.team = team
	return entry
