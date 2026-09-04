class_name WorldQueryComposite
extends WorldQuery
## Une un backend de física y uno de navegación en un único `WorldQuery`.
##
## Existe para resolver una duplicación que ya costó un bug. `WorldQuery` mezcla
## dos familias de preguntas —«¿veo eso?», que es física, y «¿cuánto cuesta
## llegar?», que es navegación— y ambos módulos acabaron implementando el
## contrato ENTERO, cada uno con su propio raycast. Dos implementaciones del
## mismo rayo divergen: una de ellas concedía visión por defecto cuando aún no
## había espacio de física, es decir, rayos X a cualquier bot creado antes de
## que el nivel enlazara la física. El bug del legacy que este módulo existe
## para matar, resucitado por duplicación.
##
## La solución no es fusionar las dos clases: un bot que pregunta si ve una
## pared no debería depender de un servicio con estado de nivel (mapa, regiones,
## rehorneado, cola de caminos). La solución es que cada backend responda solo
## de lo suyo y que esto los componga.
##
## Los backends se tipan como `WorldQuery` a propósito: así los tests pueden
## inyectar dobles en cualquiera de los dos lados por separado — física real con
## navegación falsa, o al revés — que es justo lo que hace falta para probar el
## oído sin hornear un nivel.

## Responde a `raycast` y `has_line_of_sight`.
var physics: WorldQuery = null
## Responde a `snap_to_navmesh`, `path_cost`, `path` y `disjoint_routes`.
var navigation: WorldQuery = null


func _init(p_physics: WorldQuery = null, p_navigation: WorldQuery = null) -> void:
	physics = p_physics
	navigation = p_navigation


## Sin backend de física NO se concede visión. El valor por defecto de una
## consulta de oclusión no puede ser permisivo: ante la duda, no se ve.
func has_line_of_sight(from: Vector3, to: Vector3, collision_mask: int = 1) -> bool:
	if physics == null:
		return false
	return physics.has_line_of_sight(from, to, collision_mask)


func raycast(from: Vector3, to: Vector3, collision_mask: int = 1) -> Vector3:
	if physics == null:
		return Vector3.INF
	return physics.raycast(from, to, collision_mask)


func snap_to_navmesh(point: Vector3) -> Vector3:
	if navigation == null:
		return Vector3.INF
	return navigation.snap_to_navmesh(point)


## Sin backend de navegación se devuelve la distancia recta, no INF. INF
## *afirma* que no hay paso, y en un nivel sin hornear eso amortiguaría todos
## los ruidos y dejaría sordos a los bots sin dar un solo error.
func path_cost(from: Vector3, to: Vector3) -> float:
	if navigation == null:
		return from.distance_to(to)
	return navigation.path_cost(from, to)


func path(from: Vector3, to: Vector3) -> PackedVector3Array:
	if navigation == null:
		return PackedVector3Array()
	return navigation.path(from, to)


func disjoint_routes(from: Vector3, to: Vector3, max_routes: int = 2) -> Array[PackedVector3Array]:
	if navigation == null:
		return []
	return navigation.disjoint_routes(from, to, max_routes)


## ¿Están los dos lados enlazados? Un sistema que dependa de ambos debería
## comprobarlo al arrancar en vez de descubrirlo por comportamiento raro.
func is_complete() -> bool:
	return physics != null and navigation != null
