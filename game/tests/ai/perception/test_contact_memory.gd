extends TestCase
## La memoria de contactos: la confianza decae de forma MONÓTONA sin contactos
## nuevos, y se restaura al volver a ver.
##
## Es lo que separa a un bot que "olvida de golpe" (el legacy borraba de
## `memory` todo lo que dejaba de estar visible ese frame) de uno que va a
## buscarte donde cree que estás y se equivoca de forma creíble.

var memory: ContactMemory = null
var profile: PerceptionProfile = null


func before_each() -> void:
	memory = ContactMemory.new()
	profile = PerceptionProfile.new()
	memory.profile = profile


func test_confidence_decays_monotonically_without_new_contacts() -> void:
	memory.reinforce_sight(1, 2, Vector3(4.0, 0.0, 0.0), Vector3.ZERO)
	var previous := memory.get_entry(1).confidence
	assert_almost_eq(previous, 1.0, 0.0001, "recién visto: certeza plena")
	for _i: int in 50:
		memory.update(0.1)
		var current := memory.get_entry(1).confidence
		assert_lt(current, previous, "la confianza debe decaer en CADA paso, sin mesetas")
		previous = current
	assert_lt(previous, 0.3, "tras 5 s sin verte, el bot ya duda de verdad")


func test_decay_is_pure_and_strictly_decreasing() -> void:
	var a := ContactMemory.decay(1.0, 0.5, profile)
	var b := ContactMemory.decay(1.0, 0.5, profile)
	assert_eq(a, b, "misma entrada, misma salida")
	assert_lt(a, 1.0, "medio segundo ya resta confianza")
	assert_gt(a, 0.0, "pero no se olvida de golpe")
	assert_almost_eq(ContactMemory.decay(0.0, 10.0, profile), 0.0, 0.0001, "de cero no se baja")
	assert_almost_eq(ContactMemory.decay(0.8, 0.0, profile), 0.8, 0.0001, "sin tiempo no hay olvido")


func test_a_moving_target_is_forgotten_faster() -> void:
	var still := ContactMemory.decay(1.0, 1.0, profile, 0.0)
	var running := ContactMemory.decay(1.0, 1.0, profile, 6.0)
	assert_lt(running, still, "si corría, su última posición envejece antes")


func test_confidence_is_restored_when_seen_again() -> void:
	memory.reinforce_sight(1, 2, Vector3(4.0, 0.0, 0.0), Vector3.ZERO)
	for _i: int in 30:
		memory.update(0.1)
	var faded := memory.get_entry(1).confidence
	assert_lt(faded, 0.6, "la confianza se ha degradado")

	memory.reinforce_sight(1, 2, Vector3(5.0, 0.0, 1.0), Vector3.ZERO)
	var entry := memory.get_entry(1)
	assert_almost_eq(entry.confidence, 1.0, 0.0001, "al volver a verte, deja de dudar")
	assert_eq(entry.believed_position, Vector3(5.0, 0.0, 1.0), "y corrige dónde estás")
	assert_almost_eq(entry.time_since_seen_s, 0.0, 0.0001)


func test_believed_position_extrapolates_and_then_freezes() -> void:
	# Objetivo visto moviéndose a 4 m/s hacia +X.
	memory.reinforce_sight(1, 2, Vector3.ZERO, Vector3(4.0, 0.0, 0.0))
	memory.update(0.5)
	var believed := memory.get_entry(1).believed_position
	assert_gt(believed.x, 0.0, "el bot supone que has seguido andando")

	for _i: int in 40:
		memory.update(0.1)
	var frozen := memory.get_entry(1).believed_position
	assert_lt(
		frozen.x,
		profile.max_extrapolation_s * 4.0 + 0.001,
		"pero deja de extrapolar: no persigue un fantasma que se aleja para siempre"
	)


func test_extrapolate_is_pure() -> void:
	var a := ContactMemory.extrapolate(Vector3.ZERO, Vector3(2.0, 0.0, 0.0), 0.5, profile)
	var b := ContactMemory.extrapolate(Vector3.ZERO, Vector3(2.0, 0.0, 0.0), 0.5, profile)
	assert_eq(a, b)
	assert_eq(
		ContactMemory.extrapolate(Vector3.ONE, Vector3.ZERO, 5.0, profile),
		Vector3.ONE,
		"sin velocidad conocida no se inventa movimiento"
	)


func test_pruning_forgets_the_contacts_below_the_threshold() -> void:
	memory.reinforce_sight(1, 2, Vector3.ZERO, Vector3.ZERO)
	memory.reinforce_sight(2, 2, Vector3(9.0, 0.0, 0.0), Vector3.ZERO)
	assert_eq(memory.count(), 2)
	for _i: int in 200:
		memory.update(0.1)
	var removed := memory.prune()
	assert_eq(removed, 2, "tras 20 s sin nada, se olvidan los dos")
	assert_eq(memory.count(), 0)
	assert_null(memory.best(), "y el bot se queda a ciegas, que es lo correcto")


func test_sound_never_overrides_a_fresher_visual_contact() -> void:
	memory.reinforce_sight(1, 2, Vector3(3.0, 0.0, 0.0), Vector3.ZERO)
	memory.reinforce_sound(1, 2, Vector3(-9.0, 0.0, 0.0), 0.4)
	var entry := memory.get_entry(1)
	assert_almost_eq(entry.confidence, 1.0, 0.0001, "un ruido flojo no degrada lo que acabas de ver")
	assert_eq(entry.believed_position, Vector3(3.0, 0.0, 0.0), "ni te mueve el contacto de sitio")
	assert_eq(entry.source, ContactMemory.Source.SIGHT)


func test_best_contact_is_deterministic_on_ties() -> void:
	memory.reinforce_sight(9, 2, Vector3(1.0, 0.0, 0.0), Vector3.ZERO)
	memory.reinforce_sight(4, 2, Vector3(2.0, 0.0, 0.0), Vector3.ZERO)
	assert_eq(memory.best().target_id, 4, "a igualdad de confianza gana el id menor, siempre")


func test_threat_count_only_counts_believable_contacts() -> void:
	memory.reinforce_sight(1, 2, Vector3.ZERO, Vector3.ZERO)
	memory.reinforce_sound(2, 2, Vector3(5.0, 0.0, 0.0), 0.1)
	assert_eq(memory.count(), 2, "los dos están en memoria")
	assert_eq(memory.threat_count(), 1, "pero solo uno es una amenaza creíble")
