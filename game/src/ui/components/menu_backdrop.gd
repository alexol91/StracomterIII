class_name MenuBackdrop
extends Control
## Fondo compartido de las pantallas de menú (encargo: "mismo lenguaje visual
## en todas"). Dos capas, una visible según el estilo activo:
##
## - `ShaderBackground`: silueta animada de la Torre Chutaos de noche
##   (`assets/shaders/ui/menu_background.gdshader`). Es el fondo del remake.
## - `ChutaosBackground`: el `fondo.jpg` original de 2012. Es el fondo cuando
##   `PresentationStyle.chutaos_mode` está activo — el encargo pide
##   explícitamente que ese modo pueda usar la imagen original.
##
## No se suscribe a `PresentationStyle.style_changed`: `refresh()` es una
## foto bajo demanda, la misma idea que `UiStyle.apply_snapshot` y por la
## misma razón (evitar una `Callable` que viva más que este nodo en el
## registro de señales de un autoload). Quien SÍ escucha el cambio en
## caliente es `UiRoot`, que llama aquí a través de `UiStyle.apply_snapshot`.

## `fondo_torre.jpg`: el render de SketchUp del equipo original (2012),
## usado como fondo en `GameMenu.cc` (inicio, opciones, final, estrategia).
## Torre Chutaos octogonal de muro cortina, "CHUTAOS Inc." en la coronación,
## edificio bajo "Chutaos Inc. I+D" a la derecha. Es la imagen real, no una
## reconstrucción: por eso en modo Chutaos se muestra tal cual, sin recortar
## ni recolorear.
const CHUTAOS_TEXTURE_PATH: String = "res://assets/textures/chutaos/fondo_torre.jpg"

@onready var _shader_background: ColorRect = %ShaderBackground
@onready var _chutaos_background: TextureRect = %ChutaosBackground
## Velo del modo Chutaos. El render de 2012 es cielo claro sobre césped, y el
## título blanco encima no se leía. Solo cubre la columna del contenido: bajar
## el brillo de la imagen entera sería enseñar otra cosa que el original.
@onready var _chutaos_scrim: TextureRect = %ChutaosScrim


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	# Única fuente de verdad de la ruta: se carga aquí, no como `ExtResource`
	# en el `.tscn`, para que cambiar `CHUTAOS_TEXTURE_PATH` baste.
	_chutaos_background.texture = load(CHUTAOS_TEXTURE_PATH) as Texture2D
	_shader_background.resized.connect(_on_shader_background_resized)
	_on_shader_background_resized()
	refresh()


func refresh() -> void:
	var chutaos := PresentationStyle.chutaos_mode
	_shader_background.visible = not chutaos
	_chutaos_background.visible = chutaos
	_chutaos_scrim.visible = chutaos


func _on_shader_background_resized() -> void:
	var material := _shader_background.material as ShaderMaterial
	if material == null:
		return
	var size := _shader_background.size
	if size.x <= 0.0 or size.y <= 0.0:
		# Ante la duda de que el layout todavía no ha asentado tamaño, se deja
		# el valor de aspecto neutro por defecto del shader antes que empujar
		# un 0 que rompería la división de aspecto en el fragment shader.
		return
	material.set_shader_parameter(&"rect_size", size)
