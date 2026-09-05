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
