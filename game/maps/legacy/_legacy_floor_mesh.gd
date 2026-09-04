extends StaticBody3D
## Construye la malla visual y la colisión del suelo a partir de los datos
## exportados por tools/map_converter/convert.py.
##
## Por qué un script en vez de un ArrayMesh guardado en el .tscn: el formato
## de texto de Godot 4 serializa `ArrayMesh._surfaces` como buffers binarios
## comprimidos (PackedByteArray) con flags de formato exactos. Escribir eso
## a mano desde Python es frágil y no aporta nada frente a construir la
## malla en tiempo de carga a partir de arrays de vértices en texto plano
## (PackedVector3Array/PackedInt32Array), que sí son deterministas y legibles
## en el propio .tscn. El resultado runtime es idéntico a un ArrayMesh
## horneado en el editor.
##
## `floor_indices` ya viene triangulado (ear-clipping) y con el orden de
## índices corregido en origen para que la normal de cada triángulo mire
## hacia +Y (ver convert.py:_ensure_ccw_up).

@export var floor_vertices: PackedVector3Array = PackedVector3Array()
@export var floor_uvs: PackedVector2Array = PackedVector2Array()
@export var floor_indices: PackedInt32Array = PackedInt32Array()


func _ready() -> void:
	_build()


func _build() -> void:
	if floor_vertices.is_empty() or floor_indices.is_empty():
		push_warning("%s: Floor sin geometría (perímetro vacío o degenerado)" % get_path())
		return

	var normals := PackedVector3Array()
	normals.resize(floor_vertices.size())
	normals.fill(Vector3.UP)

	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = floor_vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	if floor_uvs.size() == floor_vertices.size():
		arrays[Mesh.ARRAY_TEX_UV] = floor_uvs
	arrays[Mesh.ARRAY_INDEX] = floor_indices

	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)

	var material := StandardMaterial3D.new()
	# Color plano de referencia: las texturas legacy (pared.jpg,
	# sueloOficina.jpg...) no se redistribuyen (ver docs/analisis
	# §5.2/§7 — procedencia y licencia sin verificar). Sustituir aquí
	# cuando exista un set de texturas propio.
	material.albedo_color = Color(0.55, 0.55, 0.58)
	mesh.surface_set_material(0, material)

	var mesh_instance := MeshInstance3D.new()
	mesh_instance.name = "FloorMesh"
	mesh_instance.mesh = mesh
	add_child(mesh_instance)

	var shape := ConcavePolygonShape3D.new()
	var faces := PackedVector3Array()
	faces.resize(floor_indices.size())
	for i in floor_indices.size():
		faces[i] = floor_vertices[floor_indices[i]]
	shape.set_faces(faces)

	var collision := CollisionShape3D.new()
	collision.name = "FloorCollision"
	collision.shape = shape
	add_child(collision)
