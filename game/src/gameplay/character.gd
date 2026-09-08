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

## Segundos que sobrevive la intención de MOVIMIENTO sin que nadie la refresque.
##
## Existe porque `intent_move` no es un evento como disparar: es un NIVEL —
## «quiero ir hacia allí»— y hasta ahora se borraba al final de cada paso de
## física como si fuera un evento. El input humano lo reescribe en cada paso,
## así que al jugador no le pasaba nada. Un cerebro de IA lo escribe en su tick
## de COMPORTAMIENTO, a 20 Hz (ADR-002), y la física va a 60: dos de cada tres
## pasos encontraban la intención ya borrada y el bot avanzaba a UN TERCIO de
## su velocidad. El Sicario, con 2 m/s en su ficha, se medía a 0,66 m/s en la
## sonda de combate.
##
## Ni un error ni un aviso: solo enemigos que tardan el triple en llegar, que
## desde el sofá es indistinguible de «la IA es pasiva». Y el efecto se
## multiplicaba con el resto de la cadena: un bot que tarda treinta segundos en
## cruzar la planta no llega a disparar dentro de la ventana de la sonda.
##
## 0,15 s cubre dos periodos de comportamiento con holgura. Nadie depende del
## vencimiento para PARAR: quien quiere parar lo dice (`move_to(Vector3.ZERO)`,
## `CharacterActuator.stop()`), y el vencimiento es solo la red que evita que
## un cuerpo cuyo cerebro ha muerto siga caminando para siempre.
const MOVE_INTENT_TTL_S: float = 0.15

## --- Intenciones. Las rellena el controlador (humano o IA) cada frame. ---
## Dirección de movimiento deseada, normalizada, en espacio de mundo.
##
## Sobrevive entre pasos de física hasta `MOVE_INTENT_TTL_S`; ver esa constante.
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

## Segundos desde el último `move_to`. Ver `MOVE_INTENT_TTL_S`.
var _move_intent_age_s: float = 0.0


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
	# Que exista alguien a quien darle un cerebro es una noticia, y se publica
	# como tal. `gameplay` no sabe quién escucha ni le importa.
	EventBus.character_spawned.emit(self, int(team), archetype)


## Limpia las intenciones de EVENTO. Debe llamarse al final de cada tick de
## física para que una intención no persista un frame de más.
##
## `intent_move` no está aquí: es un nivel, no un evento, y lo caduca
## `age_move_intent()`. `intent_look_at` tampoco, por lo mismo.
func clear_intents() -> void:
	intent_fire = false
	intent_melee = false
	intent_reload = false
	intent_ability = false


## Envejece la intención de movimiento y la descarta al vencer. La llama quien
## mueve el cuerpo, una vez por paso de física.
func age_move_intent(delta: float) -> void:
	if intent_move == Vector3.ZERO:
		return
	_move_intent_age_s += delta
	if _move_intent_age_s > MOVE_INTENT_TTL_S:
		intent_move = Vector3.ZERO


# --- API de intención. Es lo único que un cerebro de IA debe llamar. ---

func move_to(direction: Vector3) -> void:
	intent_move = direction.normalized() if direction.length_squared() > 0.0 else Vector3.ZERO
	_move_intent_age_s = 0.0


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
	return teams_are_hostile(int(team), int(other.team))


## ¿Son enemigos estos dos equipos? Estática y por número de equipo para que la
## use quien no tiene los dos cuerpos delante — la percepción de `ai/` trabaja
## con instantáneas, no con nodos, y necesita LA MISMA regla.
##
## Tenerla duplicada costó un compañero disparando al jugador: la percepción
## comparaba `team != team` y para un compañero (1) el jugador (0) era «otro
## equipo». Aquí solo hay dos bandos, y el que manda es si eres ENEMY.
static func teams_are_hostile(a: int, b: int) -> bool:
	return (a == int(Team.ENEMY)) != (b == int(Team.ENEMY))


# --- Daño y muerte ---

## Metadato que hace invulnerable a un personaje. Lo pone el truco `god` de la
## consola y lo usa el capturador de pantallas.
##
## Estaba a medias: `GameCheats` escribía el metadato y NADIE lo leía, así que
## el truco contestaba «Modo dios activado» y el jugador seguía muriéndose.
## Un truco que no hace nada es peor que uno que no existe: parece que el
## problema está en otro sitio.
const GODMODE_META: StringName = &"godmode"


func apply_damage(damage: Damage) -> void:
	if not alive:
		return
	if get_meta(GODMODE_META, false):
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
