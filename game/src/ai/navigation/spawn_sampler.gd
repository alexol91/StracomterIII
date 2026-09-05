class_name SpawnSampler
extends SpawnPointProvider
## Implementación real de `SpawnPointProvider` (GDD §7).
##
## REPARTO DE RESPONSABILIDADES, y es deliberado: aquí se TOCA EL MUNDO y se
## MIDE; el director decide. Este muestreador propone candidatos con sus datos
## medidos —navegable, distancia de CAMINO al jugador, línea de visión, si es
## un acceso real— y `SpawnPointProvider.is_fair` / `weight_of` / `select`, que
## son funciones puras y están probadas sin mundo, deciden cuáles valen.
##
## No hay aquí una segunda regla de justicia. Tenerla sería peor que no tener
## ninguna: dos reglas divergen en cuanto alguien toca una, y el fallo aparece
## como enemigos surgiendo donde no deben, en ejecución, sin que ninguna
## prueba lo vea.
##
## Lo que sí se corrige respecto al legacy es de dónde salen los candidatos.
## `Optimization::CargarEnemigos` (`Optimization.cc:144-168`) tomaba incentros
## de triángulos de la Delaunay con área ≥ 2000 px² y los aceptaba a más de
## 200 px del jugador —2,7 m a la escala del remake—, sin mirar cono de visión
## ni oclusión, y CONSUMÍA la iteración al descartar, así que aparecían menos
## enemigos de los calculados. Aquí los candidatos salen de una rejilla
## uniforme sobre el navmesh y descartar no gasta cupo.

## Separación de la rejilla de candidatos. Más gruesa que la de cobertura:
## aquí no hace falta resolución fina, hace falta cubrir el mapa.
## TODO(arquitecto): mover a datos.
const CANDIDATE_SPACING_M: float = 3.0
## Tope de candidatos a los que se les mide la distancia de CAMINO. El coste
## de camino es caro y esto es una operación del director, no de un bot: se
## acota explícitamente en lugar de competir por el techo de 4 peticiones por
## frame de ADR-002.
## TODO(arquitecto): mover a datos.
const MAX_MEASURED_CANDIDATES: int = 48

var _nav: NavService = null
var _world: WorldQuery = null
var _candidates: PackedVector3Array = PackedVector3Array()
var _access_points: PackedVector3Array = PackedVector3Array()
var _rng: RandomNumberGenerator = RandomNumberGenerator.new()

## Candidatos medidos en la última petición. Telemetría para la consola: si el
## director se queda sin sitios, esto dice cuántos llegó a mirar.
var stat_last_measured: int = 0
## Candidatos saltados por estar más cerca del jugador que el mínimo de la
## petición, sin llegar a medirles el camino.
var stat_last_skipped_near: int = 0


## `world` debe responder a la FÍSICA (`WorldQueryPhysics` o el compositor):
## es quien mide la línea de visión al jugador. Antes caía por defecto en el
## propio `NavService`, y desde que éste dejó de tener rayo eso habría
## significado "ningún candidato es visible" — es decir, apariciones a la vista
## del jugador dadas por buenas. Sin backend de física el muestreador se
## declara NO listo, que es la respuesta honesta.
func setup(nav: NavService, world: WorldQuery = null) -> void:
	_nav = nav
	_world = world


## Semilla del barajado de candidatos. Fijarla hace reproducible el muestreo,
## que es lo que permite reproducir una partida entera.
func set_rng(rng: RandomNumberGenerator) -> void:
	_rng = rng if rng != null else RandomNumberGenerator.new()


## Construye el conjunto de candidatos a partir del navmesh del nivel.
func build_candidates(mesh: NavigationMesh,
		spacing_m: float = CANDIDATE_SPACING_M) -> int:
	_candidates = NavmeshSampler.sample_grid(mesh, spacing_m)
	return _candidates.size()


func candidate_count() -> int:
	return _candidates.size()


## Accesos reales del mapa: puertas, huecos de escalera, ascensores. Un
## enemigo que sale por una puerta se lee como un refuerzo; uno que se
## materializa en mitad de una sala se lee como un fallo del motor.
func set_access_points(points: PackedVector3Array) -> void:
	_access_points = points


func access_point_count() -> int:
	return _access_points.size()


# ---------------------------------------------------------------------------
# SpawnPointProvider
# ---------------------------------------------------------------------------

func is_ready() -> bool:
	return _nav != null and _nav.is_ready() and _world != null \
		and not _candidates.is_empty()


## Accesos de una zona. El muestreador no distingue zonas todavía: los mapas
## convertidos no traen división por zonas (el conversor emite `Walls`,
## `Doors`, `Obstacles`, `Pickups` y `Spawns`, y nada más), así que se
## devuelven todos. Cuando exista la división se filtra aquí y en
## `build_candidates`, sin tocar el contrato.
func entry_points(_zone_id: int) -> PackedVector3Array:
	return _access_points


func path_distance(from: Vector3, to: Vector3) -> float:
	if _nav == null:
		return INF
	return _nav.path_cost_immediate(from, to)


## Candidatos MEDIDOS para una petición. No filtra por justicia: eso es del
## director (`SpawnPointProvider.is_fair`).
func sample_candidates(request: SpawnPointProvider.SpawnRequest
		) -> Array[SpawnPointProvider.SpawnCandidate]:
	var out: Array[SpawnPointProvider.SpawnCandidate] = []
	stat_last_measured = 0
	stat_last_skipped_near = 0
	if not is_ready():
		return out
	# Una petición sin perfil aplicado no produce apariciones. Medir el mundo
	# para una petición que el director va a rechazar entera es tirar consultas
	# de camino, y el criterio de "sin configurar, nada" es suyo.
	if not request.configured:
		return out

	for index: int in _shuffled_indices():
		if stat_last_measured >= MAX_MEASURED_CANDIDATES:
			break
		var position := _candidates[index]
		# Atajo de coste, no regla propia: usa EL MISMO `min_distance_m` de la
		# petición, así que no puede divergir de la regla del director. Sólo
		# evita gastar una consulta de camino en un punto que va a rechazar.
		if position.distance_to(request.player_position) < request.min_distance_m:
			stat_last_skipped_near += 1
			continue
		var candidate := SpawnPointProvider.SpawnCandidate.new(position)
		candidate.navigable = _nav.snap_to_navmesh(position).is_finite()
		candidate.path_distance_m = path_distance(request.player_position, position)
		candidate.has_line_of_sight_to_player = _has_line_of_sight_to_player(
			position, request.player_position)
		candidate.is_entry_point = _is_access(position)
		out.append(candidate)
		stat_last_measured += 1
	return out


# ---------------------------------------------------------------------------
# Accesos
# ---------------------------------------------------------------------------

## Recoge los accesos de una escena de mapa. Acepta la estructura del
## conversor (`Doors/Door_N` como `Marker3D` con `metadata/type = "door"`) y
## cualquier nodo `DoorNavLink`.
##
## Las transformadas se acumulan a mano en lugar de leer `global_position`:
## así funciona también con una escena INSTANCIADA PERO NO AÑADIDA AL ÁRBOL,
## que es como la miran las herramientas de horneado y las pruebas. Las
## coordenadas resultantes son relativas al espacio del padre de `root`.
static func collect_access_points(root: Node) -> PackedVector3Array:
	var out := PackedVector3Array()
	if root != null:
		_collect_access_into(out, root, Transform3D.IDENTITY)
	return out


static func _collect_access_into(out: PackedVector3Array, node: Node,
		parent_transform: Transform3D) -> void:
	var transform := parent_transform
	var spatial := node as Node3D
	if spatial != null:
		transform = parent_transform * spatial.transform
		if _is_access_node(spatial):
			out.append(transform.origin)
	for child: Node in node.get_children():
		_collect_access_into(out, child, transform)


static func _is_access_node(node: Node3D) -> bool:
	if node is DoorNavLink:
		return true
	# Una puerta YA MONTADA también es un acceso. `LevelLoader` sustituye los
	# marcadores del conversor por puertas de verdad en cuanto carga la planta,
	# y la sustitución no arrastra `metadata/type`: mirar solo la metadata
	# funcionaba con la escena recién instanciada y devolvía CERO accesos en
	# cuanto el nivel estaba montado, que es justo cuando se le pregunta.
	if node.is_in_group(&"doors"):
		return true
	if not node.has_meta(&"type"):
		return false
	var kind := StringName(str(node.get_meta(&"type")))
	return kind == &"door" or kind == &"stairs" or kind == &"elevator"


func _is_access(position: Vector3) -> bool:
	for access: Vector3 in _access_points:
		if access.distance_to(position) <= NavTuning.SPAWN_ACCESS_RADIUS_M:
			return true
	return false


func _has_line_of_sight_to_player(position: Vector3,
		player_position: Vector3) -> bool:
	if _world == null:
		# No debería ocurrir: `is_ready` lo impide. Se conserva porque decir
		# "hay visión" ante la duda descarta el candidato, y descartar de más
		# es el fallo barato; el caro es aparecer a la vista del jugador.
		return true
	var eye := player_position + Vector3.UP * NavTuning.SPAWN_EYE_HEIGHT_M
	var target := position + Vector3.UP * NavTuning.SPAWN_EYE_HEIGHT_M
	return _world.has_line_of_sight(eye, target, NavTuning.WORLD_COLLISION_MASK)


## Índices barajados. Barajar antes de recortar importa: sin ello el tope de
## mediciones miraría siempre la misma esquina del mapa (la primera de la
## rejilla) y los refuerzos saldrían siempre del mismo sitio.
func _shuffled_indices() -> PackedInt32Array:
	var order := PackedInt32Array()
	order.resize(_candidates.size())
	for i in _candidates.size():
		order[i] = i
	for i in range(order.size() - 1, 0, -1):
		var j := _rng.randi_range(0, i)
		var tmp := order[i]
		order[i] = order[j]
		order[j] = tmp
	return order
