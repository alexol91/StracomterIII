extends TestCase
## El reparto de roles es una función determinista de sus entradas.
##
## No es una propiedad estética. Es lo que permite reproducir un combate
## desde `GameState.run_seed`, depurar un flanqueo raro rebobinando en vez de
## adivinando, y —lo que más se nota— que los bots no cambien de rol entre dos
## ticks idénticos. Un reparto que baila es un grupo que parece epiléptico
## aunque cada decisión suelta sea correcta.


func before_each() -> void:
	Blackboard.clear()


func after_each() -> void:
	Blackboard.clear()


## LA PRUEBA DEL ENUNCIADO: mismas entradas, mismos roles, cien veces.
func test_same_inputs_produce_the_same_roles_one_hundred_times() -> void:
	var contacts := SquadTestUtil.contacts_at(SquadTestUtil.TARGET)
	var expected := ""
	for i in 100:
		var director := SquadTestUtil.director(1, 5)
		var world := SquadTestUtil.world_three_accesses()
		var assignment := director.assign_roles(
			SquadTestUtil.squad_of_five(), contacts, true, world
		)
		var signature := SquadTestUtil.full_signature(assignment)
		if i == 0:
			expected = signature
			continue
		if signature != expected:
			fail("la iteración %d dio un reparto distinto:\n  %s\n  %s"
				% [i, expected, signature])
			break
	assert_ne(expected, "", "la firma no puede quedar vacía")
	assert_true(expected.contains("retreat=false"), "escenario de combate, no de repliegue")


## El orden en el que lleguen los estados no puede cambiar nada. Si cambiara,
## el reparto dependería de en qué orden itere la escena sobre sus hijos, que
## es justo el tipo de dependencia oculta que hace irreproducible un bug.
func test_the_order_of_the_input_does_not_change_the_assignment() -> void:
	var contacts := SquadTestUtil.contacts_at(SquadTestUtil.TARGET)
	var forward := SquadTestUtil.squad_of_five()
	var backward: Array[BotState] = []
	for i in range(forward.size() - 1, -1, -1):
		backward.append(forward[i])

	var a := SquadTestUtil.director(1, 5).assign_roles(
		forward, contacts, true, SquadTestUtil.world_three_accesses()
	)
	var b := SquadTestUtil.director(1, 5).assign_roles(
		backward, contacts, true, SquadTestUtil.world_three_accesses()
	)
	assert_eq(SquadTestUtil.full_signature(b), SquadTestUtil.full_signature(a))


## Con dos bots idénticos hay empate, y un empate resuelto "por el orden del
## array" es un reparto no determinista disfrazado. Se desempata por `bot_id`.
func test_identical_bots_are_broken_by_id_not_by_arrival_order() -> void:
	var contacts := SquadTestUtil.contacts_at(SquadTestUtil.TARGET)
	var world := SquadTestUtil.world_two_accesses()
	var a: Array[BotState] = [
		SquadTestUtil.pinner_candidate(11, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.pinner_candidate(22, Vector3(-1.0, 0.0, 0.0)),
	]
	var b: Array[BotState] = [
		SquadTestUtil.pinner_candidate(22, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.pinner_candidate(11, Vector3(-1.0, 0.0, 0.0)),
	]
	var first := SquadTestUtil.director(1, 2).assign_roles(a, contacts, false, world)
	var second := SquadTestUtil.director(1, 2).assign_roles(
		b, contacts, false, SquadTestUtil.world_two_accesses()
	)
	assert_eq(first.role_of(11), Blackboard.Role.PINNER, "gana el id menor")
	assert_eq(SquadTestUtil.roles_signature(second), SquadTestUtil.roles_signature(first))


## La histéresis de rol tiene que ser un PUNTO FIJO: repetir el mismo reparto
## sobre el mismo director no puede desplazar a nadie. Si lo hiciera, la
## histéresis —que existe para estabilizar— sería la causa de la oscilación.
func test_repeated_calls_on_the_same_director_are_a_fixed_point() -> void:
	var director := SquadTestUtil.director(1, 5)
	var contacts := SquadTestUtil.contacts_at(SquadTestUtil.TARGET)
	var states := SquadTestUtil.squad_of_five()
	var first := director.assign_roles(
		states, contacts, true, SquadTestUtil.world_three_accesses()
	)
	var expected := SquadTestUtil.roles_signature(first)
	for i in range(1, 10):
		var again := director.assign_roles(
			states, contacts, true, SquadTestUtil.world_three_accesses()
		)
		if SquadTestUtil.roles_signature(again) != expected:
			fail("la llamada %d desplazó roles: %s" % [i, SquadTestUtil.roles_signature(again)])
			break
	assert_ne(expected, "")


## La histéresis sí debe ceder ante un cambio real: si el Fijador se queda
## sin visión y otro la gana, el rol se mueve. Una histéresis que no cede es
## un rol congelado.
func test_hysteresis_yields_to_a_real_change() -> void:
	var director := SquadTestUtil.director(1, 2)
	var contacts := SquadTestUtil.contacts_at(SquadTestUtil.TARGET)
	var world := SquadTestUtil.world_single_access()
	var first: Array[BotState] = [
		SquadTestUtil.pinner_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.flanker_candidate(20, Vector3(1.0, 0.0, 0.0)),
	]
	assert_eq(director.assign_roles(first, contacts, false, world).role_of(10),
		Blackboard.Role.PINNER)

	var second: Array[BotState] = [
		SquadTestUtil.flanker_candidate(10, Vector3(-1.0, 0.0, 0.0)),
		SquadTestUtil.pinner_candidate(20, Vector3(1.0, 0.0, 0.0)),
	]
	assert_eq(director.assign_roles(second, contacts, false, world).role_of(20),
		Blackboard.Role.PINNER, "quien ve al objetivo ahora es quien fija")


## `assign_roles()` no consulta el reloj. Si lo hiciera, dos ejecuciones
## idénticas darían resultados distintos y toda la testeabilidad de este
## módulo sería una ilusión. Se comprueba indirectamente: mismo reparto
## separado por una espera medible.
func test_the_assignment_does_not_depend_on_the_wall_clock() -> void:
	var contacts := SquadTestUtil.contacts_at(SquadTestUtil.TARGET)
	var before := SquadTestUtil.director(1, 5).assign_roles(
		SquadTestUtil.squad_of_five(), contacts, true, SquadTestUtil.world_three_accesses()
	)
	var start := Time.get_ticks_msec()
	var spin := 0
	while Time.get_ticks_msec() - start < 3:
		spin += 1
	var after := SquadTestUtil.director(1, 5).assign_roles(
		SquadTestUtil.squad_of_five(), contacts, true, SquadTestUtil.world_three_accesses()
	)
	assert_gt(float(spin), 0.0, "hubo espera real")
	assert_eq(SquadTestUtil.full_signature(after), SquadTestUtil.full_signature(before))
