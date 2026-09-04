extends GameplayFixture
## Habilidades activas de clase (E-01) y auras pasivas de escuadra (paridad
## [P05]). Ninguna de las cuatro habilidades implementa la escuadra ni la
## navegación: solo se comprueba que emiten la señal/marca correcta.

func before_each() -> void:
	Blackboard.clear()


func test_ability_disables_itself_for_the_wrong_archetype() -> void:
	var technician := make_character(&"technician", Character.Team.PLAYER)
	var ability := AbilityCaptainOrders.new()
	ability.required_archetype = &"captain"
	technician.add_child(ability)
	assert_false(ability.is_physics_processing(),
		"la habilidad de otra clase debe autodesactivarse, no dispararse por error")


func test_captain_orders_marks_hostile_target_in_sight() -> void:
	var captain := make_character(&"captain", Character.Team.PLAYER)
	var enemy := make_character(&"enemy_thug", Character.Team.ENEMY)
	enemy.global_position = Vector3(5, 0, 0)
	var ability := AbilityCaptainOrders.new()
	captain.add_child(ability)
	# Ver `WeaponSystem.raycast_override`: un cuerpo recién creado no es
	# consultable por raycast real dentro del mismo tick de física.
	ability.raycast_override = func(_f: Vector3, _t: Vector3, _m: int) -> Dictionary:
		return {"collider": enemy}

	var received: Array = []
	ability.target_marked.connect(func(pos: Vector3, id: int) -> void: received.append([pos, id]))
	captain.intent_look_at = enemy.eye_position()
	captain.use_ability()
	ability._physics_process(0.016)

	assert_size(received, 1, "Órdenes debe marcar exactamente un objetivo")
	assert_eq(received[0][1], enemy.get_instance_id(), "el objetivo marcado es el enemigo apuntado")


func test_captain_orders_does_not_mark_allies() -> void:
	var captain := make_character(&"captain", Character.Team.PLAYER)
	var companion := make_character(&"technician", Character.Team.COMPANION)
	companion.global_position = Vector3(5, 0, 0)
	var ability := AbilityCaptainOrders.new()
	captain.add_child(ability)
	ability.raycast_override = func(_f: Vector3, _t: Vector3, _m: int) -> Dictionary:
		return {"collider": companion}

	var received: Array = []
	ability.target_marked.connect(func(pos: Vector3, id: int) -> void: received.append(id))
	captain.intent_look_at = companion.eye_position()
	captain.use_ability()
	ability._physics_process(0.016)

	assert_size(received, 0, "no debe marcar a un compañero como objetivo")


func test_technician_hack_opens_a_nearby_closed_door() -> void:
	var technician := make_character(&"technician", Character.Team.PLAYER)
	technician.global_position = Vector3.ZERO
	var door_scene: PackedScene = load("res://scenes/gameplay/door.tscn")
	var door := door_scene.instantiate() as Door
	spawn(door)
	door.global_position = Vector3(2, 0, 0)
	var ability := AbilityTechnicianHack.new()
	ability.hack_radius_m = 10.0
	technician.add_child(ability)

	technician.use_ability()
	ability._physics_process(0.016)

	assert_true(door.is_open, "Hackeo debe abrir las puertas cerradas al alcance")


func test_technician_hack_ignores_doors_out_of_range() -> void:
	var technician := make_character(&"technician", Character.Team.PLAYER)
	technician.global_position = Vector3.ZERO
	var door_scene: PackedScene = load("res://scenes/gameplay/door.tscn")
	var door := door_scene.instantiate() as Door
	spawn(door)
	door.global_position = Vector3(50, 0, 0)
	var ability := AbilityTechnicianHack.new()
	ability.hack_radius_m = 10.0
	technician.add_child(ability)

	technician.use_ability()
	ability._physics_process(0.016)

	assert_false(door.is_open, "fuera del radio de Hackeo, la puerta sigue cerrada")


func test_specialist_suppression_marks_blackboard_and_sustains_fire() -> void:
	var specialist := make_character(&"specialist", Character.Team.PLAYER)
	specialist.squad_id = 3
	var ws := attach_weapon_system(specialist)
	var ability := AbilitySpecialistSuppression.new()
	specialist.add_child(ability)

	specialist.intent_look_at = specialist.global_position + Vector3(0, 0, -10)
	specialist.use_ability()
	ability._physics_process(0.016) # tick 1: activa la habilidad y marca Blackboard

	assert_true(Blackboard.has_active_suppression(3),
		"activar Supresión debe marcar la pizarra compartida (no la escuadra directamente)")

	var starting_ammo := specialist.ammo
	ability._physics_process(0.016) # tick 2: _on_tick ya ve el sostenido activo -> character.fire()
	ws._physics_process(0.016) # WeaponSystem resuelve el disparo que puso Ability
	assert_lt(float(specialist.ammo), float(starting_ammo),
		"Supresión es fuego SOSTENIDO: debe llegar a disparar de verdad")


func test_demolition_breach_emits_level_topology_changed() -> void:
	var demolition := make_character(&"demolition", Character.Team.PLAYER)
	var ability := AbilityDemolitionBreach.new()
	demolition.add_child(ability)

	var received: Array = []
	var callback := func(aabb: AABB) -> void: received.append(aabb)
	EventBus.level_topology_changed.connect(callback)
	demolition.intent_look_at = demolition.global_position + Vector3(0, 0, -5)
	demolition.use_ability()
	ability._physics_process(0.016)
	EventBus.level_topology_changed.disconnect(callback)

	assert_size(received, 1, "Demolición debe emitir exactamente un level_topology_changed")


# --- Auras pasivas (paridad [P05], radio documentado como desviación) ---

func test_captain_heal_aura_heals_nearby_allies() -> void:
	var captain := make_character(&"captain", Character.Team.PLAYER)
	var companion := make_character(&"technician", Character.Team.COMPANION)
	companion.global_position = Vector3(3, 0, 0) # dentro de los CharacterStats.aura_radius_m
	companion.health = 10.0
	var aura := AuraEmitter.new()
	captain.add_child(aura)

	aura._physics_process(captain.stats.aura_interval_s) # cumple el intervalo de una sola vez

	assert_almost_eq(companion.health, 10.0 + captain.stats.aura_amount, 0.0001,
		"+1 HP por intervalo (CharacterStats.aura_amount del capitán)")


func test_captain_heal_aura_ignores_allies_out_of_radius() -> void:
	var captain := make_character(&"captain", Character.Team.PLAYER)
	var companion := make_character(&"technician", Character.Team.COMPANION)
	companion.global_position = Vector3(50, 0, 0) # muy fuera de CharacterStats.aura_radius_m
	companion.health = 10.0
	var aura := AuraEmitter.new()
	captain.add_child(aura)

	aura._physics_process(captain.stats.aura_interval_s)

	assert_almost_eq(companion.health, 10.0, 0.0001, "fuera de radio, el aura no cura")


func test_specialist_ammo_aura_gives_ammo_to_allies() -> void:
	var specialist := make_character(&"specialist", Character.Team.PLAYER)
	var companion := make_character(&"captain", Character.Team.COMPANION)
	companion.global_position = Vector3(2, 0, 0)
	companion.consume_ammo(30)
	var aura := AuraEmitter.new()
	specialist.add_child(aura)

	aura._physics_process(specialist.stats.aura_interval_s)

	assert_eq(companion.ammo, companion.stats.max_ammo - 30 + int(specialist.stats.aura_amount),
		"+10 balas por intervalo (CharacterStats.aura_amount del especialista)")


func test_aura_does_not_emit_for_an_archetype_with_zero_aura_amount() -> void:
	var technician := make_character(&"technician", Character.Team.PLAYER)
	assert_eq(technician.stats.aura_amount, 0.0,
		"fijación de la prueba: el técnico no tiene aura en los datos")
	var aura := AuraEmitter.new()
	technician.add_child(aura)
	assert_false(aura.is_physics_processing(),
		"aura_amount == 0.0 debe autodesactivar el aura, sin mirar el arquetipo")
