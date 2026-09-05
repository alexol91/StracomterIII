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
## Cuatro segundos de reloj de IA. La decisión va a 5 Hz y hay histéresis y
## enfriamientos: menos que esto mide el arranque, no el comportamiento.
const FRAMES: int = 240
const ENGAGE_DISTANCE_M: float = 8.0


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

	arena.enemy = (load("res://scenes/gameplay/enemy.tscn") as PackedScene).instantiate() as Character
	arena.map.add_child(arena.enemy)
	return arena


func _drop(arena: Arena) -> void:
	if arena.runtime != null:
		arena.runtime.teardown()
		_tree().root.remove_child(arena.runtime)
		arena.runtime.free()
	if arena.map != null:
		_tree().root.remove_child(arena.map)
		arena.map.queue_free()


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


func _run(arena: Arena, frames: int) -> void:
	AIScheduler.set_focus(arena.player.global_position)
	for _i: int in range(frames):
		AIScheduler._process(FRAME)


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
	_run(arena, FRAMES)

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
	assert_true(arena.enemy.intent_fire,
		"el bot ve al jugador, eligió %s y no aprieta el gatillo.\n%s"
			% [BehaviorKind.name_of(chosen), arena.brain.controller.explain()])
	_drop(arena)
