extends TestCase
## La cámara en pasillos estrechos (T-10).
##
## El brazo sobre el hombro es justo lo que mete la cámara en la pared en una
## esquina cóncava: el pivote está medio metro a un lado, así que al girar hacia
## el rincón el brazo sale por dentro del muro y el `SpringArm3D` no tiene más
## remedio que acortarse hasta la nuca. Acortar es la respuesta equivocada; la
## buena es MOVER la cámara al eje del personaje, que es donde sí hay hueco.
##
## Mover la cámara resultó estar mal por dos veces —ver la cabecera de
## `_resolve_tight_space`, con las medidas— así que lo que queda es subir el
## PIVOTE con el colapso y esconder lo que tape. Aquí se prueba la geometría,
## que es pura: cuánto se ha comido el entorno del brazo y la pregunta «¿me
## estás tapando?». Cómo se ve NO se prueba así: eso se mira en una captura, y
## la transparencia además solo la respeta Forward+.


func test_collapse_is_bounded_even_with_nonsense_lengths() -> void:
	# `get_hit_length()` puede devolver más que la longitud pedida durante la
	# interpolación de un cambio de modo, y la longitud puede ser cero antes de
	# que el brazo se configure. Ni un caso ni el otro puede dar un valor fuera
	# de 0..1: con eso el hombro se iría al otro lado del personaje.
	assert_almost_eq(TPSCamera.collapse_ratio(9.0, 4.0), 0.0, 0.0001, "brazo más largo de lo pedido")
	assert_almost_eq(TPSCamera.collapse_ratio(1.0, 0.0), 0.0, 0.0001, "longitud cero")
	assert_almost_eq(TPSCamera.collapse_ratio(-1.0, 4.0), 1.0, 0.0001, "impacto detrás del pivote")


func test_a_companion_in_the_line_of_sight_counts_as_an_occluder() -> void:
	# La cámara a cuatro metros detrás de la cabeza; el compañero, a dos.
	var eye := Vector3(0.0, 1.5, 4.0)
	var head := Vector3(0.0, 1.5, 0.0)
	assert_true(TPSCamera.is_between(eye, head, Vector3(0.1, 1.5, 2.0), 0.75),
		"un compañero justo en medio tapa")
	assert_false(TPSCamera.is_between(eye, head, Vector3(1.4, 1.5, 2.0), 0.75),
		"apartado a metro y medio, no")


func test_what_is_behind_or_beyond_never_counts_as_an_occluder() -> void:
	var eye := Vector3(0.0, 1.5, 4.0)
	var head := Vector3(0.0, 1.5, 0.0)
	assert_false(TPSCamera.is_between(eye, head, Vector3(0.0, 1.5, 6.0), 0.75),
		"detrás de la cámara no tapa nada")
	assert_false(TPSCamera.is_between(eye, head, Vector3(0.0, 1.5, -2.0), 0.75),
		"más allá del jugador tampoco")
	assert_false(TPSCamera.is_between(eye, eye, Vector3(0.0, 1.5, 2.0), 0.75),
		"con la cámara sobre la cabeza no hay eje: no se tapa nada")
