class_name SquadFakeBrain
extends RefCounted
## Doble del cerebro de `ai/behavior` para las pruebas de `SquadBrainPort`.
##
## No es un selector por utilidad ni pretende serlo: devuelve lo que se le
## diga, incluida una elección PROHIBIDA. Eso es justo lo que hay que poder
## simular, porque el cerebro real lo escribe otro módulo y la única forma de
## que las reglas de grupo sigan siendo invariantes es que el puerto compruebe
## lo que le devuelven en vez de fiarse.
##
## Su firma es la que `SquadBrainPort` declara esperar de `ai-comportamiento`.
## Si esa interfaz cambia, este fichero es el primero que hay que ajustar.

## Comportamiento que devolverá siempre.
var answer: int = int(BehaviorKind.Kind.IDLE)
## Cuántas veces se le ha preguntado.
var stat_calls: int = 0
## Lista de permitidos que recibió en la última llamada.
var last_allowed: PackedInt32Array = PackedInt32Array()
## Tabla de pesos que recibió en la última llamada.
var last_weights: SquadWeightTable = null


func select(
	_state: BotState,
	weights: SquadWeightTable,
	allowed: PackedInt32Array,
	_world: WorldQuery
) -> int:
	stat_calls += 1
	last_allowed = allowed
	last_weights = weights
	return answer
