extends TestCase
## `UiStyle` (encargo "listón visual"): los dos temas existen, son distintos,
## y `apply_snapshot` deja el tema que toca según `PresentationStyle` — la
## parte de "que el estilo cambie lo que debe" que sí es lógica comprobable
## en headless sin GPU.

var _node: Control = null
var _chutaos_snapshot: bool = false


func before_each() -> void:
	_chutaos_snapshot = PresentationStyle.chutaos_mode


func after_each() -> void:
	if _node != null and is_instance_valid(_node):
		if _node.get_parent() != null:
			_node.get_parent().remove_child(_node)
		_node.free()
	_node = null
	PresentationStyle.chutaos_mode = _chutaos_snapshot


func test_elite_and_chutaos_themes_are_distinct_resources() -> void:
	assert_ne(UiStyle.elite_theme(), UiStyle.chutaos_theme())


func test_theme_builders_are_cached_singletons() -> void:
	assert_eq(UiStyle.elite_theme(), UiStyle.elite_theme())
	assert_eq(UiStyle.chutaos_theme(), UiStyle.chutaos_theme())


func test_title_label_variation_uses_a_much_larger_font_size_than_body() -> void:
	var theme := UiStyle.elite_theme()
	var title_size := theme.get_font_size("font_size", "TitleLabel")
	var body_size := theme.get_font_size("font_size", "Label")
	assert_gt(float(title_size), float(body_size) * 2.0)


func test_threat_label_uses_the_threat_color_not_a_decorative_one() -> void:
	var theme := UiStyle.elite_theme()
	var color := theme.get_color("font_color", "ThreatLabel")
	assert_almost_eq(color.r, Palette.THREAT_ORANGE.r, 0.01)
	assert_almost_eq(color.g, Palette.THREAT_ORANGE.g, 0.01)
	assert_almost_eq(color.b, Palette.THREAT_ORANGE.b, 0.01)


func test_apply_snapshot_picks_elite_theme_when_chutaos_is_off() -> void:
	PresentationStyle.chutaos_mode = false
	_node = Control.new()
	UiStyle.apply_snapshot(_node)
	assert_eq(_node.theme, UiStyle.elite_theme())


func test_apply_snapshot_picks_chutaos_theme_when_chutaos_is_on() -> void:
	PresentationStyle.chutaos_mode = true
	_node = Control.new()
	UiStyle.apply_snapshot(_node)
	assert_eq(_node.theme, UiStyle.chutaos_theme())
