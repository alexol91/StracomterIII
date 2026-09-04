class_name WorldQueryPhysics
extends WorldQuery
## Backend de FÍSICA de `WorldQuery`: la fuente de verdad de "¿veo eso?".
##
## Responde solo a `raycast` y `has_line_of_sight`. Las preguntas de navegación
## —coste de camino, proyección al navmesh, rutas de flanqueo— las responde
## `NavService`, y `WorldQueryComposite` junta las dos mitades. Cada rayo del
## juego sale de aquí: había dos implementaciones del mismo raycast y una de
## ellas concedía visión cuando aún no había espacio de física, lo que daba
## rayos X a cualquier bot creado antes de que el nivel enlazara la física.
## Un solo rayo, un solo sitio donde equivocarse.
##
## Es el único punto de todo `ai/perception/` que toca el motor. Todo lo demás
## habla con la interfaz, y por eso se prueba sin escena.
##
## AVISO DE HILO: `PhysicsDirectSpaceState3D` solo es válido dentro del paso de
## física. El `AIScheduler` corre en `_process`, así que quien construya esta
## clase debe refrescar el espacio con `bind_space()` desde `_physics_process`
## (o pasar el `World3D` y dejar que se resuelva solo).

## Espacio de física del nivel. Sin él no se concede ninguna visión.
var space_state: PhysicsDirectSpaceState3D = null
## Cuerpos excluidos de los raycast (el propio bot, típicamente).
var exclude: Array[RID] = []


func _init(p_space: PhysicsDirectSpaceState3D = null) -> void:
	space_state = p_space


## Refresca el espacio de física. Debe llamarse desde `_physics_process`.
func bind_space(p_space: PhysicsDirectSpaceState3D) -> void:
	space_state = p_space


## Toma el espacio de física de un `World3D`. La navegación de ese mismo mundo
## la gestiona `NavService`, no esta clase.
func bind_world(world: World3D) -> void:
	if world == null:
		return
	space_state = world.direct_space_state


## Excluye cuerpos de los raycast (el cuerpo del propio bot).
func set_exclude(bodies: Array[RID]) -> void:
	exclude = bodies


func is_ready() -> bool:
	return space_state != null


# ---- Física ----

## ¿Hay línea de visión despejada? `collision_mask` por defecto: capa 1
## ("world", ver `project.godot`).
##
## Sin espacio de física devuelve `false`, NUNCA `true`. El valor por defecto
## de una consulta de oclusión no puede ser permisivo: un `false` de más deja a
## un bot ciego un instante y se nota en cuanto se prueba; un `true` de más le
## da visión a través de las paredes y no se nota nunca.
func has_line_of_sight(from: Vector3, to: Vector3, collision_mask: int = 1) -> bool:
	if space_state == null:
		return false
	var query := PhysicsRayQueryParameters3D.create(from, to, collision_mask, exclude)
	query.hit_from_inside = false
	query.collide_with_areas = false
	query.collide_with_bodies = true
	return space_state.intersect_ray(query).is_empty()


## Primer punto de impacto, o `Vector3.INF` si no impacta.
func raycast(from: Vector3, to: Vector3, collision_mask: int = 1) -> Vector3:
	if space_state == null:
		return Vector3.INF
	var query := PhysicsRayQueryParameters3D.create(from, to, collision_mask, exclude)
	query.hit_from_inside = false
	query.collide_with_areas = false
	query.collide_with_bodies = true
	var hit := space_state.intersect_ray(query)
	if hit.is_empty():
		return Vector3.INF
	var hit_position: Vector3 = hit.get("position", Vector3.INF)
	return hit_position


# ---- Navegación: no es de aquí ----
#
# `snap_to_navmesh`, `path_cost`, `path` y `disjoint_routes` se heredan de
# `WorldQuery` sin implementar A PROPÓSITO. Quien necesite las dos familias de
# preguntas debe componer:
#
#     var world := WorldQueryComposite.new(physics, nav_service)
#
# Esta clase tenía antes su propia caché de coste de camino. Se ha retirado:
# dos cachés del mismo dato divergen igual que divergían los dos raycast, y la
# de `NavService` ya se invalida sola al abrirse una puerta o demolerse un muro
# (`add_cache_dependent`). Un solo dato, un solo dueño.
