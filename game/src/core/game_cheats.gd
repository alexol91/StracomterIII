extends Node
## Registra los trucos del juego. Autoload aparte de `Cheats` a propósito:
## `Cheats` es el mecanismo y no sabe nada del juego; esto es el catálogo.
##
## Separarlos permite probar el mecanismo sin arrancar el juego, y añadir un
## truco sin tocar el que decide cómo se parsean.

func _ready() -> void:
	_register_visual_cheats()
	_register_player_cheats()
	_register_world_cheats()


## Quien llena un registro estático tiene que vaciarlo. `Cheats._cheats` es
## estático y sobrevive a este nodo; si se queda con los `Callable` ligados a
## él, al cerrar el juego se liberan referencias a un objeto ya muerto y el
## proceso aborta con corrupción de memoria. Las pruebas seguirían pasando y el
## proceso saldría con código 134: verde por dentro, rojo en CI.
func _exit_tree() -> void:
	Cheats.clear()


func _register_visual_cheats() -> void:
	Cheats.register("retro", "retro on|off — modelos de 2012 o modelos nuevos.", 1,
		func(args: Array[String]) -> String:
			var value := args[0].to_lower()
			if value not in ["on", "off", "1", "0", "si", "no"]:
				return "Uso: %s retro on|off" % Cheats.PREFIX
			var enable := value in ["on", "1", "si"]
			ModelStyle.retro_enabled = enable
			if enable:
				return "Modo retro ACTIVADO: modelos originales de 2012."
			# Si no hay modelos nuevos, decirlo en vez de dejar al jugador
			# preguntándose por qué no ve ningún cambio.
			var missing := ModelStyle.archetypes_without_modern()
			if missing.size() >= Balance.character_ids().size():
				return ("Modo retro desactivado, pero aún no hay modelos nuevos "
					+ "instalados: se seguirán viendo los de 2012.")
			if not missing.is_empty():
				return ("Modo retro DESACTIVADO. Sin modelo nuevo todavía: %s"
					% ", ".join(missing.map(func(a: StringName) -> String: return String(a))))
			return "Modo retro DESACTIVADO: modelos nuevos.")

	Cheats.register("outline", "outline on|off — contorno del cel-shading.", 1,
		func(args: Array[String]) -> String:
			var enable := args[0].to_lower() in ["on", "1", "si"]
			RenderingServer.global_shader_parameter_set(&"cel_outline_enabled", enable)
			return "Contorno %s." % ("activado" if enable else "desactivado"))


func _register_player_cheats() -> void:
	Cheats.register("god", "god — el jugador deja de recibir daño.", 0,
		func(_args: Array[String]) -> String:
			var player := _find_player()
			if player == null:
				return "No hay jugador en juego."
			player.set_meta(&"godmode", not bool(player.get_meta(&"godmode", false)))
			return "Modo dios %s." % ("activado" if player.get_meta(&"godmode") else "desactivado"))

	Cheats.register("heal", "heal [cantidad] — cura al jugador (por defecto, al máximo).", 0,
		func(args: Array[String]) -> String:
			var player := _find_player()
			if player == null:
				return "No hay jugador en juego."
			var amount := float(args[0]) if not args.is_empty() else 9999.0
			player.heal(amount)
			return "Vida: %.0f" % player.health)

	Cheats.register("ammo", "ammo [cantidad] — munición (por defecto, al máximo).", 0,
		func(args: Array[String]) -> String:
			var player := _find_player()
			if player == null:
				return "No hay jugador en juego."
			var amount := int(args[0]) if not args.is_empty() else 9999
			player.add_ammo(amount)
			return "Munición: %d" % player.ammo)

	Cheats.register("xp", "xp <cantidad> — añade experiencia para gastar en Estrategia.", 1,
		func(args: Array[String]) -> String:
			GameState.experience += maxi(0, int(args[0]))
			return "Experiencia: %d" % GameState.experience)


func _register_world_cheats() -> void:
	Cheats.register("chutaos", "chutaos on|off — paquete de voces de broma del equipo.", 1,
		func(args: Array[String]) -> String:
			var enable := args[0].to_lower() in ["on", "1", "si"]
			AudioDirector.joke_pack_enabled = enable
			return "Paquete Chutaos %s." % ("activado" if enable else "desactivado"))

	Cheats.register("noclip", "noclip — atravesar la geometría.", 0,
		func(_args: Array[String]) -> String:
			var player := _find_player()
			if player == null:
				return "No hay jugador en juego."
			var active := not bool(player.get_meta(&"noclip", false))
			player.set_meta(&"noclip", active)
			return "Noclip %s." % ("activado" if active else "desactivado"))


## Busca al jugador por su bando. No se guarda una referencia porque el jugador
## se destruye y se recrea en cada planta, y una referencia guardada sería una
## referencia colgante en cuanto se cambie de zona.
func _find_player() -> Character:
	var tree := get_tree()
	if tree == null:
		return null
	for node: Node in tree.get_nodes_in_group(&"player"):
		var character := node as Character
		if character != null and character.alive:
			return character
	return null
