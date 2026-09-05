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

## Paquete de personajes que usa el remake. NO es un segundo interruptor del
## mismo eje —eso ya se juntó una vez y con razón—: `chutaos_mode` decide si se
## juega el juego de 2012 o el remake, y esto decide con qué modelos se juega el
## remake. Son dos preguntas distintas.
## `UBC` es el paquete por defecto: cuerpos `Universal Base Characters` de
## Quaternius (CC0) vestidos con los uniformes horneados por
## `tools/character_skins/`. `KAYKIT` es el paquete anterior, de bloques, que se
## conserva como reserva. `TF2` son los modelos de Valve importados de la
## instalación del jugador.
enum Pack { UBC, KAYKIT, TF2 }

const MODELS_CHUTAOS: String = "res://scenes/models/"
const MODELS_MODERN: String = "res://scenes/models_modern/"
## Modelos de Team Fortress 2, importados de la instalación del jugador por
## `tools/tf2_import/`. Van SUELTOS y fuera de git: son de Valve, y este
## repositorio es público, así que meterlos aquí no sería uso privado sino
## redistribución. La carpeta está en `.gitignore` y el juego funciona sin ella.
const MODELS_TF2: String = "res://assets/models/characters_tf2/"

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

## Paquete de personajes del remake. Cambiarlo emite `style_changed` como
## cualquier otro cambio de estilo: los personajes ya vivos tienen que poder
## cambiar de modelo en caliente.
var character_pack: Pack = Pack.UBC:
	set(value):
		if character_pack == value:
			return
		character_pack = value
		style_changed.emit(chutaos_mode)

var _material_cache: Dictionary[String, Material] = {}
## Biblioteca de animaciones compartida por los nueve arquetipos. Se guarda
## aquí —en un autoload, que es un nodo con ciclo de vida— y no en una variable
## `static`: una `static` sobrevive al árbol de escena y ya ha costado dos
## abortos por corrupción de memoria en este proyecto.
var _animation_library: AnimationLibrary = null
var _animation_library_loaded: bool = false


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


## Ruta del modelo de TF2 de un arquetipo, exista o no.
func tf2_path_for(archetype: StringName) -> String:
	return MODELS_TF2 + String(archetype) + ".glb"


## ¿Hay modelos de TF2 importados? Se pregunta por arquetipo y no una sola vez:
## una importación a medias tiene que degradar mueble a mueble, no dejar la
## planta entera sin personajes.
func has_tf2_model(archetype: StringName) -> bool:
	return ResourceLoader.exists(tf2_path_for(archetype))


func tf2_available() -> bool:
	for id: StringName in Balance.character_ids():
		if has_tf2_model(id):
			return true
	return false


func archetypes_without_tf2() -> Array[StringName]:
	var missing: Array[StringName] = []
	for id: StringName in Balance.character_ids():
		if not has_tf2_model(id):
			missing.append(id)
	return missing


## Monta el modelo del arquetipo en el estilo y paquete activos.
##
## Es una fábrica y no una ruta porque los tres orígenes no tienen la misma
## forma: los de 2012 y los de KayKit son escenas `.tscn` con su animador
## dentro, y los de TF2 son un `.glb` suelto que hay que envolver aquí. Quien
## pide un personaje no tiene por qué saber cuál de las tres cosas le toca.
func instantiate_model(archetype: StringName) -> Node3D:
	if not chutaos_mode:
		if character_pack == Pack.TF2 and has_tf2_model(archetype):
			var glb := load(tf2_path_for(archetype)) as PackedScene
			if glb != null:
				var wrapper := Node3D.new()
				wrapper.set_script(load("res://src/gameplay/modern_animator.gd"))
				wrapper.add_child(glb.instantiate())
				return wrapper
		if character_pack == Pack.UBC and UbcModel.has(archetype):
			var ubc := UbcModel.build(archetype, animation_library())
			if ubc != null:
				return ubc
	var path := scene_path_for(archetype)
	if not ResourceLoader.exists(path):
		return null
	var packed := load(path) as PackedScene
	return packed.instantiate() as Node3D if packed != null else null


## Biblioteca de animaciones de Quaternius, cargada una sola vez.
##
## Sacarla del `.glb` cuesta instanciar el maniquí entero, así que se hace en la
## primera petición y se reparte. `_animation_library_loaded` existe aparte del
## puntero para no reintentarlo en cada personaje cuando el fichero no está: sin
## la bandera, un paquete incompleto costaría una instanciación fallida por
## cada enemigo que aparece.
func animation_library() -> AnimationLibrary:
	if _animation_library_loaded:
		return _animation_library
	_animation_library_loaded = true
	if not ResourceLoader.exists(UbcModel.ANIMATION_SOURCE):
		return null
	var packed := load(UbcModel.ANIMATION_SOURCE) as PackedScene
	if packed == null:
		return null
	var root := packed.instantiate()
	var player := root.get_node_or_null("AnimationPlayer") as AnimationPlayer
	if player != null:
		var source := player.get_animation_library("")
		_animation_library = AnimationLibrary.new()
		# Los clips se copian tal cual: el importador de Godot ya recorta el
		# sufijo `_Loop` del nombre y marca el bucle. Volver a marcarlo aquí
		# por el nombre del fichero no habría hecho nada, porque para cuando
		# llegan aquí ese sufijo ya no está.
		for clip: StringName in source.get_animation_list():
			_animation_library.add_animation(clip, source.get_animation(clip).duplicate(true))
	root.free()
	return _animation_library


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
	if UbcModel.has(archetype):
		return true
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
