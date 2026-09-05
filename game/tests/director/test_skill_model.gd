extends TestCase
## Modelo de habilidad (DDA).
##
## El test que manda es `test_playing_worse_never_raises_the_budget`: es un
## invariante, no una preferencia. Un DDA que sube la dificultad cuando el
## jugador lo está pasando mal no es difícil, es hostil.


func _profile() -> DirectorProfile:
	var profile := DirectorProfile.new()
	profile.skill_window = 8
	profile.skill_multiplier_min = 0.65
	profile.skill_multiplier_max = 1.75
	profile.weight_accuracy = 0.30
	profile.weight_damage_taken = 0.30
	profile.weight_clear_time = 0.20
	profile.weight_squad_losses = 0.10
	profile.weight_cover_usage = 0.10
	return profile


func _sample(
	accuracy: float,
	damage_per_minute: float,
	clear_time_s: float,
	losses: int,
	cover: float
) -> SkillModel.EncounterSample:
	var sample := SkillModel.EncounterSample.new()
	sample.accuracy = accuracy
	sample.damage_taken_per_minute = damage_per_minute
	sample.clear_time_s = clear_time_s
	sample.expected_clear_time_s = 60.0
	sample.squad_losses = losses
	sample.squad_size = 3
	sample.cover_usage = cover
	return sample


func _average_sample() -> SkillModel.EncounterSample:
	return _sample(0.5, 30.0, 60.0, 1, 0.22)


## Sin muestras el modelo no opina: multiplicador 1,0 exacto, la dificultad
## es la de la planta.
func test_neutral_player_scores_exactly_one() -> void:
	var model := SkillModel.new(_profile())
	assert_eq(model.sample_count(), 0, "sin muestras")
	assert_almost_eq(model.skill_multiplier(), 1.0, 0.000001, "multiplicador neutro")
	assert_almost_eq(model.current_score(), 0.5, 0.000001, "puntuación neutra")


## Los extremos llegan a los topes del perfil y no los pasan.
func test_output_is_clamped_to_the_profile_range() -> void:
	var profile := _profile()
	var ace := SkillModel.new(profile)
	ace.push_sample(_sample(1.0, 0.0, 0.0, 0, 1.0))
	assert_almost_eq(ace.skill_multiplier(), profile.skill_multiplier_max, 0.000001,
		"el jugador perfecto llega al máximo")

	var novice := SkillModel.new(profile)
	novice.push_sample(_sample(0.0, 500.0, 600.0, 3, 0.0))
	assert_almost_eq(novice.skill_multiplier(), profile.skill_multiplier_min, 0.000001,
		"el jugador que lo pasa mal llega al mínimo")

	for score: float in [-1.0, 0.0, 0.25, 0.5, 0.75, 1.0, 2.0]:
		var value := SkillModel.multiplier_for_score(score, profile)
		assert_between(value, profile.skill_multiplier_min, profile.skill_multiplier_max,
			"puntuación %.2f dentro del rango" % score)


## INVARIANTE: degradar CUALQUIER señal nunca sube el multiplicador.
func test_playing_worse_never_raises_the_budget() -> void:
	var profile := _profile()
	var base := _average_sample()
	var base_multiplier := SkillModel.multiplier_for_score(
		SkillModel.score_of(base, profile), profile)

	# Cada variante empeora UNA señal y deja las demás igual.
	var worse: Array[SkillModel.EncounterSample] = [
		_sample(0.2, 30.0, 60.0, 1, 0.22),    # menos precisión
		_sample(0.5, 90.0, 60.0, 1, 0.22),    # más daño recibido
		_sample(0.5, 30.0, 180.0, 1, 0.22),   # tarda más en limpiar
		_sample(0.5, 30.0, 60.0, 3, 0.22),    # más bajas de escuadra
		_sample(0.5, 30.0, 60.0, 1, 0.0),     # no usa cobertura
	]
	var labels: Array[String] = [
		"precisión", "daño recibido", "tiempo de limpieza", "bajas", "cobertura",
	]
	for index: int in worse.size():
		var multiplier := SkillModel.multiplier_for_score(
			SkillModel.score_of(worse[index], profile), profile)
		assert_lt(multiplier, base_multiplier + 0.000001,
			"empeorar en %s no sube la amenaza" % labels[index])
		assert_lt(multiplier, base_multiplier,
			"empeorar en %s la baja de verdad" % labels[index])


## El invariante también aguanta con muestras aleatorias: si un jugador es
## peor o igual en TODAS las señales, su multiplicador nunca es mayor.
func test_dominated_play_never_scores_higher() -> void:
	var profile := _profile()
	var rng := RandomNumberGenerator.new()
	rng.seed = 20120611  # la semilla es fija: un fuzz no determinista no es un test
	for _case: int in 300:
		var good := _sample(
			rng.randf_range(0.3, 1.0),
			rng.randf_range(0.0, 40.0),
			rng.randf_range(10.0, 60.0),
			rng.randi_range(0, 1),
			rng.randf_range(0.3, 1.0)
		)
		# Peor o igual en las cinco señales, por construcción.
		var bad := _sample(
			good.accuracy * rng.randf_range(0.0, 1.0),
			good.damage_taken_per_minute + rng.randf_range(0.0, 60.0),
			good.clear_time_s + rng.randf_range(0.0, 120.0),
			good.squad_losses + rng.randi_range(0, 2),
			good.cover_usage * rng.randf_range(0.0, 1.0)
		)
		var good_score := SkillModel.score_of(good, profile)
		var bad_score := SkillModel.score_of(bad, profile)
		assert_lt(bad_score, good_score + 0.000001, "el juego dominado nunca puntúa más")


## Y aguanta sobre la VENTANA completa, que es lo que consume el director.
func test_worse_window_never_raises_the_multiplier() -> void:
	var profile := _profile()
	var good := SkillModel.new(profile)
	var bad := SkillModel.new(profile)
	for _i: int in profile.skill_window:
		good.push_sample(_sample(0.7, 15.0, 40.0, 0, 0.5))
		bad.push_sample(_sample(0.4, 45.0, 90.0, 2, 0.1))
	assert_lt(bad.skill_multiplier(), good.skill_multiplier(),
		"una racha peor da menos amenaza")
	assert_lt(bad.current_score(), good.current_score(), "y menos puntuación")


## La ventana es móvil: solo cuentan los últimos `skill_window` encuentros.
func test_window_is_a_moving_average() -> void:
	var profile := _profile()
	profile.skill_window = 3
	var model := SkillModel.new(profile)
	for _i: int in 5:
		model.push_sample(_sample(0.0, 300.0, 300.0, 3, 0.0))
	assert_eq(model.sample_count(), 3, "la ventana no crece más allá de su tamaño")
	var floor_multiplier := model.skill_multiplier()
	for _i: int in 3:
		model.push_sample(_sample(1.0, 0.0, 5.0, 0, 1.0))
	assert_eq(model.sample_count(), 3, "sigue siendo de tres")
	assert_gt(model.skill_multiplier(), floor_multiplier,
		"tres encuentros buenos borran a los malos que salieron de la ventana")


## El tiempo esperado crece con el tamaño del encuentro: limpiar 30 enemigos
## no puede compararse con limpiar 5.
func test_expected_clear_time_grows_with_the_encounter() -> void:
	var profile := _profile()
	assert_gt(SkillModel.expected_clear_time_s(30, profile),
		SkillModel.expected_clear_time_s(5, profile), "más enemigos, más tiempo esperado")
	assert_almost_eq(SkillModel.expected_clear_time_s(0, profile),
		profile.expected_clear_time_base_s, 0.0001, "encuentro vacío")


## Ciclo completo sin bus: empezar, acumular, cerrar.
func test_encounter_cycle_builds_a_sample() -> void:
	var model := SkillModel.new(_profile())
	model.begin_encounter(10, 3)
	for _i: int in 30:
		model.tick(1.0, true)   # 30 s a cubierto
	for _i: int in 30:
		model.tick(1.0, false)  # 30 s a pecho descubierto
	model.end_encounter()
	assert_eq(model.sample_count(), 1, "el encuentro se cierra en una muestra")
	assert_almost_eq(model.observed_median_clear_time_s(), 60.0, 0.001,
		"la mediana observada registra el tiempo real")
	assert_between(model.skill_multiplier(), 0.65, 1.75, "multiplicador en rango")


## La mediana observada es DIAGNÓSTICO y no entra en la puntuación: si
## entrase, tardar más subiría la referencia y jugar peor acabaría dando más
## amenaza. Es la desviación consciente respecto al GDD §7.
func test_observed_median_does_not_feed_the_score() -> void:
	var profile := _profile()
	var model := SkillModel.new(profile)
	var fast := _sample(0.5, 30.0, 30.0, 1, 0.22)
	model.push_sample(fast)
	var score_after_fast := model.current_score()

	var slow_model := SkillModel.new(profile)
	var slow := _sample(0.5, 30.0, 30.0, 1, 0.22)
	# Historial lentísimo: subiría la mediana observada, pero no la puntuación.
	for _i: int in 5:
		slow_model.push_sample(_sample(0.5, 30.0, 600.0, 1, 0.22))
	slow_model.reset()
	slow_model.push_sample(slow)
	assert_almost_eq(slow_model.current_score(), score_after_fast, 0.000001,
		"el mismo encuentro puntúa igual con o sin historial lento")


func test_damage_reaches_the_model_through_the_real_signal() -> void:
	# La prueba que faltaba: las demás llaman al manejador a mano, y por eso
	# nadie vio que su FIRMA no encajaba con la señal. `character_damaged`
	# lleva cinco parámetros y el manejador se quedó con tres cuando la señal
	# creció; Godot no protesta al conectar, protesta al EMITIR, por consola.
	#
	# Consecuencia: el modelo no contaba ni un punto de daño recibido, el
	# jugador le parecía invencible y el director subía la dificultad. Todo
	# ello sin una sola prueba en rojo.
	var model := SkillModel.new()
	model.player_id = 4242
	model.connect_event_bus()
	model.begin_encounter(5)

	EventBus.character_damaged.emit(4242, 30.0, Vector3.ZERO, 7, 2)
	EventBus.character_damaged.emit(9999, 90.0, Vector3.ZERO, 7, 2)  # otro personaje

	assert_almost_eq(model.damage_taken(), 30.0, 0.001,
		"el daño del jugador tiene que llegar por la señal, no solo a mano")
	model.disconnect_event_bus()
