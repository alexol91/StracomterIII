extends TestCase
## Curva de tensión: ascenso -> pico -> alivio -> descanso.


func _profile() -> DirectorProfile:
	var profile := DirectorProfile.new()
	profile.phase_budget_fractions = PackedFloat32Array([0.45, 0.45, 0.10])
	profile.relief_duration_s = 15.0
	profile.rest_duration_s = 30.0
	return profile


func _composition(thugs: int, militia: int, veterans: int) -> EncounterComposer.Composition:
	var composition := EncounterComposer.Composition.new()
	composition.counts = [thugs, militia, veterans]
	composition.max_enemies = thugs + militia + veterans
	return composition


## Simula un encuentro con el jugador matando todo al instante. Devuelve la
## secuencia de fases visitadas y las oleadas liberadas.
func _simulate(curve: TensionCurve, steps: int) -> Dictionary:
	var phases: Array[String] = [TensionCurve.phase_name(curve.phase())]
	var waves: Array[TensionCurve.Wave] = []
	for _step: int in steps:
		var phase := curve.advance(1.0, 0)
		var name := TensionCurve.phase_name(phase)
		if phases[phases.size() - 1] != name:
			phases.append(name)
		var wave := curve.take_wave(0)
		if wave != null:
			waves.append(wave)
	return {"phases": phases, "waves": waves}


## El plan reparte la composición ENTERA: ni se pierde ni se inventa un
## enemigo por redondeo.
func test_plan_preserves_the_whole_composition() -> void:
	var curve := TensionCurve.new(_profile())
	for counts: Array in [[10, 11, 8], [1, 0, 0], [7, 7, 7], [0, 0, 0], [29, 3, 1]]:
		var composition := _composition(counts[0], counts[1], counts[2])
		var waves := curve.plan(composition)
		var totals: Array[int] = [0, 0, 0]
		for wave: TensionCurve.Wave in waves:
			for index: int in 3:
				totals[index] += wave.counts[index]
		assert_eq(totals, composition.counts, "reparto exacto de %s" % str(counts))


## Las cuatro fases se recorren en orden y el encuentro termina.
func test_phases_run_in_order_and_finish() -> void:
	var curve := TensionCurve.new(_profile())
	curve.plan(_composition(10, 11, 8))
	curve.begin()
	var run := _simulate(curve, 200)
	var phases: Array = run["phases"]
	assert_eq(phases, ["RISE", "PEAK", "RELIEF", "REST", "DONE"] as Array,
		"secuencia de fases del GDD §7")
	assert_true(curve.is_finished(), "el encuentro termina")
	assert_eq(curve.pending_wave_count(), 0, "no quedan oleadas pendientes")


## El descanso es SILENCIO FORZADO: durante REST no sale ni un enemigo.
func test_rest_phase_spawns_nothing() -> void:
	var curve := TensionCurve.new(_profile())
	curve.plan(_composition(10, 11, 8))
	curve.begin()
	# Se avanza hasta el descanso.
	var guard: int = 0
	while curve.phase() != TensionCurve.Phase.REST and guard < 500:
		guard += 1
		curve.advance(1.0, 0)
		curve.take_wave(0)
	assert_eq(TensionCurve.phase_name(curve.phase()), "REST", "se alcanza el descanso")
	for _step: int in 20:
		curve.advance(1.0, 0)
		assert_null(curve.take_wave(0), "durante el descanso no se genera nada")


## El silencio dura lo que dice el GDD: entre 20 y 40 s, aunque el perfil
## traiga otra cosa.
func test_rest_duration_is_clamped_to_the_design_range() -> void:
	var profile := _profile()
	profile.rest_duration_s = 5.0
	assert_almost_eq(TensionCurve.new(profile).rest_duration_s(),
		TensionCurve.REST_DURATION_MIN_S, 0.0001, "un descanso demasiado corto se sube")
	profile.rest_duration_s = 300.0
	assert_almost_eq(TensionCurve.new(profile).rest_duration_s(),
		TensionCurve.REST_DURATION_MAX_S, 0.0001, "uno demasiado largo se recorta")
	profile.rest_duration_s = 30.0
	assert_almost_eq(TensionCurve.new(profile).rest_duration_s(), 30.0, 0.0001,
		"el valor del perfil se respeta si está en rango")


## El pico gasta más de una vez lo de una oleada de ascenso: es un pico, no
## un escalón más.
func test_peak_is_the_biggest_single_wave() -> void:
	var curve := TensionCurve.new(_profile())
	curve.plan(_composition(12, 12, 12))
	var biggest_rise: int = 0
	var peak: int = 0
	for wave: TensionCurve.Wave in curve.waves():
		if wave.phase == TensionCurve.Phase.RISE:
			biggest_rise = maxi(biggest_rise, wave.total())
		elif wave.phase == TensionCurve.Phase.PEAK:
			peak += wave.total()
	assert_gt(float(peak), float(biggest_rise), "el pico es mayor que cualquier oleada de ascenso")


## Reparto por mayor resto: exacto y determinista.
func test_largest_remainder_is_exact() -> void:
	var fractions: Array[float] = [0.45, 0.45, 0.10]
	for total: int in [0, 1, 2, 3, 7, 10, 29, 100]:
		var parts := TensionCurve.largest_remainder(total, fractions)
		var sum: int = 0
		for value: int in parts:
			sum += value
		assert_eq(sum, total, "reparto exacto de %d" % total)
		for value: int in parts:
			assert_gt(float(value) + 0.5, 0.0, "ninguna parte negativa")


## Las fracciones se normalizan aunque el perfil no sume 1.
func test_phase_fractions_are_normalized() -> void:
	var profile := _profile()
	profile.phase_budget_fractions = PackedFloat32Array([2.0, 2.0, 1.0])
	var curve := TensionCurve.new(profile)
	var fractions := curve.phase_fractions()
	assert_almost_eq(fractions[0] + fractions[1] + fractions[2], 1.0, 0.000001, "suman uno")
	assert_almost_eq(fractions[0], 0.4, 0.000001, "proporción conservada")


## Determinismo: el mismo plan y la misma simulación, cien veces.
func test_curve_is_deterministic() -> void:
	var reference: String = ""
	for run: int in 100:
		var curve := TensionCurve.new(_profile())
		curve.plan(_composition(10, 11, 8))
		curve.begin()
		var result := _simulate(curve, 200)
		var waves: Array = result["waves"]
		var signature: Array[String] = []
		for wave: TensionCurve.Wave in waves:
			signature.append(wave.describe())
		var text := "|".join(signature) + "//" + str(result["phases"])
		if run == 0:
			reference = text
		assert_eq(text, reference, "misma secuencia de oleadas en la iteración %d" % run)
