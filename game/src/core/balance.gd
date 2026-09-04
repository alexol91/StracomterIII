extends Node
## Carga y sirve todos los datos de balanceo (ADR-005).
##
## El proyecto original tenía las estadísticas TRIPLICADAS y con valores
## contradictorios entre CoreNamespace.h, testFiles/entities.xml y
## testFiles/features/f1.xml. Aquí hay una sola fuente de verdad.

## Factor de conversión de las unidades del legacy a metros.
## El legacy usaba radio de personaje 30 (Core::Radius); el remake usa 0,4 m.
const LEGACY_TO_METERS: float = 1.0 / 75.0

## Multiplicadores de daño por zona de impacto.
const HEADSHOT_MULTIPLIER: float = 2.5
const TORSO_MULTIPLIER: float = 1.0
const LIMB_MULTIPLIER: float = 0.7

const CHARACTERS_DIR: String = "res://src/data/characters/"
const WEAPONS_DIR: String = "res://src/data/weapons/"
const FLOORS_DIR: String = "res://src/data/floors/"
const PICKUPS_DIR: String = "res://src/data/pickups/"
const DIRECTOR_PROFILE_PATH: String = "res://src/data/director_profile.tres"

var _characters: Dictionary[StringName, CharacterStats] = {}
var _weapons: Dictionary[StringName, WeaponStats] = {}
var _floors: Dictionary[int, FloorConfig] = {}
var _pickups: Dictionary[StringName, PickupStats] = {}
var _director_profile: DirectorProfile = null


func _ready() -> void:
	reload()


## Recarga todos los datos desde disco. Llamable desde la consola para
## rebalancear en caliente sin reiniciar.
func reload() -> void:
	_characters.clear()
	_weapons.clear()
	_floors.clear()
	_pickups.clear()
	for res: Resource in _load_dir(PICKUPS_DIR):
		var pick := res as PickupStats
		if pick != null and pick.id != &"":
			_pickups[pick.id] = pick
	for res: Resource in _load_dir(CHARACTERS_DIR):
		var stats := res as CharacterStats
		if stats != null and stats.id != &"":
			_characters[stats.id] = stats
	for res: Resource in _load_dir(WEAPONS_DIR):
		var stats := res as WeaponStats
		if stats != null and stats.id != &"":
			_weapons[stats.id] = stats
	for res: Resource in _load_dir(FLOORS_DIR):
		var cfg := res as FloorConfig
		if cfg != null:
			_floors[cfg.floor_number] = cfg
	if ResourceLoader.exists(DIRECTOR_PROFILE_PATH):
		_director_profile = load(DIRECTOR_PROFILE_PATH) as DirectorProfile
	if _director_profile == null:
		_director_profile = DirectorProfile.new()


func character(id: StringName) -> CharacterStats:
	return _characters.get(id, null)


func weapon(id: StringName) -> WeaponStats:
	return _weapons.get(id, null)


func pickup(id: StringName) -> PickupStats:
	return _pickups.get(id, null)


func floor_config(floor_number: int) -> FloorConfig:
	return _floors.get(floor_number, null)


func director_profile() -> DirectorProfile:
	return _director_profile


func character_ids() -> Array[StringName]:
	var ids: Array[StringName] = []
	for key: StringName in _characters:
		ids.append(key)
	ids.sort()
	return ids


func _load_dir(path: String) -> Array[Resource]:
	var out: Array[Resource] = []
	if not DirAccess.dir_exists_absolute(path):
		return out
	for file_name: String in DirAccess.get_files_at(path):
		# Los .tres exportados aparecen como .tres.remap en builds exportadas.
		var clean := file_name.trim_suffix(".remap")
		if not clean.ends_with(".tres"):
			continue
		var res := load(path + clean)
		if res != null:
			out.append(res)
	return out
