extends Node
## Bus de señales globales. Única vía de comunicación entre capas que no
## respetan la jerarquía de nodos.
##
## Regla de arquitectura: las capas superiores escuchan a las inferiores.
## `gameplay/` emite, `ai/` y `director/` escuchan. Nunca al contrario.

## Un personaje ha entrado en juego. Es la costura por la que `ai/` se entera
## de que hay alguien a quien darle un cerebro sin que `levels/` —que es quien
## lo instancia y vive por debajo— tenga que conocer `ai/` (regla 2 de
## CLAUDE.md: las dependencias van solo hacia abajo).
##
## Lleva el nodo, no solo su id: quien engancha un cerebro necesita el cuerpo.
signal character_spawned(character: Node, team: int, archetype: StringName)

## Un personaje ha muerto. `killer_team` permite atribuir puntuación y XP.
signal character_died(character_id: int, team: int, killer_id: int, xp: int)
## Un personaje ha recibido daño. La IA lo usa para su cola de atacantes, que
## necesita saber QUIÉN dispara y de qué bando: sin eso, un bot herido sabe que
## le atacan pero no a quién responder. El original lo resolvía pasándose el
## puntero del atacante (EventControl::postDisparo); aquí van los dos ids.
signal character_damaged(
	character_id: int,
	amount: float,
	from_position: Vector3,
	attacker_id: int,
	attacker_team: int
)
## Se ha emitido un ruido en el mundo. Alimenta el oído de la IA (GDD §8.1).
## `intensity` en 0..1, `radius_m` en metros.
signal noise_emitted(position: Vector3, intensity: float, radius_m: float, source_id: int)
## Una puerta ha cambiado de estado. `ai/navigation` reacciona conmutando
## el NavigationLink3D correspondiente (ADR-004).
signal door_state_changed(door_id: int, is_open: bool)
## La topología del nivel ha cambiado (p. ej. demolición del Explosivo, E-01).
## Obliga a rehornear navmesh y nube de coberturas.
signal level_topology_changed(region_aabb: AABB)
## Un disparo se ha resuelto. `hit` indica si impactó; alimenta el modelo de
## habilidad del director.
signal shot_resolved(shooter_id: int, hit: bool, is_headshot: bool)
## Una zona se ha limpiado de hostiles.
signal zone_cleared(floor_number: int, zone: int, elapsed_s: float)
## El jugador ha recogido un objeto.
signal pickup_collected(pickup_id: StringName, character_id: int)
## Cambio en el estado de la máquina de juego (menú, estrategia, acción...).
signal game_mode_changed(previous: int, current: int)


## Emite un ruido en el mundo. Envoltorio para que quien lo llama no tenga que
## conocer la firma de la señal.
func emit_noise(position: Vector3, intensity: float, radius_m: float, source_id: int = 0) -> void:
	noise_emitted.emit(position, clampf(intensity, 0.0, 1.0), maxf(radius_m, 0.0), source_id)
