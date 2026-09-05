class_name UiRoot
extends CanvasLayer
## Orquestador de pantallas de este agente. Decide qué pantalla se ve según
## `GameState.mode`/`action_status` (solo lectura) y el estado de navegación
## puramente de UI (`_overlay`). Es el único nodo que conecta `UIIntents`: las
## pantallas no se conocen entre sí.
##
## GAP DE INTEGRACIÓN (ver informe del agente `ui-ux`): hoy nada fuera de
## este fichero escucha `UIIntents`, así que `run_start_requested`,
## `strategy_confirmed`, `restart_requested`, `squad_revive_requested` y
## `floor_end_acknowledged` no producen ningún cambio de partida todavía —
## solo cambian qué pantalla se ve. Conectar esas señales a las reglas reales
## (crear la partida, gastar XP, avanzar de planta...) es trabajo pendiente
## de quien posea el flujo de partida (`core`/`levels`), no de esta capa.

enum Overlay { NONE, CLASS_SELECT, OPTIONS, CREDITS }

@onready var _title: TitleScreen = %Title
@onready var _class_select: ClassSelectScreen = %ClassSelect
@onready var _options: OptionsScreen = %Options
@onready var _credits: CreditsScreen = %Credits
@onready var _strategy: StrategyScreen = %Strategy
@onready var _hud: Hud = %Hud
@onready var _pause: PauseScreen = %Pause
@onready var _game_over: GameOverScreen = %GameOver
@onready var _victory: VictoryScreen = %Victory
@onready var _floor_end: FloorEndScreen = %FloorEnd
@onready var _console: ConsolePanel = %Console

## Todas las pantallas propias (no incluye la consola: se abre/cierra por su
## cuenta con `toggle_console`, no por `_refresh`), para aplicar el mismo
## tema y la misma transición de aparición a todas por igual.
var _screens: Array[Control] = []
var _was_visible: Dictionary[Control, bool] = {}

var _overlay: Overlay = Overlay.NONE
var _floor_end_pending: bool = false


func _ready() -> void:
	Localization.ensure_loaded()
	SettingsService.get_singleton().apply_global()
	_screens = [
		_title, _class_select, _options, _credits, _strategy,
		_hud, _pause, _game_over, _victory, _floor_end,
	]
	_apply_style_to_all()
	PresentationStyle.style_changed.connect(_on_style_changed)
	_wire_intents()
	EventBus.zone_cleared.connect(_on_zone_cleared)
	set_process(true)
	_refresh()


## Único punto de la interfaz que se suscribe a `PresentationStyle.style_
## changed`: vive tanto como el propio `UiRoot` (toda la partida), así que la
## conexión no puede sobrevivir a su receptor — no hace falta desconectarla.
## Las pantallas sueltas (pruebas que instancian una `.tscn` sin pasar por
## aquí) solo ven una FOTO del estilo actual en su propio `_ready`
## (`UiStyle.apply_snapshot`), no esta suscripción en caliente.
func _on_style_changed(_chutaos: bool) -> void:
	_apply_style_to_all()


func _apply_style_to_all() -> void:
	for screen: Control in _screens:
		UiStyle.apply_snapshot(screen)
	UiStyle.apply_snapshot(_console)


func _wire_intents() -> void:
	var intents := UIIntents.get_singleton()
	intents.navigate_to_class_select_requested.connect(func() -> void:
		_overlay = Overlay.CLASS_SELECT
		_refresh())
	intents.navigate_to_options_requested.connect(func() -> void:
		_overlay = Overlay.OPTIONS
		_refresh())
	intents.navigate_to_credits_requested.connect(func() -> void:
		_overlay = Overlay.CREDITS
		_refresh())
	intents.navigate_back_requested.connect(func() -> void:
		_overlay = Overlay.NONE
		_refresh())
	intents.pause_toggle_requested.connect(_on_pause_toggle_requested)
	intents.floor_end_acknowledged.connect(func() -> void:
		_floor_end_pending = false
		_refresh())
	intents.quit_requested.connect(func() -> void: get_tree().quit())


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed(&"pause") and GameState.mode == GameState.Mode.ACTION:
		UIIntents.get_singleton().pause_toggle_requested.emit()
		get_viewport().set_input_as_handled()


func _on_pause_toggle_requested() -> void:
	if GameState.mode != GameState.Mode.ACTION:
		return
	get_tree().paused = not get_tree().paused
	if not get_tree().paused and _overlay == Overlay.OPTIONS:
		_overlay = Overlay.NONE
	_refresh()


func _on_zone_cleared(floor_number: int, zone: int, elapsed_s: float) -> void:
	# La azotea no tiene "fin de planta": la limpieza final la refleja
	# `ActionStatus.WIN` (pantalla de Victoria), no este resumen intermedio.
	if GameState.is_on_rooftop():
		return
	_floor_end_pending = true
	_floor_end.show_summary(floor_number, zone, elapsed_s)
	_refresh()


func _process(_delta: float) -> void:
	_refresh()


func _refresh() -> void:
	var mode := GameState.mode
	var paused := get_tree().paused

	_set_visible(_title, mode == GameState.Mode.MENU and _overlay == Overlay.NONE)
	_set_visible(_class_select, mode == GameState.Mode.MENU and _overlay == Overlay.CLASS_SELECT)
	_set_visible(_credits, mode == GameState.Mode.CREDITS
		or (mode == GameState.Mode.MENU and _overlay == Overlay.CREDITS))
	_set_visible(_options, _overlay == Overlay.OPTIONS)

	_set_visible(_strategy, mode == GameState.Mode.STRATEGY)
	if _strategy.visible:
		_strategy.refresh()

	_set_visible(_hud, mode == GameState.Mode.ACTION)
	_set_visible(_pause, mode == GameState.Mode.ACTION and paused and _overlay != Overlay.OPTIONS)
	if _pause.visible:
		_pause.focus_default()
	_set_visible(_game_over, mode == GameState.Mode.ACTION
		and GameState.action_status == GameState.ActionStatus.GAME_OVER)
	if _game_over.visible:
		_game_over.focus_default()
	_set_visible(_victory, mode == GameState.Mode.ACTION
		and GameState.action_status == GameState.ActionStatus.WIN)
	if _victory.visible:
		_victory.focus_default()
	_set_visible(_floor_end, mode == GameState.Mode.ACTION and _floor_end_pending
		and _overlay != Overlay.OPTIONS)
	if _floor_end.visible:
		_floor_end.focus_default()


## Aplica la visibilidad y, solo en el flanco oculto→visible, un
## desvanecimiento de entrada (encargo: "nada instantáneo"). Se apoya en
## `_was_visible` en vez de mirar `screen.visible` porque esta función es la
## única que debe decidir cuándo algo "acaba de aparecer": mirar la propiedad
## no distinguiría "llevaba visible varios frames" de "acaba de mostrarse".
func _set_visible(screen: Control, should_be_visible: bool) -> void:
	var was := bool(_was_visible.get(screen, false))
	screen.visible = should_be_visible
	if should_be_visible and not was:
		UiMotion.fade_in(screen)
	_was_visible[screen] = should_be_visible
