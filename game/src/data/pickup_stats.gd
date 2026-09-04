class_name PickupStats
extends Resource
## Un objeto recogible. Réplica de Core::Objects::Class y de Object::Apply
## del original, convertida en dato.

enum Effect { HEAL, AMMO, WEAPON }

@export var id: StringName = &""
@export var display_name_key: String = ""
@export var effect: Effect = Effect.HEAL
## Cantidad concedida (HP o balas). Ignorado para Effect.WEAPON.
@export var amount: float = 0.0
## Arma concedida, para Effect.WEAPON.
@export var weapon_id: StringName = &""
