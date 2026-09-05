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
	Cheats.register("chutaos",
		"chutaos on|off — juego de 2012 completo (modelos, voces de broma y texturas) o remake.", 1,
		func(args: Array[String]) -> String:
			var value := args[0].to_lower()
			if value not in ["on", "off", "1", "0", "si", "no"]:
				return "Uso: %s chutaos on|off" % Cheats.PREFIX
			PresentationStyle.chutaos_mode = value in ["on", "1", "si"]
			if PresentationStyle.chutaos_mode:
				return ("Modo CHUTAOS: modelos de 2012, voces de broma y "
					+ "texturas planas. Como en la universidad.")
			var missing := PresentationStyle.archetypes_without_modern()
			if not missing.is_empty():
				return ("Modo remake, pero sin modelo nuevo todavía para: %s"
					% ", ".join(missing.map(func(a: StringName) -> String: return String(a))))
			return "Modo REMAKE: modelos nuevos, audio serio y texturas de oficina.")

	# `retro` era el nombre viejo de la mitad de este eje. Se mantiene como
	# alias en vez de borrarlo: quien ya lo tenía en los dedos merece que
	# funcione, y el mensaje le enseña el nombre bueno.
	Cheats.register("retro", "retro on|off — alias de 'chutaos'.", 1,
		func(args: Array[String]) -> String:
			var value := args[0].to_lower()
			if value not in ["on", "off", "1", "0", "si", "no"]:
				return "Uso: %s retro on|off" % Cheats.PREFIX
			PresentationStyle.chutaos_mode = value in ["on", "1", "si"]
			return ("'retro' ahora se llama '%s chutaos': mueve modelos, voces y "
				+ "texturas a la vez. Estilo activo: %s") % [
					Cheats.PREFIX, PresentationStyle.style_name()])

	Cheats.register("tf2",
		"tf2 on|off — personajes de Team Fortress 2, si están importados.", 1,
		func(args: Array[String]) -> String:
			var value := args[0].to_lower()
			if value not in ["on", "off", "1", "0", "si", "no"]:
				return "Uso: %s tf2 on|off" % Cheats.PREFIX
			var wanted := value in ["on", "1", "si"]
			if wanted and not PresentationStyle.tf2_available():
				# Decirlo en claro y no encender un modo vacío: el truco
				# quedaría "activo" y no cambiaría nada en pantalla.
				return ("No hay modelos de TF2 importados. Se importan desde tu "
					+ "instalación del juego con tools/tf2_import/import_tf2.py; "
					+ "no vienen en el repositorio porque son de Valve.")
			PresentationStyle.character_pack = (PresentationStyle.Pack.TF2
				if wanted else PresentationStyle.Pack.KAYKIT)
			if not wanted:
				return "Personajes: KayKit (CC0)."
			var missing := PresentationStyle.archetypes_without_tf2()
			if not missing.is_empty():
				return ("Personajes: TF2, pero sin modelo todavía para: %s"
					% ", ".join(missing.map(func(a: StringName) -> String: return String(a))))
			return "Personajes: Team Fortress 2.")

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
	# El paquete de voces NO tiene truco propio: forma parte del eje Chutaos y
	# lo mueve `PresentationStyle`. Dos conmutadores para el mismo eje era lo
	# que había antes, y permitía activar media nostalgia.
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
