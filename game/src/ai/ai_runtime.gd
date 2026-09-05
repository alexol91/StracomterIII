class_name AIRuntime
extends Node
## Convierte una planta cargada en una planta VIVA.
##
## Monta, una vez por nivel, la pila que toda la IA necesita y que hasta ahora
## solo existía en las pruebas: navegación horneada, consulta al mundo con
## física real, nube de puntos de cobertura y muestreador de apariciones. Y
## engancha un `BotBrain` a cada enemigo que nace.
##
## Vive en `ai/` y escucha `EventBus.character_spawned` en vez de que
## `LevelLoader` le avise: `levels/` está por debajo y no puede conocer `ai/`
## (regla 2). El bus es justamente la vía prevista para esto.
##
## Lo que no hace: decidir cuántos enemigos hay ni dónde aparecen. Eso es del
## director, que le pide a este nodo el muestreador y se lo guarda.

## Región única del nivel. Los mapas convertidos son una sola planta.
const REGION_ID: StringName = &"main"
## Puntos de la ronda de patrulla de la planta y separación con la que se
## muestrea el navmesh para elegirlos.
const PATROL_POINTS: int = 6
const PATROL_SAMPLE_SPACING_M: float = 2.0

signal runtime_ready()

var nav: NavService = null
var physics: WorldQueryPhysics = null
var world: WorldQueryComposite = null
var cover: CoverProviderBaked = null
var spawn_provider: SpawnSampler = null

var _brains: Dictionary[int, BotBrain] = {}
var _built: bool = false
var _mesh: NavigationMesh = null
var _patrol_ring: PackedVector3Array = PackedVector3Array()


func _ready() -> void:
	EventBus.character_spawned.connect(_on_character_spawned)
	EventBus.character_died.connect(_on_character_died)


func _exit_tree() -> void:
	teardown()


## Verdadero cuando la pila está montada y los bots pueden pensar de verdad.
func is_ready_for_bots() -> bool:
	return _built and world != null and world.is_complete()


## Monta la pila para una planta recién cargada.
func build_for_level(root: Node3D) -> void:
	teardown()
	if root == null or not root.is_inside_tree():
		push_warning("AIRuntime: la planta no está en el árbol, no se monta la IA")
		return

	nav = NavService.new()
	# Se PREFIERE el navmesh que el conversor ya horneó y dejó en el mapa, en
	# vez de rehornear en caliente. No es por ahorrar tiempo de carga: el del
	# conversor está validado —los 24 mapas jugables quedan en una sola
	# componente conexa— y cubre la planta entera, mientras que un horneado en
	# ejecución sobre los mismos colisionadores medía 53 m² en una planta de
	# 112. Con esa mitad de área el Simplex del director pedía CERO enemigos y
	# la zona se daba por limpia al instante.
	nav.setup()
	# Se hornea de los COLISIONADORES, no de las mallas visuales: parsear
	# mallas en ejecución obliga a traerse la geometría de vuelta de la GPU.
	#
	# Y se hornea en el MAPA PROPIO del servicio en vez de reutilizar el
	# `NavigationRegion3D` que el conversor deja en la escena. Se probaron las
	# dos: la región del conversor da un `map_get_closest_point` perfecto y
	# CERO rutas —sus polígonos no quedan enlazados entre sí—, así que todo
	# candidato de aparición salía sin camino y la planta se quedaba vacía. El
	# mapa propio, además, se configura con iteraciones síncronas y se puede
	# consultar en el mismo frame en que se hornea.
	var mesh := nav.bake_region_from_scene(REGION_ID, root)
	_mesh = mesh

	physics = WorldQueryPhysics.new()
	physics.bind_world(root.get_world_3d())
	world = WorldQueryComposite.new(physics, nav)

	if mesh != null:
		var baker := CoverBaker.new()
		var cloud := baker.bake(mesh, world)
		cover = CoverProviderBaked.new()
		cover.setup(cloud, world)

		spawn_provider = SpawnSampler.new()
		spawn_provider.setup(nav, world)
		spawn_provider.build_candidates(mesh)
		spawn_provider.set_access_points(SpawnSampler.collect_access_points(root))

	_patrol_ring = _build_patrol_ring()
	_built = true
	# Los personajes que ya estaban (el jugador, sus compañeros) nacieron antes
	# de que existiera esta pila: se les engancha ahora.
	_adopt_existing()
	runtime_ready.emit()


func teardown() -> void:
	for id: int in _brains:
		var brain: BotBrain = _brains[id]
		if brain != null:
			brain.unregister()
	_brains.clear()
	if nav != null:
		nav.dispose()
	_patrol_ring = PackedVector3Array()
	nav = null
	physics = null
	world = null
	cover = null
	spawn_provider = null
	_built = false


## Área navegable de la planta, en m². Es la primera entrada del Simplex del
## director: de ella sale cuántos enemigos caben.
func navigable_area_m2() -> float:
	if _mesh == null:
		return 0.0
	var vertices := _mesh.get_vertices()
	var total := 0.0
	for index: int in range(_mesh.get_polygon_count()):
		var polygon := _mesh.get_polygon(index)
		# Área de un polígono plano por abanico de triángulos desde su primer
		# vértice. El navmesh es horizontal, así que basta con XZ.
		for corner: int in range(1, polygon.size() - 1):
			var a := vertices[polygon[0]]
			var b := vertices[polygon[corner]]
			var c := vertices[polygon[corner + 1]]
			total += absf((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) * 0.5
	return total


## Forma de la zona medida sobre la geometría real, o un diccionario VACÍO si
## no se ha podido medir.
##
## Vacío no es «una zona sin coberturas»: es «nadie ha medido». La diferencia
## importa porque en punto flotante las dos son 0.0, y el director que no las
## distinguía leía la planta como un descampado y mandaba la composición
## equivocada. Ante la duda, la geometría se abstiene.
func measure_map_shape() -> Dictionary:
	if not _built or cover == null or spawn_provider == null or _mesh == null:
		return {}
	var area := navigable_area_m2()
	if area <= 0.0:
		return {}
	return {
		"cover_per_100m2": float(cover.point_count()) / area * 100.0,
		"line_of_sight_m": _mean_line_of_sight(),
		"entries": spawn_provider.access_point_count(),
	}


## Distancia media hasta el primer muro, muestreada sobre el propio navmesh.
## Es lo que distingue una planta de despachos de una diáfana, y por tanto si
## conviene mandar tiradores o gente que cierre distancia.
func _mean_line_of_sight() -> float:
	var vertices := _mesh.get_vertices()
	if vertices.is_empty() or world == null:
		return 0.0
	# Muestreo fijo y determinista: la misma planta mide siempre lo mismo, que
	# es lo que permite reproducir una partida entera desde su semilla.
	const SAMPLES: int = 24
	const MAX_RANGE_M: float = 30.0
	const EYE_M: float = 1.5
	var total := 0.0
	var taken := 0
	for index: int in range(SAMPLES):
		var origin := vertices[(index * 7919) % vertices.size()] + Vector3(0.0, EYE_M, 0.0)
		var angle := TAU * float(index) / float(SAMPLES)
		var direction := Vector3(cos(angle), 0.0, sin(angle))
		var hit := world.raycast(origin, origin + direction * MAX_RANGE_M)
		total += origin.distance_to(hit) if hit != Vector3.INF else MAX_RANGE_M
		taken += 1
	return total / float(taken) if taken > 0 else 0.0


func brain_count() -> int:
	return _brains.size()


func brain_of(character: Character) -> BotBrain:
	if character == null:
		return null
	return _brains.get(character.get_instance_id(), null)


## Objetivos visibles para la percepción: todo personaje vivo del mapa. Quién
## es enemigo de quién lo filtra `PerceptionSystem` por equipo; aquí no se
## decide nada, solo se enumera.
func visible_targets() -> Array:
	var out: Array = []
	var tree := get_tree()
	if tree == null:
		return out
	for node: Node in tree.get_nodes_in_group(&"characters"):
		var character := node as Character
		if character == null or not is_instance_valid(character) or not character.alive:
			continue
		var target := VisionSensor.Target.new()
		target.target_id = character.get_instance_id()
		target.team = int(character.team)
		target.position = character.global_position
		target.velocity = character.velocity if character is CharacterBody3D else Vector3.ZERO
		target.is_alive = character.alive
		target.is_crouched = character.intent_crouch
		out.append(target)
	return out


## El `NavigationRegion3D` que el conversor deja en cada mapa.
static func _find_navigation_region(node: Node) -> NavigationRegion3D:
	var region := node as NavigationRegion3D
	if region != null:
		return region
	for child: Node in node.get_children():
		var found := _find_navigation_region(child)
		if found != null:
			return found
	return null


func _adopt_existing() -> void:
	var tree := get_tree()
	if tree == null:
		return
	for node: Node in tree.get_nodes_in_group(&"characters"):
		var character := node as Character
		if character != null and _needs_brain(character):
			_attach_brain(character)


func _on_character_spawned(character: Node, _team: int, _archetype: StringName) -> void:
	var body := character as Character
	if body == null or not _needs_brain(body):
		return
	if not _built:
		# Nació antes de que existiera la pila —el jugador durante la carga—.
		# `_adopt_existing` lo recoge cuando el nivel termina de montarse; darle
		# un cerebro ahora sería dárselo ciego y sordo para siempre.
		return
	_attach_brain(body)


## Quién lleva cerebro: todo el que no sea el jugador humano. El jugador tiene
## `PlayerInput` rellenando las mismas intenciones, y dos cosas escribiendo la
## misma intención es una pelea que se ve como un personaje con tembleque.
func _needs_brain(character: Character) -> bool:
	if character.team == Character.Team.PLAYER:
		return false
	return not _brains.has(character.get_instance_id())


func _attach_brain(character: Character) -> void:
	var brain := BotBrain.new()
	brain.setup(character, world, cover, Blackboard, visible_targets)
	if brain.context != null and not _patrol_ring.is_empty():
		brain.context.patrol_points = _patrol_ring
		# Empieza por el punto que le pilla más cerca: si todos arrancaran en
		# el mismo, la planta entera marcharía en fila india.
		brain.context.patrol_index = _nearest_patrol_index(character.global_position)
	brain.register()
	_brains[character.get_instance_id()] = brain


## Ronda de patrulla común de la planta, repartida por el navmesh.
##
## Sin ella los bots nacen, se cubren y se quedan de estatua: el árbol de
## PATROL comprueba `patrol_points` y sin puntos no tiene a dónde ir, así que
## un enemigo que no ha visto ni oído nada no se mueve JAMÁS y el jugador
## recorre la planta encontrándose maniquíes.
##
## Se eligen por reparto máximo-mínimo —cada punto nuevo es el más lejano a
## todos los ya elegidos—, que con pocos puntos cubre la planta mucho mejor
## que coger los primeros de la rejilla, y es determinista.
func _build_patrol_ring() -> PackedVector3Array:
	var out := PackedVector3Array()
	if _mesh == null:
		return out
	var samples := NavmeshSampler.sample_grid(_mesh, PATROL_SAMPLE_SPACING_M)
	if samples.is_empty():
		return out
	out.append(samples[0])
	while out.size() < PATROL_POINTS and out.size() < samples.size():
		var best := Vector3.INF
		var best_distance := -1.0
		for candidate: Vector3 in samples:
			var nearest := INF
			for chosen: Vector3 in out:
				nearest = minf(nearest, candidate.distance_to(chosen))
			if nearest > best_distance:
				best_distance = nearest
				best = candidate
		if best == Vector3.INF:
			break
		out.append(best)
	return out


## Los puntos de la ronda de patrulla, para quien necesite sitios navegables
## bien repartidos por la planta sin volver a muestrear el navmesh.
func patrol_ring_points() -> PackedVector3Array:
	return _patrol_ring


func _nearest_patrol_index(position: Vector3) -> int:
	var best := 0
	var best_distance := INF
	for index: int in range(_patrol_ring.size()):
		var distance := position.distance_to(_patrol_ring[index])
		if distance < best_distance:
			best_distance = distance
			best = index
	return best


func _on_character_died(character_id: int, _team: int, _killer_id: int, _xp: int) -> void:
	var brain: BotBrain = _brains.get(character_id, null)
	if brain == null:
		return
	# Quien llena un registro lo vacía: un cerebro muerto que siga registrado
	# consume presupuesto del planificador y deja un `Callable` apuntando a un
	# cuerpo que va a desaparecer.
	brain.unregister()
	_brains.erase(character_id)
