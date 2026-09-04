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

@export_group("Composición objetivo")
## Cuota mínima y máxima de cada arquetipo sobre el total. El mínimo es lo que
## hace **imposible por construcción** la degeneración del original, donde el
## óptimo entero daba ~26 enemigos del mismo tipo.
@export var min_share_per_archetype: float = 0.12
@export var max_share_per_archetype: float = 0.55
## Cuánto desplaza la forma del mapa a la composición objetivo (0 = nada).
@export var shape_gain: float = 0.5
## Cuánto desplaza la forma del mapa a los presupuestos.
@export var budget_shape_gain: float = 0.35

@export_group("Puntuación de composición")
## Pesos de los cinco términos de la búsqueda. Son balanceo puro: subir
## `weight_variety` produce encuentros más mezclados, subir `weight_novelty`
## produce oleadas que se parecen menos entre sí.
@export var weight_target: float = 1.0
@export var weight_variety: float = 0.6
@export var weight_novelty: float = 0.4
@export var weight_budget: float = 0.8
@export var weight_map_fit: float = 0.9

@export_group("Referencias del modelo de habilidad")
## Daño por minuto que se considera rendimiento neutro.
@export var reference_damage_per_minute: float = 60.0
## Tiempo esperado de limpieza: base más un término por enemigo. NO se compara
## con la mediana observada: si la referencia se moviera con el jugador, tardar
## más subiría el listón y jugar peor acabaría dando más amenaza, rompiendo el
## invariante de monotonía. La mediana observada se conserva solo como
## diagnóstico.
@export var expected_clear_time_base_s: float = 20.0
@export var expected_clear_time_per_enemy_s: float = 4.0
## Uso de cobertura que se considera neutro.
@export var reference_cover_usage: float = 0.45
## Puntuación de un jugador del que aún no se sabe nada.
@export var neutral_score: float = 0.5

@export_group("Ritmo de oleadas")
@export var rise_wave_count: int = 3
@export var peak_wave_count: int = 1
@export var relief_wave_count: int = 1
## Segundos mínimos entre oleadas.
@export var min_wave_interval_s: float = 8.0
## Hostiles vivos por debajo de los cuales se lanza la siguiente oleada.
@export var max_hostiles_for_next_wave: int = 6
## Ídem, más estricto, para entrar en la fase de pico.
@export var max_hostiles_for_peak: int = 3

@export_group("Aparición: ponderación")
## Semiángulo del cono de visión del jugador usado para vetar apariciones.
## Debería derivarse del FOV real de la cámara cuando la UI lo fije.
@export var player_fov_half_angle_deg: float = 55.0
## Distancia de camino a la que la ponderación de un punto cae a la mitad.
@export var path_distance_falloff_m: float = 25.0
## Multiplicador de peso para los accesos reales (puertas, escaleras).
@export var entry_point_weight_bonus: float = 2.0

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
