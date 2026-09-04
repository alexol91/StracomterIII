class_name SquadOrder
extends RefCounted
## Orden del jugador a su escuadra (GDD §8.5).
##
## El original tenía UNA sola orden: la tecla V llamaba a
## `EventControl::ComeBackCompanions`, que hacía `calculatePath(posJugador)` y
## metía a los tres compañeros en el estado 4 (`GotoPoint`)
## —`docs/analisis/legacy-gameplay.md` §5.2—. Ni posición, ni foco de fuego,
## ni modos de agresividad. Aquí son tres: `Ir ahí`, `Enfocar eso` y
## `Mantener posición`.
##
## Es un objeto de datos inmutable en la práctica: se sustituye, no se muta.
## Así una orden que se está evaluando no cambia bajo los pies del bot a
## mitad de un tick de decisión.

enum Kind {
	NONE,           ## Sin orden: los compañeros vuelven a formación.
	MOVE_TO,        ## "Ir ahí".
	FOCUS_TARGET,   ## "Enfocar eso".
	HOLD_POSITION,  ## "Mantener posición".
}

## Claves de traducción. El código no lleva texto literal (CLAUDE.md).
const NAME_KEYS: Dictionary[Kind, String] = {
	Kind.NONE: "ORDER_NONE",
	Kind.MOVE_TO: "ORDER_MOVE_TO",
	Kind.FOCUS_TARGET: "ORDER_FOCUS_TARGET",
	Kind.HOLD_POSITION: "ORDER_HOLD_POSITION",
}

var kind: Kind = Kind.NONE
## Punto de la orden. `Vector3.INF` = sin punto.
var position: Vector3 = Vector3.INF
## Objetivo marcado, para `FOCUS_TARGET`. 0 = ninguno.
var target_id: int = 0
## Momento de emisión, en milisegundos de reloj de pared. Solo para la UI y
## para caducar órdenes viejas; NUNCA entra en una decisión, porque el reloj
## de pared no es determinista (ver la cabecera de `AIScheduler`).
var issued_msec: int = 0


static func none() -> SquadOrder:
	return SquadOrder.new()


static func move_to(point: Vector3) -> SquadOrder:
	var out := SquadOrder.new()
	out.kind = Kind.MOVE_TO
	out.position = point
	out.issued_msec = Time.get_ticks_msec()
	return out


static func focus_target(id: int, point: Vector3) -> SquadOrder:
	var out := SquadOrder.new()
	out.kind = Kind.FOCUS_TARGET
	out.target_id = id
	out.position = point
	out.issued_msec = Time.get_ticks_msec()
	return out


static func hold_position(point: Vector3 = Vector3.INF) -> SquadOrder:
	var out := SquadOrder.new()
	out.kind = Kind.HOLD_POSITION
	out.position = point
	out.issued_msec = Time.get_ticks_msec()
	return out


func is_active() -> bool:
	return kind != Kind.NONE


## Riesgo percibido de obedecer esta orden, 0..1. Entra en el balance de
## `SquadMorale`: obedecer "enfocar eso" es girar el arma; obedecer "ir ahí"
## puede ser cruzar un vano batido.
func risk() -> float:
	match kind:
		Kind.MOVE_TO:
			return SquadTuning.ORDER_RISK_MOVE_TO
		Kind.FOCUS_TARGET:
			return SquadTuning.ORDER_RISK_FOCUS_TARGET
		Kind.HOLD_POSITION:
			return SquadTuning.ORDER_RISK_HOLD_POSITION
		_:
			return 0.0


func name_key() -> String:
	return NAME_KEYS.get(kind, "ORDER_NONE")
