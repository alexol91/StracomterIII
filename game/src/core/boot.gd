extends Node
## Punto de entrada. Comprueba la integridad de los datos y entra al menú.
##
## Además sirve de verificación en CI: `godot --headless --quit-after 120`
## debe terminar sin errores ni avisos.

func _ready() -> void:
	var problems := _self_check()
	if problems.is_empty():
		print("[boot] Datos de balanceo OK: %d arquetipos cargados." % Balance.character_ids().size())
	else:
		for problem: String in problems:
			push_error("[boot] %s" % problem)
	GameState.set_mode(GameState.Mode.MENU)


## Verifica que los datos mínimos existen. Un juego que arranca con datos
## incompletos falla más tarde y en un sitio peor.
func _self_check() -> Array[String]:
	var problems: Array[String] = []
	for required: StringName in [&"captain", &"technician", &"specialist", &"demolition"]:
		if Balance.character(required) == null:
			problems.append("Falta el arquetipo jugable '%s'." % required)
	for required: StringName in [&"enemy_thug", &"enemy_militiaman", &"enemy_veteran"]:
		if Balance.character(required) == null:
			problems.append("Falta el arquetipo enemigo '%s'." % required)
	for n: int in range(GameState.FIRST_FLOOR, GameState.ROOFTOP_FLOOR + 1):
		var cfg := Balance.floor_config(n)
		if cfg == null:
			problems.append("Falta la configuración de la planta %d." % n)
			continue
		if cfg.zone_maps.size() != GameState.ZONES_PER_FLOOR:
			problems.append("La planta %d define %d zonas, se esperaban %d."
				% [n, cfg.zone_maps.size(), GameState.ZONES_PER_FLOOR])
		if cfg.zone_rewards.size() != GameState.ZONES_PER_FLOOR:
			problems.append("La planta %d define %d recompensas, se esperaban %d."
				% [n, cfg.zone_rewards.size(), GameState.ZONES_PER_FLOOR])
	if Balance.director_profile() == null:
		problems.append("Falta el perfil del director.")
	return problems
