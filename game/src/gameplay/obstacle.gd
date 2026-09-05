class_name Obstacle
extends StaticBody3D
## Mobiliario de oficina: modelo, colisión y altura de cobertura. Réplica de
## `Core::Obstacles` (legacy, `CoreNamespace.h:57-70`; `Obstacle.cc`): 8
## subtipos, sin vida ni destrucción, solo bloquean movimiento y disparo.
##
## Este fichero solo EXPONE el dato de cobertura (altura que protege, si
## bloquea línea de visión). Quién lo CONSULTA para hornear la nube de puntos
## de cobertura o decidir dónde ponerse es `ai/` (GDD §8.3); `gameplay/` no
## calcula puntuaciones de cobertura, solo las hace consultables.

## Réplica exacta de los 8 subtipos del legacy, mismo orden que el enum
## original (`obs_table=0 … obs_mesaConSillas=7`).
enum Kind { TABLE, DESK, COUCH, SOFA, CHAIR, SHELF, PLANT_POT, TABLE_WITH_CHAIRS }

## Hasta dónde protege este obstáculo de un disparo.
enum CoverHeight {
	NONE, ## No detiene balas (p. ej. una planta de interior).
	LOW,  ## Protege agachado, no de pie.
	HIGH, ## Protege también de pie.
}

const MODELS_DIR: String = "res://assets/models/props/"
const MATERIALS_CHUTAOS: String = "res://assets/materials/props/chutaos/"
const MATERIALS_MODERN: String = "res://assets/materials/props/modern/"

## Modelo de 2012 de cada subtipo. El reparto es el que hacía
## `core/lib/ResourceManager.cc:783-821`, no una elección nueva.
const MODEL_BY_KIND: Dictionary[Kind, String] = {
	Kind.TABLE: "mesa",
	Kind.DESK: "desk",
	Kind.COUCH: "sillon",
	Kind.SOFA: "sofa",
	Kind.CHAIR: "sillaEspera",
	Kind.SHELF: "estanteria",
	Kind.PLANT_POT: "plant",
	Kind.TABLE_WITH_CHAIRS: "mesaSillas",
}

## Nombre del material propio de cada subtipo, sin extensión. En el estilo
## chutaos existen los ocho, con la textura original de cada mueble; en el
## moderno solo los que no son melamina, y el resto cae en la superficie PROP
## común del mundo.
const MATERIAL_BY_KIND: Dictionary[Kind, String] = {
	Kind.TABLE: "table",
	Kind.DESK: "desk",
	Kind.COUCH: "couch",
	Kind.SOFA: "sofa",
	Kind.CHAIR: "chair",
	Kind.SHELF: "shelf",
	Kind.PLANT_POT: "plant_pot",
	Kind.TABLE_WITH_CHAIRS: "table_with_chairs",
}

## Subtipos que en el estilo moderno tienen material propio en vez del PROP
## genérico: la tapicería del sofá y el sillón, y el verde de la planta. Un
## sofá gris melamina y una planta gris no se leen como lo que son.
const MODERN_SPECIAL: Dictionary[Kind, String] = {
	Kind.COUCH: "upholstery",
	Kind.SOFA: "upholstery",
	Kind.PLANT_POT: "foliage",
}

## Por debajo de esto un mueble no tapa a nadie; por encima, tapa también de
## pie. Entre medias, protege agachado. Los umbrales están en metros y salen de
## la altura de ojos del personaje (GDD §9), no de la lista de muebles.
const COVER_LOW_M: float = 0.45
const COVER_HIGH_M: float = 1.20

@export var kind: Kind = Kind.TABLE:
	set(value):
		kind = value
		_apply_kind_defaults()

## Altura de cobertura efectiva. Se deriva de la altura real del modelo
## (`default_cover_for`); se puede sobrescribir por instancia en el editor.
@export var cover_height: CoverHeight = CoverHeight.LOW
## Si es true, rompe la línea de visión aunque no proteja de balas.
## GDD §9: "una planta de interior no protege nada pero rompe la línea de
## visión, que a veces vale más".
@export var blocks_line_of_sight: bool = true

var _visual: Node3D = null


func _ready() -> void:
	add_to_group(&"obstacles")
	# Ver la nota del mismo grupo en `door.gd`: cuando `WorldDressing` recorre
	# el mapa, este mueble todavía era un marcador.
	add_to_group(&"self_dressed")
	_build_visual()
	_apply_style()
	PresentationStyle.style_changed.connect(_on_style_changed)


## Altura de cobertura por defecto de cada subtipo, medida sobre el modelo que
## el jugador ve de verdad.
##
## Antes era una lista escrita a mano, y decía que el sofá tapaba de pie.
## Mide 63 cm. Una lista y una geometría que se contradicen es el fallo que
## este proyecto ya conoce —el mundo de prueba más amable que el real— pero al
## revés: el jugador se parapeta detrás de algo que la IA cree alto, asoma la
## cabeza y se la vuelan sin entender por qué. Derivándolo de la malla no
## pueden separarse.
static func default_cover_for(k: Kind) -> CoverHeight:
	# La maceta es la única excepción, y es del GDD, no de la geometría: mide lo
	# suficiente para tapar y aun así no detiene una bala. Vale por la línea de
	# visión, no por la protección.
	if k == Kind.PLANT_POT:
		return CoverHeight.NONE
	var height := model_height_for(k)
	if height >= COVER_HIGH_M:
		return CoverHeight.HIGH
	if height >= COVER_LOW_M:
		return CoverHeight.LOW
	return CoverHeight.NONE


## Altura en metros del modelo de un subtipo, o 0 si no hay modelo. Se mide
## sobre la escena importada: si alguien reexporta un mueble más alto, la
## cobertura cambia con él y nadie tiene que acordarse de actualizar una tabla.
static func model_height_for(k: Kind) -> float:
	var packed := _model_scene(k)
	if packed == null:
		return 0.0
	var node := packed.instantiate() as Node3D
	if node == null:
		return 0.0
	var bounds := _local_bounds(node, Transform3D.IDENTITY)
	node.free()
	return bounds.size.y


static func _model_scene(k: Kind) -> PackedScene:
	var name: String = MODEL_BY_KIND.get(k, "")
	if name.is_empty():
		return null
	var path := MODELS_DIR + name + ".gltf"
	if not ResourceLoader.exists(path):
		return null
	return load(path) as PackedScene


## Caja que envuelve toda la malla de un subárbol, en coordenadas locales de la
## raíz. `get_aabb()` de cada `MeshInstance3D` está en SU espacio, así que hay
## que acumular la transformada por el camino o los muebles con jerarquía
## —mesaSillas, estantería— salen medidos de menos.
static func _local_bounds(node: Node, accumulated: Transform3D) -> AABB:
	var here := accumulated
	var spatial := node as Node3D
	if spatial != null:
		here = accumulated * spatial.transform
	var bounds := AABB()
	var found := false
	var mesh_instance := node as MeshInstance3D
	if mesh_instance != null and mesh_instance.mesh != null:
		bounds = here * mesh_instance.get_aabb()
		found = true
	for child: Node in node.get_children():
		var child_bounds := _local_bounds(child, here)
		if child_bounds.size == Vector3.ZERO:
			continue
		bounds = child_bounds if not found else bounds.merge(child_bounds)
		found = true
	return bounds


## Monta el modelo de 2012 y ajusta la colisión a lo que se ve.
##
## Hasta ahora esto era una caja gris de 0,9 × 0,75 × 0,6 para todos los
## muebles, con los diez modelos del equipo sin usar en el repositorio. Peor
## que feo: un escritorio de 2,15 m bloqueaba 0,9 m, así que el jugador se
## parapetaba detrás de lo que veía y le disparaban por un hueco que no
## existía en pantalla.
func _build_visual() -> void:
	var placeholder := get_node_or_null("Mesh")
	var packed := _model_scene(kind)
	if packed == null:
		# Ante la duda, se deja la caja: un obstáculo invisible que aun así
		# bloquea el paso es peor que uno feo.
		push_warning("Obstacle: sin modelo para '%s', se deja el bloque" % Kind.keys()[kind])
		return
	if placeholder != null:
		placeholder.queue_free()
	_visual = packed.instantiate() as Node3D
	_visual.name = "Model"
	add_child(_visual)

	var bounds := _local_bounds(_visual, Transform3D.IDENTITY)
	if bounds.size == Vector3.ZERO:
		return
	var collision := get_node_or_null("CollisionShape3D") as CollisionShape3D
	if collision == null:
		return
	# Forma nueva por instancia: la del .tscn es un `SubResource` COMPARTIDO
	# entre todos los obstáculos, así que redimensionarla ahí cambiaría el
	# tamaño de todos los muebles del mapa a la vez.
	var box := BoxShape3D.new()
	box.size = bounds.size
	collision.shape = box
	collision.position = bounds.position + bounds.size * 0.5


func _apply_style() -> void:
	if _visual == null:
		return
	var material := _material_for_style()
	if material == null:
		return
	for node: Node in _mesh_instances(_visual):
		var mesh_instance := node as MeshInstance3D
		for i: int in range(mesh_instance.get_surface_override_material_count()):
			mesh_instance.set_surface_override_material(i, material)


## Material del subtipo en el estilo activo. En chutaos, la textura original
## del mueble; en el remake, tapicería o follaje si le toca, y si no la
## superficie PROP común del mundo, que es la que ya cumple la regla de ser más
## oscura que la pared.
func _material_for_style() -> Material:
	if PresentationStyle.chutaos_mode:
		var own: String = MATERIAL_BY_KIND.get(kind, "")
		if not own.is_empty():
			var path := MATERIALS_CHUTAOS + own + ".tres"
			if ResourceLoader.exists(path):
				return load(path) as Material
	else:
		var special: String = MODERN_SPECIAL.get(kind, "")
		if not special.is_empty():
			var path := MATERIALS_MODERN + special + ".tres"
			if ResourceLoader.exists(path):
				return load(path) as Material
	return PresentationStyle.surface_material(WorldSurface.Kind.PROP)


static func _mesh_instances(node: Node) -> Array[Node]:
	var out: Array[Node] = []
	if node is MeshInstance3D:
		out.append(node)
	for child: Node in node.get_children():
		out.append_array(_mesh_instances(child))
	return out


func _on_style_changed(_chutaos: bool) -> void:
	_apply_style()


## Se aplica también fuera del árbol a propósito. `LevelLoader` asigna `kind` y
## SOLO DESPUÉS hace `add_child`, así que con la guarda `is_inside_tree()` que
## había aquí antes esto no llegaba a ejecutarse nunca: todos los muebles de
## todos los mapas se quedaban con la cobertura por defecto de una mesa, y una
## estantería de 1,40 m tapaba lo mismo que una silla. Sin ningún error.
func _apply_kind_defaults() -> void:
	cover_height = default_cover_for(kind)
	blocks_line_of_sight = true
