extends SceneTree
## Hornea las texturas del mundo del remake a PNG.
##
## Por qué un horno y no `NoiseTexture2D` en el propio material, que sería más
## corto: `NoiseTexture2D` genera en un hilo y su imagen NO está disponible
## hasta que termina. Eso tiene dos consecuencias que se descubrieron a base de
## chocar con ellas:
##
##   1. Un test que quiera medir el color real de la superficie recibe `null` y
##      —si no se tiene cuidado— se conforma con el tinte. La prueba pasa
##      midiendo otra cosa: exactamente el doble amable que hace que las
##      pruebas mientan.
##   2. El coste se paga en cada arranque del juego, en el peor momento.
##
## Horneando, las texturas son ficheros normales: el juego las carga como
## cualquier otra, los tests las pueden leer, y los parámetros siguen siendo
## revisables porque viven aquí, en texto, y no en un binario.
##
## Uso:
##   godot --headless --path game --script res://../tools/texture_baker/bake_textures.gd
##
## Es determinista: mismas semillas, mismo PNG. Volver a ejecutarlo no debería
## producir ningún cambio en git si no se han tocado los parámetros.

const OUT_DIR := "res://assets/textures/modern/"

## Semillas fijas. Cambiar una cambia la textura, así que se tratan como parte
## del diseño y no como un detalle.
const SEED_WALL := 1201
const SEED_PROP := 1202
const SEED_TRIM := 1203
const SEED_DOOR := 1204
const SEED_FLOOR := 1205
const SEED_CEILING := 1206
const SEED_FABRIC := 1207
const SEED_LEAF := 1208


func _init() -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUT_DIR))
	_bake_floor()
	_bake_ceiling()
	_bake_wall()
	_bake_trim()
	_bake_prop()
	_bake_door()
	_bake_upholstery()
	_bake_foliage()
	print("Texturas horneadas en ", OUT_DIR)
	quit()


# ---------------------------------------------------------------------------
# Superficies
# ---------------------------------------------------------------------------

## Gres porcelánico de gran formato. El boceto es `sueloOficina.jpg` del
## original: baldosa gris, junta marcada. Lo que lo hace parecer piedra de
## verdad y no una retícula dibujada es la variación de tono ENTRE piezas —una
## baldosa nunca es idéntica a su vecina— más un veteado dentro de cada una.
func _bake_floor() -> void:
	var size := 1024
	var tiles := 4
	var grain := _noise(SEED_FLOOR, FastNoiseLite.TYPE_SIMPLEX_SMOOTH, 0.010, 5, 0.45)
	var height := Image.create(size, size, false, Image.FORMAT_RF)
	var albedo := Image.create(size, size, false, Image.FORMAT_RGB8)
	var cell := float(size) / float(tiles)
	for y: int in range(size):
		for x: int in range(size):
			var u := fposmod(float(x), cell) / cell
			var v := fposmod(float(y), cell) / cell
			# Distancia al borde de la pieza, normalizada: 0 en la junta.
			var edge: float = minf(minf(u, 1.0 - u), minf(v, 1.0 - v))
			var grout := smoothstep(0.0, 0.018, edge)
			var tile_id := Vector2i(int(float(x) / cell), int(float(y) / cell))
			var shade := 1.0 + 0.05 * (_hash01(tile_id, SEED_FLOOR) - 0.5) * 2.0
			var veining := 0.06 * _seamless(grain, x, y, size, size)
			var value: float = clampf((0.86 + veining) * shade, 0.0, 1.0) * (0.42 + 0.58 * grout)
			height.set_pixel(x, y, Color(grout * 0.75 + 0.25 * (0.5 + 0.5 * veining), 0, 0))
			albedo.set_pixel(x, y, Color(value, value * 0.998, value * 0.985))
	_save(albedo, "floor_albedo.png")
	_save(_normal_from_height(height, 2.2), "floor_normal.png")
	_save(_roughness(height, 0.62, 0.16, true), "floor_roughness.png")


## Placas de techo acústico: misma idea de retícula, más densa, casi blanca, y
## con el punteado de la fibra mineral. En 2012 no había techo visible —cámara
## cenital—, así que aquí no hay original que respetar y manda la función.
func _bake_ceiling() -> void:
	var size := 512
	var tiles := 4
	var speckle := _noise(SEED_CEILING, FastNoiseLite.TYPE_VALUE, 0.9, 2, 0.5)
	var height := Image.create(size, size, false, Image.FORMAT_RF)
	var albedo := Image.create(size, size, false, Image.FORMAT_RGB8)
	var cell := float(size) / float(tiles)
	for y: int in range(size):
		for x: int in range(size):
			var u := fposmod(float(x), cell) / cell
			var v := fposmod(float(y), cell) / cell
			var edge: float = minf(minf(u, 1.0 - u), minf(v, 1.0 - v))
			var joint := smoothstep(0.0, 0.012, edge)
			var dots := 0.5 + 0.5 * _seamless(speckle, x, y, size, size)
			var value: float = (0.93 - 0.10 * dots) * (0.55 + 0.45 * joint)
			height.set_pixel(x, y, Color(joint * (0.7 + 0.3 * dots), 0, 0))
			albedo.set_pixel(x, y, Color(value, value, value * 0.985))
	_save(albedo, "ceiling_albedo.png")
	_save(_normal_from_height(height, 1.4), "ceiling_normal.png")


## Tabique pintado. El boceto es `pared.jpg` —hormigón claro con manchas— pero
## limpio: en el remake el edificio está en uso, no en obra. Valor medio-alto a
## propósito, porque es el fondo contra el que se recortan los enemigos.
func _bake_wall() -> void:
	var size := 512
	var blotch := _noise(SEED_WALL, FastNoiseLite.TYPE_SIMPLEX_SMOOTH, 0.006, 4, 0.4)
	var tooth := _noise(SEED_WALL + 1, FastNoiseLite.TYPE_VALUE, 0.7, 2, 0.5)
	var height := Image.create(size, size, false, Image.FORMAT_RF)
	var albedo := Image.create(size, size, false, Image.FORMAT_RGB8)
	for y: int in range(size):
		for x: int in range(size):
			var large := 0.5 + 0.5 * _seamless(blotch, x, y, size, size)
			var fine := 0.5 + 0.5 * _seamless(tooth, x, y, size, size)
			var value: float = clampf(0.90 + 0.07 * (large - 0.5) + 0.03 * (fine - 0.5), 0.0, 1.0)
			height.set_pixel(x, y, Color(fine, 0, 0))
			albedo.set_pixel(x, y, Color(value, value * 0.995, value * 0.975))
	_save(albedo, "wall_albedo.png")
	_save(_normal_from_height(height, 0.7), "wall_normal.png")


## Acero cepillado del borde del edificio. Lo que distingue el metal del
## plástico gris es que la raya va en una dirección: el ruido se muestrea muy
## estirado en X, y ese estiramiento es toda la textura.
func _bake_trim() -> void:
	var size := 512
	var brush := _noise(SEED_TRIM, FastNoiseLite.TYPE_VALUE, 1.0, 3, 0.55)
	var height := Image.create(size, size, false, Image.FORMAT_RF)
	var albedo := Image.create(size, size, false, Image.FORMAT_RGB8)
	for y: int in range(size):
		for x: int in range(size):
			# 24:1 de anisotropía: la raya recorre la pieza a lo largo.
			var streak := 0.5 + 0.5 * _seamless_scaled(brush, x, y, size, size, 1.0 / 24.0, 1.0)
			var value: float = clampf(0.80 + 0.20 * (streak - 0.5), 0.0, 1.0)
			height.set_pixel(x, y, Color(streak, 0, 0))
			albedo.set_pixel(x, y, Color(value, value, value))
	_save(albedo, "trim_albedo.png")
	_save(_normal_from_height(height, 0.5), "trim_normal.png")


## Mobiliario: melamina con grano. Tiene que quedar más oscuro que la pared o
## las coberturas no se leen contra el fondo, y hay un test que lo comprueba.
func _bake_prop() -> void:
	var size := 512
	var grain := _noise(SEED_PROP, FastNoiseLite.TYPE_SIMPLEX, 0.05, 3, 0.4)
	var height := Image.create(size, size, false, Image.FORMAT_RF)
	var albedo := Image.create(size, size, false, Image.FORMAT_RGB8)
	for y: int in range(size):
		for x: int in range(size):
			var n := 0.5 + 0.5 * _seamless(grain, x, y, size, size)
			var value: float = clampf(0.82 + 0.14 * (n - 0.5), 0.0, 1.0)
			height.set_pixel(x, y, Color(n, 0, 0))
			albedo.set_pixel(x, y, Color(value, value * 0.985, value * 0.965))
	_save(albedo, "prop_albedo.png")
	_save(_normal_from_height(height, 1.1), "prop_normal.png")


## Puerta de madera: el único acento cálido del mapa, puesto donde el jugador
## tiene que mirar. La veta son anillos —una coordenada distorsionada por ruido
## y pasada por una función periódica—, no manchas: eso es lo que separa una
## madera creíble de una textura sucia.
func _bake_door() -> void:
	var size := 512
	var warp := _noise(SEED_DOOR, FastNoiseLite.TYPE_SIMPLEX_SMOOTH, 0.008, 4, 0.5)
	var pore := _noise(SEED_DOOR + 1, FastNoiseLite.TYPE_VALUE, 0.8, 2, 0.5)
	var height := Image.create(size, size, false, Image.FORMAT_RF)
	var albedo := Image.create(size, size, false, Image.FORMAT_RGB8)
	for y: int in range(size):
		for x: int in range(size):
			var distortion := _seamless(warp, x, y, size, size)
			# 6 anillos por baldosa, ondulados por el ruido. El seno con período
			# entero en `size` mantiene la costura invisible.
			var rings := 0.5 + 0.5 * sin(TAU * (6.0 * float(x) / float(size) + 0.28 * distortion))
			var pores := 0.5 + 0.5 * _seamless(pore, x, y, size, size)
			var value: float = clampf(0.78 + 0.22 * rings - 0.06 * pores, 0.0, 1.0)
			height.set_pixel(x, y, Color(rings * 0.8 + 0.2 * pores, 0, 0))
			albedo.set_pixel(x, y, Color(value, value * 0.80, value * 0.60))
	_save(albedo, "door_albedo.png")
	_save(_normal_from_height(height, 0.9), "door_normal.png")


## Tapicería de sofá y sillón. El tejido es la trama: hilos que pasan por
## encima y por debajo alternándose. Se genera con dos senos desfasados, no con
## ruido, porque un tejido es periódico y el ruido nunca lo parece.
func _bake_upholstery() -> void:
	var size := 512
	var fuzz := _noise(SEED_FABRIC, FastNoiseLite.TYPE_VALUE, 1.2, 2, 0.5)
	var height := Image.create(size, size, false, Image.FORMAT_RF)
	var albedo := Image.create(size, size, false, Image.FORMAT_RGB8)
	var threads := 48.0
	for y: int in range(size):
		for x: int in range(size):
			var u := PI * threads * float(x) / float(size)
			var v := PI * threads * float(y) / float(size)
			var warp := 0.5 + 0.5 * sin(u)
			var weft := 0.5 + 0.5 * sin(v)
			# El trenzado de verdad: en cada cruce manda uno de los dos hilos, y
			# cuál manda alterna como un tablero de ajedrez. Promediarlos —que
			# es lo que hace un `max` ingenuo— deja la tela lisa: se probó y no
			# se veía la trama.
			var over := posmod(int(floor(u / PI)) + int(floor(v / PI)), 2) == 0
			var weave: float = warp if over else weft
			var lint := 0.5 + 0.5 * _seamless(fuzz, x, y, size, size)
			var value: float = clampf(0.60 + 0.34 * weave - 0.07 * lint, 0.0, 1.0)
			height.set_pixel(x, y, Color(weave, 0, 0))
			albedo.set_pixel(x, y, Color(value * 0.93, value * 0.95, value))
	_save(albedo, "upholstery_albedo.png")
	_save(_normal_from_height(height, 1.6), "upholstery_normal.png")


## Follaje de la maceta. No protege de nada —lo dice el GDD— pero rompe la
## línea de visión, así que tiene que leerse como planta y no como un bulto
## verde: manchas grandes de hoja y nervadura fina encima.
func _bake_foliage() -> void:
	var size := 512
	var leaves := _noise(SEED_LEAF, FastNoiseLite.TYPE_CELLULAR, 0.05, 1, 0.5)
	leaves.cellular_jitter = 1.0
	leaves.cellular_return_type = FastNoiseLite.RETURN_CELL_VALUE
	var veins := _noise(SEED_LEAF + 1, FastNoiseLite.TYPE_SIMPLEX, 0.25, 3, 0.5)
	var height := Image.create(size, size, false, Image.FORMAT_RF)
	var albedo := Image.create(size, size, false, Image.FORMAT_RGB8)
	for y: int in range(size):
		for x: int in range(size):
			var leaf := 0.5 + 0.5 * _seamless(leaves, x, y, size, size)
			var vein := 0.5 + 0.5 * _seamless(veins, x, y, size, size)
			var shade: float = clampf(0.55 + 0.35 * leaf - 0.12 * vein, 0.0, 1.0)
			height.set_pixel(x, y, Color(leaf * 0.7 + 0.3 * vein, 0, 0))
			albedo.set_pixel(x, y, Color(shade * 0.34, shade * 0.72, shade * 0.30))
	_save(albedo, "foliage_albedo.png")
	_save(_normal_from_height(height, 1.8), "foliage_normal.png")


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

static func _noise(noise_seed: int, type: FastNoiseLite.NoiseType, frequency: float,
		octaves: int, gain: float) -> FastNoiseLite:
	var noise := FastNoiseLite.new()
	noise.seed = noise_seed
	noise.noise_type = type
	noise.frequency = frequency
	noise.fractal_octaves = octaves
	noise.fractal_gain = gain
	return noise


## Ruido que repite sin costura, con la mezcla clásica en las cuatro esquinas:
## cada píxel se promedia con lo que habría a una anchura/altura de distancia,
## pesado por lo cerca que está del borde. Sin esto, la textura enseña una línea
## en cada repetición y no hay material que la salve.
static func _seamless(noise: FastNoiseLite, x: int, y: int, w: int, h: int) -> float:
	return _seamless_scaled(noise, x, y, w, h, 1.0, 1.0)


static func _seamless_scaled(noise: FastNoiseLite, x: int, y: int, w: int, h: int,
		sx: float, sy: float) -> float:
	var fx := float(x)
	var fy := float(y)
	var fw := float(w)
	var fh := float(h)
	var a := noise.get_noise_2d(fx * sx, fy * sy)
	var b := noise.get_noise_2d((fx - fw) * sx, fy * sy)
	var c := noise.get_noise_2d(fx * sx, (fy - fh) * sy)
	var d := noise.get_noise_2d((fx - fw) * sx, (fy - fh) * sy)
	var wx := fw - fx
	var wy := fh - fy
	return (a * wx * wy + b * fx * wy + c * wx * fy + d * fx * fy) / (fw * fh)


## Mapa de normales a partir de una altura, por Sobel. Se calcula aquí y no con
## `NoiseTexture2D.as_normal_map` porque así la normal corresponde a la altura
## que de verdad se usó para el albedo —junta incluida—, y no a otra cosa
## parecida.
static func _normal_from_height(height: Image, strength: float) -> Image:
	var w := height.get_width()
	var h := height.get_height()
	var out := Image.create(w, h, false, Image.FORMAT_RGB8)
	for y: int in range(h):
		for x: int in range(w):
			var l := height.get_pixel(posmod(x - 1, w), y).r
			var r := height.get_pixel(posmod(x + 1, w), y).r
			var u := height.get_pixel(x, posmod(y - 1, h)).r
			var d := height.get_pixel(x, posmod(y + 1, h)).r
			var normal := Vector3((l - r) * strength, (u - d) * strength, 1.0).normalized()
			out.set_pixel(x, y, Color(
				normal.x * 0.5 + 0.5, normal.y * 0.5 + 0.5, normal.z * 0.5 + 0.5))
	return out


## Rugosidad derivada de la altura: lo hundido (la junta) es mate, lo alto está
## pulido por el paso de la gente. Es un detalle pequeño y es de los que más
## hacen por que una superficie parezca real.
static func _roughness(height: Image, base: float, span: float, invert: bool) -> Image:
	var w := height.get_width()
	var h := height.get_height()
	var out := Image.create(w, h, false, Image.FORMAT_RGB8)
	for y: int in range(h):
		for x: int in range(w):
			var value := height.get_pixel(x, y).r
			if invert:
				value = 1.0 - value
			var rough: float = clampf(base + span * (value - 0.5) * 2.0, 0.0, 1.0)
			out.set_pixel(x, y, Color(rough, rough, rough))
	return out


## Valor pseudoaleatorio estable por celda. Con `randf()` la textura cambiaría
## en cada horneado y el PNG saldría distinto sin que nadie tocara nada.
static func _hash01(cell: Vector2i, salt: int) -> float:
	var n := cell.x * 374761393 + cell.y * 668265263 + salt * 2147483647
	n = (n ^ (n >> 13)) * 1274126177
	return float((n ^ (n >> 16)) & 0xFFFFFF) / float(0xFFFFFF)


static func _save(image: Image, file_name: String) -> void:
	var path := ProjectSettings.globalize_path(OUT_DIR + file_name)
	var err := image.save_png(path)
	if err != OK:
		push_error("no se pudo guardar %s: %d" % [path, err])
	else:
		print("  ", file_name, " ", image.get_width(), "x", image.get_height())
