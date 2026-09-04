class_name CompanionController
extends RefCounted
## Un compañero del jugador ([P05], GDD §8.5).
##
## EL MISMO CEREBRO QUE LOS ENEMIGOS. Este fichero no contiene ninguna IA:
## no puntúa situaciones, no elige comportamientos y no ejecuta árboles. Eso
## lo hace `ai/behavior`, el mismo selector por utilidad que mueve a los
## enemigos, invocado a través de `SquadBrainPort`. Lo único que cambia entre
## un enemigo y un compañero es la TABLA DE PESOS (`SquadWeightTable`) y la
## lista de comportamientos permitidos. Un solo sistema de IA para los dos
## bandos es la mitad de código y el doble de calidad en ambos lados, y es
## exactamente lo contrario de lo que hacía el original: cuatro FSM de
## compañero (`Captain.cc`, `Technic.cc`, `Especialist.cc`, `Explosive.cc`)
## copiadas y pegadas, idénticas salvo umbrales, más una quinta para los
## enemigos (`Enemy.cc`). Cinco máquinas de estados que arreglar cinco veces.
##
## LO QUE SÍ HACE ESTE FICHERO:
##   * calcular el hueco de formación,
##   * resolver la orden del jugador (`Ir ahí`, `Enfocar eso`, `Mantener
##     posición`),
##   * y decidir, según la MORAL, si la obedece o si antepone sobrevivir.
##
## Puro y sin escena: `(BotState, orden, líder) -> CompanionDirective`.

## Id del personaje (`Character.get_instance_id()` en ejecución).
var bot_id: int = 0
var archetype: StringName = &""
## Hueco de formación, 0..2 (`CompanionFormation`).
var slot: int = 0
## Moral de la ficha del arquetipo (`CharacterStats.morale`).
var base_morale: int = 0
## Bajas acumuladas de la escuadra que este compañero ha "pagado". EXTENSIÓN
## sobre el original, que no penalizaba nada.
var morale_penalty: int = 0
## ¿Está dentro del aura de un Capitán vivo? Lo actualiza `CompanionSquad`.
var near_captain: bool = false


func _init(p_bot_id: int = 0, p_archetype: StringName = &"", p_slot: int = 0,
		p_base_morale: int = 0) -> void:
	bot_id = p_bot_id
	archetype = p_archetype
	slot = p_slot
	base_morale = p_base_morale


## Moral efectiva ahora mismo.
func morale() -> int:
	return SquadMorale.effective_morale(base_morale, near_captain, morale_penalty)


## Decide qué debe intentar este compañero.
##
## `order` puede ser `null` (equivale a "sin orden"). `leader_forward` es el
## rumbo del jugador, que es lo que orienta la formación —igual que el
## `OffsetPursuit` del original, que convertía el offset local a mundo con la
## posición Y el heading del líder (`MovementComp::getWorldOffset`)—.
func decide(
	state: BotState,
	order: SquadOrder,
	leader_position: Vector3,
	leader_forward: Vector3
) -> CompanionDirective:
	var out := CompanionDirective.new()
	out.bot_id = bot_id
	out.weights = SquadWeightTable.for_companion()
	out.formation_slot = CompanionFormation.world_slot(leader_position, leader_forward, slot)
	out.move_target = out.formation_slot

	if state == null:
		out.allowed = _allowed_survival(false)
		out.weights = SquadWeightTable.for_companion_survival()
		out.obeys = false
		out.move_target = Vector3.INF
		return out

	var effective := morale()
	var active_order := order if order != null else SquadOrder.none()
	# "Bajo fuego" se deduce del estado, no de un parámetro extra: hay
	# amenazas conocidas Y línea de visión despejada hacia el objetivo, que es
	# lo mismo que decir que ellos te ven a ti.
	var under_fire := state.has_line_of_sight and state.known_threat_count > 0

	out.morale = effective
	out.critical = SquadMorale.is_critical(state.health_ratio)
	out.obedience = SquadMorale.obedience(effective)
	out.survival_pressure = (
		SquadMorale.survival_pressure(state.health_ratio, state.exposure, under_fire)
		+ active_order.risk()
	)
	out.obeys = out.obedience >= out.survival_pressure

	if not out.obeys:
		# LA MORAL MODULA LA OBEDIENCIA. Aquí es donde se ve: la orden se cae,
		# la tabla de pesos pasa a la de supervivencia (cubrirse domina sobre
		# disparar) y desaparece todo verbo que implique moverse a
		# descubierto. No es que el compañero deje de servir: es que ha
		# decidido que seguir vivo vale más que este trozo de suelo.
		out.order_kind = SquadOrder.Kind.NONE
		out.weights = SquadWeightTable.for_companion_survival()
		out.allowed = _allowed_survival(out.critical)
		out.move_target = Vector3.INF
		return out

	out.order_kind = active_order.kind
	match active_order.kind:
		SquadOrder.Kind.MOVE_TO:
			out.move_target = active_order.position
			out.allowed = _allowed_move_to(out.critical)
		SquadOrder.Kind.FOCUS_TARGET:
			out.focus_target_id = active_order.target_id
			out.focus_position = active_order.position
			out.allowed = _allowed_focus(out.critical)
		SquadOrder.Kind.HOLD_POSITION:
			if not is_inf(active_order.position.x):
				out.move_target = active_order.position
			out.allowed = _allowed_hold(out.critical)
		_:
			out.allowed = _allowed_free(out.critical)
	return out


# ---------------------------------------------------------------------------
# Listas de permitidos
# ---------------------------------------------------------------------------
# Igual que en `SquadDirector`: lo que no está permitido NO se elige, por muy
# alta que salga su utilidad. Una regla que solo puntúa se incumple justo
# cuando todas las demás utilidades bajan, que es cuando más importa.

## Sin orden: formación, cobertura y fuego de apoyo. Es la tabla de pesos del
## compañero puesta en forma de permisos (GDD §8.5).
func _allowed_free(critical: bool) -> PackedInt32Array:
	var out := PackedInt32Array([
		BehaviorKind.Kind.FOLLOW_LEADER,
		BehaviorKind.Kind.TAKE_COVER,
		BehaviorKind.Kind.SUPPRESS,
		BehaviorKind.Kind.ATTACK,
		BehaviorKind.Kind.RELOAD,
		BehaviorKind.Kind.REGROUP,
	])
	return _with_retreat(out, critical)


## "Ir ahí". `INVESTIGATE` es el verbo de `BehaviorKind` que significa
## "moverse a un punto concreto"; no hay uno específico para una orden de
## movimiento.
## TODO(arquitecto): valorar un `BehaviorKind.Kind.MOVE_TO_ORDER`. Reutilizar
## INVESTIGATE funciona, pero mezcla "voy porque me lo han mandado" con "voy
## porque he oído algo", y esos dos no deberían compartir tiempo mínimo de
## compromiso (`BehaviorKind.MIN_COMMITMENT_S`).
func _allowed_move_to(critical: bool) -> PackedInt32Array:
	var out := PackedInt32Array([
		BehaviorKind.Kind.INVESTIGATE,
		BehaviorKind.Kind.ATTACK,
		BehaviorKind.Kind.TAKE_COVER,
		BehaviorKind.Kind.RELOAD,
	])
	return _with_retreat(out, critical)


## "Enfocar eso": sigue en formación, pero el fuego va donde le dicen.
func _allowed_focus(critical: bool) -> PackedInt32Array:
	var out := PackedInt32Array([
		BehaviorKind.Kind.ATTACK,
		BehaviorKind.Kind.SUPPRESS,
		BehaviorKind.Kind.TAKE_COVER,
		BehaviorKind.Kind.FOLLOW_LEADER,
		BehaviorKind.Kind.RELOAD,
	])
	return _with_retreat(out, critical)


## "Mantener posición": no sigue al líder. Es la orden que permite dejar a
## alguien cubriendo una puerta mientras el jugador avanza.
func _allowed_hold(critical: bool) -> PackedInt32Array:
	var out := PackedInt32Array([
		BehaviorKind.Kind.HOLD_POSITION,
		BehaviorKind.Kind.ATTACK,
		BehaviorKind.Kind.SUPPRESS,
		BehaviorKind.Kind.TAKE_COVER,
		BehaviorKind.Kind.RELOAD,
	])
	return _with_retreat(out, critical)


## Ha dejado de obedecer: solo verbos que no le sacan de donde está a salvo.
## Puede seguir disparando desde cobertura —no está en pánico, está
## priorizando—, pero no cruza, no sigue al líder y no mantiene posiciones
## que le van a costar la vida.
func _allowed_survival(critical: bool) -> PackedInt32Array:
	var out := PackedInt32Array([
		BehaviorKind.Kind.TAKE_COVER,
		BehaviorKind.Kind.RELOAD,
		BehaviorKind.Kind.ATTACK,
		BehaviorKind.Kind.REGROUP,
	])
	return _with_retreat(out, critical)


## Un compañero a punto de caer puede retirarse. Un compañero muerto lo está
## para el resto de la campaña (análisis §5.2: no hay resurrección), así que
## perderlo por cumplir una orden es el peor intercambio del juego.
static func _with_retreat(base: PackedInt32Array, critical: bool) -> PackedInt32Array:
	if critical and not base.has(int(BehaviorKind.Kind.RETREAT)):
		base.append(int(BehaviorKind.Kind.RETREAT))
	return base
