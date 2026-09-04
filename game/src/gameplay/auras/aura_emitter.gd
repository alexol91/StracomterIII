class_name AuraEmitter
extends Node
## Aura pasiva de escuadra. Réplica de `UpdateMoral`/`UpdateSanar` (Capitán,
## `EventControl.cc:336-354`, `Character.cc:113-122`) y de
## `UpdateAmmunition`/`updateAmmunition` (Especialista,
## `EventControl.cc:355-371`, `Character.cc:152-162`).
##
## Radio, cantidad e intervalo son de `CharacterStats` (`aura_radius_m`,
## `aura_amount`, `aura_interval_s`): un único `AuraEmitter` por personaje
## sirve para las cuatro clases, y `aura_amount == 0.0` es la señal de "este
## arquetipo no emite aura" — evita un `if` por clase para encenderla o
## apagarla (técnico, explosivo y los enemigos la traen a 0 en su `.tres`).
##
## DESVIACIÓN DOCUMENTADA DEL RADIO (paridad `[P05]`, GDD tabla de
## personajes §3): el legacy usaba **200 unidades ≈ 2,67 m** (200 × 1/75)
## para AMBAS auras. A esa escala, con los offsets de formación reales del
## legacy —hasta (±120,−60) u ≈ 1,6 m del líder, `Player.cc:75-85`— el aura
## apenas cubre a un compañero que se haya movido un paso en combate. El
## dato en vigor (`CharacterStats.aura_radius_m = 8.0`) da margen para que la
## escuadra luche algo repartida sin dejar de recompensar mantenerse cerca
## del Capitán/Especialista, que es la intención original del aura.

enum Kind { HEAL, AMMO }

## A qué recurso restaura el aura de cada arquetipo. Es un hecho ESTRUCTURAL
## del arquetipo (qué VERBO llamar), no un número de balanceo — por eso vive
## aquí y no en `CharacterStats`: `aura_amount == 0.0` ya decide si el aura
## existe; esta tabla solo decide, para la que sí existe, a qué se aplica.
## TODO(arquitecto): si algún día una clase nueva necesita un tercer tipo de
## aura, mover esto a un enum en `CharacterStats` (p. ej. `aura_kind`).
const KIND_BY_ARCHETYPE: Dictionary[StringName, Kind] = {
	&"captain": Kind.HEAL,
	&"specialist": Kind.AMMO,
}

## El Capitán se cura a sí mismo en el legacy (distancia a sí mismo = 0 < 200).
@export var affects_self: bool = true

var character: Character = null
var _kind: Kind = Kind.HEAL
var _elapsed_s: float = 0.0


func _ready() -> void:
	character = get_parent() as Character
	if character == null:
		push_error("AuraEmitter: debe ser hijo de un Character.")
		return
	if character.stats == null or character.stats.aura_amount == 0.0:
		set_physics_process(false)
		return
	_kind = KIND_BY_ARCHETYPE.get(character.archetype, Kind.HEAL)


func _physics_process(delta: float) -> void:
	if character == null or not character.alive:
		return
	_elapsed_s += delta
	var interval := character.stats.aura_interval_s
	if interval <= 0.0 or _elapsed_s < interval:
		return
	_elapsed_s -= interval
	_pulse()


func _pulse() -> void:
	var radius := character.stats.aura_radius_m
	var amount := character.stats.aura_amount
	for node: Node in character.get_tree().get_nodes_in_group(&"characters"):
		var target := node as Character
		if target == null or not target.alive:
			continue
		if target == character:
			if not affects_self:
				continue
		elif character.is_hostile_to(target):
			continue
		if character.global_position.distance_to(target.global_position) > radius:
			continue
		_apply(target, amount)


func _apply(target: Character, amount: float) -> void:
	match _kind:
		Kind.HEAL:
			target.heal(amount)
		Kind.AMMO:
			target.add_ammo(int(amount))
