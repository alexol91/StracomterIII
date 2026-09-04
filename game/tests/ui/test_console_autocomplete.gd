extends TestCase
## Autocompletado por Tab (GDD §10: la consola "no es un extra... trátala
## como producto"). Semántica de shell POSIX: prefijo único → completa;
## varios → prefijo común más largo; ninguno → no cambia nada.

func _candidates() -> Array[String]:
	return ["god", "give", "goto", "help", "floor"]


func test_unique_match_completes_fully() -> void:
	assert_eq(ConsoleAutocomplete.complete("he", _candidates()), "help")


func test_multiple_matches_complete_to_common_prefix() -> void:
	# "g" hace match con god/give/goto → prefijo común "g".
	assert_eq(ConsoleAutocomplete.complete("g", _candidates()), "g")
	# "go" hace match con goto/god → prefijo común "go".
	assert_eq(ConsoleAutocomplete.complete("go", _candidates()), "go")


func test_no_match_returns_partial_unchanged() -> void:
	assert_eq(ConsoleAutocomplete.complete("xyz", _candidates()), "xyz")


func test_empty_partial_has_no_common_prefix_beyond_empty() -> void:
	# Con la lista de arriba, todas las candidatas comparten el prefijo vacío.
	assert_eq(ConsoleAutocomplete.complete("", _candidates()), "")


func test_exact_match_that_is_also_a_prefix_of_another_completes_itself() -> void:
	# "god" es exacto y además prefijo de nada más en la lista.
	assert_eq(ConsoleAutocomplete.complete("god", _candidates()), "god")


func test_matching_lists_all_candidates_sorted() -> void:
	var matches := ConsoleAutocomplete.matching("g", _candidates())
	assert_eq(matches, ["give", "god", "goto"])
