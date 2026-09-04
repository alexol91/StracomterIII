class_name ZoneThreatReading
extends RefCounted
## Lectura de amenaza de una zona, para la pantalla de Estrategia (GDD §6).
##
## Deliberadamente NO consulta al Director de encuentros: la composición
## enemiga real la decide `EncounterDirector` al entrar en la zona, con su
## propia semilla, y es secreto de diseño ("el plano se ve, la composición
## enemiga no" — GDD §6). Lo que se muestra aquí es la lectura de amenaza
## FIJA por número de zona que describe la tabla del GDD §6 (tamaño de mapa,
## forma del combate) más lo que sí es dato real de la planta: el tamaño de
## mapa (`FloorConfig.zone_maps`, por convención de nombre de fichero
## `mapP/M/G<planta>.tscn`) y la posible presencia de jefe
## (`FloorConfig.has_miniboss` / `has_megaboss`).
##
## Pura: sin nodos, sin `_ready`, completamente testeable en headless.

enum MapScale { SMALL, MEDIUM, LARGE }

const ZONES_PER_FLOOR: int = 6


## Clasifica el tamaño de un mapa por el nombre de su escena. Los mapas
## heredados del original siguen el patrón `mapP*`/`mapM*`/`mapG*`
## (pequeño/mediano/grande); los mapas finales de planta 8-9 (`finalMap`,
## `rooftop`) son arenas grandes de jefe.
static func map_scale_for_path(scene_path: String) -> MapScale:
	var lower := scene_path.get_file().to_lower()
	if lower.begins_with("mapg") or lower.begins_with("finalmap") or lower.begins_with("rooftop"):
		return MapScale.LARGE
	if lower.begins_with("mapm"):
		return MapScale.MEDIUM
	if lower.begins_with("mapp"):
		return MapScale.SMALL
	# Mapa desconocido: se asume el tamaño intermedio antes que ocultar
	# información — más vale una lectura aproximada que ninguna.
	return MapScale.MEDIUM


static func map_scale_key(scale: MapScale) -> StringName:
	match scale:
		MapScale.SMALL:
			return &"STRATEGY_MAP_SMALL"
		MapScale.LARGE:
			return &"STRATEGY_MAP_LARGE"
		_:
			return &"STRATEGY_MAP_MEDIUM"


## Descriptor táctico fijo por número de zona (1..6), tal cual la columna
## "Coste táctico" de la tabla del GDD §6. Es diseño, no balanceo: no cambia
## de planta a planta, así que no es un número de ADR-005 y no requiere dato.
static func threat_flavor_key(zone_index: int) -> StringName:
	match zone_index:
		1:
			return &"STRATEGY_ZONE_1_THREAT"
		2:
			return &"STRATEGY_ZONE_2_THREAT"
		3:
			return &"STRATEGY_ZONE_3_THREAT"
		4:
			return &"STRATEGY_ZONE_4_THREAT"
		5:
			return &"STRATEGY_ZONE_5_THREAT"
		6:
			return &"STRATEGY_ZONE_6_THREAT"
		_:
			return &""


## ¿Puede haber un jefe en esta zona? Derivado, no exacto: el original y el
## GDD atan el miniboss a la zona 5 (mapa grande) de las plantas que lo
## tienen; aquí se generaliza a "la planta tiene miniboss/megaboss Y esta
## zona usa un mapa grande", para no fallar en plantas donde varias zonas
## comparten mapa grande (p. ej. planta 3: zonas 3-6).
## TODO(arquitecto): si el Director llega a fijar el jefe a una zona
## concreta por planta, mover esa asociación a dato en `FloorConfig` y
## sustituir esta heurística.
static func has_boss_presence(cfg: FloorConfig, zone_index: int) -> bool:
	if cfg == null:
		return false
	if not (cfg.has_miniboss or cfg.has_megaboss):
		return false
	var path := _zone_map_path(cfg, zone_index)
	return map_scale_for_path(path) == MapScale.LARGE


static func reward_pickup(cfg: FloorConfig, zone_index: int) -> PickupStats:
	if cfg == null:
		return null
	var idx := zone_index - 1
	if idx < 0 or idx >= cfg.zone_rewards.size():
		return null
	return Balance.pickup(cfg.zone_rewards[idx])


## Clave de formato de la recompensa según su efecto ("+{0} vida" / "+{0} munición").
static func reward_format_key(pickup: PickupStats) -> StringName:
	if pickup == null:
		return &""
	match pickup.effect:
		PickupStats.Effect.HEAL:
			return &"STRATEGY_REWARD_HEALTH_FMT"
		PickupStats.Effect.AMMO:
			return &"STRATEGY_REWARD_AMMO_FMT"
		_:
			return &"STRATEGY_REWARD_WEAPON_FMT"


static func _zone_map_path(cfg: FloorConfig, zone_index: int) -> String:
	var idx := zone_index - 1
	if idx < 0 or idx >= cfg.zone_maps.size():
		return ""
	return cfg.zone_maps[idx]
