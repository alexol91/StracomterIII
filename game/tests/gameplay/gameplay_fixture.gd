class_name GameplayFixture
extends TestCase
## Base compartida para pruebas de `gameplay/` que necesitan nodos reales de
## escena (`Character`, `WeaponSystem`...) para poder tocar `Balance` y
## `EventBus`, que son autoloads reales del proyecto en ejecución —
## `run_tests.tscn` los carga tal y como indica su propia cabecera.
##
## NO empieza por `test_`, así que `run_tests.gd` no la descubre como fichero
## de prueba (mira `_discover`); solo la heredan los ficheros `test_*.gd` de
## este directorio.

var _spawned: Array[Node] = []


func after_each() -> void:
	for n: Node in _spawned:
		if is_instance_valid(n):
			n.queue_free()
	_spawned.clear()


## Añade `node` al árbol de escena real (necesario para `get_world_3d()`,
## grupos, y para que `_ready()`/`_physics_process()` tengan sentido) y lo
## registra para liberarlo automáticamente en `after_each()`.
##
## Se cuelga de `tree.current_scene` (el propio `TestRunner` de
## `run_tests.gd`), NO de `tree.root`: `run_tests.gd` ejecuta TODAS las
## pruebas dentro de un único `_ready()` síncrono, así que `tree.root` sigue
## "ocupado montando hijos" durante toda la tanda y rechaza `add_child`
## directo — `current_scene` no tiene ese problema porque su propio montaje
## ya ha terminado en cuanto su `_ready()` (el de `TestRunner`) empieza a
## ejecutarse. Sigue colgando del mismo `Viewport`/`World3D`, así que la
## física y los raycasts funcionan igual.
func spawn(node: Node) -> Node:
	var tree := Engine.get_main_loop() as SceneTree
	var parent: Node = tree.current_scene if tree.current_scene != null else tree.root
	parent.add_child(node)
	_spawned.append(node)
	return node


## Crea y añade al árbol un `Character` desnudo (sin malla ni formas de
## colisión — para eso están los tests de escena) con las estadísticas reales
## de `archetype` ya resueltas desde `Balance`.
func make_character(archetype: StringName, team: Character.Team) -> Character:
	var c := Character.new()
	c.archetype = archetype
	c.team = team
	spawn(c)
	return c


## Instancia `character.tscn` (malla + 3 formas de colisión nombradas) para
## las pruebas que sí necesitan raycasts reales.
func make_full_character(archetype: StringName, team: Character.Team, position: Vector3) -> Character:
	var scene: PackedScene = load("res://scenes/gameplay/character.tscn")
	var c := scene.instantiate() as Character
	c.archetype = archetype
	c.team = team
	spawn(c)
	c.global_position = position
	return c


## Añade un `WeaponSystem` como hijo de `character` y lo deja listo para
## disparar (el arma por defecto se resuelve en su `_ready`, que aquí ya
## puede leer `character.stats` porque `character` ya está en el árbol).
func attach_weapon_system(character: Character) -> WeaponSystem:
	var ws := WeaponSystem.new()
	character.add_child(ws)
	return ws
