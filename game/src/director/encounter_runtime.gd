class_name EncounterRuntime
extends Node
## Enchufa el director de encuentros al juego.
##
## El director estaba escrito, probado y COMPLETAMENTE desconectado: `main.tscn`
## no tenía nodo de director, `FloorRunner.director_path` apuntaba a la nada, y
## el resultado era que toda planta se cargaba vacía y se daba por limpia en el
## mismo instante. Ocho plantas de paseo.
##
## Este nodo vive en `director/` porque es la única capa que puede conocer a las
## otras: `director → ai → gameplay → levels`. Desde aquí se puede llamar tanto
## al `AIRuntime` como al `LevelLoader`; al revés sería romper la regla 2.
##
## El ciclo completo de una zona:
##   1. `LevelLoader` avisa de que la planta está montada,
##   2. `AIRuntime` hornea navegación, coberturas y puntos de aparición,
##   3. se mide la forma real de la zona y se compone el encuentro,
##   4. el director pide enemigos y aquí se instancian,
##   5. cada enemigo instanciado recibe su cerebro (lo hace `AIRuntime`, al
##      oír `character_spawned`) y se le cuenta al director y al `FloorRunner`.

@export var level_loader_path: NodePath
@export var floor_runner_path: NodePath
@export var ai_runtime_path: NodePath
@export var director_path: NodePath

var _loader: LevelLoader = null
var _runner: FloorRunner = null
var _ai: AIRuntime = null
var _director: EncounterDirector = null


func _ready() -> void:
	_loader = get_node_or_null(level_loader_path) as LevelLoader
	_runner = get_node_or_null(floor_runner_path) as FloorRunner
	_ai = get_node_or_null(ai_runtime_path) as AIRuntime
	_director = get_node_or_null(director_path) as EncounterDirector
	if _loader == null or _ai == null or _director == null:
		push_error("EncounterRuntime: falta alguna pieza; la planta se quedaría vacía")
		set_process(false)
		return
	_loader.level_ready.connect(_on_level_ready)
	_loader.level_unloaded.connect(_on_level_unloaded)
	_director.enemy_requested.connect(_on_enemy_requested)


func _process(_delta: float) -> void:
	# El director decide dónde es JUSTO aparecer, y eso depende de dónde mira el
	# jugador: nadie debe materializarse en el centro de la pantalla.
	if _director == null or _loader == null:
		return
	var level := _loader.current()
	if level == null or not is_instance_valid(level.player):
		return
	_director.set_player_pose(
		level.player.global_position,
		-level.player.global_transform.basis.z)


func _on_level_ready(root: Node) -> void:
	# El mapa de navegación del mundo NO está sincronizado en el frame en que
	# la planta entra en el árbol: el servidor lo sincroniza al final del paso
	# de física. Cualquier consulta antes de eso falla con «query made before
	# first map synchronization» y devuelve el origen, así que TODO candidato
	# de aparición salía como no navegable y la planta se quedaba vacía.
	#
	# Forzar la sincronización a mano tampoco vale —es justo la llamada que
	# dispara ese error—: hay que esperar el paso de física, y punto.
	await get_tree().physics_frame
	await get_tree().physics_frame
	if _loader == null or not is_instance_valid(root):
		return
	var level := _loader.current()
	if level == null:
		return
	_ai.build_for_level(root as Node3D)
	if _ai.spawn_provider != null:
		_director.configure(_ai.spawn_provider)
	level.navigable_area_m2 = _ai.navigable_area_m2()
	_director.begin_zone(_build_context(level))


func _on_level_unloaded() -> void:
	_ai.teardown()


## Contexto de la zona: lo que el Simplex necesita saber del sitio.
func _build_context(level: LevelLoader.LoadedLevel) -> EncounterContext:
	var context := EncounterContext.new()
	context.floor_number = GameState.current_floor
	context.zone = GameState.current_zone
	# Área del SUELO de la zona, no la del navmesh, y no es un descuido.
	#
	# La fórmula de MaxEnemies es la del original (`Optimization.cc:91`) y está
	# calibrada contra el área del polígono del mapa: las pruebas del composer
	# usan de 200 a 5000 m², que son tamaños de plano, no de navmesh. El
	# navmesh horneado de `mapP1` mide 53 m² frente a los 112 del plano, y con
	# esa mitad el Simplex pedía CERO enemigos en la primera zona del juego.
	#
	# El conversor deja el área real en la metadata de cada mapa. Si faltara,
	# se cae al navmesh, que es la única otra medida disponible.
	var area := float(level.root.get_meta(&"area_m2", 0.0))
	context.navigable_area_m2 = area if area > 0.0 else level.navigable_area_m2
	context.seed = GameState.run_seed + GameState.current_floor * 977 + GameState.current_zone
	var cfg := Balance.floor_config(GameState.current_floor)
	if cfg != null:
		context.floor_difficulty = cfg.base_difficulty
		context.allowed_archetypes = cfg.enemy_pool.duplicate()

	# La forma solo se declara si de verdad se ha medido. Un diccionario vacío
	# significa «nadie la ha medido», que NO es lo mismo que «no hay
	# coberturas»: el director se queda entonces en sus presupuestos nominales
	# en vez de leer la planta como un descampado.
	var shape := _ai.measure_map_shape()
	if not shape.is_empty():
		context.set_map_shape(
			float(shape["cover_per_100m2"]),
			float(shape["line_of_sight_m"]),
			int(shape["entries"]))
	return context


func _on_enemy_requested(archetype: StringName, position: Vector3) -> void:
	if _loader == null:
		return
	var enemy := _loader.spawn_enemy(archetype, position)
	if enemy == null:
		return
	_director.report_enemy_spawned(enemy.get_instance_id())
	if _runner != null:
		_runner.register_hostile(enemy)
