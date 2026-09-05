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

var _shots: int = 0
var _hits: int = 0
var _damage: float = 0.0
var _player: Character = null


func _ready() -> void:
	EventBus.shot_resolved.connect(_on_shot)
	EventBus.character_damaged.connect(_on_damaged)
	_run()


func _on_shot(shooter_id: int, hit: bool, _is_headshot: bool) -> void:
	var who := instance_from_id(shooter_id) as Character
	if who == null or who.team == Character.Team.PLAYER:
		return
	_shots += 1
	if hit:
		_hits += 1


func _on_damaged(character_id: int, amount: float, _from: Vector3,
		_attacker_id: int, _attacker_team: int) -> void:
	if _player != null and character_id == _player.get_instance_id():
		_damage += amount


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
	await _wait(RUN_S)

	print("[sonda] %.0f s de planta 1 con el jugador quieto:" % RUN_S)
	print("  enemigos al empezar: %d (al terminar: %d)" % [enemies, _count_enemies()])
	print("  disparos enemigos:   %d" % _shots)
	print("  impactos:            %d" % _hits)
	print("  daño al jugador:     %.1f  (vida %.0f %%)" % [_damage, _player.health_ratio() * 100.0])

	var failures: Array[String] = []
	if enemies <= 0:
		failures.append("el director no puso un solo enemigo")
	if _shots <= 0:
		failures.append("ningún enemigo llegó a disparar")
	if _hits <= 0:
		failures.append("dispararon %d veces y no acertaron ni una" % _shots)
	if _damage <= 0.0:
		failures.append("el jugador no recibió ni un punto de daño")
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
	var total := 0
	for node: Node in get_tree().get_nodes_in_group(&"characters"):
		var character := node as Character
		if character != null and character.alive and character.team != Character.Team.PLAYER:
			total += 1
	return total


func _find_player() -> Character:
	for node: Node in get_tree().get_nodes_in_group(&"characters"):
		var character := node as Character
		if character != null and character.team == Character.Team.PLAYER:
			return character
	return null
