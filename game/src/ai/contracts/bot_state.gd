class_name BotState
extends RefCounted
## Instantánea PURA del estado de un bot, sin referencias a nodos.
##
## Existe para que todas las funciones de puntuación de la IA sean puras y
## deterministas: `(BotState, Blackboard) -> float`. Esa es la razón por la que
## la IA de este proyecto se puede probar en `godot --headless` sin escena,
## sin GPU y sin instanciar un solo nodo — y por tanto la razón por la que se
## puede probar de verdad.
##
## Quien construye estas instantáneas es el cerebro del bot; quien las consume
## son las funciones de utilidad y el director de escuadra.

var bot_id: int = 0
var squad_id: int = 0
var archetype: StringName = &""
var team: int = 0

@warning_ignore("unused_private_class_variable")
var position: Vector3 = Vector3.ZERO
var forward: Vector3 = Vector3.FORWARD

## 0..1
var health_ratio: float = 1.0
## 0..1
var ammo_ratio: float = 1.0
var is_crouched: bool = false
var is_reloading: bool = false

## Distancia al contacto de mayor confianza, en metros. INF si no hay contacto.
var distance_to_target_m: float = INF
## ¿Hay línea de visión despejada al objetivo AHORA?
var has_line_of_sight: bool = false
## Confianza en la posición del objetivo, 0..1.
var target_confidence: float = 0.0
## Exposición de la posición actual: 0 = a cubierto, 1 = a pecho descubierto.
var exposure: float = 1.0
## ¿Está el bot actualmente en un punto de cobertura?
var in_cover: bool = false
## Rol asignado por el director de escuadra.
var role: Blackboard.Role = Blackboard.Role.NONE
## ¿Tiene la escuadra supresión activa? Condición para asaltar.
var squad_has_suppression: bool = false
## Fracción de efectivos vivos de la escuadra, 0..1. Umbral de repliegue: 0,4.
var squad_strength: float = 1.0
## Número de amenazas conocidas.
var known_threat_count: int = 0
## Segundos desde el último contacto visual.
var time_since_last_seen_s: float = INF
## Segundos que el bot lleva ejecutando su comportamiento actual. Base de la
## histéresis: sin tiempo mínimo de compromiso, un selector por utilidad
## produce bots que cambian de idea cada tick y parecen epilépticos.
var time_in_behavior_s: float = 0.0
var current_behavior: int = 0


func duplicate_state() -> BotState:
	var copy := BotState.new()
	copy.bot_id = bot_id
	copy.squad_id = squad_id
	copy.archetype = archetype
	copy.team = team
	copy.position = position
	copy.forward = forward
	copy.health_ratio = health_ratio
	copy.ammo_ratio = ammo_ratio
	copy.is_crouched = is_crouched
	copy.is_reloading = is_reloading
	copy.distance_to_target_m = distance_to_target_m
	copy.has_line_of_sight = has_line_of_sight
	copy.target_confidence = target_confidence
	copy.exposure = exposure
	copy.in_cover = in_cover
	copy.role = role
	copy.squad_has_suppression = squad_has_suppression
	copy.squad_strength = squad_strength
	copy.known_threat_count = known_threat_count
	copy.time_since_last_seen_s = time_since_last_seen_s
	copy.time_in_behavior_s = time_in_behavior_s
	copy.current_behavior = current_behavior
	return copy
