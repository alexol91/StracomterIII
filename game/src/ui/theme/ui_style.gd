class_name UiStyle
extends RefCounted
## Construye y sirve los DOS temas de la interfaz (`Theme` de Godot) y aplica
## el que toque a cada pantalla según `PresentationStyle.chutaos_mode`.
##
## Por qué un `Theme` construido por código y no un `.tres` a mano: este
## flujo de trabajo no tiene editor disponible (headless multi-agente, igual
## que documenta `Localization`), así que un `.tres` de tema —cientos de
## líneas de `SubResource` con IDs que nadie puede previsualizar— es un sitio
## perfecto para un error silencioso. Un `Theme` construido aquí es texto
## GDScript normal, se revisa en el PR como cualquier otro código y se puede
## comprobar en `--headless` (que exista la variación, que el color sea el
## que toca) en vez de fiarse de que el XML del recurso esté bien escrito.
##
## Ningún color "de amenaza" (`Palette.THREAT_ORANGE/RED`) aparece aquí en
## un botón o panel decorativo: la dirección de arte del encargo reserva ese
## color a avisos de daño/peligro. Se usa solo en `ThreatLabel` y en los
## acentos de amenaza que arma `strategy_screen.gd` zona por zona.

const TITLE_FONT_PATH: String = "res://assets/fonts/BebasNeue.ttf"

const FONT_SIZE_BODY: int = 16
const FONT_SIZE_BUTTON: int = 18
const FONT_SIZE_SECTION: int = 24
const FONT_SIZE_SUBTITLE: int = 18
const FONT_SIZE_TITLE: int = 64
const FONT_SIZE_TITLE_CHUTAOS: int = 46
const FONT_SIZE_CREDIT_NAME: int = 30

static var _elite_theme: Theme = null
static var _chutaos_theme: Theme = null
static var _title_font: Font = null


static func is_chutaos() -> bool:
	return PresentationStyle.chutaos_mode


static func theme_for(chutaos: bool) -> Theme:
	return chutaos_theme() if chutaos else elite_theme()


## Aplica a `control` el tema que corresponda AHORA MISMO y refresca su fondo
## de menú si lleva uno (`MenuBackdrop`, nodo hijo llamado exactamente así).
## Es una FOTO, no una suscripción: no conecta ninguna señal, así que no hay
## `Callable` que vaciar de ningún registro si `control` se libera (regla del
## proyecto: "quien llena un registro lo vacía" — la forma más segura de
## cumplirla es no rellenarlo). Quien SÍ necesita reaccionar en caliente a
## `PresentationStyle.style_changed` (`UiRoot`, que vive toda la partida) es
## el único punto que se conecta a esa señal, y vuelve a llamar aquí.
static func apply_snapshot(control: Control) -> void:
	if control == null:
		return
	var chutaos := is_chutaos()
	control.theme = theme_for(chutaos)
	var backdrop := control.get_node_or_null(^"MenuBackdrop") as MenuBackdrop
	if backdrop != null:
		backdrop.refresh()


static func elite_theme() -> Theme:
	if _elite_theme == null:
		_elite_theme = _build_elite_theme()
	return _elite_theme


static func chutaos_theme() -> Theme:
	if _chutaos_theme == null:
		_chutaos_theme = _build_chutaos_theme()
	return _chutaos_theme


static func _title_font_resource() -> Font:
	if _title_font == null:
		_title_font = load(TITLE_FONT_PATH) as Font
	return _title_font


## --- Tema del remake: azul Elite, panel oscuro, esquinas suaves -----------

static func _build_elite_theme() -> Theme:
	var theme := Theme.new()
	theme.default_font_size = FONT_SIZE_BODY

	theme.set_color("font_color", "Label", Palette.TEXT_PRIMARY)
	theme.set_font_size("font_size", "Label", FONT_SIZE_BODY)

	_add_label_variation(theme, &"TitleLabel", _title_font_resource(), FONT_SIZE_TITLE, Palette.TEXT_PRIMARY)
	_add_label_variation(theme, &"SectionLabel", _title_font_resource(), FONT_SIZE_SECTION, Palette.ELITE_BLUE_BRIGHT)
	_add_label_variation(theme, &"SubtitleLabel", null, FONT_SIZE_SUBTITLE, Palette.TEXT_SECONDARY)
	_add_label_variation(theme, &"ThreatLabel", null, FONT_SIZE_BODY, Palette.THREAT_ORANGE)
	_add_label_variation(theme, &"CreditNameLabel", _title_font_resource(), FONT_SIZE_CREDIT_NAME, Palette.TEXT_PRIMARY)

	_style_buttons(theme)
	_style_panel(theme, Palette.PANEL_BACKGROUND, Palette.PANEL_BORDER, 10)
	_style_panel_variation(theme, &"HudPanel", &"PanelContainer", Color(Palette.NEUTRAL_950, 0.55), Palette.PANEL_BORDER, 8, 10.0)
	_style_progress_bar(theme, Palette.NEUTRAL_800, Palette.ELITE_BLUE)
	_style_slider(theme, Palette.NEUTRAL_800, Palette.ELITE_BLUE)
	_style_option_button(theme)
	_style_check_box(theme)
	_style_line_edit(theme)
	return theme


## --- Tema Chutaos: el juego de 2012, deliberadamente cutre -----------------
## `PresentationStyle.chutaos_mode == true` → "modelos de 2012, voces de
## broma, texturas planas". Aquí la mitad de interfaz de ese mismo eje:
## colores planos sin gradiente, tipografía de sistema (nunca BebasNeue: la
## fuente del original, `tf2Build`, es un activo de Team Fortress 2 y el GDD
## ya marcó ese riesgo legal en §11 — aquí ni se referencia), botones
## rectangulares sin redondeo ni transición. El contraste con el remake es
## la gracia (encargo, sección "Un detalle importante de integración").
static func _build_chutaos_theme() -> Theme:
	var theme := Theme.new()
	var flat_bg := Color(0.78, 0.78, 0.78)
	var flat_border := Color(0.05, 0.05, 0.05)
	var flat_text := Color(0.05, 0.05, 0.05)

	theme.default_font_size = FONT_SIZE_BODY

	theme.set_color("font_color", "Label", Color(0.92, 0.92, 0.92))
	theme.set_font_size("font_size", "Label", FONT_SIZE_BODY)

	_add_label_variation(theme, &"TitleLabel", null, FONT_SIZE_TITLE_CHUTAOS, Color(1.0, 1.0, 1.0))
	_add_label_variation(theme, &"SectionLabel", null, FONT_SIZE_SECTION, Color(1.0, 1.0, 1.0))
	_add_label_variation(theme, &"SubtitleLabel", null, FONT_SIZE_SUBTITLE, Color(0.85, 0.85, 0.85))
	_add_label_variation(theme, &"ThreatLabel", null, FONT_SIZE_BODY, Color(0.85, 0.15, 0.1))
	_add_label_variation(theme, &"CreditNameLabel", null, FONT_SIZE_CREDIT_NAME, Color(1.0, 1.0, 1.0))

	var normal := _flat_box(flat_bg, flat_border, 0)
	var hover := _flat_box(flat_bg.lightened(0.15), flat_border, 0)
	var pressed := _flat_box(flat_bg.darkened(0.2), flat_border, 0)
	var focus := _flat_box(flat_bg, Color(0.0, 0.0, 0.6), 0)
	focus.set_border_width_all(3)
	var disabled := _flat_box(flat_bg.darkened(0.35), flat_border, 0)

	theme.set_stylebox("normal", "Button", normal)
	theme.set_stylebox("hover", "Button", hover)
	theme.set_stylebox("pressed", "Button", pressed)
	theme.set_stylebox("focus", "Button", focus)
	theme.set_stylebox("disabled", "Button", disabled)
	theme.set_color("font_color", "Button", flat_text)
	theme.set_color("font_hover_color", "Button", flat_text)
	theme.set_color("font_pressed_color", "Button", flat_text)
	theme.set_color("font_disabled_color", "Button", Color(0.4, 0.4, 0.4))
	theme.set_font_size("font_size", "Button", FONT_SIZE_BUTTON)

	_style_panel(theme, Color(0.65, 0.65, 0.65), flat_border, 0)
	_style_progress_bar(theme, Color(0.4, 0.4, 0.4), Color(0.1, 0.5, 0.1))
	_style_slider(theme, Color(0.4, 0.4, 0.4), Color(0.1, 0.5, 0.1))
	return theme


## --- Ayudantes de construcción --------------------------------------------

static func _add_label_variation(
	theme: Theme, variation: StringName, font: Font, size: int, color: Color
) -> void:
	theme.set_type_variation(variation, &"Label")
	if font != null:
		theme.set_font("font", variation, font)
	theme.set_font_size("font_size", variation, size)
	theme.set_color("font_color", variation, color)


static func _style_buttons(theme: Theme) -> void:
	var normal := _rounded_box(Palette.NEUTRAL_800, Palette.NEUTRAL_700, 1)
	var hover := _rounded_box(Palette.NEUTRAL_700, Palette.ELITE_BLUE, 1)
	var pressed := _rounded_box(Palette.ELITE_BLUE_DIM, Palette.ELITE_BLUE, 1)
	var focus := _rounded_box(Palette.NEUTRAL_800, Palette.ELITE_BLUE, 2)
	var disabled := _rounded_box(Palette.NEUTRAL_900, Palette.NEUTRAL_800, 1)

	theme.set_stylebox("normal", "Button", normal)
	theme.set_stylebox("hover", "Button", hover)
	theme.set_stylebox("pressed", "Button", pressed)
	theme.set_stylebox("focus", "Button", focus)
	theme.set_stylebox("disabled", "Button", disabled)
	theme.set_color("font_color", "Button", Palette.TEXT_PRIMARY)
	theme.set_color("font_hover_color", "Button", Palette.ELITE_BLUE_BRIGHT)
	theme.set_color("font_pressed_color", "Button", Palette.ELITE_BLUE_BRIGHT)
	theme.set_color("font_disabled_color", "Button", Palette.TEXT_DISABLED)
	theme.set_font_size("font_size", "Button", FONT_SIZE_BUTTON)
	theme.set_constant("h_separation", "Button", 10)


static func _style_panel(theme: Theme, bg: Color, border: Color, radius: int) -> void:
	var box := _rounded_box(bg, border, radius)
	box.set_border_width_all(1)
	box.set_content_margin_all(20.0)
	# `Panel` y `PanelContainer` son clases hermanas (ninguna hereda de la
	# otra) que dibujan cada una su propio stylebox "panel": se define en
	# ambos tipos para que valga tanto si el `.tscn` usa uno como el otro.
	theme.set_stylebox("panel", "Panel", box)
	theme.set_stylebox("panel", "PanelContainer", box)


## Variación de `Panel` con relleno propio: los "chips" del HUD necesitan
## mucho menos aire que un panel de menú a pantalla completa.
static func _style_panel_variation(
	theme: Theme, variation: StringName, base_type: StringName,
	bg: Color, border: Color, radius: int, padding: float
) -> void:
	theme.set_type_variation(variation, base_type)
	var box := _rounded_box(bg, border, radius)
	box.set_border_width_all(1)
	box.set_content_margin_all(padding)
	theme.set_stylebox("panel", variation, box)


static func _style_progress_bar(theme: Theme, background: Color, fill: Color) -> void:
	var bg_box := _rounded_box(background, background, 4)
	var fill_box := _rounded_box(fill, fill, 4)
	theme.set_stylebox("background", "ProgressBar", bg_box)
	theme.set_stylebox("fill", "ProgressBar", fill_box)


static func _style_slider(theme: Theme, groove: Color, fill: Color) -> void:
	var groove_box := _rounded_box(groove, groove, 3)
	var fill_box := _rounded_box(fill, fill, 3)
	theme.set_stylebox("slider", "HSlider", groove_box)
	theme.set_stylebox("grabber_area", "HSlider", fill_box)
	theme.set_stylebox("grabber_area_highlight", "HSlider", fill_box)


static func _style_option_button(theme: Theme) -> void:
	var normal := _rounded_box(Palette.NEUTRAL_800, Palette.NEUTRAL_700, 1)
	var hover := _rounded_box(Palette.NEUTRAL_700, Palette.ELITE_BLUE, 1)
	theme.set_stylebox("normal", "OptionButton", normal)
	theme.set_stylebox("hover", "OptionButton", hover)
	theme.set_stylebox("pressed", "OptionButton", normal)
	theme.set_stylebox("focus", "OptionButton", _rounded_box(Palette.NEUTRAL_800, Palette.ELITE_BLUE, 2))
	theme.set_color("font_color", "OptionButton", Palette.TEXT_PRIMARY)
	theme.set_font_size("font_size", "OptionButton", FONT_SIZE_BUTTON)


static func _style_check_box(theme: Theme) -> void:
	theme.set_color("font_color", "CheckBox", Palette.TEXT_PRIMARY)
	theme.set_font_size("font_size", "CheckBox", FONT_SIZE_BODY)


static func _style_line_edit(theme: Theme) -> void:
	var normal := _rounded_box(Palette.NEUTRAL_800, Palette.NEUTRAL_700, 4)
	var focus := _rounded_box(Palette.NEUTRAL_800, Palette.ELITE_BLUE, 4)
	theme.set_stylebox("normal", "LineEdit", normal)
	theme.set_stylebox("focus", "LineEdit", focus)
	theme.set_color("font_color", "LineEdit", Palette.TEXT_PRIMARY)
	theme.set_color("font_placeholder_color", "LineEdit", Palette.TEXT_DISABLED)


static func _rounded_box(bg: Color, border: Color, radius: int) -> StyleBoxFlat:
	var box := StyleBoxFlat.new()
	box.bg_color = bg
	box.border_color = border
	box.set_border_width_all(1)
	box.set_corner_radius_all(radius)
	box.set_content_margin_all(10.0)
	box.anti_aliasing = true
	return box


static func _flat_box(bg: Color, border: Color, radius: int) -> StyleBoxFlat:
	var box := _rounded_box(bg, border, radius)
	box.set_border_width_all(2)
	box.anti_aliasing = false
	return box


## Botón "primario" (la acción principal de una pantalla: confirmar zona,
## confirmar clase...): relleno en azul Elite en vez del contorno neutro de
## `_style_buttons`, para que destaque como LA acción de la pantalla y no
## compita visualmente con "Atrás"/"Cancelar".
static func style_primary_button(button: Button) -> void:
	var normal := _rounded_box(Palette.ELITE_BLUE, Palette.ELITE_BLUE_BRIGHT, 6)
	var hover := _rounded_box(Palette.ELITE_BLUE_BRIGHT, Palette.ELITE_BLUE_BRIGHT, 6)
	var pressed := _rounded_box(Palette.ELITE_BLUE_DIM, Palette.ELITE_BLUE_BRIGHT, 6)
	var focus := _rounded_box(Palette.ELITE_BLUE, Palette.TEXT_PRIMARY, 6)
	focus.set_border_width_all(2)
	var disabled := _rounded_box(Palette.NEUTRAL_800, Palette.NEUTRAL_700, 6)
	button.add_theme_stylebox_override("normal", normal)
	button.add_theme_stylebox_override("hover", hover)
	button.add_theme_stylebox_override("pressed", pressed)
	button.add_theme_stylebox_override("focus", focus)
	button.add_theme_stylebox_override("disabled", disabled)
	button.add_theme_color_override("font_color", Palette.NEUTRAL_950)
	button.add_theme_color_override("font_hover_color", Palette.NEUTRAL_950)
	button.add_theme_color_override("font_pressed_color", Palette.NEUTRAL_950)
	button.add_theme_color_override("font_disabled_color", Palette.TEXT_DISABLED)


## Estilo de una tarjeta de zona en la pantalla de Estrategia: acento de color
## por lectura de amenaza (ver `zone_threat_reading.gd`), remarcado si está
## seleccionada. Vive aquí y no en `strategy_screen.gd` para que el mismo
## criterio de "qué acento usa una amenaza" sea reutilizable y comprobable
## sin instanciar ningún nodo.
static func zone_card_stylebox(accent: Color, selected: bool) -> StyleBoxFlat:
	var box := _rounded_box(Palette.NEUTRAL_800, accent, 8)
	box.set_border_width_all(2 if selected else 1)
	if selected:
		box.bg_color = Palette.NEUTRAL_700
		box.set_content_margin_all(14.0)
	else:
		box.set_content_margin_all(14.0)
	return box
