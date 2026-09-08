extends TestCase
## La intención de MOVIMIENTO es un nivel, no un evento.
##
## `clear_intents()` la borraba al final de cada paso de física, junto a
## disparar y recargar. Al jugador no le afectaba —el input la reescribe en
## cada paso— pero un cerebro de IA la escribe en su tick de comportamiento, a
## 20 Hz, y la física va a 60: dos de cada tres pasos la encontraban borrada.
##
## Resultado medido en la sonda de combate: el Sicario, con 2 m/s en su ficha,
## avanzaba a 0,66 m/s. Un tercio exacto. No daba error ni aviso; se leía como
## «los enemigos son pasivos», porque en treinta segundos no llegaban a cruzar
## la planta.
##
## Esta prueba es pura: no mueve un cuerpo, comprueba el ciclo de vida de la
## intención, que es donde estaba el fallo.


func test_clearing_the_event_intents_does_not_erase_the_move_intent() -> void:
	var body := Character.new()
	body.move_to(Vector3.FORWARD)
	body.fire()
	body.clear_intents()
	assert_false(body.intent_fire, "disparar es un evento: se consume y se olvida")
	assert_eq(body.intent_move, Vector3.FORWARD,
		"querer ir hacia delante no se olvida en el mismo paso de física")
	body.free()


func test_the_move_intent_survives_two_behavior_ticks() -> void:
	# El tick de comportamiento es de 20 Hz (ADR-002): 0,05 s. Con la física a
	# 60 Hz eso son tres pasos por tick, y la intención tiene que aguantarlos.
	var body := Character.new()
	body.move_to(Vector3.RIGHT)
	for _i: int in range(3):
		body.age_move_intent(1.0 / 60.0)
		body.clear_intents()
	assert_eq(body.intent_move, Vector3.RIGHT, "tres pasos de física, misma intención")
	body.free()


func test_an_unrefreshed_move_intent_expires() -> void:
	# La red de seguridad: un cuerpo cuyo cerebro ha muerto no camina para
	# siempre.
	var body := Character.new()
	body.move_to(Vector3.RIGHT)
	body.age_move_intent(Character.MOVE_INTENT_TTL_S + 0.01)
	assert_eq(body.intent_move, Vector3.ZERO, "sin refresco, la intención vence")
	body.free()


func test_stopping_is_immediate_and_does_not_wait_for_the_expiry() -> void:
	# Quien quiere parar lo dice. Si esto dependiera del vencimiento, un bot
	# tardaría en frenar y se pasaría de su punto de cobertura.
	var body := Character.new()
	body.move_to(Vector3.RIGHT)
	body.move_to(Vector3.ZERO)
	assert_eq(body.intent_move, Vector3.ZERO, "parar es inmediato")
	body.free()


func test_godmode_actually_stops_damage() -> void:
	# El truco `god` de la consola escribía el metadato y nadie lo leía: decía
	# "Modo dios activado" y el jugador seguía muriéndose. Un truco que no hace
	# nada es peor que uno que no existe, porque manda a buscar el problema a
	# otro sitio.
	var body := Character.new()
	body.archetype = &"captain"
	var tree := Engine.get_main_loop() as SceneTree
	var parent: Node = tree.current_scene if tree.current_scene != null else tree.root
	parent.add_child(body)
	var full := body.health
	body.set_meta(Character.GODMODE_META, true)
	body.apply_damage(Damage.new(50.0, Damage.Zone.TORSO, Vector3.ZERO, 0, 2))
	assert_eq(body.health, full, "en modo dios no se pierde vida")
	body.set_meta(Character.GODMODE_META, false)
	body.apply_damage(Damage.new(50.0, Damage.Zone.TORSO, Vector3.ZERO, 0, 2))
	assert_lt(body.health, full, "sin modo dios sí")
	parent.remove_child(body)
	body.free()
