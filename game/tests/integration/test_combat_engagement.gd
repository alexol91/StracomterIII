extends TestCase
## ¿Los enemigos COMBATEN?
##
## Los subsistemas de percepción, decisión y ejecución están probados uno a
## uno con dobles. Esta prueba los pone juntos sobre un mapa de verdad, con un
## jugador de verdad a ocho metros y sin nada en medio, y comprueba la única
## cosa que importa: que el bot lo ve, decide pelear y aprieta el gatillo.
##
## El fallo que motiva el fichero no se parece a un fallo: los bots patrullan,
## oyen los disparos, se acercan — y no disparan nunca. Todo verde, nadie
## dispara.

const MAP: String = "res://maps/legacy/mapP1.tscn"
const FRAME: float = 1.0 / 60.0
## Ocho segundos de reloj de IA. La decisión va a 5 Hz, con compromiso mínimo
## por comportamiento (1,2 s) y veto de 1,1 s cuando un árbol falla. Con cuatro
## segundos, UN fallo de árbol en el primer tick —cuando la percepción aún no ha
## corrido y todavía no hay línea de visión— consumía la mitad de la ventana y
## el resultado dependía de la fase del planificador. Esto mide comportamiento,
## no el arranque.
const FRAMES: int = 480
const ENGAGE_DISTANCE_M: float = 8.0
## Grupo propio de esta arena. NO el 0, que es el que trae `enemy.tscn` por
## defecto: otros ficheros de prueba dejan personajes de la escuadra 0 en el
## árbol —sus `queue_free()` no se vacían hasta que acaba el frame, y el
## fichero entero corre dentro de uno— y `AIRuntime._adopt_existing` los
## adopta. La escuadra de tres salía con diez.
const ARENA_SQUAD: int = 77


func before_each() -> void:
	# Aislamiento explícito. La pizarra y el planificador son AUTOLOADS: los
	# contactos que otra prueba dejó en la escuadra 0 —el grupo por defecto de
	# un enemigo— los lee este bot como suyos, se cree que tiene un objetivo
	# donde no hay nadie, y se queda a cubierto apuntando a un fantasma.
	#
	# Esta prueba pasaba sola y fallaba en la suite completa, que es la firma
	# exacta de la contaminación entre pruebas.
	AIScheduler.clear()
	Blackboard.clear()


func after_each() -> void:
	AIScheduler.clear()
	Blackboard.clear()


func _tree() -> SceneTree:
	return Engine.get_main_loop() as SceneTree


class Arena:
	extends RefCounted

	var map: Node3D = null
	var runtime: AIRuntime = null
	var player: Character = null
	var enemy: Character = null
	var brain: BotBrain = null
	var fired: Array[int] = [0]


## Monta mapa, pila de IA, jugador y un enemigo con línea de visión franca.
func _build_arena() -> Arena:
	var arena := Arena.new()
	arena.map = (load(MAP) as PackedScene).instantiate() as Node3D
	_tree().root.add_child(arena.map)

	arena.runtime = AIRuntime.new()
	_tree().root.add_child(arena.runtime)
	arena.runtime.build_for_level(arena.map)

	arena.player = (load("res://scenes/gameplay/player.tscn") as PackedScene).instantiate() as Character
	arena.map.add_child(arena.player)

	arena.enemy = _make_enemy(arena)
	return arena


## Un enemigo del grupo de la arena, ya en el árbol y con su cerebro montado.
func _make_enemy(arena: Arena) -> Character:
	var enemy := (load("res://scenes/gameplay/enemy.tscn") as PackedScene).instantiate() as Character
	# ANTES de entrar en el árbol: `AIRuntime` lee el grupo en el `_ready` del
	# personaje, así que ponerlo después lo dejaría en la escuadra equivocada.
	enemy.squad_id = ARENA_SQUAD
	arena.map.add_child(enemy)
	return enemy


func _drop(arena: Arena) -> void:
	if arena.runtime != null:
		arena.runtime.teardown()
		_tree().root.remove_child(arena.runtime)
		arena.runtime.free()
	if arena.map != null:
		_tree().root.remove_child(arena.map)
		# `free()` y NO `queue_free()`: los métodos de prueba son síncronos y
		# corren todos dentro del mismo frame, así que una cola de liberación
		# no se vacía hasta que el fichero entero ha terminado. Con
		# `queue_free()` los personajes de una prueba seguían en el grupo
		# `characters` durante la siguiente, y `AIRuntime._adopt_existing` los
		# adoptaba: la escuadra de tres salía con diez.
		arena.map.free()


## Coloca a los dos en un tramo del navmesh con visión franca entre ellos.
## Devuelve si lo consiguió: sin un par así la prueba no mide nada y hay que
## decirlo, no darla por buena.
func _place_facing_each_other(arena: Arena) -> bool:
	var world := arena.runtime.world
	if world == null:
		return false
	var samples := arena.runtime.patrol_ring_points()
	for a: Vector3 in samples:
		for b: Vector3 in samples:
			var distance := a.distance_to(b)
			if distance < 4.0 or distance > ENGAGE_DISTANCE_M:
				continue
			if not world.has_line_of_sight(a + Vector3.UP * 1.5, b + Vector3.UP * 1.5):
				continue
			arena.player.global_position = a
			arena.enemy.global_position = b
			return true
	return false


## Corre la IA y CUENTA los frames en que el enemigo quiso disparar.
##
## Contar y no mirar el estado final: el bot alterna entre cubrirse y disparar
## —tiene compromiso mínimo por comportamiento y margen de conmutación—, así
## que el instante en que acaba el bucle es una moneda al aire. Lo que la
## prueba quiere saber es si en cuatro segundos con el jugador delante llega a
## apretar el gatillo alguna vez.
func _run(arena: Arena, frames: int) -> int:
	AIScheduler.set_focus(arena.player.global_position)
	var wanted_to_fire := 0
	for _i: int in range(frames):
		AIScheduler._process(FRAME)
		if arena.enemy.intent_fire:
			wanted_to_fire += 1
	return wanted_to_fire


func test_a_bot_with_a_clear_shot_sees_decides_and_fires() -> void:
	var arena := _build_arena()
	var placed := _place_facing_each_other(arena)
	assert_true(placed, "no se encontró un par de puntos con visión franca: la prueba no mide nada")
	if not placed:
		_drop(arena)
		return

	arena.brain = arena.runtime.brain_of(arena.enemy)
	assert_not_null(arena.brain, "el enemigo no recibió cerebro")
	if arena.brain == null:
		_drop(arena)
		return

	# Se mide la INTENCIÓN de disparar, no el disparo resuelto: aquí no corre
	# el paso de física, así que `WeaponSystem` no llega a ejecutarse y
	# `EventBus.shot_resolved` no se emitiría nunca. Lo que esta prueba juzga
	# es la IA —¿decide disparar?—, no la balística, que tiene las suyas.
	var fire_frames := _run(arena, FRAMES)

	var state := arena.brain.state
	assert_true(state.has_line_of_sight,
		"con visión franca a %.1f m el bot debería VER al jugador" % ENGAGE_DISTANCE_M)
	assert_gt(state.target_confidence, 0.5,
		"y creerse lo que ve: confianza %.2f" % state.target_confidence)
	var chosen := arena.brain.controller.active_behavior()
	assert_true(chosen in [BehaviorKind.Kind.ATTACK, BehaviorKind.Kind.SUPPRESS,
			BehaviorKind.Kind.ASSAULT, BehaviorKind.Kind.FLANK,
			BehaviorKind.Kind.TAKE_COVER],
		"con el jugador delante eligió %s.\n%s"
			% [BehaviorKind.name_of(chosen), arena.brain.controller.explain()])
	assert_gt(float(fire_frames), 0.0,
		("el bot ve al jugador, acabó en %s y no apretó el gatillo ni una vez.\n"
			+ "ctx.target=%s conf=%.2f los=%s municion=%.2f/%d fallos_arbol=%d\n%s")
			% [BehaviorKind.name_of(chosen), str(arena.brain.context.target_position),
				state.target_confidence, str(state.has_line_of_sight),
				state.ammo_ratio, arena.enemy.ammo,
				arena.brain.controller.stat_tree_failures,
				arena.brain.controller.explain()])
	_drop(arena)


# --- La escuadra enemiga, enchufada ----------------------------------------

func test_enemies_of_the_same_squad_get_roles_from_a_squad_runner() -> void:
	# `SquadDirector`, `SquadRunner` y `SquadRoleAssignment` estaban escritos y
	# probados, y no aparecían fuera de sus propias pruebas: en partida los
	# enemigos eran individuos sueltos sin roles, sin supresión y sin flanqueo.
	# El hito 2.10 entero era código muerto en el juego.
	var arena := _build_arena()
	if not _place_facing_each_other(arena):
		_drop(arena)
		return

	# Dos más, en el mismo grupo que el que ya hay.
	var extra: Array[Character] = []
	for offset: Vector3 in [Vector3(1.2, 0.0, 0.0), Vector3(-1.2, 0.0, 0.0)]:
		var enemy := _make_enemy(arena)
		enemy.global_position = arena.enemy.global_position + offset
		extra.append(enemy)

	var runner := arena.runtime.squad_of(arena.enemy.squad_id)
	assert_not_null(runner, "los enemigos tienen que entrar en una escuadra")
	if runner == null:
		_drop(arena)
		return
	assert_true(runner.is_registered(), "y la escuadra tiene que pensar en el planificador")
	assert_eq(runner.size(), 3, "los tres del mismo grupo van juntos")

	_run(arena, FRAMES)

	assert_gt(float(runner.stat_decisions), 0.0, "la escuadra no llegó a decidir")
	assert_not_null(runner.last_assignment, "sin reparto no hay roles")
	if runner.last_assignment == null:
		_drop(arena)
		return
	var roles: Array[int] = []
	for character: Character in ([arena.enemy] + extra):
		var brain := arena.runtime.brain_of(character)
		if brain != null:
			roles.append(int(brain.state.role))
	assert_size(roles, 3, "los tres deben tener cerebro")
	assert_true(roles.any(func(role: int) -> bool: return role != int(Blackboard.Role.NONE)),
		"con el jugador a la vista alguien tiene que llevar un rol")

	_drop(arena)


func test_a_squad_that_loses_everyone_stops_thinking() -> void:
	# Quien llena un registro lo vacía: una escuadra vacía registrada en el
	# planificador es trabajo por cada tick a cambio de nada.
	var arena := _build_arena()
	arena.enemy.global_position = arena.player.global_position + Vector3(6.0, 0.0, 0.0)
	var squad_id := arena.enemy.squad_id
	var runner := arena.runtime.squad_of(squad_id)
	assert_not_null(runner)
	if runner == null:
		_drop(arena)
		return

	EventBus.character_died.emit(arena.enemy.get_instance_id(), int(arena.enemy.team), 0, 0)
	assert_null(arena.runtime.squad_of(squad_id),
		"la escuadra vacía debe darse de baja, no quedarse registrada")
	_drop(arena)


# --- Los compañeros del jugador --------------------------------------------

func test_the_strategy_screen_choice_decides_who_comes_down() -> void:
	# La pantalla de Estrategia deja marcar a quién te llevas y `Main` tiraba
	# ese diccionario a la basura: se elegía escuadra y bajaba el jugador solo.
	GameState.reset_run(1234)
	GameState.player_archetype = &"captain"

	assert_size(GameState.companions_for_floor(), 3,
		"sin decir nada vienen los tres vivos: la pantalla trae las casillas marcadas")

	GameState.squad_taken = {&"technician": true, &"specialist": false, &"demolition": true}
	var taken := GameState.companions_for_floor()
	assert_size(taken, 2, "solo los marcados")
	assert_has(taken, &"technician")
	assert_has(taken, &"demolition")

	GameState.squad[&"technician"].alive = false
	assert_size(GameState.companions_for_floor(), 1, "un muerto no baja aunque esté marcado")

	# Y nunca el propio jugador: sería un clon siguiéndose a sí mismo.
	GameState.player_archetype = &"demolition"
	GameState.squad_taken = {}
	assert_false(GameState.companions_for_floor().has(&"demolition"))
	GameState.reset_run(1234)


func test_companions_appear_on_the_floor_and_join_the_players_squad() -> void:
	var loader := LevelLoader.new()
	_tree().root.add_child(loader)
	var runtime := AIRuntime.new()
	_tree().root.add_child(runtime)

	var wanted: Array[StringName] = [&"technician", &"specialist"]
	var level := loader.load_level(MAP, &"captain", true, wanted)
	assert_not_null(level, "la planta no se montó")
	if level == null:
		_tree().root.remove_child(runtime)
		runtime.free()
		_tree().root.remove_child(loader)
		loader.free()
		return

	assert_size(level.companions, 2, "tienen que aparecer los dos elegidos")
	for companion: Character in level.companions:
		assert_eq(int(companion.team), int(Character.Team.COMPANION))
		assert_eq(companion.squad_id, Blackboard.PLAYER_SQUAD_ID,
			"el compañero comparte grupo con el jugador o no le llegan sus contactos")
		assert_lt(companion.global_position.distance_to(level.player.global_position), 6.0,
			"y aparece junto al jugador, no en la otra punta de la planta")

	runtime.build_for_level(level.root)
	var squad := runtime.companion_squad()
	assert_not_null(squad, "los compañeros necesitan quien los gobierne")
	if squad != null:
		# Se comprueba que estén LOS MÍOS, no cuántos hay en total: los métodos
		# de prueba corren dentro del mismo frame, así que los personajes que
		# otra prueba mandó a `queue_free()` siguen en el árbol y
		# `AIRuntime._adopt_existing` también los adopta.
		var enlisted := squad.companion_ids()
		for companion: Character in level.companions:
			assert_has(enlisted, companion.get_instance_id(),
				"'%s' no entró en la escuadra del jugador" % companion.archetype)
		assert_true(squad.is_registered(), "y tienen que pensar en el planificador")
		assert_not_null(squad.leader, "sin líder no hay a quien seguir")

	runtime.teardown()
	_tree().root.remove_child(runtime)
	runtime.free()
	loader.unload()
	_tree().root.remove_child(loader)
	loader.free()


func test_a_companion_gets_a_place_to_be_and_a_companions_weight_table() -> void:
	# Lo que separa a un compañero de un enemigo NO es el cerebro —es el mismo
	# selector, los mismos árboles— sino el filtro y la tabla de pesos que le
	# entra. Y `BehaviorContext.objective` es de donde `FOLLOW_LEADER` saca a
	# dónde ir: sin rellenarlo, el compañero se queda plantado donde nació.
	var loader := LevelLoader.new()
	_tree().root.add_child(loader)
	var runtime := AIRuntime.new()
	_tree().root.add_child(runtime)

	var wanted: Array[StringName] = [&"technician"]
	var level := loader.load_level(MAP, &"captain", true, wanted)
	runtime.build_for_level(level.root)
	var squad := runtime.companion_squad()
	var companion: Character = level.companions[0] if not level.companions.is_empty() else null

	if squad != null and companion != null:
		AIScheduler.set_focus(level.player.global_position)
		for _i: int in range(FRAMES):
			AIScheduler._process(FRAME)

		assert_gt(float(squad.stat_decisions), 0.0, "la escuadra del jugador no decidió")
		var brain := runtime.brain_of(companion)
		assert_not_null(brain, "un compañero también lleva cerebro")
		if brain != null:
			assert_true(BehaviorContext.is_finite_point(brain.context.objective),
				"sin objetivo el compañero no sabe a dónde ir")
			assert_not_null(brain.controller.filter,
				"y sin filtro no se distingue de un enemigo")

	runtime.teardown()
	_tree().root.remove_child(runtime)
	runtime.free()
	loader.unload()
	_tree().root.remove_child(loader)
	loader.free()
