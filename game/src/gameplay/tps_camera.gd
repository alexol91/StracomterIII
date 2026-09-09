class_name TPSCamera
extends Node3D
## Cámara en tercera persona sobre el hombro, con `SpringArm3D` para colisión
## contra el entorno, y modo cenital conmutable (paridad `[P17]` / evolutivo
## `E-11` del GDD §2).
##
## Estructura de nodos esperada (la crea `player.tscn`):
##   TPSCamera (este script)
##   └── SpringArm3D  (colisión automática contra la capa "world")
##        └── Camera3D
##
## El remapeo de sensibilidad definitivo (GDD §10, accesibilidad) lo expone
## `Settings`/`ui-ux`; este nodo solo publica `mouse_sensitivity` y
## `gamepad_sensitivity_rad_s` como propiedades ajustables en caliente.

enum Mode { THIRD_PERSON, TOP_DOWN }

@export var target_path: NodePath
@export var mouse_sensitivity: float = 0.0025
@export var gamepad_sensitivity_rad_s: float = 3.0
## Desplazamiento del brazo respecto al objetivo: X = al hombro, Y = altura.
@export var shoulder_offset: Vector3 = Vector3(0.5, 1.5, 0.0)
@export var min_pitch_deg: float = -60.0
@export var max_pitch_deg: float = 70.0
@export var tps_spring_length_m: float = 4.0
@export var aim_spring_length_m: float = 2.4
@export var top_down_height_m: float = 14.0
@export var top_down_pitch_deg: float = -80.0
## Velocidad de interpolación al cambiar de modo o al apuntar (ADS).
@export var transition_speed: float = 6.0

const GAMEPAD_LOOK_DEADZONE: float = 0.2
## Píxeles de un solo evento de ratón que se aceptan como movimiento real.
##
## Un evento puede llegar con la distancia ENTERA que ha recorrido el cursor
## desde que la ventana perdió el foco —medido al arrancar el juego: 2060 px en
## el primer evento, que a esta sensibilidad son 295° de golpe—. Se recorta en
## vez de descartarse: un giro rápido de verdad sigue girando lo que cabe, y
## nadie pierde su movimiento.
const MAX_MOUSE_STEP_PX: float = 200.0
## Elevación extra del pivote cuando el brazo está colapsado del todo, en
## metros. En un rincón la cámara pasa de «sobre el hombro» a «sobre la
## cabeza», que es la vista que sí queda libre.
const COLLAPSE_LIFT_M: float = 0.35
## Por debajo de esta distancia entre la cámara y la cabeza, el modelo del
## PROPIO jugador se esconde. No es un truco: si el brazo se ha colapsado
## tanto, lo único que queda en pantalla es su nuca, y esconderlo devuelve la
## vista sin mover la cámara a un sitio donde no cabe.
const SELF_HIDE_M: float = 1.05
## Radio alrededor del eje cámara→cabeza dentro del cual un cuerpo se
## considera que tapa el plano.
const OCCLUDER_RADIUS_M: float = 0.75
## Transparencia que se aplica a un aliado que tapa. No 1,0: que se adivine
## dónde está sigue siendo información útil.
const OCCLUDER_TRANSPARENCY: float = 0.75
## world | player | companion | enemy | door — igual que `WeaponSystem.HIT_MASK`
## (ver `project.godot` → `[layer_names]`). Duplicada a propósito: este nodo
## no depende de `weapon_system.gd`, solo comparte el mismo mapa de capas.
const AIM_RAY_MASK: int = 79
## Metros que el punto de mira va SIEMPRE por delante del jugador. Ver
## `resolve_aim_point`: sin este suelo, un impacto cercano deja el punto de
## mira encima del propio cuerpo.
const AIM_AHEAD_OF_PLAYER_M: float = 1.5

var mode: Mode = Mode.THIRD_PERSON
var target: Node3D = null
var _yaw: float = 0.0
var _pitch: float = 0.0
## Cuerpos a los que se les ha tocado la transparencia, para poder devolverla.
var _faded: Array[Node3D] = []

@onready var _spring_arm: SpringArm3D = $SpringArm3D
@onready var _camera: Camera3D = $SpringArm3D/Camera3D


func _ready() -> void:
	target = get_node_or_null(target_path) as Node3D
	# El rig cuelga del jugador en la escena, pero NO puede heredar su giro.
	#
	# Si lo hereda se cierra un bucle: `PlayerInput` apunta a donde mira la
	# cámara, `CharacterController` gira el cuerpo hacia ese punto, y como la
	# cámara es hija del cuerpo, gira con él — así que el punto de mira se ha
	# movido y hay que volver a girar. El jugador daba vueltas sobre sí mismo
	# en cuanto tocabas el ratón, y moverse dejaba de funcionar porque la
	# dirección de WASD sale de la base de la cámara, que estaba girando.
	#
	# `top_level` corta la herencia y deja que este script mande del todo, que
	# es lo que ya hacía: escribe `global_position` en cada paso de física.
	top_level = true
	_spring_arm.collision_mask = 1 # solo "world": el entorno empuja la cámara
	_spring_arm.spring_length = tps_spring_length_m
	# El brazo coloca la cámara EN el punto de impacto, es decir, pegada a la
	# superficie: con el plano cercano por delante, medio fotograma queda
	# dentro del muro. Con el margen se para antes. Se vio arrancando el juego
	# en la planta 1, donde el jugador aparece junto a una esquina cóncava y la
	# vista salía llena de pared.
	_spring_arm.margin = 0.35
	# Y con FORMA, no con rayo. El brazo por defecto lanza un rayo de grosor
	# cero: rasa la esquina, no toca nada y deja la cámara donde el plano
	# cercano ya está dentro del muro. Con una esfera barrida el brazo se para
	# antes de que quepa la cámara, que es la pregunta correcta.
	#
	# El síntoma era una pantalla entera de textura de pared con el HUD encima,
	# en los pasillos estrechos de la planta 1. Ninguna prueba lo dice: el
	# juego funciona, la partida corre y no se ve nada.
	var probe := SphereShape3D.new()
	probe.radius = 0.28
	_spring_arm.shape = probe
	_spring_arm.position = Vector3(shoulder_offset.x, 0.0, 0.0)
	if _camera != null:
		# Plano cercano corto: cuando el brazo sí se colapsa —una esquina
		# cóncava no deja alternativa— es preferible ver muy de cerca la nuca
		# del personaje a ver el interior de la pared.
		_camera.near = 0.05
		_camera.current = true


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and mode == Mode.THIRD_PERSON:
		var motion := event as InputEventMouseMotion
		var step := clamp_mouse_step(motion.relative)
		_yaw -= step.x * mouse_sensitivity
		_pitch = clampf(_pitch - step.y * mouse_sensitivity,
			deg_to_rad(min_pitch_deg), deg_to_rad(max_pitch_deg))
	if event.is_action_pressed(&"toggle_camera"):
		toggle_mode()


func _physics_process(delta: float) -> void:
	if target == null:
		return
	_apply_gamepad_look(delta)
	global_position = target.global_position + Vector3.UP * shoulder_offset.y

	var t := clampf(transition_speed * delta, 0.0, 1.0)
	match mode:
		Mode.THIRD_PERSON:
			rotation = Vector3(_pitch, _yaw, 0.0)
			var desired_length := aim_spring_length_m if Input.is_action_pressed(&"aim") else tps_spring_length_m
			_spring_arm.spring_length = lerpf(_spring_arm.spring_length, desired_length, t)
			_resolve_tight_space(t)
		Mode.TOP_DOWN:
			rotation = Vector3(deg_to_rad(top_down_pitch_deg), _yaw, 0.0)
			_spring_arm.spring_length = lerpf(_spring_arm.spring_length, top_down_height_m, t)
			# En cenital no hay hombro ni nadie tapando: el brazo mira desde
			# arriba y el jugador tiene que verse.
			_spring_arm.position.x = 0.0
			_restore_faded()
			var own := _model_of(target)
			if own != null:
				own.visible = true


## Lo que hace habitable un pasillo estrecho, y lo que aquí NO se intenta.
##
## El problema de T-10: en una esquina cóncava el brazo se come los cuatro
## metros y la cámara acaba en la nuca. La solución que pide el roadmap es
## mover la cámara en vez de acortar el brazo — elegir entre hombro, eje y
## hombro contrario el que deje más sitio. Se intentó y se retiró, y merece
## quedar escrito POR QUÉ, porque el motivo no es el que parecía:
##
## el banco de pruebas no servía. Se hizo un diagnóstico que teletransporta al
## jugador contra el muro más cercano y le pone el `yaw` mirándolo, y ese `yaw`
## NO se aplicaba como se creía: seis ejecuciones del mismo escenario dieron
## 0,56 · 3,11 · 0,28 · 3,75 · 2,82 · 3,43 m de brazo porque la cámara miraba a
## un sitio distinto en cada una. Comparar dos versiones con ese instrumento es
## comparar ruido, y las conclusiones que salieron de ahí —«el eje está menos
## libre que el hombro»— no están demostradas.
##
## Lo que sí quedó medido, y es lo que hay aquí:
##
##   * el rayo y la esfera barrida SÍ ven el perímetro desde dentro (2,35 m y
##     2,07 m, que es exactamente el borde del polígono menos el radio), así
##     que la colisión del zócalo funciona y la sospecha de que la cámara se
##     salía del nivel por ahí no está confirmada;
##   * leer `_camera.global_position` a mitad de frame da un valor que no
##     existe: el rig ya se movió y el `SpringArm3D` todavía no ha recolocado a
##     sus hijos. Mismo frame, 0,65 m aquí dentro y 3,80 m desde fuera.
##
## Así que el brazo se deja en paz y se atacan las dos consecuencias, que se
## arreglan sin realimentar la colisión:
##
##   * el PIVOTE sube con el colapso, de «sobre el hombro» a «sobre la cabeza»;
##   * y si el brazo se queda corto de verdad, se esconde el modelo del
##     jugador: entre ver su nuca a diez centímetros y ver la habitación, la
##     habitación.
##
## Mover la cámara sigue pendiente. Lo primero que necesita quien lo retome no
## es código: es un banco de pruebas que controle de verdad hacia dónde mira.
func _resolve_tight_space(_t: float) -> void:
	# El pivote sube con el colapso: de «sobre el hombro» a «sobre la cabeza»,
	# que en un rincón es la vista que queda libre. Es un desplazamiento del
	# PIVOTE, no del brazo, así que no realimenta la colisión del brazo — que
	# es exactamente lo que hundió los dos intentos anteriores.
	var collapse := collapse_ratio(_spring_arm.get_hit_length(), _spring_arm.spring_length)
	global_position += Vector3.UP * (collapse * COLLAPSE_LIFT_M)
	_fade_occluders()


## Esconde al jugador si la cámara se le ha metido encima, y hace
## semitransparente a cualquier ALIADO que se ponga entre la cámara y él.
##
## Solo aliados: a un enemigo no se le toca la transparencia ni cuando tapa.
## Su cuerpo es información —dónde está, hacia dónde mira— y ocultarla para
## limpiar el plano es hacerle trampas al jugador en su contra.
##
## Los compañeros van a uno o dos metros por diseño (huecos de formación), así
## que sin esto tres de ellos tapan media pantalla en cuanto el jugador se
## detiene. Empujar la cámara con ellos sería peor: la haría temblar.
func _fade_occluders() -> void:
	if _camera == null or target == null:
		return
	# El ojo se estima con la longitud que el BRAZO dice tener, no con
	# `_camera.global_position`. Esa posición se lee a mitad de frame: el rig ya
	# se ha movido y el brazo todavía no ha recolocado a sus hijos, así que la
	# composición de los dos da un valor que no existe en ningún instante. Se
	# midió el mismo frame dando 0,65 m aquí dentro y 3,80 m desde fuera, y con
	# eso el modelo del jugador desaparecía en mitad de un pasillo despejado.
	#
	# `get_hit_length()` es del frame anterior, que para decidir una visibilidad
	# es exacto de sobra.
	var head := global_position
	var eye := head + global_transform.basis.z * _spring_arm.get_hit_length()
	_restore_faded()

	var own := _model_of(target)
	if own != null:
		own.visible = _spring_arm.get_hit_length() > SELF_HIDE_M

	for node: Node in get_tree().get_nodes_in_group(&"characters"):
		var body := node as Character
		if body == null or body == target or not body.alive:
			continue
		if body.team == Character.Team.ENEMY:
			continue
		if not is_between(eye, head, body.global_position + Vector3.UP * 0.9,
				OCCLUDER_RADIUS_M):
			continue
		var model := _model_of(body)
		if model == null:
			continue
		_apply_transparency(model, OCCLUDER_TRANSPARENCY)
		_faded.append(model)


func _restore_faded() -> void:
	for model: Node3D in _faded:
		if is_instance_valid(model):
			_apply_transparency(model, 0.0)
	_faded.clear()


## `GeometryInstance3D.transparency` se aplica por malla, así que hay que
## recorrer el modelo. Es un puñado de nodos y solo cuando alguien tapa.
##
## AVISO: esta propiedad solo la respeta el renderizador Forward+, que es el
## que exporta el juego. Bajo Compatibilidad —el del contenedor de capturas—
## no hace nada, así que este efecto NO se puede juzgar en una captura de CI.
func _apply_transparency(root: Node, value: float) -> void:
	var geometry := root as GeometryInstance3D
	if geometry != null:
		geometry.transparency = value
	for child: Node in root.get_children():
		_apply_transparency(child, value)


func _model_of(body: Node3D) -> Node3D:
	return body.get_node_or_null(^"Model") as Node3D


# ---- Geometría pura, probable sin escena ----

## Cuánto se ha comido el entorno del brazo: 0 = mide lo que pidió, 1 = nada.
static func collapse_ratio(hit_length: float, desired_length: float) -> float:
	if desired_length <= 0.0:
		return 0.0
	return clampf(1.0 - hit_length / desired_length, 0.0, 1.0)


## Movimiento de ratón recortado a lo que puede ser un gesto humano en un
## frame. Ver `MAX_MOUSE_STEP_PX`.
static func clamp_mouse_step(relative: Vector2) -> Vector2:
	var length := relative.length()
	if length <= MAX_MOUSE_STEP_PX or length <= 0.0:
		return relative
	return relative * (MAX_MOUSE_STEP_PX / length)


## ¿Está `point` metido en el cilindro que va de `from` a `to` con ese radio?
## Es la pregunta «¿me estás tapando?» sin trigonometría ni rayos.
static func is_between(from: Vector3, to: Vector3, point: Vector3, radius: float) -> bool:
	var axis := to - from
	var length_squared := axis.length_squared()
	if length_squared <= 0.0001:
		return false
	var along := (point - from).dot(axis) / length_squared
	if along <= 0.0 or along >= 1.0:
		return false
	var closest := from + axis * along
	return closest.distance_to(point) <= radius


func toggle_mode() -> void:
	mode = Mode.TOP_DOWN if mode == Mode.THIRD_PERSON else Mode.THIRD_PERSON


func _apply_gamepad_look(delta: float) -> void:
	var rx := Input.get_joy_axis(0, JOY_AXIS_RIGHT_X)
	var ry := Input.get_joy_axis(0, JOY_AXIS_RIGHT_Y)
	if absf(rx) < GAMEPAD_LOOK_DEADZONE:
		rx = 0.0
	if absf(ry) < GAMEPAD_LOOK_DEADZONE:
		ry = 0.0
	if rx == 0.0 and ry == 0.0:
		return
	_yaw -= rx * gamepad_sensitivity_rad_s * delta
	_pitch = clampf(_pitch - ry * gamepad_sensitivity_rad_s * delta,
		deg_to_rad(min_pitch_deg), deg_to_rad(max_pitch_deg))


## Punto al que apunta la cámara ahora mismo: el primer impacto a lo largo de
## su eje de visión, o un punto lejano si no hay nada. Lo usa `player_input.gd`
## para construir `intent_look_at` — así el jugador dispara adonde mira la
## cámara sobre el hombro, sea cual sea el esquema de control.
func get_aim_point(max_distance_m: float = 100.0) -> Vector3:
	if _camera == null or not _camera.is_inside_tree():
		return global_position - global_transform.basis.z * max_distance_m
	var from := _camera.global_position
	var forward := -_camera.global_transform.basis.z
	var to := from + forward * max_distance_m
	var space_state := _camera.get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(from, to, AIM_RAY_MASK)
	if target is CollisionObject3D:
		query.exclude = [(target as CollisionObject3D).get_rid()]
	var result := space_state.intersect_ray(query)
	var player := target.global_position if target != null else from
	return resolve_aim_point(
		from, forward, result.get("position", to), not result.is_empty(),
		player, max_distance_m)


## Dónde está de verdad el punto de mira, dado lo que ha tocado el rayo.
##
## La cámara va CUATRO METROS por detrás del jugador, así que un impacto a
## cuatro metros de la cámara está a cero del cuerpo. Devolver ese punto tal
## cual es lo que hacía girar al personaje sobre sí mismo: `PlayerInput` lo
## usa como `intent_look_at`, `CharacterController` gira el cuerpo hacia él, y
## girar hacia un punto que tienes dentro es girar hacia ruido — medido, 92°
## de deriva en un segundo sin tocar nada. Y el arma dispara a ese mismo punto:
## con el impacto pegado a la cámara, el tiro sale hacia los propios pies.
##
## Así que el punto de mira nunca está a menos de `AIM_AHEAD_OF_PLAYER_M` por
## delante del jugador. Si la pared está más cerca que eso, se apunta igual en
## esa dirección: el disparo lo resuelve `WeaponSystem` con su propio rayo, que
## sí parte del arma.
static func resolve_aim_point(
	from: Vector3,
	forward: Vector3,
	hit_point: Vector3,
	has_hit: bool,
	player_position: Vector3,
	max_distance_m: float
) -> Vector3:
	var minimum := from.distance_to(player_position) + AIM_AHEAD_OF_PLAYER_M
	if not has_hit:
		return from + forward * maxf(max_distance_m, minimum)
	if from.distance_to(hit_point) >= minimum:
		return hit_point
	return from + forward * minimum
