@tool
class_name DoorNavLink
extends NavigationLink3D
## Una puerta que ALTERA la navegación (paridad [P08], ADR-004).
##
## Es la única idea del pathfinding del legacy que merecía la pena conservar.
## Allí, `Pathfinder::addDoor` metía un nodo en el centroide de la puerta,
## deshabilitaba los nodos que caían dentro y recableaba las aristas
## bloqueadas; `Door::switchNodes` llamaba a `NavGraph::changeNodeState(id,
## open)` sobre esa lista (análisis §4.6). El efecto jugable —una puerta
## cerrada no se puede atravesar y la IA da la vuelta— es exactamente lo que
## se quiere. La implementación, no: dependía de un grafo propio, tenía el
## nodo central habilitado hasta el primer `Switch`, y añadía cada arista dos
## veces.
##
## Aquí la topología la lleva el motor: las dos salas son regiones separadas y
## la puerta es el ÚNICO enlace entre ellas. Cerrarla es `enabled = false`, y
## `NavigationServer3D` recalcula las rutas solo. Sin grafo propio, sin nodos
## deshabilitados, sin recableado.
##
## Colocación en la escena del mapa: el nodo va en el hueco de la puerta, con
## `start_position` y `end_position` a un lado y otro del vano, dentro de sus
## respectivas regiones.

const Tuning := preload("res://src/ai/navigation/nav_tuning.gd")

## Identificador que emite `EventBus.door_state_changed`. Debe coincidir con
## el de la puerta de `gameplay/`.
@export var door_id: int = 0
## Estado al cargar el nivel. El legacy arrancaba las puertas cerradas
## (`Door.cc:45`) pero dejaba el nodo central habilitado hasta el primer
## `Switch`: una incoherencia que aquí no existe porque el estado inicial se
## aplica en `_ready`.
@export var open_on_start: bool = false

## Regiones que dejan de ser navegables cuando la puerta se cierra. Sólo para
## salas SIN otra entrada: si una sala tiene dos puertas, deshabilitar la
## región al cerrar una de ellas la haría inalcanzable por la otra.
@export var exclusive_regions: Array[NodePath] = []

## Si la demolición (E-01) toca el vano de esta puerta, pedir un re-horneado.
@export var rebake_on_topology_change: bool = true

## Margen alrededor del vano para decidir si un cambio de topología le afecta.
@export var topology_margin_m: float = 2.0

var _is_open: bool = false


func is_open() -> bool:
	return _is_open


func _ready() -> void:
	if Engine.is_editor_hint():
		return
	var bus := _event_bus()
	if bus != null:
		bus.connect(&"door_state_changed", _on_door_state_changed)
		bus.connect(&"level_topology_changed", _on_level_topology_changed)
	_apply(open_on_start)


func _exit_tree() -> void:
	if Engine.is_editor_hint():
		return
	var bus := _event_bus()
	if bus == null:
		return
	if bus.is_connected(&"door_state_changed", _on_door_state_changed):
		bus.disconnect(&"door_state_changed", _on_door_state_changed)
	if bus.is_connected(&"level_topology_changed", _on_level_topology_changed):
		bus.disconnect(&"level_topology_changed", _on_level_topology_changed)


## Conmuta la navegación. Público para que las pruebas no dependan del bus.
##
## No hay fundido: `NavTuning.DOOR_TRANSITION_S` (los 1000 ms de
## `Door.cc:103`) es cosa de la animación y del cuerpo físico. Una puerta que
## se está abriendo todavía no se puede cruzar, y una que se está cerrando ya
## no: la navegación conmuta cuando `gameplay/` dice que el estado ha
## cambiado, ni antes ni después.
func _apply(is_open: bool) -> void:
	_is_open = is_open
	enabled = is_open
	for path: NodePath in exclusive_regions:
		var region := get_node_or_null(path) as NavigationRegion3D
		if region != null:
			region.enabled = is_open


func _on_door_state_changed(changed_door_id: int, is_open: bool) -> void:
	if changed_door_id != door_id:
		return
	_apply(is_open)


## La demolición del Explosivo puede abrir un boquete justo al lado del vano.
## Cuando eso pasa, la malla de la zona ya no describe el nivel y hay que
## rehornearla; el servicio coalesce las peticiones para que no se rehornee
## una vez por puerta.
func _on_level_topology_changed(region_aabb: AABB) -> void:
	if not rebake_on_topology_change:
		return
	if not affected_by(region_aabb):
		return
	var service := NavService.active()
	if service != null:
		service.request_rebake(region_aabb)


## ¿Cae el vano de esta puerta dentro de la zona modificada?
func affected_by(region_aabb: AABB) -> bool:
	var a := get_global_start_position() if is_inside_tree() else start_position
	var b := get_global_end_position() if is_inside_tree() else end_position
	var own := AABB(a, Vector3.ZERO).expand(b).grow(topology_margin_m)
	return own.intersects(region_aabb)


func _event_bus() -> Node:
	var loop := Engine.get_main_loop() as SceneTree
	if loop == null:
		return null
	return loop.root.get_node_or_null(^"/root/EventBus")
