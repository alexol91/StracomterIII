class_name HitZones
extends RefCounted
## Resuelve la ZONA de un impacto a partir del cuerpo físico y el índice de
## forma que devolvió el raycast del arma. Los MULTIPLICADORES viven en
## `Balance` (`HEADSHOT_MULTIPLIER`/`TORSO_MULTIPLIER`/`LIMB_MULTIPLIER`) y en
## `Damage.effective_amount()` — este fichero no los repite, solo decide
## "¿qué zona es esta forma?".
##
## Cómo está montado `character.tscn`: un único `CharacterBody3D` con TRES
## `CollisionShape3D` hijos nombrados `HeadShape`, `TorsoShape` y `LimbShape`.
## Godot permite que un `PhysicsBody3D` tenga varias formas de colisión y un
## raycast (`intersect_ray`) devuelve el ÍNDICE de forma concreto que golpeó
## (`PhysicsRayQueryParameters3D`/resultado `shape`). Con
## `shape_find_owner(shape_index)` + `shape_owner_get_owner(owner_id)` se
## recupera el nodo `CollisionShape3D` exacto y se lee su nombre.
##
## Ventaja de este enfoque frente a `Area3D` superpuestas por zona: un solo
## cuerpo físico, una sola pasada de `move_and_slide`, cero capas nuevas que
## inventar en `project.godot` (que no es de este agente).

const HEAD_NAME_HINT: String = "head"
const LIMB_NAME_HINT: String = "limb"


## Zona correspondiente a la forma `shape_index` del cuerpo `body`.
## Si no se puede determinar (cuerpo sin nombres de zona, índice fuera de
## rango...), se asume TORSO — es la zona "neutra" del original (sin
## localización de daño, todo el cuerpo valía lo mismo).
static func zone_for_shape(body: PhysicsBody3D, shape_index: int) -> Damage.Zone:
	if body == null or body.get_shape_owners().is_empty():
		return Damage.Zone.TORSO
	var owner_id := body.shape_find_owner(shape_index)
	var owner_node: Object = body.shape_owner_get_owner(owner_id)
	if owner_node == null or not (owner_node is Node):
		return Damage.Zone.TORSO
	return zone_for_name((owner_node as Node).name)


## Versión por nombre, útil para tests sin construir formas de colisión.
static func zone_for_name(shape_name: String) -> Damage.Zone:
	var lowered := shape_name.to_lower()
	if lowered.contains(HEAD_NAME_HINT):
		return Damage.Zone.HEAD
	if lowered.contains(LIMB_NAME_HINT):
		return Damage.Zone.LIMB
	return Damage.Zone.TORSO


## Construye el `Damage` completo de un impacto de arma de fuego/cuchillo.
## Envoltorio fino para que `weapon_system.gd` no tenga que conocer el
## constructor de `Damage` ni repetir la resolución de zona.
static func build_damage(
	base_amount: float,
	zone: Damage.Zone,
	source_position: Vector3,
	attacker_id: int,
	attacker_team: int,
	is_explosive: bool = false
) -> Damage:
	var dmg := Damage.new(base_amount, zone, source_position, attacker_id, attacker_team)
	dmg.is_explosive = is_explosive
	return dmg
