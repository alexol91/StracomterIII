class_name Pickup
extends Area3D
## Objeto recogible del suelo: paquete de vida/munición, o arma.
##
## Réplica de `Core::Objects` (legacy, `CoreNamespace.h:72-89`;
## `Object::Apply`, `Object.cc:43-74`). El legacy comprobaba solo el CENTRO
## del jugador contra un sensor Box2D estático de 64×64 y aplicaba de
## inmediato (`EntityManager::Update:646-655`); `Area3D.body_entered` es el
## equivalente moderno del mismo sensor.

enum PickupClass {
	HEALTH_PACK_1, HEALTH_PACK_2, HEALTH_PACK_3,
	AMMO_PACK_1, AMMO_PACK_2, AMMO_PACK_3,
	SNIPER,
}

@export var pickup_class: PickupClass = PickupClass.HEALTH_PACK_1
## El legacy solo dejaba recoger al jugador ("los bots no recogen nada",
## legacy-gameplay.md §6.1). Se activa por defecto para la escuadra como
## mejora explícita del remake (GDD §9, "considerar que los bots recojan").
@export var pickup_by_companions: bool = true
## Puramente de presentación (el objeto gira sobre sí mismo, como en el
## legacy); no es un valor de balanceo.
@export var rotation_speed_rad_s: float = 1.2

const ROTATE_AXIS := Vector3.UP


func _ready() -> void:
	add_to_group(&"pickups")
	monitoring = true
	body_entered.connect(_on_body_entered)


func _process(delta: float) -> void:
	rotate(ROTATE_AXIS, rotation_speed_rad_s * delta)


func _on_body_entered(body: Node) -> void:
	var character := body as Character
	if character == null or not character.alive:
		return
	# Réplica: solo el bando bueno recoge botín de zona.
	if character.team == Character.Team.ENEMY:
		return
	if character.team != Character.Team.PLAYER and not pickup_by_companions:
		return
	_apply_to(character)
	EventBus.pickup_collected.emit(id_name(), character.get_instance_id())
	queue_free()


## Valores EXACTOS del original (`Object::Apply`, `Object.cc:49-63`;
## recompensas de zona en `GameStatus::selectZona`, `GameStatus.cc:225-247`):
## de `PickupStats`/`Balance.pickup()`, nunca repetidos aquí como literales.
func _apply_to(character: Character) -> void:
	var stats := Balance.pickup(id_name())
	if stats == null:
		push_error("Pickup: falta PickupStats para '%s'." % id_name())
		return
	match stats.effect:
		PickupStats.Effect.HEAL:
			character.heal(stats.amount)
		PickupStats.Effect.AMMO:
			character.add_ammo(int(stats.amount))
		PickupStats.Effect.WEAPON:
			# El original NUNCA implementó el pickup `sniper`
			# (`Object.cc:67-69` imprimía "Próximamente"); aquí sí equipa el
			# arma, porque el GDD lo lista como recompensa real de zona.
			character.equip_weapon(stats.weapon_id)


## Id de recompensa de zona (`&"health_pack_1"`, `&"ammo_pack_2"`...), el
## mismo vocabulario que usa `FloorConfig.zone_rewards` y `Balance.pickup()`.
func id_name() -> StringName:
	return id_name_for(pickup_class)


static func id_name_for(p_class: PickupClass) -> StringName:
	return StringName(PickupClass.keys()[p_class].to_lower())


## Cantidad aplicada por esta clase de pickup. `0.0` para `SNIPER` (no es una
## cantidad, es un cambio de arma). Expuesto para que los tests no dupliquen
## la tabla de valores — leen `Balance.pickup()`, la misma fuente que usa
## `_apply_to`.
static func amount_for(p_class: PickupClass) -> float:
	var stats := Balance.pickup(id_name_for(p_class))
	return stats.amount if stats != null else 0.0
