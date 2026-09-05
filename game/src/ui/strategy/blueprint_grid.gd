class_name BlueprintGrid
extends Control
## Rejilla de "papel de plano" detrás de las tarjetas de zona de Estrategia.
##
## Es la pieza que hace que la pantalla se LEA como un plano de planta y no
## como una lista de botones: el encargo pide que "el plano se ve, la
## composición enemiga no" (GDD §6) — aquí no hay geometría real de la zona
## (eso es dato de `levels/`, fuera de este ámbito), así que en vez de
## fabricar una silueta de sala que podría inducir a error, se dibuja el
## lenguaje visual de un plano técnico: rejilla fina en azul de la torre muy tenue.
##
## Puramente decorativo: sin `_process`, sin entrada, `mouse_filter` en
## IGNORE para no robarle el clic a las tarjetas que se dibujan encima.

const GRID_STEP_PX: float = 28.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	resized.connect(queue_redraw)


func _draw() -> void:
	var line_color := Palette.TOWER_BLUE_DIM
	line_color.a = 0.16
	var x := 0.0
	while x <= size.x:
		draw_line(Vector2(x, 0.0), Vector2(x, size.y), line_color, 1.0)
		x += GRID_STEP_PX
	var y := 0.0
	while y <= size.y:
		draw_line(Vector2(0.0, y), Vector2(size.x, y), line_color, 1.0)
		y += GRID_STEP_PX

	# Marco con esquinas remarcadas, como un plano acotado.
	var frame_color := Palette.TOWER_BLUE_DIM
	frame_color.a = 0.5
	var corner := 18.0
	var pts := [
		[Vector2(0, corner), Vector2(0, 0), Vector2(corner, 0)],
		[Vector2(size.x - corner, 0), Vector2(size.x, 0), Vector2(size.x, corner)],
		[Vector2(size.x, size.y - corner), Vector2(size.x, size.y), Vector2(size.x - corner, size.y)],
		[Vector2(corner, size.y), Vector2(0, size.y), Vector2(0, size.y - corner)],
	]
	for corner_pts: Array in pts:
		draw_polyline(PackedVector2Array(corner_pts), frame_color, 2.0)
