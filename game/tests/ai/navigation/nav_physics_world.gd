class_name NavPhysicsWorld
extends RefCounted
## Física REAL para las pruebas de integración de mapas.
##
## Existe porque el doble no basta aquí. `NavSyntheticWorld` resuelve los rayos
## contra cajas, y los mapas convertidos dejaron de ser cajas: el suelo y el
## zócalo del perímetro son un `ConcavePolygonShape3D`. Un test que hornea
## cobertura contra cajas no mide lo que hace el juego — mide un mundo que ya
## no se parece al mapa. Verde y mentiroso.
##
## Aquí se registran las formas de colisión REALES de la escena en el espacio
## físico del árbol y se consultan con `PhysicsDirectSpaceState3D`, que es
## exactamente lo que hace producción. La única diferencia con el juego es
## quién da de alta los cuerpos: aquí este objeto, allí el árbol de escena.
##
## El rayo NO se reimplementa: lo contesta `WorldQueryPhysics`, la misma clase
## que usa la percepción. Ya hubo dos copias del mismo rayo en este proyecto y
## divergieron; no se añade una tercera.
##
## Hay que llamar a `dispose()`: los RID de física no los libera nadie más.

## El `WorldQuery` de producción, listo para inyectar en `CoverBaker`.
var query: WorldQueryPhysics = null

var _space: RID = RID()
var _body: RID = RID()
var _shape_count: int = 0


func shape_count() -> int:
	return _shape_count


## Da de alta las formas de colisión de `root` en el espacio físico del árbol.
##
## Se usa el espacio del árbol y no uno propio a propósito: es el único que
## está activo y sincronizado durante el `_ready` del ejecutor de pruebas, que
## es cuando corren las pruebas. Un espacio recién creado no se ha pisado
## todavía y sus consultas no responden.
func build_from(root: Node, tree: SceneTree) -> int:
	dispose()
	NavTestUtil.ensure_colliders_built(root)
	_space = tree.root.world_3d.space
	_body = PhysicsServer3D.body_create()
	PhysicsServer3D.body_set_mode(_body, PhysicsServer3D.BODY_MODE_STATIC)
	PhysicsServer3D.body_set_collision_layer(_body, NavTuning.WORLD_COLLISION_MASK)
	PhysicsServer3D.body_set_space(_body, _space)
	for entry: Array in NavTestUtil.collect_collision_shapes(root):
		var shape: Shape3D = entry[1]
		PhysicsServer3D.body_add_shape(_body, shape.get_rid(), entry[0] as Transform3D)
		_shape_count += 1
	query = WorldQueryPhysics.new(PhysicsServer3D.space_get_direct_state(_space))
	return _shape_count


func dispose() -> void:
	if _body.is_valid():
		PhysicsServer3D.free_rid(_body)
	_body = RID()
	_space = RID()
	_shape_count = 0
	query = null
