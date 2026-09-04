class_name WeaponStats
extends Resource
## Estadísticas de un arma. Réplica de los tres modos de ataque del original:
## arma de fuego (Shoot), cuchillo (Slash) y explosivo (Explosion).

enum Kind { HITSCAN, MELEE, EXPLOSIVE }

@export var id: StringName = &""
@export var display_name_key: String = ""
@export var kind: Kind = Kind.HITSCAN

@export_group("Balística")
## Milisegundos entre disparos.
@export var cadence_ms: float = 100.0
@export var damage: float = 10.0
@export var range_m: float = 60.0
## Dispersión base en grados, con el arma en reposo.
@export var spread_base_deg: float = 0.4
## Dispersión máxima en grados, con fuego sostenido.
@export var spread_max_deg: float = 4.5
## Grados de dispersión añadidos por disparo.
@export var spread_per_shot_deg: float = 0.6
## Grados de dispersión recuperados por segundo sin disparar.
@export var spread_recovery_deg_per_s: float = 3.0

@export_group("Munición")
@export var magazine: int = 30
@export var reload_s: float = 2.0
## Si es true, el arma no consume munición (cuchillo).
@export var infinite_ammo: bool = false

@export_group("Explosivo")
## Radio de la explosión en metros. El legacy usaba 150 u
## (Core::explosionRadius) ≈ 2 m con la escala del remake.
@export var blast_radius_m: float = 2.0
## Si es true, la explosión daña también a los aliados. Decisión de diseño
## deliberada: hace que la clase Explosivo sea interesante y no barra libre.
@export var friendly_fire: bool = true

@export_group("Ruido")
## Intensidad del evento sonoro que genera el disparo (0..1). Alimenta el
## oído de la IA y, con E-04, la información táctica del jugador.
@export var noise_intensity: float = 1.0
@export var noise_radius_m: float = 45.0
