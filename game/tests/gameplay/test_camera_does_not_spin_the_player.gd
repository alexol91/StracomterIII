extends TestCase
## El jugador giraba sobre sí mismo sin parar en cuanto tocabas el ratón.
##
## Reportado jugando: «el personaje se queda como loco dando vueltas sin poder
## moverse». Las dos mitades son el mismo bucle:
##
##   1. `PlayerInput` apunta a donde mira la CÁMARA (`get_aim_point()`);
##   2. `CharacterController` gira al jugador hacia ese punto;
##   3. el `CameraRig` es HIJO del jugador, así que gira con él;
##   4. el punto de mira se ha movido, y vuelta a empezar.
##
## El giro por frame es el ángulo de la cámara, así que a 60 Hz un movimiento
## mínimo de ratón se convierte en varias vueltas por segundo. Y moverse deja
## de funcionar porque la dirección de WASD se calcula con la base de la
## cámara, que está girando: cada frame empuja hacia otro lado.
##
## Ninguna prueba ni sonda lo cogía: las sondas mueven bots por IA, que apuntan
## a una posición del mundo, y las capturas no tocan el input humano. El camino
## ratón→cámara→personaje no lo ejercitaba NADIE.

const PLAYER_SCENE: String = "res://scenes/gameplay/player.tscn"

var _player: Node3D = null


func after_each() -> void:
	if _player != null and is_instance_valid(_player):
		if _player.get_parent() != null:
			_player.get_parent().remove_child(_player)
		_player.free()
	_player = null


func _spawn_player() -> Node3D:
	var scene := load(PLAYER_SCENE) as PackedScene
	var node := scene.instantiate() as Node3D
	var tree := Engine.get_main_loop() as SceneTree
	var parent: Node = tree.current_scene if tree.current_scene != null else tree.root
	parent.add_child(node)
	_player = node
	return node


func test_turning_the_player_does_not_turn_the_camera() -> void:
	# La invariante que rompía el bucle: la cámara mira a donde la apunta el
	# jugador con el ratón, no a donde mire el cuerpo.
	var player := _spawn_player()
	var rig := player.get_node("CameraRig") as Node3D
	player.global_rotation = Vector3.ZERO
	var before := rig.global_rotation.y

	player.global_rotation.y = 1.0
	assert_almost_eq(rig.global_rotation.y, before, 0.0001,
		"la cámara no puede heredar el giro del cuerpo: es el bucle que le hacía dar vueltas")


func test_aiming_and_facing_settles_instead_of_spinning() -> void:
	# El bucle completo, cinco frames seguidos: apuntar donde mira la cámara y
	# girar el cuerpo hacia ahí. Si el ángulo no converge, el personaje gira
	# para siempre.
	var player := _spawn_player()
	var rig := player.get_node("CameraRig") as Node3D
	var input := player.get_node("PlayerInput")
	rig.set("_yaw", 0.6)
	var angles: Array[float] = []
	for _i: int in range(5):
		input.call("_read_aim")
		player.call("_face_towards", player.get("intent_look_at"))
		angles.append(player.global_rotation.y)
	var last_step: float = absf(angles[angles.size() - 1] - angles[angles.size() - 2])
	assert_lt(last_step, 0.001,
		"el giro tiene que asentarse; %.3f rad por frame son %.1f vueltas por segundo"
			% [last_step, last_step * 60.0 / TAU])


func test_the_aim_point_is_never_on_top_of_the_player() -> void:
	# La cámara va cuatro metros por detrás: un impacto a cuatro metros de la
	# cámara está a cero del cuerpo. Girar hacia un punto que tienes dentro es
	# girar hacia ruido —92° de deriva en un segundo, medido en partida— y el
	# arma dispararía a los propios pies.
	var camera := Vector3(0.0, 1.6, 4.0)
	var forward := Vector3(0.0, 0.0, -1.0)
	var player := Vector3(0.0, 1.6, 0.0)
	var near_hit := Vector3(0.0, 1.6, 0.1)  # a 3,9 m de la cámara: encima del jugador
	var point := TPSCamera.resolve_aim_point(camera, forward, near_hit, true, player, 100.0)
	assert_gt(player.distance_to(point), 1.0,
		"el punto de mira tiene que quedar por delante del cuerpo, no dentro")


func test_a_real_wall_ahead_is_still_the_aim_point() -> void:
	# Y lo contrario: una pared de verdad delante del jugador SÍ es el punto de
	# mira. Si se ignorara, se dispararía a través de ella.
	var camera := Vector3(0.0, 1.6, 4.0)
	var forward := Vector3(0.0, 0.0, -1.0)
	var player := Vector3(0.0, 1.6, 0.0)
	var wall := Vector3(0.0, 1.6, -6.0)
	var point := TPSCamera.resolve_aim_point(camera, forward, wall, true, player, 100.0)
	assert_eq(point, wall, "una pared a seis metros por delante es el punto de mira")


func test_with_nothing_in_the_way_the_aim_point_is_far_ahead() -> void:
	var camera := Vector3(0.0, 1.6, 4.0)
	var forward := Vector3(0.0, 0.0, -1.0)
	var player := Vector3(0.0, 1.6, 0.0)
	var point := TPSCamera.resolve_aim_point(camera, forward, Vector3.ZERO, false, player, 100.0)
	assert_gt(camera.distance_to(point), 50.0, "sin nada delante, se apunta lejos")


func test_one_mouse_event_can_never_teleport_the_view() -> void:
	# Un evento de ratón puede llegar con la distancia entera que ha recorrido
	# el cursor desde que la ventana perdió el foco. Medido al arrancar el
	# juego: 2060 px en el PRIMER evento, que a la sensibilidad por defecto son
	# 295° de golpe. La cámara nacía mirando a un sitio al azar.
	var sane := Vector2(12.0, -8.0)
	assert_eq(TPSCamera.clamp_mouse_step(sane), sane, "un gesto normal no se toca")
	var absurd := Vector2(2060.0, 0.0)
	var clamped := TPSCamera.clamp_mouse_step(absurd)
	assert_almost_eq(clamped.length(), TPSCamera.MAX_MOUSE_STEP_PX, 0.001,
		"un salto absurdo se recorta")
	assert_gt(clamped.x, 0.0, "pero se recorta, no se invierte ni se descarta")
	assert_eq(TPSCamera.clamp_mouse_step(Vector2.ZERO), Vector2.ZERO, "y el cero es cero")


func test_a_trackpad_swipe_cannot_spin_the_view_twice_around() -> void:
	# Medido en el registro de una partida real: 29 eventos y 4843 px de ratón
	# en medio segundo, que a la sensibilidad por defecto son 5,5 rad — más de
	# una vuelta completa. El recorte por EVENTO no lo evitaba: se aplicaba a
	# cada uno de los 29. Con el cursor capturado, macOS entrega los deltas con
	# su propia aceleración, y en un trackpad un gesto normal son miles de px.
	var burst := TPSCamera.look_delta_for(Vector2(4843.0, 0.0), 0.0025)
	assert_almost_eq(burst.x, TPSCamera.MAX_LOOK_RAD_PER_FRAME, 0.0001,
		"un gesto enorme gira lo máximo de un frame, no dos vueltas")
	var rate := TPSCamera.MAX_LOOK_RAD_PER_FRAME * 60.0
	assert_lt(rate, TAU * 1.5, "el tope por frame son %.0f°/s: rápido pero humano" % rad_to_deg(rate))


func test_small_mouse_moves_are_untouched_so_aiming_stays_precise() -> void:
	# El tope no puede convertirse en una división: apuntar fino tiene que
	# seguir funcionando igual.
	var small := Vector2(6.0, -4.0)
	var delta := TPSCamera.look_delta_for(small, 0.0025)
	assert_almost_eq(delta.x, small.x * 0.0025, 0.000001, "un gesto pequeño no se toca")
	assert_almost_eq(delta.y, small.y * 0.0025, 0.000001)
