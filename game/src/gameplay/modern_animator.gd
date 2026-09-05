class_name ModernAnimator
extends Node3D
## Anima un personaje con `AnimationPlayer`, para los modelos nuevos.
##
## Expone **la misma interfaz** que `FrameAnimator`, que anima intercambiando
## las cinco mallas de 2012. Esa simetría es lo que permite que el truco
## `: retro on|off` cambie de modelos sin que nadie más se entere: quien pide
## "camina más rápido" no sabe ni le importa si detrás hay un esqueleto o cinco
## poses.

## Los paquetes CC0 no se ponen de acuerdo en cómo llamar a los clips: Kenney
## usa `idle`/`walk`/`sprint`/`die`, KayKit `Idle`/`Walking_A`/`Running_A`/
## `Death_A` y Quaternius `Idle`/`Walk`/`Sprint`/`Death01`. En vez de casarse
## con uno, cada intención lleva su lista de nombres CANDIDATOS y se usa el
## primero que el modelo tenga de verdad.
##
## Sin esto no falla nada visible: `_play` comprueba `has_animation` y se calla,
## así que un modelo con otros nombres simplemente se queda inmóvil y parece un
## maniquí. Ya pasó al cambiar de paquete.
##
## Ojo con Quaternius: sus clips cíclicos se llaman `Walk_Loop` en el fichero,
## pero el importador de Godot RECORTA el sufijo `_Loop` y marca el bucle él
## solo, así que dentro del juego el clip se llama `Walk`. Buscarlo por el
## nombre del fichero no da error: deja al personaje clavado de pie.
const CLIP_IDLE: StringName = &"idle"
const CLIP_WALK: StringName = &"walk"
const CLIP_SPRINT: StringName = &"sprint"
const CLIP_DIE: StringName = &"die"
## Clips de una sola pasada: se disparan por un suceso y devuelven el control
## a la locomoción al terminar.
const CLIP_SHOOT: StringName = &"shoot"
const CLIP_RELOAD: StringName = &"reload"
const CLIP_HIT: StringName = &"hit"

## Listas literales y no `PackedStringArray(...)`: un constructor es una
## LLAMADA y no vale dentro de una `const`. Godot lo dice claro —«isn't a
## constant expression»— pero el script entero deja de compilar y el síntoma
## que se ve es un modelo sin animador, no un error de sintaxis.
const CLIP_CANDIDATES: Dictionary[StringName, Array] = {
	CLIP_IDLE: ["Pistol_Idle", "Idle", "idle", "Unarmed_Idle", "1H_Melee_Idle"],
	CLIP_WALK: ["Walk", "walk", "Walking_A", "Walking_B", "Walking_C"],
	CLIP_SPRINT: ["Sprint", "Jog_Fwd", "sprint", "Running_A", "Running_B", "run"],
	CLIP_DIE: ["Death01", "die", "Death_A", "Death_B", "death"],
	CLIP_SHOOT: ["Pistol_Shoot", "Punch_Cross", "1H_Melee_Attack_Chop"],
	CLIP_RELOAD: ["Pistol_Reload", "Interact"],
	CLIP_HIT: ["Hit_Chest", "Hit_Head", "Hit_A"],
}

## Altura a la que se normaliza cualquier modelo. Es la del colisionador del
## personaje (`character.tscn`, cápsula de 0 a 1,8 m): si el modelo no mide lo
## mismo que su cuerpo físico, o flota o se hunde, y el jugador dispara a un
## sitio distinto del que ve.
const TARGET_HEIGHT_M: float = 1.8

@export var playing: bool = true
## Filtrado NEAREST del atlas. Verdadero para KayKit —su textura es un
## degradado de pocos píxeles y el filtrado lineal inventa colores—, FALSO para
## los cuerpos de Quaternius, que llevan PBR de 1024 y con NEAREST salen
## pixelados. Es un dato del paquete, no una preferencia.
@export var atlas_filter: bool = true
## Velocidad relativa: 0 detiene, 1 es el ritmo nominal. Misma semántica que en
## `FrameAnimator`.
var speed_scale: float = 1.0:
	set(value):
		speed_scale = value
		_refresh()

var _player: AnimationPlayer = null
var _current: StringName = &""
## Hay un clip de una pasada en curso. Sin esta bandera, el `_refresh()` que
## dispara cada cambio de `speed_scale` —o sea, cada frame de física— cortaría
## el disparo antes de que se viera.
var _oneshot: bool = false


func _ready() -> void:
	if atlas_filter:
		_apply_atlas_filter()
	_normalise_height()
	_player = _find_animation_player(self)
	if _player == null:
		push_warning("ModernAnimator: el modelo no trae AnimationPlayer")
		return
	if not _player.animation_finished.is_connected(_on_animation_finished):
		_player.animation_finished.connect(_on_animation_finished)
	_play(CLIP_IDLE)


## Los modelos de KayKit se texturizan con UN atlas de gradiente diminuto: cada
## color es un puñado de píxeles. Con filtrado lineal —lo que Godot pone por
## defecto— los téxeles vecinos se mezclan y el personaje sale de colores que no
## existen en la paleta: rosas y verdes chillones donde debería haber acero y
## cuero. Es el propio autor quien pide filtrado NEAREST.
func _apply_atlas_filter() -> void:
	for node: Node in _mesh_instances(self):
		var mesh_instance := node as MeshInstance3D
		var mesh := mesh_instance.mesh
		if mesh == null:
			continue
		for index: int in range(mesh.get_surface_count()):
			var material := mesh.surface_get_material(index) as StandardMaterial3D
			if material != null:
				material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST


## Escala el modelo a la altura del cuerpo físico.
##
## Se mide en vez de fijar un número por paquete porque un modelo importado con
## la escala de otro programa no da error: sale un personaje del tamaño de una
## silla, o uno que no cabe por la puerta. Los de KayKit venían a 1,1 m.
func _normalise_height() -> void:
	var height := measured_height()
	if height <= 0.01:
		return
	var factor := TARGET_HEIGHT_M / height
	scale = Vector3.ONE * factor


## Altura del modelo tal y como está montado ahora, en metros.
func standing_height() -> float:
	return measured_height() * scale.y


## Altura del modelo SIN la escala de este nodo. Se mide desde los HIJOS a
## propósito: si se midiera desde `self`, el recorrido incluiría la escala que
## este mismo nodo acaba de aplicar y `standing_height()` la contaría dos veces.
##
## Y hay que acumular transformadas por el camino: un personaje son varias
## mallas sueltas con la suya, así que sumar sus `AABB` como si compartieran
## origen da casi el doble de altura. Una prueba escrita así no falla: miente.
func measured_height() -> float:
	var bounds := AABB()
	var found := false
	for child: Node in get_children():
		var child_bounds := _local_bounds(child, Transform3D.IDENTITY)
		if child_bounds.size == Vector3.ZERO:
			continue
		bounds = child_bounds if not found else bounds.merge(child_bounds)
		found = true
	return bounds.size.y if found else 0.0


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


static func _mesh_instances(node: Node) -> Array[Node]:
	var out: Array[Node] = []
	if node is MeshInstance3D:
		out.append(node)
	for child: Node in node.get_children():
		out.append_array(_mesh_instances(child))
	return out


## Cuántos clips tiene. Equivalente a `FrameAnimator.frame_count()` para que
## las pruebas puedan comprobar que hay animación sin saber de qué tipo es.
func frame_count() -> int:
	return _player.get_animation_list().size() if _player != null else 0


func stop_at_idle() -> void:
	_play(CLIP_IDLE)


func play_death() -> void:
	_oneshot = false
	_play(CLIP_DIE)
	playing = false


## Dispara un clip de una sola pasada (disparo, recarga, impacto recibido).
##
## Devuelve si el modelo lo tiene: quien llama puede querer saberlo, pero NO
## necesita comprobarlo antes. Un paquete al que le falte el clip de recarga
## sigue jugándose; simplemente no se ve recargar.
func play_once(clip: StringName) -> bool:
	if _player == null or not playing:
		return false
	var clip_name := resolve_clip(clip)
	if clip_name.is_empty():
		return false
	_oneshot = true
	_current = clip
	_player.play(clip_name)
	_player.speed_scale = 1.0
	return true


func _refresh() -> void:
	if _player == null or _oneshot:
		return
	# El clip se elige por la velocidad real, no por un estado que alguien
	# tenga que acordarse de actualizar.
	if not playing or speed_scale <= 0.05:
		_play(CLIP_IDLE)
	elif speed_scale > 1.4:
		_play(CLIP_SPRINT)
	else:
		_play(CLIP_WALK)
	_player.speed_scale = maxf(speed_scale, 0.1)


func _on_animation_finished(_clip: StringName) -> void:
	if not _oneshot:
		return
	_oneshot = false
	_current = &""
	_refresh()


func _play(clip: StringName) -> void:
	if _player == null or _current == clip:
		return
	var clip_name := resolve_clip(clip)
	if clip_name.is_empty():
		return
	_current = clip
	_player.play(clip_name)


## Nombre real del clip en ESTE modelo, o vacío si no trae ninguno de los
## candidatos. Público para que las pruebas puedan comprobar que un paquete
## nuevo trae las cuatro intenciones antes de que nadie se lo encuentre en
## partida como un personaje que no se mueve.
func resolve_clip(clip: StringName) -> String:
	if _player == null:
		return ""
	for candidate: String in CLIP_CANDIDATES.get(clip, []):
		if _player.has_animation(candidate):
			return candidate
	return ""


func _find_animation_player(node: Node) -> AnimationPlayer:
	if node is AnimationPlayer:
		return node as AnimationPlayer
	for child: Node in node.get_children():
		var found := _find_animation_player(child)
		if found != null:
			return found
	return null
