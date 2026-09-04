class_name ConsolePanel
extends Control
## Interfaz de la consola de depuración (`[P13]`, GDD §10).
##
## El registro de comandos y su ejecución son de `core/dev_console.gd`; este
## fichero es SOLO la interfaz: entrada, historial navegable, autocompletado
## y salida con scroll. Se abre/cierra con la acción `toggle_console` y
## funciona aunque el juego esté en pausa (`PROCESS_MODE_ALWAYS`), porque es
## precisamente la herramienta con la que se depura un bloqueo del juego.

@onready var _input: ConsoleInput = %ConsoleInput
@onready var _output: RichTextLabel = %ConsoleOutput

var _history := ConsoleHistory.new()


func _ready() -> void:
	Localization.ensure_loaded()
	AutoLocalize.apply(self)
	process_mode = Node.PROCESS_MODE_ALWAYS
	visible = false
	_output.scroll_following = true
	DevConsole.output_emitted.connect(_append_output_line)
	_input.text_submitted.connect(_on_submit)
	_input.history_previous_requested.connect(_on_history_previous)
	_input.history_next_requested.connect(_on_history_next)
	_input.autocomplete_requested.connect(_on_autocomplete)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed(&"toggle_console"):
		set_open(not visible)
		get_viewport().set_input_as_handled()
	elif visible and event.is_action_pressed(&"ui_cancel"):
		set_open(false)
		get_viewport().set_input_as_handled()


func set_open(open: bool) -> void:
	visible = open
	if open:
		_input.grab_focus()
		_input.clear()
		_history.reset_cursor()
	else:
		_input.release_focus()


func is_open() -> bool:
	return visible


func history() -> ConsoleHistory:
	return _history


func _on_submit(text: String) -> void:
	_input.clear()
	var trimmed := text.strip_edges()
	if trimmed.is_empty():
		return
	_append_output_line(Localization.t(&"CONSOLE_PROMPT_FMT") % trimmed)
	_history.push(trimmed)
	UIIntents.get_singleton().console_line_submitted.emit(trimmed)
	DevConsole.execute(trimmed)


func _on_history_previous() -> void:
	_apply_history_line(_history.previous())


func _on_history_next() -> void:
	_apply_history_line(_history.next())


func _apply_history_line(line: String) -> void:
	_input.text = line
	_input.caret_column = line.length()


func _on_autocomplete() -> void:
	var partial := _input.text
	var names := DevConsole.command_names()
	var completed := ConsoleAutocomplete.complete(partial, names)
	_input.text = completed
	_input.caret_column = completed.length()
	if completed == partial:
		var matches := ConsoleAutocomplete.matching(partial, names)
		if matches.size() > 1:
			_append_output_line(Localization.t(&"CONSOLE_SUGGESTIONS_FMT") % ", ".join(matches))


func _append_output_line(line: String) -> void:
	_output.text += line + "\n"
