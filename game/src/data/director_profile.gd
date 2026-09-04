class_name DirectorProfile
extends Resource
## Parámetros del Director de Encuentros.
##
## Los coeficientes del Simplex son los del proyecto original
## (legacy/trunk/Optimization/lib/Optimization.cc). Se conservan como dato
## para poder rebalancear sin tocar el algoritmo (ADR-003).

@export_group("Simplex — formulación original")
## Divisor del área en la fórmula MaxEnemies = log((area/div) * dif) * mult.
@export var max_enemies_area_divisor: float = 250.0
@export var max_enemies_multiplier: float = 10.0
## Coeficientes de daño por arquetipo (x1, x2, x3) de la restricción 1.
@export var damage_coefficients: PackedFloat32Array = PackedFloat32Array([60.0, 100.0, 120.0])
## Coeficientes de vida por arquetipo, restricción 2.
@export var health_coefficients: PackedFloat32Array = PackedFloat32Array([45.0, 50.0, 65.0])
## Coeficientes de velocidad por arquetipo, restricción 3.
@export var speed_coefficients: PackedFloat32Array = PackedFloat32Array([60.0, 45.0, 35.0])
## Presupuestos: se multiplican por MaxEnemies. El legacy usaba 280/3, 155/3, 140/3.
@export var damage_budget_per_enemy: float = 93.3333
@export var health_budget_per_enemy: float = 51.6667
@export var speed_budget_per_enemy: float = 46.6667

@export_group("Modelo de habilidad (DDA)")
## Ventana de la media móvil, en encuentros.
@export var skill_window: int = 8
## Rango en el que el modelo puede escalar la dificultad de la planta.
@export var skill_multiplier_min: float = 0.65
@export var skill_multiplier_max: float = 1.75
## Pesos de las señales observadas del jugador. Deben sumar 1.
@export var weight_accuracy: float = 0.30
@export var weight_damage_taken: float = 0.30
@export var weight_clear_time: float = 0.20
@export var weight_squad_losses: float = 0.10
@export var weight_cover_usage: float = 0.10

@export_group("Curva de tensión")
## Fracción del presupuesto liberada en cada fase: ascenso, pico, alivio.
@export var phase_budget_fractions: PackedFloat32Array = PackedFloat32Array([0.45, 0.45, 0.10])
@export var relief_duration_s: float = 15.0
## Silencio forzado antes de la siguiente zona.
@export var rest_duration_s: float = 30.0

@export_group("Reglas de aparición justa")
## Distancia mínima al jugador, en metros. El legacy usaba 200 u ≈ 2,7 m y los
## enemigos aparecían en la cara del jugador.
@export var min_spawn_distance_m: float = 12.0
## Si es true, nunca se genera un enemigo dentro del cono de visión del jugador.
@export var forbid_spawn_in_player_fov: bool = true
## Si es true, nunca se genera con línea de visión directa al jugador.
@export var forbid_spawn_with_line_of_sight: bool = true
## Preferir accesos reales (puertas, escaleras, ascensores) frente a mitad de sala.
@export var prefer_entry_points: bool = true
