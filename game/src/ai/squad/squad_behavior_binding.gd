class_name SquadBehaviorBinding
## Enganche entre `ai/squad` y el cerebro de `ai/behavior`.
##
## AQUÍ ES DONDE AMIGOS Y ENEMIGOS SE VUELVEN EL MISMO SISTEMA (GDD §8.5). El
## selector por utilidad, los árboles y el controlador son los mismos para los
## dos bandos; lo único que cambia es lo que entra por estos dos parámetros:
##
##   * `BehaviorFilter` — qué tiene PERMITIDO hacer este bot. Lo decide la
##     escuadra: el `SquadDirector` para un enemigo, el `CompanionController`
##     para un compañero.
##   * `UtilityWeights` — qué prefiere. La tabla de enemigo sale del
##     arquetipo; la de compañero, de `CompanionWeights`.
##
## POR QUÉ UN FILTRO Y NO UNA PREFERENCIA. Las reglas del GDD §8.4 se hacen
## cumplir, no se sugieren. Si "nadie asalta sin supresión" se implementara
## bajando la utilidad de ASSAULT, bastaría con que todas las demás
## utilidades bajaran —sin munición, sin cobertura cerca, sin ruta— para que
## ASSAULT volviera a ganar y el bot cruzara el vano solo. `BehaviorFilter`
## multiplica por cero en vez de restar puntos, y `UtilityScorer.select` ni
## siquiera puntúa lo vetado.
##
## Todo estático: esta clase no guarda estado. Es una traducción entre dos
## formas de decir lo mismo.


## Filtro de lista blanca a partir de la lista de permitidos de la escuadra.
##
## Una lista VACÍA no permite nada, y eso es correcto: `BehaviorFilter`
## documenta que en ese caso el bot se queda quieto, que es visible y
## depurable. Interpretarla como "todo vale" convertiría un error del director
## en un bot que asalta sin supresión, sin error y sin aviso.
static func filter_from(allowed: PackedInt32Array) -> BehaviorFilter:
	var empty: Array[BehaviorKind.Kind] = []
	var out := BehaviorFilter.allow_only(empty)
	for value: int in allowed:
		out.allow(value as BehaviorKind.Kind)
	return out


## Filtro de un bot enemigo, con los motivos del veto puestos. Sin los
## motivos, "el bot no flanquea" no tiene respuesta: podría ser que no haya
## ruta, que la ruta sea parcial, que no sea disjunta o que el grupo esté
## replegándose, y son cuatro problemas distintos.
static func filter_for_bot(assignment: SquadRoleAssignment, bot_id: int) -> BehaviorFilter:
	var out := filter_from(assignment.allowed_of(bot_id))
	if not assignment.allows(bot_id, BehaviorKind.Kind.ASSAULT):
		out.deny(BehaviorKind.Kind.ASSAULT, _reason(assignment.assault_veto_reason, bot_id))
	if not assignment.allows(bot_id, BehaviorKind.Kind.FLANK):
		out.deny(BehaviorKind.Kind.FLANK, _reason(assignment.flank_veto_reason, bot_id))
	return out


## Filtro de un compañero.
static func filter_for_directive(directive: CompanionDirective) -> BehaviorFilter:
	var out := filter_from(directive.allowed)
	if not directive.obeys:
		out.deny(
			BehaviorKind.Kind.INVESTIGATE,
			"moral %d: antepone sobrevivir a obedecer" % directive.morale
		)
	return out


## Aplica filtro y tabla a un `BehaviorController` ya montado. `weights` a
## `null` deja la tabla que tuviera: un enemigo conserva la de su arquetipo.
static func apply(
	controller: BehaviorController, filter: BehaviorFilter, weights: UtilityWeights = null
) -> void:
	if controller == null:
		return
	controller.filter = filter
	if weights != null:
		controller.weights = weights


## Monta de una vez lo que la escuadra decidió para un bot enemigo.
static func apply_assignment(
	assignment: SquadRoleAssignment, bot_id: int, controller: BehaviorController
) -> void:
	apply(controller, filter_for_bot(assignment, bot_id))


## Monta de una vez lo que la escuadra decidió para un compañero, tabla
## incluida: la de supervivencia entra por aquí cuando la moral no basta.
static func apply_directive(
	directive: CompanionDirective, controller: BehaviorController
) -> void:
	apply(controller, filter_for_directive(directive), directive.weights)


static func _reason(veto: StringName, bot_id: int) -> String:
	if veto.is_empty():
		return "el bot %d no tiene ese rol" % bot_id
	return String(veto)
