extends GameplayFixture
## Pickups: los seis valores EXACTOS del original (`Object::Apply`,
## `Object.cc:43-74`) — health_pack_1/2/3 = +20/+50/+100 HP,
## ammo_pack_1/2/3 = +20/+50/+100 balas — más el pickup de arma `sniper`.

func _make_pickup(pickup_class: Pickup.PickupClass) -> Pickup:
	var scene: PackedScene = load("res://scenes/gameplay/pickup.tscn")
	var p := scene.instantiate() as Pickup
	p.pickup_class = pickup_class
	spawn(p)
	return p


# --- Los seis valores, sin pasar por escena (tabla pura) ---

func test_health_pack_1_is_20() -> void:
	assert_almost_eq(Pickup.amount_for(Pickup.PickupClass.HEALTH_PACK_1), 20.0, 0.0001)


func test_health_pack_2_is_50() -> void:
	assert_almost_eq(Pickup.amount_for(Pickup.PickupClass.HEALTH_PACK_2), 50.0, 0.0001)


func test_health_pack_3_is_100() -> void:
	assert_almost_eq(Pickup.amount_for(Pickup.PickupClass.HEALTH_PACK_3), 100.0, 0.0001)


func test_ammo_pack_1_is_20() -> void:
	assert_almost_eq(Pickup.amount_for(Pickup.PickupClass.AMMO_PACK_1), 20.0, 0.0001)


func test_ammo_pack_2_is_50() -> void:
	assert_almost_eq(Pickup.amount_for(Pickup.PickupClass.AMMO_PACK_2), 50.0, 0.0001)


func test_ammo_pack_3_is_100() -> void:
	assert_almost_eq(Pickup.amount_for(Pickup.PickupClass.AMMO_PACK_3), 100.0, 0.0001)


# --- Aplicación real sobre un Character ---

func test_pickup_heals_player_on_contact() -> void:
	var player := make_character(&"captain", Character.Team.PLAYER)
	player.health = 100.0 # por debajo del máximo (160) para ver el efecto
	var pickup := _make_pickup(Pickup.PickupClass.HEALTH_PACK_2)
	pickup._on_body_entered(player)
	assert_almost_eq(player.health, 150.0, 0.0001, "health_pack_2 = +50 HP")


func test_pickup_gives_ammo_on_contact() -> void:
	var player := make_character(&"specialist", Character.Team.PLAYER)
	player.consume_ammo(40) # deja hueco para +20 sin toparse con max_ammo=50
	var pickup := _make_pickup(Pickup.PickupClass.AMMO_PACK_1)
	pickup._on_body_entered(player)
	assert_eq(player.ammo, 30, "10 + 20 = 30 (ammo_pack_1 = +20 balas)")


func test_pickup_equips_sniper_weapon() -> void:
	var player := make_character(&"captain", Character.Team.PLAYER)
	assert_eq(player.equipped_weapon_override, &"")
	var pickup := _make_pickup(Pickup.PickupClass.SNIPER)
	pickup._on_body_entered(player)
	assert_eq(player.equipped_weapon_override, &"sniper",
		"el original nunca implementó el pickup sniper; aquí sí equipa el arma")


func test_pickup_ignores_enemies() -> void:
	var enemy := make_character(&"enemy_thug", Character.Team.ENEMY)
	enemy.health = 20.0
	var pickup := _make_pickup(Pickup.PickupClass.HEALTH_PACK_3)
	pickup._on_body_entered(enemy)
	assert_almost_eq(enemy.health, 20.0, 0.0001, "los enemigos no recogen botín de zona")


func test_pickup_emits_event_bus_signal_with_its_id() -> void:
	var player := make_character(&"captain", Character.Team.PLAYER)
	var pickup := _make_pickup(Pickup.PickupClass.AMMO_PACK_3)
	var received: Array = []
	var callback := func(pickup_id: StringName, character_id: int) -> void:
		received.append([pickup_id, character_id])
	EventBus.pickup_collected.connect(callback)
	pickup._on_body_entered(player)
	EventBus.pickup_collected.disconnect(callback)
	assert_size(received, 1, "debe emitir EventBus.pickup_collected exactamente una vez")
	assert_eq(received[0][0], &"ammo_pack_3")
