class_name SquadRoleAssignment
extends RefCounted
## Resultado del reparto de roles de un grupo. Objeto de datos PURO: lo
## produce `SquadDirector.assign_roles()` sin tocar la pizarra, el reloj ni la
## escena, y por eso el reparto se puede probar entero en `--headless`.
##
## Contiene además de los roles todo lo que se deriva de ellos y que las
## reglas del GDD §8.4 obligan a decidir en grupo y no bot a bot: qué ruta
## disjunta tiene reclamada cada flanqueador, hacia dónde mira cada uno y qué
## comportamientos tiene PERMITIDOS.

var squad_id: int = 0
## Fracción de efectivos vivos sobre el censo inicial del grupo.
var strength_ratio: float = 1.0
## El grupo está por debajo del umbral: se repliega y se reagrupa.
var retreating: bool = false
## Punto de reagrupamiento. Solo significativo si `retreating`.
var rally_point: Vector3 = Vector3.INF
## ¿Había supresión activa cuando se repartió? Condición del asalto.
var suppression_active: bool = false
## ¿Hay un contacto con confianza suficiente?
var has_target: bool = false
var target_position: Vector3 = Vector3.INF
var target_id: int = 0
## Por qué no se flanquea, cuando no se flanquea. Para la consola y las
## pruebas: un flanqueo que desaparece en silencio es indistinguible de un
## flanqueo mal calculado.
var flank_veto_reason: StringName = &""
## Por qué no se asalta, cuando no se asalta.
var assault_veto_reason: StringName = &""

## bot_id -> Blackboard.Role
var roles: Dictionary[int, Blackboard.Role] = {}
## bot_id -> route_id reclamado. Solo los flanqueadores aparecen aquí.
var routes: Dictionary[int, int] = {}
## route_id -> polilínea de la ruta, tal y como la devolvió `WorldQuery`.
var route_paths: Dictionary[int, PackedVector3Array] = {}
## bot_id -> ángulo de vigilancia en radianes, medido en el plano XZ como
## `atan2(z, x)`. Es el reparto de ángulos de cobertura del GDD §8.4.
var watch_yaw: Dictionary[int, float] = {}
## bot_id -> comportamientos permitidos (`BehaviorKind.Kind`).
var allowed: Dictionary[int, PackedInt32Array] = {}


func role_of(bot_id: int) -> Blackboard.Role:
	return roles.get(bot_id, Blackboard.Role.NONE)


## Ruta disjunta reclamada por este bot, o -1 si no flanquea.
func route_of(bot_id: int) -> int:
	return routes.get(bot_id, -1)


func path_of_route(route_id: int) -> PackedVector3Array:
	return route_paths.get(route_id, PackedVector3Array())


## Dirección de vigilancia en el plano XZ, ya normalizada.
func watch_direction(bot_id: int) -> Vector3:
	if not watch_yaw.has(bot_id):
		return Vector3.ZERO
	var yaw: float = watch_yaw[bot_id]
	return Vector3(cos(yaw), 0.0, sin(yaw))


func allowed_of(bot_id: int) -> PackedInt32Array:
	return allowed.get(bot_id, PackedInt32Array())


func allows(bot_id: int, kind: BehaviorKind.Kind) -> bool:
	return allowed_of(bot_id).has(int(kind))


func bot_ids() -> PackedInt32Array:
	var out := PackedInt32Array()
	for id: int in roles:
		out.append(id)
	out.sort()
	return out


func bots_with_role(role: Blackboard.Role) -> PackedInt32Array:
	var out := PackedInt32Array()
	for id: int in roles:
		if roles[id] == role:
			out.append(id)
	out.sort()
	return out


func count_of(role: Blackboard.Role) -> int:
	return bots_with_role(role).size()


## Rutas distintas efectivamente reclamadas. Si esto es menor que el número
## de flanqueadores, hay dos bots en la misma ruta y la regla del GDD §8.4
## está rota.
func claimed_route_count() -> int:
	var seen: Dictionary[int, bool] = {}
	for id: int in routes:
		seen[routes[id]] = true
	return seen.size()


## Invariantes del GDD §8.4. Devuelve la lista de infracciones; vacía = sana.
## Se comprueba en las pruebas y se puede volcar desde la consola. Existe
## porque una regla que solo vive en el código que la aplica no se puede
## auditar desde fuera.
func rule_violations() -> Array[String]:
	var out: Array[String] = []
	if count_of(Blackboard.Role.FLANKER) != routes.size():
		out.append("hay flanqueadores sin ruta reclamada")
	if claimed_route_count() != routes.size():
		out.append("dos flanqueadores comparten ruta")
	if not suppression_active and count_of(Blackboard.Role.ASSAULTER) > 0:
		out.append("hay asaltantes sin supresión activa")
	if retreating:
		for id: int in roles:
			if roles[id] != Blackboard.Role.RESERVE:
				out.append("el grupo se repliega pero el bot %d conserva un rol de ataque" % id)
			if allows(id, BehaviorKind.Kind.ASSAULT) or allows(id, BehaviorKind.Kind.FLANK):
				out.append("el grupo se repliega pero el bot %d puede asaltar o flanquear" % id)
	for id: int in roles:
		if allows(id, BehaviorKind.Kind.ASSAULT) and not suppression_active:
			out.append("el bot %d tiene ASSAULT permitido sin supresión" % id)
		if allows(id, BehaviorKind.Kind.FLANK) and route_of(id) < 0:
			out.append("el bot %d tiene FLANK permitido sin ruta disjunta" % id)
	return out
