extends Node
## Pizarra compartida. Única vía de comunicación entre bots (GDD §8.4).
##
## Ningún bot lee el estado interno de otro directamente. Todo pasa por aquí.
## Eso hace que la coordinación de escuadra sea testeable como función pura:
## (lista de estados, contactos) -> asignación de roles.

## Roles que un SquadDirector puede asignar. Sin duplicados por grupo.
## Grupo del jugador y sus compañeros en esta pizarra.
##
## Negativo a propósito: los grupos enemigos se numeran desde 0 según el orden
## de aparición, y compartir número haría que un compañero leyera los contactos
## de los enemigos como si fueran los suyos.
##
## Vive aquí, en `core/`, y no en `ai/squad/`, porque lo necesitan las dos
## puntas de la cadena de dependencias: `ai/` para gobernar la escuadra y
## `levels/` para etiquetar a los cuerpos al colocarlos. `levels/` no puede
## conocer `ai/` (regla 2), así que el dato compartido tiene que estar debajo
## de los dos.
const PLAYER_SQUAD_ID: int = -1

enum Role {
	NONE,
	PINNER,     ## Mantiene la presión frontal.
	FLANKER,    ## Rodea por una ruta de navmesh disjunta.
	ASSAULTER,  ## Avanza cuando hay supresión activa.
	RESERVE,    ## Espera en cobertura.
}

## Un contacto conocido sobre un objetivo. La confianza decae con el tiempo:
## un bot no olvida de golpe, va a buscarte donde CREE que estás.
class Contact:
	extends RefCounted

	var target_id: int = 0
	var team: int = 0
	var last_known_position: Vector3 = Vector3.ZERO
	var last_seen_msec: int = 0
	## 0..1. 1 = visto ahora mismo.
	var confidence: float = 0.0
	## Quién lo reportó (para depuración y para el retardo de reacción).
	var reporter_id: int = 0

	## Antigüedad del contacto en segundos, medida contra el sello de tiempo con
	## el que lo publicó el difusor (`ContactBroadcaster`, reloj inyectable).
	func age_s(now_msec: int) -> float:
		return float(now_msec - last_seen_msec) / 1000.0


var _contacts: Dictionary[int, Dictionary] = {}   ## squad_id -> {target_id: Contact}
var _roles: Dictionary[int, Role] = {}            ## bot_id -> Role
var _suppression: Dictionary[int, float] = {}     ## squad_id -> hasta cuándo (msec) hay supresión activa
var _claimed_routes: Dictionary[int, Array] = {}  ## squad_id -> Array[int] de ids de ruta reclamados

## Reloj de SIMULACIÓN, en segundos. Acumula el delta del motor.
##
## No es `Time.get_ticks_msec()`, y la diferencia no es cosmética: el reloj de
## pared no respeta `Engine.time_scale`, no se detiene con la pausa y, en una
## simulación a paso fijo (`--fixed-fps`), avanza a su aire. La marca de
## supresión se guardaba en milisegundos de pared, así que en la sonda de
## combate —que corre a paso fijo y por debajo del tiempo real— una supresión
## de tres segundos duraba tres segundos de PARED, o sea muchos menos de
## simulación, y variaba con la carga de la máquina. Una regla de escuadra del
## GDD («nadie asalta sin supresión activa») decidida por lo ocupado que esté
## el procesador.
##
## `AIScheduler` ya llevaba su propio reloj simulado por esta misma razón y lo
## dejaba escrito en su cabecera; esto es aplicar aquí lo que allí ya estaba
## aprendido.
var _clock_s: float = 0.0


func _process(delta: float) -> void:
	_clock_s += delta


## Segundos de simulación transcurridos. Es el reloj contra el que caducan las
## marcas de esta pizarra.
func now_s() -> float:
	return _clock_s


## Avanza el reloj a mano. Para las pruebas, que corren dentro de un único
## `_ready()` síncrono y no ven pasar ni un frame.
func advance_clock(seconds: float) -> void:
	_clock_s += maxf(seconds, 0.0)


func clear() -> void:
	_contacts.clear()
	_roles.clear()
	_suppression.clear()
	_claimed_routes.clear()
	_clock_s = 0.0


# ---- Contactos ----

## Registra o refresca un contacto en la pizarra de una escuadra.
func report_contact(squad_id: int, contact: Contact) -> void:
	if not _contacts.has(squad_id):
		_contacts[squad_id] = {}
	var squad: Dictionary = _contacts[squad_id]
	var existing: Contact = squad.get(contact.target_id, null)
	# Solo se sobrescribe con información más fresca o más fiable.
	if existing == null or contact.last_seen_msec >= existing.last_seen_msec:
		squad[contact.target_id] = contact


func contacts_for(squad_id: int) -> Array[Contact]:
	var out: Array[Contact] = []
	var squad: Dictionary = _contacts.get(squad_id, {})
	for key: int in squad:
		out.append(squad[key])
	return out


## Contacto de mayor confianza, o null si la escuadra está a ciegas.
func best_contact(squad_id: int) -> Contact:
	var best: Contact = null
	for c: Contact in contacts_for(squad_id):
		if best == null or c.confidence > best.confidence:
			best = c
	return best


## Elimina los contactos cuya confianza ha caído por debajo del umbral.
func prune_contacts(squad_id: int, min_confidence: float) -> void:
	var squad: Dictionary = _contacts.get(squad_id, {})
	for key: int in squad.keys():
		var c: Contact = squad[key]
		if c.confidence < min_confidence:
			squad.erase(key)


# ---- Roles ----

func set_role(bot_id: int, role: Role) -> void:
	_roles[bot_id] = role


func role_of(bot_id: int) -> Role:
	return _roles.get(bot_id, Role.NONE)


func clear_roles_for(bot_ids: Array[int]) -> void:
	for id: int in bot_ids:
		_roles.erase(id)


# ---- Supresión ----
# Regla de escuadra: nadie asalta sin supresión activa de un compañero.

func mark_suppression(squad_id: int, duration_s: float) -> void:
	_suppression[squad_id] = _clock_s + duration_s


func has_active_suppression(squad_id: int) -> bool:
	return _clock_s < float(_suppression.get(squad_id, -INF))


# ---- Reclamación de rutas ----
# Regla de escuadra: máximo un flanqueador por ruta.

func claim_route(squad_id: int, route_id: int) -> bool:
	var claimed: Array = _claimed_routes.get(squad_id, [])
	if claimed.has(route_id):
		return false
	claimed.append(route_id)
	_claimed_routes[squad_id] = claimed
	return true


func release_routes(squad_id: int) -> void:
	_claimed_routes.erase(squad_id)
