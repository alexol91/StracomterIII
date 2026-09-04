class_name CompanionWeights
## Tablas de utilidad de los compañeros del jugador (GDD §8.5).
##
## NO HAY DOS IA. La tabla base de compañero la publica `ai/behavior`
## (`UtilityWeights.for_companion`, sobre `BehaviorTuning.COMPANION_GAIN`), y
## el selector que la usa es exactamente el mismo `UtilityScorer` que mueve a
## los enemigos. Lo único que hay aquí es lo que la ESCUADRA le hace encima:
## la variante de supervivencia que aparece cuando la moral deja de bastar
## para obedecer.
##
## `UtilityWeights.set_gain` está documentado por `ai-comportamiento` como el
## punto por el que `ai-escuadra` deriva sus tablas "sin duplicar la base".
## Esto es exactamente eso: se parte de la suya y se desplazan ganancias.

## Verbos que mantienen vivo a un compañero que ha dejado de obedecer.
const SURVIVAL_KINDS: Array[BehaviorKind.Kind] = [
	BehaviorKind.Kind.TAKE_COVER,
	BehaviorKind.Kind.RETREAT,
	BehaviorKind.Kind.RELOAD,
]

## Verbos que lo exponen mientras prioriza sobrevivir. No se ponen a cero
## —seguir disparando desde cobertura es legítimo, desobedecer no es entrar
## en pánico—, se rebajan.
const EXPOSING_KINDS: Array[BehaviorKind.Kind] = [
	BehaviorKind.Kind.ATTACK,
	BehaviorKind.Kind.SUPPRESS,
	BehaviorKind.Kind.REGROUP,
]

## Verbos que directamente no existen para quien ha dejado de obedecer: todos
## implican salir a campo abierto porque alguien se lo ha pedido.
const DISOBEYED_KINDS: Array[BehaviorKind.Kind] = [
	BehaviorKind.Kind.FOLLOW_LEADER,
	BehaviorKind.Kind.HOLD_POSITION,
	BehaviorKind.Kind.INVESTIGATE,
	BehaviorKind.Kind.FLANK,
	BehaviorKind.Kind.ASSAULT,
	BehaviorKind.Kind.PATROL,
]


## Tabla normal de compañero: formación, cobertura del jugador y fuego de
## apoyo primero. Es la de `ai/behavior` tal cual; se pasa por aquí para que
## `ai/squad` tenga un único punto donde mirar cuando esa tabla cambie.
static func standard(archetype: StringName = &"companion") -> UtilityWeights:
	return UtilityWeights.for_companion(archetype)


## Tabla del compañero que antepone sobrevivir a obedecer. Es la moral
## haciéndose visible: no basta con que la orden se caiga —si la tabla no
## cambiara, el cerebro seguiría prefiriendo disparar a cubrirse—.
static func survival(archetype: StringName = &"companion") -> UtilityWeights:
	var out := UtilityWeights.for_companion(archetype)
	for kind: BehaviorKind.Kind in SURVIVAL_KINDS:
		out.set_gain(kind, out.gain(kind) * SquadTuning.SURVIVAL_GAIN_BOOST)
	for kind: BehaviorKind.Kind in EXPOSING_KINDS:
		out.set_gain(kind, out.gain(kind) * SquadTuning.SURVIVAL_GAIN_CUT)
	for kind: BehaviorKind.Kind in DISOBEYED_KINDS:
		out.set_gain(kind, 0.0)
	return out
