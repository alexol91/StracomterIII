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

## Telemetría: efectos que han llegado a sonar y el último de ellos. Para las
## pruebas y para la consola — un sistema de audio sin forma de comprobar qué
## ha sonado es un sistema que se puede quedar mudo sin que nadie se entere,
## que es justo lo que pasó.
var stat_sfx_played: int = 0
var last_sfx_id: StringName = &""

var _buffers: Dictionary[StringName, AudioStream] = {}
var _players: Array[AudioStreamPlayer3D] = []
var _music_player: AudioStreamPlayer = null
var _next_player: int = 0

## Voces simultáneas. El original usaba un anillo de 20; con menos se cortan
## los disparos encadenados y con muchas más solo se gasta memoria.
const VOICE_COUNT: int = 20


## Segundos mínimos entre dos quejidos. Sin esto, una ráfaga de ametralladora
## sobre un compañero suena como una ametralladora de quejidos: cada bala
## publica su `character_damaged`.
const HURT_COOLDOWN_S: float = 0.35

## Momento del último quejido por víctima, en tiempo de simulación.
var _last_hurt_s: Dictionary[int, float] = {}
var _clock_s: float = 0.0


func _process(delta: float) -> void:
	_clock_s += delta


func _ready() -> void:
	# El director de audio ESCUCHA el bus. Es la única forma de que un disparo,
	# una muerte o un cambio de pantalla suenen sin que `gameplay/` y `ui/`
	# tengan que acordarse de avisar — y de que suenen TODOS, que es lo que no
	# pasaba: de las ocho muestras cargadas solo se oía el disparo. `dead`,
	# `ouch`, `explosion`, `step` y `go` estaban en el repositorio, importadas,
	# y no las pedía nadie; `play_music` no la llamaba NI UN fichero, así que la
	# pista de créditos —la única que se puede distribuir, compuesta por el
	# propio equipo— tampoco se oía nunca.
	EventBus.character_died.connect(_on_character_died)
	EventBus.character_damaged.connect(_on_character_damaged)
	EventBus.game_mode_changed.connect(_on_game_mode_changed)
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
		_release_music()
		return
	_music_player.stream = load(path) as AudioStream
	_music_player.play()


func stop_music(_fade_s: float = 1.0) -> void:
	current_music = MusicState.NONE
	_release_music()


## Para la música y SUELTA la pista. Lo segundo no es limpieza de estilo: un
## `AudioStreamPlayer` parado sigue agarrando su `AudioStream`, y con él el
## `OggPacketSequence` y los dos objetos de reproducción que crea el
## descodificador. Al cerrar el proceso eso sale como «4 ObjectDB instances
## were leaked at exit» con `credits.ogg` nombrado como recurso en uso.
##
## Lo delató la propia suite en cuanto la música empezó a sonar de verdad: la
## primera vez que este proyecto reproduce una pista, aparece el aviso. Es la
## familia de fallo que ya ha costado dos veces aquí —referencias que
## sobreviven al árbol de escena— y el síntoma es el de siempre: todo verde y
## un aviso al salir que en CI puede acabar en código 134.
func _release_music() -> void:
	if _music_player == null:
		return
	_music_player.stop()
	_music_player.stream = null


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
	if stream == null:
		# Un id que no existe se AVISA. Es exactamente lo que ocultó que tres de
		# las cuatro clases jugables disparasen en silencio durante meses:
		# `WeaponSystem` pedía el sonido por el id del arma (`smg`,
		# `machinegun`, `sniper`, `grenade_launcher`) y ninguno de esos es el
		# nombre de una muestra. No sonaba nada y nada lo decía. Con el aviso,
		# la comprobación de arranque limpio lo convierte en un fallo de CI.
		push_warning("AudioDirector: nadie ha cargado el efecto '%s'" % id)
		return
	if _players.is_empty():
		return
	var player := _players[_next_player]
	_next_player = (_next_player + 1) % _players.size()
	player.stream = stream
	player.global_position = position
	player.play()
	stat_sfx_played += 1
	last_sfx_id = id


## Al cerrar hay que SOLTAR el audio, no solo dejar de sonar.
##
## Lo delató la propia suite: en cuanto la música empezó a sonar de verdad, el
## proceso terminaba con «4 ObjectDB instances were leaked at exit» y
## `credits.ogg` nombrado como recurso todavía en uso. El reproductor sigue
## agarrando el `AudioStream` cuando el árbol se desmonta, y con él el
## `OggPacketSequence` y sus dos objetos de reproducción.
##
## No es cosmético: es la misma familia de fallo que ya costó dos veces en este
## proyecto —referencias que sobreviven al árbol de escena— y el síntoma es el
## de siempre, verde por dentro y un aviso al salir que en CI puede acabar en
## código 134.
func _exit_tree() -> void:
	if _music_player != null:
		_music_player.stop()
		_music_player.stream = null
	for player: AudioStreamPlayer3D in _players:
		if is_instance_valid(player):
			player.stop()
			player.stream = null
	_buffers.clear()
	if EventBus.character_died.is_connected(_on_character_died):
		EventBus.character_died.disconnect(_on_character_died)
	if EventBus.character_damaged.is_connected(_on_character_damaged):
		EventBus.character_damaged.disconnect(_on_character_damaged)
	if EventBus.game_mode_changed.is_connected(_on_game_mode_changed):
		EventBus.game_mode_changed.disconnect(_on_game_mode_changed)


func _on_character_died(character_id: int, _team: int, _killer_id: int, _xp: int) -> void:
	var body := instance_from_id(character_id) as Node3D
	if body == null or not is_instance_valid(body):
		return
	_last_hurt_s.erase(character_id)
	# Sin ruido para la IA: un muerto no hace ruido táctico, y si lo hiciera
	# la escuadra iría a investigar a su propio cadáver.
	play_sfx_3d(&"dead", body.global_position)


func _on_character_damaged(
	character_id: int, _amount: float, _from: Vector3, _attacker_id: int, _attacker_team: int
) -> void:
	var body := instance_from_id(character_id) as Node3D
	if body == null or not is_instance_valid(body):
		return
	var last: float = _last_hurt_s.get(character_id, -INF)
	if _clock_s - last < HURT_COOLDOWN_S:
		return
	_last_hurt_s[character_id] = _clock_s
	play_sfx_3d(&"ouch", body.global_position)


## Música por estado de juego. Solo la de créditos existe; los demás estados
## quedan en silencio hasta tener pista propia, pero el cableado está y se ve
## en `current_music`.
func _on_game_mode_changed(_previous: int, current: int) -> void:
	match current:
		GameState.Mode.MENU:
			play_music(MusicState.MENU)
		GameState.Mode.STRATEGY:
			play_music(MusicState.STRATEGY)
		GameState.Mode.ACTION:
			play_music(MusicState.COMBAT)
		GameState.Mode.CREDITS:
			play_music(MusicState.CREDITS)
		_:
			stop_music()


func play_ui(_id: StringName) -> void:
	pass


func set_bus_volume_db(bus: StringName, db: float) -> void:
	var idx := AudioServer.get_bus_index(String(bus))
	if idx >= 0:
		AudioServer.set_bus_volume_db(idx, db)
