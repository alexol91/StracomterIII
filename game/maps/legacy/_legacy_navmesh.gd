extends NavigationRegion3D
## Construye el NavigationMesh horneado por tools/map_converter (rejilla
## regular + flood-fill sobre muros y huella de obstáculos; ver
## tools/map_converter/README.md §"Navegación") a partir de los datos
## exportados por convert.py.
##
## Igual que en _legacy_floor_mesh.gd: NavigationMesh no serializa sus
## polígonos como propiedades planas de texto en un .tscn de forma fiable
## de un lenguaje externo a Godot, así que se reconstruye en `_ready()` a
## partir de PackedVector3Array/Array[PackedInt32Array], que sí son
## deterministas y legibles.
##
## Las puertas NO recortan este navmesh: en esta conversión son marcadores
## sin colisión (otro agente instanciará la puerta real encima), así que el
## hueco que dejan en los muros ya es transitable de por sí.

@export var nav_vertices: PackedVector3Array = PackedVector3Array()
@export var nav_polygons: Array[PackedInt32Array] = []


func _ready() -> void:
	_build()


func _build() -> void:
	if nav_vertices.is_empty() or nav_polygons.is_empty():
		push_warning("%s: navmesh vacío (¿perímetro degenerado o mapa sin área libre?)" % get_path())
		return

	var mesh := NavigationMesh.new()
	mesh.vertices = nav_vertices
	for polygon: PackedInt32Array in nav_polygons:
		mesh.add_polygon(polygon)

	navigation_mesh = mesh
