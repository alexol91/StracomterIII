class_name Weapon
extends RefCounted
## Estado de ejecución de UN arma en manos de UN personaje: dispersión,
## cadencia y recarga. Es lógica PURA (sin `Node`, sin física, sin señales) a
## propósito: así se prueba en `--headless` sin construir una sola escena,
## igual que `BotState`/`WorldQuery` en `ai/contracts` hacen con la IA.
##
## Quien resuelve el disparo contra el mundo (raycast, `Damage`, sonido,
## `EventBus`) es `weapon_system.gd`, que es un `Node` y sí vive en la escena.
## `Weapon` solo sabe "¿puedo disparar ya?" y "¿cuánto se ha abierto la mira?".
##
## DECISIÓN DE DISEÑO (documentada, ver informe al arquitecto): el legacy no
## tenía una clase "Arma" separada — `Character::rate` y `Character::damage`
## eran del PERSONAJE, no de un objeto Weapon (`Character.cc:328-346`). Para
## no perder la fidelidad exacta de cadencia/daño por arquetipo (§3 de
## `legacy-gameplay.md`, en particular los enemigos, que no tienen un
## `WeaponStats` propio en `src/data/weapons/`), la CADENCIA se inyecta desde
## fuera (normalmente `CharacterStats.cadence_ms`) y NO se lee de `stats`.
## `stats` (`WeaponStats`) sigue aportando todo lo que el legacy no tenía:
## dispersión, recarga, alcance, radio de explosión, fuego amigo y ruido.
##
## Cadencia: en MILISEGUNDOS entre disparos, semántica idéntica a
## `Character::rate` del legacy. NO en disparos/s.

var stats: WeaponStats = null
## Milisegundos entre disparos. Normalmente `character.stats.cadence_ms`.
var cadence_ms: float = 100.0

## Grados de dispersión actual. Sube con cada disparo, baja con el tiempo.
## Vive entre `spread_base_deg` (reposo) y `spread_max_deg` (fuego sostenido).
var spread_deg: float = 0.0

## Segundos transcurridos desde el último disparo. Se inicializa "grande"
## para que el primer disparo de la partida nunca quede bloqueado por cadencia.
var _time_since_last_shot_s: float = 1.0e9

var is_reloading: bool = false
var reload_remaining_s: float = 0.0


func _init(p_stats: WeaponStats, p_cadence_ms: float = 0.0) -> void:
	stats = p_stats
	cadence_ms = p_cadence_ms if p_cadence_ms > 0.0 else (p_stats.cadence_ms if p_stats != null else 100.0)
	if stats != null:
		spread_deg = stats.spread_base_deg


## Avanza el estado del arma. Llamarlo una vez por tick de física, siempre
## (dispare o no el personaje), para que la dispersión se recupere y la
## recarga progrese.
func tick(delta: float) -> void:
	if stats == null or delta <= 0.0:
		return
	_time_since_last_shot_s += delta
	spread_deg = maxf(spread_deg - stats.spread_recovery_deg_per_s * delta, stats.spread_base_deg)
	if is_reloading:
		reload_remaining_s = maxf(reload_remaining_s - delta, 0.0)
		if reload_remaining_s <= 0.0:
			is_reloading = false


## ¿Ha pasado suficiente cadencia desde el último disparo? NO comprueba
## munición — eso es responsabilidad de `Character.can_fire_ammo()`, porque
## la munición es del personaje (réplica del legacy) y la cadencia es del arma.
func cadence_ready() -> bool:
	return (_time_since_last_shot_s * 1000.0) >= cadence_ms


func can_fire() -> bool:
	return not is_reloading and cadence_ready()


## Registra que se ha disparado: reinicia el reloj de cadencia y aumenta la
## dispersión. Debe llamarse exactamente una vez por disparo resuelto,
## acierte o falle (la dispersión sube igual en ambos casos, como la cadencia).
func register_shot() -> void:
	if stats == null:
		return
	_time_since_last_shot_s = 0.0
	spread_deg = minf(spread_deg + stats.spread_per_shot_deg, stats.spread_max_deg)


func start_reload() -> void:
	if stats == null or is_reloading:
		return
	is_reloading = true
	reload_remaining_s = stats.reload_s


## Dirección de disparo con la dispersión actual aplicada: rota `aim_direction`
## un ángulo aleatorio dentro del cono de `spread_deg` de semiángulo.
## `rng` es inyectable para que los tests sean deterministas.
func apply_spread(aim_direction: Vector3, rng: RandomNumberGenerator) -> Vector3:
	if spread_deg <= 0.0 or aim_direction.length_squared() <= 0.0:
		return aim_direction.normalized()
	var forward := aim_direction.normalized()
	# Eje perpendicular arbitrario para poder rotar `forward` en cualquier
	# dirección dentro del cono, no solo en un plano fijo.
	var perpendicular := forward.cross(Vector3.UP)
	if perpendicular.length_squared() < 0.0001:
		perpendicular = forward.cross(Vector3.RIGHT)
	perpendicular = perpendicular.normalized()
	var max_angle_rad := deg_to_rad(spread_deg)
	var angle := rng.randf_range(0.0, max_angle_rad)
	var roll := rng.randf_range(0.0, TAU)
	var cone_axis := perpendicular.rotated(forward, roll)
	return forward.rotated(cone_axis, angle).normalized()


## Caída lineal de daño de explosión: `daño × (1 − dist/radio)`.
## Réplica exacta de `EventControl::Explosion` (`EventControl.cc:170-215`,
## legacy). Fuera del radio, 0. Función estática y pura: se prueba sin
## instanciar nada.
static func explosion_damage(base_damage: float, distance_m: float, radius_m: float) -> float:
	if radius_m <= 0.0 or distance_m >= radius_m:
		return 0.0
	var clamped_distance := maxf(distance_m, 0.0)
	return base_damage * (1.0 - clamped_distance / radius_m)
