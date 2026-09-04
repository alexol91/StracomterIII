class_name NavTuning
extends RefCounted
## Constantes de sintonización de la navegación y la táctica espacial.
##
## ADR-005 dice que ningún número de juego vive en el código. Estos todavía
## viven aquí porque no existe un recurso de datos que los albergue: no hay
## `NavProfile`/`CoverProfile` en `src/data/`, y `Balance` no sirve nada de
## navegación. Están centralizados en un único fichero, con nombre, unidad y
## justificación, precisamente para que moverlos a `.tres` sea un solo cambio.
##
## Todo lo marcado con `# TODO(arquitecto): mover a datos` es un valor de
## balanceo, no una constante estructural. `DIRECTION_COUNT = 8` o
## `SECTOR_ANGLE` no son balanceo: son el contrato de `CoverProvider`.

# ---------------------------------------------------------------------------
# Agente y horneado del navmesh
# ---------------------------------------------------------------------------

## Radio del agente. El legacy usaba `Core::Radius = 30` unidades y expandía
## la geometría a mano (§5.2 del análisis); aquí lo hace Recast.
## 30 · LEGACY_TO_METERS (1/75) = 0,4 m.
const AGENT_RADIUS_M: float = 0.4
## Altura del personaje de pie.
const AGENT_HEIGHT_M: float = 1.8
## Escalón máximo. Múltiplo exacto de CELL_HEIGHT_M para que Recast no avise
## de pérdida de precisión.
const AGENT_MAX_CLIMB_M: float = 0.4
## Pendiente máxima caminable, en grados.
const AGENT_MAX_SLOPE_DEG: float = 45.0
## Debe coincidir con `navigation/3d/default_cell_size` de project.godot.
const CELL_SIZE_M: float = 0.2
## Debe coincidir con `navigation/3d/default_cell_height` de project.godot.
const CELL_HEIGHT_M: float = 0.2

## Capa física de la geometría del mundo (project.godot: 3d_physics/layer_1).
const WORLD_COLLISION_MASK: int = 1

# ---------------------------------------------------------------------------
# Rutas y caché
# ---------------------------------------------------------------------------

## Distancia máxima a la que se acepta que un punto "pertenece" al navmesh.
## Por encima, `snap_to_navmesh` devuelve INF en lugar de mentir.
## TODO(arquitecto): mover a datos.
const NAVMESH_SNAP_TOLERANCE_M: float = 1.5
## Arista de la rejilla de redondeo de la clave de caché de caminos. Dos
## peticiones que caen en la misma celda de origen y destino comparten ruta.
## TODO(arquitecto): mover a datos.
const PATH_CACHE_CELL_M: float = 0.5
## Entradas máximas de la caché de caminos antes de purgar las más antiguas.
## TODO(arquitecto): mover a datos.
const PATH_CACHE_MAX_ENTRIES: int = 512
## Longitud máxima de la cola de peticiones de camino pendientes. Por encima
## se descartan las más antiguas: un bot que lleva 5 s esperando una ruta ya
## ha cambiado de comportamiento.
## TODO(arquitecto): mover a datos.
const PATH_QUEUE_MAX: int = 64

# ---------------------------------------------------------------------------
# Rutas disjuntas (flanqueo)
# ---------------------------------------------------------------------------

## Rutas alternativas máximas que se calculan de una vez.
## TODO(arquitecto): mover a datos.
const ROUTE_MAX_ROUTES: int = 4
## Tope de polígonos explorados por búsqueda, para acotar el coste en mapas
## grandes. Un mapa de planta de la Torre ronda los 2 000 polígonos.
## TODO(arquitecto): mover a datos.
const ROUTE_MAX_EXPANSIONS: int = 4096
## Margen (en polígonos) alrededor de origen y destino que NO se excluye al
## buscar la siguiente ruta: las rutas comparten forzosamente los extremos.
## TODO(arquitecto): mover a datos.
const ROUTE_ENDPOINT_KEEP_RADIUS_M: float = 2.5
## Separación mínima entre dos rutas para considerarlas disjuntas al
## verificarlas. Por debajo comparten tramo aunque no compartan polígono.
## TODO(arquitecto): mover a datos.
const ROUTE_DISJOINT_CLEARANCE_M: float = 1.5

# ---------------------------------------------------------------------------
# Horneado de la nube de cobertura
# ---------------------------------------------------------------------------

## Direcciones muestreadas por punto. Es el contrato de `CoverProvider`
## (`quality_against` divide TAU en 8 sectores): NO es un valor de balanceo.
const DIRECTION_COUNT: int = 8
## Altura de pecho. Un bot agachado asoma hasta aquí.
const CHEST_HEIGHT_M: float = 1.1
## Altura de cabeza. Un bot de pie asoma hasta aquí.
const HEAD_HEIGHT_M: float = 1.6
## Alcance de los rayos de sondeo. Más allá de esto el obstáculo ya no es
## "esta cobertura", es "otra parte del mapa".
## TODO(arquitecto): mover a datos.
const COVER_PROBE_DISTANCE_M: float = 2.0
## Desplazamientos laterales de los rayos dentro de cada dirección. Sirven
## para distinguir cobertura TOTAL de PARCIAL: si sólo se tapan algunos, el
## bot asoma por un lado. ±0,35 m ≈ media anchura de hombros.
## TODO(arquitecto): mover a datos.
const COVER_LATERAL_OFFSETS_M: Array[float] = [-0.35, 0.0, 0.35]
## Separación de la rejilla de muestreo del navmesh.
## TODO(arquitecto): mover a datos.
const COVER_SAMPLE_SPACING_M: float = 1.5
## Fracción de rayos laterales bloqueados para considerar cobertura total.
const COVER_FULL_RATIO: float = 0.999
## Fracción mínima para considerar cobertura parcial.
## TODO(arquitecto): mover a datos.
const COVER_PARTIAL_RATIO: float = 0.34
## Altura sobre el punto desde la que se busca el suelo real. El navmesh de
## Recast queda ~2 celdas por encima de la geometría, así que medir las
## alturas de pecho y cabeza desde el punto del navmesh introduce 0,4 m de
## error — suficiente para confundir una mesa con un muro.
const COVER_FLOOR_PROBE_UP_M: float = 0.6
## Profundidad de la búsqueda de suelo bajo el punto.
const COVER_FLOOR_PROBE_DOWN_M: float = 2.5

# ---------------------------------------------------------------------------
# Índice espacial y consulta de cobertura
# ---------------------------------------------------------------------------

## Arista de la celda del índice espacial. Debe ser mayor que
## COVER_SAMPLE_SPACING_M para que cada celda contenga varios puntos.
## TODO(arquitecto): mover a datos.
const COVER_GRID_CELL_M: float = 4.0
## Radio de búsqueda de candidatos alrededor del bot. Es lo que hace que la
## consulta no escale con el tamaño de la nube.
## TODO(arquitecto): mover a datos.
const COVER_SEARCH_RADIUS_M: float = 20.0
## Tope de candidatos que se puntúan en una consulta. El índice los recoge en
## anillos, así que los descartados son siempre los más lejanos. Sin tope, un
## radio de 20 m sobre una nube densa devuelve ~500 candidatos y la consulta
## se va a milisegundos.
## TODO(arquitecto): mover a datos.
const COVER_MAX_CANDIDATES: int = 96
## Radio máximo al que se busca un punto horneado para estimar la exposición
## de una posición arbitraria.
## TODO(arquitecto): mover a datos.
const EXPOSURE_SNAP_RADIUS_M: float = 2.0

## Peso de cada calidad de cobertura al puntuar. HIGH protege del todo,
## LOW a medias, NONE nada.
const QUALITY_WEIGHT_HIGH: float = 1.0
const QUALITY_WEIGHT_LOW: float = 0.5
const QUALITY_WEIGHT_NONE: float = 0.0
## Protección mínima para contar como "cubierto frente a esta amenaza". Por
## debajo, la amenaza pasa a sumar en el término de exposición.
## TODO(arquitecto): mover a datos.
const COVER_EFFECTIVE_PROTECTION: float = 0.5

## Pesos de la puntuación del GDD §8.3:
##   protección − exposición − coste de camino + progreso
## TODO(arquitecto): mover a datos.
const SCORE_PROTECTION_WEIGHT: float = 1.0
## La exposición pesa más que la protección: morir es peor que estar cómodo.
## TODO(arquitecto): mover a datos.
const SCORE_EXPOSURE_WEIGHT: float = 1.3
## TODO(arquitecto): mover a datos.
const SCORE_PATH_COST_WEIGHT: float = 0.45
## TODO(arquitecto): mover a datos.
const SCORE_PROGRESS_WEIGHT: float = 0.6
## Distancia con la que se normalizan coste y progreso a 0..1.
## TODO(arquitecto): mover a datos.
const SCORE_REFERENCE_DISTANCE_M: float = 20.0
## Cuántos candidatos por encima de K se refinan con coste de camino REAL.
## El resto se ordena con distancia euclídea: pedir un camino por candidato
## reventaría el techo de 4 peticiones por frame (ADR-002).
## TODO(arquitecto): mover a datos.
const SCORE_REFINE_FACTOR: int = 3

# ---------------------------------------------------------------------------
# Aparición de enemigos (GDD §7)
# ---------------------------------------------------------------------------

## Distancia mínima al jugador. El legacy usaba 200 u ≈ 2,7 m y los enemigos
## aparecían en la cara del jugador (`Optimization.cc:152`).
## TODO(arquitecto): mover a datos.
const SPAWN_MIN_PLAYER_DISTANCE_M: float = 12.0
## Semiángulo del cono de visión del jugador dentro del cual NO se aparece.
## Es más ancho que el FOV de cámara a propósito: aparecer justo fuera del
## encuadre y entrar en él al segundo siguiente se lee igual de tramposo.
## TODO(arquitecto): mover a datos.
const SPAWN_PLAYER_CONE_HALF_ANGLE_DEG: float = 70.0
## Distancia de camino por encima de la cual un punto deja de ser útil: el
## enemigo tardaría tanto en llegar que el encuentro ya habría terminado.
## TODO(arquitecto): mover a datos.
const SPAWN_MAX_PATH_DISTANCE_M: float = 70.0
## Multiplicador de peso para accesos reales (puertas, escaleras, ascensor)
## frente a un punto suelto en mitad de una sala.
## TODO(arquitecto): mover a datos.
const SPAWN_ACCESS_POINT_BONUS: float = 4.0
## Separación mínima entre dos puntos de aparición del mismo lote.
## TODO(arquitecto): mover a datos.
const SPAWN_MIN_SEPARATION_M: float = 2.0
## Radio alrededor de un acceso dentro del cual un candidato "es" ese acceso.
## TODO(arquitecto): mover a datos.
const SPAWN_ACCESS_RADIUS_M: float = 3.0
## Altura a la que se comprueba la línea de visión del jugador al candidato.
const SPAWN_EYE_HEIGHT_M: float = 1.6

# ---------------------------------------------------------------------------
# Puertas
# ---------------------------------------------------------------------------

## Fundido de apertura/cierre del legacy (`Door.cc:103,108`: 1000 ms). La
## navegación NO lo aplica —una puerta que se está abriendo no es transitable
## y una que se está cerrando deja de serlo ya—; se conserva aquí para que
## `gameplay/` tenga un único sitio de donde leerlo.
## TODO(arquitecto): mover a datos.
const DOOR_TRANSITION_S: float = 1.0


## Peso de una calidad de cobertura. Se usa en la puntuación y en la
## estimación de exposición.
static func quality_weight(quality: CoverProvider.Quality) -> float:
	match quality:
		CoverProvider.Quality.HIGH:
			return QUALITY_WEIGHT_HIGH
		CoverProvider.Quality.LOW:
			return QUALITY_WEIGHT_LOW
		_:
			return QUALITY_WEIGHT_NONE


## Dirección del mundo correspondiente al sector `index` del contrato de
## `CoverProvider`. Debe ser la inversa exacta de `CoverPoint.quality_against`:
##   sector = round(atan2(dir.z, dir.x) / (TAU / 8)) mod 8
static func sector_direction(index: int) -> Vector3:
	var angle := float(index) * (TAU / float(DIRECTION_COUNT))
	return Vector3(cos(angle), 0.0, sin(angle))


## Configura un `NavigationMesh` con los parámetros del agente del juego.
static func configure_navigation_mesh(mesh: NavigationMesh) -> void:
	mesh.agent_radius = AGENT_RADIUS_M
	mesh.agent_height = AGENT_HEIGHT_M
	mesh.agent_max_climb = AGENT_MAX_CLIMB_M
	mesh.agent_max_slope = AGENT_MAX_SLOPE_DEG
	mesh.cell_size = CELL_SIZE_M
	mesh.cell_height = CELL_HEIGHT_M
