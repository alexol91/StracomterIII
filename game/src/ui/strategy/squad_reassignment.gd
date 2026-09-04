class_name SquadReassignment
extends RefCounted
## Lógica pura de la reasignación de escuadra en la pantalla de Estrategia
## (GDD §6: "se reasigna la escuadra... y se reparan las bajas").
##
## Sin nodos: la pantalla solo llama a estas funciones y pinta el resultado.
## Ningún método muta `GameState`; todo lo que hace esta clase es calcular,
## sobre una COPIA de los datos que se le pasan, qué pediría confirmar el
## jugador. La escritura real la hace quien atienda
## `UIIntents.strategy_confirmed` / `UIIntents.squad_revive_requested`.

## Coste en experiencia de revivir a un compañero caído. No existe todavía un
## campo de datos para esto (`CharacterStats` no tiene coste de progresión;
## `src/data/` no es de este agente).
## TODO(arquitecto): mover a dato — candidato: `CharacterStats.revive_xp_cost`
## o un recurso de progresión aparte si el coste no debe variar por arquetipo.
const REVIVE_XP_COST: int = 50

## Arquetipos jugables fijos. Coincide con `GameState.reset_run()`.
const ALL_ARCHETYPES: Array[StringName] = [
	&"captain", &"technician", &"specialist", &"demolition",
]


## Compañeros disponibles para reasignar: todos los arquetipos jugables
## menos el que controla el jugador (ese siempre va, no se "incluye").
static func companion_archetypes(player_archetype: StringName) -> Array[StringName]:
	var out: Array[StringName] = []
	for archetype: StringName in ALL_ARCHETYPES:
		if archetype != player_archetype:
			out.append(archetype)
	return out


## Coste total en XP de la selección actual: `REVIVE_XP_COST` por cada
## compañero caído que se marque para llevar (revivir).
## `included`: Dictionary[StringName, bool]; `snapshots`: Dictionary[StringName, GameState.CharacterSnapshot].
static func total_xp_cost(snapshots: Dictionary, included: Dictionary) -> int:
	var cost := 0
	for archetype: Variant in included.keys():
		if not bool(included[archetype]):
			continue
		var snap: GameState.CharacterSnapshot = snapshots.get(archetype, null)
		if snap != null and not snap.alive:
			cost += REVIVE_XP_COST
	return cost


static func can_confirm(experience: int, snapshots: Dictionary, included: Dictionary) -> bool:
	return total_xp_cost(snapshots, included) <= experience


## Selección de inclusión por defecto al abrir la pantalla: todo compañero
## vivo se lleva; los caídos empiezan sin marcar (revivirlos es una decisión
## explícita y con coste, no un valor por defecto).
static func default_included(snapshots: Dictionary, player_archetype: StringName) -> Dictionary:
	var out: Dictionary = {}
	for archetype: StringName in companion_archetypes(player_archetype):
		var snap: GameState.CharacterSnapshot = snapshots.get(archetype, null)
		out[archetype] = snap != null and snap.alive
	return out
