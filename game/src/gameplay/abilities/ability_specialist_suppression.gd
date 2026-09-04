class_name AbilitySpecialistSuppression
extends Ability
## "Supresión" (Especialista, `E-01`): fuego sostenido que marca supresión.
##
## La marca vive en `Blackboard` (`src/core/blackboard.gd`, autoload — NO
## `src/ai/`: es la pizarra COMPARTIDA entre `gameplay/` y `ai/`, ver
## `02-arquitectura.md` §3). `ai-squad` la lee con
## `Blackboard.has_active_suppression(squad_id)` para decidir si puede asaltar
## (GDD §8.4: "nadie asalta sin supresión activa de un compañero").

## Duración del fuego sostenido al activarse. No existe en `CharacterStats`.
## TODO(arquitecto): mover a datos (p. ej. `CharacterStats.suppression_duration_s`).
@export var sustain_s: float = 2.5

var _sustain_remaining_s: float = 0.0


func _on_tick(delta: float) -> void:
	if _sustain_remaining_s <= 0.0:
		return
	_sustain_remaining_s = maxf(_sustain_remaining_s - delta, 0.0)
	# `character.fire()` solo pone la intención; quien la resuelve de verdad
	# (raycast, daño, munición) sigue siendo `weapon_system.gd`.
	character.fire()
	Blackboard.mark_suppression(character.squad_id, maxf(_sustain_remaining_s, delta))


func _activate() -> void:
	_sustain_remaining_s = sustain_s
	Blackboard.mark_suppression(character.squad_id, sustain_s)
