extends TestCase
## El director de audio escucha el bus.
##
## De las ocho muestras del paquete solo se oía UNA: el disparo. `dead`,
## `ouch`, `explosion`, `step` y `go` estaban en el repositorio, importadas, y
## no las pedía ningún fichero; `play_music` no la llamaba NI UNO, así que la
## pista de créditos —la única distribuible, compuesta por el propio equipo— no
## se oía nunca. Y el disparo solo sonaba con la pistola y el cuchillo: los
## demás se pedían por el id del arma (`smg`, `machinegun`, `sniper`,
## `grenade_launcher`) y ninguno de esos es el nombre de una muestra.
##
## Nada de eso daba un error. Un juego mudo arranca perfectamente.

var _spawned: Array[Node] = []
var _music_before: AudioDirector.MusicState = AudioDirector.MusicState.NONE


func before_each() -> void:
	_music_before = AudioDirector.current_music


func after_each() -> void:
	for n: Node in _spawned:
		if is_instance_valid(n):
			if n.get_parent() != null:
				n.get_parent().remove_child(n)
			n.free()
	_spawned.clear()
	AudioDirector.play_music(_music_before)


func _body() -> Character:
	var body := Character.new()
	body.archetype = &"enemy_thug"
	body.team = Character.Team.ENEMY
	var tree := Engine.get_main_loop() as SceneTree
	var parent: Node = tree.current_scene if tree.current_scene != null else tree.root
	parent.add_child(body)
	_spawned.append(body)
	return body


func test_every_weapon_of_every_class_has_a_sample_that_exists() -> void:
	# La comprobación que faltaba: no que el arma tenga sonido declarado, sino
	# que la muestra esté CARGADA. Tres de las cuatro clases jugables llevan un
	# arma cuyo id no es el de ninguna muestra.
	var loaded := AudioDirector.loaded_effects()
	assert_gt(loaded.size(), 0, "sin muestras cargadas no hay nada que comprobar")
	for id: StringName in Balance.character_ids():
		var stats := Balance.character(id)
		assert_not_null(stats, "falta la ficha de '%s'" % id)
		if stats == null:
			continue
		var weapon := Balance.weapon(stats.default_weapon_id)
		assert_not_null(weapon, "'%s' lleva un arma que no existe" % id)
		if weapon == null:
			continue
		assert_true(loaded.has(weapon.effective_sfx_id()),
			"el arma '%s' de '%s' pide la muestra '%s', que no está cargada"
				% [weapon.id, id, weapon.effective_sfx_id()])


func test_the_knife_of_every_class_has_a_sample_too() -> void:
	var knife := Balance.weapon(&"knife")
	assert_not_null(knife, "el cuchillo es común a todas las clases")
	if knife != null:
		assert_true(AudioDirector.loaded_effects().has(knife.effective_sfx_id()),
			"el cuchillo no suena")


func test_a_death_is_heard() -> void:
	var body := _body()
	var before := AudioDirector.stat_sfx_played
	EventBus.character_died.emit(body.get_instance_id(), int(body.team), 0, 0)
	assert_gt(AudioDirector.stat_sfx_played, before, "una muerte tiene que sonar")
	assert_eq(AudioDirector.last_sfx_id, &"dead", "y sonar a muerte")


func test_a_hit_is_heard_but_a_burst_does_not_become_a_machine_gun_of_grunts() -> void:
	var body := _body()
	var before := AudioDirector.stat_sfx_played
	EventBus.character_damaged.emit(body.get_instance_id(), 5.0, Vector3.ZERO, 0, 2)
	assert_eq(AudioDirector.stat_sfx_played, before + 1, "el primer impacto suena")
	assert_eq(AudioDirector.last_sfx_id, &"ouch")
	# Cada bala de una ráfaga publica su `character_damaged`.
	for _i: int in range(10):
		EventBus.character_damaged.emit(body.get_instance_id(), 5.0, Vector3.ZERO, 0, 2)
	assert_eq(AudioDirector.stat_sfx_played, before + 1,
		"diez balas seguidas no son diez quejidos")


func test_two_different_victims_are_both_heard() -> void:
	# El enfriamiento es POR VÍCTIMA: si fuera global, en un tiroteo con cinco
	# cuerpos solo se oiría a uno.
	var a := _body()
	var b := _body()
	var before := AudioDirector.stat_sfx_played
	EventBus.character_damaged.emit(a.get_instance_id(), 5.0, Vector3.ZERO, 0, 2)
	EventBus.character_damaged.emit(b.get_instance_id(), 5.0, Vector3.ZERO, 0, 2)
	assert_eq(AudioDirector.stat_sfx_played, before + 2, "dos víctimas, dos quejidos")


func test_the_credits_get_their_music() -> void:
	# Es la única pista que se puede distribuir y no se oía nunca porque nadie
	# llamaba a `play_music`.
	EventBus.game_mode_changed.emit(
		int(GameState.Mode.MENU), int(GameState.Mode.CREDITS))
	assert_eq(AudioDirector.current_music, AudioDirector.MusicState.CREDITS,
		"la pantalla de créditos tiene música y hay que ponerla")


func test_the_music_follows_the_game_mode() -> void:
	EventBus.game_mode_changed.emit(
		int(GameState.Mode.MENU), int(GameState.Mode.ACTION))
	assert_eq(AudioDirector.current_music, AudioDirector.MusicState.COMBAT,
		"en acción, música de combate (aunque hoy esté en silencio por licencia)")
	EventBus.game_mode_changed.emit(
		int(GameState.Mode.ACTION), int(GameState.Mode.STRATEGY))
	assert_eq(AudioDirector.current_music, AudioDirector.MusicState.STRATEGY)
