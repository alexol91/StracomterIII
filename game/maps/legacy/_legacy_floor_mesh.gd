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


## `_ready()` tiene que ser idempotente, y no por elegancia: hay ayudantes de
## prueba que lo llaman A MANO para forzar la construcción perezosa del suelo
## sin meter el mapa en el árbol (`tests/ai/navigation/nav_test_util.gd:
## ensure_colliders_built`). Sin guardas, una segunda llamada añadiría un
## `FloorMesh` y un `FloorCollision` duplicados —geometría doble y colisión
## doble, sin un solo error— y volvería a conectarse a la señal.
func _ready() -> void:
	if get_node_or_null("FloorMesh") == null:
		_build()
	if not PresentationStyle.style_changed.is_connected(_on_style_changed):
		PresentationStyle.style_changed.connect(_on_style_changed)


func _build() -> void:
	if floor_vertices.is_empty() or floor_indices.is_empty():
		push_warning("%s: Floor sin geometría (perímetro vacío o degenerado)" % get_path())
		return

	var mesh := _build_mesh()

	mesh.surface_set_material(0, _floor_material())

	var mesh_instance := MeshInstance3D.new()
	mesh_instance.name = "FloorMesh"
	mesh_instance.mesh = mesh
	add_child(mesh_instance)

	var shape := ConcavePolygonShape3D.new()
	# Sólido por las DOS caras. El bobinado de estos triángulos está invertido
	# para que el horneador de navegación los acepte (ver la nota grande de
	# arriba), y un trimesh de una sola cara solo responde a la física desde el
	# lado al que mira: desde el otro se atraviesa como si no existiera.
	#
	# Dos consecuencias reales, vistas arrancando el juego y mirando: el
	# jugador se hundía 0,4 m por debajo del suelo, y el brazo de la cámara
	# atravesaba el zócalo del perímetro y dejaba la vista dentro del muro.
	# Este flag afecta a qué lado responde a la física, NO a qué bobinado
	# acepta el horneador, así que no deshace el arreglo de navegación.
	shape.backface_collision = true
	shape.set_faces(_collision_faces())

	var collision := CollisionShape3D.new()
	collision.name = "FloorCollision"
	collision.shape = shape
	add_child(collision)


## Malla visual del suelo, CON TANGENTES.
##
## Se construye con `SurfaceTool` y no montando los arrays a mano por una
## razón que costó una captura descubrir: un material con mapa de normales
## necesita el array de tangentes, y una malla sin él no se ilumina mal — se
## pinta NEGRA. El suelo salía como un agujero en mitad de la oficina mientras
## los muros, que son `BoxMesh` y sí traen tangentes de fábrica, se veían
## perfectos. Ningún error, ningún aviso: solo una planta negra.
func _build_mesh() -> ArrayMesh:
	var has_uvs := floor_uvs.size() == floor_vertices.size()
	var tool := SurfaceTool.new()
	tool.begin(Mesh.PRIMITIVE_TRIANGLES)
	# Los triángulos van INVERTIDOS respecto a `floor_indices`, igual que los de
	# la colisión. `convert.py:_ensure_ccw_up` los deja antihorarios vistos
	# desde +Y, que es la convención de OpenGL; la de Godot es la contraria —la
	# cara frontal es la HORARIA vista de frente—, así que tal cual venían, la
	# cara buena del suelo miraba hacia abajo.
	#
	# El síntoma no era un suelo invisible, que se habría notado enseguida: con
	# `cull_mode` por defecto Godot descartaba la cara y dejaba ver el fondo,
	# que en un interior cerrado es negro. La planta entera parecía un agujero
	# mal iluminado, y todo el trabajo de materiales encima no se veía. Se
	# localizó pintando el suelo de rojo: no apareció ni una mancha roja.
	var count := floor_indices.size()
	var t := 0
	while t < count:
		for offset: int in [0, 2, 1]:
			var i := floor_indices[t + offset]
			tool.set_normal(Vector3.UP)
			if has_uvs:
				tool.set_uv(floor_uvs[i])
			tool.add_vertex(floor_vertices[i])
		t += 3
	if has_uvs:
		tool.generate_tangents()
	tool.index()
	return tool.commit()


## El nivel no elige con qué se pinta: se lo pide al estilo activo, y así
## `: chutaos on|off` cambia el mundo entero sin que este fichero se entere.
## Si el estilo no diera material (recurso ausente), se cae a un gris plano
## antes que dejar la superficie sin material: sin él Godot la pinta de un
## magenta chillón que parece un fallo del mapa y no del estilo.
func _floor_material() -> Material:
	var styled := PresentationStyle.surface_material(WorldSurface.Kind.FLOOR)
	if styled != null:
		return styled
	var fallback := StandardMaterial3D.new()
	fallback.albedo_color = Color(0.55, 0.55, 0.58)
	return fallback


## Repinta al vuelo cuando cambia el estilo. Sin esto, `: chutaos on` solo
## afectaría a las plantas que se carguen después, y el truco parecería roto
## justo donde el jugador está mirando.
func _on_style_changed(_chutaos: bool) -> void:
	var mesh_instance := get_node_or_null("FloorMesh") as MeshInstance3D
	if mesh_instance == null or mesh_instance.mesh == null:
		return
	(mesh_instance.mesh as ArrayMesh).surface_set_material(0, _floor_material())


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
