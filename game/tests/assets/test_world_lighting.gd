extends TestCase
## La iluminación del mundo. Existe porque su ausencia no daba error.

func _lit_map() -> Node3D:
	var map := (load("res://maps/legacy/mapP1.tscn") as PackedScene).instantiate() as Node3D
	(Engine.get_main_loop() as SceneTree).root.add_child(map)
	return map


func _drop(map: Node3D) -> void:
	(Engine.get_main_loop() as SceneTree).root.remove_child(map)
	map.queue_free()


func test_a_map_brings_its_own_light_and_environment() -> void:
	# El juego no tenía NI UNA LUZ ni un WorldEnvironment: ni en main.tscn, ni
	# en las 27 escenas de mapa. Con Forward+ eso no da error, da un mundo
	# negro, y toda la biblioteca de materiales es invisible sin algo que la
	# ilumine. Esta prueba es la que impide que vuelva a pasar en silencio.
	var map := _lit_map()
	var lighting := map.get_node_or_null("Lighting")
	assert_not_null(lighting, "el mapa debe traer su nodo de iluminación")
	if lighting != null:
		assert_not_null(lighting.get_node_or_null("Environment"),
			"sin WorldEnvironment no hay ambiente ni reflejos")
		assert_not_null(lighting.get_node_or_null("Sun"),
			"sin luz direccional no hay ni sombra ni dirección")
	_drop(map)


func test_the_interior_gets_enough_ambient_to_be_seen() -> void:
	# Una planta de oficina está rodeada de un muro de tres metros: el sol se
	# queda fuera. Si el ambiente baja, el interior se va a negro y no hay
	# material que lo salve; con 0,55 pasó exactamente eso.
	var map := _lit_map()
	var env := (map.get_node("Lighting/Environment") as WorldEnvironment).environment
	assert_gt(env.ambient_light_energy, 0.6,
		"con menos ambiente el interior de la planta se ve negro")
	assert_lt(env.ambient_light_energy, 1.2,
		"con más, el suelo se sobreexpone y el mundo deja de callarse")
	_drop(map)


func test_the_ambient_does_not_depend_only_on_the_sky() -> void:
	# El aporte del cielo es imagen y se comporta distinto en Forward+ que en
	# Compatibilidad: una planta que se ve bien en uno puede salir negra en el
	# otro. Parte del relleno tiene que venir de un color explícito.
	var map := _lit_map()
	var env := (map.get_node("Lighting/Environment") as WorldEnvironment).environment
	assert_lt(env.ambient_light_sky_contribution, 0.7,
		"el relleno del interior no puede depender solo del cielo")
	_drop(map)


func test_metals_have_something_to_reflect() -> void:
	# La perfilería del perímetro es metálica, y un metal sin fuente de
	# reflejos se pinta negro. Ya salió negro una vez.
	var map := _lit_map()
	var env := (map.get_node("Lighting/Environment") as WorldEnvironment).environment
	assert_ne(env.reflected_light_source, Environment.REFLECTION_SOURCE_DISABLED,
		"en el remake los metales necesitan reflejar algo")
	_drop(map)


func test_the_two_styles_light_the_world_differently() -> void:
	# No es la misma iluminación con otros colores: el cel-shading de 2012
	# necesita superficies planas para que sus cuatro bandas se distingan, y
	# una sombra proyectada las emborrona.
	var original := PresentationStyle.chutaos_mode
	PresentationStyle.chutaos_mode = false
	var map := _lit_map()
	var env := (map.get_node("Lighting/Environment") as WorldEnvironment).environment
	var sun := map.get_node("Lighting/Sun") as DirectionalLight3D
	assert_true(sun.shadow_enabled, "el remake proyecta sombras")
	assert_true(env.ssao_enabled, "y tiene oclusión de contacto")

	PresentationStyle.chutaos_mode = true
	assert_false(sun.shadow_enabled, "el estilo de 2012 no tenía sombras")
	assert_false(env.ssao_enabled, "ni oclusión de contacto")

	_drop(map)
	PresentationStyle.chutaos_mode = original


# --- Luminarias de techo ---------------------------------------------------
#
# Por qué existen estas pruebas: la primera versión del reparto truncaba el
# número de columnas con `floor()`, y un mapa de 14 × 9 m con 5 m de
# separación se quedaba en DOS luminarias repartidas cada siete metros. El
# resultado era indistinguible de no tener ninguna, no daba ningún error, y
# solo se vio comparando dos capturas cenitales. Un contador es más barato
# que una captura.

const FLOOR_SCRIPT := "res://maps/legacy/_legacy_floor_mesh.gd"


## Monta una planta sintética: un `Floor` con el script real del conversor
## —para que las propiedades exportadas se lean igual que en un mapa— y un
## `WorldLighting` colgando del mismo padre. Devuelve la raíz; la iluminación
## es su hijo `Lighting`.
##
## Qué NO reproduce este doble, por la regla de los dobles de prueba: no trae
## muros, ni puertas, ni mobiliario, ni navegación, ni metadata del conversor.
## Sirve para contar y situar luminarias, no para juzgar cómo se ve la planta;
## eso se mira en una captura.
func _synthetic_plant(vertices: PackedVector3Array, indices: PackedInt32Array) -> Node3D:
	var root := Node3D.new()
	if not vertices.is_empty():
		var floor_node := StaticBody3D.new()
		floor_node.name = "Floor"
		floor_node.set_script(load(FLOOR_SCRIPT))
		floor_node.set(&"floor_vertices", vertices)
		floor_node.set(&"floor_indices", indices)
		floor_node.set(&"floor_uvs", PackedVector2Array())
		root.add_child(floor_node)
	var lighting := WorldLighting.new()
	lighting.name = "Lighting"
	root.add_child(lighting)
	# El nodo entra en el árbol porque las luces se montan en `_ready()`;
	# `add_child` sobre un nodo que ya está en el árbol lo ejecuta de forma
	# síncrona, así que el runner puede leer el resultado en la misma llamada.
	(Engine.get_main_loop() as SceneTree).root.add_child(root)
	return root


## Rectángulo de 12 × 8 m centrado en el origen. No pueden ser `const`:
## GDScript no acepta un `PackedVector3Array` como expresión constante, y
## `static var` está descartado por norma del proyecto.
func _square() -> Array:
	return [
		PackedVector3Array([
			Vector3(-6.0, 0.0, -4.0), Vector3(6.0, 0.0, -4.0),
			Vector3(6.0, 0.0, 4.0), Vector3(-6.0, 0.0, 4.0)]),
		PackedInt32Array([0, 1, 2, 0, 2, 3])]


## La misma caja envolvente con el cuadrante (+x, +z) quitado: 72 m² de suelo
## en 96 m² de caja. Es la planta en L que el reparto tiene que distinguir.
func _ell() -> Array:
	return [
		PackedVector3Array([
			Vector3(-6.0, 0.0, -4.0), Vector3(6.0, 0.0, -4.0), Vector3(6.0, 0.0, 0.0),
			Vector3(0.0, 0.0, 0.0), Vector3(0.0, 0.0, 4.0), Vector3(-6.0, 0.0, 4.0)]),
		PackedInt32Array([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5])]


func _count(plant: Node3D) -> int:
	var lighting := plant.get_node_or_null(^"Lighting") as WorldLighting
	return lighting.ceiling_light_count() if lighting != null else -1


func test_a_rectangular_floor_gets_a_grid_of_lights() -> void:
	var square := _square()
	var plant := _synthetic_plant(square[0], square[1])
	# 12 × 8 m con 4,5 m de separación: 3 columnas × 2 filas.
	assert_eq(_count(plant), 6, "rejilla de 12 x 8 m")
	_drop(plant)


func test_an_l_shaped_floor_wastes_no_light_outside_the_building() -> void:
	var square := _square()
	var ell := _ell()
	var full := _synthetic_plant(square[0], square[1])
	var cut := _synthetic_plant(ell[0], ell[1])
	assert_gt(_count(cut), 0, "la L tiene que llevar luces")
	assert_lt(_count(cut), _count(full),
		"la L no puede llevar tantas luces como su caja envolvente")
	_drop(cut)
	_drop(full)


func test_a_huge_floor_stays_within_the_light_budget() -> void:
	var half := 120.0
	var plant := _synthetic_plant(
		PackedVector3Array([
			Vector3(-half, 0.0, -half), Vector3(half, 0.0, -half),
			Vector3(half, 0.0, half), Vector3(-half, 0.0, half)]),
		PackedInt32Array([0, 1, 2, 0, 2, 3]))
	# 240 × 240 m a 4,5 m serían más de 2800 luces. El reparto tiene que
	# separarlas más, no cortar el recorrido a media rejilla y dejar a oscuras
	# la mitad de la planta.
	assert_gt(_count(plant), 0, "una planta enorme lleva luces")
	assert_true(_count(plant) <= WorldLighting.CEILING_MAX_LIGHTS,
		"presupuesto de luces excedido: %d" % _count(plant))
	_drop(plant)


func test_a_plant_without_a_floor_gets_no_lights() -> void:
	# Ante la duda, no se inventa geometría: sin nodo `Floor` y sin metadata
	# del conversor no hay dónde colgar una luminaria.
	var plant := _synthetic_plant(PackedVector3Array(), PackedInt32Array())
	assert_eq(_count(plant), 0, "sin suelo, sin luces")
	_drop(plant)


func test_a_converted_map_gets_ceiling_lights() -> void:
	# La cara INTERIOR de un muro no ve el sol: solo le llega el ambiente, y
	# en una vista cenital salía casi negra. Una oficina se ilumina desde el
	# techo, y esta es la prueba de que el techo tiene luces.
	var map := _lit_map()
	var count := _count(map)
	assert_gt(count, 3, "mapP1 (14 x 9 m) se queda corto de luminarias")
	assert_true(count <= WorldLighting.CEILING_MAX_LIGHTS,
		"mapP1 se pasa de presupuesto: %d luces" % count)
	_drop(map)


func test_the_ceiling_lights_are_off_in_chutaos_mode() -> void:
	var was := PresentationStyle.chutaos_mode
	var square := _square()
	var plant := _synthetic_plant(square[0], square[1])
	var ceiling := plant.get_node_or_null(^"Lighting/CeilingLights") as Node3D
	assert_not_null(ceiling, "el nodo de luminarias tiene que existir")
	if ceiling != null:
		assert_true(ceiling.visible, "en modo remake las luminarias están encendidas")
		PresentationStyle.chutaos_mode = true
		assert_false(ceiling.visible, "en 2012 no había luces de techo, había color plano")
	PresentationStyle.chutaos_mode = was
	_drop(plant)
