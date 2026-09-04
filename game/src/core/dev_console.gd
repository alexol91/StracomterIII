extends Node
## Registro de comandos de la consola de depuración.
##
## Réplica ampliada de TConsole + GameAction::parseCommand del legacy
## (legacy/trunk/core/lib/GameAction.cc:484, comandos `spawn`/`add`).
##
## Esto no es un extra: es la herramienta con la que los agentes prueban el
## juego sin manos. La interfaz visual es de `ui-ux`; el registro es de `core`.

signal output_emitted(line: String)

class Command:
	extends RefCounted

	var name: String = ""
	var help: String = ""
	var min_args: int = 0
	var callable: Callable

	func _init(p_name: String, p_help: String, p_min_args: int, p_callable: Callable) -> void:
		name = p_name
		help = p_help
		min_args = p_min_args
		callable = p_callable


var _commands: Dictionary[String, Command] = {}
var _history: Array[String] = []


func _ready() -> void:
	register("help", "Lista los comandos disponibles.", 0, _cmd_help)
	register("quit", "Cierra el juego.", 0, func(_a: Array[String]) -> String:
		GameState.set_mode(GameState.Mode.QUIT)
		return "Saliendo.")


## Registra un comando. Los sistemas se auto-registran en su `_ready`.
func register(name: String, help: String, min_args: int, callable: Callable) -> void:
	_commands[name] = Command.new(name, help, min_args, callable)


## Retira un comando. Necesario porque los sistemas registran `Callable`
## ligados a su instancia: si el nodo se libera sin retirarlos, la consola
## conserva referencias colgantes y el siguiente `help` revienta.
func unregister(name: String) -> void:
	_commands.erase(name)


## Retira todos los comandos cuyo `Callable` apunte a un objeto ya liberado.
## Red de seguridad para quien se olvide de llamar a `unregister`.
func prune_dangling() -> void:
	for key: String in _commands.keys():
		var cmd: Command = _commands[key]
		if not cmd.callable.is_valid():
			_commands.erase(key)


func has_command(name: String) -> bool:
	return _commands.has(name)


func command_names() -> Array[String]:
	var names: Array[String] = []
	for key: String in _commands:
		names.append(key)
	names.sort()
	return names


## Ejecuta una línea de consola y devuelve la salida.
func execute(line: String) -> String:
	var trimmed := line.strip_edges()
	if trimmed.is_empty():
		return ""
	_history.append(trimmed)
	var parts := trimmed.split(" ", false)
	var name := parts[0]
	var args: Array[String] = []
	for i: int in range(1, parts.size()):
		args.append(parts[i])
	if not _commands.has(name):
		return _emit("Comando desconocido: '%s'. Prueba 'help'." % name)
	var cmd: Command = _commands[name]
	if args.size() < cmd.min_args:
		return _emit("Uso insuficiente. %s" % cmd.help)
	var result: Variant = cmd.callable.call(args)
	return _emit(str(result) if result != null else "")


func history() -> Array[String]:
	return _history.duplicate()


func _emit(text: String) -> String:
	if not text.is_empty():
		output_emitted.emit(text)
	return text


func _cmd_help(_args: Array[String]) -> String:
	var lines: Array[String] = []
	for name: String in command_names():
		lines.append("  %s — %s" % [name, _commands[name].help])
	return "Comandos:\n" + "\n".join(lines)
