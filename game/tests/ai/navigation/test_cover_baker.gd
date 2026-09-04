extends TestCase
## Clasificación de cobertura sobre geometría sintética.
##
## Es la prueba que decide si la IA táctica sabe algo del mundo o se lo
## inventa. Un muro cubre en su dirección y no en la contraria; una mesa cubre
## agachado y no de pie. Si estas dos cosas no se cumplen, un bot se esconderá
## detrás de una mesa de pie y morirá pareciendo tonto.


## Sector 0 del contrato de `CoverProvider` = +X. Sector 4 = −X.
const SECTOR_EAST: int = 0
const SECTOR_WEST: int = 4

## Los muros de prueba se colocan a +2 m en X; el punto examinado, a +1,5 m.
const WALL_X: float = 2.4
const PROBE_X: float = 1.5
const WALL_THICKNESS_M: float = 0.4
const WALL_HEIGHT_M: float = 3.0
## Altura de mesa: por encima del pecho (1,1 m) y por debajo de la cabeza
## (1,6 m). Es justo el caso que obliga a hornear dos alturas.
const TABLE_HEIGHT_M: float = 1.2

var _fixture: NavTestUtil.Fixture = null


func after_each() -> void:
	if _fixture != null:
		_fixture.dispose()
		_fixture = null


func _bake_with(obstacle_height_m: float) -> CoverPointCloud:
	var boxes: Array[AABB] = [
		NavTestUtil.floor_box(10.0),
		NavTestUtil.slab_x(WALL_X, WALL_THICKNESS_M, obstacle_height_m, -3.0, 3.0),
	]
	_fixture = NavTestUtil.fixture(boxes)
	var baker := CoverBaker.new()
	var options := CoverBaker.Options.new()
	options.map_id = &"test_cover"
	return baker.bake(_fixture.mesh, _fixture.world, options)


func test_navmesh_horneado_no_esta_vacio() -> void:
	var cloud := _bake_with(WALL_HEIGHT_M)
	assert_gt(float(_fixture.mesh.get_polygon_count()), 0.0,
		"sin navmesh no hay nada que muestrear (¿bobinado de las caras?)")
	assert_gt(float(cloud.size()), 0.0, "la nube de cobertura salió vacía")


func test_muro_da_cobertura_alta_en_su_direccion_y_ninguna_en_la_opuesta() -> void:
	var cloud := _bake_with(WALL_HEIGHT_M)
	var index := NavTestUtil.nearest_point_index(cloud, Vector3(PROBE_X, 0.0, 0.0))
	assert_gt(float(index), -1.0, "no se horneó ningún punto junto al muro")
	if index < 0:
		return
	var position := cloud.position_at(index)
	assert_lt(position.distance_to(Vector3(PROBE_X, position.y, 0.0)), 0.9,
		"el punto más cercano al muro está demasiado lejos: %s" % position)

	assert_eq(cloud.head_quality(index, SECTOR_EAST), CoverProvider.Quality.HIGH,
		"de pie, un muro de 3 m debe ser cobertura ALTA hacia el muro")
	assert_eq(cloud.chest_quality(index, SECTOR_EAST), CoverProvider.Quality.HIGH,
		"agachado, un muro de 3 m debe ser cobertura ALTA hacia el muro")
	assert_eq(cloud.head_quality(index, SECTOR_WEST), CoverProvider.Quality.NONE,
		"en la dirección opuesta al muro no hay nada: debe ser NONE")
	assert_eq(cloud.chest_quality(index, SECTOR_WEST), CoverProvider.Quality.NONE,
		"en la dirección opuesta al muro no hay nada: debe ser NONE")


func test_mesa_cubre_agachado_pero_no_de_pie() -> void:
	var cloud := _bake_with(TABLE_HEIGHT_M)
	var index := NavTestUtil.nearest_point_index(cloud, Vector3(PROBE_X, 0.0, 0.0))
	assert_gt(float(index), -1.0, "no se horneó ningún punto junto a la mesa")
	if index < 0:
		return

	assert_eq(cloud.chest_quality(index, SECTOR_EAST), CoverProvider.Quality.HIGH,
		"agachado, una mesa de 1,2 m tapa entero: cobertura ALTA")
	var standing := cloud.head_quality(index, SECTOR_EAST)
	assert_true(standing != CoverProvider.Quality.HIGH,
		"de pie, una mesa NO puede ser cobertura alta (fue %d)" % int(standing))
	assert_eq(standing, CoverProvider.Quality.LOW,
		"de pie, con el pecho tapado y la cabeza al aire, la cobertura es BAJA")


func test_quality_against_usa_la_misma_convencion_de_sectores() -> void:
	# El contrato `CoverPoint.quality_against` calcula el sector con
	# atan2(dir.z, dir.x); el horneado usa NavTuning.sector_direction. Si las
	# dos fórmulas se desincronizan, la nube queda girada y NADA de la táctica
	# funciona, sin dar un solo error.
	var cloud := _bake_with(WALL_HEIGHT_M)
	var index := NavTestUtil.nearest_point_index(cloud, Vector3(PROBE_X, 0.0, 0.0))
	assert_gt(float(index), -1.0, "no se horneó ningún punto junto al muro")
	if index < 0:
		return
	var point := cloud.make_point(index)
	var east_threat := point.position + Vector3(10.0, 0.0, 0.0)
	var west_threat := point.position + Vector3(-10.0, 0.0, 0.0)
	assert_eq(point.quality_against(east_threat, false), CoverProvider.Quality.HIGH,
		"amenaza al este, muro al este: el punto cubre")
	assert_eq(point.quality_against(west_threat, false), CoverProvider.Quality.NONE,
		"amenaza al oeste, muro al este: el punto NO cubre")
	assert_eq(cloud.quality_against(index, east_threat, false),
		point.quality_against(east_threat, false),
		"la versión sin objeto de la nube debe coincidir con la del contrato")


func test_sin_geometria_no_se_hornea_ningun_punto() -> void:
	# Una explanada sin nada no tiene puntos de cobertura, y eso es correcto:
	# guardar los puntos descubiertos multiplicaría la nube sin aportar nada.
	_fixture = NavTestUtil.fixture([NavTestUtil.floor_box(10.0)] as Array[AABB])
	var baker := CoverBaker.new()
	var cloud := baker.bake(_fixture.mesh, _fixture.world)
	assert_gt(float(baker.stat_sampled), 0.0, "debería haber muestreado el suelo")
	assert_eq(cloud.size(), 0, "sin obstáculos no puede haber puntos de cobertura")


func test_rehorneado_parcial_solo_toca_la_zona_indicada() -> void:
	# Demolición del Explosivo (E-01): la topología cambia en una caja y sólo
	# esa caja se vuelve a muestrear.
	var cloud := _bake_with(WALL_HEIGHT_M)
	var before := cloud.size()
	assert_gt(float(before), 0.0, "la nube de partida no puede estar vacía")

	var area := AABB(Vector3(-1.0, -2.0, -1.5), Vector3(6.0, 6.0, 3.0))
	var inside_before := _count_in(cloud, area)
	assert_gt(float(inside_before), 0.0, "la zona elegida debía tener puntos")

	# Se quita el muro del mundo y se rehornea sólo esa zona.
	_fixture.world.boxes = [NavTestUtil.floor_box(10.0)] as Array[AABB]
	var baker := CoverBaker.new()
	baker.rebake_area(cloud, _fixture.mesh, _fixture.world, area)
	assert_eq(_count_in(cloud, area), 0,
		"quitado el muro, la zona rehorneada no debe conservar cobertura")
	assert_eq(cloud.size(), before - inside_before,
		"el rehorneado parcial no debe tocar los puntos de fuera de la zona")


func _count_in(cloud: CoverPointCloud, area: AABB) -> int:
	var count := 0
	for i in cloud.size():
		if area.has_point(cloud.position_at(i)):
			count += 1
	return count
