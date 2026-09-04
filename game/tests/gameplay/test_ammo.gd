extends GameplayFixture
## Munición: se consume aunque falles el disparo (réplica de
## `Character::shootDamage()`), se recarga tras `WeaponStats.reload_s`
## (a diferencia del original, que no tenía recarga), y sin balas no se
## dispara.

func test_ammo_is_consumed_even_when_the_shot_misses() -> void:
	var shooter := make_character(&"captain", Character.Team.PLAYER)
	var ws := attach_weapon_system(shooter)
	# Mira al vacío: nada que pueda impactar, ni siquiera geometría.
	shooter.intent_look_at = shooter.global_position + Vector3(0, 0, -10)
	var starting_ammo := shooter.ammo
	shooter.intent_fire = true
	ws._physics_process(0.016)
	assert_eq(shooter.ammo, starting_ammo - 1,
		"la bala se consume aunque el disparo no impacte a nadie")


func test_ammo_decreases_by_exactly_one_per_shot() -> void:
	var shooter := make_character(&"captain", Character.Team.PLAYER)
	var ws := attach_weapon_system(shooter)
	shooter.intent_look_at = shooter.global_position + Vector3(0, 0, -10)
	for i: int in range(3):
		shooter.intent_fire = true
		# Cadencia del capitán: 100 ms. 0.2 s de sobra entre disparos.
		ws._physics_process(0.2)
	assert_eq(shooter.ammo, shooter.stats.max_ammo - 3, "tres disparos, tres balas menos")


func test_cannot_fire_ammo_reports_false_when_empty() -> void:
	var shooter := make_character(&"enemy_thug", Character.Team.ENEMY)
	assert_true(shooter.can_fire_ammo(), "empieza con munición")
	shooter.consume_ammo(shooter.stats.max_ammo)
	assert_eq(shooter.ammo, 0)
	assert_false(shooter.can_fire_ammo(), "sin balas, canFire debe ser false")


func test_does_not_fire_without_ammo() -> void:
	var shooter := make_character(&"captain", Character.Team.PLAYER)
	var ws := attach_weapon_system(shooter)
	shooter.consume_ammo(shooter.stats.max_ammo)
	assert_eq(shooter.ammo, 0)
	shooter.intent_look_at = shooter.global_position + Vector3(0, 0, -10)
	shooter.intent_fire = true
	ws._physics_process(0.016)
	assert_eq(shooter.ammo, 0, "sin balas no debe intentar más consumo ni disparar")


func test_reload_does_not_refill_instantly() -> void:
	var shooter := make_character(&"captain", Character.Team.PLAYER)
	var ws := attach_weapon_system(shooter)
	shooter.consume_ammo(shooter.stats.max_ammo)
	shooter.intent_reload = true
	ws._physics_process(0.016)
	assert_eq(shooter.ammo, 0, "la recarga tarda WeaponStats.reload_s, no es instantánea")


func test_reload_refills_after_reload_s_elapses() -> void:
	var shooter := make_character(&"captain", Character.Team.PLAYER)
	var ws := attach_weapon_system(shooter)
	shooter.consume_ammo(shooter.stats.max_ammo)
	shooter.intent_reload = true
	ws._physics_process(0.016) # arranca la recarga
	var reload_s: float = Balance.weapon(&"pistol").reload_s
	ws._physics_process(reload_s + 0.1) # deja pasar de sobra el tiempo de recarga
	assert_eq(shooter.ammo, shooter.stats.max_ammo,
		"tras reload_s, la munición vuelve al máximo del personaje")


func test_original_had_no_reload_this_remake_does() -> void:
	# Documenta la corrección deliberada del legacy (GDD §9): un enemigo que
	# gastaba sus 50 balas se quedaba inútil para siempre. Aquí un enemigo
	# vacío se recarga solo si su IA pide `reload()` — el mecanismo existe.
	var enemy := make_character(&"enemy_militiaman", Character.Team.ENEMY)
	var ws := attach_weapon_system(enemy)
	enemy.consume_ammo(enemy.stats.max_ammo)
	assert_false(enemy.can_fire_ammo(), "el enemigo se ha quedado sin balas")
	enemy.reload()
	ws._physics_process(0.016)
	var reload_s: float = Balance.weapon(&"pistol").reload_s
	ws._physics_process(reload_s + 0.1)
	assert_true(enemy.can_fire_ammo(), "a diferencia del original, el enemigo puede recargar")
