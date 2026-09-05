extends Node
## Un solo eje para todo el aspecto del juego: **Chutaos** o **moderno**.
##
## Antes había dos conmutadores (`retro` para los modelos y `chutaos` para el
## audio) y era el mismo eje partido en dos. Un jugador que pone `: chutaos on`
## espera el juego de 2012 entero: sus modelos, sus voces de broma y sus
## texturas planas. Que se pudiera activar media nostalgia era un defecto de
## diseño, no una opción.
##
##   Chutaos ON  → modelos de 2012, voces de broma, materiales planos
##   Chutaos OFF → modelos nuevos, audio serio, materiales de oficina
##
## Es autoload porque el estilo debe sobrevivir al cambio de planta: si viviera
## en la escena del nivel, cada zona nueva volvería al valor por defecto y el
## truco parecería roto.

signal style_changed(chutaos: bool)

## El vocabulario de superficies vive en `WorldSurface` (ver el porqué allí):
## el nivel no conoce nombres de fichero, pide "una pared" y el estilo decide
## con qué se pinta.

const MODELS_CHUTAOS: String = "res://scenes/models/"
const MODELS_MODERN: String = "res://scenes/models_modern/"
const MATERIALS_CHUTAOS: String = "res://assets/materials/chutaos/"
const MATERIALS_MODERN: String = "res://assets/materials/modern/"

const SURFACE_FILES: Dictionary[WorldSurface.Kind, String] = {
	WorldSurface.Kind.FLOOR: "floor.tres",
	WorldSurface.Kind.WALL: "wall.tres",
	WorldSurface.Kind.CEILING: "ceiling.tres",
	WorldSurface.Kind.DOOR: "door.tres",
	WorldSurface.Kind.GLASS: "glass.tres",
	WorldSurface.Kind.TRIM: "trim.tres",
	WorldSurface.Kind.PROP: "prop.tres",
}

## Verdadero = juego de 2012 completo. Arranca en falso: el remake se presenta
## con su cara nueva y la nostalgia es lo que se activa, no al revés.
var chutaos_mode: bool = false:
	set(value):
		if chutaos_mode == value:
			return
		chutaos_mode = value
		_apply()
		style_changed.emit(chutaos_mode)

var _material_cache: Dictionary[String, Material] = {}


func _ready() -> void:
	_apply()


## Escena de personaje del estilo activo.
func scene_path_for(archetype: StringName) -> String:
	if not chutaos_mode:
		var modern := MODELS_MODERN + String(archetype) + ".tscn"
		if ResourceLoader.exists(modern):
			return modern
	# Reserva al modelo de 2012: es preferible ver el original a no ver nada.
	return MODELS_CHUTAOS + String(archetype) + ".tscn"


## Material de una superficie del mundo, según el estilo activo.
func surface_material(surface: WorldSurface.Kind) -> Material:
	var file: String = SURFACE_FILES.get(surface, "")
	if file.is_empty():
		return null
	var root := MATERIALS_CHUTAOS if chutaos_mode else MATERIALS_MODERN
	var path := root + file
	if not ResourceLoader.exists(path):
		# Sin material del estilo pedido se cae al otro antes que devolver
		# nada: una superficie sin material se ve de un magenta chillón y
		# parece un error del nivel, no del estilo.
		path = (MATERIALS_MODERN if chutaos_mode else MATERIALS_CHUTAOS) + file
	if not ResourceLoader.exists(path):
		return null
	if not _material_cache.has(path):
		_material_cache[path] = load(path) as Material
	return _material_cache[path]


func has_modern_model(archetype: StringName) -> bool:
	return ResourceLoader.exists(MODELS_MODERN + String(archetype) + ".tscn")


func archetypes_without_modern() -> Array[StringName]:
	var missing: Array[StringName] = []
	for id: StringName in Balance.character_ids():
		if not has_modern_model(id):
			missing.append(id)
	return missing


## Nombre legible del estilo activo, para la consola y la interfaz.
func style_name() -> String:
	return "Chutaos (2012)" if chutaos_mode else "Torre Chutaos (remake)"


## Aplica lo que depende del estilo y no vive aquí. El audio es el caso claro:
## el paquete de voces forma parte del mismo eje, así que se mueve con él en
## lugar de exigir dos comandos coordinados.
func _apply() -> void:
	if AudioDirector != null:
		AudioDirector.joke_pack_enabled = chutaos_mode
