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

## Valores EXACTOS del original (`Object::Apply`, `Object.cc:49-63`; recompensas
## de zona en `GameStatus::selectZona`, `GameStatus.cc:225-247`). No existe un
## recurso de datos para pickups en `src/data/` — fuera del ámbito de este
## agente (`game/src/gameplay/**` solamente) — así que quedan como constantes
## citadas en vez de números sueltos.
## TODO(arquitecto): mover a datos, p. ej. un `PickupStats` en `src/data/`.
const HEALTH_AMOUNTS: Dictionary[PickupClass, float] = {
	PickupClass.HEALTH_PACK_1: 20.0,
	PickupClass.HEALTH_PACK_2: 50.0,
	PickupClass.HEALTH_PACK_3: 100.0,
}
const AMMO_AMOUNTS: Dictionary[PickupClass, int] = {
	PickupClass.AMMO_PACK_1: 20,
	PickupClass.AMMO_PACK_2: 50,
	PickupClass.AMMO_PACK_3: 100,
}
## Arma que concede el pickup `sniper`. El original NUNCA lo implementó
## (`Object.cc:67-69` imprimía `"Próximamente"`); aquí sí, porque el GDD lo
## lista como recompensa real de zona junto a los packs, y `sniper.tres` ya
## existe en `src/data/weapons/`.
const SNIPER_WEAPON_ID: StringName = &"sniper"


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


func _apply_to(character: Character) -> void:
	if HEALTH_AMOUNTS.has(pickup_class):
		character.heal(HEALTH_AMOUNTS[pickup_class])
	elif AMMO_AMOUNTS.has(pickup_class):
		character.add_ammo(AMMO_AMOUNTS[pickup_class])
	elif pickup_class == PickupClass.SNIPER:
		character.equip_weapon(SNIPER_WEAPON_ID)


## Id de recompensa de zona (`&"health_pack_1"`, `&"ammo_pack_2"`...), el
## mismo vocabulario que usa `FloorConfig.zone_rewards`.
func id_name() -> StringName:
	return StringName(PickupClass.keys()[pickup_class].to_lower())


## Cantidad aplicada por esta clase de pickup. `0.0` para `SNIPER` (no es una
## cantidad, es un cambio de arma). Expuesto para que los tests no dupliquen
## la tabla de valores.
static func amount_for(p_class: PickupClass) -> float:
	if HEALTH_AMOUNTS.has(p_class):
		return HEALTH_AMOUNTS[p_class]
	if AMMO_AMOUNTS.has(p_class):
		return float(AMMO_AMOUNTS[p_class])
	return 0.0
