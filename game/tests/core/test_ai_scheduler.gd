extends TestCase
## Pruebas del reparto de trabajo de IA (ADR-002).
##
## Existe sobre todo por una regresión concreta: la percepción se ejecutaba de
## golpe cada 100 ms sobre una lista ordenada por prioridad y con techo de rayos
## por frame, así que los mismos bots de mayor prioridad se llevaban todo el
## presupuesto y **el resto no percibía nunca**. Un techo de rayos por frame se
## puede cumplir perfectamente mientras la mitad de la escena está ciega: por eso
## medir solo el techo no basta, y hay que medir la equidad.

## Cliente de prueba que solo cuenta cuántas veces se le atiende.
class SpyClient:
	extends AIScheduler.Client

	var perception_ticks: int = 0
	var decision_ticks: int = 0
	var behavior_ticks: int = 0
	var accumulated_delta: float = 0.0
	## Rayos que declara consumir cada tick, como haría un PerceptionSystem real.
	var raycast_cost: int = 3

	func tick_perception(delta: float) -> int:
		perception_ticks += 1
		accumulated_delta += delta
		return raycast_cost

	func tick_decision(_delta: float) -> void:
		decision_ticks += 1

	func tick_behavior(_delta: float) -> void:
		behavior_ticks += 1


const FRAME: float = 1.0 / 60.0

var _clients: Array[SpyClient] = []


func before_each() -> void:
	AIScheduler.clear()
	_clients.clear()


func after_each() -> void:
	AIScheduler.clear()
	_clients.clear()


## Registra `count` clientes repartidos en un radio pequeño alrededor del foco,
## para que ninguno entre en degradación por lejanía.
func _spawn_nearby(count: int) -> void:
	AIScheduler.set_focus(Vector3.ZERO)
	for i: int in range(count):
		var c := SpyClient.new()
		var angle := TAU * float(i) / float(count)
		c.world_position = Vector3(cos(angle), 0.0, sin(angle)) * 10.0
		c.on_screen = false
		_clients.append(c)
		AIScheduler.register(c)


func _simulate_frames(frames: int) -> void:
	for _i: int in range(frames):
		AIScheduler._process(FRAME)


func test_every_registered_client_perceives_no_client_starves() -> void:
	# La regresión: con 40 bots a 3 rayos cada uno hacen falta 120 rayos por
	# ciclo y el techo es de 48 por frame. Repartiendo entre frames todos llegan;
	# en ráfaga, solo los 16 primeros, siempre los mismos.
	_spawn_nearby(40)
	_simulate_frames(60)  # 1 segundo

	var starved := 0
	for c: SpyClient in _clients:
		if c.perception_ticks == 0:
			starved += 1
	assert_eq(starved, 0, "hay %d bots que no percibieron ni una vez en 1 s" % starved)


func test_perception_load_is_shared_not_hoarded() -> void:
	# Nadie debe quedarse muy por detrás del resto: el techo por frame ha de
	# introducir retraso, no hambre.
	_spawn_nearby(40)
	_simulate_frames(120)  # 2 segundos

	var fewest := 1 << 30
	var most := 0
	for c: SpyClient in _clients:
		fewest = mini(fewest, c.perception_ticks)
		most = maxi(most, c.perception_ticks)
	assert_gt(float(fewest), 0.0, "algún cliente no percibió nunca")
	# Con reparto equitativo la diferencia es de un turno, no de un orden de magnitud.
	assert_lt(float(most - fewest), 3.0,
		"reparto desigual: el más atendido %d ticks, el menos %d" % [most, fewest])


func test_raycast_ceiling_is_never_exceeded_in_a_frame() -> void:
	_spawn_nearby(40)
	for _i: int in range(120):
		AIScheduler._process(FRAME)
		assert_lt(float(AIScheduler.stat_raycasts_last_frame),
			float(AIScheduler.MAX_RAYCASTS_PER_FRAME) + 1.0,
			"se superó el techo de rayos por frame")


func test_perception_frequency_is_close_to_the_target_hz() -> void:
	# 10 Hz durante 1 s ⇒ unos 10 ticks por cliente. Se admite holgura porque el
	# techo de rayos puede retrasar algún turno.
	_spawn_nearby(8)
	_simulate_frames(60)
	for c: SpyClient in _clients:
		assert_between(float(c.perception_ticks), 8.0, 12.0,
			"frecuencia de percepción fuera de objetivo")


func test_far_offscreen_clients_are_degraded_not_silenced() -> void:
	# Un bot lejano y fuera de cámara piensa menos veces, pero nunca deja de
	# pensar: la degradación es de frecuencia, no de existencia.
	AIScheduler.set_focus(Vector3.ZERO)
	var near := SpyClient.new()
	near.world_position = Vector3(5.0, 0.0, 0.0)
	var far := SpyClient.new()
	far.world_position = Vector3(0.0, 0.0, 200.0)
	AIScheduler.register(near)
	AIScheduler.register(far)
	_clients.append(near)
	_clients.append(far)

	_simulate_frames(120)  # 2 segundos

	assert_gt(float(far.perception_ticks), 0.0, "el bot lejano quedó silenciado")
	assert_gt(float(near.perception_ticks), float(far.perception_ticks),
		"el bot cercano debe percibir más a menudo que el lejano")


func test_elapsed_delta_reflects_real_time_not_nominal_period() -> void:
	# Si el techo de rayos retrasa a un cliente, su memoria debe decaer por el
	# tiempo que de verdad ha pasado. Con 1 s simulado, el delta acumulado de
	# cada cliente debe acercarse a 1 s.
	_spawn_nearby(20)
	_simulate_frames(60)
	for c: SpyClient in _clients:
		assert_between(c.accumulated_delta, 0.8, 1.2,
			"el delta acumulado no corresponde al tiempo real transcurrido")


func test_path_request_budget_is_enforced_per_frame() -> void:
	AIScheduler.clear()
	AIScheduler._process(FRAME)
	var granted := 0
	for _i: int in range(20):
		if AIScheduler.try_consume_path_request():
			granted += 1
	assert_eq(granted, AIScheduler.MAX_PATH_REQUESTS_PER_FRAME,
		"el presupuesto de peticiones de camino no se respeta")
