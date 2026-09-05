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

## Paquetes de efectos. El original elegía uno u otro por la simple presencia
## de un fichero `testFiles/sound/joke.txt` (`AudioControl.cc:47`); aquí es una
## opción, pero el mecanismo de fondo es el mismo: dos carpetas con los mismos
## nombres de fichero y un prefijo que decide cuál suena.
const PACK_NORMAL: String = "res://assets/audio/sfx/normal/"
const PACK_CHUTAOS: String = "res://assets/audio/sfx/chutaos/"

## Efectos disponibles. Los nombres son los del legacy para que la
## correspondencia con el material grabado en 2012 sea evidente.
const EFFECTS: Array[String] = [
	"pistol", "machine", "knife", "step", "dead", "ouch", "explosion", "go",
]

var current_music: MusicState = MusicState.NONE
## Paquete de voces "Chutaos": las tomas de broma que grabó el equipo original.
## Se conservan porque son parte de la identidad del proyecto (GDD §11).
var joke_pack_enabled: bool = false:
	set(value):
		joke_pack_enabled = value
		_reload_pack()

var _buffers: Dictionary[StringName, AudioStream] = {}
var _players: Array[AudioStreamPlayer3D] = []
var _music_player: AudioStreamPlayer = null
var _next_player: int = 0

## Voces simultáneas. El original usaba un anillo de 20; con menos se cortan
## los disparos encadenados y con muchas más solo se gasta memoria.
const VOICE_COUNT: int = 20


func _ready() -> void:
	for i: int in range(VOICE_COUNT):
		var player := AudioStreamPlayer3D.new()
		player.bus = String(BUS_SFX)
		add_child(player)
		_players.append(player)
	_music_player = AudioStreamPlayer.new()
	_music_player.bus = String(BUS_MUSIC)
	add_child(_music_player)
	_reload_pack()


## Carga el paquete activo. Un efecto que falte no revienta el juego: se avisa
## y ese sonido queda mudo, porque quedarse sin audio es molesto pero quedarse
## sin juego es peor.
func _reload_pack() -> void:
	if not is_inside_tree():
		return
	_buffers.clear()
	var root := PACK_CHUTAOS if joke_pack_enabled else PACK_NORMAL
	for name: String in EFFECTS:
		var path := root + name + ".ogg"
		if ResourceLoader.exists(path):
			_buffers[StringName(name)] = load(path) as AudioStream
		else:
			push_warning("AudioDirector: falta el efecto '%s'" % path)


## Nombres de los efectos realmente cargados. Para pruebas y para la consola.
func loaded_effects() -> Array[StringName]:
	var out: Array[StringName] = []
	for key: StringName in _buffers:
		out.append(key)
	out.sort()
	return out


## Pistas de música disponibles. Solo está la de créditos, que compuso el
## propio equipo (sus metadatos dicen `ARTIST=Chutaos Team`). La música que el
## original usaba en menú y acción son dos temas de The Prodigy: no se puede
## distribuir, así que esos estados quedan en silencio hasta tener pista propia.
const MUSIC_TRACKS: Dictionary[MusicState, String] = {
	MusicState.CREDITS: "res://assets/audio/music/credits.ogg",
}


## Cambia el estado musical.
func play_music(state: MusicState, _fade_s: float = 1.5) -> void:
	current_music = state
	if _music_player == null:
		return
	var path: String = MUSIC_TRACKS.get(state, "")
	if path.is_empty() or not ResourceLoader.exists(path):
		_music_player.stop()
		return
	_music_player.stream = load(path) as AudioStream
	_music_player.play()


func stop_music(_fade_s: float = 1.0) -> void:
	current_music = MusicState.NONE
	if _music_player != null:
		_music_player.stop()


## Reproduce un efecto posicional en el mundo. Además de sonar, debe publicar
## el evento de ruido para el oído de la IA cuando `emit_noise` sea true.
func play_sfx_3d(
	id: StringName,
	position: Vector3,
	noise_intensity: float = 0.0,
	noise_radius_m: float = 0.0,
	source_id: int = 0
) -> void:
	# El evento de ruido se publica SIEMPRE que se pida, suene o no el efecto:
	# el oído de la IA no puede depender de que un fichero de audio exista.
	if noise_intensity > 0.0:
		EventBus.emit_noise(position, noise_intensity, noise_radius_m, source_id)
	var stream: AudioStream = _buffers.get(id, null)
	if stream == null or _players.is_empty():
		return
	var player := _players[_next_player]
	_next_player = (_next_player + 1) % _players.size()
	player.stream = stream
	player.global_position = position
	player.play()


func play_ui(_id: StringName) -> void:
	pass


func set_bus_volume_db(bus: StringName, db: float) -> void:
	var idx := AudioServer.get_bus_index(String(bus))
	if idx >= 0:
		AudioServer.set_bus_volume_db(idx, db)
