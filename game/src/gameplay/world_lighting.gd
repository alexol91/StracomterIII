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
## Azotea de noche (GDD §6: "Helipuerto, viento, noche"). La luna hace de sol:
## misma clase de luz, un cuarto de energía y desplazada al azul.
const MOON_ROTATION := Vector3(-58.0, 25.0, 0.0)
const MOON_COLOR := Color(0.72, 0.80, 1.0)
const MOON_ENERGY: float = 0.35
const NIGHT_SKY_TOP := Color(0.03, 0.05, 0.11)
const NIGHT_SKY_HORIZON := Color(0.10, 0.14, 0.24)
const NIGHT_GROUND := Color(0.05, 0.06, 0.09)
## Ambiente de la noche. Bajo, pero NO tan bajo que la azotea se vuelva el
## agujero negro del que trata la mitad de este fichero: con 0,18 se distinguen
## siluetas, coberturas y el jefe, que es lo que hay que poder ver para jugar.
## Una noche de videojuego es azul oscuro legible, no oscuridad real.
const NIGHT_AMBIENT := Color(0.34, 0.42, 0.62)
const NIGHT_AMBIENT_ENERGY: float = 0.55

## Luminarias de techo. Separación en metros, altura y alcance.
##
## Existen porque la cara INTERIOR de un muro no ve el sol: solo le llega el
## ambiente, y en una vista cenital de la planta 1 esas caras salían casi
## negras mientras las exteriores se leían en gris claro. Subir el ambiente no
## es la respuesta —a partir de cierto punto el suelo se sobreexpone y se come
## la dirección de arte— y depender más del aporte del cielo tampoco: eso es
## imagen, cambia con el renderizador y es exactamente lo que este fichero se
## propuso no hacer.
##
## Una oficina se ilumina desde el techo. Es la solución que sobrevive al
## cambio de renderizador porque no es un truco de ambiente: son luces.
const CEILING_SPACING_M: float = 4.5
const CEILING_HEIGHT_M: float = 2.75
const CEILING_RANGE_M: float = 8.5
const CEILING_ENERGY: float = 1.6
const CEILING_COLOR := Color(1.0, 0.97, 0.92)
## Techo de luminarias por planta. Con 4,5 m de separación, un mapa grande
## (~40 × 25 m con la mitad de su caja envolvente ocupada) pide unas 40; el
## tope evita que un mapa raro meta doscientas luces en la escena y se lleve
## por delante el presupuesto de render.
const CEILING_MAX_LIGHTS: int = 48

## ¿Es esta planta a cielo abierto? Lo dice la metadata que deja el conversor
## (`--exterior`). Cambia dos cosas: no hay techo del que colgar luminarias, y
## la iluminación es la de noche.
##
## Por defecto NO: los 27 mapas del original son interiores, y equivocarse
## hacia "interior" solo cuesta luz de más; equivocarse hacia "exterior"
## deja una planta a oscuras. Ante la duda, hay techo.
var _exterior: bool = false

var _environment: WorldEnvironment = null
var _sun: DirectionalLight3D = null
var _ceiling: Node3D = null


func _ready() -> void:
	_build()
	_apply_style()
	if not PresentationStyle.style_changed.is_connected(_on_style_changed):
		PresentationStyle.style_changed.connect(_on_style_changed)


func _build() -> void:
	var root := get_parent()
	_exterior = root != null and bool(root.get_meta(&"exterior", false))

	_environment = WorldEnvironment.new()
	_environment.name = "Environment"
	_environment.environment = Environment.new()
	add_child(_environment)

	_sun = DirectionalLight3D.new()
	_sun.name = "Sun"
	add_child(_sun)

	_ceiling = Node3D.new()
	_ceiling.name = "CeilingLights"
	add_child(_ceiling)
	if not _exterior:
		_build_ceiling_lights()


func _apply_style() -> void:
	if _environment == null or _sun == null:
		return
	if _ceiling != null:
		# En 2012 no había luces de techo: había color plano. Encenderlas en
		# modo Chutaos rompería justo lo que ese modo conserva. Y en una azotea
		# no hay ninguna que encender.
		_ceiling.visible = not PresentationStyle.chutaos_mode and not _exterior
	if PresentationStyle.chutaos_mode:
		_apply_chutaos()
	elif _exterior:
		_apply_night()
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


## Azotea de noche. No es la de dentro con el ambiente bajado: la fuente
## cambia de sitio. Dentro, la luz venía del techo y el sol se quedaba fuera;
## aquí no hay techo y la única luz direccional es la luna, así que el relleno
## tiene que venir del cielo y del color de ambiente, y las sombras son largas
## y suaves porque la fuente está baja.
func _apply_night() -> void:
	var env := _environment.environment
	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = NIGHT_SKY_TOP
	sky_material.sky_horizon_color = NIGHT_SKY_HORIZON
	sky_material.ground_bottom_color = NIGHT_GROUND
	sky_material.ground_horizon_color = NIGHT_SKY_HORIZON
	sky_material.sun_angle_max = 30.0
	var sky := Sky.new()
	sky.sky_material = sky_material
	env.sky = sky
	env.background_mode = Environment.BG_SKY
	env.background_energy_multiplier = 1.0
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_color = NIGHT_AMBIENT
	# Más aporte de color explícito que de cielo, por lo mismo que de día: el
	# aporte del cielo es imagen y cambia con el renderizador.
	env.ambient_light_sky_contribution = 0.30
	env.ambient_light_energy = NIGHT_AMBIENT_ENERGY
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_white = 4.0
	env.ssao_enabled = true
	env.ssao_intensity = 1.1
	env.ssao_radius = 0.6
	env.ssil_enabled = false
	env.sdfgi_enabled = false
	env.glow_enabled = false

	_sun.rotation_degrees = MOON_ROTATION
	_sun.light_color = MOON_COLOR
	_sun.light_energy = MOON_ENERGY
	_sun.shadow_enabled = true
	_sun.shadow_opacity = 0.45
	_sun.shadow_blur = 1.6
	_sun.directional_shadow_max_distance = 80.0


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


## Reparte luminarias por la planta, en rejilla sobre el suelo REAL.
##
## La huella sale de los triángulos que el conversor deja en el nodo `Floor`
## (`floor_vertices` + `floor_indices`): son propiedades exportadas, así que
## están rellenas al instanciar la escena y no dependen de que la física, la
## navegación o el `_ready` de nadie hayan corrido. Una planta en L tiene la
## mitad de su caja envolvente fuera del edificio, y una luz ahí no ilumina
## nada: solo gasta presupuesto.
##
## Si no hay suelo del que fiarse se cae a la caja envolvente legacy, y si
## tampoco la hay no se pone ninguna luminaria. Ante la duda, no se inventa
## geometría.
func _build_ceiling_lights() -> void:
	var root := get_parent()
	if root == null:
		return
	var triangles := _floor_triangles(root)
	var extent := _floor_extent(root, triangles)
	if extent.size.x <= 0.0 or extent.size.y <= 0.0:
		return

	var spacing := CEILING_SPACING_M
	var points := _ceiling_grid(extent, spacing, triangles)
	# Un mapa muy grande pediría más luces de las que se pueden pagar. Antes
	# que dejar media planta a oscuras —que es lo que hace un tope aplicado
	# mientras se recorre la rejilla: corta a mitad de columna— se separan más
	# las luminarias y se vuelve a repartir. Peor resolución, cobertura
	# completa. El bucle termina porque al crecer la separación la rejilla
	# acaba en un solo punto.
	while points.size() > CEILING_MAX_LIGHTS:
		spacing *= 1.25
		points = _ceiling_grid(extent, spacing, triangles)

	for point: Vector2 in points:
		var light := OmniLight3D.new()
		light.light_color = CEILING_COLOR
		light.light_energy = CEILING_ENERGY
		light.omni_range = CEILING_RANGE_M
		# Sin sombras: son cuarenta luces y la dirección de la escena ya la da
		# el sol. Sombras aquí serían cuarenta pasadas por nada. El efecto
		# secundario es útil: la luz atraviesa los muros y también alumbra la
		# cara interior del de al lado, que es justo lo que faltaba.
		light.shadow_enabled = false
		light.position = Vector3(point.x, CEILING_HEIGHT_M, point.y)
		_ceiling.add_child(light)


## Centros de las celdas de la rejilla que caen sobre el suelo.
##
## El paso se REDONDEA en vez de truncarse: con `floor()`, un mapa de 14 × 9 m
## y 5 m de separación daba 2 columnas × 1 fila —dos luminarias para toda la
## planta, repartidas cada 7 m— y el resultado era indistinguible de no tener
## ninguna. Ese fue el fallo real de la primera versión de este fichero.
func _ceiling_grid(
		extent: Rect2, spacing: float, triangles: Array[PackedVector2Array]) -> PackedVector2Array:
	var columns := maxi(int(round(extent.size.x / spacing)), 1)
	var rows := maxi(int(round(extent.size.y / spacing)), 1)
	var step_x := extent.size.x / float(columns)
	var step_z := extent.size.y / float(rows)
	var out := PackedVector2Array()
	for column: int in range(columns):
		for row: int in range(rows):
			# A media celda del borde: una luminaria pegada al muro ilumina el
			# muro y deja la sala a medias.
			var point := Vector2(
				extent.position.x + (float(column) + 0.5) * step_x,
				extent.position.y + (float(row) + 0.5) * step_z)
			if triangles.is_empty() or _is_over_floor(point, triangles):
				out.append(point)
	return out


func _is_over_floor(point: Vector2, triangles: Array[PackedVector2Array]) -> bool:
	for tri: PackedVector2Array in triangles:
		if Geometry2D.point_is_inside_triangle(point, tri[0], tri[1], tri[2]):
			return true
	return false


## Triángulos del suelo proyectados al plano XZ, tal cual los exportó el
## conversor. Vacío si el mapa no trae suelo del que fiarse.
func _floor_triangles(root: Node) -> Array[PackedVector2Array]:
	var out: Array[PackedVector2Array] = []
	var floor_node := root.get_node_or_null(^"Floor")
	if floor_node == null:
		return out
	var vertices: Variant = floor_node.get(&"floor_vertices")
	var indices: Variant = floor_node.get(&"floor_indices")
	if not (vertices is PackedVector3Array) or not (indices is PackedInt32Array):
		return out
	var points := vertices as PackedVector3Array
	var order := indices as PackedInt32Array
	var count := order.size() - order.size() % 3
	for base: int in range(0, count, 3):
		var a := order[base]
		var b := order[base + 1]
		var c := order[base + 2]
		if a >= points.size() or b >= points.size() or c >= points.size():
			continue
		out.append(PackedVector2Array([
			Vector2(points[a].x, points[a].z),
			Vector2(points[b].x, points[b].z),
			Vector2(points[c].x, points[c].z)]))
	return out


## Extensión sobre la que se reparte la rejilla: la del suelo si lo hay, y si
## no la caja envolvente que dejó el conversor en la metadata.
func _floor_extent(root: Node, triangles: Array[PackedVector2Array]) -> Rect2:
	if not triangles.is_empty():
		var extent := Rect2(triangles[0][0], Vector2.ZERO)
		for tri: PackedVector2Array in triangles:
			for point: Vector2 in tri:
				extent = extent.expand(point)
		return extent
	# `get_meta` con un `null` por defecto NO se calla si la clave no existe:
	# Godot interpreta el nil como «sin valor por defecto» y suelta un error.
	# Se pregunta antes.
	if not root.has_meta(&"legacy_bbox"):
		return Rect2()
	var bbox: Variant = root.get_meta(&"legacy_bbox")
	var scale_u: float = float(root.get_meta(&"scale_u_to_m", 0.0))
	if not (bbox is Rect2) or scale_u <= 0.0:
		return Rect2()
	var area := bbox as Rect2
	return Rect2(area.position * scale_u, area.size * scale_u)


## Cuántas luminarias de techo se han puesto. Para las pruebas: una planta sin
## ninguna se ve como se veía antes, y eso hay que poder detectarlo.
func ceiling_light_count() -> int:
	return _ceiling.get_child_count() if _ceiling != null else 0
