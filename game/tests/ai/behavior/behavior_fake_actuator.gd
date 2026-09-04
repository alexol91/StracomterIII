class_name BehaviorFakeActuator
extends BotActuator
## Cuerpo de mentira: recuerda dónde está y se mueve hacia donde le mandan.
##
## Es lo que permite ejecutar un árbol de comportamiento entero —"pide
## cobertura, camina hasta allí, agáchate, aguanta"— sin escena, sin física y
## sin navmesh horneado, en microsegundos.
##
## No es más amable que el cuerpo real en lo que importa: no se teletransporta
## al destino, avanza a velocidad finita, y si nadie llama a `advance()` no se
## mueve — igual que un `Character` cuyas intenciones nadie consume.

## Posición del cuerpo. Se inicializa a un punto REAL: un actuador sin cuerpo
## devuelve `Vector3.INF` y eso ya se prueba aparte.
var body_position: Vector3 = Vector3.ZERO
## Metros por segundo.
var speed_mps: float = 4.0
## Distancia recorrida en total, para comprobar que un bot se movió de verdad.
var distance_travelled_m: float = 0.0


func _init(p_position: Vector3 = Vector3.ZERO) -> void:
	body_position = p_position


func position() -> Vector3:
	return body_position


## Integra el movimiento pendiente. Lo llama el bucle de prueba después de
## cada tick de comportamiento, que es el papel que en el juego hace el tick
## de física al consumir las intenciones.
func advance(delta: float) -> void:
	if not BehaviorContext.is_finite_point(last_move_target):
		return
	var to_target := last_move_target - body_position
	to_target.y = 0.0
	var distance := to_target.length()
	if distance <= 0.0001:
		return
	var step := minf(speed_mps * delta, distance)
	body_position += to_target.normalized() * step
	distance_travelled_m += step
