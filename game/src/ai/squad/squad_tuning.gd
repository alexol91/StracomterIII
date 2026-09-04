class_name SquadTuning
## Constantes de sintonía de la coordinación de escuadra (GDD §8.4 y §8.5).
##
## TODO(arquitecto): mover a datos. ADR-005 dice que ningún número de balanceo
## vive en código, y estos lo son. Se agrupan aquí —igual que hace
## `NavTuning` en `ai/navigation`— para que la migración a un `.tres` sea
## mover un fichero y no perseguir literales por doce ficheros. Ninguna de
## estas constantes se repite en ningún otro `.gd` de `ai/squad/`.
##
## Lo que NO está aquí, a propósito: las reglas del GDD §8.4 (umbral del 40 %,
## un flanqueador por ruta, nadie asalta sin supresión). Un umbral es un
## número; una regla es una invariante. El 0,4 sí está aquí porque es el
## número; que por debajo de él el grupo se repliegue está codificado en
## `SquadDirector` y no es configurable.


# ---------------------------------------------------------------------------
# Efectivos y repliegue
# ---------------------------------------------------------------------------

## Fracción de efectivos por debajo de la cual el grupo se repliega (GDD §8.4).
const RETREAT_STRENGTH_RATIO: float = 0.4
## Fracción a partir de la cual un grupo que se repliega vuelve a combatir.
## Es mayor que la de entrada a propósito: sin histéresis, un grupo que oscila
## alrededor del 40 % alterna repliegue y asalto cada tick de decisión.
const REGROUP_EXIT_RATIO: float = 0.6
## Distancia mínima que debe haber entre el punto de reagrupamiento y la
## amenaza para considerarlo válido, en metros.
const RALLY_MIN_DISTANCE_M: float = 12.0
## Cuánto se aleja del enemigo el punto de reagrupamiento de emergencia
## cuando no hay ninguna sala anterior registrada, en metros.
const RALLY_FALLBACK_DISTANCE_M: float = 15.0
## Cuántas salas hacia atrás recuerda un grupo.
const BREADCRUMB_CAPACITY: int = 4


# ---------------------------------------------------------------------------
# Reparto de roles
# ---------------------------------------------------------------------------

## Tope absoluto de flanqueadores simultáneos por grupo, aunque haya más rutas.
const MAX_FLANKERS: int = 2
## Tope absoluto de asaltantes simultáneos por grupo.
const MAX_ASSAULTERS: int = 2
## Bots necesarios por cada flanqueador: con 2 bots, 1 flanquea y 1 fija.
## Es lo que impide que un grupo entero se vaya de flanqueo y nadie presione.
const BOTS_PER_FLANKER: int = 2
## Confianza mínima de un contacto para considerarlo objetivo del grupo.
## Por debajo de esto el grupo investiga, no ataca.
const MIN_TARGET_CONFIDENCE: float = 0.25
## Distancia de referencia para normalizar distancias en las puntuaciones, m.
const REFERENCE_DISTANCE_M: float = 25.0
## Ventaja que se concede al rol que el bot ya tiene. Es la histéresis que
## evita que los roles bailen entre dos bots casi empatados cada 200 ms.
const ROLE_HYSTERESIS_BONUS: float = 0.15

## Pesos de la puntuación de Fijador: quiere ver al objetivo, desde cobertura,
## con munición.
const PIN_W_LINE_OF_SIGHT: float = 1.0
const PIN_W_IN_COVER: float = 0.5
const PIN_W_AMMO: float = 0.6
const PIN_W_HEALTH: float = 0.3
const PIN_W_DISTANCE: float = 0.4

## Pesos de la puntuación de Flanqueador: quiere estar entero, con munición y
## LIBRE — el que ya está intercambiando fuego no puede irse a rodear.
const FLANK_W_HEALTH: float = 0.8
const FLANK_W_AMMO: float = 0.5
const FLANK_W_UNEXPOSED: float = 0.4
const FLANK_W_FREE_OF_CONTACT: float = 0.9

## Pesos de la puntuación de Asaltante: entero, con munición y ya cerca.
const ASSAULT_W_HEALTH: float = 1.0
const ASSAULT_W_AMMO: float = 0.7
const ASSAULT_W_PROXIMITY: float = 0.6

## Munición por debajo de la cual un bot no sirve para fijar ni para asaltar.
const MIN_USEFUL_AMMO_RATIO: float = 0.05


# ---------------------------------------------------------------------------
# Reparto de ángulos de cobertura (GDD §8.4: "el grupo no mira todo al mismo sitio")
# ---------------------------------------------------------------------------

## Semiapertura del abanico de los que están en contacto, en radianes. Los
## roles de combate siguen mirando al objetivo, pero no exactamente al mismo
## punto: quien fija y quien asalta cubren bordes distintos del vano.
const ENGAGED_FAN_RAD: float = 0.35
## Hueco angular mínimo entre el abanico de combate y el arco de la reserva.
const RESERVE_ARC_MARGIN_RAD: float = 0.6
## Separación angular mínima exigible entre dos bots del mismo grupo. Es el
## contrato que comprueba la prueba de reparto de ángulos.
const MIN_WATCH_SEPARATION_RAD: float = 0.25


# ---------------------------------------------------------------------------
# Moral y obediencia (GDD §3, [P05])
# ---------------------------------------------------------------------------

## Techo de moral. `f1.xml`: Capitán 3, resto 2.
const MORALE_MAX: int = 3
## Moral que concede la cercanía a un Capitán vivo, réplica de
## `EventControl::UpdateMoral` (el original ponía 3 y `returnMoral` devolvía
## al valor de la ficha).
const MORALE_NEAR_CAPTAIN: int = 3
## Moral que pierde un compañero cuando cae otro miembro de la escuadra.
## EXTENSIÓN sobre el original, que no tenía penalización ninguna.
const MORALE_LOSS_ON_SQUAD_DEATH: int = 1

## Cuánto pesa la moral en la obediencia. Obediencia = moral/MORALE_MAX * esto.
const OBEDIENCE_FROM_MORALE: float = 1.0
## Cuánto empuja a desobedecer estar herido.
const SURVIVAL_W_WOUNDS: float = 0.6
## Cuánto empuja a desobedecer estar a pecho descubierto.
const SURVIVAL_W_EXPOSURE: float = 0.25
## Cuánto empuja a desobedecer estar recibiendo fuego.
const SURVIVAL_W_UNDER_FIRE: float = 0.2
## Salud por debajo de la cual un compañero puede retirarse aunque obedezca.
const CRITICAL_HEALTH_RATIO: float = 0.25

## Riesgo percibido de cada orden del jugador. "Ir ahí" es cruzar; "Enfocar
## eso" es girar el arma. No cuestan lo mismo de obedecer.
const ORDER_RISK_MOVE_TO: float = 0.15
const ORDER_RISK_FOCUS_TARGET: float = 0.05
const ORDER_RISK_HOLD_POSITION: float = 0.10


# ---------------------------------------------------------------------------
# Formación (legacy `Player.cc:75-85`)
# ---------------------------------------------------------------------------

## Factor aplicado ENCIMA de `Balance.LEGACY_TO_METERS` a los offsets de
## formación del original. Ver `CompanionFormation` para la justificación.
const FORMATION_SCALE: float = 1.5
## Radio dentro del cual se considera que un compañero ocupa su hueco.
const FORMATION_SLOT_TOLERANCE_M: float = 1.0


# ---------------------------------------------------------------------------
# Tabla de utilidad del compañero que ha dejado de obedecer
# ---------------------------------------------------------------------------
# La tabla base del compañero es de `ai/behavior`
# (`BehaviorTuning.COMPANION_GAIN`). Aquí sólo vive lo que la MORAL le hace
# encima; `UtilityWeights.set_gain` existe justamente para esto.

## Multiplicador sobre la ganancia de los verbos que mantienen vivo al
## compañero cuando antepone sobrevivir.
const SURVIVAL_GAIN_BOOST: float = 1.4
## Multiplicador sobre la ganancia de los verbos que lo exponen.
const SURVIVAL_GAIN_CUT: float = 0.35


# ---------------------------------------------------------------------------
# Validación de rutas de flanqueo
# ---------------------------------------------------------------------------

## Distancia máxima entre el último punto de una ruta y el objetivo para
## considerarla COMPLETA. `NavigationServer3D` devuelve puntos sobre el
## navmesh, nunca el destino exacto, así que hace falta tolerancia; pero una
## ruta que se queda a 8 m del objetivo es una ruta PARCIAL, y mandar a un
## flanqueador por ella es mandarlo contra una pared. Alineada con
## `NavTuning.ROUTE_ENDPOINT_KEEP_RADIUS_M`, que es el entorno que
## `RoutePlanner` ya considera "el mismo sitio".
const ROUTE_ARRIVAL_TOLERANCE_M: float = 2.5
## Longitud mínima de una ruta de flanqueo, en metros. Una ruta de dos puntos
## a metro y medio no rodea nada.
const ROUTE_MIN_LENGTH_M: float = 3.0
## A qué distancia mira un flanqueador por delante de sí mismo, sobre su
## propia ruta, para orientar la vigilancia. Con menos de esto el primer
## punto útil suele ser el de PARTIDA de la ruta, que queda detrás del bot: el
## flanqueador acabaría mirando hacia donde viene.
const ROUTE_LOOKAHEAD_M: float = 2.0
