class_name AutoLocalize
extends RefCounted
## Pasada genérica de traducción para controles ESTÁTICOS.
##
## Contrato: un `.tscn` de este agente puede declarar `text = "ALGUNA_CLAVE"`
## (mayúsculas, dígitos y `_`) en cualquier `Label`/`Button`/`CheckBox` cuyo
## contenido no dependa de datos en tiempo de ejecución. `AutoLocalize.apply`,
## llamado una vez desde el `_ready()` de la pantalla, sustituye esas claves
## por su traducción. El `.tscn` nunca contiene la frase final y el CÓDIGO
## nunca contiene un literal: la única cadena que existe fuera del `.csv` es
## el nombre de la clave, que por construcción no es texto de UI (no tiene
## minúsculas ni espacios), así que el escáner de literales
## (`tests/ui/test_no_untranslated_literals.gd`) no lo confunde con una frase.
##
## Contenido DINÁMICO (formateado con números, elegido en tiempo de
## ejecución) sigue traduciéndose a mano con `Localization.t(key) % args`,
## como hace `strategy_screen.gd`: esta pasada solo cubre el caso estático.

static var _key_regex: RegEx = RegEx.create_from_string("^[A-Z][A-Z0-9_]*$")


static func apply(root: Node) -> void:
	_walk(root)


static func is_key(value: String) -> bool:
	return not value.is_empty() and _key_regex.search(value) != null


static func _walk(node: Node) -> void:
	_translate_if_key(node)
	for child: Node in node.get_children():
		_walk(child)


static func _translate_if_key(node: Node) -> void:
	if node is Label:
		var label := node as Label
		if is_key(label.text):
			label.text = Localization.t(StringName(label.text))
	elif node is Button:
		var button := node as Button
		if is_key(button.text):
			button.text = Localization.t(StringName(button.text))
	elif node is LineEdit:
		var line_edit := node as LineEdit
		if is_key(line_edit.placeholder_text):
			line_edit.placeholder_text = Localization.t(StringName(line_edit.placeholder_text))
