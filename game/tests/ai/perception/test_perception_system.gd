extends TestCase
## Percepción completa de un bot, de punta a punta y sin escena.
##
## Comprueba las dos cosas que hacen que esto no sea el legacy: que NADIE
## detecta a través de geometría opaca, y que el conocimiento llega a la
## escuadra con retardo de reacción en lugar de por telepatía.

const WorldQueryFake := preload("res://tests/ai/perception/world_query_fake.gd")

var world: WorldQueryFake = null
var system: PerceptionSystem = null
var state: BotState = null
var targets: Array[VisionSensor.Target] = []
var published: Array[Blackboard.Contact] = []


func before_each() -> void:
	world = WorldQueryFake.new()
	world.bounds = AABB(Vector3(-16.0, 0.0, -16.0), Vector3(32.0, 3.0, 32.0))
	published = []

	var stats := CharacterStats.new()
	stats.vision_range_m = 24.0
	stats.vision_fov_primary_deg = 35.0
	stats.vision_fov_secondary_deg = 70.0
	stats.reaction_delay_s = 0.5

	state = BotState.new()
	state.bot_id = 1
	state.squad_id = 5
	state.team = 2
	state.position = Vector3.ZERO
	state.forward = Vector3.FORWARD

	system = PerceptionSystem.new(1, 5, 2, stats, world)
	system.state = state
	system.target_provider = _provide_targets
	system.broadcaster.report_sink = _record

	targets = []


func _provide_targets() -> Array[VisionSensor.Target]:
	return targets


func _record(_squad_id: int, contact: Blackboard.Contact) -> void:
	published.append(contact)


func _add_target(position: Vector3, id: int = 42, team: int = 0) -> VisionSensor.Target:
	var target := VisionSensor.Target.new()
	target.target_id = id
	target.team = team
	target.position = position
	targets.append(target)
	return target


func test_it_is_a_scheduler_client_and_never_ticks_itself() -> void:
	assert_true(system is AIScheduler.Client, "la percepción se registra en el scheduler")
	assert_false(system.has_method("_process"), "nada corre en _process (ADR-002)")


func test_no_bot_detects_through_opaque_geometry() -> void:
	_add_target(Vector3(0.0, 0.0, -8.0))
	world.add_wall(Vector3(-6.0, 0.0, -4.0), Vector3(6.0, 0.0, -4.0))
	for _i: int in 40:
		system.tick_perception(0.1)
		assert_false(state.has_line_of_sight, "línea de visión a través de un muro")
	assert_almost_eq(state.target_confidence, 0.0, 0.0001, "no hay contacto que valga")
	assert_eq(state.known_threat_count, 0, "ni amenazas conocidas")
	assert_size(published, 0, "y no se difunde nada a la escuadra")


func test_a_clear_target_is_detected_and_fills_the_bot_state() -> void:
	_add_target(Vector3(0.0, 0.0, -8.0))
	for _i: int in 10:
		system.tick_perception(0.1)
	assert_true(state.has_line_of_sight, "sin nada en medio, se ve")
	assert_almost_eq(state.target_confidence, 1.0, 0.0001, "y con certeza")
	assert_almost_eq(state.distance_to_target_m, 8.0, 0.2)
	assert_eq(state.known_threat_count, 1)
	assert_almost_eq(state.time_since_last_seen_s, 0.0, 0.0001)


func test_the_contact_is_broadcast_only_after_the_reaction_delay() -> void:
	_add_target(Vector3(0.0, 0.0, -8.0))
	var detected_at := -1.0
	var published_at := -1.0
	var elapsed := 0.0
	for _i: int in 30:
		system.tick_perception(0.1)
		elapsed += 0.1
		if detected_at < 0.0 and state.has_line_of_sight:
			detected_at = elapsed
		if published_at < 0.0 and not published.is_empty():
			published_at = elapsed
	assert_gt(detected_at, 0.0, "debería haberlo detectado")
	assert_gt(published_at, 0.0, "y haberlo difundido")
	assert_gt(
		published_at - detected_at,
		system.stats.reaction_delay_s - 0.051,
		"la escuadra no puede enterarse antes del retardo de reacción"
	)


func test_the_bot_keeps_believing_after_losing_sight_and_then_doubts() -> void:
	var target := _add_target(Vector3(0.0, 0.0, -8.0))
	for _i: int in 10:
		system.tick_perception(0.1)
	assert_almost_eq(state.target_confidence, 1.0, 0.0001)

	# El objetivo se esconde: nuevo muro y posición real distinta.
	world.add_wall(Vector3(-6.0, 0.0, -4.0), Vector3(6.0, 0.0, -4.0))
	target.position = Vector3(6.0, 0.0, -12.0)
	system.tick_perception(0.1)
	assert_false(state.has_line_of_sight, "ya no lo ve")

	var previous := state.target_confidence
	for _i: int in 20:
		system.tick_perception(0.1)
		assert_lt(state.target_confidence, previous, "la confianza decae sin contactos nuevos")
		previous = state.target_confidence
	assert_gt(state.target_confidence, 0.0, "pero no lo olvida de golpe: va a buscarlo")
	var believed := system.memory.get_entry(42).believed_position
	assert_gt(
		believed.distance_to(target.position),
		1.0,
		"y se equivoca de sitio, que es exactamente lo que debe pasar"
	)


func test_a_target_out_of_the_cone_is_ignored_even_at_one_meter() -> void:
	_add_target(Vector3(1.0, 0.0, 0.0))
	for _i: int in 20:
		system.tick_perception(0.1)
	assert_false(state.has_line_of_sight, "a 90° no se ve, aunque esté pegado")
	assert_eq(state.known_threat_count, 0)


func test_allies_are_never_treated_as_targets() -> void:
	_add_target(Vector3(0.0, 0.0, -5.0), 7, 2)  # Mismo equipo que el bot.
	for _i: int in 10:
		system.tick_perception(0.1)
	assert_eq(state.known_threat_count, 0, "los compañeros no son amenazas")
	assert_eq(world.raycast_count, 0, "ni se gasta un rayo en mirarlos")


func test_a_tick_never_exceeds_the_per_bot_raycast_budget() -> void:
	for i: int in 12:
		_add_target(Vector3(float(i) * 0.4 - 2.0, 0.0, -7.0), 100 + i)
	var used := system.tick_perception(0.1)
	assert_eq(
		used,
		system.effective_profile().max_raycasts_per_tick,
		"gasta su presupuesto, ni uno más"
	)
	assert_eq(world.raycast_count, used, "y lo declara con exactitud al scheduler")


func test_forty_bots_fit_under_the_global_raycast_ceiling() -> void:
	# Se reproduce el reparto del AIScheduler: prioridad primero, y corte duro
	# al llegar al techo global. Lo que se comprueba aquí es que la percepción
	# DECLARA bien su coste, que es de lo que depende ese techo.
	var total := 0
	var served := 0
	for bot: int in 40:
		if total >= AIScheduler.MAX_RAYCASTS_PER_FRAME:
			break
		var bot_world := WorldQueryFake.new()
		var bot_state := BotState.new()
		bot_state.position = Vector3(float(bot), 0.0, 0.0)
		bot_state.forward = Vector3.FORWARD
		var stats := CharacterStats.new()
		stats.vision_range_m = 24.0
		stats.vision_fov_primary_deg = 35.0
		stats.vision_fov_secondary_deg = 70.0
		var bot_system := PerceptionSystem.new(bot + 100, 1, 2, stats, bot_world)
		bot_system.state = bot_state
		bot_system.broadcaster.report_sink = _record
		var bot_targets: Array[VisionSensor.Target] = []
		for i: int in 4:
			var t := VisionSensor.Target.new()
			t.target_id = 900 + i
			t.team = 0
			t.position = bot_state.position + Vector3(0.0, 0.0, -6.0 - float(i))
			bot_targets.append(t)
		bot_system.target_provider = func() -> Array[VisionSensor.Target]: return bot_targets
		total += bot_system.tick_perception(0.1)
		served += 1
	assert_lt(float(total), float(AIScheduler.MAX_RAYCASTS_PER_FRAME) + 0.5, "techo global respetado")
	assert_gt(float(served), 15.0, "y aun así se atiende a una escuadra entera por frame")


func test_a_noise_from_a_hidden_enemy_creates_a_contact_without_seeing_it() -> void:
	# Enemigo detrás de un muro: no se ve, pero pega un tiro.
	var target := _add_target(Vector3(0.0, 0.0, -8.0))
	world.add_wall(Vector3(-6.0, 0.0, -4.0), Vector3(6.0, 0.0, -4.0))
	system.tick_perception(0.1)
	assert_eq(state.known_threat_count, 0, "de partida no sabe nada")

	system.hear_noise(target.position, 1.0, 30.0, target.target_id)
	system.tick_perception(0.1)
	assert_false(state.has_line_of_sight, "seguir sin verlo es obligatorio")
	assert_gt(state.target_confidence, 0.0, "pero ya sabe que hay alguien ahí detrás")
	assert_lt(
		state.target_confidence,
		1.0,
		"con menos certeza que si lo hubiera visto: oír no es ver"
	)


func test_a_bot_ignores_its_own_noise() -> void:
	system.hear_noise(Vector3(1.0, 0.0, 0.0), 1.0, 20.0, system.bot_id)
	assert_eq(system.hearing.pending_count(), 0, "nadie se asusta de sus propios pasos")


func test_squad_contacts_are_absorbed_but_never_the_bots_own_echo() -> void:
	var mine := Blackboard.Contact.new()
	mine.target_id = 42
	mine.team = 0
	mine.last_known_position = Vector3(3.0, 0.0, -3.0)
	mine.confidence = 1.0
	mine.reporter_id = system.bot_id  # Mi propio reporte, rebotando en la pizarra.

	var theirs := Blackboard.Contact.new()
	theirs.target_id = 43
	theirs.team = 0
	theirs.last_known_position = Vector3(-9.0, 0.0, -3.0)
	theirs.confidence = 1.0
	theirs.reporter_id = 99

	var absorbed := system.absorb_squad_contacts([mine, theirs] as Array[Blackboard.Contact])
	assert_eq(absorbed, 1, "el eco de uno mismo no cuenta como información nueva")
	assert_false(system.memory.has(42), "leer lo que uno escribió sería un lazo infinito")
	assert_true(system.memory.has(43), "lo que cuenta un compañero, sí")
	assert_lt(
		system.memory.get_entry(43).confidence,
		1.0,
		"pero la información de segunda mano vale menos que la propia"
	)


func test_scheduler_hints_are_kept_up_to_date() -> void:
	system.sync_scheduler_hints(Vector3(4.0, 0.0, -2.0), true)
	assert_eq(system.world_position, Vector3(4.0, 0.0, -2.0), "el scheduler prioriza por posición")
	assert_true(system.on_screen, "y por visibilidad en cámara (ADR-002)")


func test_a_bot_shot_in_the_back_learns_who_shot_it() -> void:
	# Cierra la cola de atacantes del legacy (`Bot::atackers`, análisis §3.5).
	# El atacante está a 180°: imposible de ver, pero el bot sabe de dónde vino
	# el tiro y a quién responder.
	var attacker_position := Vector3(0.0, 0.0, 6.0)
	system.tick_perception(0.1)
	assert_eq(state.known_threat_count, 0, "de espaldas no ve nada")

	system.report_damage_from(77, 0, attacker_position)
	system.tick_perception(0.1)

	var entry := system.memory.get_entry(77)
	assert_not_null(entry, "el atacante entra en la memoria de contactos")
	if entry == null:
		return
	assert_eq(entry.source, ContactMemory.Source.DAMAGE, "y consta que se supo por el dolor")
	assert_lt(
		entry.believed_position.distance_to(attacker_position),
		0.001,
		"con la posición desde la que llegó el disparo"
	)
	assert_false(state.has_line_of_sight, "sin verlo, que es lo importante")
	assert_gt(state.target_confidence, 0.0, "pero ya sabe a quién responder")


func test_damage_from_the_event_bus_reaches_the_memory() -> void:
	# La señal lleva ahora los ids del atacante, así que el bot no necesita que
	# nadie se los pase a mano.
	system.connect_events()
	EventBus.character_damaged.emit(system.bot_id, 12.0, Vector3(0.0, 0.0, 5.0), 88, 0)
	assert_true(system.memory.has(88), "el bot herido apunta a quien le disparó")

	EventBus.character_damaged.emit(9999, 12.0, Vector3(0.0, 0.0, 5.0), 89, 0)
	assert_false(system.memory.has(89), "y no se entera de los tiros que reciben otros")
	system.disconnect_events()


func test_damage_from_an_ally_is_ignored() -> void:
	system.report_damage_from(55, system.team, Vector3(0.0, 0.0, 5.0))
	assert_false(system.memory.has(55), "el fuego amigo no crea un enemigo")


func test_every_archetype_profile_reaches_the_four_subsystems() -> void:
	var stats: CharacterStats = Balance.character(&"enemy_thug")
	assert_not_null(stats, "falta el sicario en los datos")
	if stats == null:
		return
	assert_not_null(stats.perception, "el sicario debe traer perfil de percepción")
	system.configure(stats)
	assert_eq(system.profile, stats.perception, "el perfil del arquetipo manda")
	assert_eq(system.vision.profile, stats.perception, "y llega a la vista")
	assert_eq(system.hearing.profile, stats.perception, "al oído")
	assert_eq(system.memory.profile, stats.perception, "a la memoria")
	assert_eq(system.broadcaster.profile, stats.perception, "y a la difusión")


func test_a_stats_without_profile_falls_back_to_defaults_instead_of_crashing() -> void:
	var bare := CharacterStats.new()
	bare.vision_range_m = 24.0
	system.configure(bare)
	assert_not_null(system.profile, "sin perfil en datos se usan los valores por defecto")
	assert_gt(float(system.effective_profile().max_raycasts_per_tick), 0.0)


func test_perception_degrades_to_blind_with_any_world_query_never_to_omniscient() -> void:
	# El mundo llega compuesto (física + navegación) y puede llegar a medias.
	# La garantía de este módulo — nadie ve a través de geometría opaca — no
	# puede depender de que el montaje esté completo.
	#
	# Se comprueba desde el lado del consumidor a propósito: el defecto que
	# esto vigila (una consulta al mundo a medio montar que concede visión en
	# lugar de negarla) es invisible en las pruebas del proveedor, porque allí
	# parece una decisión razonable.
	var half_built: WorldQueryComposite = WorldQueryComposite.new(null, NavService.new())
	system.world = half_built
	_add_target(Vector3(0.0, 0.0, -8.0))
	for _i: int in 20:
		system.tick_perception(0.1)
	assert_false(state.has_line_of_sight, "sin mundo montado, el bot es ciego")
	assert_eq(state.known_threat_count, 0, "y no se inventa amenazas")
	assert_almost_eq(state.target_confidence, 0.0, 0.0001)


func test_hearing_reads_an_unreachable_source_as_far_not_as_near() -> void:
	# El contrato del que depende el oído: INF en `path_cost` significa "no hay
	# paso", y entonces el ruido llega amortiguado. Si una implementación
	# devolviera INF por "aún no lo he calculado", el mismo disparo sonaría
	# distinto según el frame y la percepción dejaría de ser determinista.
	var muffled := HearingSensor.effective_cost(INF, 10.0, system.effective_profile())
	var direct := HearingSensor.effective_cost(10.0, 10.0, system.effective_profile())
	assert_gt(muffled, direct, "sin ruta, el sonido cuesta más y por tanto se oye menos")
	assert_false(is_inf(muffled), "pero se sigue oyendo: no hay paso, no es que no exista")


func test_an_incomplete_world_is_denounced_at_startup_not_discovered_by_behaviour() -> void:
	# Un mundo a medio enlazar no falla: degrada. Un bot sin física es ciego y
	# patrulla tan tranquilo; uno sin navegación oye todos los disparos igual
	# de lejos. Ninguna de las dos cosas da un error por sí sola.
	system.world = WorldQueryComposite.new(null, WorldQueryFake.new())
	var blind := system.world_problems()
	assert_size(blind, 1, "falta la física y se dice")
	assert_true(blind[0].contains("ciego"), "con el síntoma, no solo el nombre del campo")

	system.world = WorldQueryComposite.new(WorldQueryPhysics.new(), null)
	assert_size(system.world_problems(), 1, "falta la navegación y también se dice")

	system.world = WorldQueryComposite.new(WorldQueryPhysics.new(), WorldQueryFake.new())
	assert_size(system.world_problems(), 0, "montaje completo: sin quejas")

	system.world = null
	assert_size(system.world_problems(), 1, "y sin mundo, la queja más obvia")


func test_a_plain_world_query_is_not_reported_as_incomplete() -> void:
	# El doble sintético responde a las dos familias de preguntas por sí solo:
	# la comprobación es sobre el compositor, no una exigencia de usarlo.
	system.world = WorldQueryFake.new()
	assert_size(system.world_problems(), 0, "un WorldQuery entero no necesita compositor")
