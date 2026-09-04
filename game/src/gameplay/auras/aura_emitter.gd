class_name AuraEmitter
extends Node
## Aura pasiva de escuadra. Réplica de `UpdateMoral`/`UpdateSanar` (Capitán,
## `EventControl.cc:336-354`, `Character.cc:113-122`) y de
## `UpdateAmmunition`/`updateAmmunition` (Especialista,
## `EventControl.cc:355-371`, `Character.cc:152-162`).
##
## DESVIACIÓN DOCUMENTADA DEL RADIO (paridad `[P05]`, GDD tabla de
## personajes §3): el legacy usaba **200 unidades ≈ 2,67 m** (200 × 1/75)
## para AMBAS auras. A esa escala, con los offsets de formación reales del
## legacy —hasta (±120,−60) u ≈ 1,6 m del líder, `Player.cc:75-85`— el aura
## apenas cubre a un compañero que se haya movido un paso en combate: es un
## radio de "estad quietos pegados a mí", no un aura de escuadra que tolere
## maniobrar en una oficina con mobiliario de por medio.
##
## Se usa **8 m**: suficiente para que la escuadra luche algo repartida
## (cubrir un cruce, flanquear un poco) sin dejar de recompensar mantenerse
## cerca del Capitán/Especialista, que es la intención original del aura.
## TODO(arquitecto): mover radio/cantidad/intervalo a datos — p. ej.
## `CharacterStats.aura_radius_m` / `aura_amount` / `aura_interval_s` — en vez
## de estas constantes de instancia.

enum Kind { HEAL, AMMO }

@export var kind: Kind = Kind.HEAL
## Si no está vacío, el aura se autodesactiva salvo que
## `character.archetype` coincida — así `character.tscn` puede llevar los dos
## emisores (curación y munición) y solo se activa el que corresponde a la
## clase realmente instanciada.
@export var required_archetype: StringName = &""
@export var radius_m: float = 8.0
## +1 HP (Capitán) o +10 balas (Especialista) — cantidad EXACTA del legacy.
@export var amount: float = 1.0
## Cada 2 s (Capitán) o cada 4 s (Especialista) — intervalo EXACTO del legacy.
@export var interval_s: float = 2.0
## El Capitán se cura a sí mismo en el legacy (distancia a sí mismo = 0 < 200).
@export var affects_self: bool = true

var character: Character = null
var _elapsed_s: float = 0.0


func _ready() -> void:
	character = get_parent() as Character
	if character == null:
		push_error("AuraEmitter: debe ser hijo de un Character.")
		return
	if required_archetype != &"" and character.archetype != required_archetype:
		set_physics_process(false)


func _physics_process(delta: float) -> void:
	if character == null or not character.alive:
		return
	_elapsed_s += delta
	if _elapsed_s < interval_s:
		return
	_elapsed_s -= interval_s
	_pulse()


func _pulse() -> void:
	for node: Node in character.get_tree().get_nodes_in_group(&"characters"):
		var target := node as Character
		if target == null or not target.alive:
			continue
		if target == character:
			if not affects_self:
				continue
		elif character.is_hostile_to(target):
			continue
		if character.global_position.distance_to(target.global_position) > radius_m:
			continue
		_apply(target)


func _apply(target: Character) -> void:
	match kind:
		Kind.HEAL:
			target.heal(amount)
		Kind.AMMO:
			target.add_ammo(int(amount))
