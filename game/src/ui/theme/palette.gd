class_name Palette
extends RefCounted
## Paleta de la interfaz (encargo "listón visual AAA"), en un único fichero
## para que "azul Elite" o "naranja de amenaza" signifiquen lo mismo en cada
## pantalla. Dirección de arte no negociable (principio de Team Fortress 2
## aplicado a un shooter táctico): el mundo va desaturado y de bajo
## contraste; lo que importa va saturado y de alto contraste.
##
## Regla dura de esta paleta: **el naranja/rojo de amenaza solo aparece en
## avisos de daño y peligro.** Si aparece en un botón decorativo deja de
## significar peligro (encargo, sección "Dirección de arte"). Por eso no hay
## aquí ningún `BUTTON_ACCENT` en naranja: los botones usan azul Elite.
##
## Sin nodos, sin `_ready`: son constantes puras, comprobables en headless.

## --- Azul Elite: la torre, el marco, la interacción -----------------------
const ELITE_BLUE: Color = Color(0.302, 0.639, 1.0)          # #4DA3FF
const ELITE_BLUE_DIM: Color = Color(0.176, 0.373, 0.584)    # variante apagada (bordes, hover leve)
const ELITE_BLUE_BRIGHT: Color = Color(0.573, 0.792, 1.0)   # variante clara (texto activo, foco)

## --- Naranja/rojo de amenaza: SOLO daño y alerta ---------------------------
const THREAT_ORANGE: Color = Color(1.0, 0.478, 0.239)       # #FF7A3D
const THREAT_RED: Color = Color(0.910, 0.235, 0.196)        # variante crítica (vida baja, Game Over)

## --- Gris corporativo frío: el mundo, los paneles --------------------------
const NEUTRAL_950: Color = Color(0.035, 0.043, 0.055)
const NEUTRAL_900: Color = Color(0.055, 0.067, 0.086)
const NEUTRAL_800: Color = Color(0.098, 0.114, 0.137)
const NEUTRAL_700: Color = Color(0.157, 0.180, 0.212)
const NEUTRAL_500: Color = Color(0.373, 0.408, 0.451)
const NEUTRAL_300: Color = Color(0.671, 0.694, 0.722)
const NEUTRAL_100: Color = Color(0.902, 0.910, 0.922)

## --- Semántica sobre las anteriores, para que las pantallas no citen
## directamente un tono gris/azul y pierdan el porqué ------------------------
const TEXT_PRIMARY: Color = NEUTRAL_100
const TEXT_SECONDARY: Color = NEUTRAL_300
const TEXT_DISABLED: Color = NEUTRAL_500
const PANEL_BACKGROUND: Color = NEUTRAL_900
const PANEL_BORDER: Color = ELITE_BLUE_DIM

## Salud: verde-azulado sano -> naranja/rojo de amenaza según fracción
## restante. Vive aquí (no en el HUD) para que cualquier pantalla que
## necesite "colorear una barra de vida" use la misma curva de color.
const HEALTH_FULL: Color = Color(0.376, 0.827, 0.643)
const HEALTH_LOW: Color = THREAT_RED

## `fraction` en [0,1]. Por debajo de `LOW_HEALTH_FRACTION` el color ya está
## a mitad de camino hacia la alerta, para que "vida baja" se LEA antes de
## llegar a cero, no en el último instante.
const LOW_HEALTH_FRACTION: float = 0.35


static func health_color(fraction: float) -> Color:
	var f := clampf(fraction, 0.0, 1.0)
	if f >= LOW_HEALTH_FRACTION:
		# Del límite de "bajo" a lleno: de naranja de alerta a sano.
		var t := (f - LOW_HEALTH_FRACTION) / (1.0 - LOW_HEALTH_FRACTION)
		return THREAT_ORANGE.lerp(HEALTH_FULL, t)
	# Por debajo del límite: de rojo de alerta (0) a naranja (el propio límite),
	# continuo con la rama de arriba en `f == LOW_HEALTH_FRACTION`.
	var t2 := f / LOW_HEALTH_FRACTION
	return HEALTH_LOW.lerp(THREAT_ORANGE, t2)
