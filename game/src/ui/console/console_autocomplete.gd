class_name ConsoleAutocomplete
extends RefCounted
## Autocompletado por Tab de la consola. Lógica pura: se le pasa el texto
## parcial y la lista de comandos (`DevConsole.command_names()`) y devuelve
## qué debería quedar escrito, igual que una shell POSIX.

## Completa `partial` contra `candidates`:
## - sin coincidencias → se devuelve `partial` tal cual.
## - una coincidencia → se devuelve completa.
## - varias → se devuelve el prefijo común más largo de todas ellas (puede
##   ser el propio `partial` si no comparten nada más).
static func complete(partial: String, candidates: Array[String]) -> String:
	var matches := matching(partial, candidates)
	if matches.is_empty():
		return partial
	if matches.size() == 1:
		return matches[0]
	return _longest_common_prefix(matches)


## Todos los comandos cuyo nombre empieza por `partial`, ordenados.
static func matching(partial: String, candidates: Array[String]) -> Array[String]:
	var out: Array[String] = []
	for candidate: String in candidates:
		if candidate.begins_with(partial):
			out.append(candidate)
	out.sort()
	return out


static func _longest_common_prefix(values: Array[String]) -> String:
	if values.is_empty():
		return ""
	var prefix := values[0]
	for value: String in values:
		while not value.begins_with(prefix):
			prefix = prefix.substr(0, prefix.length() - 1)
			if prefix.is_empty():
				return ""
	return prefix
