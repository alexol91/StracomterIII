class_name WorldLighting
extends Node
## Ilumina la planta según el estilo activo.
##
## Hasta ahora el juego no tenía NI UNA LUZ ni un `WorldEnvironment`: ni en
## `main.tscn`, ni en las 27 escenas de mapa, ni en ningún sitio. Con el
## renderizador Forward+ eso no da error — da un mundo negro. Toda la
## biblioteca de materiales (albedo, normales, rugosidad, metal) es invisible
## sin algo que la ilumine, así que esto no es un extra de acabado: es la
## condición para que lo demás exista.
##
## Va en la escena del mapa, junto a `Dressing`, y no en `main.tscn`, por lo
## mismo que el vestidor: así una planta cargada suelta —en una prueba, en el
## generador procedural, en una captura— se ve igual que en partida.
##
## Los dos estilos son dos maneras distintas de iluminar, no la misma con
## otros colores:
##
##   Remake  → cielo procedural como fuente de ambiente Y de reflejos, sol con
##             sombras suaves y oclusión de contacto. Los metales necesitan
##             algo que reflejar o salen negros.
##   Chutaos → luz plana y ambiente altísimo, sin sombras ni oclusión. Es lo
##             que hacía el pipeline fijo de OpenGL en 2012, y es lo que hace
##             que el cel-shading de entonces se lea como estilo.

const SUN_ROTATION_MODERN := Vector3(-52.0, -35.0, 0.0)
const SUN_ROTATION_CHUTAOS := Vector3(-70.0, -20.0, 0.0)

var _environment: WorldEnvironment = null
var _sun: DirectionalLight3D = null


func _ready() -> void:
	_build()
	_apply_style()
	if not PresentationStyle.style_changed.is_connected(_on_style_changed):
		PresentationStyle.style_changed.connect(_on_style_changed)


func _build() -> void:
	_environment = WorldEnvironment.new()
	_environment.name = "Environment"
	_environment.environment = Environment.new()
	add_child(_environment)

	_sun = DirectionalLight3D.new()
	_sun.name = "Sun"
	add_child(_sun)


func _apply_style() -> void:
	if _environment == null or _sun == null:
		return
	if PresentationStyle.chutaos_mode:
		_apply_chutaos()
	else:
		_apply_modern()


## Oficina real: cielo frío por las cristaleras, sol bajo que alarga las
## sombras y marca las coberturas, y oclusión de contacto para que el
## mobiliario se pegue al suelo en vez de flotar.
func _apply_modern() -> void:
	var env := _environment.environment
	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = Color(0.32, 0.42, 0.58)
	sky_material.sky_horizon_color = Color(0.68, 0.74, 0.80)
	sky_material.ground_bottom_color = Color(0.30, 0.31, 0.33)
	sky_material.ground_horizon_color = Color(0.52, 0.54, 0.57)
	sky_material.sun_angle_max = 12.0
	var sky := Sky.new()
	sky.sky_material = sky_material
	env.sky = sky
	env.background_mode = Environment.BG_SKY
	env.background_energy_multiplier = 0.7
	# Ambiente Y reflejos del cielo. Lo segundo importa tanto como lo primero:
	# una superficie metálica sin nada que reflejar se pinta negra, y la
	# perfilería del perímetro es metálica.
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	# Esto es un INTERIOR con un muro de tres metros alrededor. Con el ambiente
	# bajo, la planta entera sale negra: el sol se queda fuera y dentro no entra
	# nada. La luz de una oficina no viene del sol, viene del techo, y aquí el
	# ambiente es lo que hace ese papel.
	#
	# Y no puede venir SOLO del cielo. El aporte del cielo es imagen: depende
	# del renderizador y en Compatibilidad se comporta distinto que en
	# Forward+, así que una planta que se ve bien en uno puede salir negra en el
	# otro. Con `sky_contribution` a 0,35, dos tercios del relleno vienen de un
	# color explícito y el resultado no depende de qué renderizador toque.
	env.ambient_light_color = Color(0.88, 0.89, 0.92)
	env.ambient_light_sky_contribution = 0.35
	# Medida sobre una captura, no a ojo: con 1,4 el suelo salía casi blanco y
	# se comía la regla de dirección de arte entera —un mundo apagado para que
	# los personajes destaquen no sirve de nada si está sobreexpuesto.
	env.ambient_light_energy = 0.85
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_white = 6.0
	env.ssao_enabled = true
	env.ssao_intensity = 1.4
	env.ssao_radius = 0.6
	env.ssil_enabled = false
	env.sdfgi_enabled = false
	env.glow_enabled = false

	_sun.rotation_degrees = SUN_ROTATION_MODERN
	_sun.light_color = Color(1.0, 0.96, 0.90)
	_sun.light_energy = 0.95
	_sun.shadow_enabled = true
	# Sombra legible, no un agujero negro: da dirección a la escena sin apagar
	# la mitad de la planta. Con opacidad 1 el interior perdía todo el detalle
	# de material que se acababa de hornear.
	_sun.shadow_opacity = 0.55
	_sun.shadow_blur = 1.2
	_sun.directional_shadow_max_distance = 60.0


## 2012: color plano y sin sombras. No es una versión peor de la de arriba,
## es otra cosa — el cel-shading de entonces necesita superficies planas para
## que las cuatro bandas se distingan, y una sombra proyectada las emborrona.
func _apply_chutaos() -> void:
	var env := _environment.environment
	env.sky = null
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.16, 0.18, 0.22)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.86, 0.87, 0.90)
	env.ambient_light_energy = 1.0
	env.reflected_light_source = Environment.REFLECTION_SOURCE_DISABLED
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	env.ssao_enabled = false
	env.ssil_enabled = false
	env.sdfgi_enabled = false
	env.glow_enabled = false

	_sun.rotation_degrees = SUN_ROTATION_CHUTAOS
	_sun.light_color = Color(1.0, 1.0, 1.0)
	_sun.light_energy = 0.55
	_sun.shadow_enabled = false


func _on_style_changed(_chutaos: bool) -> void:
	_apply_style()
