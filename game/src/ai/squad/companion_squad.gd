class_name CompanionSquad
extends RefCounted
## La escuadra del jugador: tres compañeros, una orden vigente y la moral
## que decide cuántos de los tres la obedecen ([P05], GDD §8.5).
##
## Es el equivalente de `EntityManager::getIACompains()` + `EventControl`
## del original, con dos diferencias que importan:
##
##   1. El original tenía UNA orden (tecla V → `ComeBackCompanions`, que era
##      "venid aquí") y ni foco de fuego ni posiciones. Aquí son tres.
##   2. El original no comunicaba nada entre bots: cada compañero leía
##      directamente el puntero del jugador y de sus atacantes. Aquí la
##      comunicación pasa por datos explícitos y por la pizarra; ningún bot
##      lee el estado interno de otro.
##
## Sigue siendo un `RefCounted`: sin nodos, sin escena, sin `_process`.
## Quien lo monta le entrega las instantáneas (`BotState`) y la posición del
## líder cada tick de decisión, y recoge las directivas.

## Escuadra en la pizarra. Comparte espacio de nombres con los grupos
## enemigos, así que el jugador y sus compañeros necesitan el suyo.
var squad_id: int = 0
## Clase que lleva el jugador. Decide qué compañero ocupa cada hueco
## (`CompanionFormation.SLOTS_BY_PLAYER_ARCHETYPE`).
var player_archetype: StringName = &"captain"
## Orden vigente del jugador.
var order: SquadOrder = SquadOrder.new()

var _controllers: Dictionary[int, CompanionController] = {}
## Orden de creación, para que `decide_all` sea determinista.
var _order_of_ids: PackedInt32Array = PackedInt32Array()
var _last_directives: Array[CompanionDirective] = []
var _event_bus_bound: bool = false


func _init(p_squad_id: int = 0, p_player_archetype: StringName = &"captain") -> void:
	squad_id = p_squad_id
	player_archetype = p_player_archetype


# ---------------------------------------------------------------------------
# Altas y bajas
# ---------------------------------------------------------------------------

## Da de alta un compañero. El hueco de formación sale de la tabla del
## original según la clase del jugador; si esa clase no forma parte de la
## escuadra (porque es la del propio jugador) se le asigna el primer hueco
## libre, que es lo que hay que hacer con los evolutivos que añadan clases.
func add_companion(bot_id: int, archetype: StringName, base_morale: int = -1) -> CompanionController:
	var slot := CompanionFormation.slot_for_archetype(player_archetype, archetype)
	if slot < 0:
		slot = _first_free_slot()
	var morale := base_morale
	if morale < 0:
		var stats := Balance.character(archetype)
		morale = stats.morale if stats != null else 0
	var controller := CompanionController.new(bot_id, archetype, slot, morale)
	_controllers[bot_id] = controller
	if not _order_of_ids.has(bot_id):
		_order_of_ids.append(bot_id)
	return controller


func companion(bot_id: int) -> CompanionController:
	return _controllers.get(bot_id, null)


func companion_ids() -> PackedInt32Array:
	return _order_of_ids.duplicate()


func size() -> int:
	return _controllers.size()


## Una baja en la escuadra. Los supervivientes pierden moral.
##
## EXTENSIÓN sobre el original, que no tenía ninguna penalización: la moral
## solo subía por cercanía al Capitán y bajaba al alejarse (análisis §5.1).
## Que las bajas pesen es lo que convierte la moral en un recurso que el
## jugador administra en vez de en un número que sube y baja solo.
func on_member_died(bot_id: int) -> void:
	var was_ours := _controllers.has(bot_id)
	if was_ours:
		_controllers.erase(bot_id)
		var index := _order_of_ids.find(bot_id)
		if index >= 0:
			_order_of_ids.remove_at(index)
	if not was_ours:
		return
	for id: int in _order_of_ids:
		var c: CompanionController = _controllers[id]
		c.morale_penalty += SquadTuning.MORALE_LOSS_ON_SQUAD_DEATH


# ---------------------------------------------------------------------------
# Moral
# ---------------------------------------------------------------------------

## Radio del aura del Capitán, en metros. Es el mismo dato que usa
## `gameplay/auras/aura_emitter.gd`; se lee de `Balance` y no se copia, para
## que la moral y la regeneración no puedan divergir nunca.
static func captain_aura_radius_m() -> float:
	var stats := Balance.character(&"captain")
	return stats.aura_radius_m if stats != null else 0.0


## Actualiza qué compañeros están dentro del aura de un Capitán vivo.
## Réplica de `EventControl::UpdateMoral`: cerca de un Capitán la moral sube
## al máximo; lejos, vuelve a la de la ficha.
func refresh_near_captain(
	positions: Dictionary[int, Vector3],
	captain_positions: Array[Vector3],
	radius_m: float
) -> void:
	for id: int in _order_of_ids:
		var controller: CompanionController = _controllers[id]
		var p: Vector3 = positions.get(id, Vector3.INF)
		var near := false
		if not is_inf(p.x):
			for captain: Vector3 in captain_positions:
				if p.distance_to(captain) <= radius_m:
					near = true
					break
		controller.near_captain = near


## Cuántos compañeros obedecerían ahora mismo. Es la lectura de grupo de
## "cada punto de moral = un compañero": lo que cuenta no es cuántos siguen
## vivos, sino cuántos harían lo que les pides.
func obedient_count() -> int:
	var total := 0
	for directive: CompanionDirective in _last_directives:
		if directive.obeys:
			total += 1
	return total


func last_directives() -> Array[CompanionDirective]:
	return _last_directives


# ---------------------------------------------------------------------------
# Órdenes del jugador
# ---------------------------------------------------------------------------

func order_move_to(point: Vector3) -> void:
	order = SquadOrder.move_to(point)


func order_focus_target(target_id: int, point: Vector3) -> void:
	order = SquadOrder.focus_target(target_id, point)


func order_hold_position(point: Vector3 = Vector3.INF) -> void:
	order = SquadOrder.hold_position(point)


func clear_order() -> void:
	order = SquadOrder.none()


## Se engancha a la habilidad *Órdenes* del Capitán
## (`gameplay/abilities/ability_captain_orders.gd`, señal `target_marked`).
##
## `gameplay/` no conoce `ai/` (ADR-001): la habilidad se limita a resolver a
## qué hostil apunta el Capitán y a emitir. Quién reacciona es esto. La
## conexión va en este sentido —`ai/` escuchando a `gameplay/`— y nunca al
## revés.
func bind_captain_orders(source: Object) -> bool:
	if source == null or not source.has_signal(&"target_marked"):
		push_error("CompanionSquad: la fuente no emite 'target_marked'.")
		return false
	var callable := Callable(self, "_on_target_marked")
	if source.is_connected(&"target_marked", callable):
		return true
	source.connect(&"target_marked", callable)
	return true


## Engancha TODAS las habilidades de *Órdenes* que haya en la escena. El
## grupo lo declara la propia habilidad en su `_ready`.
func bind_all_captain_orders(tree: SceneTree) -> int:
	if tree == null:
		return 0
	var bound := 0
	for node: Node in tree.get_nodes_in_group(&"ability_captain_orders"):
		if bind_captain_orders(node):
			bound += 1
	return bound


func _on_target_marked(position: Vector3, target_id: int) -> void:
	order_focus_target(target_id, position)


## Escucha las bajas en `EventBus`. Explícito y no automático para que las
## pruebas controlen cuándo hay conexión global.
func bind_event_bus() -> void:
	if _event_bus_bound:
		return
	EventBus.character_died.connect(_on_character_died)
	_event_bus_bound = true


func unbind_event_bus() -> void:
	if not _event_bus_bound:
		return
	EventBus.character_died.disconnect(_on_character_died)
	_event_bus_bound = false


func _on_character_died(character_id: int, _team: int, _killer_id: int, _xp: int) -> void:
	on_member_died(character_id)


# ---------------------------------------------------------------------------
# Decisión
# ---------------------------------------------------------------------------

## Directivas de todos los compañeros, en orden de alta (determinista).
## `states` se indexa por `bot_id`; un compañero sin instantánea recibe una
## directiva de supervivencia, no una directiva vacía: no saber cómo está un
## compañero no es motivo para mandarlo a ninguna parte.
func decide_all(
	states: Dictionary[int, BotState],
	leader_position: Vector3,
	leader_forward: Vector3
) -> Array[CompanionDirective]:
	var out: Array[CompanionDirective] = []
	for id: int in _order_of_ids:
		var controller: CompanionController = _controllers[id]
		var state: BotState = states.get(id, null)
		out.append(controller.decide(state, order, leader_position, leader_forward))
	_last_directives = out
	return out


func _first_free_slot() -> int:
	var used: Dictionary[int, bool] = {}
	for id: int in _order_of_ids:
		used[_controllers[id].slot] = true
	for i in CompanionFormation.SLOT_COUNT:
		if not used.has(i):
			return i
	return CompanionFormation.SLOT_COUNT - 1
