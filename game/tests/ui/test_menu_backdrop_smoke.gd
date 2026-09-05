extends TestCase
## Instancia real de `MenuBackdrop`: arranca sin reventar y `refresh()` deja
## visible la capa que toca según `PresentationStyle.chutaos_mode`.

const BACKDROP_SCENE: String = "res://scenes/ui/components/menu_backdrop.tscn"

var _node: Node = null
var _chutaos_snapshot: bool = false


func before_each() -> void:
	_chutaos_snapshot = PresentationStyle.chutaos_mode


func after_each() -> void:
	UiTestSceneBuilders.free_node(_node)
	_node = null
	PresentationStyle.chutaos_mode = _chutaos_snapshot


func test_backdrop_shows_shader_layer_by_default() -> void:
	PresentationStyle.chutaos_mode = false
	_node = UiTestSceneBuilders.instantiate_in_tree(BACKDROP_SCENE)
	assert_not_null(_node)
	var backdrop := _node as MenuBackdrop
	assert_not_null(backdrop)
	var shader_layer := backdrop.get_node("%ShaderBackground") as ColorRect
	var chutaos_layer := backdrop.get_node("%ChutaosBackground") as TextureRect
	assert_true(shader_layer.visible)
	assert_false(chutaos_layer.visible)


func test_backdrop_shows_chutaos_layer_when_style_is_chutaos() -> void:
	PresentationStyle.chutaos_mode = true
	_node = UiTestSceneBuilders.instantiate_in_tree(BACKDROP_SCENE)
	var backdrop := _node as MenuBackdrop
	backdrop.refresh()
	var shader_layer := backdrop.get_node("%ShaderBackground") as ColorRect
	var chutaos_layer := backdrop.get_node("%ChutaosBackground") as TextureRect
	assert_false(shader_layer.visible)
	assert_true(chutaos_layer.visible)


## El boceto real del equipo de 2012 (encargo: "en modo chutaos el menú debe
## mostrar `fondo_torre.jpg` tal cual"). Se comprueba la textura cargada, no
## solo la constante de ruta, para detectar tanto un cambio de ruta como un
## fichero que dejara de existir/importarse.
func test_chutaos_layer_uses_the_original_2012_render() -> void:
	_node = UiTestSceneBuilders.instantiate_in_tree(BACKDROP_SCENE)
	var backdrop := _node as MenuBackdrop
	var chutaos_layer := backdrop.get_node("%ChutaosBackground") as TextureRect
	assert_not_null(chutaos_layer.texture, "falta la textura de fondo_torre.jpg")
	assert_eq(chutaos_layer.texture.resource_path, "res://assets/textures/chutaos/fondo_torre.jpg")
