extends TestCase
## Integración: los 26 mapas convertidos, uno por uno.
##
## Comprueba lo que el GDD §12 pide de la navegación en cada planta:
##   * el navmesh se hornea y NO sale vacío,
##   * las zonas están conectadas (una sola componente jugable a ras de suelo),
##   * hay al menos un punto de cobertura por sala.
##
## "Sala" se aproxima por COMPONENTE CONEXA del navmesh con área suficiente:
## los mapas convertidos no traen metadatos de sala (el conversor emite
## `Walls`, `Doors`, `Obstacles`, `Pickups` y `Spawns`, y nada más). Es una
## aproximación conservadora y honesta: una zona cerrada sin un solo punto de
## cobertura es una ratonera, y esta prueba la caza. Cuando el conversor emita
## cajas de sala, esto pasa a usarlas sin cambiar el criterio.
##
## POR QUÉ SE LEE LA GEOMETRÍA A MANO Y NO SE INSTANCIA LA ESCENA EN EL ÁRBOL:
## las pruebas corren dentro del `_ready` del ejecutor, y ahí `add_child` sobre
## la raíz falla; `parse_source_geometry_data` exige que el nodo esté en el
## árbol; y el `_ready` de `_legacy_floor_mesh.gd` crea su colisión con
## `add_child`, que tampoco puede correr. Así que el horneado parte de las
## propiedades exportadas por el conversor, que son texto plano y
## deterministas. En el juego real, con el nivel dentro del árbol, se usa
## `NavService.bake_region_from_scene`.

const MAPS_DIR: String = "res://maps/legacy/"
## Prototipos "formato 2011" que el propio conversor marca como defectuosos:
## su spawn de jugador cae sobre el borde de un muro en el XML original de
## 2012 y no forman parte de la tabla de plantas. Se excluyen por nombre y no
## bajando el umbral para todos: un umbral relajado esconde el próximo mapa
## roto de verdad.
const BROKEN_PROTOTYPES: Array[String] = ["map_01.tscn", "map_02.tscn"]

## Mapas donde NO puede existir cobertura, con el motivo medido de cada uno.
## Se les sigue exigiendo navmesh y región —eso sí lo cumplen—, pero no puntos
## de cobertura. Es una exención nombrada y justificada caso a caso, no un
## umbral relajado: bajar el listón para todos convertiría una excepción
## concreta en una regla laxa que escondería el próximo mapa roto de verdad.
const NO_COVER_POSSIBLE: Dictionary[String, String] = {
	# 17 m² navegables repartidos en retales y sin spawn de jugador: no hay
	# sala que cubrir.
	"map_03.tscn": "prototipo degenerado",
	# Banco de pruebas de movimiento de 2012: 198 m² de explanada, cero muros
	# interiores. Sin geometría no hay nada de lo que cubrirse, y no está en la
	# tabla de plantas.
	"pruebasMov.tscn": "sin muros interiores: no existe cobertura posible",
}

## CUARENTENA DE CONECTIVIDAD. Mapas cuyo navmesh horneado con Recast queda
## partido en zonas entre las que `NavigationServer3D` no encuentra ruta.
##
## HISTORIA, porque costó encontrarla y conviene no repetirla. Esta lista tuvo
## cuatro entradas, con `finalMap` —la planta 8— al 46 %. El diagnóstico
## descartó lo obvio: no era resolución ni radio (con `cell_size` 0,2 -> 0,1 y
## `agent_radius` 0,4 -> 0,25 salían las MISMAS áreas por componente), no eran
## las puertas (13 de 14 se cruzaban), y no era el grafo de polígonos de
## `RoutePlanner` (`map_get_path` tampoco encontraba ruta). Las costuras medían
## grosor de muro + 2 × radio de agente: muro continuo, sin hueco. Era
## geometría, y el conversor encontró dos fallos encadenados:
##   1. Recast quiere los triángulos del suelo con la normal hacia -Y al
##      parsear colisionadores, y el `ConcavePolygonShape3D` reusaba el
##      bobinado del mesh visual (+Y). Recast DESCARTABA EL SUELO ENTERO en
##      silencio. Misma trampa que en `NavService.bake_region`: bobinado mal =
##      navmesh vacío sin un solo mensaje de error.
##   2. Una sola `BoxShape3D` del perímetro rompía la conectividad a más de 4 m
##      de distancia. El perímetro ya no lleva colisión propia.
##
## Hoy los 24 mapas jugables están al 100 %. Queda una entrada, y es un
## prototipo no jugable: en `map_03` el 12 % suelto son 2 m² sobre 17 m²
## navegables totales.
##
## La lista tiene que vaciarse, no crecer: la prueba sigue fallando para
## cualquier mapa que se desconecte y no esté aquí.
const DISCONNECTED_QUARANTINE: Dictionary[String, int] = {
	"map_03.tscn": 88,
}

## El conversor produce 26 mapas de `testFiles/maps/` más `editorMap`.
const EXPECTED_MAP_COUNT: int = 26
## Área mínima (m²) para que una componente conexa cuente como "sala" y no
## como una esquina suelta de la malla. 9 m² son 3×3 m, que es lo mínimo que
## garantiza contener un punto de una rejilla de 1,5 m.
const MIN_ROOM_AREA_M2: float = 9.0
## Altura por encima de la cual una componente es una repisa o una azotea, no
## una sala del suelo.
const ROOFTOP_HEIGHT_M: float = 1.2
## Fracción mínima del área navegable que debe estar en una sola componente.
## El validador del conversor usa el mismo 90 %.
const MIN_CONNECTED_FRACTION: float = 0.9
## Se muestrea a la resolución de producción. Con una rejilla más gruesa, una
## sala de 3×3 m puede no contener ni un punto de la rejilla y el "sin
## cobertura" sería un artefacto de la prueba, no un dato del mapa.
const INTEGRATION_SPACING_M: float = NavTuning.COVER_SAMPLE_SPACING_M


func test_hay_veintiseis_mapas_convertidos() -> void:
	var maps := _all_map_paths()
	assert_gt(float(maps.size()), float(EXPECTED_MAP_COUNT) - 1.0,
		"se esperaban al menos %d escenas en %s y hay %d."
		% [EXPECTED_MAP_COUNT, MAPS_DIR, maps.size()]
		+ " Si están sin generar, esta prueba no puede decir nada de la"
		+ " navegación: es una dependencia del conversor de mapas, no un fallo"
		+ " de ai/navigation")


func test_todos_los_mapas_hornean_un_navmesh_no_vacio() -> void:
	var maps := _map_paths()
	assert_gt(float(maps.size()), 0.0, "no hay mapas que probar en %s" % MAPS_DIR)
	var failures: Array[String] = []
	for path: String in maps:
		var scene := load(path) as PackedScene
		if scene == null:
			failures.append("%s: no se pudo cargar la escena" % path.get_file())
			continue
		var root := scene.instantiate()
		var nav := NavService.new()
		nav.setup()
		nav.budget_enforced = false
		var mesh := nav.bake_region(&"main", NavTestUtil.source_from_map(root))
		if mesh.get_polygon_count() == 0:
			failures.append("%s: navmesh horneado vacío" % path.get_file())
		nav.dispose()
		root.free()
	assert_size(failures, 0, "mapas sin navmesh: %s" % str(failures))


func test_las_zonas_de_cada_mapa_estan_conectadas() -> void:
	# Una zona aislada es una zona a la que la IA nunca llegará y en la que el
	# director puede colocar enemigos que jamás aparecerán en el combate.
	var maps := _map_paths()
	assert_gt(float(maps.size()), 0.0, "no hay mapas que probar en %s" % MAPS_DIR)
	var failures: Array[String] = []
	for path: String in maps:
		var scene := load(path) as PackedScene
		if scene == null:
			continue
		var root := scene.instantiate()
		var nav := NavService.new()
		nav.setup()
		nav.budget_enforced = false
		var mesh := nav.bake_region(&"main", NavTestUtil.source_from_map(root))
		var planner := RoutePlanner.new()
		planner.build(mesh)

		var total_area := 0.0
		var largest := 0.0
		for component: PackedInt32Array in planner.connected_components():
			var area := 0.0
			for poly_index: int in component:
				if planner.polygon_height(poly_index) > ROOFTOP_HEIGHT_M:
					continue
				area += planner.polygon_area(poly_index)
			total_area += area
			largest = maxf(largest, area)
		var percent := 100 if total_area <= 0.0 else int(largest / total_area * 100.0)
		if percent < int(MIN_CONNECTED_FRACTION * 100.0) \
				and not DISCONNECTED_QUARANTINE.has(path.get_file()):
			failures.append("%s: la mayor zona conectada es sólo el %d%% del área"
				% [path.get_file(), percent])
		nav.dispose()
		root.free()
	assert_size(failures, 0,
		"mapas con zonas aisladas fuera de la cuarentena documentada: %s"
		% str(failures))
	assert_gt(float(maps.size()), float(DISCONNECTED_QUARANTINE.size()),
		"la cuarentena no puede abarcar el mapa entero")


func test_cada_sala_tiene_al_menos_un_punto_de_cobertura() -> void:
	var maps := _map_paths()
	assert_gt(float(maps.size()), 0.0, "no hay mapas que probar en %s" % MAPS_DIR)
	var failures: Array[String] = []
	for path: String in maps:
		var scene := load(path) as PackedScene
		if scene == null:
			continue
		var root := scene.instantiate()
		var nav := NavService.new()
		nav.setup()
		nav.budget_enforced = false
		var mesh := nav.bake_region(&"main", NavTestUtil.source_from_map(root))
		var world := NavTestUtil.world_from_map(root, mesh)
		world.nav = nav

		var baker := CoverBaker.new()
		var options := CoverBaker.Options.new()
		options.map_id = StringName(path.get_file().get_basename())
		options.sample_spacing_m = INTEGRATION_SPACING_M
		# Un solo rayo por dirección y altura: en integración interesa que haya
		# cobertura, no distinguir total de parcial.
		options.lateral_offsets_m = [0.0] as Array[float]
		var cloud := baker.bake(mesh, world, options)

		if NO_COVER_POSSIBLE.has(path.get_file()):
			pass
		elif cloud.is_empty():
			failures.append("%s: 0 puntos de cobertura en todo el mapa"
				% path.get_file())
		elif not DISCONNECTED_QUARANTINE.has(path.get_file()):
			var planner := RoutePlanner.new()
			planner.build(mesh)
			var covered: Dictionary[int, bool] = {}
			var component_of: Dictionary[int, int] = {}
			var components := planner.connected_components()
			for c in components.size():
				for poly_index: int in components[c]:
					component_of[poly_index] = c
			for i in cloud.size():
				var poly := planner.polygon_containing(cloud.position_at(i))
				if poly >= 0:
					covered[component_of.get(poly, -1)] = true
			for c in components.size():
				var area := 0.0
				var rooftop := true
				for poly_index: int in components[c]:
					if planner.polygon_height(poly_index) <= ROOFTOP_HEIGHT_M:
						rooftop = false
						area += planner.polygon_area(poly_index)
				if rooftop or area < MIN_ROOM_AREA_M2:
					continue
				if not covered.has(c):
					failures.append("%s: sala de %d m² sin ningún punto de cobertura"
						% [path.get_file(), int(area)])
		nav.dispose()
		root.free()
	assert_size(failures, 0, "salas sin cobertura: %s" % str(failures))


func test_los_mapas_traen_la_region_de_navegacion_del_conversor() -> void:
	# Contrato con `level-conversor`: cada escena trae un `NavigationRegion3D`.
	# El remake lo rehornea con Recast (ADR-004), pero si el nodo desaparece
	# significa que la conversión ha cambiado de forma y hay que enterarse aquí
	# y no en ejecución.
	var maps := _map_paths()
	assert_gt(float(maps.size()), 0.0, "no hay mapas que probar en %s" % MAPS_DIR)
	var missing: Array[String] = []
	for path: String in maps:
		var scene := load(path) as PackedScene
		if scene == null:
			continue
		var root := scene.instantiate()
		if root.get_node_or_null(^"NavigationRegion3D") == null:
			missing.append(path.get_file())
		root.free()
	assert_size(missing, 0, "mapas sin NavigationRegion3D: %s" % str(missing))


## Mapas sobre los que corren las comprobaciones de navegación.
func _map_paths() -> Array[String]:
	var out: Array[String] = []
	for path: String in _all_map_paths():
		if not BROKEN_PROTOTYPES.has(path.get_file()):
			out.append(path)
	return out


## Todas las escenas del directorio, sin excluir nada.
func _all_map_paths() -> Array[String]:
	var out: Array[String] = []
	var dir := DirAccess.open(MAPS_DIR)
	if dir == null:
		return out
	dir.list_dir_begin()
	var entry := dir.get_next()
	while entry != "":
		var clean := entry.trim_suffix(".remap")
		if clean.ends_with(".tscn"):
			out.append(MAPS_DIR.path_join(clean))
		entry = dir.get_next()
	dir.list_dir_end()
	out.sort()
	return out
