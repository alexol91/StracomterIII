class_name SquadTestUtil
extends RefCounted
## Constructores de escenario de las pruebas de `ai/squad`.
##
## AVISO PARA QUIEN AÑADA PRUEBAS AQUÍ: viven en esta clase y no en los
## ficheros `test_*.gd` por un motivo medido, no por estilo. Un método
## declarado en un `TestCase` cuyo tipo de RETORNO es una clase de GDScript
## (`-> BotState`, `-> SquadDirector`) impide que Godot descargue ese script
## al cerrar, y la ejecución termina con "ObjectDB instances were leaked at
## exit" aunque todas las pruebas pasen. Los PARÁMETROS de ese tipo no dan
## problema. Verificado en 4.7.2; misma nota que en `NavTestUtil`.
##
## Regla práctica: en un `test_*.gd`, tipos de clase sólo en variables
## locales y en parámetros. Todo lo que devuelva un objeto del proyecto, aquí.

## Objetivo canónico de los escenarios de dos accesos.
const TARGET: Vector3 = Vector3(0.0, 0.0, 20.0)


# ---------------------------------------------------------------------------
# Instantáneas de bot
# ---------------------------------------------------------------------------

## Instantánea de un bot. Todo lo demás toma valores de "bot sano en combate":
## salud y munición llenas, sin cobertura, expuesto.
static func bot(bot_id: int, position: Vector3, squad_id: int = 1) -> BotState:
	var s := BotState.new()
	s.bot_id = bot_id
	s.squad_id = squad_id
	s.team = int(Character.Team.ENEMY)
	s.archetype = &"enemy_militiaman"
	s.position = position
	s.forward = Vector3.FORWARD
	s.health_ratio = 1.0
	s.ammo_ratio = 1.0
	s.exposure = 1.0
	s.distance_to_target_m = position.distance_to(TARGET)
	s.known_threat_count = 1
	s.target_confidence = 1.0
	return s


## Bot que ve al objetivo desde cobertura: el candidato natural a Fijador.
static func pinner_candidate(bot_id: int, position: Vector3, squad_id: int = 1) -> BotState:
	var s := bot(bot_id, position, squad_id)
	s.has_line_of_sight = true
	s.in_cover = true
	s.exposure = 0.2
	return s


## Bot libre de contacto: el candidato natural a Flanqueador.
static func flanker_candidate(bot_id: int, position: Vector3, squad_id: int = 1) -> BotState:
	var s := bot(bot_id, position, squad_id)
	s.has_line_of_sight = false
	s.in_cover = false
	s.exposure = 0.4
	return s


static func companion_state(
	bot_id: int, health_ratio: float, exposure: float, under_fire: bool
) -> BotState:
	var s := BotState.new()
	s.bot_id = bot_id
	s.squad_id = 0
	s.team = int(Character.Team.COMPANION)
	s.archetype = &"technician"
	s.position = Vector3.ZERO
	s.health_ratio = health_ratio
	s.ammo_ratio = 1.0
	s.exposure = exposure
	s.has_line_of_sight = under_fire
	s.known_threat_count = 1 if under_fire else 0
	return s


static func contact(target_id: int, position: Vector3, confidence: float = 1.0) -> Blackboard.Contact:
	var c := Blackboard.Contact.new()
	c.target_id = target_id
	c.team = int(Character.Team.PLAYER)
	c.last_known_position = position
	c.last_seen_msec = Time.get_ticks_msec()
	c.confidence = confidence
	return c


static func contacts_at(position: Vector3, confidence: float = 1.0) -> Array[Blackboard.Contact]:
	var out: Array[Blackboard.Contact] = []
	out.append(contact(99, position, confidence))
	return out


static func director(squad_id: int, roster_size: int) -> SquadDirector:
	return SquadDirector.new(squad_id, roster_size)


# ---------------------------------------------------------------------------
# Mundos sintéticos
# ---------------------------------------------------------------------------

## Ruta frontal: recta desde el grupo hasta el objetivo.
static func frontal_route() -> PackedVector3Array:
	return PackedVector3Array([Vector3.ZERO, Vector3(0.0, 0.0, 10.0), TARGET])


## Ruta de flanqueo por un lateral, a `side_x` metros del eje. Rodea de
## verdad: sale, avanza en paralelo y vuelve al objetivo.
static func flanking_route(side_x: float) -> PackedVector3Array:
	return PackedVector3Array([
		Vector3.ZERO,
		Vector3(side_x, 0.0, 5.0),
		Vector3(side_x, 0.0, 15.0),
		TARGET,
	])


## Dos accesos de verdad: una ruta frontal y un rodeo disjunto.
static func world_two_accesses() -> SquadFakeRoutes:
	var w := SquadFakeRoutes.new()
	w.routes = [frontal_route(), flanking_route(-8.0)]
	return w


## Un solo acceso: pasillo único. No hay flanqueo posible y el grupo NO debe
## inventarse uno.
static func world_single_access() -> SquadFakeRoutes:
	var w := SquadFakeRoutes.new()
	w.routes = [frontal_route()]
	return w


## Tres rutas, pero la segunda y la tercera van casi por el mismo sitio: el
## planificador ha devuelto dos variantes del mismo pasillo. Mandar un
## flanqueador por cada una es poner a dos bots en fila india.
static func world_duplicate_flank() -> SquadFakeRoutes:
	var w := SquadFakeRoutes.new()
	w.routes = [frontal_route(), flanking_route(-8.0), flanking_route(-8.6)]
	return w


## La ruta de flanqueo se corta a medio camino: el corredor no llega. Es lo
## que devuelve el motor cuando el destino no es alcanzable por ese lado.
static func world_partial_flank() -> SquadFakeRoutes:
	var w := SquadFakeRoutes.new()
	w.routes = [
		frontal_route(),
		PackedVector3Array([Vector3.ZERO, Vector3(-8.0, 0.0, 5.0), Vector3(-8.0, 0.0, 12.0)]),
	]
	return w


## Dos rodeos disjuntos, uno por cada lado: caben dos flanqueadores.
static func world_three_accesses() -> SquadFakeRoutes:
	var w := SquadFakeRoutes.new()
	w.routes = [frontal_route(), flanking_route(-8.0), flanking_route(8.0)]
	return w


# ---------------------------------------------------------------------------
# Medidas sobre un reparto
# ---------------------------------------------------------------------------

## Separación angular mínima entre las direcciones de vigilancia de dos bots
## cualesquiera del reparto. Con un solo bot devuelve TAU.
static func min_watch_separation(assignment: SquadRoleAssignment) -> float:
	var ids := assignment.bot_ids()
	if ids.size() < 2:
		return TAU
	var smallest := TAU
	for i in ids.size():
		for j in range(i + 1, ids.size()):
			var a: float = assignment.watch_yaw[ids[i]]
			var b: float = assignment.watch_yaw[ids[j]]
			smallest = minf(smallest, absf(wrapf(a - b, -PI, PI)))
	return smallest


## Roles del reparto como texto ordenado y comparable. Es lo que permite
## comprobar la igualdad de dos repartos sin depender del orden interno de
## los diccionarios.
static func roles_signature(assignment: SquadRoleAssignment) -> String:
	var parts: Array[String] = []
	for id: int in assignment.bot_ids():
		parts.append("%d=%d/%d" % [id, int(assignment.role_of(id)), assignment.route_of(id)])
	return ",".join(parts)


## Firma completa: roles, rutas y ángulos redondeados. Para determinismo
## estricto.
static func full_signature(assignment: SquadRoleAssignment) -> String:
	var parts: Array[String] = []
	for id: int in assignment.bot_ids():
		parts.append("%d=%d/%d/%.6f" % [
			id, int(assignment.role_of(id)), assignment.route_of(id),
			assignment.watch_yaw.get(id, 0.0),
		])
	parts.append("retreat=%s" % assignment.retreating)
	parts.append("rally=%.6f,%.6f" % [assignment.rally_point.x, assignment.rally_point.z])
	return ",".join(parts)


## Grupo de cuatro: un candidato claro a Fijador, uno a Flanqueador y dos sin
## rasgos que los inclinen a nada. Es el escenario de referencia de las
## pruebas de supresión y de reparto de ángulos.
static func squad_of_four() -> Array[BotState]:
	var states: Array[BotState] = [
		pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
		bot(30, Vector3(0.0, 0.0, 4.0)),
		bot(40, Vector3(0.0, 0.0, -4.0)),
	]
	return states


## Grupo de cinco, para probar repartos con reserva sobrante.
static func squad_of_five() -> Array[BotState]:
	var states := squad_of_four()
	states.append(bot(50, Vector3(3.0, 0.0, 1.0)))
	return states
