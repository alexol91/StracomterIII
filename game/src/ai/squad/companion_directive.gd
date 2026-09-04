class_name CompanionDirective
extends RefCounted
## Lo que un compañero debe intentar este ciclo de decisión. Objeto de datos
## puro: lo produce `CompanionController.decide()` y lo consume el cerebro de
## `ai/behavior` a través de `SquadBrainPort`.
##
## Separa DOS cosas que el original mezclaba en la misma FSM: qué quiere el
## jugador (la orden) y qué está dispuesto a hacer el compañero (la lista de
## permitidos y la tabla de pesos). Cuando las dos coinciden, obedece; cuando
## no, la orden se cae y la tabla cambia a la de supervivencia. Es la moral
## haciéndose visible.

var bot_id: int = 0
## Orden EFECTIVA: `NONE` si el compañero ha decidido no obedecer.
var order_kind: SquadOrder.Kind = SquadOrder.Kind.NONE
## ¿Obedece la orden que tenía pendiente?
var obeys: bool = true
## 0..1. Cuánto está dispuesto a obedecer.
var obedience: float = 1.0
## Cuánto empuja la situación a ponerse a salvo (incluye el riesgo de la orden).
var survival_pressure: float = 0.0
## Moral efectiva con la que se ha tomado la decisión.
var morale: int = 0
## Está tan herido que se retira aunque obedezca.
var critical: bool = false

## Punto al que ir. `Vector3.INF` = ninguno. Con orden `MOVE_TO` es el punto
## de la orden; sin orden, el hueco de formación.
var move_target: Vector3 = Vector3.INF
## Hueco de formación en coordenadas de mundo. Siempre calculado, aunque haya
## orden: es a donde vuelve cuando la orden termina.
var formation_slot: Vector3 = Vector3.INF
## Objetivo marcado por "Enfocar eso" o por la habilidad *Órdenes* del
## Capitán. 0 = ninguno.
var focus_target_id: int = 0
var focus_position: Vector3 = Vector3.INF

## Comportamientos permitidos (`BehaviorKind.Kind`).
var allowed: PackedInt32Array = PackedInt32Array()
## Tabla de pesos con la que el cerebro debe elegir dentro de `allowed`.
var weights: SquadWeightTable = null


func allows(kind: BehaviorKind.Kind) -> bool:
	return allowed.has(int(kind))


func has_move_target() -> bool:
	return not is_inf(move_target.x)


func has_focus() -> bool:
	return focus_target_id != 0 or not is_inf(focus_position.x)
