extends Node
## Escena principal del juego. Une lo que hasta ahora eran sistemas sueltos:
## la interfaz, la carga de plantas, el bucle de zona y el director.
##
## No implementa reglas propias — cada pieza ya tiene las suyas y están
## probadas. Lo único que hace es escuchar las **intenciones** de la UI y
## traducirlas en llamadas a quien corresponde, que es exactamente el papel que
## la arquitectura le asigna a la capa de arriba (ADR-001): la interfaz no muta
## el estado, lo pide.

@onready var _ui: CanvasLayer = %UiRoot
@onready var _loader: LevelLoader = %LevelLoader
@onready var _runner: FloorRunner = %FloorRunner

var _intents: UIIntents = null


func _ready() -> void:
	# Los controles, ANTES que nada. `toggle_console` y `pause` no tenían tecla
	# nunca: los de juego los rellena `PlayerInput` al aparecer el jugador y
	# los dos de interfaz solo se asignaban dentro de «Restaurar controles de
	# fábrica». Medido: ni la tecla de consola ni Escape hacían nada, ni en el
	# menú ni jugando, y la lista de Ajustes salía entera con guiones.
	InputRemapService.ensure_defaults()
	_intents = UIIntents.get_singleton()
	_intents.run_start_requested.connect(_on_run_start_requested)
	_intents.run_continue_requested.connect(_on_run_continue_requested)
	_intents.strategy_confirmed.connect(_on_strategy_confirmed)
	_intents.floor_end_acknowledged.connect(_on_floor_end_acknowledged)
	_intents.console_toggled.connect(_on_console_toggled)
	_intents.navigate_to_credits_requested.connect(_on_navigate_to_credits)
	_intents.restart_requested.connect(_on_restart_requested)
	_intents.return_to_menu_requested.connect(_on_return_to_menu)
	_intents.quit_requested.connect(_on_quit_requested)

	_runner.run_failed.connect(_on_run_failed)
	_runner.run_completed.connect(_on_run_completed)

	_register_console_commands()
	GameState.set_mode(GameState.Mode.MENU)


## Partida nueva con la clase elegida.
func _on_run_start_requested(archetype: StringName) -> void:
	GameState.reset_run()
	GameState.player_archetype = archetype
	GameState.set_mode(GameState.Mode.STRATEGY)


func _on_run_continue_requested() -> void:
	if not SaveSystem.load_game():
		push_warning("Main: no hay partida guardada que continuar")
		return
	GameState.set_mode(GameState.Mode.STRATEGY)


## El jugador ha elegido zona en la pantalla de Estrategia. Aquí es donde la
## decisión se convierte en una planta montada.
func _on_strategy_confirmed(zone: int, xp_to_spend: int, squad: Dictionary) -> void:
	GameState.current_zone = zone
	GameState.experience = maxi(0, GameState.experience - xp_to_spend)
	# A quién se lleva. Se ignoraba, así que la pantalla de Estrategia dejaba
	# elegir compañeros y a la planta no bajaba nadie: una promesa de la
	# interfaz que el juego no cumplía.
	GameState.squad_taken.clear()
	for key: Variant in squad:
		GameState.squad_taken[StringName(str(key))] = bool(squad[key])
	SaveSystem.save_game()
	if not _runner.start_current_floor():
		# No se pudo montar la planta. Se vuelve a Estrategia en vez de dejar al
		# jugador en una pantalla de acción vacía: un fallo de carga tiene que
		# ser visible, no un limbo.
		push_error("Main: no se pudo iniciar la planta %d zona %d"
			% [GameState.current_floor, zone])
		GameState.set_mode(GameState.Mode.STRATEGY)


## El jugador ha leído el resumen de fin de planta. Hasta ahora esta intención
## no la escuchaba nadie —`UiRoot` lo dejaba escrito en su cabecera— y el
## resumen no llevaba a ningún sitio: era el `FloorRunner` el que entraba en
## Estrategia sin esperar a nadie, en el mismo frame.
func _on_floor_end_acknowledged() -> void:
	if GameState.mode != GameState.Mode.ACTION:
		return
	_loader.unload()
	GameState.set_mode(GameState.Mode.STRATEGY)


## Botón "Créditos" de la pantalla de Victoria. Los créditos abiertos desde el
## MENÚ los gobierna la propia interfaz como superposición; aquí solo se
## atiende el final de la torre, que sí desmonta la partida.
func _on_navigate_to_credits() -> void:
	if GameState.mode != GameState.Mode.ACTION \
			or GameState.action_status != GameState.ActionStatus.WIN:
		return
	_loader.unload()
	GameState.set_mode(GameState.Mode.CREDITS)


## La consola abierta es un estado del juego, no solo una ventana: mientras lo
## esté, el jugador no mueve al personaje ni gira la cámara. `ActionStatus`
## tenía el valor `CONSOLE` reservado desde el principio para esto.
func _on_console_toggled(is_open: bool) -> void:
	if GameState.mode != GameState.Mode.ACTION:
		return
	if is_open:
		GameState.action_status = GameState.ActionStatus.CONSOLE
	elif GameState.action_status == GameState.ActionStatus.CONSOLE:
		GameState.action_status = GameState.ActionStatus.NORMAL


func _on_restart_requested() -> void:
	_loader.unload()
	GameState.reset_run()
	GameState.set_mode(GameState.Mode.STRATEGY)


func _on_return_to_menu() -> void:
	_loader.unload()
	GameState.set_mode(GameState.Mode.MENU)


func _on_quit_requested() -> void:
	get_tree().quit()


func _on_run_failed() -> void:
	_loader.unload()


## La torre está limpia. NO se salta a los créditos: eso es lo que hacía que la
## pantalla de Victoria no llegara a verse nunca. Lo único que toca aquí es que
## una partida terminada deje de ser continuable — si no, "Continuar" del menú
## reanuda una torre acabada, en una planta 10 que no existe.
func _on_run_completed() -> void:
	SaveSystem.delete_save()


func _register_console_commands() -> void:
	DevConsole.register("floor", "floor <n> — salta a la planta n.", 1,
		func(args: Array[String]) -> String:
			var n := int(args[0])
			if n < GameState.FIRST_FLOOR or n > GameState.ROOFTOP_FLOOR:
				return "Planta fuera de rango (%d..%d)." % [GameState.FIRST_FLOOR, GameState.ROOFTOP_FLOOR]
			GameState.current_floor = n
			return "Planta actual: %d" % n)

	DevConsole.register("zone", "zone <1-6> — cambia la zona de la planta.", 1,
		func(args: Array[String]) -> String:
			var z := int(args[0])
			if z < 1 or z > GameState.ZONES_PER_FLOOR:
				return "Zona fuera de rango (1..%d)." % GameState.ZONES_PER_FLOOR
			GameState.current_zone = z
			return "Zona actual: %d" % z)

	DevConsole.register("start", "start — monta la planta y zona actuales.", 0,
		func(_args: Array[String]) -> String:
			return "Planta iniciada." if _runner.start_current_floor() else "No se pudo iniciar.")

	DevConsole.register("status", "status — resumen del estado de la partida.", 0,
		func(_args: Array[String]) -> String:
			return "Clase %s · planta %d · zona %d · puntos %d · XP %d · hostiles %d" % [
				GameState.player_archetype, GameState.current_floor,
				GameState.current_zone, GameState.score, GameState.experience,
				_runner.hostiles_alive()])
