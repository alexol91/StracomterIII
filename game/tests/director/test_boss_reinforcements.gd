extends TestCase
## Los refuerzos de un jefe al cambiar de fase (GDD §5: el MegaBoss es «Fases +
## refuerzos»).
##
## Las fases ya desplazaban las ganancias —un MiniBoss herido deja de guardar la
## puerta y carga— pero el jefe se quedaba SOLO: la escalada de un combate final
## era el jefe pegando más fuerte y nada más. Faltaba el aviso: nadie publicaba
## el cambio de fase, así que el director no podía reaccionar aunque quisiera.
##
## Aquí se prueban las tres piezas por separado, que es lo que permite que dos
## de las tres sean puras: la señal del controlador, la noticia global del
## cerebro y los números en datos. Que la tropa aparezca de verdad en la planta
## lo comprueba la sonda de combate, no una prueba síncrona.


func test_the_controller_announces_the_phase_change() -> void:
	var state := BehaviorTestUtil.make_state({"archetype": &"miniboss", "health_ratio": 1.0})
	var board := BehaviorTestUtil.make_board()
	var ctx := BehaviorTestUtil.make_context(
		state, BehaviorTestUtil.open_world(), BehaviorTestUtil.empty_cover(),
		BehaviorTestUtil.make_actuator(), board)
	var weights := UtilityWeights.for_archetype(&"miniboss", 1.0)
	var controller := BehaviorTestUtil.make_controller(state, ctx, weights, board)
	controller.configure_archetype(&"miniboss")

	# La lambda captura por VALOR: el contador tiene que ser un contenedor o
	# siempre da cero y la prueba acusa al código en vez de a sí misma.
	var seen: Array[int] = []
	controller.phase_changed.connect(
		func(_previous: int, current: int) -> void: seen.append(current))

	controller.tick_decision(0.2)
	assert_true(seen.is_empty(), "a vida llena no hay cambio de fase")

	# El umbral del MiniBoss es media vida.
	state.health_ratio = 0.4
	controller.tick_decision(0.2)
	assert_eq(seen.size(), 1, "cruzar el umbral tiene que anunciarse una vez")
	if not seen.is_empty():
		assert_eq(seen[0], 1, "la fase a la que entra es la 1")

	# Y no se repite mientras siga en la misma fase: un aviso por cruce.
	controller.tick_decision(0.2)
	assert_eq(seen.size(), 1, "el aviso no se repite dentro de la misma fase")
	board.free()


func test_a_regular_enemy_never_changes_phase() -> void:
	# `boss_phase` no tiene umbrales para la tropa. Si los tuviera, un sicario
	# a media vida traería refuerzos y el ritmo de la zona se iría al garete.
	var state := BehaviorTestUtil.make_state(
		{"archetype": &"enemy_thug", "health_ratio": 0.05})
	var board := BehaviorTestUtil.make_board()
	var ctx := BehaviorTestUtil.make_context(
		state, BehaviorTestUtil.open_world(), BehaviorTestUtil.empty_cover(),
		BehaviorTestUtil.make_actuator(), board)
	var controller := BehaviorTestUtil.make_controller(
		state, ctx, UtilityWeights.for_archetype(&"enemy_thug", 0.05), board)
	controller.configure_archetype(&"enemy_thug")
	var seen: Array[int] = []
	controller.phase_changed.connect(
		func(_p: int, c: int) -> void: seen.append(c))
	controller.tick_decision(0.2)
	assert_true(seen.is_empty(), "la tropa no tiene fases")
	board.free()


func test_the_reinforcement_table_lives_in_data_and_has_no_phase_zero() -> void:
	var profile := Balance.director_profile()
	assert_not_null(profile, "el perfil del director tiene que cargar")
	if profile == null:
		return
	var table := profile.boss_reinforcements_per_phase
	assert_gt(table.size(), 1, "sin tabla, un cambio de fase no trae a nadie")
	assert_eq(table[0], 0,
		"a la fase 0 no se entra: se empieza en ella, así que no trae refuerzos")
	var total := 0
	for count: int in table:
		total += count
	assert_gt(total, 0, "una tabla toda a cero es no tener refuerzos")
	# El tope existe para que un perfil raro no invoque una horda: el
	# presupuesto del Simplex es para la tropa de la zona y esto va aparte.
	assert_true(total <= 12, "refuerzos de más anulan la cuenta del director: %d" % total)


func test_the_default_profile_summons_nobody() -> void:
	# El principio de los valores por defecto: un perfil que no declara la
	# tabla no invoca tropa de la nada.
	var fresh := DirectorProfile.new()
	assert_true(fresh.boss_reinforcements_per_phase.is_empty(),
		"ante la duda, no vienen refuerzos")


func test_the_phase_change_is_published_as_a_global_event() -> void:
	# La pieza que une las dos capas: la IA anuncia y el director escucha. Sin
	# esto, la señal del controlador se quedaría dentro de `ai/`.
	var received: Array[int] = []
	var handler := func(_cid: int, archetype: StringName, _prev: int, current: int) -> void:
		if archetype == &"miniboss":
			received.append(current)
	EventBus.boss_phase_changed.connect(handler)

	var boss := Character.new()
	boss.archetype = &"miniboss"
	boss.team = Character.Team.ENEMY
	var tree := Engine.get_main_loop() as SceneTree
	var parent: Node = tree.current_scene if tree.current_scene != null else tree.root
	parent.add_child(boss)
	var brain := BotBrain.new()
	# Sin proveedor de objetivos: aquí no se mide percepción, solo el aviso de
	# fase, y un doble que devuelva objetivos sería un doble más amable que la
	# realidad para lo que esta prueba juzga.
	brain.setup(
		boss, BehaviorTestUtil.open_world(), BehaviorTestUtil.empty_cover(), Blackboard,
		func() -> Array: return [])
	brain.sync_from_body()
	brain.tick_decision(0.2)
	assert_true(received.is_empty(), "a vida llena, ningún aviso")

	boss.health = boss.stats.max_health * 0.3
	brain.sync_from_body()
	brain.tick_decision(0.2)
	assert_eq(received.size(), 1, "el cerebro tiene que publicar el cambio de fase")

	EventBus.boss_phase_changed.disconnect(handler)
	parent.remove_child(boss)
	boss.free()
