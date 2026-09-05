extends SceneTree
## Renderiza pantallas del juego a PNG para poder MIRARLAS.
##
## Este proyecto se desarrolla en `--headless`, donde no hay render y no se ve
## nada. Eso está bien para la lógica —y CLAUDE.md exige que la IA y el
## director sean probables sin GPU— pero el menú, los materiales y el HUD son
## entregables visuales: aprobarlos sin verlos es fiarse de una descripción.
##
## Ya ha servido para encontrar tres cosas que ningún test detectaba: la
## interfaz arrancaba en inglés en un proyecto en español, la torre del fondo
## tenía ventanas flotando por encima del tejado, y el velo del modo chutaos
## entraba con un canto vertical duro en mitad de la pantalla.
##
## Uso (necesita un servidor X; en un contenedor basta `xvfb-run`):
##
##   xvfb-run -a godot --path game --rendering-driver opengl3 \
##       --resolution 1280x720 --script res://../tools/screenshots/capture.gd
##
## Variables de entorno:
##   SHOT_OUT      directorio de salida (por defecto, `user://screenshots`)
##   SHOT_SCENES   rutas `res://` separadas por comas; por defecto, los menús
##   SHOT_LINEUP   "1" para añadir una fila con los nueve arquetipos
##   SHOT_GAMEPLAY "1" para arrancar una partida de verdad y capturar la planta
##   SHOT_CHUTAOS  "1" para capturar con el estilo de 2012 activo
##   SHOT_LOCALE   "es" o "en"; por defecto, el del sistema. Existe porque el
##                 contenedor es una máquina en inglés y la interfaz canónica
##                 del proyecto es la española: sin esto, las capturas de
##                 revisión salen en el idioma equivocado.
##
## LIMITACIÓN QUE HAY QUE TENER PRESENTE: un contenedor sin Vulkan cae al
## renderizador de Compatibilidad, y el juego se exporta en Forward+. La
## captura avisa de ello en su salida. Lo que se ve aquí APROXIMA el resultado
## final: la silueta, la composición, el valor y la saturación son fiables; el
## ambiente de imagen, la oclusión de contacto y las sombras no. Por eso la
## iluminación no se apoya solo en el aporte del cielo (ver
## `world_lighting.gd`): lo que se afina mirando una captura tiene que
## sobrevivir al cambio de renderizador.
##
## No se ejecuta en CI ni forma parte de la suite: es una herramienta de
## inspección, no una prueba. Una comparación automática de imágenes sería otra
## cosa y tendría que justificar su propio mantenimiento.

const DEFAULT_SCENES: Array[String] = [
	"res://scenes/ui/title_screen.tscn",
	"res://scenes/ui/strategy_screen.tscn",
	"res://scenes/ui/class_select_screen.tscn",
]
## Fotogramas de margen antes de capturar. El layout de Control se asienta en
## varios pasos y los `Tween` de entrada duran ~250 ms: capturar en el primer
## fotograma da pantallas a medio construir.
const SETTLE_FRAMES: int = 20


func _init() -> void:
	await process_frame
	_capture.call_deferred()


func _capture() -> void:
	var out: String = OS.get_environment("SHOT_OUT")
	if out.is_empty():
		out = ProjectSettings.globalize_path("user://screenshots")
	if not out.ends_with("/"):
		out += "/"
	DirAccess.make_dir_recursive_absolute(out)

	var driver := RenderingServer.get_video_adapter_api_version()
	if not ProjectSettings.get_setting("rendering/renderer/rendering_method", "").is_empty():
		print("[capture] método del proyecto: ",
			ProjectSettings.get_setting("rendering/renderer/rendering_method"),
			" — adaptador: ", driver)

	var locale: String = OS.get_environment("SHOT_LOCALE")
	if not locale.is_empty():
		Localization.set_locale(StringName(locale))

	var chutaos := OS.get_environment("SHOT_CHUTAOS") == "1"
	# `PresentationStyle` no existe como identificador global cuando el motor
	# arranca con `--script`: los autoloads se instancian, pero el compilador de
	# GDScript no los registra en este modo. Se busca por nodo.
	var style := root.get_node_or_null("PresentationStyle")
	if style != null:
		style.set("chutaos_mode", chutaos)
	elif chutaos:
		push_warning("capture: sin PresentationStyle, no se puede activar el modo chutaos")

	var suffix := "_chutaos" if chutaos else ""
	for path: String in _scenes():
		if not ResourceLoader.exists(path):
			push_warning("capture: no existe %s" % path)
			continue
		var node := (load(path) as PackedScene).instantiate()
		root.add_child(node)
		for _i: int in range(SETTLE_FRAMES):
			await process_frame
		await RenderingServer.frame_post_draw
		var file := out + path.get_file().get_basename() + suffix + ".png"
		get_root().get_texture().get_image().save_png(file)
		print(file)
		root.remove_child(node)
		node.queue_free()
		await process_frame

	if OS.get_environment("SHOT_LINEUP") == "1":
		await _capture_lineup(out, suffix, ARCHETYPES, 1.25, 7.6, "characters")
		await _capture_lineup(out, suffix,
			["captain", "technician", "enemy_veteran"], 1.15, 3.4, "characters_closeup")
	if OS.get_environment("SHOT_GAMEPLAY") == "1":
		await _capture_gameplay(out, suffix)
	quit()


const ARCHETYPES: Array[String] = [
	"captain", "technician", "specialist", "demolition",
	"enemy_thug", "enemy_militiaman", "enemy_veteran", "miniboss", "megaboss",
]


## Los nueve arquetipos en fila, con luz y suelo.
##
## Es la forma más barata de revisar los modelos: en una partida los enemigos
## están lejos, de espaldas y medio tapados, y ahí no se ve si un uniforme se
## horneó mal. Aquí se ven los nueve de frente y a la misma escala.
func _capture_lineup(out: String, suffix: String, cast: Array, spacing: float,
		distance: float, basename: String) -> void:
	var stage := Node3D.new()
	root.add_child(stage)

	var ground := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(40, 40)
	ground.mesh = plane
	var floor_material := StandardMaterial3D.new()
	floor_material.albedo_color = Color(0.30, 0.31, 0.33)
	floor_material.roughness = 0.95
	ground.material_override = floor_material
	stage.add_child(ground)

	var style := root.get_node_or_null("PresentationStyle")
	var index := 0
	var centre := (cast.size() - 1) * 0.5
	for name: String in cast:
		var model: Node3D = null
		if style != null:
			model = style.call("instantiate_model", StringName(name))
		if model == null:
			index += 1
			continue
		stage.add_child(model)
		model.position = Vector3((index - centre) * spacing, 0.0, 0.0)
		index += 1

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-38, 28, 0)
	sun.light_energy = 1.5
	sun.shadow_enabled = true
	stage.add_child(sun)

	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-14, -125, 0)
	fill.light_energy = 0.45
	fill.light_color = Color(0.75, 0.82, 1.0)
	stage.add_child(fill)

	var environment := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.09, 0.10, 0.13)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.55, 0.60, 0.70)
	env.ambient_light_energy = 0.55
	environment.environment = env
	stage.add_child(environment)

	var camera := Camera3D.new()
	camera.position = Vector3(0.0, 1.05, distance)
	camera.fov = 52.0
	camera.look_at_from_position(camera.position, Vector3(0.0, 0.95, 0.0), Vector3.UP)
	camera.current = true
	stage.add_child(camera)

	for _i: int in range(SETTLE_FRAMES):
		await process_frame
	await RenderingServer.frame_post_draw
	var file := out + basename + suffix + ".png"
	get_root().get_texture().get_image().save_png(file)
	print(file)
	root.remove_child(stage)
	stage.queue_free()
	await process_frame


## Arranca una partida de verdad y captura la planta 1.
##
## No basta con instanciar el nivel: los personajes solo existen cuando el
## director los ha hecho aparecer, y la navegación necesita un par de pasos de
## física para sincronizarse. Por eso se conduce por donde lo conduce el
## jugador —las intenciones de la UI— y se espera.
func _capture_gameplay(out: String, suffix: String) -> void:
	var main := (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(main)
	for _i: int in range(SETTLE_FRAMES):
		await process_frame

	# `UIIntents` no es un autoload sino un singleton manual, y con `--script`
	# los nombres de clase globales no siempre están registrados: se carga el
	# script por ruta y se le pide la instancia, que es lo mismo que hace el
	# juego.
	var script := load("res://src/ui/core/ui_intents.gd") as GDScript
	var intents: Object = script.call("get_singleton") if script != null else null
	if intents == null:
		push_warning("capture: sin UIIntents no se puede arrancar la partida")
	else:
		intents.emit_signal("run_start_requested", &"captain")
		for _i: int in range(SETTLE_FRAMES):
			await process_frame
		# Zona 1: las zonas se numeran desde 1 en la pantalla de Estrategia, y
		# un 0 se acepta sin protestar y deja la partida sin arrancar.
		intents.emit_signal("strategy_confirmed", 1, 0, {})

	# Cinco segundos de partida: el director tarda en soltar la primera oleada
	# y la cámara en tercera persona en asentarse detrás del jugador.
	for _i: int in range(300):
		await process_frame
	var state := root.get_node_or_null("GameState")
	if state != null:
		print("[capture] modo de juego al capturar: ", state.get("mode"))
	await RenderingServer.frame_post_draw
	var file := out + "gameplay" + suffix + ".png"
	get_root().get_texture().get_image().save_png(file)
	print(file)
	root.remove_child(main)
	main.queue_free()
	await process_frame


func _scenes() -> Array[String]:
	var raw: String = OS.get_environment("SHOT_SCENES")
	if raw.strip_edges().is_empty():
		return DEFAULT_SCENES
	var out: Array[String] = []
	for entry: String in raw.split(",", false):
		out.append(entry.strip_edges())
	return out
