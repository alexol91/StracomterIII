class_name ConsoleHistory
extends RefCounted
## Historial navegable de la consola de depuración (flechas arriba/abajo).
##
## Semántica de terminal habitual: `Arriba` retrocede por lo ya escrito,
## `Abajo` avanza de vuelta hacia lo más reciente y, pasado el final, hacia
## un "borrador" en blanco. Escribir en medio de la navegación no se modela
## aquí (lo resuelve la propia `LineEdit`); esta clase solo lleva el cursor.

var _entries: Array[String] = []
## -1 = fuera del historial (línea en blanco / borrador).
var _cursor: int = -1


func push(line: String) -> void:
	if line.is_empty():
		return
	# Repetir el mismo comando seguido no debe inflar el historial.
	if _entries.is_empty() or _entries[-1] != line:
		_entries.append(line)
	_cursor = -1


func entries() -> Array[String]:
	return _entries.duplicate()


## Línea anterior en el historial, o "" si ya se llegó al principio o está vacío.
func previous() -> String:
	if _entries.is_empty():
		return ""
	if _cursor == -1:
		_cursor = _entries.size() - 1
	elif _cursor > 0:
		_cursor -= 1
	return _entries[_cursor]


## Línea siguiente, o "" al llegar (o estar ya) al final — vuelta al borrador.
func next() -> String:
	if _cursor == -1:
		return ""
	if _cursor >= _entries.size() - 1:
		_cursor = -1
		return ""
	_cursor += 1
	return _entries[_cursor]


func reset_cursor() -> void:
	_cursor = -1
