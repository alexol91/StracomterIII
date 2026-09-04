class_name UtilityScorer
extends RefCounted
## Selector por utilidad: puntúa 0..1 cada comportamiento a partir del estado
## del bot y de la pizarra (GDD §8.2).
##
## TODO AQUÍ ES FUNCIÓN PURA. `(BotState, UtilityWeights, Blackboard) -> float`,
## sin nodos, sin escena, sin `Time`, sin aleatoriedad. Esa es la razón —la
## única— por la que la decisión de un bot se puede probar en
## `godot --headless` en milisegundos, y por la que una regresión de
## comportamiento se ve como un número distinto en un test y no como "los bots
## están raros" tres semanas después.
##
## Estructura de la puntuación:
##
##     score(kind) = gain(kind) · Σ(wᵢ · vᵢ) / Σwᵢ        si la puerta está abierta
##     score(kind) = 0                                     si está cerrada
##
## con vᵢ ∈ [0,1] y wᵢ ≥ 0. De ahí salen dos propiedades que se prueban:
##   * la puntuación nunca se sale de [0, gain] ⊆ [0,1];
##   * el DESGLOSE SUMA LA PUNTUACIÓN, exactamente. Sin eso, el comportamiento
##     de un bot no se depura: se adivina.
##
## Puertas, y por qué no son pesos altos: "no dispares sin ver al objetivo" y
## "no asaltes sin supresión aliada" son reglas, no preferencias. Un peso alto
## se cuela en cuanto el resto de utilidades bajan; un cero no. El legacy no
## tenía ni lo uno ni lo otro —comprobaba inclusión en un triángulo sin mirar
## si había pared en medio (`Bot.cc`)— y por eso sus bots disparaban a través
## de las paredes.

## La pizarra se preleer como script en vez de usar el autoload por nombre:
## así el parámetro está TIPADO y las pruebas pueden inyectar una pizarra
## propia sin tocar el estado global del proyecto.
const BlackboardScript := preload("res://src/core/blackboard.gd")


## Una consideración con nombre, peso y aportación a la puntuación final.
class Term:
	extends RefCounted

	var name: StringName = &""
	## Peso dentro del comportamiento (≥ 0).
	var weight: float = 0.0
	## Valor de la consideración, 0..1.
	var value: float = 0.0
	## Lo que este término aporta a la puntuación total.
	var contribution: float = 0.0

	func to_text() -> String:
		return "%s w=%.2f v=%.3f → %+.4f" % [name, weight, value, contribution]


## Desglose completo de la puntuación de un comportamiento.
##
## Es la herramienta de depuración del subsistema: "¿por qué este veterano se
## ha quedado a cubierto en vez de asaltar?" tiene respuesta numérica, término
## a término, en lugar de una tarde de `print`.
class Breakdown:
	extends RefCounted

	var kind: BehaviorKind.Kind = BehaviorKind.Kind.IDLE
	var gain: float = 0.0
	var terms: Array[Term] = []
	## ¿Está el comportamiento permitido por sus condiciones duras?
	var gate_open: bool = true
	## Por qué no, si no lo está.
	var gate_reason: String = ""
	## Puntuación final. Igual a la suma de aportaciones si la puerta está
	## abierta; 0 si está cerrada.
	var total: float = 0.0

	## Suma de las aportaciones de los términos, sin la puerta. Es lo que
	## permite comprobar la invariante "el desglose suma la puntuación".
	func sum_of_contributions() -> float:
		var total_sum := 0.0
		for term: Term in terms:
			total_sum += term.contribution
		return total_sum

	func to_text() -> String:
		var lines: Array[String] = []
		var header := "%s = %.4f (gain %.2f)" % [BehaviorKind.name_of(kind), total, gain]
		if not gate_open:
			header += "  [CERRADO: %s]" % gate_reason
		lines.append(header)
		for term: Term in terms:
			lines.append("    " + term.to_text())
		return "\n".join(lines)


## Valores intermedios de las consideraciones, calculados UNA vez por
## evaluación y compartidos por todos los comportamientos.
##
## Existe por dos motivos: no repetir trece veces la misma división, y dejar
## en un solo sitio la respuesta a "¿de dónde sale este número?".
class Facts:
	extends RefCounted

	var contact: float = 0.0
	var line_of_sight: float = 0.0
	var blocked: float = 0.0
	var ammo: float = 0.0
	var ammo_need: float = 0.0
	var dry: float = 0.0
	var range_far: float = 0.0
	var range_near: float = 0.0
	var range_optimal: float = 0.0
	var health: float = 0.0
	var hurt: float = 0.0
	var critical: float = 0.0
	var exposure: float = 0.0
	var safety: float = 0.0
	var incoming: float = 0.0
	var suppression: float = 0.0
	var squad_broken: float = 0.0
	var outnumbered: float = 0.0
	var calm: float = 0.0
	var stale: float = 0.0
	var lull: float = 0.0

	## Rol efectivo del bot. Sale de la pizarra cuando hay pizarra, porque el
	## rol es del GRUPO, no del bot: `BotState.role` es una copia que puede
	## haberse quedado atrás.
	var role: Blackboard.Role = Blackboard.Role.NONE
	## Munición y confianza en crudo, para las puertas.
	var raw_ammo_ratio: float = 0.0
	var raw_confidence: float = 0.0
	var raw_health_ratio: float = 0.0
	var raw_squad_strength: float = 1.0
	var raw_in_cover: bool = false
	var raw_exposure: float = 1.0
	var raw_has_los: bool = false
	var raw_is_reloading: bool = false
	var raw_has_suppression: bool = false


# ---------------------------------------------------------------------------
# API pública
# ---------------------------------------------------------------------------

## Puntuación de un comportamiento. Función pura.
static func score(
	kind: BehaviorKind.Kind,
	state: BotState,
	weights: UtilityWeights,
	board: BlackboardScript = null
) -> float:
	return breakdown(kind, state, weights, board).total


## Puntuación de un comportamiento CON su desglose. Misma cuenta que `score`:
## `score` delega aquí a propósito, para que sea imposible que el número que
## se depura y el que se usa se separen.
static func breakdown(
	kind: BehaviorKind.Kind,
	state: BotState,
	weights: UtilityWeights,
	board: BlackboardScript = null
) -> Breakdown:
	return _breakdown_with_facts(kind, weights, _collect_facts(state, board))


## Puntuación de TODOS los comportamientos del catálogo. El diccionario
## incluye los que puntúan 0: la consola necesita poder enseñar por qué un
## comportamiento no se eligió, y "no aparece" no es una explicación.
static func score_all(
	state: BotState,
	weights: UtilityWeights,
	board: BlackboardScript = null
) -> Dictionary[BehaviorKind.Kind, float]:
	var facts := _collect_facts(state, board)
	var out: Dictionary[BehaviorKind.Kind, float] = {}
	for kind: BehaviorKind.Kind in BehaviorKind.Kind.values():
		out[kind] = _breakdown_with_facts(kind, weights, facts).total
	return out


## Desglose de todos los comportamientos, ordenado de mayor a menor
## puntuación. Es lo que imprime `ai.debug` en la consola.
static func breakdown_all(
	state: BotState,
	weights: UtilityWeights,
	board: BlackboardScript = null
) -> Array[Breakdown]:
	var facts := _collect_facts(state, board)
	var out: Array[Breakdown] = []
	for kind: BehaviorKind.Kind in BehaviorKind.Kind.values():
		out.append(_breakdown_with_facts(kind, weights, facts))
	out.sort_custom(func(a: Breakdown, b: Breakdown) -> bool: return a.total > b.total)
	return out


## Comportamiento de mayor utilidad, respetando el veto de la escuadra.
##
## SIN HISTÉRESIS: esto es la elección instantánea. Quien decide si de verdad
## se cambia de comportamiento es `BehaviorController`, que aplica el margen de
## conmutación y el tiempo mínimo de compromiso. Separarlo permite probar las
## dos cosas por separado — la puntuación como función pura, la estabilidad
## como propiedad temporal.
##
## Determinista ante empates: gana el de menor orden en el enumerado. Un
## desempate al azar produciría bots que oscilan sin que ningún número cambie,
## que es exactamente lo que este subsistema existe para evitar.
static func select(
	state: BotState,
	weights: UtilityWeights,
	board: BlackboardScript = null,
	filter: BehaviorFilter = null
) -> BehaviorKind.Kind:
	var facts := _collect_facts(state, board)
	var best := BehaviorKind.Kind.IDLE
	var best_score := 0.0
	for kind: BehaviorKind.Kind in BehaviorKind.Kind.values():
		if filter != null and not filter.is_allowed(kind):
			continue
		var value := _breakdown_with_facts(kind, weights, facts).total
		if value > best_score:
			best_score = value
			best = kind
	return best


# ---------------------------------------------------------------------------
# Consideraciones
# ---------------------------------------------------------------------------

## Traduce el estado del bot a consideraciones normalizadas 0..1.
##
## La pizarra manda sobre la instantánea en lo que es del GRUPO —el rol y la
## supresión activa—, porque el `BotState` sólo lleva una copia que el cerebro
## refresca de tanto en tanto. Sin pizarra se usa la copia: es la única
## información disponible y el llamante ha elegido explícitamente no pasar
## ninguna.
static func _collect_facts(state: BotState, board: BlackboardScript) -> Facts:
	var f := Facts.new()
	if state == null:
		return f

	f.raw_health_ratio = clampf(state.health_ratio, 0.0, 1.0)
	f.raw_ammo_ratio = clampf(state.ammo_ratio, 0.0, 1.0)
	f.raw_confidence = clampf(state.target_confidence, 0.0, 1.0)
	f.raw_squad_strength = clampf(state.squad_strength, 0.0, 1.0)
	f.raw_in_cover = state.in_cover
	f.raw_exposure = clampf(state.exposure, 0.0, 1.0)
	f.raw_has_los = state.has_line_of_sight
	f.raw_is_reloading = state.is_reloading

	f.role = state.role
	f.raw_has_suppression = state.squad_has_suppression
	if board != null:
		f.role = board.role_of(state.bot_id)
		f.raw_has_suppression = board.has_active_suppression(state.squad_id)

	f.contact = f.raw_confidence
	f.calm = 1.0 - f.raw_confidence
	f.line_of_sight = 1.0 if f.raw_has_los else 0.0
	f.blocked = 1.0 - f.line_of_sight
	f.incoming = f.line_of_sight
	f.lull = f.blocked

	f.ammo = f.raw_ammo_ratio
	f.ammo_need = 1.0 - f.raw_ammo_ratio
	f.dry = 1.0 - clampf(f.raw_ammo_ratio / BehaviorTuning.LOW_AMMO_RATIO, 0.0, 1.0)

	f.health = f.raw_health_ratio
	f.hurt = 1.0 - f.raw_health_ratio
	var critical_span := BehaviorTuning.CRITICAL_HEALTH_RATIO * BehaviorTuning.CRITICAL_HEALTH_FALLOFF
	if critical_span <= 0.0:
		f.critical = 1.0 if f.raw_health_ratio < BehaviorTuning.CRITICAL_HEALTH_RATIO else 0.0
	else:
		f.critical = clampf(
			(BehaviorTuning.CRITICAL_HEALTH_RATIO - f.raw_health_ratio) / critical_span, 0.0, 1.0)

	f.exposure = f.raw_exposure
	# Estar EN un punto de cobertura manda sobre la exposición estimada: la
	# exposición la calcula la nube de cobertura frente a las amenazas
	# conocidas, y las que no se conocen no cuentan.
	f.safety = 1.0 if f.raw_in_cover else 1.0 - f.raw_exposure

	f.suppression = 1.0 if f.raw_has_suppression else 0.0
	f.squad_broken = 1.0 - clampf(
		f.raw_squad_strength / maxf(BehaviorTuning.SQUAD_BREAK_RATIO, 0.0001), 0.0, 1.0)
	f.outnumbered = clampf(
		float(state.known_threat_count) / BehaviorTuning.OUTNUMBERED_REFERENCE, 0.0, 1.0)

	var distance := state.distance_to_target_m
	if is_inf(distance) or is_nan(distance):
		# Sin contacto no hay distancia: se trata como "muy lejos", que es lo
		# que hace que ninguna consideración de alcance sostenga un ataque.
		f.range_far = 1.0
		f.range_near = 0.0
		f.range_optimal = 0.0
	else:
		var normalized := clampf(distance / BehaviorTuning.ENGAGE_REFERENCE_M, 0.0, 1.0)
		f.range_far = normalized
		f.range_near = 1.0 - normalized
		var delta := distance - BehaviorTuning.OPTIMAL_ENGAGE_M
		var sigma := maxf(BehaviorTuning.OPTIMAL_ENGAGE_SIGMA_M, 0.0001)
		f.range_optimal = exp(-(delta * delta) / (2.0 * sigma * sigma))

	var age := state.time_since_last_seen_s
	if is_inf(age) or is_nan(age):
		f.stale = 1.0
	else:
		f.stale = clampf(age / maxf(BehaviorTuning.MEMORY_HORIZON_S, 0.0001), 0.0, 1.0)

	return f


static func _breakdown_with_facts(
	kind: BehaviorKind.Kind,
	weights: UtilityWeights,
	facts: Facts
) -> Breakdown:
	var out := Breakdown.new()
	out.kind = kind
	if weights == null:
		out.gate_open = false
		out.gate_reason = "sin tabla de pesos"
		return out

	out.gain = weights.gain(kind)
	var reason := _gate_reason(kind, weights, facts)
	out.gate_open = reason.is_empty()
	out.gate_reason = reason

	var sum_of_weights := weights.weight_sum(kind)
	if sum_of_weights <= 0.0:
		if out.gate_open:
			out.gate_open = false
			out.gate_reason = "el arquetipo no declara consideraciones"
		return out

	var accumulated := 0.0
	for term_name: StringName in weights.terms_of(kind):
		var term := Term.new()
		term.name = term_name
		term.weight = weights.weight(kind, term_name)
		term.value = clampf(_term_value(term_name, kind, facts), 0.0, 1.0)
		term.contribution = out.gain * term.weight * term.value / sum_of_weights
		accumulated += term.contribution
		out.terms.append(term)

	out.total = accumulated if out.gate_open else 0.0
	return out


## Valor 0..1 de una consideración. El `kind` sólo entra para el término
## `role`: un rol de flanqueador apoya FLANK y no apoya SUPPRESS.
static func _term_value(term: StringName, kind: BehaviorKind.Kind, f: Facts) -> float:
	match term:
		BehaviorTuning.TERM_CONTACT:
			return f.contact
		BehaviorTuning.TERM_LINE_OF_SIGHT:
			return f.line_of_sight
		BehaviorTuning.TERM_BLOCKED:
			return f.blocked
		BehaviorTuning.TERM_AMMO:
			return f.ammo
		BehaviorTuning.TERM_AMMO_NEED:
			return f.ammo_need
		BehaviorTuning.TERM_DRY:
			return f.dry
		BehaviorTuning.TERM_RANGE_FAR:
			return f.range_far
		BehaviorTuning.TERM_RANGE_NEAR:
			return f.range_near
		BehaviorTuning.TERM_RANGE_OPTIMAL:
			return f.range_optimal
		BehaviorTuning.TERM_HEALTH:
			return f.health
		BehaviorTuning.TERM_HURT:
			return f.hurt
		BehaviorTuning.TERM_CRITICAL:
			return f.critical
		BehaviorTuning.TERM_EXPOSURE:
			return f.exposure
		BehaviorTuning.TERM_SAFETY:
			return f.safety
		BehaviorTuning.TERM_INCOMING:
			return f.incoming
		BehaviorTuning.TERM_SUPPRESSION:
			return f.suppression
		BehaviorTuning.TERM_SQUAD_BROKEN:
			return f.squad_broken
		BehaviorTuning.TERM_OUTNUMBERED:
			return f.outnumbered
		BehaviorTuning.TERM_CALM:
			return f.calm
		BehaviorTuning.TERM_STALE:
			return f.stale
		BehaviorTuning.TERM_LULL:
			return f.lull
		BehaviorTuning.TERM_IDLE:
			return 1.0
		BehaviorTuning.TERM_ROLE:
			return _role_value(kind, f.role)
	return 0.0


## Cuánto apoya el rol asignado por la escuadra a un comportamiento.
##
## Sin rol asignado el término vale un valor NEUTRO, no 0: un bot al que la
## escuadra no ha dado instrucciones no tiene prohibido flanquear, simplemente
## no tiene una razón extra para hacerlo.
static func _role_value(kind: BehaviorKind.Kind, role: Blackboard.Role) -> float:
	if role == Blackboard.Role.NONE:
		return BehaviorTuning.ROLE_NEUTRAL
	match kind:
		BehaviorKind.Kind.SUPPRESS:
			return 1.0 if role == Blackboard.Role.PINNER else 0.0
		BehaviorKind.Kind.FLANK:
			return 1.0 if role == Blackboard.Role.FLANKER else 0.0
		BehaviorKind.Kind.ASSAULT:
			return 1.0 if role == Blackboard.Role.ASSAULTER else 0.0
		BehaviorKind.Kind.TAKE_COVER, BehaviorKind.Kind.HOLD_POSITION, \
		BehaviorKind.Kind.REGROUP:
			return 1.0 if role == Blackboard.Role.RESERVE else 0.0
	return BehaviorTuning.ROLE_NEUTRAL


# ---------------------------------------------------------------------------
# Puertas duras
# ---------------------------------------------------------------------------

## Motivo por el que un comportamiento es IMPOSIBLE ahora mismo, o cadena
## vacía si es posible.
##
## Devolver el motivo y no un booleano es deliberado: "ASSAULT = 0" no explica
## nada, "sin supresión aliada activa" sí, y es lo que aparece en la consola.
static func _gate_reason(
	kind: BehaviorKind.Kind,
	weights: UtilityWeights,
	f: Facts
) -> String:
	if not weights.enabled(kind):
		return "deshabilitado para el arquetipo '%s'" % weights.archetype

	match kind:
		BehaviorKind.Kind.ATTACK:
			if not f.raw_has_los:
				return "sin línea de visión: no se dispara a lo que no se ve"
			if f.raw_confidence <= 0.0:
				return "sin contacto"
			if f.raw_ammo_ratio <= 0.0:
				return "sin munición"
			if f.raw_is_reloading:
				return "recargando"
		BehaviorKind.Kind.SUPPRESS:
			if not f.raw_has_los:
				return "sin línea de visión: no se suprime a lo que no se ve"
			if f.raw_confidence <= 0.0:
				return "sin contacto"
			if f.raw_ammo_ratio < BehaviorTuning.SUPPRESS_MIN_AMMO_RATIO:
				return "munición insuficiente para fuego sostenido"
			if f.raw_is_reloading:
				return "recargando"
		BehaviorKind.Kind.FLANK:
			if f.raw_confidence < BehaviorTuning.FLANK_MIN_CONFIDENCE:
				return "confianza insuficiente para rodear"
			if f.raw_ammo_ratio <= 0.0:
				return "sin munición"
		BehaviorKind.Kind.ASSAULT:
			# Regla de escuadra del GDD §8.4. Es una puerta y no un peso a
			# propósito: nadie asalta sin supresión activa de un compañero.
			if not f.raw_has_suppression:
				return "sin supresión aliada activa"
			if f.raw_confidence < BehaviorTuning.ASSAULT_MIN_CONFIDENCE:
				return "confianza insuficiente para avanzar"
			if f.raw_ammo_ratio <= 0.0:
				return "sin munición"
		BehaviorKind.Kind.TAKE_COVER:
			if f.raw_in_cover and f.raw_exposure <= BehaviorTuning.COVER_SATISFIED_EXPOSURE:
				return "ya está a cubierto"
		BehaviorKind.Kind.RELOAD:
			if f.raw_ammo_ratio >= BehaviorTuning.RELOAD_SATISFIED_RATIO:
				return "cargador lleno"
		BehaviorKind.Kind.RETREAT:
			if f.raw_confidence <= 0.0 and f.raw_squad_strength >= 1.0:
				return "no hay de qué retirarse"
		BehaviorKind.Kind.REGROUP:
			if f.raw_squad_strength >= 1.0:
				return "la escuadra está entera"
		BehaviorKind.Kind.INVESTIGATE:
			if f.raw_confidence <= 0.0:
				return "no hay nada que investigar"
			if f.raw_has_los:
				return "el objetivo está a la vista: no hay nada que buscar"
	return ""
