class_name SquadBrainPort
extends RefCounted
## Puerto hacia el cerebro de `ai/behavior` (selector por utilidad).
##
## AVISO DE COORDINACIÓN (2026-09-04): cuando se escribió este fichero,
## `game/src/ai/behavior/` estaba VACÍO. `ai-comportamiento` está
## construyéndolo ahora mismo. Aquí NO se implementa un selector por
## utilidad: se declara la forma en la que `ai/squad` espera hablar con él, y
## se enlaza por inyección en cuanto exista. Cuando `ai-comportamiento`
## publique sus `class_name`, esta clase se adapta a SU firma —la suya manda—
## y todo lo demás de este módulo queda intacto: nadie más en `ai/squad/`
## llama al cerebro.
##
## Qué espera este puerto del cerebro, en una sola llamada:
##
##     select(state: BotState, weights: SquadWeightTable,
##            allowed: PackedInt32Array, world: WorldQuery) -> int
##
## donde `allowed` es la lista de `BehaviorKind.Kind` que las reglas de grupo
## permiten, y el valor devuelto es un `BehaviorKind.Kind` (o -1).
##
## POR QUÉ UNA LISTA DE PERMITIDOS Y NO UN PESO BAJO. Las reglas del GDD §8.4
## se hacen cumplir, no se sugieren. Si "nadie asalta sin supresión" se
## implementa bajando la utilidad de ASSAULT, basta con que todas las demás
## utilidades bajen —munición a cero, sin cobertura cerca, sin ruta— para que
## ASSAULT vuelva a ganar y el bot cruce el vano solo. Una regla que solo
## puntúa es una regla que se incumple cuando más importa. La lista de
## permitidos no admite esa lectura.

## Implementación real, inyectada por quien monta el bot. `null` = sin enlazar.
var brain: Object = null
## Cuántas veces el cerebro ha elegido algo que la escuadra no permitía.
## Telemetría, consultable desde la consola: si esto no es cero en una
## partida, hay una regla de grupo incumpliéndose de verdad, no en teoría.
var stat_rejected_choices: int = 0
## Poner a false para NO llenar la salida de errores en las pruebas que
## ejercitan la infracción a propósito. En ejecución normal se deja en true:
## una regla de grupo que se incumple en silencio no se arregla nunca.
var report_violations: bool = true

## Nombre del método que se le pide al cerebro.
const SELECT_METHOD: StringName = &"select"

## Orden de preferencia del modo degradado. Contiene SOLO verbos que no
## comprometen a nadie: nada de ATTACK, SUPPRESS, FLANK ni ASSAULT. Sin
## cerebro enlazado el bot se cubre y espera; no ataca ni cruza.
##
## Es la aplicación literal de la regla que ya costó un fallo en este
## proyecto: el valor por defecto de una consulta de la que depende una
## decisión de justicia nunca puede ser el permisivo.
const SAFE_PRIORITY: Array[BehaviorKind.Kind] = [
	BehaviorKind.Kind.RETREAT,
	BehaviorKind.Kind.REGROUP,
	BehaviorKind.Kind.TAKE_COVER,
	BehaviorKind.Kind.RELOAD,
	BehaviorKind.Kind.HOLD_POSITION,
	BehaviorKind.Kind.FOLLOW_LEADER,
	BehaviorKind.Kind.INVESTIGATE,
	BehaviorKind.Kind.PATROL,
	BehaviorKind.Kind.IDLE,
]


## ¿Hay un cerebro real detrás? Quien monte la escena debe comprobarlo al
## arrancar: descubrir por comportamiento raro que la IA no está enlazada es
## caro. `WorldQueryComposite.is_complete()` existe por lo mismo.
func is_bound() -> bool:
	return brain != null and brain.has_method(SELECT_METHOD)


func bind(implementation: Object) -> bool:
	if implementation != null and not implementation.has_method(SELECT_METHOD):
		push_error("SquadBrainPort: la implementación no expone '%s'." % SELECT_METHOD)
		return false
	brain = implementation
	return true


## Elige un comportamiento DENTRO de `allowed`. Devuelve un `BehaviorKind.Kind`
## o -1 si `allowed` está vacío.
##
## Se verifica que lo devuelto por el cerebro esté en `allowed`. No es
## desconfianza gratuita: es la única forma de que la regla de grupo siga
## siendo una invariante cuando el cerebro lo escribe otro módulo, y de que un
## incumplimiento salga como error en vez de como "un bot raro".
func select(
	state: BotState,
	weights: SquadWeightTable,
	allowed: PackedInt32Array,
	world: WorldQuery = null
) -> int:
	if allowed.is_empty():
		return -1
	if not is_bound():
		return safe_fallback(allowed)
	var chosen: int = brain.call(SELECT_METHOD, state, weights, allowed, world)
	if not allowed.has(chosen):
		stat_rejected_choices += 1
		if report_violations:
			push_error(
				"SquadBrainPort: el cerebro eligió %d, que no está permitido para el bot %d."
				% [chosen, state.bot_id if state != null else 0]
			)
		return safe_fallback(allowed)
	return chosen


## Modo degradado: el primer verbo seguro que esté permitido. Si ninguno lo
## está, -1 — antes nada que algo temerario.
func safe_fallback(allowed: PackedInt32Array) -> int:
	for kind: BehaviorKind.Kind in SAFE_PRIORITY:
		if allowed.has(int(kind)):
			return int(kind)
	return -1
