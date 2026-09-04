class_name CoverBaker
extends RefCounted
## Horneado de la nube de puntos de cobertura (GDD §8.3, ADR-004).
##
## Esto es lo que hace que un enemigo parezca inteligente. El legacy
## triangulaba para PODER navegar; aquí la geometría se usa además para
## DECIDIR DÓNDE PONERSE, que es una cosa completamente distinta y la que se
## nota jugando.
##
## Procedimiento: se muestrea el navmesh en una rejilla y, en cada punto, se
## lanzan rayos en 8 direcciones a dos alturas —pecho (1,1 m) y cabeza
## (1,6 m)— clasificando cada dirección como HIGH / LOW / NONE. Hacen falta
## las dos alturas porque una mesa cubre agachado y no de pie: con una sola
## altura, o los bots se esconden detrás de mesas creyéndose a salvo, o no
## usan las mesas nunca.
##
## Dentro de cada dirección y altura se lanzan varios rayos desplazados
## lateralmente (±media anchura de hombros). Eso es lo que distingue
## cobertura TOTAL de PARCIAL: si sólo se bloquean algunos, el bot asoma por
## un lado y la cobertura es baja.
##
## El horneado NO se recalcula en ejecución. Se guarda como `CoverPointCloud`
## y en ejecución sólo se consulta (`CoverProviderBaked`). Lo único que se
## rehornea es la zona afectada por una demolición (E-01), con `rebake_area`.
##
## El mundo llega por `WorldQuery`, no por `PhysicsDirectSpaceState3D`: así el
## horneado se prueba con geometría sintética descrita a mano, sin escena y
## sin física, que es exactamente la costura que pide la arquitectura.

const Tuning := preload("res://src/ai/navigation/nav_tuning.gd")
const Sampler := preload("res://src/ai/navigation/navmesh_sampler.gd")


## Parámetros del horneado. Todo lo que no se toque usa `NavTuning`.
class Options:
	extends RefCounted

	var map_id: StringName = &""
	var sample_spacing_m: float = Tuning.COVER_SAMPLE_SPACING_M
	var probe_distance_m: float = Tuning.COVER_PROBE_DISTANCE_M
	var lateral_offsets_m: Array[float] = Tuning.COVER_LATERAL_OFFSETS_M
	var collision_mask: int = Tuning.WORLD_COLLISION_MASK
	## Cajas de sala del mapa, para etiquetar cada punto. Opcional.
	var room_aabbs: Array[AABB] = []
	## Si es true, se guardan también los puntos sin ninguna cobertura. Por
	## defecto NO: un punto sin cobertura no es un punto de cobertura, y
	## guardarlos multiplica la nube por cuatro sin aportar nada.
	var keep_uncovered: bool = false


## Rayos lanzados en el último horneado. Sirve para dimensionar el coste.
var stat_rays: int = 0
## Puntos muestreados (incluidos los descartados por no cubrir nada).
var stat_sampled: int = 0


## Hornea la nube completa de un navmesh.
func bake(mesh: NavigationMesh, world: WorldQuery,
		options: Options = null) -> CoverPointCloud:
	var opts := options if options != null else Options.new()
	var cloud := CoverPointCloud.new()
	cloud.map_id = opts.map_id
	cloud.format_version = CoverPointCloud.FORMAT_VERSION
	cloud.baked_agent_radius_m = mesh.agent_radius
	cloud.baked_sample_spacing_m = opts.sample_spacing_m
	cloud.grid_cell_m = Tuning.COVER_GRID_CELL_M
	_bake_into(cloud, mesh, world, opts, AABB())
	cloud.rebuild_index()
	return cloud


## Rehornea sólo la zona afectada por un cambio de topología (E-01).
## Devuelve cuántos puntos hay en la nube tras la operación.
func rebake_area(cloud: CoverPointCloud, mesh: NavigationMesh, world: WorldQuery,
		area: AABB, options: Options = null) -> int:
	var opts := options if options != null else Options.new()
	cloud.remove_in_aabb(area)
	_bake_into(cloud, mesh, world, opts, area)
	cloud.rebuild_index()
	return cloud.size()


func _bake_into(cloud: CoverPointCloud, mesh: NavigationMesh, world: WorldQuery,
		opts: Options, area: AABB) -> void:
	stat_rays = 0
	stat_sampled = 0
	if mesh.get_polygon_count() == 0:
		return
	var lateral := opts.lateral_offsets_m
	if lateral.is_empty():
		lateral = [0.0] as Array[float]

	for position: Vector3 in Sampler.sample_grid(mesh, opts.sample_spacing_m, area):
		stat_sampled += 1
		var floor_y := _find_floor(world, position, opts.collision_mask)
		var chest := PackedByteArray()
		var head := PackedByteArray()
		var covers := false
		for sector in Tuning.DIRECTION_COUNT:
			var dir := Tuning.sector_direction(sector)
			var chest_ratio := _blocked_ratio(
				world, position, floor_y + Tuning.CHEST_HEIGHT_M, dir, lateral, opts)
			var head_ratio := _blocked_ratio(
				world, position, floor_y + Tuning.HEAD_HEIGHT_M, dir, lateral, opts)
			var chest_q := _classify_chest(chest_ratio)
			var head_q := _classify_head(chest_ratio, head_ratio)
			chest.append(int(chest_q))
			head.append(int(head_q))
			if chest_q != CoverProvider.Quality.NONE or head_q != CoverProvider.Quality.NONE:
				covers = true
		if not covers and not opts.keep_uncovered:
			continue
		cloud.append_point(position, chest, head, _room_of(position, opts.room_aabbs))


# ---------------------------------------------------------------------------
# Clasificación
# ---------------------------------------------------------------------------

## Calidad para un bot AGACHADO: sólo asoma hasta la altura de pecho, así que
## un obstáculo que llegue al pecho lo cubre entero.
static func _classify_chest(chest_ratio: float) -> CoverProvider.Quality:
	if chest_ratio >= Tuning.COVER_FULL_RATIO:
		return CoverProvider.Quality.HIGH
	if chest_ratio >= Tuning.COVER_PARTIAL_RATIO:
		return CoverProvider.Quality.LOW
	return CoverProvider.Quality.NONE


## Calidad para un bot DE PIE. Un muro que tapa cabeza y pecho es cobertura
## alta; una mesa que sólo tapa el pecho es cobertura baja —el bot está a
## medias, tiene que agacharse—; nada es nada.
static func _classify_head(chest_ratio: float,
		head_ratio: float) -> CoverProvider.Quality:
	if head_ratio >= Tuning.COVER_FULL_RATIO and chest_ratio >= Tuning.COVER_FULL_RATIO:
		return CoverProvider.Quality.HIGH
	if head_ratio >= Tuning.COVER_PARTIAL_RATIO or chest_ratio >= Tuning.COVER_FULL_RATIO:
		return CoverProvider.Quality.LOW
	return CoverProvider.Quality.NONE


## Fracción de rayos bloqueados en una dirección y a una altura.
func _blocked_ratio(world: WorldQuery, position: Vector3, height_y: float,
		dir: Vector3, lateral_offsets: Array[float],
		opts: Options) -> float:
	var side := dir.cross(Vector3.UP).normalized()
	var blocked := 0
	for offset: float in lateral_offsets:
		var origin := Vector3(position.x, height_y, position.z) + side * offset
		var target := origin + dir * opts.probe_distance_m
		stat_rays += 1
		if world.raycast(origin, target, opts.collision_mask).is_finite():
			blocked += 1
	return float(blocked) / float(lateral_offsets.size())


## Suelo real bajo el punto. El navmesh de Recast queda unas dos celdas por
## encima de la geometría; medir pecho y cabeza desde ahí mete 0,4 m de error,
## que es justo la diferencia entre una mesa y un muro bajo.
func _find_floor(world: WorldQuery, position: Vector3, mask: int) -> float:
	var from := position + Vector3.UP * Tuning.COVER_FLOOR_PROBE_UP_M
	var to := position - Vector3.UP * Tuning.COVER_FLOOR_PROBE_DOWN_M
	stat_rays += 1
	var hit := world.raycast(from, to, mask)
	if hit.is_finite():
		return hit.y
	return position.y


static func _room_of(position: Vector3, rooms: Array[AABB]) -> int:
	for i in rooms.size():
		if rooms[i].has_point(position):
			return i
	return -1
