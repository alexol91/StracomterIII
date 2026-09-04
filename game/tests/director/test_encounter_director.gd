extends TestCase
## El director completo: contexto -> presupuesto -> composición -> oleadas ->
## apariciones. Incluye la prueba de DETERMINISMO de extremo a extremo, que
## es la que hace reproducible un fallo de balanceo.
##
## El director es un `Node` pero aquí no entra al árbol: se construye, se le
## inyecta el proveedor y se le llama a `tick` a mano. Que eso sea posible es
## el objetivo de diseño, no una comodidad del test.


## Proveedor de prueba: una rejilla de puntos justos alrededor del jugador.
class GridProvider:
	extends SpawnPointProvider

	var requests_served: int = 0

	func sample_candidates(request: SpawnPointProvider.SpawnRequest) -> Array[SpawnPointProvider.SpawnCandidate]:
		requests_served += 1
		var out: Array[SpawnPointProvider.SpawnCandidate] = []
		for index: int in 40:
			var angle := TAU * float(index) / 40.0
			# Todos a la espalda del jugador y a 20 m: justos por construcción.
			var position := Vector3(sin(angle) * 20.0, 0.0, absf(cos(angle)) * 20.0 + 5.0)
			var candidate := SpawnPointProvider.SpawnCandidate.new(position)
			candidate.navigable = true
			candidate.has_line_of_sight_to_player = false
			candidate.path_distance_m = position.length() * 1.4
			candidate.is_entry_point = index % 8 == 0
			out.append(candidate)
		return out

	func is_ready() -> bool:
		return true


func _context(seed_value: int) -> EncounterContext:
	var context := EncounterContext.new()
	context.floor_number = 4
	context.zone = 2
	context.navigable_area_m2 = 2000.0
	context.floor_difficulty = 2.1
	context.skill_multiplier = 1.0
	context.mean_line_of_sight_m = 18.0
	context.cover_points_per_100m2 = 4.0
	context.entry_count = 3
	context.allowed_archetypes = [&"enemy_thug", &"enemy_militiaman", &"enemy_veteran"]
	context.seed = seed_value
	return context


## Simula una zona completa y devuelve la firma de todo lo que ocurrió.
func _run_zone(seed_value: int) -> Dictionary:
	var director := EncounterDirector.new()
	director.configure(GridProvider.new())
	director.reseed(seed_value)
	director.set_player_pose(Vector3.ZERO, Vector3(0.0, 0.0, -1.0))

	var spawned: Array[String] = []
	var phases: Array[String] = []
	director.enemy_requested.connect(
		func(archetype: StringName, position: Vector3) -> void:
			spawned.append("%s@%.3f,%.3f" % [archetype, position.x, position.z])
	)
	director.phase_changed.connect(
		func(_previous: TensionCurve.Phase, current: TensionCurve.Phase) -> void:
			phases.append(TensionCurve.phase_name(current))
	)

	var composition := director.begin_zone(_context(seed_value))
	var identifier: int = 1
	for _step: int in 300:
		# El jugador limpia todo al instante: los enemigos generados mueren.
		director.tick(1.0)
		while director.hostiles_alive() > 0:
			director.report_enemy_spawned(identifier)
			identifier += 1
			break
	var result := {
		"counts": composition.counts.duplicate(),
		"spawned": spawned,
		"phases": phases,
		"finished": director.is_active(),
	}
	director.free()
	return result


## La cadena completa produce enemigos y termina.
func test_full_zone_runs_and_finishes() -> void:
	var run := _run_zone(20120611)
	var counts: Array = run["counts"]
	var spawned: Array = run["spawned"]
	var phases: Array = run["phases"]
	assert_gt(float(counts[0] + counts[1] + counts[2]), 0.0, "la zona tiene composición")
	assert_gt(float(spawned.size()), 0.0, "se pidieron enemigos")
	assert_eq(phases, ["PEAK", "RELIEF", "REST", "DONE"] as Array,
		"se recorren las fases hasta el final")
	assert_false(run["finished"], "el director se desactiva al terminar")


## Se pide exactamente la composición decidida, ni un enemigo más.
func test_spawn_requests_match_the_composition() -> void:
	var run := _run_zone(99)
	var counts: Array = run["counts"]
	var spawned: Array = run["spawned"]
	var expected := int(counts[0]) + int(counts[1]) + int(counts[2])
	assert_eq(spawned.size(), expected,
		"se pide un enemigo por cada uno de la composición")
	var thugs: int = 0
	for entry: String in spawned:
		if entry.begins_with("enemy_thug"):
			thugs += 1
	assert_eq(thugs, int(counts[0]), "y el reparto por arquetipo se respeta")


## DETERMINISMO DE EXTREMO A EXTREMO: la misma semilla y las mismas entradas
## producen la misma composición, las mismas oleadas y los mismos puntos de
## aparición. Cien veces.
func test_same_seed_produces_the_same_zone_one_hundred_times() -> void:
	var reference := _run_zone(20120611)
	for run: int in 100:
		var other := _run_zone(20120611)
		assert_eq(other["counts"], reference["counts"], "misma composición (%d)" % run)
		assert_eq(other["spawned"], reference["spawned"], "mismas apariciones (%d)" % run)
		assert_eq(other["phases"], reference["phases"], "mismas fases (%d)" % run)


## Semillas distintas mueven las apariciones, no la composición: el azar del
## director está en el DÓNDE, no en el cuánto ni en el cuándo.
func test_seed_changes_placement_not_composition() -> void:
	var first := _run_zone(1)
	var second := _run_zone(2)
	# La semilla solo entra en la composición para deshacer empates exactos
	# de puntuación; con contextos normales no los hay y la composición la
	# decide el contexto.
	assert_eq(first["counts"], second["counts"],
		"la composición la decide el contexto, no la semilla")
	assert_ne(first["spawned"], second["spawned"], "las apariciones sí")


## Sin proveedor de puntos no se genera nada: más vale una zona vacía que
## enemigos apareciendo en el aire.
func test_without_a_provider_nothing_is_spawned() -> void:
	var director := EncounterDirector.new()
	director.reseed(5)
	var spawned: int = 0
	director.enemy_requested.connect(
		func(_archetype: StringName, _position: Vector3) -> void:
			spawned += 1
	)
	director.begin_zone(_context(5))
	for _step: int in 60:
		director.tick(1.0)
	assert_eq(spawned, 0, "sin proveedor no hay apariciones")
	director.free()


## Los comandos de consola responden y no revientan sin zona en curso.
func test_console_commands_answer() -> void:
	var director := EncounterDirector.new()
	director.reseed(3)
	director.register_console_commands()
	assert_true(DevConsole.has_command("director.status"), "director.status registrado")
	assert_true(DevConsole.has_command("director.budget"), "director.budget registrado")
	assert_true(DevConsole.has_command("director.compose"), "director.compose registrado")
	assert_true(DevConsole.has_command("director.composer"), "director.composer registrado")

	var status := DevConsole.execute("director.status")
	assert_true(status.contains("Director"), "status responde")
	var budget := DevConsole.execute("director.budget")
	assert_true(budget.length() > 0, "budget responde aunque no haya zona")

	var compose := DevConsole.execute("director.compose 2000 2.1")
	assert_true(compose.contains("enemigos"), "compose responde con una composición")
	assert_true(compose.contains("variedad"), "y con el desglose de puntuación")
	assert_true(compose.contains("10."), "y con las diez mejores")

	var switched := DevConsole.execute("director.composer legacy")
	assert_true(switched.contains("LEGACY_SIMPLEX"), "se puede conmutar a Simplex")
	var legacy_output := DevConsole.execute("director.compose 2000 2.1")
	assert_true(legacy_output.contains("Simplex"), "y el modo se nota en la salida")
	DevConsole.execute("director.composer search")
	director.free()


## El director cuenta la presión viva a partir de lo que se le notifica.
func test_hostile_count_tracks_spawns_and_deaths() -> void:
	var director := EncounterDirector.new()
	director.reseed(1)
	director.begin_zone(_context(1))
	director.report_enemy_spawned(10)
	director.report_enemy_spawned(11)
	director.report_enemy_spawned(11)  # repetido: no cuenta dos veces
	assert_eq(director.hostiles_alive(), 2, "dos hostiles vivos")
	director._on_character_died(11, 1, 0, 5)
	assert_eq(director.hostiles_alive(), 1, "uno menos al morir")
	director._on_character_died(999, 1, 0, 5)
	assert_eq(director.hostiles_alive(), 1, "una muerte ajena no descuenta")
	director.free()
