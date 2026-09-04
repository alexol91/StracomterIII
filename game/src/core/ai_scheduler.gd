extends Node
## Reparto temporal del trabajo de IA (ADR-002).
##
## Ningún bot procesa nada en su propio `_process`. Se registran aquí y este
## nodo decide quién piensa en cada frame, con techos duros de coste.
##
## El objetivo es degradación ELEGANTE: nunca se baja la calidad de una
## decisión, solo su frecuencia. Un bot lejano y oculto decide a 2 Hz; el que
## te está disparando, a tasa completa.

## Sistemas que un agente puede registrar, con su frecuencia objetivo.
enum Channel {
	PERCEPTION,  ## 10 Hz
	DECISION,    ## 5 Hz
	BEHAVIOR,    ## 20 Hz
}

const PERCEPTION_HZ: float = 10.0
const DECISION_HZ: float = 5.0
const BEHAVIOR_HZ: float = 20.0

## Techo global de raycasts de percepción por frame en TODA la escena.
const MAX_RAYCASTS_PER_FRAME: int = 48
## Máximo de bots que toman una decisión de utilidad en un mismo tick.
const MAX_DECISIONS_PER_TICK: int = 8
## Máximo de peticiones de camino despachadas por frame.
const MAX_PATH_REQUESTS_PER_FRAME: int = 4

## Distancia (m) a partir de la cual un bot oculto se degrada a baja frecuencia.
const FAR_DISTANCE_M: float = 45.0
## Divisor de frecuencia aplicado a los bots lejanos y sin visibilidad.
const FAR_FREQUENCY_DIVISOR: int = 5
## Tope del delta de percepción, en segundos. Protege del primer tick de un
## cliente recién registrado y de un parón de la aplicación.
const MAX_PERCEPTION_DELTA_S: float = 1.0


## Contrato que debe cumplir cualquier agente registrado.
## Las implementaciones viven en src/ai/**; aquí solo se define la forma.
class Client:
	extends RefCounted

	## Prioridad calculada por el scheduler. Mayor = se atiende antes.
	var priority: float = 0.0
	## Posición en el mundo, para calcular prioridad.
	var world_position: Vector3 = Vector3.ZERO
	## Si el cliente está visible en cámara (se atiende a tasa completa).
	var on_screen: bool = false
	## Momento (ms) del último tick de percepción de ESTE cliente. El reparto
	## es por cliente, no global: es lo que impide que unos pocos bots
	## acaparen el presupuesto y el resto no perciba nunca.
	var _last_perception_msec: int = -100000

	## Percepción. Debe devolver cuántos raycasts consumió.
	func tick_perception(_delta: float) -> int:
		return 0

	## Decisión de utilidad. Sin valor de retorno: el coste es acotado por
	## MAX_DECISIONS_PER_TICK.
	func tick_decision(_delta: float) -> void:
		pass

	## Ejecución del árbol de comportamiento activo.
	func tick_behavior(_delta: float) -> void:
		pass


var _clients: Array[Client] = []
var _decision_accum: float = 0.0
var _behavior_accum: float = 0.0
var _decision_cursor: int = 0
var _perception_cursor: int = 0
var _raycasts_this_frame: int = 0
var _path_requests_this_frame: int = 0
## Referencia opcional al jugador, para calcular prioridades.
var _focus_position: Vector3 = Vector3.ZERO
var _enabled: bool = true

## Telemetría, consultable desde la consola (`ai.debug`).
var stat_clients: int = 0
var stat_raycasts_last_frame: int = 0
var stat_decisions_last_tick: int = 0


func register(client: Client) -> void:
	if not _clients.has(client):
		_clients.append(client)


func unregister(client: Client) -> void:
	_clients.erase(client)


func clear() -> void:
	_clients.clear()
	_decision_cursor = 0
	_perception_cursor = 0


## Punto de referencia para la prioridad (normalmente el jugador).
func set_focus(position: Vector3) -> void:
	_focus_position = position


func set_enabled(value: bool) -> void:
	_enabled = value


## Presupuesto de peticiones de camino restante en este frame. Quien navega
## debe consultarlo antes de pedir una ruta y encolar si es 0.
func try_consume_path_request() -> bool:
	if _path_requests_this_frame >= MAX_PATH_REQUESTS_PER_FRAME:
		return false
	_path_requests_this_frame += 1
	return true


func _process(delta: float) -> void:
	stat_raycasts_last_frame = _raycasts_this_frame
	_raycasts_this_frame = 0
	_path_requests_this_frame = 0
	stat_clients = _clients.size()
	if not _enabled or _clients.is_empty():
		return

	# La percepción se reparte ENTRE FRAMES, no se ejecuta de golpe cada 100 ms.
	# Hacerlo de golpe con un techo de rayos significaba que los mismos bots de
	# mayor prioridad se llevaban todo el presupuesto y el resto no percibía
	# nunca: eso es inanición, no la degradación por frecuencia que exige
	# ADR-002. Repartiendo, cada cliente cumple su periodo por su cuenta y el
	# techo por frame solo introduce retraso, nunca hambre.
	_run_perception_slice()

	_decision_accum += delta
	var decision_period := 1.0 / DECISION_HZ
	if _decision_accum >= decision_period:
		_decision_accum = fmod(_decision_accum, decision_period)
		_run_decision(decision_period)

	_behavior_accum += delta
	var behavior_period := 1.0 / BEHAVIOR_HZ
	if _behavior_accum >= behavior_period:
		_behavior_accum = fmod(_behavior_accum, behavior_period)
		_run_behavior(behavior_period)


## Atiende, dentro del presupuesto de rayos de este frame, a los clientes cuyo
## periodo de percepción ya ha vencido. El cursor rota, así que ante empate de
## vencimiento el turno va cambiando y nadie se queda atrás indefinidamente.
func _run_perception_slice() -> void:
	_refresh_priorities()
	var count := _clients.size()
	var now := Time.get_ticks_msec()
	var base_period_ms := int(1000.0 / PERCEPTION_HZ)

	# Se recorre como mucho una vuelta completa por frame.
	var visited := 0
	while visited < count and _raycasts_this_frame < MAX_RAYCASTS_PER_FRAME:
		var client := _clients[_perception_cursor % count]
		_perception_cursor += 1
		visited += 1

		var period_ms := base_period_ms
		if _is_degraded(client):
			period_ms *= FAR_FREQUENCY_DIVISOR
		var since_ms := now - client._last_perception_msec
		if since_ms < period_ms:
			continue

		# Se pasa el tiempo REAL transcurrido, no el periodo nominal: si el
		# techo de rayos retrasó a este cliente, su memoria debe decaer por lo
		# que de verdad ha pasado. Acotado para que el primer tick de un
		# cliente recién registrado no llegue con un delta enorme.
		var elapsed_s := clampf(float(since_ms) / 1000.0, 0.0, MAX_PERCEPTION_DELTA_S)
		client._last_perception_msec = now
		_raycasts_this_frame += client.tick_perception(elapsed_s)


func _run_decision(period: float) -> void:
	var count := _clients.size()
	if count == 0:
		return
	var processed := 0
	# Round-robin: todos deciden, pero no todos en el mismo tick.
	while processed < MAX_DECISIONS_PER_TICK and processed < count:
		var client := _clients[_decision_cursor % count]
		_decision_cursor += 1
		processed += 1
		if _is_degraded(client) and (_decision_cursor % FAR_FREQUENCY_DIVISOR) != 0:
			continue
		client.tick_decision(period)
	stat_decisions_last_tick = processed


func _run_behavior(period: float) -> void:
	for client: Client in _clients:
		client.tick_behavior(period)


func _refresh_priorities() -> void:
	for client: Client in _clients:
		var d := client.world_position.distance_to(_focus_position)
		# Cerca y en pantalla = máxima prioridad.
		var score := 1000.0 - d
		if client.on_screen:
			score += 500.0
		client.priority = score


## ¿Debe este cliente correr a frecuencia reducida? Un bot a 60 m detrás de una
## pared no necesita percibir 10 veces por segundo; el que te está disparando sí.
## Nunca se le baja la CALIDAD de la percepción, solo su frecuencia.
func _is_degraded(client: Client) -> bool:
	if client.on_screen:
		return false
	return client.world_position.distance_to(_focus_position) > FAR_DISTANCE_M
