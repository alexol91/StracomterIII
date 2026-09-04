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
## hacia +Y (ver convert.py:_ensure_ccw_up) — correcto para el `MeshInstance3D`
## visual (si no, Godot hace back-face culling y el suelo no se ve desde la
## cámara cenital).
##
## BUG REAL encontrado por ai-navegacion (componentes del navmesh horneado
## desconectadas, finalMap con solo el 46% de área alcanzable): el
## `ConcavePolygonShape3D` de colisión NO puede reusar ese mismo orden.
## `NavigationServer3D.bake_from_source_geometry_data` con
## `PARSED_GEOMETRY_STATIC_COLLIDERS` exige exactamente lo CONTRARIO —
## triángulos horarios vistos desde +Y, es decir, normal apuntando hacia -Y—
## y si no, el horneador descarta esos triángulos EN SILENCIO (0 polígonos
## para ese trozo de suelo, sin ningún error ni aviso). Comprobado
## empíricamente contra Godot 4.7.2 con un cuadrado plano aislado: con normal
## +Y el horneado da 0 polígonos; con normal -Y (mismos vértices, orden
## invertido) da 2. `ai_navegacion/src/ai/navigation/nav_service.gd` deja
## constancia exacta de la misma exigencia de bobinado en
## `NavService.bake_region`. Por eso aquí se construye un segundo array de
## índices, `_collision_indices`, con cada triángulo invertido (se cambian de
## sitio el 2º y 3er vértice) SOLO para la forma de colisión — el mesh visual
## sigue usando `floor_indices` tal cual. `backface_collision` en la forma NO
## sustituye a esto: se comprobó que con `backface_collision = true` y normal
## +Y el horneado sigue dando 0 polígonos (ese flag afecta a qué lado
## responde a la física, no a qué bobinado acepta el horneador).

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
	shape.set_faces(_collision_faces())

	var collision := CollisionShape3D.new()
	collision.name = "FloorCollision"
	collision.shape = shape
	add_child(collision)


## Caras para la forma de colisión: mismos triángulos que `floor_indices`
## pero con cada uno invertido (2º y 3er índice intercambiados), para que su
## normal apunte a -Y en vez de +Y. Ver la nota grande de arriba del porqué.
func _collision_faces() -> PackedVector3Array:
	var faces := PackedVector3Array()
	var n := floor_indices.size()
	faces.resize(n)
	var t := 0
	while t < n:
		faces[t] = floor_vertices[floor_indices[t]]
		faces[t + 1] = floor_vertices[floor_indices[t + 2]]
		faces[t + 2] = floor_vertices[floor_indices[t + 1]]
		t += 3
	return faces
