extends TestCase
## Puertas que ALTERAN la navegación (paridad [P08], ADR-004).
##
## Sustituye a `Door::switchNodes` → `NavGraph::changeNodeState(id, open)` del
## legacy (análisis §4.6). Lo que se comprueba es la semántica jugable, que es
## lo único que había que conservar: puerta cerrada = intransitable, puerta
## abierta = transitable, y el estado inicial coherente desde el primer frame
## (el original dejaba el nodo central habilitado hasta el primer `Switch`).

## `DoorNavLink` es un nodo de escena, pero estas pruebas NO lo meten en el
## árbol: corren dentro del `_ready` del ejecutor y ahí `add_child` sobre la
## raíz falla ("parent node is busy setting up children"). En su lugar se llama
## a `initialize()`, que es justo lo que hace `_ready`. Al terminar se libera
## con `free()`: sin bucle de escena, `queue_free()` no se procesa nunca.
const DOOR_ID: int = 42
const OTHER_DOOR_ID: int = 43


func test_estado_inicial_cerrado_deshabilita_el_enlace() -> void:
	var link := DoorNavLink.new()
	link.door_id = DOOR_ID
	link.open_on_start = false
	link.initialize()
	assert_false(link.is_open(), "la puerta arranca cerrada")
	assert_false(link.enabled,
		"una puerta cerrada no puede dejar pasar: el enlace va deshabilitado"
		+ " desde el primer frame, no desde el primer Switch")
	link.shutdown()
	link.free()


func test_estado_inicial_abierto_habilita_el_enlace() -> void:
	var link := DoorNavLink.new()
	link.door_id = DOOR_ID
	link.open_on_start = true
	link.initialize()
	assert_true(link.is_open(), "la puerta arranca abierta")
	assert_true(link.enabled, "y el enlace es transitable")
	link.shutdown()
	link.free()


func test_la_senal_del_eventbus_conmuta_la_navegacion() -> void:
	var tree := Engine.get_main_loop() as SceneTree
	var bus: Node = tree.root.get_node_or_null(^"/root/EventBus")
	assert_not_null(bus, "hace falta el EventBus para esta prueba")
	var link := DoorNavLink.new()
	link.door_id = DOOR_ID
	link.open_on_start = false
	link.initialize()
	if bus != null:
		bus.emit_signal(&"door_state_changed", DOOR_ID, true)
		assert_true(link.enabled, "al abrirse, el enlace pasa a ser transitable")
		bus.emit_signal(&"door_state_changed", DOOR_ID, false)
		assert_false(link.enabled, "al cerrarse, deja de serlo")
	link.shutdown()
	link.free()


func test_cada_puerta_solo_atiende_a_su_id() -> void:
	# El legacy aplicaba `changeNodeState` a TODOS los nodos devueltos por
	# `addDoor`; aquí cada enlace es una puerta y no debe moverse porque se
	# abra la de al lado.
	var tree := Engine.get_main_loop() as SceneTree
	var bus: Node = tree.root.get_node_or_null(^"/root/EventBus")
	assert_not_null(bus, "hace falta el EventBus para esta prueba")
	var link := DoorNavLink.new()
	link.door_id = DOOR_ID
	link.open_on_start = false
	link.initialize()
	if bus != null:
		bus.emit_signal(&"door_state_changed", OTHER_DOOR_ID, true)
		assert_false(link.enabled,
			"abrir la puerta 43 no puede abrir la 42")
	link.shutdown()
	link.free()


func test_el_enlace_sabe_si_le_afecta_un_cambio_de_topologia() -> void:
	# Demolición del Explosivo (E-01): sólo las puertas cuyo vano cae en la
	# zona derribada piden un re-horneado. Si respondieran todas, una granada
	# rehornearía la planta entera una vez por puerta.
	var link := DoorNavLink.new()
	link.door_id = DOOR_ID
	link.start_position = Vector3(-1.0, 0.0, 0.0)
	link.end_position = Vector3(1.0, 0.0, 0.0)
	link.initialize()
	assert_true(link.affected_by(AABB(Vector3(-2.0, -1.0, -2.0), Vector3(4.0, 3.0, 4.0))),
		"un boquete encima del vano sí afecta a esta puerta")
	assert_false(link.affected_by(AABB(Vector3(40.0, -1.0, 40.0), Vector3(4.0, 3.0, 4.0))),
		"un boquete a 40 m no tiene nada que ver con esta puerta")
	link.shutdown()
	link.free()


func test_una_sala_sin_otra_salida_se_aisla_al_cerrar_la_puerta() -> void:
	# La forma gruesa de [P08]: la región de detrás deja de ser navegable. Sólo
	# vale para salas de una sola entrada; con dos puertas, deshabilitar la
	# región al cerrar una dejaría la sala inalcanzable por la otra, y eso está
	# documentado en el export.
	var tree := Engine.get_main_loop() as SceneTree
	var bus: Node = tree.root.get_node_or_null(^"/root/EventBus")
	assert_not_null(bus, "hace falta el EventBus para esta prueba")
	var region := NavigationRegion3D.new()
	var link := DoorNavLink.new()
	link.door_id = DOOR_ID
	link.open_on_start = true
	# La región cuelga del propio enlace: así el NodePath se resuelve sin
	# necesidad de que nada esté dentro del árbol de escena.
	link.add_child(region)
	link.exclusive_regions = [link.get_path_to(region)] as Array[NodePath]
	link.initialize()
	if bus != null:
		bus.emit_signal(&"door_state_changed", DOOR_ID, false)
		assert_false(region.enabled,
			"cerrada la única puerta, la sala de detrás deja de ser navegable")
		bus.emit_signal(&"door_state_changed", DOOR_ID, true)
		assert_true(region.enabled, "y vuelve a serlo al abrirla")
	link.shutdown()
	link.free()
