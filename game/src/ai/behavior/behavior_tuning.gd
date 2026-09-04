class_name BehaviorTuning
extends RefCounted
## Constantes de sintonización de la decisión por utilidad y de los árboles.
##
## ADR-005 dice que ningún número de juego vive en el código. Estos todavía
## viven aquí porque `src/data/` no es de este agente y no existe un recurso
## que los albergue: haría falta un `UtilityProfile` (ganancias y pesos por
## arquetipo) y un `BehaviorProfile` (umbrales y tiempos de los árboles).
## Están centralizados en un único fichero, con nombre, unidad y motivo,
## precisamente para que moverlos a `.tres` sea un solo cambio mecánico.
##
## Todo lo marcado `# TODO(arquitecto): mover a datos` es balanceo. Lo que NO
## lo es: los nombres de término (`TERM_*`) son el vocabulario del desglose de
## puntuación, es decir, contrato de depuración, no un número que se toca para
## que el juego sea más fácil.
##
## LA HISTÉRESIS NO ESTÁ AQUÍ. `BehaviorKind.SWITCH_MARGIN` y
## `BehaviorKind.MIN_COMMITMENT_S` son del contrato compartido
## (`src/ai/contracts/behavior_kind.gd`) porque los lee también la escuadra.
## Duplicarlos aquí sería garantizar que un día divergen.

# ---------------------------------------------------------------------------
# Vocabulario de términos de utilidad
# ---------------------------------------------------------------------------
# Un término = una consideración con nombre. El desglose (`UtilityScorer.
# Breakdown`) los devuelve uno a uno con su peso y su aportación: sin eso el
# comportamiento de un bot no se depura, se adivina.

## Confianza en el contacto de la escuadra (0..1).
const TERM_CONTACT: StringName = &"contact"
## ¿Hay línea de visión AHORA? 1 = sí.
const TERM_LINE_OF_SIGHT: StringName = &"line_of_sight"
## Lo contrario: el objetivo se conoce pero no se ve. Es lo que empuja a
## flanquear e investigar en lugar de disparar a una pared.
const TERM_BLOCKED: StringName = &"blocked"
## Munición disponible (0..1).
const TERM_AMMO: StringName = &"ammo"
## Munición que falta (1 − ammo).
const TERM_AMMO_NEED: StringName = &"ammo_need"
## Sequía: 1 con el cargador a cero, 0 por encima de LOW_AMMO_RATIO.
const TERM_DRY: StringName = &"dry"
## Distancia normalizada: 1 = lejos.
const TERM_RANGE_FAR: StringName = &"range_far"
## 1 = pegado al objetivo.
const TERM_RANGE_NEAR: StringName = &"range_near"
## Campana centrada en la distancia de combate cómoda del arma.
const TERM_RANGE_OPTIMAL: StringName = &"range_optimal"
## Vida restante (0..1).
const TERM_HEALTH: StringName = &"health"
## Vida perdida (1 − health).
const TERM_HURT: StringName = &"hurt"
## Umbral crítico: 1 por debajo de la mitad de CRITICAL_HEALTH_RATIO, 0 por
## encima del umbral. Es el término que hace que retirarse gane a cubrirse.
const TERM_CRITICAL: StringName = &"critical"
## Exposición de la posición actual (0 = a cubierto).
const TERM_EXPOSURE: StringName = &"exposure"
## Seguridad de la posición actual: 1 en cobertura.
const TERM_SAFETY: StringName = &"safety"
## Me pueden ver, luego me pueden disparar.
const TERM_INCOMING: StringName = &"incoming"
## ¿Tiene la escuadra supresión activa? Puerta dura de ASSAULT.
const TERM_SUPPRESSION: StringName = &"suppression"
## ¿Coincide el rol asignado por la escuadra con este comportamiento?
const TERM_ROLE: StringName = &"role"
## Escuadra por debajo del umbral de repliegue.
const TERM_SQUAD_BROKEN: StringName = &"squad_broken"
## Amenazas conocidas frente a la referencia.
const TERM_OUTNUMBERED: StringName = &"outnumbered"
## Ausencia de contacto: es lo que sostiene la patrulla.
const TERM_CALM: StringName = &"calm"
## Antigüedad del último contacto visual.
const TERM_STALE: StringName = &"stale"
## Nadie me está mirando: buen momento para recargar o reagruparse.
const TERM_LULL: StringName = &"lull"
## Término constante del comportamiento de reposo.
const TERM_IDLE: StringName = &"idle"

# ---------------------------------------------------------------------------
# Normalizadores de las consideraciones
# ---------------------------------------------------------------------------

## Distancia con la que se normalizan las consideraciones de alcance.
## TODO(arquitecto): mover a datos.
const ENGAGE_REFERENCE_M: float = 25.0
## Distancia de combate cómoda. Más cerca se pierde la ventaja de cobertura,
## más lejos el arma no acierta.
## TODO(arquitecto): mover a datos.
const OPTIMAL_ENGAGE_M: float = 14.0
## Anchura de la campana de distancia óptima.
## TODO(arquitecto): mover a datos.
const OPTIMAL_ENGAGE_SIGMA_M: float = 9.0
## Por debajo de esta fracción de vida el bot se considera en peligro.
## TODO(arquitecto): mover a datos.
const CRITICAL_HEALTH_RATIO: float = 0.35
## Fracción del umbral en la que el término crítico llega a 1. Con 0,5 el
## término satura a la mitad del umbral: el bot no "se pone nervioso" poco a
## poco, decide retirarse cuando de verdad se está muriendo.
## TODO(arquitecto): mover a datos.
const CRITICAL_HEALTH_FALLOFF: float = 0.5
## Munición por debajo de la cual apremia recargar.
## TODO(arquitecto): mover a datos.
const LOW_AMMO_RATIO: float = 0.30
## Umbral de repliegue de escuadra del GDD §8.4: por debajo del 40 % de
## efectivos el grupo se reagrupa en vez de morir de uno en uno.
## TODO(arquitecto): mover a datos.
const SQUAD_BREAK_RATIO: float = 0.40
## Horizonte de memoria con el que se normaliza la antigüedad del contacto.
## TODO(arquitecto): mover a datos.
const MEMORY_HORIZON_S: float = 12.0
## Amenazas a partir de las cuales el bot se considera superado en número.
## TODO(arquitecto): mover a datos.
const OUTNUMBERED_REFERENCE: float = 3.0
## Valor del término `role` cuando la escuadra no ha asignado rol. Neutro y no
## 0: un bot sin instrucciones no tiene PROHIBIDO flanquear, sólo carece de una
## razón extra para hacerlo. Con 0 los bots sin director de escuadra dejarían
## de flanquear y suprimir sin que nada lo explicara.
## TODO(arquitecto): mover a datos.
const ROLE_NEUTRAL: float = 0.5

# ---------------------------------------------------------------------------
# Puertas duras del selector
# ---------------------------------------------------------------------------
# Una puerta no es un peso bajo: es un cero. La diferencia importa porque un
# comportamiento que sólo puntúa bajo se cuela en cuanto los demás bajan, y
# "dispara sin ver al objetivo" o "asalta sin supresión" no pueden colarse.

## Munición mínima para que suprimir tenga sentido: una ráfaga de tres balas
## no fija a nadie.
## TODO(arquitecto): mover a datos.
const SUPPRESS_MIN_AMMO_RATIO: float = 0.25
## Confianza mínima en el contacto para lanzarse a rodear.
## TODO(arquitecto): mover a datos.
const FLANK_MIN_CONFIDENCE: float = 0.40
## Confianza mínima para asaltar. Más alta que la de flanquear: avanzar a
## pecho descubierto hacia una posición que no sabes si sigue ocupada es la
## forma más rápida de perder una escuadra.
## TODO(arquitecto): mover a datos.
const ASSAULT_MIN_CONFIDENCE: float = 0.50
## Exposición por debajo de la cual el bot ya está suficientemente cubierto y
## buscar cobertura deja de tener sentido.
## TODO(arquitecto): mover a datos.
const COVER_SATISFIED_EXPOSURE: float = 0.25
## Munición por encima de la cual recargar no aporta nada.
const RELOAD_SATISFIED_RATIO: float = 0.98

# ---------------------------------------------------------------------------
# Ejecución de los árboles
# ---------------------------------------------------------------------------

## Radio con el que un árbol da por alcanzado un punto de destino.
## TODO(arquitecto): mover a datos.
const ARRIVAL_RADIUS_M: float = 0.9
## Segundos que un comportamiento queda vetado tras fallar su árbol. Es lo que
## convierte "no hay cobertura a la que ir" en "pues me retiro" sin que el
## selector lo reintente 5 veces por segundo.
## TODO(arquitecto): mover a datos.
const FAILURE_COOLDOWN_S: float = 2.5
## Tope de espera de una recarga antes de darla por fallida.
## TODO(arquitecto): mover a datos.
const RELOAD_TIMEOUT_S: float = 4.0
## Duración de la supresión que un bot marca en la pizarra por cada ráfaga.
## Es la condición que habilita el asalto de sus compañeros.
## TODO(arquitecto): mover a datos.
const SUPPRESSION_MARK_S: float = 2.0
## Segundos de barrido al llegar al punto investigado. Sustituye al
## `fullRotation()` del legacy, que giraba 1° por frame durante 360 frames y
## por tanto duraba lo que durase el framerate (`Enemy.cc:158-167`).
## TODO(arquitecto): mover a datos.
const INVESTIGATE_SCAN_S: float = 2.0
## Segundos que se mantiene una ráfaga de supresión antes de reevaluar.
## TODO(arquitecto): mover a datos.
const SUPPRESS_BURST_S: float = 1.5
## Distancia a la que un flanqueador da por terminada su ruta y pasa a atacar.
## TODO(arquitecto): mover a datos.
const FLANK_ARRIVAL_M: float = 2.0
## Distancia a la que se busca el punto de retirada, medida desde la amenaza.
## TODO(arquitecto): mover a datos.
const RETREAT_DISTANCE_M: float = 14.0
## Candidatos de cobertura que se piden al `CoverProvider` por consulta.
## TODO(arquitecto): mover a datos.
const COVER_QUERY_K: int = 3
## Segundos que una acción de movimiento espera una ruta antes de darla por
## imposible.
##
## Hace falta porque `WorldQuery.path()` devuelve un array vacío en DOS casos
## distintos que no se distinguen: "no hay ruta" y "el presupuesto de 4
## peticiones por frame de ADR-002 aún no la ha despachado, vuelve luego".
## Fallar al primer vacío convertiría un frame ocupado en un cambio de
## comportamiento; esperar para siempre dejaría al bot plantado ante un
## destino inalcanzable. Se espera, y poco.
## TODO(arquitecto): mover a datos.
const PATH_WAIT_S: float = 1.0
## Desplazamiento del destino a partir del cual se recalcula la ruta. Menos
## que esto no compensa una petición nueva.
## TODO(arquitecto): mover a datos.
const REPATH_THRESHOLD_M: float = 2.0
## Barrido angular del escaneo al investigar, en radianes por segundo.
## Sustituye al `fullRotation()` del legacy, que giraba 1° POR FRAME y por
## tanto dependía del framerate (`Enemy.cc:158-167`).
## TODO(arquitecto): mover a datos.
const SCAN_RATE_RAD_S: float = 2.2
## Distancia a la que el bot proyecta el punto que mira al escanear.
const SCAN_LOOK_DISTANCE_M: float = 8.0

# ---------------------------------------------------------------------------
# Tabla base de ganancias por comportamiento
# ---------------------------------------------------------------------------
# La ganancia es la amplitud máxima del comportamiento: el techo que puede
# alcanzar su utilidad cuando TODAS sus consideraciones valen 1. Es lo que
# permite que un comportamiento de un solo término (IDLE) no puntúe 1 por el
# mero hecho de tener un término satisfecho.
#
# Ganancia 0 = comportamiento deshabilitado para ese arquetipo. Es como los
# enemigos no tienen FOLLOW_LEADER ni HOLD_POSITION: no por una comprobación
# de bando escondida en el código, sino porque su tabla no los contempla.
## TODO(arquitecto): mover a datos.
const BASE_GAIN: Dictionary[BehaviorKind.Kind, float] = {
	BehaviorKind.Kind.IDLE: 0.05,
	BehaviorKind.Kind.PATROL: 0.35,
	BehaviorKind.Kind.INVESTIGATE: 0.55,
	BehaviorKind.Kind.ATTACK: 0.80,
	BehaviorKind.Kind.TAKE_COVER: 0.85,
	BehaviorKind.Kind.SUPPRESS: 0.70,
	BehaviorKind.Kind.FLANK: 0.70,
	BehaviorKind.Kind.ASSAULT: 0.75,
	BehaviorKind.Kind.RELOAD: 0.95,
	BehaviorKind.Kind.REGROUP: 0.65,
	BehaviorKind.Kind.RETREAT: 1.00,
	BehaviorKind.Kind.FOLLOW_LEADER: 0.0,
	BehaviorKind.Kind.HOLD_POSITION: 0.0,
}

# ---------------------------------------------------------------------------
# Tabla base de pesos por término
# ---------------------------------------------------------------------------
# La puntuación es la media ponderada de los términos, escalada por la
# ganancia:  score = gain · Σ(wᵢ·vᵢ) / Σwᵢ   con  vᵢ ∈ [0,1]  y  wᵢ ≥ 0.
#
# Media y no suma: así añadir una consideración a un comportamiento no lo
# infla frente a los demás, y los pesos se leen como importancia relativa
# dentro del comportamiento, que es como se balancea.
#
# Los pesos NUNCA son negativos. Una consideración que desaconseja se expresa
# invirtiendo su valor (`safety` = 1 − exposición), no con un peso negativo:
# con pesos negativos la normalización deja de tener sentido y el desglose
# deja de sumar la puntuación.
## TODO(arquitecto): mover a datos.
const BASE_WEIGHTS: Dictionary[BehaviorKind.Kind, Dictionary] = {
	BehaviorKind.Kind.IDLE: {
		TERM_IDLE: 1.0,
	},
	BehaviorKind.Kind.PATROL: {
		TERM_CALM: 2.0,
		TERM_HEALTH: 1.0,
		TERM_AMMO: 1.0,
	},
	BehaviorKind.Kind.INVESTIGATE: {
		TERM_CONTACT: 2.0,
		TERM_BLOCKED: 1.5,
		TERM_STALE: 1.0,
		TERM_HEALTH: 1.0,
		TERM_AMMO: 1.0,
	},
	BehaviorKind.Kind.ATTACK: {
		TERM_CONTACT: 2.0,
		TERM_LINE_OF_SIGHT: 2.0,
		TERM_AMMO: 1.0,
		TERM_RANGE_OPTIMAL: 1.0,
		TERM_HEALTH: 2.0,
		TERM_SAFETY: 0.5,
	},
	BehaviorKind.Kind.TAKE_COVER: {
		TERM_EXPOSURE: 2.5,
		TERM_CONTACT: 1.5,
		TERM_INCOMING: 1.0,
		TERM_DRY: 1.0,
	},
	BehaviorKind.Kind.SUPPRESS: {
		TERM_CONTACT: 2.0,
		TERM_LINE_OF_SIGHT: 2.0,
		TERM_AMMO: 1.5,
		TERM_ROLE: 1.5,
		TERM_RANGE_FAR: 1.0,
		TERM_SAFETY: 1.0,
	},
	BehaviorKind.Kind.FLANK: {
		TERM_CONTACT: 2.0,
		TERM_BLOCKED: 1.5,
		TERM_ROLE: 2.0,
		TERM_HEALTH: 1.0,
		TERM_AMMO: 1.0,
		TERM_RANGE_FAR: 1.0,
	},
	BehaviorKind.Kind.ASSAULT: {
		TERM_SUPPRESSION: 2.5,
		TERM_CONTACT: 1.5,
		TERM_ROLE: 2.0,
		TERM_HEALTH: 1.5,
		TERM_RANGE_NEAR: 1.0,
		TERM_AMMO: 1.0,
	},
	BehaviorKind.Kind.RELOAD: {
		TERM_AMMO_NEED: 2.0,
		TERM_DRY: 2.0,
		TERM_SAFETY: 1.5,
	},
	BehaviorKind.Kind.REGROUP: {
		TERM_SQUAD_BROKEN: 3.0,
		TERM_HURT: 1.0,
		TERM_LULL: 1.0,
		TERM_ROLE: 1.0,
	},
	BehaviorKind.Kind.RETREAT: {
		TERM_CRITICAL: 3.0,
		TERM_EXPOSURE: 1.0,
		TERM_SQUAD_BROKEN: 1.0,
	},
	BehaviorKind.Kind.FOLLOW_LEADER: {
		TERM_CALM: 1.5,
		TERM_HEALTH: 1.0,
		TERM_LULL: 1.0,
	},
	BehaviorKind.Kind.HOLD_POSITION: {
		TERM_ROLE: 2.0,
		TERM_SAFETY: 1.0,
		TERM_LINE_OF_SIGHT: 1.0,
	},
}

# ---------------------------------------------------------------------------
# Arquetipos = tablas de pesos, no clases
# ---------------------------------------------------------------------------
# Un arquetipo NO es una subclase con lógica propia: es un puñado de números
# que desplazan la misma decisión. Si mañana hace falta un enemigo que sólo
# suprime, es una fila más en esta tabla, no un fichero nuevo.
#
# GDD §4:
#   Sicario     (enemy_thug)        frágil y numeroso, presiona por volumen
#   Miliciano   (enemy_militiaman)  equilibrado, usa cobertura y flanquea
#   Veterano    (enemy_veteran)     duro, suprime y avanza en formación

## Ganancias que se suman a la base por arquetipo. Lo que no aparece, hereda.
## TODO(arquitecto): mover a datos.
const ARCHETYPE_GAIN: Dictionary[StringName, Dictionary] = {
	# Sicario: se lanza, apenas se cubre, no flanquea ni suprime.
	&"enemy_thug": {
		BehaviorKind.Kind.ATTACK: 0.95,
		BehaviorKind.Kind.ASSAULT: 0.85,
		BehaviorKind.Kind.TAKE_COVER: 0.45,
		BehaviorKind.Kind.SUPPRESS: 0.25,
		BehaviorKind.Kind.FLANK: 0.35,
		BehaviorKind.Kind.RETREAT: 0.90,
		BehaviorKind.Kind.PATROL: 0.40,
	},
	# Miliciano: la tabla base. Se queda como está a propósito — el equilibrado
	# es la referencia contra la que se leen los otros dos.
	&"enemy_militiaman": {
		BehaviorKind.Kind.FLANK: 0.85,
	},
	# Veterano: suprime, se cubre mucho y avanza cuando otro fija.
	&"enemy_veteran": {
		BehaviorKind.Kind.SUPPRESS: 0.95,
		BehaviorKind.Kind.TAKE_COVER: 0.95,
		BehaviorKind.Kind.ASSAULT: 0.85,
		BehaviorKind.Kind.ATTACK: 0.70,
		BehaviorKind.Kind.FLANK: 0.60,
		BehaviorKind.Kind.REGROUP: 0.75,
	},
	&"miniboss": {
		BehaviorKind.Kind.ATTACK: 0.90,
		BehaviorKind.Kind.ASSAULT: 0.85,
		BehaviorKind.Kind.TAKE_COVER: 0.55,
		BehaviorKind.Kind.RETREAT: 0.55,
		BehaviorKind.Kind.REGROUP: 0.20,
	},
	&"megaboss": {
		BehaviorKind.Kind.ATTACK: 0.90,
		BehaviorKind.Kind.SUPPRESS: 0.80,
		BehaviorKind.Kind.TAKE_COVER: 0.60,
		BehaviorKind.Kind.RETREAT: 0.45,
		BehaviorKind.Kind.REGROUP: 0.20,
	},
}

## Pesos que sustituyen a los de la base, término a término.
## TODO(arquitecto): mover a datos.
const ARCHETYPE_WEIGHTS: Dictionary[StringName, Dictionary] = {
	&"enemy_thug": {
		# La seguridad de la posición casi no le pesa al atacar: eso es "poca
		# cobertura" expresado como número en vez de como excepción en el código.
		BehaviorKind.Kind.ATTACK: {
			TERM_CONTACT: 2.0,
			TERM_LINE_OF_SIGHT: 2.0,
			TERM_AMMO: 1.0,
			TERM_RANGE_OPTIMAL: 0.5,
			TERM_HEALTH: 1.5,
			TERM_SAFETY: 0.1,
		},
	},
	&"enemy_veteran": {
		# Suprime aunque no le hayan dado el rol: es su forma de combatir.
		BehaviorKind.Kind.SUPPRESS: {
			TERM_CONTACT: 2.0,
			TERM_LINE_OF_SIGHT: 2.0,
			TERM_AMMO: 1.5,
			TERM_ROLE: 0.75,
			TERM_RANGE_FAR: 1.0,
			TERM_SAFETY: 1.5,
		},
	},
}

# ---------------------------------------------------------------------------
# Fases de jefe
# ---------------------------------------------------------------------------
# Un jefe no es un arquetipo con más vida: cambia de tabla al bajar de umbral.
# Las fases se resuelven por fracción de vida, de mayor a menor.

## Umbrales de vida (excluidos) que abren cada fase, en orden descendente.
## `[0.6, 0.3]` = fase 0 por encima de 0,6; fase 1 entre 0,6 y 0,3; fase 2 por
## debajo de 0,3.
## TODO(arquitecto): mover a datos.
const BOSS_PHASE_THRESHOLDS: Dictionary[StringName, Array] = {
	&"miniboss": [0.5],
	&"megaboss": [0.66, 0.33],
}

## Ganancias por fase, indexadas igual que los umbrales + 1. La fase 0 usa la
## tabla del arquetipo; a partir de ahí, cada entrada la desplaza.
## TODO(arquitecto): mover a datos.
const BOSS_PHASE_GAIN: Dictionary[StringName, Array] = {
	# MiniBoss herido: deja de guardar la puerta y carga.
	&"miniboss": [
		{},
		{
			BehaviorKind.Kind.ASSAULT: 1.00,
			BehaviorKind.Kind.ATTACK: 1.00,
			BehaviorKind.Kind.TAKE_COVER: 0.20,
			BehaviorKind.Kind.RETREAT: 0.15,
		},
	],
	# MegaBoss: azotea, tres fases. Al final ya no se cubre ni se retira.
	&"megaboss": [
		{},
		{
			BehaviorKind.Kind.SUPPRESS: 0.95,
			BehaviorKind.Kind.TAKE_COVER: 0.85,
			BehaviorKind.Kind.REGROUP: 0.60,
		},
		{
			BehaviorKind.Kind.ATTACK: 1.00,
			BehaviorKind.Kind.ASSAULT: 1.00,
			BehaviorKind.Kind.TAKE_COVER: 0.10,
			BehaviorKind.Kind.RETREAT: 0.0,
			BehaviorKind.Kind.REGROUP: 0.0,
		},
	],
}

# ---------------------------------------------------------------------------
# Compañeros (GDD §8.5): el MISMO cerebro con otra tabla
# ---------------------------------------------------------------------------
# No hay una IA de aliado y otra de enemigo. Hay una tabla que antepone la
# formación, la cobertura del jugador y el fuego de apoyo. `ai-escuadra`
# construye la suya encima de esta.
## TODO(arquitecto): mover a datos.
const COMPANION_GAIN: Dictionary[BehaviorKind.Kind, float] = {
	BehaviorKind.Kind.IDLE: 0.05,
	BehaviorKind.Kind.PATROL: 0.10,
	BehaviorKind.Kind.INVESTIGATE: 0.30,
	BehaviorKind.Kind.ATTACK: 0.80,
	BehaviorKind.Kind.TAKE_COVER: 0.85,
	BehaviorKind.Kind.SUPPRESS: 0.75,
	BehaviorKind.Kind.FLANK: 0.35,
	BehaviorKind.Kind.ASSAULT: 0.45,
	BehaviorKind.Kind.RELOAD: 0.95,
	BehaviorKind.Kind.REGROUP: 0.40,
	BehaviorKind.Kind.RETREAT: 0.85,
	BehaviorKind.Kind.FOLLOW_LEADER: 0.60,
	BehaviorKind.Kind.HOLD_POSITION: 0.70,
}


## Fase de jefe correspondiente a una fracción de vida. 0 para todo lo que no
## sea un jefe con fases declaradas.
static func boss_phase(archetype: StringName, health_ratio: float) -> int:
	var thresholds: Array = BOSS_PHASE_THRESHOLDS.get(archetype, [])
	var phase := 0
	for value: float in thresholds:
		if health_ratio <= value:
			phase += 1
	return phase
