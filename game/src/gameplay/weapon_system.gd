class_name WeaponSystem
extends Node
## Resuelve contra el mundo las intenciones de combate de UN `Character`:
## arma de fuego (hitscan), cuchillo (cuerpo a cuerpo) y explosivo.
##
## Vive como nodo hijo del `Character` en la escena (`character.tscn` /
## `player.tscn` / `enemy.tscn`). Lee `character.intent_fire`,
## `character.intent_melee` y `character.intent_reload` sin que le importe
## quién los puso ahí — jugador o IA (regla de intenciones, ver cabecera de
## `character.gd`). NO importa nada de `src/ai/`.
##
## DECISIÓN DE DISEÑO — de dónde sale cada número: el arma POR DEFECTO de
## cada arquetipo (`CharacterStats.default_weapon_id`) usa cadencia y daño de
## `CharacterStats` (fidelidad exacta al legacy, donde esos campos son del
## PERSONAJE, no de un arma — imprescindible para los enemigos, que no tienen
## un `WeaponStats` propio) y usa el `WeaponStats` señalado por
## `default_weapon_id` solo para lo que el legacy no tenía: dispersión,
## recarga, alcance, radio de explosión, fuego amigo y ruido. Un arma
## RECOGIDA (p. ej. el pickup `sniper`, vía `Character.equipped_weapon_override`)
## sustituye el arma por completo: cadencia y daño pasan a ser los del propio
## `WeaponStats`, porque en ese momento es literalmente "otra arma", no el
## arma de la clase.

const MELEE_WEAPON_ID: StringName = &"knife"

## Máscara de físicas para hitscan y explosión: world | player | companion |
## enemy | door (ver `project.godot` → `[layer_names]`). Se excluyen
## `projectile`, `pickup` y `cover_probe`: no son objetivos ni bloquean tiros.
const HIT_MASK: int = 79 # bits 1(world)+2(player)+4(companion)+8(enemy)+64(door)
## Máscara solo de geometría real, para la línea de visión de la explosión
## (réplica de `RayBody` en `EventControl::Explosion`, legacy): solo el mundo
## y las puertas bloquean, los propios personajes no.
const LOS_MASK: int = 65 # bits 1(world)+64(door)

## Debe procesarse DESPUÉS que quien escribe las intenciones (`player_input.gd`,
## `Ability`), para leerlas en el mismo tick en que se pusieron.
const CONSUMER_PHYSICS_PRIORITY: int = 100

@export var character_path: NodePath

var character: Character = null
var _firearm: Weapon = null
var _melee: Weapon = null
var _current_weapon_id: StringName = &""
## true si la cadencia/daño del arma activa deben leerse de `CharacterStats`
## (arma por defecto de la clase) en vez de de su propio `WeaponStats`
## (arma recogida). Ver decisión de diseño en la cabecera.
var _firearm_uses_character_stats: bool = true
var _rng := RandomNumberGenerator.new()

## Inyectable SOLO para pruebas: sustituye el raycast físico real.
## Firma: `Callable(from: Vector3, to: Vector3, mask: int) -> Dictionary`,
## con el mismo formato que devuelve
## `PhysicsDirectSpaceState3D.intersect_ray` (`position`, `collider`,
## `shape`...). Vacío (por defecto) = física real.
##
## Por qué existe: los cuerpos de física recién añadidos al árbol no son
## consultables por raycast hasta que pasa al menos un paso de física real
## (limitación del motor — Jolt no actualiza el broadphase de forma
## síncrona), y el runner de pruebas del proyecto (`tests/run_tests.gd`)
## ejecuta todas las pruebas dentro de un único `_ready()` síncrono, sin
## avanzar nunca un frame real. Es la misma idea que `ai/contracts/world_query.gd`
## usa para hacer testeable la IA sin física real; aquí se resuelve de forma
## independiente porque `gameplay/` no puede importar nada de `src/ai/`.
var raycast_override: Callable = Callable()


func _ready() -> void:
	process_physics_priority = CONSUMER_PHYSICS_PRIORITY
	character = get_node_or_null(character_path) as Character
	if character == null:
		character = get_parent() as Character
	if character == null:
		push_error("WeaponSystem: no se encontró el Character propietario.")
		return
	_rng.randomize()
	var melee_stats := Balance.weapon(MELEE_WEAPON_ID)
	if melee_stats == null:
		push_error("WeaponSystem: falta el arma común '%s' en Balance." % MELEE_WEAPON_ID)
	else:
		_melee = Weapon.new(melee_stats, melee_stats.cadence_ms)
	# `Character.stats` se resuelve en `Character._ready()`, y Godot llama a
	# los `_ready()` de los HIJOS antes que al del padre — cuando este nodo
	# es hijo del propio `Character`, `stats` todavía es `null` aquí. Se
	# reintenta de forma segura en el primer `_physics_process` (para
	# entonces todos los `_ready()` del árbol ya han corrido).
	if character.stats != null:
		_ensure_firearm_equipped()


func _physics_process(delta: float) -> void:
	if character == null or character.stats == null or not character.alive:
		return
	_ensure_firearm_equipped()

	if _melee != null:
		_melee.tick(delta)
	if _firearm == null:
		return

	var was_reloading := _firearm.is_reloading
	_firearm.tick(delta)
	if was_reloading and not _firearm.is_reloading:
		character.refill_ammo()

	if character.intent_reload and not _firearm.is_reloading and character.ammo < character.stats.max_ammo:
		_firearm.start_reload()

	if character.intent_melee and _melee != null and _melee.can_fire():
		_resolve_melee()

	if character.intent_fire and not _firearm.is_reloading:
		if character.can_fire_ammo() and _firearm.can_fire():
			_resolve_fire()


## Resuelve el arma activa según el arquetipo o el pickup equipado. Barato
## (comparación de `StringName`): se puede llamar cada tick sin preocupación
## de presupuesto de CPU (ADR-002 solo limita raycasts, no esto).
func _ensure_firearm_equipped() -> void:
	if character == null:
		return
	var override_id := character.equipped_weapon_override
	var desired_id: StringName = override_id if override_id != &"" \
		else character.stats.default_weapon_id
	if desired_id == _current_weapon_id and _firearm != null:
		return
	var w_stats := Balance.weapon(desired_id)
	if w_stats == null:
		push_error("WeaponSystem: arma desconocida '%s' para '%s'." % [desired_id, character.archetype])
		return
	var uses_character_stats := override_id == &""
	var cadence_ms: float = character.stats.cadence_ms if uses_character_stats else w_stats.cadence_ms
	_firearm = Weapon.new(w_stats, cadence_ms)
	_current_weapon_id = desired_id
	_firearm_uses_character_stats = uses_character_stats


func _resolve_fire() -> void:
	_firearm.register_shot()
	character.consume_ammo(1)
	var origin := character.eye_position()
	if _firearm.stats.kind == WeaponStats.Kind.EXPLOSIVE:
		_fire_explosive(origin)
	else:
		_fire_hitscan(origin)


func _fire_hitscan(origin: Vector3) -> void:
	var aimed_dir := _firearm.apply_spread(_aim_direction_from(origin), _rng)
	var to := origin + aimed_dir * _firearm.stats.range_m
	var result := _raycast(origin, to, HIT_MASK)

	var hit := false
	var is_headshot := false
	if not result.is_empty():
		var collider: Object = result.get("collider")
		if collider is Character:
			var target := collider as Character
			if character.is_hostile_to(target):
				var shape_index := int(result.get("shape", 0))
				var zone := HitZones.zone_for_shape(target, shape_index)
				is_headshot = zone == Damage.Zone.HEAD
				var damage_amount: float = character.stats.damage if _firearm_uses_character_stats else _firearm.stats.damage
				var dmg := HitZones.build_damage(
					damage_amount, zone, origin, character.get_instance_id(), int(character.team))
				target.apply_damage(dmg)
				hit = true
	_emit_shot_feedback(_firearm, origin, hit, is_headshot)


func _fire_explosive(origin: Vector3) -> void:
	var dir := _aim_direction_from(origin)
	var to := origin + dir * _firearm.stats.range_m
	var result := _raycast(origin, to, HIT_MASK)
	var center: Vector3 = to
	if not result.is_empty():
		center = result.get("position", to)
	var any_hit := _apply_explosion(center)
	_emit_shot_feedback(_firearm, origin, any_hit, false)


## Réplica exacta de `EventControl::Explosion` (legacy): caída lineal desde
## el centro, requiere línea de visión a cada víctima, y el fuego amigo (que
## en el legacy era total en TODO el combate) se limita aquí a explosiones,
## gobernado por `WeaponStats.friendly_fire`.
func _apply_explosion(center: Vector3) -> bool:
	var any_hit := false
	for node: Node in get_tree().get_nodes_in_group(&"characters"):
		var target := node as Character
		if target == null or not target.alive:
			continue
		var is_friendly := not character.is_hostile_to(target)
		if is_friendly and not _firearm.stats.friendly_fire:
			continue
		var distance := center.distance_to(target.eye_position())
		if distance > _firearm.stats.blast_radius_m:
			continue
		if not _has_line_of_sight(center, target.eye_position()):
			continue
		var base_damage: float = character.stats.damage if _firearm_uses_character_stats else _firearm.stats.damage
		var amount := Weapon.explosion_damage(base_damage, distance, _firearm.stats.blast_radius_m)
		if amount <= 0.0:
			continue
		var dmg := HitZones.build_damage(
			amount, Damage.Zone.TORSO, center, character.get_instance_id(), int(character.team), true)
		target.apply_damage(dmg)
		any_hit = true
	return any_hit


func _resolve_melee() -> void:
	_melee.register_shot()
	var origin := character.chest_position()
	var target := _find_nearest_hostile(origin, _melee.stats.range_m)
	var hit := target != null
	if target != null:
		var dmg := HitZones.build_damage(
			_melee.stats.damage, Damage.Zone.TORSO, origin, character.get_instance_id(), int(character.team))
		target.apply_damage(dmg)
	_emit_shot_feedback(_melee, origin, hit, false)


func _find_nearest_hostile(origin: Vector3, max_range_m: float) -> Character:
	var best: Character = null
	var best_dist := max_range_m
	for node: Node in get_tree().get_nodes_in_group(&"characters"):
		var target := node as Character
		if target == null or target == character or not target.alive:
			continue
		if not character.is_hostile_to(target):
			continue
		var dist := origin.distance_to(target.global_position)
		if dist <= best_dist:
			best_dist = dist
			best = target
	return best


func _aim_direction_from(origin: Vector3) -> Vector3:
	if character.intent_look_at != Vector3.INF:
		var to_target := character.intent_look_at - origin
		if to_target.length_squared() > 0.0001:
			return to_target.normalized()
	return -character.global_transform.basis.z


func _emit_shot_feedback(weapon: Weapon, origin: Vector3, hit: bool, is_headshot: bool) -> void:
	AudioDirector.play_sfx_3d(
		weapon.stats.id, origin, weapon.stats.noise_intensity, weapon.stats.noise_radius_m,
		character.get_instance_id())
	EventBus.shot_resolved.emit(character.get_instance_id(), hit, is_headshot)


func _raycast(from: Vector3, to: Vector3, mask: int) -> Dictionary:
	if raycast_override.is_valid():
		var result: Variant = raycast_override.call(from, to, mask)
		return result if result is Dictionary else {}
	if character == null or not character.is_inside_tree():
		return {}
	var space_state := character.get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(from, to, mask)
	query.exclude = [character.get_rid()]
	return space_state.intersect_ray(query)


func _has_line_of_sight(from: Vector3, to: Vector3) -> bool:
	return _raycast(from, to, LOS_MASK).is_empty()
