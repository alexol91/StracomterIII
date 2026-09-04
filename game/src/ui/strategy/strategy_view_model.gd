class_name StrategyViewModel
extends RefCounted
## Ensambla los datos de la pantalla de Estrategia a partir de `Balance` y
## `GameState`, en forma de `Dictionary` planas (nunca un `Array[Custom]`:
## ver la nota de fugas de script en el informe de este agente). Sin nodos,
## sin efectos secundarios, 100% testeable en headless.

## Una entrada por zona: {
##   "zone": int (1..6),
##   "reward_key": StringName,   # display_name_key del pickup
##   "reward_format_key": StringName,
##   "reward_amount": float,
##   "map_scale": ZoneThreatReading.MapScale,
##   "map_scale_key": StringName,
##   "threat_key": StringName,
##   "boss_possible": bool,
## }
static func zone_entries(floor_config: FloorConfig) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	if floor_config == null:
		return out
	for zone: int in range(1, GameState.ZONES_PER_FLOOR + 1):
		var pickup := ZoneThreatReading.reward_pickup(floor_config, zone)
		var scale := ZoneThreatReading.map_scale_for_path(
			_zone_map_path(floor_config, zone))
		out.append({
			"zone": zone,
			"reward_key": pickup.display_name_key if pickup != null else "",
			"reward_format_key": ZoneThreatReading.reward_format_key(pickup),
			"reward_amount": pickup.amount if pickup != null else 0.0,
			"map_scale": scale,
			"map_scale_key": ZoneThreatReading.map_scale_key(scale),
			"threat_key": ZoneThreatReading.threat_flavor_key(zone),
			"boss_possible": ZoneThreatReading.has_boss_presence(floor_config, zone),
		})
	return out


## Una entrada por compañero disponible: {
##   "archetype": StringName,
##   "display_name_key": String,
##   "alive": bool,
##   "health": float,
##   "max_health": float,
##   "revive_cost": int,        # 0 si ya está vivo
## }
static func squad_entries(player_archetype: StringName) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for archetype: StringName in SquadReassignment.companion_archetypes(player_archetype):
		var snap: GameState.CharacterSnapshot = GameState.squad.get(archetype, null)
		var stats := Balance.character(archetype)
		var alive := snap != null and snap.alive
		out.append({
			"archetype": archetype,
			"display_name_key": stats.display_name_key if stats != null else "",
			"alive": alive,
			"health": snap.health if snap != null else 0.0,
			"max_health": stats.max_health if stats != null else 0.0,
			"revive_cost": 0 if alive else SquadReassignment.REVIVE_XP_COST,
		})
	return out


static func _zone_map_path(cfg: FloorConfig, zone_index: int) -> String:
	var idx := zone_index - 1
	if idx < 0 or idx >= cfg.zone_maps.size():
		return ""
	return cfg.zone_maps[idx]
