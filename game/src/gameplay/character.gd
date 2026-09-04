class_name Character
extends CharacterBody3D
## Contrato base de todo personaje: jugador, compañero y enemigo.
##
## PRINCIPIO ARQUITECTÓNICO CENTRAL (ADR-001, capa `gameplay/`):
## un Character expone INTENCIONES, no decisiones. Quién las rellena es
## indiferente — el input humano o un cerebro de IA. Por eso este fichero
## NO importa nada de `src/ai/`, y por eso el mismo cuerpo sirve para los tres
## bandos. Si alguna vez `gameplay/` necesita preguntarle algo a `ai/`,
## la responsabilidad está mal repartida.
##
## Réplica moderna de Character/Bot/Player del legacy
## (legacy/trunk/core/entities/), que mezclaba cuerpo, IA y render en la
## misma jerarquía de clases.

enum Team { PLAYER, COMPANION, ENEMY }

signal died(killer_id: int)
signal health_changed(current: float, maximum: float)
signal ammo_changed(current: int, maximum: int)

@export var archetype: StringName = &"captain"
@export var team: Team = Team.ENEMY
## Identificador de escuadra, para la pizarra compartida.
@export var squad_id: int = 0

var stats: CharacterStats = null
var health: float = 100.0
var ammo: int = 0
var alive: bool = true

## --- Intenciones. Las rellena el controlador (humano o IA) cada frame. ---
## Dirección de movimiento deseada, normalizada, en espacio de mundo.
var intent_move: Vector3 = Vector3.ZERO
## Punto al que se quiere mirar/apuntar. `Vector3.INF` = sin objetivo.
var intent_look_at: Vector3 = Vector3.INF
## Se quiere disparar este frame.
var intent_fire: bool = false
## Se quiere atacar en cuerpo a cuerpo.
var intent_melee: bool = false
## Se quiere recargar.
var intent_reload: bool = false
## Se quiere usar la habilidad de clase (E-01).
var intent_ability: bool = false
## Se quiere correr.
var intent_sprint: bool = false
## Se quiere agachar (afecta a la cobertura efectiva).
var intent_crouch: bool = false

## Arma actualmente equipada, si difiere de la por defecto del arquetipo
## (p. ej. tras recoger el pickup `sniper`). Vacío = usar la del arquetipo.
## La resuelve `WeaponSystem`; `Character` solo la almacena.
var equipped_weapon_override: StringName = &""


func _ready() -> void:
	stats = Balance.character(archetype)
	if stats == null:
		push_error("Character: arquetipo desconocido '%s'" % archetype)
		return
	health = stats.max_health
	ammo = stats.max_ammo
	health_changed.emit(health, stats.max_health)
	ammo_changed.emit(ammo, stats.max_ammo)
	# Registro para que sistemas del propio gameplay (auras, habilidades) se
	# encuentren entre sí sin acoplarse a la jerarquía de escena de nadie.
	# NO lo consulta `ai/`: eso violaría la regla de intenciones (ver cabecera).
	add_to_group(&"characters")


## Limpia las intenciones. Debe llamarse al final de cada tick de física para
## que una intención no persista un frame de más.
func clear_intents() -> void:
	intent_move = Vector3.ZERO
	intent_fire = false
	intent_melee = false
	intent_reload = false
	intent_ability = false


# --- API de intención. Es lo único que un cerebro de IA debe llamar. ---

func move_to(direction: Vector3) -> void:
	intent_move = direction.normalized() if direction.length_squared() > 0.0 else Vector3.ZERO


func look_at_point(point: Vector3) -> void:
	intent_look_at = point


func fire() -> void:
	intent_fire = true


func melee() -> void:
	intent_melee = true


func reload() -> void:
	intent_reload = true


func use_ability() -> void:
	intent_ability = true


## Cambia el arma equipada (p. ej. al recoger el pickup `sniper`). La
## resuelve `WeaponSystem` en su siguiente tick; este método solo guarda la
## intención de equipo, igual que el resto de intenciones del contrato.
func equip_weapon(weapon_id: StringName) -> void:
	equipped_weapon_override = weapon_id


# --- Estado consultable (solo lectura para las capas superiores) ---

func health_ratio() -> float:
	if stats == null or stats.max_health <= 0.0:
		return 0.0
	return clampf(health / stats.max_health, 0.0, 1.0)


func ammo_ratio() -> float:
	if stats == null or stats.max_ammo <= 0:
		return 0.0
	return clampf(float(ammo) / float(stats.max_ammo), 0.0, 1.0)


func eye_position() -> Vector3:
	return global_position + Vector3.UP * 1.6


func chest_position() -> Vector3:
	return global_position + Vector3.UP * 1.1


func is_hostile_to(other: Character) -> bool:
	if other == null:
		return false
	var a_enemy := team == Team.ENEMY
	var b_enemy := other.team == Team.ENEMY
	return a_enemy != b_enemy


# --- Daño y muerte ---

func apply_damage(damage: Damage) -> void:
	if not alive:
		return
	var final_amount := damage.effective_amount()
	health = maxf(health - final_amount, 0.0)
	health_changed.emit(health, stats.max_health if stats != null else 100.0)
	EventBus.character_damaged.emit(
		get_instance_id(),
		final_amount,
		damage.source_position,
		damage.attacker_id,
		damage.attacker_team
	)
	if health <= 0.0:
		_die(damage.attacker_id)


func heal(amount: float) -> void:
	if not alive or stats == null:
		return
	health = minf(health + amount, stats.max_health)
	health_changed.emit(health, stats.max_health)


func add_ammo(amount: int) -> void:
	if stats == null:
		return
	ammo = mini(ammo + amount, stats.max_ammo)
	ammo_changed.emit(ammo, stats.max_ammo)


## ¿Queda al menos una bala? Réplica de `Character::canShoot()` (parte de
## munición; la parte de cadencia la lleva `Weapon`, en `weapon.gd`).
func can_fire_ammo() -> bool:
	return ammo > 0


## Consume munición. Réplica de `Character::shootDamage()`: la bala se
## descuenta AUNQUE el disparo falle — lo llama `WeaponSystem` en cuanto se
## resuelve el disparo, acierte o no.
func consume_ammo(amount: int = 1) -> void:
	if stats == null:
		return
	ammo = maxi(ammo - amount, 0)
	ammo_changed.emit(ammo, stats.max_ammo)


## Recarga completa. El original no tenía recarga (GDD §9): un enemigo que
## agotaba sus 50 balas quedaba inútil para el resto de la partida. Aquí
## `WeaponSystem` la dispara tras `WeaponStats.reload_s` de espera.
func refill_ammo() -> void:
	if stats == null:
		return
	ammo = stats.max_ammo
	ammo_changed.emit(ammo, stats.max_ammo)


func _die(killer_id: int) -> void:
	alive = false
	var xp := stats.xp_on_kill if stats != null else 0
	died.emit(killer_id)
	EventBus.character_died.emit(get_instance_id(), int(team), killer_id, xp)
