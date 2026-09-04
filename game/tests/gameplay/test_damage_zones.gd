extends TestCase
## Daño localizado (GDD §9): cabeza ×2,5, torso ×1, extremidades ×0,7. Los
## multiplicadores viven en `Balance`; aquí se comprueba que `Damage` los
## aplica bien y que `HitZones` resuelve la zona correcta a partir del
## nombre/forma de colisión — no se repiten los números.

func test_headshot_multiplier_from_balance() -> void:
	var dmg := Damage.new(10.0, Damage.Zone.HEAD)
	assert_almost_eq(dmg.effective_amount(), 10.0 * Balance.HEADSHOT_MULTIPLIER, 0.0001,
		"cabeza x2.5 (Balance.HEADSHOT_MULTIPLIER)")


func test_torso_multiplier_from_balance() -> void:
	var dmg := Damage.new(10.0, Damage.Zone.TORSO)
	assert_almost_eq(dmg.effective_amount(), 10.0 * Balance.TORSO_MULTIPLIER, 0.0001,
		"torso x1 (Balance.TORSO_MULTIPLIER)")


func test_limb_multiplier_from_balance() -> void:
	var dmg := Damage.new(10.0, Damage.Zone.LIMB)
	assert_almost_eq(dmg.effective_amount(), 10.0 * Balance.LIMB_MULTIPLIER, 0.0001,
		"extremidades x0.7 (Balance.LIMB_MULTIPLIER)")


func test_zone_for_name_detects_head() -> void:
	assert_eq(HitZones.zone_for_name("HeadShape"), Damage.Zone.HEAD)
	assert_eq(HitZones.zone_for_name("head"), Damage.Zone.HEAD)


func test_zone_for_name_detects_limb() -> void:
	assert_eq(HitZones.zone_for_name("LimbShape"), Damage.Zone.LIMB)


func test_zone_for_name_defaults_to_torso() -> void:
	assert_eq(HitZones.zone_for_name("TorsoShape"), Damage.Zone.TORSO)
	assert_eq(HitZones.zone_for_name("AnythingElse"), Damage.Zone.TORSO)
	assert_eq(HitZones.zone_for_name(""), Damage.Zone.TORSO)


## `character.tscn` monta las tres formas como hijos DIRECTOS del
## `CharacterBody3D`, nombradas `HeadShape`/`TorsoShape`/`LimbShape` — igual
## que aquí, pero sin pasar por una escena ni por física real:
## `shape_find_owner`/`shape_owner_get_owner` funcionan solo con que las
## formas estén parentadas, no hace falta raycast ni árbol de escena.
func test_zone_for_shape_reads_real_collision_shapes_in_order() -> void:
	var body := CharacterBody3D.new()
	var head := CollisionShape3D.new()
	head.name = "HeadShape"
	head.shape = SphereShape3D.new()
	body.add_child(head)
	var torso := CollisionShape3D.new()
	torso.name = "TorsoShape"
	torso.shape = CapsuleShape3D.new()
	body.add_child(torso)
	var limb := CollisionShape3D.new()
	limb.name = "LimbShape"
	limb.shape = CapsuleShape3D.new()
	body.add_child(limb)

	assert_eq(HitZones.zone_for_shape(body, 0), Damage.Zone.HEAD, "forma 0 = HeadShape")
	assert_eq(HitZones.zone_for_shape(body, 1), Damage.Zone.TORSO, "forma 1 = TorsoShape")
	assert_eq(HitZones.zone_for_shape(body, 2), Damage.Zone.LIMB, "forma 2 = LimbShape")

	body.free()


func test_zone_for_shape_handles_body_without_shapes() -> void:
	var body := CharacterBody3D.new()
	assert_eq(HitZones.zone_for_shape(body, 0), Damage.Zone.TORSO, "sin formas, se asume TORSO")
	assert_eq(HitZones.zone_for_shape(null, 0), Damage.Zone.TORSO, "cuerpo nulo, se asume TORSO")
	body.free()


func test_build_damage_wraps_zone_and_attacker() -> void:
	var dmg := HitZones.build_damage(20.0, Damage.Zone.HEAD, Vector3(1, 2, 3), 42, 0, false)
	assert_almost_eq(dmg.effective_amount(), 20.0 * Balance.HEADSHOT_MULTIPLIER, 0.0001)
	assert_eq(dmg.attacker_id, 42)
	assert_eq(dmg.source_position, Vector3(1, 2, 3))
	assert_false(dmg.is_explosive)
