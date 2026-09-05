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
##   SHOT_CHUTAOS  "1" para capturar con el estilo de 2012 activo
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
	quit()


func _scenes() -> Array[String]:
	var raw: String = OS.get_environment("SHOT_SCENES")
	if raw.strip_edges().is_empty():
		return DEFAULT_SCENES
	var out: Array[String] = []
	for entry: String in raw.split(",", false):
		out.append(entry.strip_edges())
	return out
