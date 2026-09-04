class_name Damage
extends RefCounted
## Información de un impacto. Se pasa a `Character.apply_damage`.

## Zona de impacto. Los multiplicadores viven en Balance (ADR-005).
enum Zone { TORSO, HEAD, LIMB }

var amount: float = 0.0
var zone: Zone = Zone.TORSO
var source_position: Vector3 = Vector3.ZERO
var attacker_id: int = 0
var attacker_team: int = 0
## Si el daño proviene de una explosión (para fuego amigo y retroalimentación).
var is_explosive: bool = false


func _init(
	p_amount: float = 0.0,
	p_zone: Zone = Zone.TORSO,
	p_source_position: Vector3 = Vector3.ZERO,
	p_attacker_id: int = 0,
	p_attacker_team: int = 0
) -> void:
	amount = p_amount
	zone = p_zone
	source_position = p_source_position
	attacker_id = p_attacker_id
	attacker_team = p_attacker_team


## Daño final tras aplicar el multiplicador de zona.
func effective_amount() -> float:
	match zone:
		Zone.HEAD:
			return amount * Balance.HEADSHOT_MULTIPLIER
		Zone.LIMB:
			return amount * Balance.LIMB_MULTIPLIER
		_:
			return amount * Balance.TORSO_MULTIPLIER
