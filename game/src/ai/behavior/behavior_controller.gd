class_name BehaviorController
extends AIScheduler.Client
## El cerebro de un bot: utilidad para decidir, árbol para ejecutar.
##
## NADA EN `_process` (ADR-002). Esto es un `AIScheduler.Client`: el
## planificador decide cuándo piensa este bot. Decisión a 5 Hz con techo de 8
## bots por tick, comportamiento a 20 Hz y sólo el árbol ACTIVO. Un bot lejano
## y fuera de cámara se degrada en frecuencia, nunca en calidad.
##
## ## Histéresis, y no es opcional
##
## Un selector por utilidad puro produce bots que cambian de idea cada tick y
## parecen epilépticos: con dos comportamientos empatados a 0,50 y 0,51, el
## ganador cambia con el ruido de la última cifra decimal, cinco veces por
## segundo. La estabilidad se consigue con DOS mecanismos, y hacen falta los
## dos:
##
##   1. **Margen de conmutación** (`BehaviorKind.SWITCH_MARGIN`): el aspirante
##      debe superar al actual por un margen, no empatarle. Mata la oscilación
##      por ruido numérico.
##   2. **Tiempo mínimo de compromiso** (`BehaviorKind.min_commitment`): un
##      comportamiento recién elegido no se abandona antes de haber tenido
##      ocasión de hacer algo. Mata la oscilación por cambio real de
##      condiciones — flanquear y volverse a la mitad del rodeo no es "adaptarse",
##      es no haber flanqueado.
##
## Con dos excepciones, porque el compromiso no puede convertirse en
## cabezonería:
##   * si el comportamiento activo se vuelve IMPOSIBLE (su puerta se cierra:
##     te quedaste sin munición atacando, perdiste la visión suprimiendo), se
##     abandona ya;
##   * si su árbol FALLA (no hay cobertura a la que ir, no hay ruta de
##     flanqueo libre), se abandona ya y además se veta un rato, para que el
##     selector no vuelva a elegirlo cinco veces por segundo.
##
## Ese segundo caso es lo que convierte "no hay dónde cubrirse" en "pues me
## retiro" sin una sola regla escrita a mano: el fallo del árbol es
## información que vuelve al selector.
##
## Esto NO es una FSM plana. No hay tabla de transiciones ni códigos
## numéricos: el legacy tenía `Patrol → Attack → Pursue → Ensure` con inputs
## 10/20/30/40 (`Enemy.cc:169-205`), y el estado siguiente estaba codificado en
## quien emitía el input. Aquí ningún comportamiento sabe cuál viene después.

const BlackboardScript := preload("res://src/core/blackboard.gd")

## Cambio de comportamiento. `ui/` lo usa para depuración; `ai-escuadra` para
## saber cuándo reasignar roles.
signal behavior_changed(previous: BehaviorKind.Kind, next: BehaviorKind.Kind)

## Instantánea del bot. La rellenan la percepción y el cerebro del bot; este
## controlador la LEE y sólo escribe en ella los dos campos que son suyos:
## `current_behavior` y `time_in_behavior_s`.
var state: BotState = null
## Mundo, coberturas y actuador para el árbol.
var context: BehaviorContext = null
## La tabla de pesos ES el arquetipo.
var weights: UtilityWeights = null
## Veto duro de la escuadra. null = sin restricciones.
var filter: BehaviorFilter = null
## Pizarra compartida. Manda sobre la instantánea en rol y supresión.
var board: BlackboardScript = null
## Arquetipo del que se resolvió la tabla. Vacío = tabla puesta a mano.
var archetype: StringName = &""
## Si el arquetipo tiene fases de jefe, ¿se recalcula la tabla al cambiar de
## fase? Se apaga para fijar una fase concreta en una prueba.
var auto_phase: bool = true

# ---- Telemetría (consola `ai.debug`) ----
var stat_decisions: int = 0
var stat_behavior_ticks: int = 0
var stat_switches: int = 0
var stat_tree_failures: int = 0
var stat_blocked_by_commitment: int = 0
var stat_blocked_by_margin: int = 0

var _active: BehaviorKind.Kind = BehaviorKind.Kind.IDLE
var _active_tree: BehaviorTree.BTNode = null
var _trees: Dictionary[BehaviorKind.Kind, BehaviorTree.BTNode] = {}
## kind -> segundos de veto restantes tras un fallo de su árbol.
var _cooldowns: Dictionary[BehaviorKind.Kind, float] = {}
var _last_scores: Dictionary[BehaviorKind.Kind, float] = {}
var _time_in_behavior_s: float = 0.0
## El árbol activo ha terminado o ha fallado: hay que reelegir en cuanto toque
## decisión, saltándose el tiempo mínimo de compromiso.
var _force_reselect: bool = false
var _registered: bool = false


func _init(
	p_state: BotState = null,
	p_context: BehaviorContext = null,
	p_weights: UtilityWeights = null,
	p_board: BlackboardScript = null
) -> void:
	state = p_state
	context = p_context
	weights = p_weights
	board = p_board
	if context != null:
		if context.state == null:
			context.state = state
		if context.board == null:
			context.board = board
	_active_tree = _tree_for(_active)


## Resuelve la tabla de pesos del arquetipo (y su fase, si es un jefe).
func configure_archetype(p_archetype: StringName) -> void:
	archetype = p_archetype
	var health := state.health_ratio if state != null else 1.0
	weights = UtilityWeights.for_archetype(p_archetype, health)


# ---------------------------------------------------------------------------
# Registro en el planificador (ADR-002)
# ---------------------------------------------------------------------------

## NINGÚN bot debe llamar a `tick_decision` o `tick_behavior` por su cuenta:
## el planificador es quien reparte el presupuesto. Las pruebas sí los llaman
## directamente, y ésa es justamente la ventaja de que el reparto viva fuera.
func register() -> void:
	if _registered:
		return
	AIScheduler.register(self)
	_registered = true


func unregister() -> void:
	if not _registered:
		return
	AIScheduler.unregister(self)
	_registered = false


func is_registered() -> bool:
	return _registered


# ---------------------------------------------------------------------------
# Decisión — 5 Hz
# ---------------------------------------------------------------------------

func tick_decision(delta: float) -> void:
	stat_decisions += 1
	if state == null or weights == null:
		return

	_decay_cooldowns(delta)
	_refresh_phase()
	_sync_scheduler_position()
	if context != null:
		context.state = state
		if context.board == null:
			context.board = board
		context.refresh_from_board()

	_last_scores = UtilityScorer.score_all(state, weights, board)

	var candidate := _best_candidate()
	var active_score := _score_of(_active)
	var candidate_score := _score_of(candidate)

	if candidate == _active:
		_force_reselect = false
		return

	# Abandono inmediato: el comportamiento activo es imposible, ha fallado o
	# la escuadra acaba de vetarlo. El compromiso no cubre lo imposible.
	if _force_reselect or active_score <= 0.0 or not _is_selectable(_active):
		_switch_to(candidate)
		return

	if _time_in_behavior_s < BehaviorKind.min_commitment(_active):
		stat_blocked_by_commitment += 1
		return

	if candidate_score < active_score + BehaviorKind.SWITCH_MARGIN:
		stat_blocked_by_margin += 1
		return

	_switch_to(candidate)


# ---------------------------------------------------------------------------
# Ejecución — 20 Hz, sólo el árbol activo
# ---------------------------------------------------------------------------

func tick_behavior(delta: float) -> void:
	stat_behavior_ticks += 1
	_time_in_behavior_s += delta
	if state != null:
		state.current_behavior = int(_active)
		state.time_in_behavior_s = _time_in_behavior_s

	if _active_tree == null or context == null:
		return

	# Con la reelección pendiente no se vuelve a ejecutar un árbol que ya ha
	# dicho que no puede seguir: se deja el cuerpo quieto y se espera al tick
	# de decisión. Reelegir aquí mismo saltaría el techo de 8 decisiones por
	# tick de ADR-002 justo cuando más bots están fallando a la vez.
	if _force_reselect:
		BehaviorActions.stop_moving(context)
		return

	var status := _active_tree.tick(context, delta)
	if status == BehaviorTree.Status.FAILURE:
		stat_tree_failures += 1
		_cooldowns[_active] = BehaviorTuning.FAILURE_COOLDOWN_S
		_force_reselect = true
		_active_tree.reset()
	elif status == BehaviorTree.Status.SUCCESS:
		# Terminado y bien: se permite reelegir sin esperar al compromiso,
		# pero SIN veto. Un comportamiento que cumple su cometido puede
		# repetirse (una ráfaga de supresión tras otra).
		_force_reselect = true
		_active_tree.reset()


## Este controlador no percibe: la percepción es de `ai-percepcion` y tiene su
## propio cliente. Devuelve 0 rayos consumidos para no gastar presupuesto.
func tick_perception(_delta: float) -> int:
	return 0


# ---------------------------------------------------------------------------
# Estado consultable
# ---------------------------------------------------------------------------

func active_behavior() -> BehaviorKind.Kind:
	return _active


func active_tree() -> BehaviorTree.BTNode:
	return _active_tree


func time_in_behavior() -> float:
	return _time_in_behavior_s


func last_scores() -> Dictionary[BehaviorKind.Kind, float]:
	return _last_scores


## Segundos de veto restantes de un comportamiento tras un fallo de su árbol.
func cooldown_of(kind: BehaviorKind.Kind) -> float:
	return _cooldowns.get(kind, 0.0)


## Fuerza un comportamiento. Sólo para la consola de depuración y para montar
## escenarios de prueba: saltarse el selector en juego es exactamente lo que
## esta arquitectura evita.
func force_behavior(kind: BehaviorKind.Kind) -> void:
	_switch_to(kind)


## Desglose completo, ordenado, con el estado de la histéresis. Es lo que
## imprime la consola: sin esto, "¿por qué hace eso?" no tiene respuesta.
func explain() -> String:
	var lines: Array[String] = []
	lines.append("bot %d (%s, fase %d) → %s desde hace %.2f s" % [
		state.bot_id if state != null else -1,
		weights.archetype if weights != null else "sin tabla",
		weights.phase if weights != null else 0,
		BehaviorKind.name_of(_active),
		_time_in_behavior_s,
	])
	lines.append("  compromiso mínimo %.2f s · margen de conmutación %.2f" % [
		BehaviorKind.min_commitment(_active), BehaviorKind.SWITCH_MARGIN])
	if filter != null:
		lines.append("  filtro de escuadra: %s" % filter.to_text())
	if state == null or weights == null:
		return "\n".join(lines)
	for entry: UtilityScorer.Breakdown in UtilityScorer.breakdown_all(state, weights, board):
		var suffix := ""
		var cooldown := cooldown_of(entry.kind)
		if cooldown > 0.0:
			suffix += "  [veto %.1f s tras fallo del árbol]" % cooldown
		if filter != null and not filter.is_allowed(entry.kind):
			suffix += "  [%s]" % filter.reason_for(entry.kind)
		lines.append(entry.to_text() + suffix)
	if _active_tree != null:
		lines.append("árbol activo:")
		lines.append(_active_tree.to_text(1))
	return "\n".join(lines)


# ---------------------------------------------------------------------------
# Interno
# ---------------------------------------------------------------------------

## Mejor comportamiento seleccionable AHORA. Determinista ante empates: gana
## el de menor orden en el enumerado. Desempatar al azar produciría bots que
## oscilan sin que ningún número cambie.
func _best_candidate() -> BehaviorKind.Kind:
	var best := BehaviorKind.Kind.IDLE
	var best_score := 0.0
	for kind: BehaviorKind.Kind in BehaviorKind.Kind.values():
		if not _is_selectable(kind):
			continue
		var value := _score_of(kind)
		if value > best_score:
			best_score = value
			best = kind
	return best


## Un comportamiento es seleccionable si la escuadra lo permite y no está
## vetado por un fallo reciente de su árbol.
func _is_selectable(kind: BehaviorKind.Kind) -> bool:
	if filter != null and not filter.is_allowed(kind):
		return false
	if cooldown_of(kind) > 0.0:
		return false
	return true


func _score_of(kind: BehaviorKind.Kind) -> float:
	return _last_scores.get(kind, 0.0)


func _switch_to(next: BehaviorKind.Kind) -> void:
	var previous := _active
	if _active_tree != null and context != null:
		# Aborto limpio: cada acción suelta lo que tuviera reservado (una ruta
		# de flanqueo reclamada en la pizarra, una orden de movimiento).
		_active_tree.abort(context)
	if context != null:
		context.reset_scratch()
	_active = next
	_active_tree = _tree_for(next)
	if _active_tree != null:
		_active_tree.reset()
	_time_in_behavior_s = 0.0
	_force_reselect = false
	if state != null:
		state.current_behavior = int(next)
		state.time_in_behavior_s = 0.0
	if previous != next:
		stat_switches += 1
		behavior_changed.emit(previous, next)


## Los árboles se construyen bajo demanda y se guardan: reconstruirlos por
## cambio de comportamiento sería crear objetos cinco veces por segundo y por
## bot.
func _tree_for(kind: BehaviorKind.Kind) -> BehaviorTree.BTNode:
	if not _trees.has(kind):
		_trees[kind] = BehaviorLibrary.build(kind)
	return _trees[kind]


func _decay_cooldowns(delta: float) -> void:
	for kind: BehaviorKind.Kind in _cooldowns.keys():
		var remaining: float = _cooldowns[kind] - delta
		if remaining <= 0.0:
			_cooldowns.erase(kind)
		else:
			_cooldowns[kind] = remaining


## Un jefe no es un arquetipo con más vida: cambia de tabla al bajar de
## umbral. La fase se recalcula en el tick de decisión, no por frame.
func _refresh_phase() -> void:
	if not auto_phase or archetype == &"" or weights == null:
		return
	var phase := BehaviorTuning.boss_phase(archetype, state.health_ratio)
	if phase != weights.phase:
		weights = UtilityWeights.for_archetype(archetype, state.health_ratio)


## Mantiene al día lo que el planificador usa para priorizar. Sin esto, un bot
## que se aleja seguiría contando como cercano y se llevaría presupuesto que
## no le corresponde.
func _sync_scheduler_position() -> void:
	if state != null:
		world_position = state.position
