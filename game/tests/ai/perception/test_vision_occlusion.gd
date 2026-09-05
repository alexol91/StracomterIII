extends TestCase
## El invariante que existe este remake para arreglar: NINGÚN BOT VE A TRAVÉS
## DE GEOMETRÍA OPACA.
##
## El legacy comprobaba la inclusión del objetivo en un triángulo y por eso sus
## bots te "veían" a través de las paredes. Aquí la detección exige un raycast
## de oclusión despejado, y si no hay presupuesto para lanzarlo, no hay
## detección. Nunca al revés.

const WorldQueryFake := preload("res://tests/ai/perception/world_query_fake.gd")

var world: WorldQueryFake = null
var sensor: VisionSensor = null
var stats: CharacterStats = null
var profile: PerceptionProfile = null


func before_each() -> void:
	world = WorldQueryFake.new()
	sensor = VisionSensor.new()
	# Fixture explícito en lugar de datos de `Balance`: esta prueba es de
	# GEOMETRÍA, y debe seguir siendo válida aunque se rebalanceen los conos.
	stats = CharacterStats.new()
	stats.vision_range_m = 24.0
	stats.vision_fov_primary_deg = 35.0
	stats.vision_fov_secondary_deg = 70.0
	profile = PerceptionProfile.new()
	stats.perception = profile
	sensor.profile = profile


## Bot en el origen mirando a -Z (convenio de Godot).
func _target_at(position: Vector3, id: int = 1) -> VisionSensor.Target:
	var target := VisionSensor.Target.new()
	target.target_id = id
	target.team = 2
	target.position = position
	return target


func _run_ticks(targets: Array[VisionSensor.Target], ticks: int, dt: float = 0.1) -> VisionSensor.Result:
	var result: VisionSensor.Result = null
	for _i: int in ticks:
		result = sensor.evaluate(
			Vector3.ZERO, Vector3.FORWARD, stats, targets, world, dt, 8
		)
	return result


func test_target_in_primary_cone_without_occluder_is_detected() -> void:
	var targets: Array[VisionSensor.Target] = [_target_at(Vector3(0.0, 0.0, -8.0))]
	var result := _run_ticks(targets, 10)
	assert_not_null(result.best, "debería haber un objetivo detectado")
	assert_true(result.sightings[0].detected, "objetivo despejado en el foco: se ve")
	assert_true(result.sightings[0].has_line_of_sight, "línea de visión confirmada")
	assert_eq(result.sightings[0].cone, VisionSensor.Cone.PRIMARY, "cae en el cono primario")


func test_target_in_cone_behind_wall_is_never_detected() -> void:
	# Muro completo entre el bot y el objetivo, ambos en la misma recta.
	world.add_wall(Vector3(-6.0, 0.0, -4.0), Vector3(6.0, 0.0, -4.0))
	var targets: Array[VisionSensor.Target] = [_target_at(Vector3(0.0, 0.0, -8.0))]
	var result: VisionSensor.Result = null
	# 60 ticks = 6 segundos mirándolo fijamente. Sigue sin verlo.
	for _i: int in 60:
		result = sensor.evaluate(Vector3.ZERO, Vector3.FORWARD, stats, targets, world, 0.1, 8)
		assert_false(result.sightings[0].detected, "detectado a través de un muro")
	assert_eq(result.sightings[0].cone, VisionSensor.Cone.PRIMARY, "sí está dentro del cono")
	assert_false(result.sightings[0].has_line_of_sight, "no hay línea de visión")
	assert_almost_eq(sensor.awareness_of(1), 0.0, 0.0001, "la conciencia no debe crecer")
	assert_null(result.best, "no puede haber mejor objetivo sin visión")


func test_partial_cover_at_chest_height_still_blocks() -> void:
	# Una caja baja a media altura entre los dos: el rayo va de ojos (1,6 m) a
	# pecho (1,1 m), así que una caja de 1,4 m lo corta.
	world.add_box(AABB(Vector3(-3.0, 0.0, -4.2), Vector3(6.0, 1.4, 0.4)))
	var targets: Array[VisionSensor.Target] = [_target_at(Vector3(0.0, 0.0, -8.0))]
	var result := _run_ticks(targets, 20)
	assert_false(result.sightings[0].detected, "una cobertura opaca es una cobertura")


func test_target_outside_cone_is_not_detected_even_at_one_meter() -> void:
	# A un metro, pero a 90°: el bot mira a -Z y el objetivo está a +X.
	var targets: Array[VisionSensor.Target] = [_target_at(Vector3(1.0, 0.0, 0.0))]
	var result := _run_ticks(targets, 30)
	assert_eq(result.sightings[0].cone, VisionSensor.Cone.NONE, "90° está fuera de ambos conos")
	assert_false(result.sightings[0].detected, "no se detecta lo que no se mira")
	assert_eq(world.raycast_count, 0, "no se gasta un rayo en lo que no está en el cono")


func test_secondary_cone_detects_but_much_slower_than_primary() -> void:
	var focused: Array[VisionSensor.Target] = [_target_at(Vector3(0.0, 0.0, -8.0))]
	var peripheral: Array[VisionSensor.Target] = [
		_target_at(Vector3(-5.66, 0.0, -5.66), 2)  # 45°: fuera del foco, dentro del periférico.
	]

	var primary_result := _run_ticks(focused, 5)
	assert_true(primary_result.sightings[0].detected, "el foco adquiere en menos de medio segundo")

	sensor.reset()
	var peripheral_result := _run_ticks(peripheral, 5)
	assert_eq(
		peripheral_result.sightings[0].cone,
		VisionSensor.Cone.SECONDARY,
		"45° cae en el cono periférico — que en el legacy era código inalcanzable"
	)
	assert_false(peripheral_result.sightings[0].detected, "de reojo se tarda más")

	var later := _run_ticks(peripheral, 20)
	assert_true(later.sightings[0].detected, "pero al final se acaba viendo")


func test_target_on_another_floor_is_out_of_vision() -> void:
	var targets: Array[VisionSensor.Target] = [_target_at(Vector3(0.0, 4.0, -6.0))]
	var result := _run_ticks(targets, 10)
	assert_eq(result.sightings[0].cone, VisionSensor.Cone.NONE, "otra planta, otra historia")
	assert_false(result.sightings[0].detected, "no se ve a través del forjado")


func test_without_raycast_budget_there_is_no_detection() -> void:
	var targets: Array[VisionSensor.Target] = [_target_at(Vector3(0.0, 0.0, -6.0))]
	var result: VisionSensor.Result = null
	for _i: int in 20:
		result = sensor.evaluate(Vector3.ZERO, Vector3.FORWARD, stats, targets, world, 0.1, 0)
	assert_eq(result.raycasts_used, 0, "sin presupuesto no se lanza ningún rayo")
	assert_false(result.sightings[0].detected, "sin confirmar, no se detecta")
	assert_false(result.sightings[0].was_tested, "y consta que no se comprobó")


func test_raycast_budget_is_never_exceeded() -> void:
	var targets: Array[VisionSensor.Target] = []
	for i: int in 10:
		targets.append(_target_at(Vector3(float(i) * 0.5 - 2.0, 0.0, -6.0), i + 1))
	var result := sensor.evaluate(Vector3.ZERO, Vector3.FORWARD, stats, targets, world, 0.1, 3)
	assert_eq(result.raycasts_used, 3, "se gasta exactamente el presupuesto dado")
	assert_eq(world.raycast_count, 3, "y ni un rayo más en el mundo")


func test_awareness_decays_when_line_of_sight_is_lost() -> void:
	var targets: Array[VisionSensor.Target] = [_target_at(Vector3(0.0, 0.0, -6.0))]
	_run_ticks(targets, 10)
	assert_almost_eq(sensor.awareness_of(1), 1.0, 0.0001, "adquirido")
	# El objetivo se mete detrás de un muro.
	world.add_wall(Vector3(-6.0, 0.0, -3.0), Vector3(6.0, 0.0, -3.0))
	var after := _run_ticks(targets, 3)
	assert_lt(sensor.awareness_of(1), 1.0, "la conciencia cae al perder la visión")
	assert_false(after.sightings[0].detected, "y deja de contar como detectado")


func test_cone_for_is_pure_and_deterministic() -> void:
	var a := VisionSensor.cone_for(
		Vector3.ZERO, Vector3.FORWARD, Vector3(0.0, 0.0, -5.0), stats, profile
	)
	var b := VisionSensor.cone_for(
		Vector3.ZERO, Vector3.FORWARD, Vector3(0.0, 0.0, -5.0), stats, profile
	)
	assert_eq(a, b, "misma entrada, misma salida")
	assert_eq(a, VisionSensor.Cone.PRIMARY)
	assert_eq(
		VisionSensor.cone_for(
			Vector3.ZERO, Vector3.FORWARD, Vector3(0.0, 0.0, -100.0), stats, profile
		),
		VisionSensor.Cone.NONE,
		"fuera de alcance"
	)


func test_the_profile_is_what_separates_a_thug_from_a_veteran() -> void:
	# La misma geometría, dos perfiles: el dato manda sobre el código (ADR-005).
	var targets: Array[VisionSensor.Target] = [_target_at(Vector3(0.0, 0.0, -8.0))]
	var veteran: PerceptionProfile = load("res://src/data/perception/veteran.tres")
	var sloppy: PerceptionProfile = load("res://src/data/perception/sloppy.tres")
	assert_not_null(veteran, "falta el perfil del veterano en los datos")
	assert_not_null(sloppy, "falta el perfil del sicario en los datos")
	if veteran == null or sloppy == null:
		return

	sensor.profile = veteran
	stats.perception = veteran
	var veteran_ticks := 0
	while veteran_ticks < 60:
		veteran_ticks += 1
		if sensor.evaluate(Vector3.ZERO, Vector3.FORWARD, stats, targets, world, 0.1, 8).sightings[0].detected:
			break

	sensor.reset()
	sensor.profile = sloppy
	stats.perception = sloppy
	var sloppy_ticks := 0
	while sloppy_ticks < 60:
		sloppy_ticks += 1
		if sensor.evaluate(Vector3.ZERO, Vector3.FORWARD, stats, targets, world, 0.1, 8).sightings[0].detected:
			break

	assert_lt(
		float(veteran_ticks),
		float(sloppy_ticks),
		"el veterano debe adquirir antes que el sicario, y sin tocar una línea de código"
	)


func test_only_world_geometry_blocks_vision_not_other_bodies() -> void:
	# El motor solo detiene un rayo si la capa del cuerpo está en la máscara de
	# la consulta. La visión pregunta por la capa "world" (1), así que el cuerpo
	# de un compañero —capa 3, "companion"— no debe tapar a nadie: si tapara,
	# una escuadra en fila india se cegaría a sí misma.
	var companion_body := AABB(Vector3(-0.5, 0.0, -4.2), Vector3(1.0, 2.0, 0.4))
	world.add_box(companion_body, 4)  # capa 3 -> bit 4
	var targets: Array[VisionSensor.Target] = [_target_at(Vector3(0.0, 0.0, -8.0))]
	assert_true(_run_ticks(targets, 10).sightings[0].detected, "un cuerpo aliado no es una pared")

	# La misma caja en la capa del mundo sí tapa.
	sensor.reset()
	world.clear_geometry()
	world.add_box(companion_body, 1)
	assert_false(
		_run_ticks(targets, 10).sightings[0].detected,
		"y la misma geometría en la capa 'world' sí"
	)
	assert_eq(sensor.occluder_mask, VisionSensor.OCCLUDER_MASK, "la máscara es la del mundo")


# --- Conciencia de proximidad -------------------------------------------

func test_by_default_nobody_senses_what_is_outside_the_cone() -> void:
	# El valor por defecto de un dato que no ha llegado no puede ser el
	# permisivo: un perfil sin configurar NO regala percepción a la espalda.
	assert_almost_eq(PerceptionProfile.new().proximity_awareness_m, 0.0, 0.0001,
		"sin configurar, el radio de proximidad debe ser cero")
	var behind := Vector3(2.0, 0.0, 2.0)  # ~135° respecto a -Z
	assert_eq(int(VisionSensor.cone_for(Vector3.ZERO, Vector3.FORWARD, behind, stats, profile)),
		int(VisionSensor.Cone.NONE), "fuera del cono y sin proximidad no se ve")


func test_someone_standing_next_to_you_is_noticed_whatever_the_cone() -> void:
	# Cuatro enemigos se pasaron treinta segundos de partida a entre 0,7 y 6,6 m
	# del jugador sin enterarse, porque el ángulo era de 81°–119° y su cono
	# periférico mide 65°. Geométricamente correcto y absurdo: nadie pasa al
	# lado de otra persona a dos metros sin notarlo.
	profile.proximity_awareness_m = 3.5
	var beside := Vector3(2.0, 0.0, 0.0)          # 90°, a un lado
	var behind := Vector3(0.0, 0.0, 2.0)          # 180°, a la espalda
	for position: Vector3 in [beside, behind]:
		assert_eq(int(VisionSensor.cone_for(Vector3.ZERO, Vector3.FORWARD, position, stats, profile)),
			int(VisionSensor.Cone.PRIMARY),
			"a %.1f m se nota a alguien esté donde esté" % position.length())


func test_proximity_does_not_reach_further_than_its_radius() -> void:
	profile.proximity_awareness_m = 3.5
	var far_behind := Vector3(0.0, 0.0, 5.0)
	assert_eq(int(VisionSensor.cone_for(Vector3.ZERO, Vector3.FORWARD, far_behind, stats, profile)),
		int(VisionSensor.Cone.NONE), "más allá del radio manda el cono")


func test_proximity_still_needs_a_clear_line_of_sight() -> void:
	# Es conciencia, no rayos X: una pared en medio sigue tapando. Si esto
	# fallara, volveríamos exactamente al bug del legacy.
	profile.proximity_awareness_m = 3.5
	# Una pared entre el bot y quien tiene detrás.
	world.add_wall(Vector3(-6.0, 0.0, 1.0), Vector3(6.0, 0.0, 1.0))
	var targets: Array[VisionSensor.Target] = [_target_at(Vector3(0.0, 0.0, 2.0))]
	var result := sensor.evaluate(Vector3.ZERO, Vector3.FORWARD, stats, targets, world, 0.1, 8)
	assert_size(result.sightings, 1, "el objetivo entra en la evaluación")
	if result.sightings.size() == 1:
		assert_false(result.sightings[0].visible,
			"con la pared en medio, la proximidad no puede verlo")


func test_a_closed_door_blocks_vision_like_any_other_wall() -> void:
	# El bug del legacy, otra vez, por otra puerta: la máscara de oclusión de
	# la vista solo miraba la capa "world", así que una puerta CERRADA no
	# tapaba. Medido en partida: un bot a 2,9 m «veía» al jugador al otro lado
	# de `Door_3`, decidía ATTACK y disparaba — y sus balas se comían la puerta,
	# porque el arma sí la tiene en su máscara. 41 disparos, 0 impactos.
	#
	# Una puerta abierta desactiva su colisionador (`door.gd`), así que basta
	# con incluir su capa: cerrada tapa, abierta no.
	assert_eq(VisionSensor.OCCLUDER_MASK & 64, 64,
		"la capa de puertas (64) tiene que tapar la vista")
	assert_eq(VisionSensor.OCCLUDER_MASK, WeaponSystem.LOS_MASK,
		"lo que tapa la vista y lo que para una bala deben ser lo mismo")

	world.add_box(AABB(Vector3(-2.0, 0.0, -4.2), Vector3(4.0, 2.2, 0.4)), 64)
	var targets: Array[VisionSensor.Target] = [_target_at(Vector3(0.0, 0.0, -8.0))]
	var result := sensor.evaluate(Vector3.ZERO, Vector3.FORWARD, stats, targets, world, 0.1, 8)
	assert_size(result.sightings, 1, "el objetivo entra en la evaluación")
	if result.sightings.size() == 1:
		assert_false(result.sightings[0].visible,
			"con la puerta cerrada en medio no se puede ver a nadie")
