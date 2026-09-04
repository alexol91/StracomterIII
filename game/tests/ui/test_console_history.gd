extends TestCase
## Historial navegable de la consola (flechas arriba/abajo).

func test_previous_returns_most_recent_first() -> void:
	var history := ConsoleHistory.new()
	history.push("god")
	history.push("noclip")
	assert_eq(history.previous(), "noclip")
	assert_eq(history.previous(), "god")
	# Ya está en el principio: se queda ahí, no da vueltas.
	assert_eq(history.previous(), "god")


func test_next_walks_forward_back_to_blank_draft() -> void:
	var history := ConsoleHistory.new()
	history.push("god")
	history.push("noclip")
	history.previous() # noclip
	history.previous() # god
	assert_eq(history.next(), "noclip")
	assert_eq(history.next(), "") # vuelta al borrador en blanco


func test_next_without_navigating_first_is_blank() -> void:
	var history := ConsoleHistory.new()
	history.push("help")
	assert_eq(history.next(), "")


func test_push_deduplicates_consecutive_repeats() -> void:
	var history := ConsoleHistory.new()
	history.push("help")
	history.push("help")
	history.push("help")
	assert_size(history.entries(), 1)


func test_push_does_not_dedupe_non_consecutive_repeats() -> void:
	var history := ConsoleHistory.new()
	history.push("help")
	history.push("god")
	history.push("help")
	assert_size(history.entries(), 3)


func test_push_resets_cursor_to_draft() -> void:
	var history := ConsoleHistory.new()
	history.push("a")
	history.push("b")
	history.previous()
	history.previous()
	history.push("c")
	assert_eq(history.previous(), "c")


func test_push_ignores_empty_lines() -> void:
	var history := ConsoleHistory.new()
	history.push("")
	assert_size(history.entries(), 0)
