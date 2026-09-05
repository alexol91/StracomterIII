class_name CharacterController
extends Character
## Convierte las INTENCIONES del contrato base en movimiento físico real.
##
## Es el único fichero que decide CÓMO se mueve el cuerpo (Jolt,
## `CharacterBody3D.move_and_slide`); QUÉ hacer lo decide quien rellena las
## intenciones — input humano (`player_input.gd`) o un cerebro de IA — y a
## este fichero le es indiferente cuál de los dos fue. No importa nada de
## `src/ai/`.
##
## Réplica de `Player::UpdateMov`/`Bot::Move` del legacy: velocidad asignada
## DIRECTAMENTE (sin aceleración ni frenado, `Player.cc:172-181`) en la
## dirección de la intención, escalada por `CharacterStats.speed_mps()`.
##
## Orden de ejecución dentro del tick de física: este nodo debe procesarse
## DESPUÉS de que `WeaponSystem`/`Ability` hayan podido leer las intenciones
## del frame — por eso `clear_intents()` se llama `call_deferred()` en vez de
## directamente: los deferred de Godot se vacían al final del paso de física
## actual, así que cualquier otro nodo hermano que lea las intenciones en su
## propio `_physics_process` de este mismo tick las ve intactas, sea cual sea
## el orden de los hijos en el árbol de escena.

## Nombre de la forma de colisión principal en `character.tscn` (la que
## también hace de zona de impacto TORSO — ver `hit_zones.gd`). Es la que se
## comprime al agacharse; `HeadShape`/`LimbShape` no cambian de tamaño.
const BODY_SHAPE_NODE_NAME: String = "TorsoShape"
## Debe procesarse DESPUÉS que quien escribe las intenciones
## (`player_input.gd`, `Ability`). Misma convención que
## `WeaponSystem.CONSUMER_PHYSICS_PRIORITY`.
const CONSUMER_PHYSICS_PRIORITY: int = 100

var _collision_shape: CollisionShape3D = null
var _standing_capsule_height: float = -1.0


func _ready() -> void:
	super._ready()
	process_physics_priority = CONSUMER_PHYSICS_PRIORITY
	_collision_shape = get_node_or_null(BODY_SHAPE_NODE_NAME) as CollisionShape3D
	if _collision_shape != null and _collision_shape.shape != null:
		# Cada instancia necesita su propia copia: mutar una `CapsuleShape3D`
		# compartida agacharía a TODOS los personajes que usen ese recurso.
		_collision_shape.shape = _collision_shape.shape.duplicate()
		var capsule := _collision_shape.shape as CapsuleShape3D
		if capsule != null:
			_standing_capsule_height = capsule.height
	_apply_tint()
	_build_model()
	if not PresentationStyle.style_changed.is_connected(_on_style_changed):
		PresentationStyle.style_changed.connect(_on_style_changed)


## Monta el modelo del arquetipo en el estilo activo y esconde la cápsula de
## bloqueo.
##
## Hasta ahora el juego se jugaba con cápsulas de colores: los 45 modelos de
## 2012 y los nueve CC0 estaban en el repositorio, importados y probados, y no
## los instanciaba nadie. `PresentationStyle.scene_path_for()` existía desde el
## principio sin un solo llamante.
##
## Si el modelo no carga se deja la cápsula: un personaje feo se ve y se puede
## disparar, uno invisible no. Ante la duda, algo en pantalla.
func _build_model() -> void:
	var previous := get_node_or_null("Model")
	if previous != null:
		previous.queue_free()
		remove_child(previous)

	var mesh := get_node_or_null("BodyMesh") as MeshInstance3D
	var path := PresentationStyle.scene_path_for(archetype)
	if not ResourceLoader.exists(path):
		if mesh != null:
			mesh.visible = true
		return
	var packed := load(path) as PackedScene
	if packed == null:
		if mesh != null:
			mesh.visible = true
		return
	var model := packed.instantiate() as Node3D
	if model == null:
		if mesh != null:
			mesh.visible = true
		return
	model.name = "Model"
	# Los modelos miran hacia +Z y en Godot el frente de un `Node3D` es -Z, así
	# que sin este giro el personaje corre de espaldas a donde apunta.
	model.rotation_degrees = Vector3(0.0, 180.0, 0.0)
	add_child(model)
	if mesh != null:
		mesh.visible = false


func _on_style_changed(_chutaos: bool) -> void:
	_build_model()


## Colorea el bloqueo de primitivas con el color de arquetipo de
## `CharacterStats.tint` (el legacy asignaba un color fijo por tipo — ver
## `legacy-gameplay.md` §3.2). Puramente presentación; `ai-navegacion`/`arte`
## sustituirán la malla, no el color de identificación.
func _apply_tint() -> void:
	if stats == null:
		return
	var mesh := get_node_or_null("BodyMesh") as MeshInstance3D
	if mesh == null:
		return
	var material := StandardMaterial3D.new()
	material.albedo_color = stats.tint
	mesh.material_override = material


func _physics_process(delta: float) -> void:
	if stats == null or not alive:
		return

	_apply_gravity(delta)
	_apply_horizontal_velocity()
	if intent_look_at != Vector3.INF:
		_face_towards(intent_look_at)
	_apply_crouch_shape(intent_crouch)

	move_and_slide()
	# Ver nota de orden de ejecución en la cabecera del fichero.
	clear_intents.call_deferred()


func _apply_gravity(delta: float) -> void:
	if is_on_floor():
		velocity.y = 0.0
		return
	var gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity", 9.8)
	velocity.y -= gravity * delta


func _apply_horizontal_velocity() -> void:
	var speed := stats.speed_mps()
	if intent_crouch:
		speed *= stats.crouch_multiplier
	elif intent_sprint:
		speed *= stats.sprint_multiplier
	var horizontal := intent_move * speed
	velocity.x = horizontal.x
	velocity.z = horizontal.z


func _face_towards(target: Vector3) -> void:
	var flat_target := Vector3(target.x, global_position.y, target.z)
	if flat_target.distance_squared_to(global_position) < 0.0001:
		return
	look_at(flat_target, Vector3.UP)


func _apply_crouch_shape(crouched: bool) -> void:
	if _collision_shape == null or _standing_capsule_height < 0.0:
		return
	var capsule := _collision_shape.shape as CapsuleShape3D
	if capsule == null:
		return
	var target_height := _standing_capsule_height * (stats.crouch_height_scale if crouched else 1.0)
	if is_equal_approx(capsule.height, target_height):
		return
	capsule.height = target_height
	_collision_shape.position.y = target_height * 0.5
