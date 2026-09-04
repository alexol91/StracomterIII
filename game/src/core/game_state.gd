extends Node
## Estado de la partida en curso. Sustituye al singleton GameStatus del legacy.
##
## Diferencia clave con el original: aquí NO se serializan structs binarios
## (GameStatus::saveData volcaba memoria cruda con fwrite, lo que hacía la
## partida guardada irreproducible entre compilaciones). Ver SaveSystem.

## Modos de juego. Réplica de Core::GameMode del legacy.
enum Mode { QUIT, MENU, STRATEGY, ACTION, CREDITS, FREE }
## Estado dentro del modo Acción. Réplica de Core::GameActionStatus.
enum ActionStatus { NORMAL, PAUSED, CONSOLE, GAME_OVER, WIN }

const FIRST_FLOOR: int = 1
const LAST_FLOOR: int = 8
const ROOFTOP_FLOOR: int = 9
const ZONES_PER_FLOOR: int = 6
## Zona por defecto. El legacy arrancaba siempre en la 3.
const DEFAULT_ZONE: int = 3

## Estado guardado de un personaje entre plantas. Equivale a CharacterStatus
## del legacy, sin sus cinco campos `recomp1..recomp5` sin usar.
class CharacterSnapshot:
	extends RefCounted

	var archetype: StringName = &""
	var health: float = 0.0
	var ammo: int = 0
	var score: int = 0
	var alive: bool = true
	var inventory: Array[StringName] = []

	func to_dict() -> Dictionary:
		return {
			"archetype": String(archetype),
			"health": health,
			"ammo": ammo,
			"score": score,
			"alive": alive,
			"inventory": inventory.map(func(i: StringName) -> String: return String(i)),
		}

	static func from_dict(d: Dictionary) -> CharacterSnapshot:
		var s := CharacterSnapshot.new()
		s.archetype = StringName(d.get("archetype", ""))
		s.health = float(d.get("health", 0.0))
		s.ammo = int(d.get("ammo", 0))
		s.score = int(d.get("score", 0))
		s.alive = bool(d.get("alive", true))
		var inv: Array[StringName] = []
		for raw: Variant in d.get("inventory", []):
			inv.append(StringName(str(raw)))
		s.inventory = inv
		return s


var mode: Mode = Mode.MENU
var action_status: ActionStatus = ActionStatus.NORMAL

## Clase elegida por el jugador.
var player_archetype: StringName = &"captain"
var current_floor: int = FIRST_FLOOR
var current_zone: int = DEFAULT_ZONE
var score: int = 0
var experience: int = 0
## Semilla del director. Fijarla hace la partida reproducible, lo cual es
## requisito de los tests y base del evolutivo E-12 (repeticiones).
var run_seed: int = 0

## Estado de la escuadra, indexado por arquetipo.
var squad: Dictionary[StringName, CharacterSnapshot] = {}


func _ready() -> void:
	reset_run()


## Reinicia la partida a su estado inicial.
func reset_run(seed_value: int = 0) -> void:
	mode = Mode.MENU
	action_status = ActionStatus.NORMAL
	current_floor = FIRST_FLOOR
	current_zone = DEFAULT_ZONE
	score = 0
	experience = 0
	run_seed = seed_value if seed_value != 0 else randi()
	squad.clear()
	for id: StringName in [&"captain", &"technician", &"specialist", &"demolition"]:
		var stats := Balance.character(id)
		var snap := CharacterSnapshot.new()
		snap.archetype = id
		snap.health = stats.max_health if stats != null else 100.0
		snap.ammo = stats.max_ammo if stats != null else 120
		snap.score = 0
		snap.alive = true
		squad[id] = snap


func set_mode(new_mode: Mode) -> void:
	if new_mode == mode:
		return
	var previous := mode
	mode = new_mode
	EventBus.game_mode_changed.emit(int(previous), int(mode))


## Avanza a la planta siguiente. Réplica de GameStatus::incrementLevel().
func advance_floor() -> void:
	current_floor += 1


func is_on_rooftop() -> bool:
	return current_floor >= ROOFTOP_FLOOR


## Recompensa de la zona actual, leída de los datos de la planta.
## Réplica de GameStatus::selectZona(), pero como dato y no como `switch`.
func current_zone_reward() -> StringName:
	var cfg := Balance.floor_config(current_floor)
	if cfg == null:
		return &""
	var idx := current_zone - 1
	if idx < 0 or idx >= cfg.zone_rewards.size():
		return &""
	return cfg.zone_rewards[idx]


## ¿Sigue vivo este arquetipo? Réplica de GameStatus::isVivitoYColeando().
func is_alive(archetype: StringName) -> bool:
	var snap: CharacterSnapshot = squad.get(archetype, null)
	return snap != null and snap.alive and snap.health > 0.0


func to_dict() -> Dictionary:
	var squad_out: Dictionary = {}
	for id: StringName in squad:
		squad_out[String(id)] = squad[id].to_dict()
	return {
		"player_archetype": String(player_archetype),
		"current_floor": current_floor,
		"current_zone": current_zone,
		"score": score,
		"experience": experience,
		"run_seed": run_seed,
		"squad": squad_out,
	}


func from_dict(d: Dictionary) -> void:
	player_archetype = StringName(d.get("player_archetype", "captain"))
	current_floor = int(d.get("current_floor", FIRST_FLOOR))
	current_zone = int(d.get("current_zone", DEFAULT_ZONE))
	score = int(d.get("score", 0))
	experience = int(d.get("experience", 0))
	run_seed = int(d.get("run_seed", 0))
	squad.clear()
	var raw_squad: Dictionary = d.get("squad", {})
	for key: Variant in raw_squad:
		var snap := CharacterSnapshot.from_dict(raw_squad[key])
		squad[StringName(str(key))] = snap
