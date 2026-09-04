extends GameplayFixture
## Explosión: caída lineal `daño × (1 − dist/radio)` (réplica exacta de
## `EventControl::Explosion`, legacy) y exige línea de visión a la víctima.
##
## Las pruebas de integración inyectan `WeaponSystem.raycast_override` en vez
## de depender de raycasts físicos reales: un cuerpo recién creado no es
## consultable por raycast dentro del MISMO tick de física en el que se crea
## (limitación del motor, no del código bajo prueba), y el runner de pruebas
## compartido (`tests/run_tests.gd`) nunca deja avanzar un frame real — ver
## el comentario de `WeaponSystem.raycast_override`.

func _stub_raycast(hit_position: Vector3, los_blocked: bool) -> Callable:
	return func(_from: Vector3, _to: Vector3, mask: int) -> Dictionary:
		if mask == WeaponSystem.HIT_MASK:
			return {"position": hit_position}
		if mask == WeaponSystem.LOS_MASK:
			return {"position": hit_position} if los_blocked else {}
		return {}


# --- Fórmula pura, en tres distancias, sin física (Weapon.explosion_damage) ---

func test_full_damage_at_the_center() -> void:
	assert_almost_eq(Weapon.explosion_damage(60.0, 0.0, 2.0), 60.0, 0.0001,
		"en el centro de la explosión, daño completo")


func test_half_damage_at_half_radius() -> void:
	assert_almost_eq(Weapon.explosion_damage(60.0, 1.0, 2.0), 30.0, 0.0001,
		"a mitad de radio, mitad de daño — caída LINEAL")


func test_no_damage_at_the_edge_of_the_radius() -> void:
	assert_almost_eq(Weapon.explosion_damage(60.0, 2.0, 2.0), 0.0, 0.0001,
		"justo en el borde del radio, daño cero")


func test_no_damage_beyond_the_radius() -> void:
	assert_almost_eq(Weapon.explosion_damage(60.0, 5.0, 2.0), 0.0, 0.0001,
		"fuera del radio, cero (nunca negativo)")


# --- Integración real: WeaponSystem, con el raycast inyectado ---

func test_explosion_damages_hostile_with_clear_line_of_sight() -> void:
	var shooter := make_character(&"demolition", Character.Team.PLAYER)
	shooter.global_position = Vector3.ZERO
	var target := make_character(&"enemy_thug", Character.Team.ENEMY)
	target.global_position = Vector3(1.9, 0, 0) # 1 m del centro de la explosión

	var ws := attach_weapon_system(shooter)
	var impact_point := shooter.eye_position() + Vector3(0.9, 0, 0)
	ws.raycast_override = _stub_raycast(impact_point, false) # LOS despejada

	shooter.intent_look_at = shooter.eye_position() + Vector3(1, 0, 0)
	var starting_health := target.health
	shooter.intent_fire = true
	ws._physics_process(0.016)

	# distancia centro-víctima = 1 m, radio 2 m ⇒ daño = 60 × (1 − 1/2) = 30.
	assert_almost_eq(target.health, starting_health - 30.0, 0.01,
		"con línea de visión despejada, la explosión hiere con caída lineal")


func test_explosion_deals_no_damage_without_line_of_sight() -> void:
	var shooter := make_character(&"demolition", Character.Team.PLAYER)
	shooter.global_position = Vector3.ZERO
	var target := make_character(&"enemy_thug", Character.Team.ENEMY)
	target.global_position = Vector3(1.9, 0, 0) # mismo punto que el caso "con LOS"

	var ws := attach_weapon_system(shooter)
	var impact_point := shooter.eye_position() + Vector3(0.9, 0, 0)
	ws.raycast_override = _stub_raycast(impact_point, true) # LOS BLOQUEADA

	shooter.intent_look_at = shooter.eye_position() + Vector3(1, 0, 0)
	var starting_health := target.health
	shooter.intent_fire = true
	ws._physics_process(0.016)

	assert_almost_eq(target.health, starting_health, 0.0001,
		"sin línea de visión a la víctima, la explosión NO debe hacer daño")


func test_explosion_does_not_damage_beyond_blast_radius() -> void:
	var shooter := make_character(&"demolition", Character.Team.PLAYER)
	shooter.global_position = Vector3.ZERO
	var target := make_character(&"enemy_thug", Character.Team.ENEMY)
	# 5 m del centro, muy por fuera del radio de 2 m del lanzagranadas.
	target.global_position = Vector3(5.9, 0, 0)

	var ws := attach_weapon_system(shooter)
	var impact_point := shooter.eye_position() + Vector3(0.9, 0, 0)
	ws.raycast_override = _stub_raycast(impact_point, false)

	shooter.intent_look_at = shooter.eye_position() + Vector3(1, 0, 0)
	var starting_health := target.health
	shooter.intent_fire = true
	ws._physics_process(0.016)

	assert_almost_eq(target.health, starting_health, 0.0001,
		"fuera del radio de la explosión no debe haber daño, LOS despejada o no")


func test_explosion_does_not_damage_the_shooters_own_team_without_friendly_fire() -> void:
	var shooter := make_character(&"demolition", Character.Team.PLAYER)
	shooter.global_position = Vector3.ZERO
	var companion := make_character(&"captain", Character.Team.COMPANION)
	companion.global_position = Vector3(1.9, 0, 0)

	var ws := attach_weapon_system(shooter)
	var impact_point := shooter.eye_position() + Vector3(0.9, 0, 0)
	ws.raycast_override = _stub_raycast(impact_point, false)
	# grenade_launcher trae friendly_fire = true por defecto (réplica del
	# legacy); se fuerza a false para probar el filtro de bando.
	Balance.weapon(&"grenade_launcher").friendly_fire = false

	shooter.intent_look_at = shooter.eye_position() + Vector3(1, 0, 0)
	var starting_health := companion.health
	shooter.intent_fire = true
	ws._physics_process(0.016)

	Balance.weapon(&"grenade_launcher").friendly_fire = true # no contaminar otras pruebas
	assert_almost_eq(companion.health, starting_health, 0.0001,
		"con friendly_fire desactivado, el propio bando no sufre daño de área")
