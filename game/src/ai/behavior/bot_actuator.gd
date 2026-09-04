class_name BotActuator
extends RefCounted
## Costura entre el árbol de comportamiento y el cuerpo del bot.
##
## `gameplay/` no conoce `ai/` (ADR-001): un `Character` expone INTENCIONES y
## le da igual quién las rellena. Esta clase es quien las rellena por parte de
## la IA, y existe como interfaz separada por una razón concreta: así el árbol
## de comportamiento se prueba en `--headless` contra un actuador de mentira,
## sin cuerpo, sin física y sin escena.
##
## La implementación base NO MUEVE NADA y declara que no sabe dónde está
## (`position()` devuelve `Vector3.INF`). No es un descuido: un actuador sin
## cuerpo que dijera estar en el origen haría que un bot mal montado creyera
## estar en el centro del mapa y caminara hacia allí tan tranquilo, sin un
## solo error. Las acciones comprueban que la posición sea finita antes de
## moverse, así que un montaje incompleto FALLA de forma visible.
##
## Registra las órdenes recibidas aunque no haga nada con ellas: eso es lo que
## permite a una prueba afirmar "este bot NO disparó" y a la consola enseñar la
## última orden de un bot que se ha quedado tonto.

## Última orden de movimiento. `Vector3.INF` = ninguna.
var last_move_target: Vector3 = Vector3.INF
## Último punto al que se ordenó mirar.
var last_look_target: Vector3 = Vector3.INF
## Órdenes acumuladas, para telemetría y pruebas.
var fire_count: int = 0
var reload_count: int = 0
var stop_count: int = 0
var crouching: bool = false


## Dónde está el cuerpo. `Vector3.INF` = no se sabe (actuador sin cuerpo).
func position() -> Vector3:
	return Vector3.INF


## ¿Está este actuador enlazado a un cuerpo de verdad? Las acciones lo
## comprueban antes de intentar moverse.
func is_embodied() -> bool:
	var p := position()
	return not (is_inf(p.x) or is_inf(p.y) or is_inf(p.z))


## Camina hacia un punto del mundo. El actuador traduce a la intención de
## movimiento del `Character`, que es direccional.
func move_towards(point: Vector3) -> void:
	last_move_target = point


## Deja de moverse. No es lo mismo que "no llamar a move_towards": las
## intenciones se limpian cada tick de física, pero una acción que termina
## debe poder dejar el cuerpo quieto explícitamente.
func stop() -> void:
	last_move_target = Vector3.INF
	stop_count += 1


func face(point: Vector3) -> void:
	last_look_target = point


func fire() -> void:
	fire_count += 1


func reload() -> void:
	reload_count += 1


func set_crouch(value: bool) -> void:
	crouching = value


## Radio con el que se da por alcanzado un destino.
func arrival_radius_m() -> float:
	return BehaviorTuning.ARRIVAL_RADIUS_M
