extends TestCase
## `StrategyViewModel` ensambla lo que pinta la pantalla de Estrategia. Estas
## pruebas comprueban que las 6 zonas y la escuadra salen bien formadas SIN
## instanciar ningún `Control` (es puro `Balance`/`GameState` → `Dictionary`).
##
## `GameState` es un autoload compartido por toda la suite: dos pruebas
## tocando la escuadra o el arquetipo del jugador sin restaurarlo después se
## contaminarían entre sí (y con las de otros agentes). `before_each`/
## `after_each` usan `to_dict()`/`from_dict()` — el propio contrato de
## serialización de `GameState` — para dejarlo exactamente como estaba.

var _snapshot: Dictionary = {}


func before_each() -> void:
	_snapshot = GameState.to_dict()


func after_each() -> void:
	GameState.from_dict(_snapshot)


func test_zone_entries_returns_six_zones_in_order() -> void:
	var cfg := Balance.floor_config(1)
	var entries := StrategyViewModel.zone_entries(cfg)
	assert_size(entries, GameState.ZONES_PER_FLOOR)
	for i: int in entries.size():
		assert_eq(int(entries[i]["zone"]), i + 1)


func test_zone_entries_reward_amount_matches_pickup_data() -> void:
	var cfg := Balance.floor_config(2)
	var entries := StrategyViewModel.zone_entries(cfg)
	for i: int in entries.size():
		var entry: Dictionary = entries[i]
		var pickup := Balance.pickup(cfg.zone_rewards[i])
		assert_almost_eq(float(entry["reward_amount"]), pickup.amount, 0.001)
		assert_eq(String(entry["reward_key"]), pickup.display_name_key)


func test_zone_entries_empty_when_no_floor_config() -> void:
	assert_size(StrategyViewModel.zone_entries(null), 0)


func test_squad_entries_excludes_player_archetype() -> void:
	GameState.player_archetype = &"captain"
	var entries := StrategyViewModel.squad_entries(&"captain")
	assert_size(entries, 3)
	for entry: Dictionary in entries:
		assert_ne(entry["archetype"], &"captain")


func test_squad_entries_reflect_alive_state() -> void:
	GameState.player_archetype = &"captain"
	var snap: GameState.CharacterSnapshot = GameState.squad[&"technician"]
	snap.alive = false
	snap.health = 0.0
	var entries := StrategyViewModel.squad_entries(&"captain")
	var found := false
	for entry: Dictionary in entries:
		if entry["archetype"] == &"technician":
			found = true
			assert_false(bool(entry["alive"]))
			assert_eq(int(entry["revive_cost"]), SquadReassignment.REVIVE_XP_COST)
	assert_true(found, "el técnico debe aparecer en la lista de escuadra")
