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
	## Contador interno de degradación.
	var _skip_counter: int = 0

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
var _perception_accum: float = 0.0
var _decision_accum: float = 0.0
var _behavior_accum: float = 0.0
var _decision_cursor: int = 0
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

	_perception_accum += delta
	_decision_accum += delta
	_behavior_accum += delta

	var perception_period := 1.0 / PERCEPTION_HZ
	if _perception_accum >= perception_period:
		_perception_accum = fmod(_perception_accum, perception_period)
		_run_perception(perception_period)

	var decision_period := 1.0 / DECISION_HZ
	if _decision_accum >= decision_period:
		_decision_accum = fmod(_decision_accum, decision_period)
		_run_decision(decision_period)

	var behavior_period := 1.0 / BEHAVIOR_HZ
	if _behavior_accum >= behavior_period:
		_behavior_accum = fmod(_behavior_accum, behavior_period)
		_run_behavior(behavior_period)


func _run_perception(period: float) -> void:
	_refresh_priorities()
	# Mayor prioridad primero: si el presupuesto de raycasts se agota, se
	# sacrifica a los bots irrelevantes, nunca al que tienes delante.
	_clients.sort_custom(func(a: Client, b: Client) -> bool: return a.priority > b.priority)
	for client: Client in _clients:
		if _raycasts_this_frame >= MAX_RAYCASTS_PER_FRAME:
			break
		if _should_skip(client):
			continue
		_raycasts_this_frame += client.tick_perception(period)


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
		if _should_skip(client):
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


## Degradación de frecuencia para clientes lejanos y fuera de cámara.
func _should_skip(client: Client) -> bool:
	var far := client.world_position.distance_to(_focus_position) > FAR_DISTANCE_M
	if not far or client.on_screen:
		client._skip_counter = 0
		return false
	client._skip_counter += 1
	if client._skip_counter >= FAR_FREQUENCY_DIVISOR:
		client._skip_counter = 0
		return false
	return true
