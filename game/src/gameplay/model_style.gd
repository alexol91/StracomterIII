extends Node
## Decide con qué aspecto se ven los personajes: el de 2012 o el nuevo.
##
## Existe porque las dos respuestas son legítimas. Los modelos originales son
## el trabajo del equipo y tienen valor sentimental e histórico; los nuevos
## hacen que el juego se pueda enseñar sin pedir perdón. En vez de elegir por
## el jugador, se conmuta en caliente con `: retro on` / `: retro off`.
##
## Es un autoload porque el estilo tiene que sobrevivir al cambio de planta:
## si viviera en la escena del nivel, cada zona nueva volvería al valor por
## defecto y el truco parecería roto.

signal style_changed(retro: bool)

## Rutas de las escenas de personaje de cada estilo. Un arquetipo sin entrada
## en `modern` cae al retro: es preferible ver el modelo de 2012 a no ver nada.
const RETRO_DIR: String = "res://scenes/models/"
const MODERN_DIR: String = "res://scenes/models_modern/"

var retro_enabled: bool = true:
	set(value):
		if retro_enabled == value:
			return
		retro_enabled = value
		style_changed.emit(retro_enabled)


## Escena de personaje para un arquetipo, según el estilo activo.
func scene_path_for(archetype: StringName) -> String:
	if not retro_enabled:
		var modern := MODERN_DIR + String(archetype) + ".tscn"
		if ResourceLoader.exists(modern):
			return modern
	return RETRO_DIR + String(archetype) + ".tscn"


## ¿Hay modelo moderno para este arquetipo? Lo usa la consola para avisar de
## que un `: retro off` no va a cambiar nada todavía.
func has_modern(archetype: StringName) -> bool:
	return ResourceLoader.exists(MODERN_DIR + String(archetype) + ".tscn")


## Arquetipos que aún no tienen modelo moderno.
func archetypes_without_modern() -> Array[StringName]:
	var missing: Array[StringName] = []
	for id: StringName in Balance.character_ids():
		if not has_modern(id):
			missing.append(id)
	return missing
