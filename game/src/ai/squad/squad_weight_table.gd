class_name SquadWeightTable
extends RefCounted
## Tabla de pesos de utilidad, por `BehaviorKind.Kind`.
##
## ESTA ES LA PIEZA QUE HACE QUE AMIGOS Y ENEMIGOS COMPARTAN CEREBRO (GDD
## §8.5). No hay una IA de compañero y otra de enemigo: hay UN selector por
## utilidad (`ai/behavior`, de `ai-comportamiento`) y dos tablas. El
## compañero antepone formación, cobertura del jugador y fuego de apoyo; el
## enemigo antepone presión, flanqueo y asalto. Todo lo demás —percepción,
## coberturas, histéresis, árboles— es exactamente el mismo código, y por eso
## cualquier mejora se nota en los dos bandos a la vez.
##
## NO es un selector: no puntúa situaciones ni elige. Solo dice cuánto vale
## cada verbo para este bando. La elección la hace `ai/behavior` a través de
## `SquadBrainPort`.

## Peso por comportamiento. Lo no listado vale `SquadTuning.WEIGHT_NEUTRAL`.
var weights: Dictionary[int, float] = {}
## Etiqueta de depuración (`enemy`, `companion`, `companion_survival`...).
var label: StringName = &""


func weight_for(kind: BehaviorKind.Kind) -> float:
	return weights.get(int(kind), SquadTuning.WEIGHT_NEUTRAL)


func set_weight(kind: BehaviorKind.Kind, value: float) -> void:
	weights[int(kind)] = value


func duplicate_table() -> SquadWeightTable:
	var out := SquadWeightTable.new()
	out.label = label
	out.weights = weights.duplicate()
	return out


## Tabla de un enemigo de escuadra: presiona, rodea y entra.
static func for_enemy() -> SquadWeightTable:
	var t := SquadWeightTable.new()
	t.label = &"enemy"
	t.set_weight(BehaviorKind.Kind.SUPPRESS, SquadTuning.WEIGHT_PREFERRED)
	t.set_weight(BehaviorKind.Kind.FLANK, SquadTuning.WEIGHT_PREFERRED)
	t.set_weight(BehaviorKind.Kind.ASSAULT, SquadTuning.WEIGHT_PREFERRED)
	t.set_weight(BehaviorKind.Kind.ATTACK, SquadTuning.WEIGHT_NEUTRAL)
	t.set_weight(BehaviorKind.Kind.TAKE_COVER, SquadTuning.WEIGHT_NEUTRAL)
	# Un enemigo no sigue a nadie ni mantiene posición por orden: esos dos
	# verbos son de compañero. Se desaconsejan en vez de prohibirse porque
	# quien prohíbe es el director de escuadra, con la lista de permitidos.
	t.set_weight(BehaviorKind.Kind.FOLLOW_LEADER, SquadTuning.WEIGHT_DISCOURAGED)
	t.set_weight(BehaviorKind.Kind.HOLD_POSITION, SquadTuning.WEIGHT_DISCOURAGED)
	return t


## Tabla de un compañero del jugador: formación, cobertura del jugador y
## fuego de apoyo por delante de todo lo demás (GDD §8.5).
static func for_companion() -> SquadWeightTable:
	var t := SquadWeightTable.new()
	t.label = &"companion"
	t.set_weight(BehaviorKind.Kind.FOLLOW_LEADER, SquadTuning.WEIGHT_PREFERRED)
	t.set_weight(BehaviorKind.Kind.TAKE_COVER, SquadTuning.WEIGHT_PREFERRED)
	t.set_weight(BehaviorKind.Kind.SUPPRESS, SquadTuning.WEIGHT_PREFERRED)
	t.set_weight(BehaviorKind.Kind.ATTACK, SquadTuning.WEIGHT_NEUTRAL)
	t.set_weight(BehaviorKind.Kind.HOLD_POSITION, SquadTuning.WEIGHT_NEUTRAL)
	# Un compañero no se va de flanqueo ni asalta por su cuenta: dejaría solo
	# al jugador, que es justo lo que el original hacía mal.
	t.set_weight(BehaviorKind.Kind.FLANK, SquadTuning.WEIGHT_DISCOURAGED)
	t.set_weight(BehaviorKind.Kind.ASSAULT, SquadTuning.WEIGHT_DISCOURAGED)
	t.set_weight(BehaviorKind.Kind.PATROL, SquadTuning.WEIGHT_DISCOURAGED)
	return t


## Tabla de un compañero que ha dejado de obedecer por moral baja: sobrevivir
## por delante de la orden (GDD §8.5). Es la tabla que hace visible el
## rediseño de la moral — en el original la moral no modulaba NADA salvo la
## regeneración del aura del Capitán (análisis §5.1).
static func for_companion_survival() -> SquadWeightTable:
	var t := SquadWeightTable.new()
	t.label = &"companion_survival"
	t.set_weight(BehaviorKind.Kind.TAKE_COVER, SquadTuning.WEIGHT_DOMINANT)
	t.set_weight(BehaviorKind.Kind.RETREAT, SquadTuning.WEIGHT_PREFERRED)
	t.set_weight(BehaviorKind.Kind.RELOAD, SquadTuning.WEIGHT_PREFERRED)
	t.set_weight(BehaviorKind.Kind.ATTACK, SquadTuning.WEIGHT_DISCOURAGED)
	t.set_weight(BehaviorKind.Kind.SUPPRESS, SquadTuning.WEIGHT_DISCOURAGED)
	t.set_weight(BehaviorKind.Kind.FOLLOW_LEADER, SquadTuning.WEIGHT_DISCOURAGED)
	t.set_weight(BehaviorKind.Kind.HOLD_POSITION, SquadTuning.WEIGHT_DISCOURAGED)
	t.set_weight(BehaviorKind.Kind.INVESTIGATE, SquadTuning.WEIGHT_DISCOURAGED)
	return t
