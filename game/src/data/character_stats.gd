class_name CharacterStats
extends Resource
## Estadísticas de un arquetipo de personaje (jugable o enemigo).
##
## Valores canónicos tomados del proyecto original de 2012
## (legacy/trunk/core/include/CoreNamespace.h, namespace Core::Features).
## ADR-005: esta es la ÚNICA fuente de verdad. Ningún .gd debe contener
## un número de balanceo literal.

## Identificador estable. Debe coincidir con Core::Entities::Type del legacy.
@export var id: StringName = &""
## Clave de traducción del nombre mostrado (nunca texto literal).
@export var display_name_key: String = ""

@export_group("Vitales")
## Puntos de vida iniciales y máximos.
@export var max_health: float = 100.0
## Velocidad máxima en unidades del legacy (se convierte a m/s con Balance.LEGACY_TO_METERS).
@export var speed_legacy: float = 150.0
## Fuerza máxima de dirección (steering) del legacy.
@export var max_force: float = 3.0

@export_group("Combate")
## Milisegundos entre disparos. Semántica idéntica al `cadence` del legacy.
@export var cadence_ms: float = 100.0
## Daño por impacto antes de multiplicadores de zona.
@export var damage: float = 10.0
## Munición máxima transportada.
@export var max_ammo: int = 120

@export_group("Escuadra y progresión")
## Puntos de moral. Cada punto equivale a un compañero que obedece.
@export var morale: int = 0
## Experiencia que concede al morir.
@export var xp_on_kill: int = 0

@export_group("Percepción")
## Distancia máxima de visión, en metros.
@export var vision_range_m: float = 24.0
## Semiángulo del cono primario (foco), en grados.
@export var vision_fov_primary_deg: float = 35.0
## Semiángulo del cono secundario (periférico), en grados.
@export var vision_fov_secondary_deg: float = 75.0
## Retardo de reacción al detectar un contacto, en segundos. Nunca 0: la
## telepatía instantánea es lo que hace que un bot parezca tramposo.
@export var reaction_delay_s: float = 0.45

@export_group("Presentación")
## Color identificativo del arquetipo (el legacy asignaba uno por tipo).
@export var tint: Color = Color.WHITE


## Velocidad en m/s, derivada de las unidades del legacy.
func speed_mps() -> float:
	return speed_legacy * Balance.LEGACY_TO_METERS


## Disparos por segundo, derivados de la cadencia en ms.
func shots_per_second() -> float:
	if cadence_ms <= 0.0:
		return 0.0
	return 1000.0 / cadence_ms
