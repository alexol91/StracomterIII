class_name LevelLoader
extends Node
## Monta una planta jugable a partir de un mapa convertido.
##
## Es la pieza que faltaba entre "sistemas probados" y "juego": el conversor
## emite los mapas como geometría más **marcadores con metadatos**, y alguien
## tiene que instanciar las escenas reales encima, hornear navegación y
## coberturas, y colocar a los personajes. Eso es esto.
##
## Vive en `levels/` y no en `gameplay/` ni en `ai/` a propósito: es pegamento
## entre capas, y ponerlo dentro de una de ellas obligaría a esa capa a conocer
## a las otras dos (ADR-001).
##
## Cierra además una deuda concreta: hasta ahora los obstáculos de los mapas
## eran `Marker3D` sin colisión, así que el horneado de coberturas solo veía
## muros y **ninguna mesa producía la cobertura baja** para la que existe la
## doble altura del baker.

const DOOR_SCENE: String = "res://scenes/gameplay/door.tscn"
const OBSTACLE_SCENE: String = "res://scenes/gameplay/obstacle.tscn"
const PICKUP_SCENE: String = "res://scenes/gameplay/pickup.tscn"
const PLAYER_SCENE: String = "res://scenes/gameplay/player.tscn"
const ENEMY_SCENE: String = "res://scenes/gameplay/enemy.tscn"

## Nombre del subtipo del conversor → enum de obstáculo. El conversor emite el
## nombre del enumerado del legacy (`obs_desk`, `obs_sofa`…); traducirlo aquí
## evita que `gameplay/` tenga que conocer la nomenclatura de 2012.
const OBSTACLE_BY_NAME: Dictionary[String, int] = {
	"obs_table": Obstacle.Kind.TABLE,
	"obs_desk": Obstacle.Kind.DESK,
	"obs_couch": Obstacle.Kind.COUCH,
	"obs_sofa": Obstacle.Kind.SOFA,
	"obs_chair": Obstacle.Kind.CHAIR,
	"obs_shelf": Obstacle.Kind.SHELF,
	"obs_plantPot": Obstacle.Kind.PLANT_POT,
	"obs_mesaConSillas": Obstacle.Kind.TABLE_WITH_CHAIRS,
}

const PICKUP_BY_NAME: Dictionary[String, int] = {
	"health_pack_1": Pickup.PickupClass.HEALTH_PACK_1,
	"health_pack_2": Pickup.PickupClass.HEALTH_PACK_2,
	"health_pack_3": Pickup.PickupClass.HEALTH_PACK_3,
	"ammo_pack_1": Pickup.PickupClass.AMMO_PACK_1,
	"ammo_pack_2": Pickup.PickupClass.AMMO_PACK_2,
	"ammo_pack_3": Pickup.PickupClass.AMMO_PACK_3,
	"sniper": Pickup.PickupClass.SNIPER,
}

signal level_ready(level: Node3D)
signal level_unloaded()

## Resultado de montar una planta. Se devuelve entero para que quien lo pida no
## tenga que ir rebuscando nodos por nombre.
class LoadedLevel:
	extends RefCounted

	var root: Node3D = null
	var player: Character = null
	var player_spawn: Transform3D = Transform3D.IDENTITY
	var companion_spawns: Array[Transform3D] = []
	var doors: Array[Node] = []
	var obstacles: Array[Node] = []
	var pickups: Array[Node] = []
	var miniboss_spawn: Vector3 = Vector3.INF
	var megaboss_spawn: Vector3 = Vector3.INF
	## Área navegable en m², medida tras hornear. Alimenta al director.
	var navigable_area_m2: float = 0.0

	func has_player_spawn() -> bool:
		return player != null or player_spawn != Transform3D.IDENTITY


var _current: LoadedLevel = null


func current() -> LoadedLevel:
	return _current


## Monta la planta desde la ruta de una escena de mapa convertida.
## `spawn_player` en false permite montar el nivel para pruebas o para el
## editor sin meter un personaje dentro.
func load_level(map_scene_path: String, archetype: StringName = &"captain",
		spawn_player: bool = true) -> LoadedLevel:
	unload()

	if not ResourceLoader.exists(map_scene_path):
		push_error("LevelLoader: no existe el mapa '%s'" % map_scene_path)
		return null
	var packed := load(map_scene_path) as PackedScene
	if packed == null:
		push_error("LevelLoader: '%s' no es una escena" % map_scene_path)
		return null

	var level := LoadedLevel.new()
	level.root = packed.instantiate() as Node3D
	if level.root == null:
		push_error("LevelLoader: la raíz de '%s' no es un Node3D" % map_scene_path)
		return null
	add_child(level.root)

	_populate_doors(level)
	_populate_obstacles(level)
	_populate_pickups(level)
	_read_spawns(level)

	if spawn_player and level.player_spawn != Transform3D.IDENTITY:
		level.player = _spawn_character(level, PLAYER_SCENE, archetype,
			Character.Team.PLAYER, level.player_spawn)

	_current = level
	level_ready.emit(level.root)
	return level


func unload() -> void:
	if _current == null:
		return
	if is_instance_valid(_current.root):
		_current.root.queue_free()
	_current = null
	level_unloaded.emit()


## Instancia un enemigo del arquetipo pedido en una posición ya validada por el
## director. El loader NO decide dónde ni cuántos: eso es del director, que es
## quien tiene las reglas de justicia.
func spawn_enemy(archetype: StringName, position: Vector3, squad_id: int = 0) -> Character:
	if _current == null:
		return null
	var xform := Transform3D(Basis.IDENTITY, position)
	var enemy := _spawn_character(_current, ENEMY_SCENE, archetype,
		Character.Team.ENEMY, xform)
	if enemy != null:
		enemy.squad_id = squad_id
	return enemy


# --- Poblado desde marcadores ---

func _populate_doors(level: LoadedLevel) -> void:
	var group := level.root.get_node_or_null("Doors")
	if group == null:
		return
	var scene := _load_scene(DOOR_SCENE)
	if scene == null:
		return
	var next_id := 0
	for marker: Node in group.get_children():
		var m := marker as Marker3D
		if m == null:
			continue
		var door := scene.instantiate()
		door.set("door_id", next_id)
		next_id += 1
		_transfer_meta(m, door, ["width_m", "depth_m", "height_m", "use_radius_m"])
		_replace_marker(m, door)
		level.doors.append(door)


func _populate_obstacles(level: LoadedLevel) -> void:
	var group := level.root.get_node_or_null("Obstacles")
	if group == null:
		return
	var scene := _load_scene(OBSTACLE_SCENE)
	if scene == null:
		return
	for marker: Node in group.get_children():
		var m := marker as Marker3D
		if m == null:
			continue
		var obstacle := scene.instantiate()
		var name_meta := str(m.get_meta("subtype_name", "obs_table"))
		obstacle.set("kind", OBSTACLE_BY_NAME.get(name_meta, Obstacle.Kind.TABLE))
		_replace_marker(m, obstacle)
		level.obstacles.append(obstacle)


func _populate_pickups(level: LoadedLevel) -> void:
	var group := level.root.get_node_or_null("Pickups")
	if group == null:
		return
	var scene := _load_scene(PICKUP_SCENE)
	if scene == null:
		return
	for marker: Node in group.get_children():
		var m := marker as Marker3D
		if m == null:
			continue
		var name_meta := str(m.get_meta("subtype_name", "health_pack_1"))
		if not PICKUP_BY_NAME.has(name_meta):
			# El legacy tenía clases de objeto sin efecto implementado. Se
			# ignoran en silencio a propósito, pero se deja constancia: un mapa
			# con objetos desconocidos no debe reventar la carga.
			push_warning("LevelLoader: objeto desconocido '%s', ignorado" % name_meta)
			m.queue_free()
			continue
		var pickup := scene.instantiate()
		pickup.set("pickup_class", PICKUP_BY_NAME[name_meta])
		_replace_marker(m, pickup)
		level.pickups.append(pickup)


func _read_spawns(level: LoadedLevel) -> void:
	var group := level.root.get_node_or_null("Spawns")
	if group == null:
		return
	for child: Node in group.get_children():
		var m := child as Marker3D
		if m == null:
			continue
		match str(m.get_meta("type", "")):
			"player":
				level.player_spawn = m.global_transform
				for sub: Node in m.get_children():
					var offset := sub as Marker3D
					if offset != null:
						level.companion_spawns.append(offset.global_transform)
			"miniBoss":
				level.miniboss_spawn = m.global_position
			"megaBoss":
				level.megaboss_spawn = m.global_position


# --- Utilidades ---

func _load_scene(path: String) -> PackedScene:
	if not ResourceLoader.exists(path):
		push_error("LevelLoader: falta la escena '%s'" % path)
		return null
	return load(path) as PackedScene


## Sustituye el marcador por el nodo real conservando su transformación. Se
## reparenta en el sitio del marcador para no alterar la jerarquía del mapa.
func _replace_marker(marker: Marker3D, replacement: Node) -> void:
	var parent := marker.get_parent()
	var xform := marker.transform
	parent.add_child(replacement)
	if replacement is Node3D:
		(replacement as Node3D).transform = xform
	replacement.name = marker.name
	marker.queue_free()


func _transfer_meta(from: Node, to: Node, keys: Array[String]) -> void:
	for key: String in keys:
		if from.has_meta(key):
			to.set_meta(key, from.get_meta(key))


func _spawn_character(level: LoadedLevel, scene_path: String,
		archetype: StringName, team: Character.Team,
		xform: Transform3D) -> Character:
	var scene := _load_scene(scene_path)
	if scene == null:
		return null
	var character := scene.instantiate() as Character
	if character == null:
		push_error("LevelLoader: '%s' no instancia un Character" % scene_path)
		return null
	character.archetype = archetype
	character.team = team
	level.root.add_child(character)
	character.global_transform = xform
	return character
