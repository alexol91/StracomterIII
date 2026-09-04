class_name AbilityDemolitionBreach
extends Ability
## "Demolición" (Explosivo, `E-01`): abre un muro nuevo y obliga a rehornear
## navegación y coberturas.
##
## REGLA DURA: este fichero NO rehornea nada — se limita a localizar el punto
## de brecha y a emitir `EventBus.level_topology_changed(aabb)`. Levantar el
## navmesh y la nube de cobertura de esa región es de `ai-navegacion`/`levels`.
##
## Si el objetivo pertenece al grupo `breachable_wall` (lo etiqueta quien
## construya el nivel, fuera de este ámbito) se elimina de la escena — es la
## parte de "abrir un muro" que sí es responsabilidad de gameplay: hacer que
## dejen de bloquear el disparo y el paso. La geometría "bonita" de un hueco
## real en la pared es trabajo de `levels`/arte.

@export var breach_range_m: float = 6.0
## Tamaño de la región que se avisa como cambiada. Blockout deliberado: un
## cubo centrado en el punto de impacto es suficiente para que
## `ai-navegacion` sepa qué rehornear sin que este agente diseñe geometría de
## niveles (fuera de su ámbito).
@export var breach_region_size_m: Vector3 = Vector3(3.0, 3.0, 1.0)
## Solo geometría real bloquea la búsqueda de muro: world | door.
const BREACH_RAY_MASK: int = 65


func _activate() -> void:
	if character == null or not character.is_inside_tree():
		return
	var origin := character.eye_position()
	var dir := aim_direction_from(origin)
	var to := origin + dir * breach_range_m
	var space_state := character.get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(origin, to, BREACH_RAY_MASK)
	query.exclude = [character.get_rid()]
	var result := space_state.intersect_ray(query)

	var center := to
	if not result.is_empty():
		center = result.get("position", to)
		var collider: Object = result.get("collider")
		if collider is Node and (collider as Node).is_in_group(&"breachable_wall"):
			(collider as Node).queue_free()

	var aabb := AABB(center - breach_region_size_m * 0.5, breach_region_size_m)
	EventBus.level_topology_changed.emit(aabb)
