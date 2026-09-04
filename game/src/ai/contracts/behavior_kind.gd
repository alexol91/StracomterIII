class_name BehaviorKind
## Catálogo de comportamientos. Enumerado compartido entre el selector por
## utilidad, los árboles de comportamiento y el director de escuadra.
##
## Sustituye a la FSM plana de 5 estados del legacy
## (Patrol → Attack → Pursue → Ensure, legacy/trunk/core/entities/lib/Enemy.cc:169)
## con transiciones por códigos numéricos 10/20/30/40.

enum Kind {
	IDLE,
	PATROL,       ## Recorre la zona sin contacto.
	INVESTIGATE,  ## Va al último punto conocido o al origen de un ruido.
	ATTACK,       ## Dispara al objetivo desde la posición actual.
	TAKE_COVER,   ## Se mueve al mejor punto de cobertura disponible.
	SUPPRESS,     ## Fuego sostenido para fijar al objetivo.
	FLANK,        ## Rodea por una ruta de navmesh disjunta.
	ASSAULT,      ## Avanza sobre el objetivo bajo supresión aliada.
	RELOAD,       ## Recarga, preferentemente a cubierto.
	REGROUP,      ## Vuelve con la escuadra.
	RETREAT,      ## Se retira del combate.
	FOLLOW_LEADER,## Solo compañeros: mantiene la formación.
	HOLD_POSITION,## Solo compañeros: orden del jugador.
}

## Tiempo mínimo de compromiso por comportamiento, en segundos. Es la mitad de
## la histéresis que evita la oscilación; la otra mitad es el margen de
## conmutación de utilidad.
const MIN_COMMITMENT_S: Dictionary[Kind, float] = {
	Kind.IDLE: 0.2,
	Kind.PATROL: 1.5,
	Kind.INVESTIGATE: 2.0,
	Kind.ATTACK: 0.6,
	Kind.TAKE_COVER: 1.2,
	Kind.SUPPRESS: 1.5,
	Kind.FLANK: 2.5,
	Kind.ASSAULT: 1.5,
	Kind.RELOAD: 0.1,
	Kind.REGROUP: 2.0,
	Kind.RETREAT: 2.0,
	Kind.FOLLOW_LEADER: 0.5,
	Kind.HOLD_POSITION: 0.5,
}

## Un comportamiento nuevo debe superar al actual por este margen de utilidad
## para desplazarlo.
const SWITCH_MARGIN: float = 0.12


static func name_of(kind: Kind) -> String:
	return Kind.keys()[int(kind)]


static func min_commitment(kind: Kind) -> float:
	return MIN_COMMITMENT_S.get(kind, 0.5)
