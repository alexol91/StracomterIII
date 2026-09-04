class_name WorldQuery
extends RefCounted
## Interfaz de consultas al mundo, INYECTABLE.
##
## Es la costura que hace testeable la IA. La implementación real usa
## PhysicsDirectSpaceState3D y NavigationServer3D; los tests inyectan una
## implementación sintética con geometría descrita a mano, y así un test de
## comportamiento corre en `--headless` en milisegundos y sin escena.
##
## Toda implementación debe respetar el presupuesto de raycasts del
## AIScheduler (ADR-002): devuelve el número de raycasts consumidos donde
## la firma lo pide.

## ¿Hay línea de visión despejada entre dos puntos?
## `collision_mask` por defecto: capa 1 ("world").
##
## El valor por defecto es **false**, y no es un detalle. Devolver `true` aquí
## convierte este contrato en una trampa: cualquier implementación que herede y
## no sobrescriba —o que decida dejar de responder preguntas de física— concede
## visión a través de las paredes, sin error y sin aviso. Es el fallo del legacy
## que este subsistema existe para matar (`Bot.cc` comprobaba inclusión en un
## triángulo sin mirar si había pared en medio), y ya se coló una vez por esta
## puerta.
##
## Regla general del contrato: el valor por defecto de una consulta de la que
## depende una decisión de justicia nunca puede ser el permisivo. Ante la duda,
## no se ve.
func has_line_of_sight(_from: Vector3, _to: Vector3, _collision_mask: int = 1) -> bool:
	return false


## Primer punto de impacto de un rayo, o `Vector3.INF` si no impacta.
func raycast(_from: Vector3, _to: Vector3, _collision_mask: int = 1) -> Vector3:
	return Vector3.INF


## Proyecta un punto al navmesh. Devuelve `Vector3.INF` si no es navegable.
func snap_to_navmesh(_point: Vector3) -> Vector3:
	return Vector3.INF


## Coste de camino entre dos puntos, en metros. INF si no hay ruta.
## Es lo que permite estimar la propagación del sonido por la geometría real
## en lugar de por distancia recta.
func path_cost(_from: Vector3, _to: Vector3) -> float:
	return INF


## Ruta completa entre dos puntos. Array vacío si no hay ruta.
func path(_from: Vector3, _to: Vector3) -> PackedVector3Array:
	return PackedVector3Array()


## Hasta `max_routes` rutas que NO comparten tramos, para el flanqueo.
## Devuelve un array de rutas; el índice es el `route_id` que se reclama en
## la pizarra.
func disjoint_routes(_from: Vector3, _to: Vector3, _max_routes: int = 2) -> Array[PackedVector3Array]:
	return []
