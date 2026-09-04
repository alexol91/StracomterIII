extends TestCase
## Los ángulos de cobertura se reparten (GDD §8.4).
##
## Un grupo entero mirando al mismo sitio es un grupo al que se rodea andando.
## El reparto no es cosmético: es lo que hace que acercarse por detrás cueste
## algo, y es una decisión de GRUPO —la toma el director, no cada bot por su
## cuenta—, porque ningún bot sabe hacia dónde miran los demás: la pizarra es
## la única vía de comunicación.


func before_each() -> void:
	Blackboard.clear()


func after_each() -> void:
	Blackboard.clear()


func test_the_group_does_not_watch_the_same_place() -> void:
	var director := SquadTestUtil.director(1, 5)
	var world := SquadTestUtil.world_two_accesses()
	var assignment := director.assign_roles(
		SquadTestUtil.squad_of_five(), SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)
	assert_size(assignment.watch_yaw, 5, "todos tienen ángulo asignado")
	assert_gt(
		SquadTestUtil.min_watch_separation(assignment),
		SquadTuning.MIN_WATCH_SEPARATION_RAD,
		"dos bots del mismo grupo no miran a la misma dirección"
	)


## La reserva cubre precisamente el arco que los que están en contacto NO
## cubren. Si mirase también al frente, el grupo tendría cinco pares de ojos
## en el mismo vano y ninguno en la puerta de atrás.
func test_the_reserve_covers_the_arc_the_engaged_do_not() -> void:
	var director := SquadTestUtil.director(1, 5)
	var world := SquadTestUtil.world_two_accesses()
	var assignment := director.assign_roles(
		SquadTestUtil.squad_of_five(), SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)
	var reserves := assignment.bots_with_role(Blackboard.Role.RESERVE)
	assert_gt(float(reserves.size()), 0.0, "el escenario tiene reserva")
	var target_bearing := atan2(SquadTestUtil.TARGET.z, SquadTestUtil.TARGET.x)
	for bot_id: int in reserves:
		var yaw: float = assignment.watch_yaw[bot_id]
		assert_gt(
			absf(wrapf(yaw - target_bearing, -PI, PI)),
			SquadTuning.ENGAGED_FAN_RAD,
			"la reserva %d está mirando al mismo vano que el Fijador" % bot_id
		)


## Quien fija SÍ mira al objetivo: repartir ángulos no puede convertirse en
## que nadie vigile la amenaza que tienen delante.
func test_the_pinner_still_watches_the_target() -> void:
	var director := SquadTestUtil.director(1, 5)
	var world := SquadTestUtil.world_two_accesses()
	var assignment := director.assign_roles(
		SquadTestUtil.squad_of_five(), SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)
	var pinners := assignment.bots_with_role(Blackboard.Role.PINNER)
	# `TestCase.assert_size` no sabe medir un `PackedInt32Array` (devuelve -1),
	# así que se compara el tamaño a mano. Anotado para `qa-tests`.
	assert_eq(pinners.size(), 1)
	var target_bearing := atan2(SquadTestUtil.TARGET.z, SquadTestUtil.TARGET.x)
	var yaw: float = assignment.watch_yaw[pinners[0]]
	assert_lt(
		absf(wrapf(yaw - target_bearing, -PI, PI)),
		SquadTuning.ENGAGED_FAN_RAD + 0.001,
		"el Fijador cubre el objetivo"
	)


## El flanqueador mira hacia donde VA, no hacia donde viene. Es la diferencia
## entre rodear y salir de espaldas.
func test_the_flanker_watches_along_its_own_route() -> void:
	var director := SquadTestUtil.director(1, 2)
	var world := SquadTestUtil.world_two_accesses()
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
	]
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)
	assert_eq(assignment.role_of(20), Blackboard.Role.FLANKER)
	var direction := assignment.watch_direction(20)
	# La ruta de flanqueo sale hacia −X y avanza hacia +Z: el flanqueador debe
	# mirar hacia ese cuadrante, no hacia el punto de partida.
	assert_lt(direction.x, 0.0, "mira hacia el lado por el que rodea")
	assert_gt(direction.z, 0.0, "y hacia adelante, no hacia atrás")


## Sin contacto, el reparto es el círculo entero: el grupo no sabe de dónde
## viene el problema, así que cubre todo.
func test_without_contact_the_group_covers_the_full_circle() -> void:
	var director := SquadTestUtil.director(1, 4)
	var world := SquadTestUtil.world_two_accesses()
	var none: Array[Blackboard.Contact] = []
	var assignment := director.assign_roles(SquadTestUtil.squad_of_four(), none, false, world)

	assert_false(assignment.has_target)
	assert_almost_eq(
		SquadTestUtil.min_watch_separation(assignment), TAU / 4.0, 0.001,
		"cuatro bots a ciegas se reparten el círculo en cuatro"
	)


## Replegándose tampoco miran todos al mismo sitio, y alguien sigue cubriendo
## la amenaza: una retirada con la espalda descubierta hacia el enemigo es
## exactamente la forma de morir de uno en uno que la regla evita.
func test_a_retreating_group_still_spreads_and_covers_the_threat() -> void:
	var director := SquadTestUtil.director(1, 10)
	var world := SquadTestUtil.world_two_accesses()
	var states: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
		SquadTestUtil.bot(30, Vector3(0.0, 0.0, 2.0)),
	]
	var assignment := director.assign_roles(
		states, SquadTestUtil.contacts_at(SquadTestUtil.TARGET), false, world
	)
	assert_true(assignment.retreating)
	assert_gt(
		SquadTestUtil.min_watch_separation(assignment),
		SquadTuning.MIN_WATCH_SEPARATION_RAD,
		"el repliegue no es una piña mirando al mismo sitio"
	)
	var target_bearing := atan2(SquadTestUtil.TARGET.z, SquadTestUtil.TARGET.x)
	var someone_covers_the_threat := false
	for bot_id: int in assignment.bot_ids():
		var yaw: float = assignment.watch_yaw[bot_id]
		if absf(wrapf(yaw - target_bearing, -PI, PI)) < 0.001:
			someone_covers_the_threat = true
	assert_true(someone_covers_the_threat, "alguien cubre la retirada")
