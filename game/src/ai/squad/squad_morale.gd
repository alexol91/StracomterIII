class_name SquadMorale
## Moral de escuadra: cuánto obedece un compañero (GDD §3 y §8.5, `[P05]`).
##
## LO QUE HACÍA EL ORIGINAL, QUE NO ES LO QUE PARECE. La moral era un entero
## por personaje cuyo ÚNICO efecto era habilitar la regeneración: `UpdateSanar`
## exigía `moral == 3` (`Character.cc:114`), y `EventControl::UpdateMoral`
## (`EventControl.cc:336-354`) ponía 3 a todo aliado a menos de 200 unidades
## de un Capitán y lo devolvía al valor de su ficha en cuanto se alejaba. No
## había pánico, ni huida, ni penalización de ningún tipo. El estado
## `ComeBack` de los compañeros, que es lo único que se parecía a una reacción
## de moral, era CÓDIGO INALCANZABLE: ninguna transición emitía el 3
## (análisis §5.1 y §5.4).
##
## QUÉ PASA AQUÍ. La parte de paridad —el aura que regenera— ya está
## implementada en `gameplay/auras/aura_emitter.gd` y no es asunto de este
## fichero. Lo que se implementa aquí es el hueco que el original dejó
## abierto y que el GDD §3 autoriza explícitamente: **la moral modula la
## obediencia**. Con moral alta un compañero cruza el vano porque se lo has
## pedido; con moral baja se queda a cubierto, y eso es información que el
## jugador puede leer y sobre la que puede actuar (acercar al Capitán, matar
## a quien les está fijando, dar una orden menos arriesgada).
##
## "CADA PUNTO DE MORAL = UN COMPAÑERO". La moral se guarda por personaje
## (`CharacterStats.morale`: Capitán 3, resto 2), pero se LEE como recurso de
## grupo: `CompanionSquad.obedient_count()` dice cuántos compañeros tienes de
## verdad en este momento, que casi nunca es cuántos están vivos.
##
## Todo aquí es estático y puro: `(moral, salud, exposición, fuego, orden) ->
## obedece`. Sin reloj, sin pizarra, sin escena.


## Moral efectiva de un compañero. Réplica de `UpdateMoral` / `returnMoral`:
## cerca de un Capitán vivo la moral sube al máximo; lejos, vuelve a la de su
## ficha. `penalty` es la EXTENSIÓN sobre el original: las bajas de la
## escuadra pesan.
static func effective_morale(base_morale: int, near_captain: bool, penalty: int = 0) -> int:
	var value := SquadTuning.MORALE_NEAR_CAPTAIN if near_captain else base_morale
	return clampi(value - penalty, 0, SquadTuning.MORALE_MAX)


## Moral normalizada a 0..1.
static func ratio(morale: int) -> float:
	if SquadTuning.MORALE_MAX <= 0:
		return 0.0
	return clampf(float(morale) / float(SquadTuning.MORALE_MAX), 0.0, 1.0)


## Cuánto está dispuesto a obedecer, 0..1.
static func obedience(morale: int) -> float:
	return ratio(morale) * SquadTuning.OBEDIENCE_FROM_MORALE


## Cuánto empuja la situación a dejar de obedecer y ponerse a salvo.
## Herido pesa más que expuesto, y expuesto más que estar bajo fuego: puedes
## salir de un sitio batido, no puedes salir de estar a media vida.
static func survival_pressure(
	health_ratio: float, exposure: float, under_fire: bool
) -> float:
	var pressure := SquadTuning.SURVIVAL_W_WOUNDS * (1.0 - clampf(health_ratio, 0.0, 1.0))
	pressure += SquadTuning.SURVIVAL_W_EXPOSURE * clampf(exposure, 0.0, 1.0)
	if under_fire:
		pressure += SquadTuning.SURVIVAL_W_UNDER_FIRE
	return pressure


## ¿Obedece esta orden? El riesgo de la orden se suma a la presión de
## supervivencia: obedecer "enfocar eso" es girar el arma; obedecer "ir ahí"
## puede ser cruzar un vano batido, y no cuestan lo mismo.
static func obeys(
	morale: int, health_ratio: float, exposure: float, under_fire: bool, order_risk: float
) -> bool:
	return obedience(morale) >= survival_pressure(health_ratio, exposure, under_fire) + order_risk


## ¿Está tan herido que la supervivencia manda aunque obedezca? Un compañero
## a punto de caer se retira: no es desobediencia, es que un compañero muerto
## lo está PARA EL RESTO DE LA CAMPAÑA (análisis §5.2, no hay resurrección),
## y perderlo por cumplir una orden es el peor intercambio del juego.
static func is_critical(health_ratio: float) -> bool:
	return health_ratio <= SquadTuning.CRITICAL_HEALTH_RATIO
