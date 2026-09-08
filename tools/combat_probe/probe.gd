extends Node
## Sonda de combate: arranca una partida de verdad y comprueba que los
## enemigos PELEAN.
##
## Existe porque las 680 pruebas del runner no pueden decirlo. El runner es
## síncrono —no puede esperar pasos de física— así que ninguna prueba cruza la
## frontera entre "la IA decide disparar" y "la bala hace daño". Y esa
## frontera es justo donde han vivido los fallos:
##
##   * los bots no giraban la cabeza al patrullar, así que nunca miraban al
##     jugador: 30 s a menos de 7 m, cero contactos;
##   * la máscara de oclusión de la vista no incluía las puertas, así que
##     "veían" a través de una puerta cerrada y sus balas se la comían:
##     41 disparos, 0 impactos;
##   * apuntaban al ORIGEN del objetivo, que son sus pies.
##
## Ninguno daba un error. Los tres se ven en un número: cuánto daño recibe un
## jugador quieto en medio de una planta poblada.
##
## Uso: tools/combat_probe/probe.sh <ruta-a-godot>
## Sale con código 1 si el jugador no recibe ni un punto de daño.

## Segundos de partida que se dejan correr antes de juzgar.
const RUN_S: float = 30.0
## Segundos de margen para que la planta se monte y el director suelte la
## primera oleada.
const WARMUP_S: float = 4.0
const PHYSICS_HZ: float = 60.0
## Distancia media a la que un compañero deja de estar acompañando. Los huecos
## de formación están a menos de tres metros; con este margen cabe que uno se
## haya ido a cubrirse sin que la comprobación se vuelva un test de precisión.
const COMPANION_MAX_DISTANCE_M: float = 12.0

var _shots: int = 0
var _hits: int = 0
var _damage: float = 0.0
var _damage_squad: float = 0.0
var _player: Character = null
var _companion_shots: int = 0
var _companion_hits: int = 0


func _ready() -> void:
	EventBus.shot_resolved.connect(_on_shot)
	EventBus.character_damaged.connect(_on_damaged)
	_run()


func _on_shot(shooter_id: int, hit: bool, _is_headshot: bool) -> void:
	var who := instance_from_id(shooter_id) as Character
	if who == null or who.team == Character.Team.PLAYER:
		return
	if who.team == Character.Team.COMPANION:
		_companion_shots += 1
		if hit:
			_companion_hits += 1
		return
	_shots += 1
	if hit:
		_hits += 1


func _on_damaged(character_id: int, amount: float, _from: Vector3,
		_attacker_id: int, _attacker_team: int) -> void:
	if _player != null and character_id == _player.get_instance_id():
		_damage += amount
		return
	var victim := instance_from_id(character_id) as Character
	if victim != null and victim.team == Character.Team.COMPANION:
		_damage_squad += amount


func _run() -> void:
	var main := (load("res://scenes/main.tscn") as PackedScene).instantiate()
	add_child(main)
	await get_tree().process_frame

	# Se conduce por donde lo conduce un jugador: las intenciones de la UI.
	var intents := UIIntents.get_singleton()
	intents.run_start_requested.emit(&"captain")
	await get_tree().process_frame
	intents.strategy_confirmed.emit(1, 0, {})

	await _wait(WARMUP_S)
	_player = _find_player()
	if _player == null:
		printerr("[sonda] no hay jugador en la planta: la partida no arrancó")
		get_tree().quit(1)
		return

	var enemies := _count_enemies()
	var companions := _count_team(Character.Team.COMPANION)
	var start_distance := _mean_companion_distance()
	await _wait(RUN_S)

	print("[sonda] %.0f s de planta 1 con el jugador quieto:" % RUN_S)
	print("  enemigos al empezar: %d (al terminar: %d)" % [enemies, _count_enemies()])
	print("  disparos enemigos:   %d" % _shots)
	print("  impactos:            %d" % _hits)
	print("  daño al jugador:     %.1f  (vida %.0f %%)" % [_damage, _player.health_ratio() * 100.0])
	print("  daño a la escuadra:  %.1f" % _damage_squad)
	print("  compañeros:          %d al empezar, %d al terminar" % [
		companions, _count_team(Character.Team.COMPANION)])
	print("  disparos de ellos:   %d (aciertos %d)" % [_companion_shots, _companion_hits])
	print("  distancia media al jugador: %.1f m → %.1f m" % [
		start_distance, _mean_companion_distance()])

	var failures: Array[String] = []
	if enemies <= 0:
		failures.append("el director no puso un solo enemigo")
	if _shots <= 0:
		failures.append("ningún enemigo llegó a disparar")
	if _hits <= 0:
		failures.append("dispararon %d veces y no acertaron ni una" % _shots)
	# Al BANDO del jugador, no al jugador: con compañeros delante los enemigos
	# aciertan en ellos y es correcto que el jugador acabe intacto. Exigir daño
	# al jugador convertiría "la escuadra te cubre" en un fallo.
	if _damage + _damage_squad <= 0.0:
		failures.append("nadie del bando del jugador recibió un punto de daño")
	if companions <= 0:
		failures.append("no bajó ningún compañero a la planta")
	elif _mean_companion_distance() > COMPANION_MAX_DISTANCE_M:
		failures.append("los compañeros se quedaron a %.1f m: no siguen a nadie"
			% _mean_companion_distance())
	if failures.is_empty():
		print("[sonda] los enemigos pelean.")
		get_tree().quit(0)
		return
	for line: String in failures:
		printerr("[sonda] FALLO: %s" % line)
	get_tree().quit(1)


func _wait(seconds: float) -> void:
	for _i: int in range(int(seconds * PHYSICS_HZ)):
		await get_tree().physics_frame


func _count_enemies() -> int:
	return _count_team(Character.Team.ENEMY)


func _count_team(team: Character.Team) -> int:
	var total := 0
	for node: Node in get_tree().get_nodes_in_group(&"characters"):
		var character := node as Character
		if character != null and character.alive and character.team == team:
			total += 1
	return total


## Distancia media de los compañeros vivos al jugador. Es la medida de que la
## formación funciona: si crece sin parar, nadie está siguiendo a nadie.
func _mean_companion_distance() -> float:
	if _player == null:
		return -1.0
	var total := 0.0
	var count := 0
	for node: Node in get_tree().get_nodes_in_group(&"characters"):
		var character := node as Character
		if character == null or not character.alive \
				or character.team != Character.Team.COMPANION:
			continue
		total += character.global_position.distance_to(_player.global_position)
		count += 1
	return total / float(count) if count > 0 else -1.0


func _find_player() -> Character:
	for node: Node in get_tree().get_nodes_in_group(&"characters"):
		var character := node as Character
		if character != null and character.team == Character.Team.PLAYER:
			return character
	return null
