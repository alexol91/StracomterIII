class_name CharacterActuator
extends BotActuator
## Actuador real: traduce las órdenes del árbol a las INTENCIONES de un
## `Character` de `gameplay/`.
##
## Es el único fichero de este subsistema que toca `gameplay/`, y sólo a
## través de su API de intenciones pública (`move_to`, `look_at_point`,
## `fire`, `reload`). La dependencia va hacia abajo (`ai → gameplay`), que es
## la dirección permitida por ADR-001. `Character` sigue sin saber que existe
## la IA.
##
## Ojo con `move_to`: el contrato de `Character` es DIRECCIONAL (una dirección
## normalizada en espacio de mundo), no un destino. Convertir un punto en una
## dirección es responsabilidad de quien conoce el punto — aquí — y no de
## `gameplay/`, que no debe saber nada de rutas.

var character: Character = null


func _init(p_character: Character = null) -> void:
	character = p_character


func position() -> Vector3:
	if character == null or not is_instance_valid(character):
		return Vector3.INF
	return character.global_position


## ¿Sigue vivo el cuerpo? Un bot muerto no ejecuta comportamiento; quien lo
## conduce debe darlo de baja del planificador.
func is_alive() -> bool:
	return character != null and is_instance_valid(character) and character.alive


func move_towards(point: Vector3) -> void:
	super(point)
	if not is_alive():
		return
	var direction := point - character.global_position
	# El movimiento del juego es horizontal: una diferencia de altura no debe
	# convertirse en un intento de caminar hacia arriba.
	direction.y = 0.0
	character.move_to(direction)


func stop() -> void:
	super()
	if not is_alive():
		return
	character.move_to(Vector3.ZERO)


func face(point: Vector3) -> void:
	super(point)
	if not is_alive():
		return
	character.look_at_point(point)


func fire() -> void:
	super()
	if not is_alive():
		return
	character.fire()


func reload() -> void:
	super()
	if not is_alive():
		return
	character.reload()


func set_crouch(value: bool) -> void:
	super(value)
	if not is_alive():
		return
	character.intent_crouch = value
