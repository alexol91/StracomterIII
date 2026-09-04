class_name PerceptionSystem
extends AIScheduler.Client
## Percepción completa de UN bot: vista, oído, memoria y difusión (GDD §8.1).
##
## Orquesta `VisionSensor`, `HearingSensor`, `ContactMemory` y
## `ContactBroadcaster`, y rellena los campos de percepción de `BotState`.
##
## NADA EN `_process` (ADR-002). Esto es un `AIScheduler.Client`: el scheduler
## decide cuándo piensa este bot, en qué orden y con cuánto presupuesto de
## raycasts. `tick_perception()` devuelve los rayos consumidos para que el
## techo global de 48/frame sea real y no una intención. Un bot lejano y fuera
## de cámara se degrada en FRECUENCIA, nunca en calidad: cuando le toca, piensa
## igual de bien que el que tienes delante.
##
## PUREZA: todo lo que decide sale de `(BotState, pizarra, WorldQuery)`. El
## mundo entra por `WorldQuery` y los candidatos por `target_provider`, ambos
## inyectables, y por eso esto corre en `--headless` sin escena.
##
## Todo el afinado vive en `CharacterStats.perception` (un `PerceptionProfile`)
## y se reparte a los cuatro subsistemas: ningún número de balanceo vive en
## este fichero (ADR-005). Cambiar de perfil convierte a un sicario en un
## veterano sin tocar una línea de código.


## Identidad del bot. Debe ser el MISMO id con el que `gameplay/` emite
## `character_damaged` (allí es `get_instance_id()`); si no coinciden, un bot
## herido nunca sabrá quién le disparó.
var bot_id: int = 0
var squad_id: int = 0
var team: int = 0
## Estadísticas del arquetipo: alcance, conos y retardo de reacción.
var stats: CharacterStats = null
## Afinado del sensor. Sale de `stats.perception`; si el arquetipo no trae
## perfil, se usan los valores por defecto del recurso.
var profile: PerceptionProfile = null
## Consulta al mundo. Inyectable: física real en juego, sintética en pruebas.
var world: WorldQuery = null
## Instantánea del bot. La percepción RELLENA sus campos de percepción; el
## resto (vida, munición, rol) lo rellena el cerebro.
var state: BotState = null
## `func() -> Array[VisionSensor.Target]`. Devuelve los candidatos vivos que
## el bot podría ver. Responsabilidad de quien conoce la escena; aquí solo se
## descartan los del propio bando.
var target_provider: Callable = Callable()

var vision: VisionSensor = VisionSensor.new()
var hearing: HearingSensor = HearingSensor.new()
var memory: ContactMemory = ContactMemory.new()
var broadcaster: ContactBroadcaster = ContactBroadcaster.new()

## Último punto de ruido relevante sin explicación visual. Lo consume el
## comportamiento INVESTIGATE. `Vector3.INF` = nada que investigar.
var last_noise_position: Vector3 = Vector3.INF
var last_noise_age_s: float = INF
var last_noise_loudness: float = 0.0

## Telemetría (consola `ai.debug`).
var stat_raycasts_last_tick: int = 0
var stat_visible_targets: int = 0

var _targets: Array[VisionSensor.Target] = []
var _registered: bool = false
var _events_connected: bool = false


func _init(
	p_bot_id: int = 0,
	p_squad_id: int = 0,
	p_team: int = 0,
	p_stats: CharacterStats = null,
	p_world: WorldQuery = null
) -> void:
	bot_id = p_bot_id
	squad_id = p_squad_id
	team = p_team
	stats = p_stats
	world = p_world
	hearing.listener_id = p_bot_id
	broadcaster.reporter_id = p_bot_id
	_apply_stats()


## Vuelve a leer los datos del arquetipo. Llamable tras `Balance.reload()`.
func configure(p_stats: CharacterStats) -> void:
	stats = p_stats
	_apply_stats()


## Perfil de percepción de unas estadísticas, con reserva a los valores por
## defecto del recurso si el arquetipo no trae uno.
static func resolve_profile(p_stats: CharacterStats) -> PerceptionProfile:
	if p_stats != null and p_stats.perception != null:
		return p_stats.perception
	return PerceptionProfile.new()


# ---- Registro en el scheduler (ADR-002) ----

## Se registra en el `AIScheduler`. NINGÚN bot debe llamar a
## `tick_perception()` por su cuenta desde `_process`.
func register() -> void:
	if _registered:
		return
	AIScheduler.register(self)
	_registered = true


func unregister() -> void:
	if not _registered:
		return
	AIScheduler.unregister(self)
	_registered = false


## Se suscribe a las señales del mundo que alimentan la percepción: el ruido
## (oído) y el daño recibido (cola de atacantes). Separado del constructor a
## propósito: sin llamar a esto, la clase no toca autoloads y se puede
## instanciar en una prueba.
func connect_events() -> void:
	if _events_connected:
		return
	EventBus.noise_emitted.connect(_on_noise_emitted)
	EventBus.character_damaged.connect(_on_character_damaged)
	_events_connected = true


func disconnect_events() -> void:
	if not _events_connected:
		return
	EventBus.noise_emitted.disconnect(_on_noise_emitted)
	EventBus.character_damaged.disconnect(_on_character_damaged)
	_events_connected = false


## Entrada del oído. Pública para poder inyectar ruidos en pruebas sin bus.
func hear_noise(position: Vector3, intensity: float, radius_m: float, source_id: int) -> void:
	if source_id == bot_id:
		# Un bot no se asusta de sus propios pasos.
		return
	hearing.push_noise(HearingSensor.NoiseEvent.make(position, intensity, radius_m, source_id))


## Entrada del dolor: me han disparado desde ahí. No es percepción sensorial
## pero es información posicional, y el legacy ya la tenía (`Bot::atackers`).
func report_damage_from(attacker_id: int, attacker_team: int, from_position: Vector3) -> void:
	if attacker_id == bot_id or attacker_team == team:
		return
	memory.reinforce_damage(
		attacker_id, attacker_team, from_position, effective_profile().damage_confidence
	)


## Incorpora a la memoria los contactos que han reportado los COMPAÑEROS.
##
## No se llama sola desde el tick a propósito: leer de la pizarra lo que uno
## mismo acaba de escribir crearía un lazo de realimentación y el bot no
## olvidaría jamás. Por eso se descartan los contactos propios, y por eso es el
## director de escuadra quien decide cuándo compartir. La lista entra por
## parámetro para que esto siga siendo puro y probable sin autoload.
func absorb_squad_contacts(contacts: Array[Blackboard.Contact]) -> int:
	var absorbed := 0
	for contact: Blackboard.Contact in contacts:
		if contact == null or contact.reporter_id == bot_id:
			continue
		if contact.team == team or contact.target_id == bot_id:
			continue
		memory.reinforce_from_squad(
			contact.target_id, contact.team, contact.last_known_position, contact.confidence
		)
		absorbed += 1
	return absorbed


## Mantiene al día lo que el `AIScheduler` usa para priorizar. El cerebro del
## bot debe llamarlo cada frame: la prioridad se calcula ANTES del tick, así
## que dejarlo solo dentro de `tick_perception` haría que el primer reparto
## usara una posición obsoleta.
func sync_scheduler_hints(position: Vector3, visible_on_screen: bool) -> void:
	world_position = position
	on_screen = visible_on_screen


# ---- Tick de percepción ----

## Un tick a 10 Hz. Devuelve los raycasts consumidos: el scheduler los resta
## del techo global de 48/frame.
func tick_perception(delta: float) -> int:
	stat_raycasts_last_tick = 0
	stat_visible_targets = 0
	if state == null or world == null or stats == null:
		return 0

	world_position = state.position

	# 1. Envejecer lo que ya se sabía. Siempre antes de los refuerzos: si no,
	#    un contacto refrescado este tick nacería ya viejo.
	memory.update(delta)
	var tuning := effective_profile()
	if not is_inf(last_noise_age_s):
		last_noise_age_s += delta
		if last_noise_age_s > tuning.noise_interest_s:
			last_noise_position = Vector3.INF
			last_noise_age_s = INF
			last_noise_loudness = 0.0

	# 2. Vista, con raycast de oclusión obligatorio.
	_refresh_targets()
	var vision_result := vision.evaluate(
		state.position,
		state.forward,
		stats,
		_targets,
		world,
		delta,
		tuning.max_raycasts_per_tick
	)
	for sighting: VisionSensor.Sighting in vision_result.sightings:
		if not sighting.detected:
			continue
		stat_visible_targets += 1
		memory.reinforce_sight(
			sighting.target_id, sighting.team, sighting.position, sighting.velocity, 1.0
		)

	# 3. Oído, atenuado por coste de camino.
	var heard_list := hearing.process(state.position, world, tuning.max_noise_events_per_tick)
	for heard: HearingSensor.Heard in heard_list:
		_absorb_noise(heard)

	# 4. Olvido.
	memory.prune()

	# 5. Difusión con retardo de reacción. `update` ANTES de `submit`: lo que
	#    se detecta en este tick no puede llegar a la pizarra en este tick.
	broadcaster.update(delta)
	for entry: ContactMemory.Entry in memory.entries():
		if entry.confidence >= tuning.min_broadcast_confidence:
			broadcaster.submit(
				squad_id, entry.target_id, entry.team, entry.believed_position, entry.confidence
			)

	# 6. Rellenar la instantánea que consumirán la utilidad y el árbol.
	_fill_state(vision_result)

	stat_raycasts_last_tick = vision_result.raycasts_used
	return vision_result.raycasts_used


# ---- Interno ----

## Perfil en uso, resuelto una sola vez y repartido a los cuatro subsistemas.
func effective_profile() -> PerceptionProfile:
	if profile == null:
		_apply_stats()
	return profile


func _apply_stats() -> void:
	profile = resolve_profile(stats)
	vision.profile = profile
	hearing.profile = profile
	memory.profile = profile
	broadcaster.profile = profile
	if stats != null:
		broadcaster.reaction_delay_s = stats.reaction_delay_s


func _refresh_targets() -> void:
	_targets.clear()
	if not target_provider.is_valid():
		return
	var provided: Variant = target_provider.call()
	if not (provided is Array):
		return
	var raw: Array = provided
	for item: Variant in raw:
		var target: VisionSensor.Target = item
		if target == null or not target.is_alive:
			continue
		if target.target_id == bot_id or target.team == team:
			continue
		_targets.append(target)


func _absorb_noise(heard: HearingSensor.Heard) -> void:
	var confidence := HearingSensor.confidence_from(heard.loudness, effective_profile())
	var known := _known_target(heard.source_id)
	if known != null and known.team != team:
		memory.reinforce_sound(known.target_id, known.team, heard.estimated_position, confidence)
		return
	# Ruido de origen no identificado: no es un contacto, es una pista. El
	# comportamiento INVESTIGATE decide qué hacer con ella.
	if heard.loudness >= last_noise_loudness or is_inf(last_noise_age_s):
		last_noise_position = heard.estimated_position
		last_noise_age_s = 0.0
		last_noise_loudness = heard.loudness


func _known_target(target_id: int) -> VisionSensor.Target:
	for target: VisionSensor.Target in _targets:
		if target.target_id == target_id:
			return target
	return null


func _fill_state(vision_result: VisionSensor.Result) -> void:
	var best := memory.best()
	if best == null:
		state.distance_to_target_m = INF
		state.has_line_of_sight = false
		state.target_confidence = 0.0
		state.known_threat_count = 0
		state.time_since_last_seen_s = INF
		return

	state.distance_to_target_m = state.position.distance_to(best.believed_position)
	state.target_confidence = best.confidence
	state.known_threat_count = memory.threat_count()
	state.time_since_last_seen_s = best.time_since_seen_s
	# Línea de visión SOLO si se ha confirmado con un rayo en este tick sobre
	# ese mismo objetivo. Sin confirmación no hay disparo: es la garantía de
	# que nadie dispara a través de una pared.
	state.has_line_of_sight = false
	for sighting: VisionSensor.Sighting in vision_result.sightings:
		if sighting.target_id == best.target_id:
			state.has_line_of_sight = sighting.detected
			break


func _on_noise_emitted(
	position: Vector3, intensity: float, radius_m: float, source_id: int
) -> void:
	hear_noise(position, intensity, radius_m, source_id)


## Cierra la cola de atacantes del legacy (`Bot::atackers`, análisis §3.5): un
## bot herido por la espalda no ve a quien le dispara, pero sabe de dónde vino
## el tiro y a quién responder. En el original esto solo lo consumía Patrol y
## se acumulaba sin límite en los demás estados; aquí entra en la misma memoria
## de contactos que todo lo demás, y por tanto también decae.
func _on_character_damaged(
	character_id: int,
	_amount: float,
	from_position: Vector3,
	attacker_id: int,
	attacker_team: int
) -> void:
	if character_id != bot_id:
		return
	report_damage_from(attacker_id, attacker_team, from_position)
