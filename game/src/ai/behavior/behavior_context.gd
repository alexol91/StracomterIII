class_name BehaviorContext
extends RefCounted
## Todo lo que un árbol de comportamiento necesita para ejecutarse, en un
## objeto inyectable.
##
## Separa tres cosas que no deben mezclarse:
##   * lo que el bot SABE          → `state` (instantánea) y la pizarra;
##   * lo que el bot puede PREGUNTAR → `world` (física y navegación) y `cover`;
##   * lo que el bot puede HACER    → `actuator`.
##
## Los cuatro son interfaces inyectables, y por eso un árbol entero se prueba
## sin escena: geometría descrita a mano, coberturas de mentira, actuador que
## sólo apunta lo que le mandan.
##
## Lo que este objeto NO hace: decidir. Aquí no hay una sola regla de
## comportamiento. Las órdenes de la escuadra (objetivo, punto de reunión,
## rol) entran como datos que rellena `ai-escuadra`; los puntos de patrulla y
## el último ruido, los rellena quien monta el bot con lo que le da
## `ai-percepcion`.

const BlackboardScript := preload("res://src/core/blackboard.gd")

# ---- Dependencias ----

## Instantánea del bot. La rellenan percepción y el cerebro; aquí sólo se lee.
var state: BotState = null
## Pizarra compartida de la escuadra. Puede ser el autoload o una propia.
var board: BlackboardScript = null
## Consultas al mundo: línea de visión, rutas, rutas disjuntas.
var world: WorldQuery = null
## Nube de puntos de cobertura horneada. NO se calcula cobertura aquí.
var cover: CoverProvider = null
## Cómo se le dan órdenes al cuerpo.
var actuator: BotActuator = null

# ---- Entradas de otros subsistemas ----

## A dónde quiere avanzar la escuadra. `Vector3.INF` = sin objetivo de grupo.
var objective: Vector3 = Vector3.INF
## Punto de reunión al replegarse. Lo fija `ai-escuadra`.
var rally_point: Vector3 = Vector3.INF
## Recorrido de patrulla. El legacy usaba los 3 vértices del triángulo de la
## triangulación donde aparecía el bot (`Enemy.cc:44-73`); aquí los pone quien
## coloca al bot en el nivel.
var patrol_points: PackedVector3Array = PackedVector3Array()
## Último ruido sin explicación visual, de `PerceptionSystem`.
var noise_position: Vector3 = Vector3.INF
## Antigüedad de ese ruido, en segundos.
var noise_age_s: float = INF

# ---- Derivado de la pizarra en cada decisión ----

## Última posición conocida del contacto de mayor confianza.
var target_position: Vector3 = Vector3.INF
## Posiciones conocidas de todas las amenazas. Es lo que se le pasa al
## `CoverProvider` para que puntúe cobertura frente a las de verdad.
var threats: Array[Vector3] = []

# ---- Memoria del árbol activo ----
# Se limpia entera al cambiar de comportamiento: un árbol no debe heredar el
# camino a medio recorrer de otro.

var move_goal: Vector3 = Vector3.INF
var move_path: PackedVector3Array = PackedVector3Array()
var move_index: int = 0
## Segundos esperando una ruta que el presupuesto de ADR-002 aún no ha
## despachado. Ver `BehaviorActions.move_along_path`.
var move_wait_s: float = 0.0
var cover_point: CoverProvider.CoverPoint = null
## Ruta de flanqueo reclamada en la pizarra. -1 = ninguna.
var claimed_route_id: int = -1
var scan_s: float = 0.0
var burst_s: float = 0.0
var reload_s: float = 0.0
var reload_start_ammo: float = 0.0
var patrol_index: int = 0
## Marca de que la última consulta de cobertura no encontró nada. Es lo que
## convierte "no hay dónde cubrirse" en "pues me retiro" un nivel más arriba.
var last_cover_query_empty: bool = false


func _init(
	p_state: BotState = null,
	p_world: WorldQuery = null,
	p_cover: CoverProvider = null,
	p_actuator: BotActuator = null,
	p_board: BlackboardScript = null
) -> void:
	state = p_state
	world = p_world
	cover = p_cover
	actuator = p_actuator
	board = p_board


## Refresca de la pizarra lo que cambia entre decisiones: dónde se cree que
## está el objetivo y dónde están las demás amenazas.
##
## Se llama en el tick de DECISIÓN (5 Hz), no en el de comportamiento (20 Hz):
## recorrer los contactos de la escuadra veinte veces por segundo por bot es
## justo el tipo de gasto que ADR-002 existe para evitar.
func refresh_from_board() -> void:
	target_position = Vector3.INF
	threats.clear()
	if board == null or state == null:
		return
	var best: Blackboard.Contact = null
	for contact: Blackboard.Contact in board.contacts_for(state.squad_id):
		if contact.team == state.team:
			continue
		threats.append(contact.last_known_position)
		if best == null or contact.confidence > best.confidence:
			best = contact
	if best != null:
		target_position = best.last_known_position


## Punto al que investigar: el ruido si es más reciente que el contacto, y si
## no la última posición conocida.
func investigation_point() -> Vector3:
	if is_finite_point(noise_position) and state != null \
			and noise_age_s < state.time_since_last_seen_s:
		return noise_position
	return target_position


func has_target() -> bool:
	return is_finite_point(target_position)


## Posición del cuerpo, o `Vector3.INF` si el actuador no tiene cuerpo.
func self_position() -> Vector3:
	if actuator == null:
		return Vector3.INF
	return actuator.position()


## Limpia la memoria del árbol. Se llama al activar un comportamiento nuevo.
## No suelta reclamaciones de la pizarra: eso lo hace `abort()` en las
## acciones, porque soltar una ruta es un efecto sobre el mundo compartido y
## no un simple olvido.
func reset_scratch() -> void:
	move_goal = Vector3.INF
	move_path = PackedVector3Array()
	move_index = 0
	move_wait_s = 0.0
	cover_point = null
	scan_s = 0.0
	burst_s = 0.0
	reload_s = 0.0
	reload_start_ammo = 0.0
	last_cover_query_empty = false


## Problemas del montaje, en texto legible. Vacío = el árbol puede trabajar.
##
## Existe por lo mismo que el equivalente de percepción: un contexto a medio
## enlazar no falla, DEGRADA. Un bot sin `CoverProvider` no se cubre nunca y
## uno sin actuador no hace nada; ninguna de las dos cosas da un error por sí
## sola, así que se pregunta explícitamente al arrancar.
func problems() -> Array[String]:
	var out: Array[String] = []
	if state == null:
		out.append("sin BotState: no hay nada que decidir")
	if actuator == null:
		out.append("sin BotActuator: el bot no podría moverse ni disparar")
	elif not actuator.is_embodied():
		out.append("el actuador no está enlazado a un cuerpo: position() es INF")
	if world == null:
		out.append("sin WorldQuery: no hay línea de visión ni rutas")
	else:
		var composite := world as WorldQueryComposite
		if composite != null and not composite.is_complete():
			if composite.physics == null:
				out.append("WorldQuery sin física: el bot no vería para disparar")
			if composite.navigation == null:
				out.append("WorldQuery sin navegación: el bot no sabría llegar")
	if cover == null:
		out.append("sin CoverProvider: el bot no buscaría cobertura nunca")
	elif cover.point_count() <= 0:
		out.append("la nube de cobertura está vacía: el nivel no se ha horneado")
	if board == null:
		out.append("sin pizarra: no hay contactos, roles ni supresión")
	return out


## ¿Es un punto real y no el `Vector3.INF` que este subsistema usa como "no
## hay"? `is_finite` sobre las tres componentes, sin atajos: comparar contra
## `Vector3.INF` con `==` falla en cuanto una sola componente es finita.
static func is_finite_point(point: Vector3) -> bool:
	return is_finite(point.x) and is_finite(point.y) and is_finite(point.z)
