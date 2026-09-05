class_name FloorConfig
extends Resource
## Configuración de una planta de la Torre Chutaos.
## El original tenía 8 plantas × 6 zonas y una tabla de selección de mapa
## codificada a mano en GameAction::selectionMap(). Aquí es dato.

@export var floor_number: int = 1
@export var display_name_key: String = ""
## Dificultad base de la planta. Es el factor que el legacy pasaba a
## Optimization::CargarFuncionObjetivo() como constante; aquí se multiplica
## por el modelo vivo de habilidad del jugador (GDD §7).
@export var base_difficulty: float = 1.0

## Escena de mapa por zona (1..6). Índice 0 = zona 1.
@export var zone_maps: Array[String] = []
## Recompensa por zona (1..6), como id de pickup. Réplica de
## GameStatus::selectZona().
@export var zone_rewards: Array[StringName] = []

@export_group("Contenido")
@export var has_miniboss: bool = false
@export var has_megaboss: bool = false
## Arquetipos de enemigo permitidos en esta planta.
@export var enemy_pool: Array[StringName] = []
