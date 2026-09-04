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
## BUG REAL Nº1 (winding) encontrado por ai-navegacion (componentes del
## navmesh horneado desconectadas, finalMap con solo el 46% de área
## alcanzable): el `ConcavePolygonShape3D` de colisión NO puede reusar ese
## mismo orden. `NavigationServer3D.bake_from_source_geometry_data` con
## `PARSED_GEOMETRY_STATIC_COLLIDERS` exige exactamente lo CONTRARIO —
## triángulos horarios vistos desde +Y, es decir, normal apuntando hacia -Y—
## y si no, el horneador descarta esos triángulos EN SILENCIO (0 polígonos
## para ese trozo de suelo, sin ningún error ni aviso). Comprobado
## empíricamente contra Godot 4.7.2 con un cuadrado plano aislado: con normal
## +Y el horneado da 0 polígonos; con normal -Y (mismos vértices, orden
## invertido) da 2. `ai_navegacion/src/ai/navigation/nav_service.gd` deja
## constancia exacta de la misma exigencia de bobinado en
## `NavService.bake_region`. Por eso aquí se construye un segundo array de
## caras, invertidas (se cambian de sitio el 2º y 3er vértice de cada
## triángulo) SOLO para la forma de colisión — el mesh visual sigue usando
## `floor_indices` tal cual. `backface_collision` en la forma NO sustituye a
## esto: se comprobó que con `backface_collision = true` y normal +Y el
## horneado sigue dando 0 polígonos (ese flag afecta a qué lado responde a la
## física, no a qué bobinado acepta el horneador).
##
## BUG REAL Nº2 (perímetro), mucho más grave, encontrado DESPUÉS de arreglar
## el nº1: con el winding ya corregido, `finalMap` seguía con solo el 46,3%
## de su navmesh horneado en una única componente conexa (7 componentes en
## total), y lo mismo en menor grado en `map1`, `mapM2`, `mapM4`, `mapP1`,
## `map_03`, `mapaMolon`. Diagnóstico por bisección (quitando geometría de una
## en una hasta que la conexión vuelve): la causa es la `BoxShape3D` SUELTA de
## cada `Walls/PerimeterWall_i`. En `finalMap` (un octógono con las esquinas
## cortadas) bastaba con UNA sola arista diagonal para romper la conectividad
## en un sitio TOTALMENTE AJENO — a más de 4 metros de distancia de esa caja,
## en una puerta con geometría intachable (comprobado a mano vértice a
## vértice) — y sustituirla por una `ConvexPolygonShape3D` con los mismos 8
## puntos NO lo arreglaba: no es un problema del *tipo* de forma, es que una
## caja 3D suelta metida como cuerpo rígido aparte confunde el reparto en
## regiones de Recast. La primera hipótesis —que bastaba con arreglar solo
## las aristas diagonales, dejando las alineadas a ejes con su `BoxShape3D`
## normal— resultó falsa: `map1.xml` y `mapP1.xml` tienen el perímetro
## rectilíneo (sin ninguna arista diagonal) y mostraban el mismo problema en
## aristas alineadas a ejes. Un trimesh SÍ es inmune a esto (el propio suelo,
## triangulado con las mismas aristas del perímetro, hornea siempre sin
## fallos), así que la solución es no representar el zócalo del perímetro
## como cajas independientes en NINGUNA arista: se funde como más triángulos
## de ESTE MISMO trimesh (`skirt_vertices`/`skirt_indices`, calculados por
## `convert.py:_build_perimeter_skirt` para las 8/lo-que-tenga aristas, sin
## excepción). Verificado tras el cambio: los 7 mapas afectados pasan a una
## única componente conexa (o mejoran sustancialmente los que tenían más de
## un problema, como `mapaMolon`). `Walls/PerimeterWall_i` sigue existiendo
## en la escena pero solo para el aspecto visual (`collision_layer = 0`, sin
## `CollisionShape3D`): la colisión real del perímetro vive aquí, en `Floor`.
##
## Efecto secundario conocido y documentado, no un fallo de este conversor:
## `pruebasMov.xml` (perímetro + spawn, sin ningún `wall` interior) se queda
## sin ninguna `BoxShape3D` en toda la escena, y el detector de puntos de
## cobertura de `ai/navigation` (`NavTestUtil.collect_map_boxes`) solo sabe
## buscar `BoxShape3D` — no la geometría de `Floor`. No es un mapa de
## `floor_config` ni de `GameAction::selectionMap`: es un banco de pruebas de
## movimiento de 2012 sin mobiliario. Corresponde a `ai/navigation` decidir si
## lo trata como el resto de prototipos sin sala jugable (como ya hace con
## `map_03.xml` vía `TINY_PROTOTYPES`) o si enseña a `CoverBaker` a leer
## también el trimesh del suelo.

@export var floor_vertices: PackedVector3Array = PackedVector3Array()
@export var floor_uvs: PackedVector2Array = PackedVector2Array()
@export var floor_indices: PackedInt32Array = PackedInt32Array()
## Zócalo vertical del perímetro (colisión únicamente; ver la nota grande de
## arriba, "BUG REAL Nº2"). No se dibuja: el aspecto visual del perímetro lo
## dan los `MeshInstance3D` de `Walls/PerimeterWall_i`.
@export var skirt_vertices: PackedVector3Array = PackedVector3Array()
@export var skirt_indices: PackedInt32Array = PackedInt32Array()


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


## Caras para la forma de colisión: la unión del suelo y el zócalo del
## perímetro, cada uno con su propio índice pero con el MISMO tratamiento —
## cada triángulo invertido (2º y 3er vértice intercambiados) respecto al
## orden "natural" con el que se generó — para que el horneado de
## NavigationServer3D los acepte. Ver las dos notas grandes de arriba.
func _collision_faces() -> PackedVector3Array:
	var faces := PackedVector3Array()
	_append_reversed(faces, floor_vertices, floor_indices)
	_append_reversed(faces, skirt_vertices, skirt_indices)
	return faces


static func _append_reversed(out: PackedVector3Array, verts: PackedVector3Array,
		idxs: PackedInt32Array) -> void:
	var n := idxs.size()
	var t := 0
	while t < n:
		out.append(verts[idxs[t]])
		out.append(verts[idxs[t + 2]])
		out.append(verts[idxs[t + 1]])
		t += 3
