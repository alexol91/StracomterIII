class_name DamageIndicatorMath
extends RefCounted
## Geometría pura del indicador de dirección del daño (GDD §10). El original
## no tenía nada parecido (`legacy-gameplay.md` §9.3: "No hay... indicador de
## daño"); aquí es HUD imprescindible: sin él, en tercera persona, un
## disparo desde fuera de cámara no se explica.

## Ángulo, en grados, del origen del daño respecto a hacia dónde mira el
## jugador, medido en el plano horizontal: 0 = delante, 90 = derecha,
## 180/-180 = detrás, -90 = izquierda. Es el ángulo que hay que girar el
## icono de aviso en pantalla.
static func screen_angle_deg(
	player_position: Vector3,
	player_forward: Vector3,
	source_position: Vector3
) -> float:
	var to_source := Vector2(source_position.x - player_position.x, source_position.z - player_position.z)
	if to_source.length_squared() < 0.000001:
		return 0.0
	var forward_flat := Vector2(player_forward.x, player_forward.z)
	if forward_flat.length_squared() < 0.000001:
		forward_flat = Vector2(0.0, -1.0)
	forward_flat = forward_flat.normalized()
	to_source = to_source.normalized()
	# Ángulo con signo entre "delante" y "hacia el origen del daño", positivo
	# en sentido horario (pantalla: derecha = positivo).
	var angle := forward_flat.angle_to(to_source)
	return rad_to_deg(angle)
