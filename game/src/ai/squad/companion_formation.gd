class_name CompanionFormation
## Formación de la escuadra del jugador ([P05], análisis §5.3).
##
## RÉPLICA DE LA DISPOSICIÓN, NO DEL NÚMERO. El original define tres offsets
## locales en `Player.cc:75-85`: `(−120, −60)`, `(120, −60)` y `(0, −120)`, es
## decir dos alas simétricas un paso por detrás del líder y un tercero en el
## eje, al doble de profundidad. Esa disposición es buena y se conserva
## íntegra, incluidas las proporciones (lateral : profundidad : retaguardia =
## 2 : 1 : 2).
##
## Los números, en cambio, no sobreviven al cambio de escala. A
## `Balance.LEGACY_TO_METERS` (1/75, deducido del radio de personaje de 30 u =
## 0,4 m) esos offsets valen 1,6 m de lateral y 0,8 m de profundidad. Con un
## radio de agente de navmesh de 0,4 m (`NavTuning.AGENT_RADIUS_M`), cuatro
## personajes en 1,6 m van literalmente hombro con hombro: la evitación local
## los empuja unos contra otros, la formación se deshace sola y ninguno puede
## disparar sin cruzar la línea de fuego del vecino. En 2D cenital con
## sprites de 2012 aquello se veía bien; en un TPS 3D, no.
##
## Por eso se aplica `SquadTuning.FORMATION_SCALE` (×1,5) ENCIMA de la
## conversión: 2,4 m de lateral y 1,2 m de profundidad. Sigue cabiendo de
## sobra dentro del aura de 8 m del Capitán (`CharacterStats.aura_radius_m`),
## que es la otra restricción que la formación tiene que respetar para que la
## regeneración del aura signifique algo.
##
## DESVIACIÓN DOCUMENTADA: offsets = legacy × (1/75) × 1,5.

## Offsets del original, en unidades legacy, en el orden en que los declara
## `Player.cc`. Índice = hueco de formación.
const LEGACY_OFFSETS: Array[Vector2] = [
	Vector2(-120.0, -60.0),
	Vector2(120.0, -60.0),
	Vector2(0.0, -120.0),
]

const SLOT_COUNT: int = 3

## Qué clase ocupa cada hueco según la clase que lleve el jugador. Réplica
## literal de `GameAction::StartUp` (`GameAction.cc:217-239`): el original
## creaba SIEMPRE los tres tipos que no eras tú, y el reparto de huecos
## dependía de tu clase. El "Explosivo" del original es `demolition` aquí.
##
## Es una tabla ESTRUCTURAL (quién va dónde), no de balanceo: por eso vive en
## código y no en `src/data/`.
const SLOTS_BY_PLAYER_ARCHETYPE: Dictionary[StringName, Array] = {
	&"captain": [&"demolition", &"technician", &"specialist"],
	&"technician": [&"demolition", &"specialist", &"captain"],
	&"specialist": [&"demolition", &"technician", &"captain"],
	&"demolition": [&"captain", &"technician", &"specialist"],
}


## Offset del hueco en el espacio LOCAL del líder, en metros. En convención de
## Godot el frente del líder es −Z, así que "detrás" es +Z.
static func slot_offset(slot: int) -> Vector3:
	if slot < 0 or slot >= LEGACY_OFFSETS.size():
		return Vector3.ZERO
	var legacy := LEGACY_OFFSETS[slot]
	var scale := Balance.LEGACY_TO_METERS * SquadTuning.FORMATION_SCALE
	# legacy.y es negativo hacia atrás; en local de Godot atrás es +Z.
	return Vector3(legacy.x * scale, 0.0, -legacy.y * scale)


## Posición de mundo del hueco, dados líder y rumbo. `leader_forward` se
## aplana al plano XZ: la formación no sube por las rampas del líder.
static func world_slot(leader_position: Vector3, leader_forward: Vector3, slot: int) -> Vector3:
	var forward := leader_forward
	forward.y = 0.0
	if forward.length_squared() < 0.0001:
		forward = Vector3.FORWARD
	forward = forward.normalized()
	var right := forward.cross(Vector3.UP)
	var offset := slot_offset(slot)
	return leader_position + right * offset.x - forward * offset.z


## Clase que ocupa el hueco `slot` cuando el jugador lleva `player_archetype`.
static func archetype_for_slot(player_archetype: StringName, slot: int) -> StringName:
	var table: Array = SLOTS_BY_PLAYER_ARCHETYPE.get(player_archetype, [])
	if slot < 0 or slot >= table.size():
		return &""
	return table[slot]


## Hueco que le corresponde a `companion_archetype`, o -1 si esa clase no
## forma parte de la escuadra de ese jugador (porque es la suya propia).
static func slot_for_archetype(
	player_archetype: StringName, companion_archetype: StringName
) -> int:
	var table: Array = SLOTS_BY_PLAYER_ARCHETYPE.get(player_archetype, [])
	for i in table.size():
		if table[i] == companion_archetype:
			return i
	return -1
