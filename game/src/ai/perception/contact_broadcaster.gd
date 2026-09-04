class_name ContactBroadcaster
extends RefCounted
## Difusión de contactos a la escuadra con RETARDO DE REACCIÓN (GDD §8.1).
##
## Al detectar, el bot publica el contacto en `Blackboard.report_contact`, pero
## NUNCA en el mismo instante: pasa antes por `CharacterStats.reaction_delay_s`
## (0,3-0,8 s según arquetipo). Sin ese retardo la escuadra entera reacciona en
## el frame en que uno solo te ve, y eso no se lee como "son buenos": se lee
## como "hacen trampas". Es exactamente la diferencia entre un bot difícil y
## uno tramposo.
##
## La pizarra se inyecta como `Callable` (`report_sink`) en lugar de llamar al
## autoload: así esto se prueba en `--headless` sin `Blackboard` y se puede
## espiar lo que se publica y cuándo.

# TODO(arquitecto): mover a datos (CharacterStats o un PerceptionProfile).

## Mientras un objetivo siga difundido y visto hace menos de esto, las
## actualizaciones no vuelven a pagar el retardo: ya estás reaccionando a él.
const TRACKING_GRACE_S: float = 2.0
## Retardo mínimo. Ni el arquetipo más rápido reacciona en 0 s.
const MIN_REACTION_DELAY_S: float = 0.05


## Un contacto esperando a que venza el retardo de reacción.
class Pending:
	extends RefCounted

	var squad_id: int = 0
	var target_id: int = 0
	var contact: Blackboard.Contact = null
	var remaining_s: float = 0.0


## Retardo de reacción del arquetipo, en segundos. Lo fija el `PerceptionSystem`
## desde `CharacterStats.reaction_delay_s`.
var reaction_delay_s: float = MIN_REACTION_DELAY_S
## Quién publica: `func(squad_id: int, contact: Blackboard.Contact) -> void`.
## Por defecto, la pizarra global.
var report_sink: Callable = Callable()
## Reloj inyectable en milisegundos, para que los tests no dependan del tiempo
## real. Debe devolver `int`.
var clock_msec: Callable = Callable()
## Quién reporta, para depuración y para atribuir el contacto.
var reporter_id: int = 0

var _pending: Dictionary[int, Pending] = {}
## target_id -> segundos desde la última publicación.
var _since_published: Dictionary[int, float] = {}
## Telemetría para tests y consola.
var published_count: int = 0


## Encola un contacto. Si el objetivo ya se está siguiendo, se refresca sin
## retardo; si es nuevo (o se había perdido), paga el retardo de reacción.
func submit(
	squad_id: int,
	target_id: int,
	team: int,
	position: Vector3,
	confidence: float
) -> void:
	var contact := Blackboard.Contact.new()
	contact.target_id = target_id
	contact.team = team
	contact.last_known_position = position
	contact.confidence = clampf(confidence, 0.0, 1.0)
	contact.reporter_id = reporter_id
	contact.last_seen_msec = _now_msec()

	var tracked := _since_published.has(target_id)
	var existing: Pending = _pending.get(target_id, null)
	if existing != null:
		# Ya estaba esperando: se refresca la carga útil pero NO se reinicia el
		# reloj. Si no, un objetivo visto de forma continua nunca se publicaría.
		existing.contact = contact
		existing.squad_id = squad_id
		return

	var pending := Pending.new()
	pending.squad_id = squad_id
	pending.target_id = target_id
	pending.contact = contact
	pending.remaining_s = 0.0 if tracked else maxf(reaction_delay_s, MIN_REACTION_DELAY_S)
	_pending[target_id] = pending


## Avanza los retardos y publica lo que ya ha vencido. Devuelve cuántos
## contactos se publicaron en este tick.
func update(dt: float) -> int:
	for target_id: int in _since_published.keys():
		var elapsed: float = _since_published[target_id] + dt
		if elapsed > TRACKING_GRACE_S:
			# Se ha perdido el hilo: el siguiente avistamiento vuelve a pagar
			# el retardo de reacción completo.
			_since_published.erase(target_id)
		else:
			_since_published[target_id] = elapsed

	var published := 0
	for target_id: int in _pending.keys():
		var pending: Pending = _pending[target_id]
		pending.remaining_s -= dt
		if pending.remaining_s > 0.0:
			continue
		_publish(pending)
		_pending.erase(target_id)
		_since_published[target_id] = 0.0
		published += 1
	published_count += published
	return published


## Contactos aún esperando el retardo.
func pending_count() -> int:
	return _pending.size()


## Segundos que le quedan a un contacto para llegar a la pizarra. INF si no hay
## nada pendiente para ese objetivo.
func remaining_for(target_id: int) -> float:
	var pending: Pending = _pending.get(target_id, null)
	return pending.remaining_s if pending != null else INF


func clear() -> void:
	_pending.clear()
	_since_published.clear()


func _publish(pending: Pending) -> void:
	pending.contact.last_seen_msec = _now_msec()
	if report_sink.is_valid():
		report_sink.call(pending.squad_id, pending.contact)
	else:
		Blackboard.report_contact(pending.squad_id, pending.contact)


func _now_msec() -> int:
	if clock_msec.is_valid():
		var value: Variant = clock_msec.call()
		return int(value)
	return Time.get_ticks_msec()
