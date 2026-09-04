class_name ConsoleInput
extends LineEdit
## `LineEdit` especializado para la consola: intercepta Arriba/Abajo (para
## historial) y Tab (para autocompletar) ANTES de que el motor los use para
## edición de texto o para saltar el foco al siguiente control — Tab en una
## consola completa el comando, no cambia de widget.

signal history_previous_requested()
signal history_next_requested()
signal autocomplete_requested()


func _gui_input(event: InputEvent) -> void:
	if event is InputEventKey and event.is_pressed():
		var key_event := event as InputEventKey
		match key_event.keycode:
			KEY_UP:
				history_previous_requested.emit()
				accept_event()
			KEY_DOWN:
				history_next_requested.emit()
				accept_event()
			KEY_TAB:
				autocomplete_requested.emit()
				accept_event()
