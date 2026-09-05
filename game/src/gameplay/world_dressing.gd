class_name WorldDressing
extends Node
## Viste la geometría de un mapa con los materiales del estilo activo.
##
## Los mapas convertidos desde el XML de 2012 son geometría desnuda: cajas y
## un trimesh de suelo, sin un solo material. Pintarlos en el conversor sería
## un error, porque entonces el aspecto quedaría horneado en 24 escenas
## generadas y `: chutaos on|off` no podría cambiarlo. Aquí se resuelve en
## tiempo de carga, leyendo el nombre del nodo, y se repinta cuando cambia el
## estilo.
##
## El reparto de superficies no es decorativo, es información táctica:
##
##   `PerimeterWall_*` → TRIM   acero oscuro: es el borde del edificio, no
##                              hay nada detrás y nunca se abre.
##   `Wall_*`          → WALL   tabique claro: divide la planta, puede haber
##                              alguien al otro lado.
##   `Door_*`          → DOOR   madera cálida: el único acento del mapa está
##                              donde el jugador tiene que mirar.
##   `Obstacle_*`      → PROP   un punto más oscuro que la pared, para que la
##                              cobertura se distinga del fondo.
##
## `Floor` no se toca: se pinta a sí mismo al construir su malla, y dos dueños
## para la misma superficie es justo el fallo que este proyecto ya ha pagado.

## Prefijo de nodo → superficie. Se comprueba por orden de longitud
## decreciente, así `PerimeterWall_` gana a `Wall_` aunque uno contenga al
## otro.
const PREFIX_SURFACE: Dictionary[String, WorldSurface.Kind] = {
	"PerimeterWall": WorldSurface.Kind.TRIM,
	"Wall": WorldSurface.Kind.WALL,
	"Door": WorldSurface.Kind.DOOR,
	"Obstacle": WorldSurface.Kind.PROP,
	"Prop": WorldSurface.Kind.PROP,
	"Ceiling": WorldSurface.Kind.CEILING,
	"Glass": WorldSurface.Kind.GLASS,
	"Partition": WorldSurface.Kind.GLASS,
}


func _ready() -> void:
	dress()
	# Misma cautela que en el suelo: repintar dos veces es inocuo, pero
	# conectarse dos veces no lo es.
	if not PresentationStyle.style_changed.is_connected(_on_style_changed):
		PresentationStyle.style_changed.connect(_on_style_changed)


## Vuelve a pintar el mapa entero. Público porque el generador procedural
## añade salas después de cargar la escena y necesita vestir lo nuevo.
func dress(root: Node = null) -> void:
	var target := root if root != null else get_parent()
	if target == null:
		return
	_dress_recursive(target, -1)


func _dress_recursive(node: Node, inherited: int) -> void:
	# El suelo se pinta solo; entrar ahí sería pisarle el material.
	if node.name == &"Floor":
		return
	var surface := _surface_for(String(node.name))
	if surface < 0:
		surface = inherited
	var mesh_instance := node as MeshInstance3D
	if mesh_instance != null and surface >= 0:
		_paint(mesh_instance, surface)
	for child: Node in node.get_children():
		_dress_recursive(child, surface)


## La malla vive en un `SubResource` que varias cajas comparten, así que el
## material va como override en la instancia: escribirlo en la malla lo
## repartiría a nodos que no lo pidieron.
func _paint(mesh_instance: MeshInstance3D, surface: int) -> void:
	var material := PresentationStyle.surface_material(surface as WorldSurface.Kind)
	if material == null:
		return
	var surfaces := mesh_instance.get_surface_override_material_count()
	for i: int in range(surfaces):
		mesh_instance.set_surface_override_material(i, material)


## Devuelve la superficie que pide un nombre de nodo, o -1 si no pide ninguna.
## El nombre manda sobre el tipo porque es lo único que el conversor garantiza:
## `Wall_3/Mesh` hereda de su padre, y un nodo suelto sin prefijo conocido no
## se pinta — ante la duda, no se decide por él.
static func _surface_for(node_name: String) -> int:
	var best := -1
	var best_len := 0
	for prefix: String in PREFIX_SURFACE:
		if node_name.begins_with(prefix) and prefix.length() > best_len:
			best = PREFIX_SURFACE[prefix]
			best_len = prefix.length()
	return best


func _on_style_changed(_chutaos: bool) -> void:
	dress()
