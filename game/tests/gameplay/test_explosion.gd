extends GameplayFixture
## Explosión: caída lineal `daño × (1 − dist/radio)` (réplica exacta de
## `EventControl::Explosion`, legacy) y exige línea de visión a la víctima.

const WORLD_LAYER: int = 1


func _wall(position: Vector3, size: Vector3) -> StaticBody3D:
	var wall := StaticBody3D.new()
	wall.collision_layer = WORLD_LAYER
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	shape.shape = box
	wall.add_child(shape)
	spawn(wall)
	wall.global_position = position
	return wall


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


# --- Integración real: WeaponSystem + raycast de línea de visión ---

func test_explosion_damages_hostile_with_clear_line_of_sight() -> void:
	var shooter := make_full_character(&"demolition", Character.Team.PLAYER, Vector3(0, 0, 0))
	_wall(Vector3(3.0, 1.6, 0.0), Vector3(0.2, 3.0, 3.0)) # frena el rayo de apuntado en x=2.9
	var target := make_full_character(&"enemy_thug", Character.Team.ENEMY, Vector3(2.9, 0, 1.0))
	var ws := attach_weapon_system(shooter)

	shooter.intent_look_at = Vector3(100.0, 1.6, 0.0) # apunta a lo largo de +X, a la pared
	var starting_health := target.health
	shooter.intent_fire = true
	ws._physics_process(0.016)

	# distancia centro-víctima ≈ 1 m, radio 2 m ⇒ daño ≈ 60 × (1 − 1/2) = 30.
	assert_almost_eq(target.health, starting_health - 30.0, 1.0,
		"con línea de visión despejada, la explosión hiere con caída lineal")


func test_explosion_deals_no_damage_without_line_of_sight() -> void:
	var shooter := make_full_character(&"demolition", Character.Team.PLAYER, Vector3(0, 0, 0))
	_wall(Vector3(3.0, 1.6, 0.0), Vector3(0.2, 3.0, 3.0)) # frena el rayo de apuntado en x=2.9
	# Pared SEPARADA, perpendicular, entre el centro de la explosión y la
	# víctima — no toca el camino del rayo de apuntado (que va por z=0).
	_wall(Vector3(2.9, 1.6, 0.5), Vector3(2.0, 3.0, 0.1))
	var target := make_full_character(&"enemy_thug", Character.Team.ENEMY, Vector3(2.9, 0, 1.0))
	var ws := attach_weapon_system(shooter)

	shooter.intent_look_at = Vector3(100.0, 1.6, 0.0)
	var starting_health := target.health
	shooter.intent_fire = true
	ws._physics_process(0.016)

	assert_almost_eq(target.health, starting_health, 0.0001,
		"sin línea de visión a la víctima, la explosión NO debe hacer daño")


func test_explosion_does_not_damage_beyond_blast_radius() -> void:
	var shooter := make_full_character(&"demolition", Character.Team.PLAYER, Vector3(0, 0, 0))
	_wall(Vector3(3.0, 1.6, 0.0), Vector3(0.2, 3.0, 3.0))
	# A 5 m del centro, muy por fuera del radio de 2 m del lanzagranadas.
	var target := make_full_character(&"enemy_thug", Character.Team.ENEMY, Vector3(2.9, 0, 5.0))
	var ws := attach_weapon_system(shooter)

	shooter.intent_look_at = Vector3(100.0, 1.6, 0.0)
	var starting_health := target.health
	shooter.intent_fire = true
	ws._physics_process(0.016)

	assert_almost_eq(target.health, starting_health, 0.0001,
		"fuera del radio de la explosión no debe haber daño")
