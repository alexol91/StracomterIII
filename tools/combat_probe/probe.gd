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
##   * apuntaban al ORIGEN del objetivo, que son sus pies;
##   * `intent_move` se borraba en cada paso de física como si moverse fuera un
##     evento, así que los bots caminaban a UN TERCIO de su velocidad y no les
##     daba tiempo a cruzar la planta;
##   * un ruido se convertía en contacto O en pista, nunca en las dos, y el
##     contacto que deja un disparo oído no llega ni a amenaza ni a difusión:
##     el bot te oía disparar a tres metros y se iba a patrullar;
##   * la calma que sostiene PATROL era lineal en la confianza, y ganaba a
##     INVESTIGATE por menos que el margen de histéresis: el bot no cambiaba de
##     idea;
##   * el árbol leía el objetivo solo de la pizarra de escuadra, así que un bot
##     que no había difundido su contacto no tenía a dónde ir;
##   * la marca de supresión caducaba con el reloj de PARED.
##
## Ninguno daba un error. Todos se ven en un número: cuánto daño recibe un
## jugador quieto en medio de una planta poblada.
##
## Uso: tools/combat_probe/probe.sh <ruta-a-godot>
## Sale con código 1 si algo de la lista de comprobaciones falla.
##
## HASTA DÓNDE LLEGA SU DETERMINISMO, para que nadie lo persiga en vano: con la
## semilla fija y `--fixed-fps 60`, el VEREDICTO es estable y los disparos del
## jugador son exactos. Los números de la IA no: los identificadores de
## instancia cambian entre ejecuciones, y hay desempates que dependen de ellos
## —`ContactMemory.best()` ordena por `target_id`—, así que dos ejecuciones
## dan entre 20 y 40 disparos enemigos. Sirve como umbral («¿pelean?»), no como
## medida exacta.
##
## AVISO, porque ya costó una tarde: cuando el veredicto ALTERNA entre verde y
## rojo con el mismo código, la sospecha correcta no es «la sonda mide mal».
## Alternaba porque el combate dependía de que alguien pillara línea de visión
## de rebote: los cinco fallos de la lista de arriba estaban todos activos y lo
## que quedaba era una moneda al aire. La inestabilidad del instrumento era el
## dato, no el ruido.

## Segundos de partida que se dejan correr antes de juzgar.
const RUN_S: float = 30.0
## Segundos de margen para que la planta se monte y el director suelte la
## primera oleada.
const WARMUP_S: float = 4.0
const PHYSICS_HZ: float = 60.0
## Semilla del encuentro. Cualquier valor sirve; lo que importa es que sea
## SIEMPRE el mismo.
const SEED: int = 20120601
## Planta y zona que se juega. La 3-5 es la primera con MiniBoss, así que la
## sonda comprueba de paso que el jefe aparece: es contenido que estuvo escrito
## y desconectado, y lo único que lo delata es contarlo en partida.
const FLOOR: int = 3
const ZONE: int = 5
## Cada cuántos segundos dispara el jugador de la sonda.
##
## Un jugador que no dispara no hace ruido, y sin ruido nadie tiene motivo para
## acercarse: en un mapa grande los treinta segundos se iban en cero contactos.
## Disparar es además lo que ejercita el bucle completo —oído propagado por
## navmesh, investigar, adquirir, disparar—, que es justo lo que la sonda existe
## para vigilar.
const PLAYER_SHOT_EVERY_S: float = 2.0
## Frames seguidos que se mantiene la intención de disparo en cada ráfaga.
const BURST_FRAMES: int = 6
## Distancia media a la que un compañero deja de estar acompañando. Los huecos
## de formación están a menos de tres metros; con este margen cabe que uno se
## haya ido a cubrirse sin que la comprobación se vuelva un test de precisión.
const COMPANION_MAX_DISTANCE_M: float = 12.0

var _shots: int = 0
var _hits: int = 0
var _damage: float = 0.0
var _damage_squad: float = 0.0
var _player: Character = null
## Vida del jugador la última vez que se le pudo preguntar, y si murió.
##
## Hace falta porque el jugador PUEDE MORIR: con la IA funcionando, treinta
## segundos quieto en medio de la planta 3 se acaban en el suelo, y su nodo se
## libera. Guardar la referencia y llamarla al imprimir el informe reventaba el
## proceso con SIGSEGV — la sonda se caía justo cuando por fin funcionaba lo
## que mide.
var _player_health_ratio: float = 1.0
var _player_died: bool = false
var _player_shots: int = 0
var _companion_shots: int = 0
var _companion_hits: int = 0


func _ready() -> void:
	EventBus.shot_resolved.connect(_on_shot)
	EventBus.character_damaged.connect(_on_damaged)
	_run()


func _on_shot(shooter_id: int, hit: bool, _is_headshot: bool) -> void:
	var who := instance_from_id(shooter_id) as Character
	if who == null:
		return
	if who.team == Character.Team.PLAYER:
		_player_shots += 1
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
	# SEMILLA FIJA, y no es un detalle: `GameState.reset_run(0)` pone
	# `run_seed = randi()`, así que dos ejecuciones de la sonda montaban
	# encuentros distintos. Medido con el mismo código: 0, 15, 23, 41, 78, 87,
	# 133 y 143 disparos enemigos. Con esa dispersión la sonda no mide nada —
	# no se puede saber si un cambio en la IA ha ayudado o ha sido suerte— y
	# encima falla sola en CI de vez en cuando.
	#
	# El proyecto ya prometía determinismo desde `run_seed` (regla 6): aquí
	# solo se usa la promesa.
	GameState.run_seed = SEED
	GameState.current_floor = FLOOR
	intents.strategy_confirmed.emit(ZONE, 0, {})

	await _wait(WARMUP_S)
	_player = _find_player()
	if _player == null:
		printerr("[sonda] no hay jugador en la planta: la partida no arrancó")
		get_tree().quit(1)
		return

	var enemies := _count_enemies()
	var bosses := _count_bosses()
	var companions := _count_team(Character.Team.COMPANION)
	var start_distance := _mean_companion_distance()
	await _wait(RUN_S)

	print("[sonda] %.0f s de la planta %d zona %d con el jugador quieto:" % [
		RUN_S, FLOOR, ZONE])
	print("  enemigos al empezar: %d (al terminar: %d), de ellos jefes: %d" % [
		enemies, _count_enemies(), bosses])
	print("  disparos del jugador:%d" % _player_shots)
	print("  disparos enemigos:   %d" % _shots)
	print("  impactos:            %d" % _hits)
	print("  daño al jugador:     %.1f  (vida %.0f %%%s)" % [
		_damage, _player_health_ratio * 100.0, ", MUERTO" if _player_died else ""])
	print("  daño a la escuadra:  %.1f" % _damage_squad)
	print("  compañeros:          %d al empezar, %d al terminar" % [
		companions, _count_team(Character.Team.COMPANION)])
	print("  disparos de ellos:   %d (aciertos %d)" % [_companion_shots, _companion_hits])
	print("  distancia media al jugador: %.1f m → %.1f m" % [
		start_distance, _mean_companion_distance()])

	var failures: Array[String] = []
	if enemies <= 0:
		failures.append("el director no puso un solo enemigo")
	if bosses <= 0:
		failures.append("la zona promete jefe y no apareció ninguno")
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
	elif _mean_companion_distance() > COMPANION_MAX_DISTANCE_M and not _player_died:
		failures.append("los compañeros se quedaron a %.1f m: no siguen a nadie"
			% _mean_companion_distance())
	if failures.is_empty():
		print("[sonda] los enemigos pelean.")
		get_tree().quit(0)
		return
	for line: String in failures:
		printerr("[sonda] FALLO: %s" % line)
	get_tree().quit(1)


## Espera N segundos de física haciendo lo que hace un jugador: disparar de vez
## en cuando. `Character.fire()` solo pone la intención; la resuelve
## `WeaponSystem` en el paso de física siguiente.
func _wait(seconds: float) -> void:
	var every := int(PLAYER_SHOT_EVERY_S * PHYSICS_HZ)
	for i: int in range(int(seconds * PHYSICS_HZ)):
		# Se mantiene la intención unos frames seguidos: `fire()` solo la pone
		# y `CharacterController` la limpia al final del paso de física, así
		# que ponerla en UN frame desde un `await` puede perderse antes de que
		# `WeaponSystem` la lea.
		if _player != null and is_instance_valid(_player) and _player.alive:
			_player_health_ratio = _player.health_ratio()
			if (i % every) < BURST_FRAMES:
				_player.fire()
		elif _player != null:
			# Ha muerto: se suelta la referencia antes de que el nodo se libere.
			# Que muera no es un fallo de la sonda, es el escenario funcionando.
			_player = null
			_player_died = true
			_player_health_ratio = 0.0
		await get_tree().physics_frame


func _count_enemies() -> int:
	return _count_team(Character.Team.ENEMY)


## Jefes vivos. Es lo que separa «la planta 3 tiene MiniBoss» de «la planta 3
## dice que tiene MiniBoss».
func _count_bosses() -> int:
	var total := 0
	for node: Node in get_tree().get_nodes_in_group(&"characters"):
		var character := node as Character
		if character == null or not character.alive:
			continue
		if character.archetype == &"miniboss" or character.archetype == &"megaboss":
			total += 1
	return total


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
	if _player == null or not is_instance_valid(_player):
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
