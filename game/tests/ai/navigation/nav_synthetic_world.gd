class_name NavSyntheticWorld
extends WorldQuery
## Mundo de prueba: geometría descrita como cajas e intersección rayo-caja
## analítica, sin `PhysicsServer3D`, sin escena y sin frames.
##
## Es la costura que describe `world_query.gd`: la implementación real usa
## física y navmesh; las pruebas inyectan esto y el horneado de cobertura se
## puede verificar en milisegundos y de forma perfectamente determinista.
##
## Lleva también el `NavService` y el navmesh horneados de la MISMA geometría,
## para que el escenario de una prueba sea un solo objeto.
##
## Fichero propio y no clase interna de `NavTestUtil`: una clase interna que
## extiende una clase global y que sostiene referencias a otras clases del
## proyecto impide que Godot descargue el script al salir, y eso aparece como
## "ObjectDB instances were leaked at exit". Verificado en 4.7.2.

var boxes: Array[AABB] = []
## Cajas con rotación (los muros de los mapas convertidos no están alineados
## con los ejes). Se guardan la transformada y el tamaño; el rayo se lleva al
## espacio local de la caja y se resuelve ahí con el mismo test de rodajas.
var oriented_transforms: Array[Transform3D] = []
var oriented_sizes: PackedVector3Array = PackedVector3Array()
## AABB envolvente de cada caja orientada, para descartarlas a coste cero.
var _oriented_bounds: Array[AABB] = []

var nav: NavService = null
var mesh: NavigationMesh = null


## Añade una caja orientada (transformada + tamaño local centrado en el
## origen), que es como vienen los `BoxShape3D` de las escenas de mapa.
func add_oriented_box(transform: Transform3D, size: Vector3) -> void:
	oriented_transforms.append(transform)
	oriented_sizes.append(size)
	var local := AABB(-size * 0.5, size)
	var bounds := AABB(transform * local.position, Vector3.ZERO)
	for i in 8:
		bounds = bounds.expand(transform * local.get_endpoint(i))
	_oriented_bounds.append(bounds)


func oriented_box_count() -> int:
	return oriented_transforms.size()


func dispose() -> void:
	if nav != null:
		nav.dispose()
		nav = null
	mesh = null


func raycast(from: Vector3, to: Vector3, _collision_mask: int = 1) -> Vector3:
	var delta := to - from
	var length := delta.length()
	if length < 0.000001:
		return Vector3.INF
	var dir := delta / length
	var best := INF
	for box: AABB in boxes:
		# `hit_from_inside = false`, como la consulta física real: un rayo que
		# nace dentro de un cuerpo no lo reporta.
		if box.has_point(from):
			continue
		var t := _ray_box(from, dir, length, box)
		if t >= 0.0 and t < best:
			best = t
	if not oriented_transforms.is_empty():
		# Envolvente del propio rayo: con sondas de 2 m descarta casi todos los
		# muros del mapa antes de hacer una sola cuenta.
		var ray_bounds := AABB(from, Vector3.ZERO).expand(to)
		for i in oriented_transforms.size():
			if not _oriented_bounds[i].intersects(ray_bounds):
				continue
			var inverse := oriented_transforms[i].affine_inverse()
			var local_from := inverse * from
			var size := oriented_sizes[i]
			var local_box := AABB(-size * 0.5, size)
			if local_box.has_point(local_from):
				continue
			var local_dir := (inverse.basis * dir).normalized()
			var t := _ray_box(local_from, local_dir, length, local_box)
			if t >= 0.0 and t < best:
				best = t
	if is_inf(best):
		return Vector3.INF
	return from + dir * best


func has_line_of_sight(from: Vector3, to: Vector3,
		collision_mask: int = 1) -> bool:
	return not raycast(from, to, collision_mask).is_finite()


func snap_to_navmesh(point: Vector3) -> Vector3:
	return Vector3.INF if nav == null else nav.snap_to_navmesh(point)


func path(from: Vector3, to: Vector3) -> PackedVector3Array:
	return PackedVector3Array() if nav == null else nav.path(from, to)


func path_cost(from: Vector3, to: Vector3) -> float:
	return INF if nav == null else nav.path_cost(from, to)


func disjoint_routes(from: Vector3, to: Vector3,
		max_routes: int = 2) -> Array[PackedVector3Array]:
	return [] if nav == null else nav.disjoint_routes(from, to, max_routes)


static func _ray_box(from: Vector3, dir: Vector3, length: float,
		box: AABB) -> float:
	var tmin := 0.0
	var tmax := length
	for axis in 3:
		var origin := from[axis]
		var d := dir[axis]
		var lo := box.position[axis]
		var hi := lo + box.size[axis]
		if absf(d) < 0.000000001:
			if origin < lo or origin > hi:
				return -1.0
			continue
		var t1 := (lo - origin) / d
		var t2 := (hi - origin) / d
		if t1 > t2:
			var swap := t1
			t1 = t2
			t2 = swap
		tmin = maxf(tmin, t1)
		tmax = minf(tmax, t2)
		if tmin > tmax:
			return -1.0
	return tmin
