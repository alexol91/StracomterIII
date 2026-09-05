class_name Cheats
extends RefCounted
## Trucos del juego, invocables desde la consola con dos puntos:
##
##     : retro on
##     : god
##     : give ammo_pack_3
##
## Por qué los dos puntos y no un comando normal: separa lo que **cambia las
## reglas** de lo que solo consulta o depura. `status` mira; `: god` hace
## trampa. Que se distingan de un vistazo evita que alguien active un truco
## creyendo que consultaba algo, y deja la puerta abierta a marcar una partida
## como "con trucos" para las puntuaciones.
##
## Cada truco se registra con su nombre, su ayuda y qué hace. No hay un `if`
## gigante: añadir uno es añadir una entrada.

## Prefijo que distingue un truco de un comando normal.
const PREFIX: String = ":"

## Un truco registrado.
class Cheat:
	extends RefCounted

	var name: String = ""
	var help: String = ""
	## Argumentos mínimos, sin contar el nombre.
	var min_args: int = 0
	var callable: Callable

	func _init(p_name: String, p_help: String, p_min_args: int, p_callable: Callable) -> void:
		name = p_name
		help = p_help
		min_args = p_min_args
		callable = p_callable


static var _cheats: Dictionary[String, Cheat] = {}
## Si en esta partida se ha usado algún truco. Es información honesta: una
## partida con trucos no debería competir con una sin ellos.
static var _used: bool = false


static func register(name: String, help: String, min_args: int, callable: Callable) -> void:
	_cheats[name] = Cheat.new(name, help, min_args, callable)


static func unregister(name: String) -> void:
	_cheats.erase(name)


## Vacía el registro. Lo llama quien lo llenó, al salir del árbol.
##
## Hace falta porque `_cheats` es estático y por tanto sobrevive a la escena:
## si guarda `Callable` ligados a un nodo autoload y ese nodo se libera al
## cerrar el juego, quedan referencias a un objeto muerto y el proceso aborta
## con corrupción de memoria al terminar. Los tests pasan, el juego "funciona",
## y aun así el proceso sale con código 134: es un build rojo con todo verde.
static func clear() -> void:
	_cheats.clear()
	_used = false


## Retira los trucos cuyo objeto ya no existe. Red de seguridad para quien se
## olvide de llamar a `clear()`.
static func prune_dangling() -> void:
	for name: String in _cheats.keys():
		var cheat: Cheat = _cheats[name]
		if not cheat.callable.is_valid():
			_cheats.erase(name)


static func has(name: String) -> bool:
	return _cheats.has(name)


static func names() -> Array[String]:
	var out: Array[String] = []
	for key: String in _cheats:
		out.append(key)
	out.sort()
	return out


static func cheats_were_used() -> bool:
	return _used


static func reset_usage() -> void:
	_used = false


## ¿Es esta línea una invocación de truco? Acepta ": retro on" y ":retro on":
## exigir el espacio sería una trampa para el jugador, no una regla útil.
static func is_cheat_line(line: String) -> bool:
	return line.strip_edges().begins_with(PREFIX)


## Ejecuta una línea de truco y devuelve la salida para la consola.
static func execute(line: String) -> String:
	var trimmed := line.strip_edges()
	if not trimmed.begins_with(PREFIX):
		return "No es un truco: los trucos empiezan por '%s'." % PREFIX
	var body := trimmed.substr(PREFIX.length()).strip_edges()
	if body.is_empty():
		return help_text()

	var parts := body.split(" ", false)
	var name := parts[0].to_lower()
	var args: Array[String] = []
	for i: int in range(1, parts.size()):
		args.append(parts[i])

	if name == "help":
		return help_text()
	if not _cheats.has(name):
		return "Truco desconocido: '%s'. Prueba '%s help'." % [name, PREFIX]

	var cheat: Cheat = _cheats[name]
	if args.size() < cheat.min_args:
		return "Faltan argumentos. %s" % cheat.help
	if not cheat.callable.is_valid():
		return "El truco '%s' ya no está disponible." % name

	_used = true
	var result: Variant = cheat.callable.call(args)
	return str(result) if result != null else ""


static func help_text() -> String:
	if _cheats.is_empty():
		return "No hay trucos registrados."
	var lines: Array[String] = ["Trucos disponibles (se invocan con '%s'):" % PREFIX]
	for name: String in names():
		lines.append("  %s %s — %s" % [PREFIX, name, _cheats[name].help])
	return "\n".join(lines)
