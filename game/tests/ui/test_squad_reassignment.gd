extends TestCase
## Lógica de reasignación de escuadra y gasto de XP (GDD §6). Sin nodos: se
## alimenta con instantáneas `GameState.CharacterSnapshot` construidas a
## mano, así que no depende del estado compartido del autoload.

func _snapshot(alive: bool) -> GameState.CharacterSnapshot:
	var snap := GameState.CharacterSnapshot.new()
	snap.alive = alive
	snap.health = 100.0 if alive else 0.0
	return snap


func test_companion_archetypes_excludes_player() -> void:
	var companions := SquadReassignment.companion_archetypes(&"specialist")
	assert_size(companions, 3)
	assert_false(companions.has(&"specialist"))
	assert_true(companions.has(&"captain"))
	assert_true(companions.has(&"technician"))
	assert_true(companions.has(&"demolition"))


func test_default_included_marks_alive_true_dead_false() -> void:
	var snapshots := {
		&"captain": _snapshot(true),
		&"technician": _snapshot(false),
		&"specialist": _snapshot(true),
	}
	var included := SquadReassignment.default_included(snapshots, &"demolition")
	assert_true(bool(included[&"captain"]))
	assert_false(bool(included[&"technician"]))
	assert_true(bool(included[&"specialist"]))


func test_total_xp_cost_only_charges_revived_dead_companions() -> void:
	var snapshots := {
		&"captain": _snapshot(true),
		&"technician": _snapshot(false),
		&"specialist": _snapshot(false),
	}
	# Vivo incluido (gratis) + un caído incluido (revivir) + un caído NO incluido.
	var included := {&"captain": true, &"technician": true, &"specialist": false}
	assert_eq(SquadReassignment.total_xp_cost(snapshots, included), SquadReassignment.REVIVE_XP_COST)


func test_total_xp_cost_zero_when_nothing_to_revive() -> void:
	var snapshots := {&"captain": _snapshot(true)}
	var included := {&"captain": true}
	assert_eq(SquadReassignment.total_xp_cost(snapshots, included), 0)


func test_can_confirm_respects_available_experience() -> void:
	var snapshots := {&"technician": _snapshot(false)}
	var included := {&"technician": true}
	var cost := SquadReassignment.REVIVE_XP_COST
	assert_true(SquadReassignment.can_confirm(cost, snapshots, included))
	assert_true(SquadReassignment.can_confirm(cost + 1, snapshots, included))
	assert_false(SquadReassignment.can_confirm(cost - 1, snapshots, included))
