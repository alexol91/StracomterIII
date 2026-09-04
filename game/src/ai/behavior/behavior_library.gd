class_name BehaviorLibrary
extends RefCounted
## Un árbol de comportamiento por cada `BehaviorKind.Kind`.
##
## Los árboles son pequeños a propósito. Toda la prioridad —cuándo cubrirse,
## cuándo asaltar, cuándo huir— vive en el selector por utilidad; aquí sólo
## está el CÓMO, en forma de secuencias que se pueden abortar limpiamente.
## Un árbol grande con la prioridad codificada en el orden de sus ramas es
## precisamente el diseño que esta arquitectura evita.
##
## Nada de esto es una FSM plana. No hay transiciones entre comportamientos:
## un comportamiento no sabe cuál viene después, y no puede saberlo. Eso lo
## decide `BehaviorController` con la utilidad y la histéresis.

## Construye el árbol de un comportamiento. Se llama una vez por bot y
## comportamiento; los árboles no se reconstruyen por tick.
static func build(kind: BehaviorKind.Kind) -> BehaviorTree.BTNode:
	match kind:
		BehaviorKind.Kind.PATROL:
			return _patrol()
		BehaviorKind.Kind.INVESTIGATE:
			return _investigate()
		BehaviorKind.Kind.ATTACK:
			return _attack()
		BehaviorKind.Kind.TAKE_COVER:
			return _take_cover()
		BehaviorKind.Kind.SUPPRESS:
			return _suppress()
		BehaviorKind.Kind.FLANK:
			return _flank()
		BehaviorKind.Kind.ASSAULT:
			return _assault()
		BehaviorKind.Kind.RELOAD:
			return _reload()
		BehaviorKind.Kind.REGROUP:
			return _regroup()
		BehaviorKind.Kind.RETREAT:
			return _retreat()
		BehaviorKind.Kind.FOLLOW_LEADER:
			return _follow_leader()
		BehaviorKind.Kind.HOLD_POSITION:
			return _hold_position()
	return _idle()


static func _idle() -> BehaviorTree.BTNode:
	return BehaviorTree.Action.new(&"idle", BehaviorActions.idle)


## El legacy patrullaba entre los 3 vértices del triángulo de la triangulación
## donde había aparecido, eligiendo el siguiente al azar y viajando en línea
## recta sin A* (`Enemy.cc:44-73`). Aquí el recorrido lo pone quien coloca al
## bot y el camino lo da el navmesh.
static func _patrol() -> BehaviorTree.BTNode:
	var root := BehaviorTree.Sequence.new(&"patrol")
	root.add(BehaviorTree.Condition.new(&"tiene_ruta", BehaviorActions.has_patrol_route))
	root.add(BehaviorTree.Condition.new(&"tiene_cuerpo", BehaviorActions.is_embodied))
	root.add(BehaviorTree.Action.new(&"recorrer", BehaviorActions.patrol_step, BehaviorActions.stop_moving))
	return root


## Ir a donde se cree que está el objetivo (o de dónde vino el ruido) y mirar
## alrededor. Sustituye al estado `Ensure` del legacy, que giraba 1° por frame
## durante 360 frames (`Enemy.cc:158-167`).
static func _investigate() -> BehaviorTree.BTNode:
	var root := BehaviorTree.Sequence.new(&"investigate")
	root.add(BehaviorTree.Condition.new(&"hay_pista", BehaviorActions.has_investigation_point))
	root.add(BehaviorTree.Condition.new(&"tiene_cuerpo", BehaviorActions.is_embodied))
	root.add(BehaviorTree.Action.new(&"ir_a_la_pista",
		BehaviorActions.move_to_investigation, BehaviorActions.stop_moving))
	root.add(BehaviorTree.Action.new(&"barrer", BehaviorActions.scan_area))
	return root


## Disparar desde donde se está. La condición de visión está DENTRO del árbol
## además de en la puerta del selector: entre decisión y ejecución hay hasta
## cuatro ticks, y en cuatro ticks el objetivo se mete detrás de una pared.
static func _attack() -> BehaviorTree.BTNode:
	var root := BehaviorTree.Sequence.new(&"attack")
	root.add(BehaviorTree.Condition.new(&"hay_objetivo", BehaviorActions.has_target))
	root.add(BehaviorTree.Condition.new(&"hay_munición", BehaviorActions.has_ammo))
	root.add(BehaviorTree.Condition.new(&"hay_visión", BehaviorActions.has_line_of_sight))
	root.add(BehaviorTree.Action.new(&"disparar", BehaviorActions.fire_at_target))
	return root


## Buscar cobertura, ir, agacharse y aguantar encarando la amenaza.
##
## `elegir_cobertura` FALLA cuando la nube no devuelve ningún punto, y ese
## fallo es información: el controlador veta TAKE_COVER un rato y el selector
## elige otra cosa. Es lo que convierte "no hay dónde cubrirse" en "pues me
## retiro" sin una sola regla escrita a mano.
static func _take_cover() -> BehaviorTree.BTNode:
	var root := BehaviorTree.Sequence.new(&"take_cover")
	root.add(BehaviorTree.Condition.new(&"tiene_cuerpo", BehaviorActions.is_embodied))
	root.add(BehaviorTree.Action.new(&"elegir_cobertura", BehaviorActions.pick_cover))
	root.add(BehaviorTree.Action.new(&"ir_a_cobertura",
		BehaviorActions.move_along_path, BehaviorActions.stop_moving))
	root.add(BehaviorTree.Action.new(&"agacharse", BehaviorActions.crouch_if_in_cover))
	root.add(BehaviorTree.Action.new(&"aguantar", BehaviorActions.hold_position))
	return root


## Fuego sostenido y marca de supresión en la pizarra: es lo que habilita el
## asalto de los compañeros.
static func _suppress() -> BehaviorTree.BTNode:
	var root := BehaviorTree.Sequence.new(&"suppress")
	root.add(BehaviorTree.Condition.new(&"hay_objetivo", BehaviorActions.has_target))
	root.add(BehaviorTree.Condition.new(&"hay_visión", BehaviorActions.has_line_of_sight))
	root.add(BehaviorTree.Action.new(&"ráfaga", BehaviorActions.suppress_burst))
	return root


## Rodear por una ruta de navmesh REALMENTE disjunta, reclamada en la pizarra
## para que no vayan dos por la misma.
static func _flank() -> BehaviorTree.BTNode:
	var root := BehaviorTree.Sequence.new(&"flank")
	root.add(BehaviorTree.Condition.new(&"tiene_cuerpo", BehaviorActions.is_embodied))
	root.add(BehaviorTree.Condition.new(&"hay_objetivo", BehaviorActions.has_target))
	root.add(BehaviorTree.Action.new(&"reclamar_ruta",
		BehaviorActions.claim_flank_route, BehaviorActions.release_flank_route))
	root.add(BehaviorTree.Action.new(&"recorrer_ruta",
		BehaviorActions.move_along_path, BehaviorActions.release_flank_route))
	root.add(BehaviorTree.Action.new(&"encarar", BehaviorActions.face_target))
	return root


## Avanzar sobre el objetivo disparando. La condición de supresión es lo
## primero que se comprueba y se pregunta a la PIZARRA: nadie asalta sin
## supresión activa de un compañero (GDD §8.4).
static func _assault() -> BehaviorTree.BTNode:
	var root := BehaviorTree.Sequence.new(&"assault")
	root.add(BehaviorTree.Condition.new(&"tiene_cuerpo", BehaviorActions.is_embodied))
	root.add(BehaviorTree.Condition.new(&"hay_supresión", BehaviorActions.squad_has_suppression))
	root.add(BehaviorTree.Condition.new(&"hay_objetivo", BehaviorActions.has_target))
	var advance := BehaviorTree.Parallel.new(&"avanzar_disparando")
	# Basta con que el avance termine: el fuego de acompañamiento nunca
	# "termina", sólo acompaña.
	advance.success_threshold = 1
	advance.failure_threshold = 1
	advance.add(BehaviorTree.Action.new(&"avanzar",
		BehaviorActions.advance_on_target, BehaviorActions.stop_moving))
	advance.add(BehaviorTree.Action.new(&"fuego_de_avance", BehaviorActions.fire_if_visible))
	root.add(advance)
	return root


## Recargar, agachado si se está a cubierto.
static func _reload() -> BehaviorTree.BTNode:
	var root := BehaviorTree.Sequence.new(&"reload")
	root.add(BehaviorTree.Condition.new(&"falta_munición", BehaviorActions.needs_reload))
	root.add(BehaviorTree.Action.new(&"agacharse", BehaviorActions.crouch_if_in_cover))
	root.add(BehaviorTree.Action.new(&"recargar", BehaviorActions.reload))
	return root


## Volver con la escuadra. Por debajo del 40 % de efectivos el grupo se
## repliega en lugar de morir de uno en uno (GDD §8.4).
static func _regroup() -> BehaviorTree.BTNode:
	var root := BehaviorTree.Sequence.new(&"regroup")
	root.add(BehaviorTree.Condition.new(&"tiene_cuerpo", BehaviorActions.is_embodied))
	root.add(BehaviorTree.Condition.new(&"hay_punto_de_reunión", BehaviorActions.has_rally_point))
	root.add(BehaviorTree.Action.new(&"ir_al_punto", BehaviorActions.move_to_rally, BehaviorActions.stop_moving))
	root.add(BehaviorTree.Action.new(&"aguantar", BehaviorActions.hold_position))
	return root


## Retirarse: alejarse de las amenazas, a cubierto si lo hay.
static func _retreat() -> BehaviorTree.BTNode:
	var root := BehaviorTree.Sequence.new(&"retreat")
	root.add(BehaviorTree.Condition.new(&"tiene_cuerpo", BehaviorActions.is_embodied))
	root.add(BehaviorTree.Action.new(&"elegir_salida",
		BehaviorActions.pick_retreat_cover, BehaviorActions.stop_moving))
	root.add(BehaviorTree.Action.new(&"replegarse",
		BehaviorActions.move_along_path, BehaviorActions.stop_moving))
	root.add(BehaviorTree.Action.new(&"agacharse", BehaviorActions.crouch_if_in_cover))
	root.add(BehaviorTree.Action.new(&"aguantar", BehaviorActions.hold_position))
	return root


## Compañeros (GDD §8.5): mantener la formación que fija `ai-escuadra`.
static func _follow_leader() -> BehaviorTree.BTNode:
	var root := BehaviorTree.Sequence.new(&"follow_leader")
	root.add(BehaviorTree.Condition.new(&"tiene_cuerpo", BehaviorActions.is_embodied))
	root.add(BehaviorTree.Action.new(&"seguir", BehaviorActions.follow_leader, BehaviorActions.stop_moving))
	return root


## Compañeros: orden del jugador de quedarse donde está.
static func _hold_position() -> BehaviorTree.BTNode:
	return BehaviorTree.Action.new(&"hold_position", BehaviorActions.hold_position, BehaviorActions.stop_moving)
