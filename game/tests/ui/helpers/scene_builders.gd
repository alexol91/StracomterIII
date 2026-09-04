class_name UiTestSceneBuilders
extends RefCounted
## Constructores de escenario para las pruebas de `ui-ux`, en un fichero
## aparte a propósito: un método cuyo TIPO DE RETORNO es una clase de
## GDScript (p. ej. `-> StrategyScreen`) impide que Godot 4.7.2 descargue ese
## script y aparece como fuga de nodos/scripts al salir del proceso headless.
## Por eso estas funciones devuelven `Node` (el tipo del motor), nunca el
## `class_name` de la pantalla — quien llama hace el `as` si lo necesita.

const STRATEGY_SCENE: String = "res://scenes/ui/strategy_screen.tscn"
const HUD_SCENE: String = "res://scenes/ui/hud.tscn"
const CONSOLE_SCENE: String = "res://scenes/ui/console_panel.tscn"
const OPTIONS_SCENE: String = "res://scenes/ui/options_screen.tscn"
const CLASS_SELECT_SCENE: String = "res://scenes/ui/class_select_screen.tscn"
const TITLE_SCENE: String = "res://scenes/ui/title_screen.tscn"


## Instancia una escena y la añade a la raíz del árbol activo, para que su
## `_ready()` corra de verdad (necesario para los `@onready var ... = %Nodo`).
## Llamar siempre a `free_node()` al terminar la prueba.
static func instantiate_in_tree(scene_path: String) -> Node:
	var scene := load(scene_path) as PackedScene
	if scene == null:
		return null
	var node := scene.instantiate()
	var tree := Engine.get_main_loop() as SceneTree
	if tree != null:
		tree.root.add_child(node)
	return node


## Retira y libera un nodo de prueba de forma inmediata y segura (sin
## `queue_free`, que en un runner de un solo frame puede no llegar a
## ejecutarse antes de que el proceso termine).
static func free_node(node: Node) -> void:
	if node == null or not is_instance_valid(node):
		return
	if node.get_parent() != null:
		node.get_parent().remove_child(node)
	node.free()
