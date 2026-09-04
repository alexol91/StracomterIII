class_name CoverPointCloud
extends Resource
## Nube de puntos de cobertura horneada, serializable.
##
## Se guarda como arrays empaquetados y no como array de objetos: 2 000
## puntos × 16 direcciones son 32 000 valores, y un `Array[CoverPoint]` en
## `.tres` los escribe como 2 000 sub-recursos. Aquí son tres arrays.
##
## DÓNDE SE GUARDA (decisión, no accidente):
##   * `res://src/ai/navigation/baked/<map_id>.cover.tres` para los mapas que
##     se distribuyen con el juego. Es contenido derivado pero determinista, y
##     versionarlo evita hornear 26 mapas en cada arranque. No va en
##     `game/maps/` porque esa carpeta es del conversor de mapas.
##   * `user://cover/<map_id>.cover.tres` para lo que se hornea en ejecución:
##     niveles procedurales y re-horneados tras una demolición (E-01). Ahí no
##     hay repositorio que valga.
##
## El índice espacial NO se serializa: se reconstruye al cargar. Es más rápido
## que leerlo y no puede quedar desincronizado con los puntos.


## Sube cuando cambia el formato o el significado de las calidades. Un
## `.tres` con versión distinta se considera caducado y hay que rehornearlo.
const FORMAT_VERSION: int = 1

@export var map_id: StringName = &""
@export var format_version: int = FORMAT_VERSION
## Parámetros con los que se horneó, para poder detectar que ya no valen.
@export var baked_agent_radius_m: float = NavTuning.AGENT_RADIUS_M
@export var baked_sample_spacing_m: float = NavTuning.COVER_SAMPLE_SPACING_M
@export var grid_cell_m: float = NavTuning.COVER_GRID_CELL_M

@export var positions: PackedVector3Array = PackedVector3Array()
## 8 bytes por punto: calidad por sector a altura de PECHO (bot agachado).
@export var chest_qualities: PackedByteArray = PackedByteArray()
## 8 bytes por punto: calidad por sector a altura de CABEZA (bot de pie).
@export var head_qualities: PackedByteArray = PackedByteArray()
## Sala a la que pertenece cada punto, o -1. Lo usa la prueba de integración
## de los 26 mapas ("al menos un punto de cobertura por sala").
@export var room_ids: PackedInt32Array = PackedInt32Array()

## Rejilla espacial: celda -> índices de punto. No se serializa.
var _grid: Dictionary[Vector2i, PackedInt32Array] = {}
var _grid_dirty: bool = true

## Puntos examinados en la última consulta al índice. Es la medida objetiva
## de que la búsqueda no es lineal: con densidad constante debe quedarse
## plana aunque la nube crezca de 1 000 a 10 000 puntos.
var stat_last_candidates: int = 0


func size() -> int:
	return positions.size()


func is_empty() -> bool:
	return positions.is_empty()


func clear() -> void:
	positions = PackedVector3Array()
	chest_qualities = PackedByteArray()
	head_qualities = PackedByteArray()
	room_ids = PackedInt32Array()
	_grid.clear()
	_grid_dirty = true


## Añade un punto. `chest` y `head` deben tener DIRECTION_COUNT elementos.
func append_point(position: Vector3, chest: PackedByteArray,
		head: PackedByteArray, room_id: int = -1) -> void:
	assert(chest.size() == NavTuning.DIRECTION_COUNT)
	assert(head.size() == NavTuning.DIRECTION_COUNT)
	positions.append(position)
	chest_qualities.append_array(chest)
	head_qualities.append_array(head)
	room_ids.append(room_id)
	_grid_dirty = true


func position_at(index: int) -> Vector3:
	return positions[index]


func room_at(index: int) -> int:
	if index < 0 or index >= room_ids.size():
		return -1
	return room_ids[index]


func chest_quality(index: int, sector: int) -> CoverProvider.Quality:
	return chest_qualities[index * NavTuning.DIRECTION_COUNT + sector] as CoverProvider.Quality


func head_quality(index: int, sector: int) -> CoverProvider.Quality:
	return head_qualities[index * NavTuning.DIRECTION_COUNT + sector] as CoverProvider.Quality


## Construye el objeto del contrato `CoverProvider.CoverPoint` para un índice.
## Sólo se hace con los K resultados de una consulta, nunca con la nube entera.
func make_point(index: int) -> CoverProvider.CoverPoint:
	var point := CoverProvider.CoverPoint.new()
	point.position = positions[index]
	var chest: Array[CoverProvider.Quality] = []
	var head: Array[CoverProvider.Quality] = []
	var base := index * NavTuning.DIRECTION_COUNT
	for s in NavTuning.DIRECTION_COUNT:
		chest.append(chest_qualities[base + s] as CoverProvider.Quality)
		head.append(head_qualities[base + s] as CoverProvider.Quality)
	point.chest = chest
	point.head = head
	return point


## Calidad frente a una amenaza, sin construir el objeto. Misma convención de
## sectores que `CoverProvider.CoverPoint.quality_against`.
func quality_against(index: int, threat_position: Vector3,
		crouched: bool) -> CoverProvider.Quality:
	var dir := threat_position - positions[index]
	dir.y = 0.0
	if dir.length_squared() < 0.0001:
		return CoverProvider.Quality.NONE
	var sector := sector_of(dir)
	return chest_quality(index, sector) if crouched else head_quality(index, sector)


## Sector de una dirección. Réplica exacta de la fórmula del contrato.
static func sector_of(dir: Vector3) -> int:
	var angle := atan2(dir.z, dir.x)
	var sector := int(roundf(angle / (TAU / float(NavTuning.DIRECTION_COUNT)))) % NavTuning.DIRECTION_COUNT
	if sector < 0:
		sector += NavTuning.DIRECTION_COUNT
	return sector


# ---------------------------------------------------------------------------
# Índice espacial
# ---------------------------------------------------------------------------

func rebuild_index() -> void:
	_grid.clear()
	var cell := maxf(grid_cell_m, 0.5)
	for i in positions.size():
		var key := _cell_of(positions[i], cell)
		if not _grid.has(key):
			_grid[key] = PackedInt32Array()
		_grid[key].append(i)
	_grid_dirty = false


func index_cell_count() -> int:
	if _grid_dirty:
		rebuild_index()
	return _grid.size()


## Índices de los puntos dentro de `radius_m` de `center`.
##
## Recorre las celdas en ANILLOS crecientes alrededor del centro y sólo las que
## la esfera toca. Con densidad de muestreo fija, el número de candidatos
## depende del RADIO y no del tamaño de la nube: eso es lo que hace que la
## consulta no escale linealmente.
##
## `max_count` corta la recogida en cuanto hay suficientes. El orden por
## anillos es lo que hace que ese corte sea honesto: los que se quedan fuera
## son los MÁS LEJANOS, no los que tocara la rejilla en último lugar. Sin el
## corte, un radio de 20 m sobre una nube densa devuelve ~500 candidatos y
## puntuarlos todos cuesta milisegundos — demasiado para 40 bots aunque sólo
## se consulte al cambiar de comportamiento (ADR-002).
func indices_near(center: Vector3, radius_m: float,
		max_count: int = 0) -> PackedInt32Array:
	if _grid_dirty:
		rebuild_index()
	var out := PackedInt32Array()
	stat_last_candidates = 0
	var cell := maxf(grid_cell_m, 0.5)
	var radius_sq := radius_m * radius_m
	var span := int(ceilf(radius_m / cell))
	var origin := _cell_of(center, cell)
	for ring in range(span + 1):
		for dx in range(-ring, ring + 1):
			for dz in range(-ring, ring + 1):
				# Sólo el borde del anillo; el interior ya se recorrió.
				if ring > 0 and absi(dx) != ring and absi(dz) != ring:
					continue
				var key := Vector2i(origin.x + dx, origin.y + dz)
				if not _grid.has(key):
					continue
				for i: int in _grid[key]:
					stat_last_candidates += 1
					if positions[i].distance_squared_to(center) <= radius_sq:
						out.append(i)
		if max_count > 0 and out.size() >= max_count:
			break
	return out


## Índice del punto horneado más cercano, o -1 si no hay ninguno dentro del
## radio. Búsqueda en anillos crecientes: no recorre la nube.
func nearest_index(point: Vector3, max_radius_m: float) -> int:
	if _grid_dirty:
		rebuild_index()
	var cell := maxf(grid_cell_m, 0.5)
	var max_span := int(ceilf(max_radius_m / cell))
	var origin := _cell_of(point, cell)
	var best := -1
	var best_d := max_radius_m * max_radius_m
	stat_last_candidates = 0
	for ring in range(max_span + 1):
		var found_in_ring := false
		for dx in range(-ring, ring + 1):
			for dz in range(-ring, ring + 1):
				# Sólo el borde del anillo; el interior ya se miró.
				if ring > 0 and absi(dx) != ring and absi(dz) != ring:
					continue
				var key := Vector2i(origin.x + dx, origin.y + dz)
				if not _grid.has(key):
					continue
				for i: int in _grid[key]:
					stat_last_candidates += 1
					var d := positions[i].distance_squared_to(point)
					if d < best_d:
						best_d = d
						best = i
						found_in_ring = true
		# Un punto hallado en el anillo r puede estar batido por otro del
		# anillo r+1, pero no por ninguno más lejos.
		if found_in_ring and ring > 0:
			break
	return best


static func _cell_of(p: Vector3, cell: float) -> Vector2i:
	return Vector2i(floori(p.x / cell), floori(p.z / cell))


# ---------------------------------------------------------------------------
# Persistencia
# ---------------------------------------------------------------------------

## Elimina los puntos contenidos en una AABB. Lo usa el re-horneado parcial
## tras una demolición (E-01) antes de volver a muestrear esa zona.
func remove_in_aabb(aabb: AABB) -> int:
	var kept_positions := PackedVector3Array()
	var kept_chest := PackedByteArray()
	var kept_head := PackedByteArray()
	var kept_rooms := PackedInt32Array()
	var removed := 0
	for i in positions.size():
		if aabb.has_point(positions[i]):
			removed += 1
			continue
		kept_positions.append(positions[i])
		var base := i * NavTuning.DIRECTION_COUNT
		kept_chest.append_array(chest_qualities.slice(base, base + NavTuning.DIRECTION_COUNT))
		kept_head.append_array(head_qualities.slice(base, base + NavTuning.DIRECTION_COUNT))
		kept_rooms.append(room_ids[i])
	positions = kept_positions
	chest_qualities = kept_chest
	head_qualities = kept_head
	room_ids = kept_rooms
	_grid_dirty = true
	return removed


## Ruta canónica del recurso horneado de un mapa distribuido con el juego.
static func bundled_path(id: StringName) -> String:
	return "res://src/ai/navigation/baked/%s.cover.tres" % id


## Ruta del recurso horneado en ejecución (procedural o re-horneado).
static func user_path(id: StringName) -> String:
	return "user://cover/%s.cover.tres" % id


func save_to(path: String) -> Error:
	var dir := path.get_base_dir()
	if dir.begins_with("user://"):
		DirAccess.make_dir_recursive_absolute(dir)
	return ResourceSaver.save(self, path)


## Carga una nube y reconstruye su índice. Devuelve null si no existe o si el
## formato ha caducado: mejor rehornear que servir datos que ya no significan
## lo mismo.
static func load_from(path: String) -> CoverPointCloud:
	if not ResourceLoader.exists(path):
		return null
	var cloud := ResourceLoader.load(path) as CoverPointCloud
	if cloud == null:
		return null
	if cloud.format_version != FORMAT_VERSION:
		return null
	cloud.rebuild_index()
	return cloud
