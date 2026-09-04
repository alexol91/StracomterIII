extends TestCase
## El retardo de reacción por arquetipo: NUNCA telepatía instantánea.
##
## Es lo que separa a un bot difícil de uno tramposo. Si toda la escuadra sabe
## dónde estás en el mismo frame en que uno solo te ve, no se lee como "son
## buenos": se lee como "hacen trampas".

var broadcaster: ContactBroadcaster = null
var published: Array[Blackboard.Contact] = []
var published_squads: Array[int] = []
var fake_clock_msec: int = 0


func before_each() -> void:
	published = []
	published_squads = []
	fake_clock_msec = 0
	broadcaster = ContactBroadcaster.new()
	broadcaster.reporter_id = 11
	broadcaster.report_sink = _record
	broadcaster.clock_msec = _clock


func _record(squad_id: int, contact: Blackboard.Contact) -> void:
	published_squads.append(squad_id)
	published.append(contact)


func _clock() -> int:
	return fake_clock_msec


func test_contact_does_not_reach_the_blackboard_before_the_reaction_delay() -> void:
	broadcaster.reaction_delay_s = 0.5
	broadcaster.submit(3, 42, 2, Vector3(4.0, 0.0, 0.0), 0.9)

	var elapsed := 0.0
	# 4 ticks de percepción a 10 Hz = 0,4 s: aún no ha reaccionado.
	for _i: int in 4:
		broadcaster.update(0.1)
		elapsed += 0.1
		assert_size(published, 0, "publicado tras solo %.1f s" % elapsed)
	assert_eq(broadcaster.pending_count(), 1, "sigue pendiente")


func test_contact_reaches_the_blackboard_once_the_delay_expires() -> void:
	broadcaster.reaction_delay_s = 0.5
	broadcaster.submit(3, 42, 2, Vector3(4.0, 0.0, 0.0), 0.9)
	for _i: int in 6:
		broadcaster.update(0.1)
	assert_size(published, 1, "a los 0,6 s ya ha reaccionado")
	assert_eq(published_squads[0], 3, "va a la pizarra de su escuadra")
	assert_eq(published[0].target_id, 42)
	assert_eq(published[0].reporter_id, 11, "y consta quién lo vio")
	assert_almost_eq(published[0].confidence, 0.9, 0.0001)


func test_a_slower_archetype_reacts_later() -> void:
	broadcaster.reaction_delay_s = 0.8
	broadcaster.submit(1, 42, 2, Vector3.ZERO, 1.0)
	for _i: int in 6:
		broadcaster.update(0.1)
	assert_size(published, 0, "el matón tarda 0,8 s en enterarse")
	for _i: int in 3:
		broadcaster.update(0.1)
	assert_size(published, 1, "pero acaba enterándose")


func test_reaction_delay_is_never_zero() -> void:
	broadcaster.reaction_delay_s = 0.0
	broadcaster.submit(1, 42, 2, Vector3.ZERO, 1.0)
	broadcaster.update(0.0)
	assert_size(published, 0, "ni el arquetipo más rápido tiene telepatía")
	broadcaster.update(0.2)
	assert_size(published, 1)


func test_a_tracked_target_refreshes_without_paying_the_delay_again() -> void:
	broadcaster.reaction_delay_s = 0.5
	broadcaster.submit(1, 42, 2, Vector3.ZERO, 1.0)
	for _i: int in 6:
		broadcaster.update(0.1)
	assert_size(published, 1)

	# Ya se está reaccionando a ese objetivo: las actualizaciones fluyen.
	broadcaster.submit(1, 42, 2, Vector3(1.0, 0.0, 0.0), 1.0)
	broadcaster.update(0.1)
	assert_size(published, 2, "el seguimiento no vuelve a pagar el retardo")
	assert_eq(published[1].last_known_position, Vector3(1.0, 0.0, 0.0))


func test_losing_the_target_makes_the_next_sighting_pay_again() -> void:
	broadcaster.reaction_delay_s = 0.5
	broadcaster.submit(1, 42, 2, Vector3.ZERO, 1.0)
	for _i: int in 6:
		broadcaster.update(0.1)
	assert_size(published, 1)

	# Silencio más largo que la gracia de seguimiento.
	for _i: int in 30:
		broadcaster.update(0.1)
	broadcaster.submit(1, 42, 2, Vector3(8.0, 0.0, 0.0), 1.0)
	broadcaster.update(0.1)
	assert_size(published, 1, "un reencuentro vuelve a costar reacción")
	for _i: int in 5:
		broadcaster.update(0.1)
	assert_size(published, 2)


func test_continuous_sighting_still_gets_published_exactly_once_per_delay() -> void:
	# Un objetivo visto en TODOS los ticks no debe reiniciar su propio reloj:
	# si lo hiciera, el contacto no llegaría nunca a la pizarra.
	broadcaster.reaction_delay_s = 0.5
	for _i: int in 8:
		broadcaster.submit(1, 42, 2, Vector3.ZERO, 1.0)
		broadcaster.update(0.1)
	assert_gt(float(published.size()), 0.0, "un avistamiento sostenido acaba difundiéndose")


func test_archetype_delays_come_from_data_and_stay_in_the_gdd_range() -> void:
	# La regla del GDD §8.1: 0,3-0,8 s según arquetipo. Ningún literal en el
	# código de percepción; el dato manda.
	var ids: Array[StringName] = [&"enemy_thug", &"enemy_militiaman", &"enemy_veteran"]
	for id: StringName in ids:
		var stats: CharacterStats = Balance.character(id)
		assert_not_null(stats, "falta el arquetipo %s en los datos" % id)
		if stats == null:
			continue
		assert_between(stats.reaction_delay_s, 0.25, 0.8, "retardo fuera de rango en %s" % id)


func test_default_sink_publishes_to_the_real_blackboard() -> void:
	Blackboard.clear()
	var direct := ContactBroadcaster.new()
	direct.reaction_delay_s = 0.3
	direct.reporter_id = 11
	direct.submit(77, 42, 2, Vector3(2.0, 0.0, 0.0), 0.9)
	direct.update(0.2)
	assert_null(Blackboard.best_contact(77), "antes del retardo la pizarra está limpia")
	direct.update(0.2)
	var contact: Blackboard.Contact = Blackboard.best_contact(77)
	assert_not_null(contact, "después, el contacto está en la pizarra de la escuadra")
	if contact != null:
		assert_eq(contact.target_id, 42)
	Blackboard.clear()
