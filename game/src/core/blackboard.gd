extends Node
## Pizarra compartida. Única vía de comunicación entre bots (GDD §8.4).
##
## Ningún bot lee el estado interno de otro directamente. Todo pasa por aquí.
## Eso hace que la coordinación de escuadra sea testeable como función pura:
## (lista de estados, contactos) -> asignación de roles.

## Roles que un SquadDirector puede asignar. Sin duplicados por grupo.
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

	func age_s() -> float:
		return float(Time.get_ticks_msec() - last_seen_msec) / 1000.0


var _contacts: Dictionary[int, Dictionary] = {}   ## squad_id -> {target_id: Contact}
var _roles: Dictionary[int, Role] = {}            ## bot_id -> Role
var _suppression: Dictionary[int, float] = {}     ## squad_id -> hasta cuándo (msec) hay supresión activa
var _claimed_routes: Dictionary[int, Array] = {}  ## squad_id -> Array[int] de ids de ruta reclamados


func clear() -> void:
	_contacts.clear()
	_roles.clear()
	_suppression.clear()
	_claimed_routes.clear()


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
	_suppression[squad_id] = float(Time.get_ticks_msec()) + duration_s * 1000.0


func has_active_suppression(squad_id: int) -> bool:
	return float(Time.get_ticks_msec()) < float(_suppression.get(squad_id, 0.0))


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
