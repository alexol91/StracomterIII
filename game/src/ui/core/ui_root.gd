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

var _overlay: Overlay = Overlay.NONE
var _floor_end_pending: bool = false


func _ready() -> void:
	Localization.ensure_loaded()
	SettingsService.get_singleton().apply_global()
	_wire_intents()
	EventBus.zone_cleared.connect(_on_zone_cleared)
	set_process(true)
	_refresh()


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

	_title.visible = mode == GameState.Mode.MENU and _overlay == Overlay.NONE
	_class_select.visible = mode == GameState.Mode.MENU and _overlay == Overlay.CLASS_SELECT
	_credits.visible = mode == GameState.Mode.CREDITS \
		or (mode == GameState.Mode.MENU and _overlay == Overlay.CREDITS)
	_options.visible = _overlay == Overlay.OPTIONS

	_strategy.visible = mode == GameState.Mode.STRATEGY
	if _strategy.visible:
		_strategy.refresh()

	_hud.visible = mode == GameState.Mode.ACTION
	_pause.visible = mode == GameState.Mode.ACTION and paused and _overlay != Overlay.OPTIONS
	if _pause.visible:
		_pause.focus_default()
	_game_over.visible = mode == GameState.Mode.ACTION \
		and GameState.action_status == GameState.ActionStatus.GAME_OVER
	if _game_over.visible:
		_game_over.focus_default()
	_victory.visible = mode == GameState.Mode.ACTION \
		and GameState.action_status == GameState.ActionStatus.WIN
	if _victory.visible:
		_victory.focus_default()
	_floor_end.visible = mode == GameState.Mode.ACTION and _floor_end_pending \
		and _overlay != Overlay.OPTIONS
	if _floor_end.visible:
		_floor_end.focus_default()
