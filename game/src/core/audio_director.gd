extends Node
## Contrato del audio. La implementación es de `arte-audio`.
##
## Réplica moderna de AudioControl/TSound/TMusic/TListener del legacy
## (legacy/trunk/sound/), que envolvían SFML Audio.

## Estados musicales. Réplica ampliada del enumerado Audio::Music del legacy.
enum MusicState { NONE, MENU, STRATEGY, COMBAT, TENSION, BOSS, CREDITS }

## Buses esperados en el proyecto de audio.
const BUS_MASTER: StringName = &"Master"
const BUS_MUSIC: StringName = &"Music"
const BUS_SFX: StringName = &"SFX"
const BUS_VOICE: StringName = &"Voice"
const BUS_UI: StringName = &"UI"

var current_music: MusicState = MusicState.NONE
## Paquete de voces opcional "Chutaos" (las del original). GDD §11.
var joke_pack_enabled: bool = false


## Cambia el estado musical con fundido.
func play_music(state: MusicState, _fade_s: float = 1.5) -> void:
	current_music = state


func stop_music(_fade_s: float = 1.0) -> void:
	current_music = MusicState.NONE


## Reproduce un efecto posicional en el mundo. Además de sonar, debe publicar
## el evento de ruido para el oído de la IA cuando `emit_noise` sea true.
func play_sfx_3d(
	_id: StringName,
	position: Vector3,
	noise_intensity: float = 0.0,
	noise_radius_m: float = 0.0,
	source_id: int = 0
) -> void:
	if noise_intensity > 0.0:
		EventBus.emit_noise(position, noise_intensity, noise_radius_m, source_id)


func play_ui(_id: StringName) -> void:
	pass


func set_bus_volume_db(bus: StringName, db: float) -> void:
	var idx := AudioServer.get_bus_index(String(bus))
	if idx >= 0:
		AudioServer.set_bus_volume_db(idx, db)
