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
## Escuadra que se está llenando y cuántos lleva. Se ponen a cero al montar la
## planta: las escuadras son de la zona, no de la partida. Se cuenta así, y no
## con una división entera del total, porque GDScript trata el aviso de
## división entera como error.
var _squad_id: int = 0
var _in_squad: int = 0


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
	_squad_id = 0
	_in_squad = 0
	var level := _loader.current()
	if level == null:
		return
	_ai.build_for_level(root as Node3D)
	if _ai.spawn_provider != null:
		_director.configure(_ai.spawn_provider)
	level.navigable_area_m2 = _ai.navigable_area_m2()
	_spawn_bosses(level)
	_director.begin_zone(_build_context(level))


func _on_level_unloaded() -> void:
	_ai.teardown()


## Pone al jefe de la planta si toca.
##
## Los jefes estaban completos y desconectados, como todo lo demás: sus
## estadísticas, su modelo, sus tablas de utilidad POR FASE y los marcadores
## `miniBoss`/`megaBoss` de los mapas convertidos existían, y
## `LoadedLevel.miniboss_spawn` no lo leía nadie. Una planta con
## `has_miniboss = true` se jugaba exactamente igual que una sin él.
##
## El jefe NO cuenta contra el presupuesto del Simplex: se pone antes de
## `begin_zone` y aparte. El presupuesto del director es para la tropa; un jefe
## es contenido de la planta, no una composición de encuentro.
##
## Y va en su PROPIA escuadra: un jefe metido en el grupo de cuatro sicarios se
## llevaría un rol de reserva y se quedaría esperando en cobertura.
func _spawn_bosses(level: LevelLoader.LoadedLevel) -> void:
	var cfg := Balance.floor_config(GameState.current_floor)
	if cfg == null:
		return
	# La regla de qué zonas tienen jefe es la MISMA que la interfaz ya le
	# promete al jugador en la pantalla de Estrategia. Si se escribiera aparte,
	# el aviso «⚠ Posible jefe» y la realidad divergirían sin que nada falle.
	if not ZoneThreatReading.has_boss_presence(cfg, GameState.current_zone):
		return
	if cfg.has_miniboss:
		_spawn_boss(level, &"miniboss", level.miniboss_spawn)
	if cfg.has_megaboss:
		_spawn_boss(level, &"megaboss", level.megaboss_spawn)


func _spawn_boss(level: LevelLoader.LoadedLevel, archetype: StringName,
		marker: Vector3) -> void:
	var position := marker
	if not _is_finite(position):
		# Sin marcador se recurre al muestreador, que ya sabe qué es justo.
		# Ante la duda, el jefe aparece: una planta que promete jefe y no lo
		# tiene es peor que uno colocado a ojo.
		var fallback := _ai.spawn_provider
		if fallback == null or not fallback.is_ready():
			push_warning("EncounterRuntime: sin sitio para el jefe '%s'" % archetype)
			return
		var candidates := _director.pick_spawn_positions(1)
		if candidates.is_empty():
			push_warning("EncounterRuntime: el muestreador no da sitio para '%s'" % archetype)
			return
		position = candidates[0]
	_squad_id += 1
	_in_squad = ENEMIES_PER_SQUAD  # fuerza grupo nuevo para la tropa siguiente
	var boss := _loader.spawn_enemy(archetype, position, _squad_id)
	if boss == null:
		return
	_director.report_enemy_spawned(boss.get_instance_id())
	if _runner != null:
		_runner.register_hostile(boss)


static func _is_finite(point: Vector3) -> bool:
	return is_finite(point.x) and is_finite(point.y) and is_finite(point.z)


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


## Enemigos por escuadra.
##
## Cuatro y no todos juntos: `SquadTuning` deja como mucho dos flanqueadores y
## dos asaltantes, así que un grupo de cuatro reparte los cuatro roles y uno de
## veinte deja a dieciséis de reserva mirando. Y no de dos, porque con dos no
## hay nadie que fije mientras el otro rodea.
const ENEMIES_PER_SQUAD: int = 4

func _on_enemy_requested(archetype: StringName, position: Vector3) -> void:
	if _loader == null:
		return
	# El grupo sale del ORDEN de aparición, que el director produce sembrado
	# desde `GameState.run_seed`: mismo sitio, misma semilla, mismas escuadras.
	if _in_squad >= ENEMIES_PER_SQUAD:
		_squad_id += 1
		_in_squad = 0
	_in_squad += 1
	var enemy := _loader.spawn_enemy(archetype, position, _squad_id)
	if enemy == null:
		return
	_director.report_enemy_spawned(enemy.get_instance_id())
	if _runner != null:
		_runner.register_hostile(enemy)
