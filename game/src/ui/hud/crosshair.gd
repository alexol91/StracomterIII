class_name Crosshair
extends Control
## Retículo de puntería.
##
## No existía. Con el cursor del sistema visible se podía apuntar «a ojo» con
## el puntero, pero en cuanto el juego captura el ratón —que es lo que hay que
## hacer para que la cámara reciba movimientos relativos de verdad— no queda
## NADA en pantalla que diga a dónde apuntas. Reportado jugando: «no hay
## puntero para apuntar y disparar».
##
## Se dibuja en código y no con texturas por lo mismo que el resto del HUD: no
## hay assets 2D en el proyecto y una cruz de cuatro trazos con hueco central
## se lee sobre cualquier fondo, que es justo lo que un retículo tiene que
## hacer.

## Hueco central en píxeles: deja ver lo que hay debajo del punto de mira.
const GAP_PX: float = 5.0
## Largo de cada trazo.
const ARM_PX: float = 9.0
const THICKNESS_PX: float = 2.0
## Radio del punto central.
const DOT_PX: float = 1.5


func _ready() -> void:
	# El retículo no se pulsa: si comiera el ratón, no se podría disparar.
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)


func _draw() -> void:
	var center := size * 0.5
	# Contorno oscuro debajo y trazo claro encima: sin el contorno, el retículo
	# desaparece sobre el tabique blanco, que es la mitad de la planta.
	for pass_index: int in range(2):
		var outline := pass_index == 0
		var color := Palette.NEUTRAL_950 if outline else Palette.TEXT_PRIMARY
		var thickness := THICKNESS_PX + (2.0 if outline else 0.0)
		for direction: Vector2 in [Vector2.LEFT, Vector2.RIGHT, Vector2.UP, Vector2.DOWN]:
			draw_line(center + direction * GAP_PX,
				center + direction * (GAP_PX + ARM_PX), color, thickness)
		draw_circle(center, DOT_PX + (1.0 if outline else 0.0), color)
