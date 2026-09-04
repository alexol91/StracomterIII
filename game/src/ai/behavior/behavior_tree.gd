class_name BehaviorTree
extends RefCounted
## Árbol de comportamiento mínimo: los seis nodos que hacen falta y ni uno
## más. Sin dependencias externas ni addons (regla del proyecto).
##
## Reparto de responsabilidades con el selector por utilidad (GDD §8.2):
## la utilidad decide QUÉ hacer, el árbol decide CÓMO. Un árbol puro no sabe
## priorizar —hay que codificar la prioridad en el orden de las ramas, y eso no
## escala— y una utilidad pura no sabe ejecutar secuencias: "ve a la cobertura,
## luego agáchate, luego asoma" son tres pasos con estado, y un selector por
## utilidad los reevaluaría desde cero cada tick.
##
## Estados: RUNNING / SUCCESS / FAILURE.
##
## LAS SECUENCIAS TIENEN MEMORIA: si un hijo devuelve RUNNING, el siguiente
## tick continúa por ese hijo y no desde el principio. Sin memoria, "muévete a
## la cobertura" volvería a pedir cobertura 20 veces por segundo y el bot no
## llegaría nunca. La reactividad no se consigue reevaluando el árbol entero,
## sino en el nivel de arriba: el controlador vuelve a decidir a 5 Hz y aborta
## el árbol si otro comportamiento gana.
##
## ABORTOS LIMPIOS: `abort()` recorre el árbol devolviéndolo a su estado
## inicial y da a cada acción la oportunidad de soltar lo que tuviera cogido
## (una ruta reclamada en la pizarra, una orden de movimiento). Un árbol que se
## abandona a medias sin soltar su reclamación de ruta deja a la escuadra
## creyendo que alguien está flanqueando por ahí.

enum Status {
	RUNNING,  ## Sigue en ello. El controlador volverá a llamar en el próximo tick.
	SUCCESS,  ## Terminado y bien.
	FAILURE,  ## No se puede: el comportamiento no es viable AHORA.
}


## Nodo base. Todo nodo del árbol responde a `tick`, `reset` y `abort`.
class BTNode:
	extends RefCounted

	## Nombre legible. Aparece en la traza de depuración del árbol.
	var name: StringName = &""
	## Estado devuelto en el último tick. Sólo para depuración.
	var last_status: BehaviorTree.Status = BehaviorTree.Status.FAILURE

	func _init(p_name: StringName = &"") -> void:
		name = p_name

	## Ejecuta un paso. `delta` es el periodo del canal de comportamiento
	## (20 Hz según ADR-002), no el del frame.
	func tick(_ctx: BehaviorContext, _delta: float) -> BehaviorTree.Status:
		return BehaviorTree.Status.FAILURE

	## Devuelve el nodo a su estado inicial sin efectos sobre el mundo.
	func reset() -> void:
		last_status = BehaviorTree.Status.FAILURE

	## Cancela lo que estuviera haciendo y suelta lo que tuviera reservado.
	func abort(_ctx: BehaviorContext) -> void:
		reset()

	## Hijos del nodo. Vacío en las hojas.
	func children() -> Array[BTNode]:
		return []

	## Traza del subárbol con el último estado de cada nodo.
	func to_text(indent: int = 0) -> String:
		var pad := "  ".repeat(indent)
		var lines: Array[String] = ["%s%s [%s]" % [pad, name, BehaviorTree.status_name(last_status)]]
		for child: BTNode in children():
			lines.append(child.to_text(indent + 1))
		return "\n".join(lines)


## Nodo con hijos. Base común de Sequence, Selector y Parallel.
class Composite:
	extends BTNode

	var _children: Array[BTNode] = []
	var _current: int = 0

	func _init(p_name: StringName = &"", p_children: Array[BTNode] = []) -> void:
		super(p_name)
		_children = p_children

	func add(child: BTNode) -> Composite:
		_children.append(child)
		return self

	func children() -> Array[BTNode]:
		return _children

	func reset() -> void:
		super()
		_current = 0
		for child: BTNode in _children:
			child.reset()

	func abort(ctx: BehaviorContext) -> void:
		for child: BTNode in _children:
			child.abort(ctx)
		_current = 0
		last_status = BehaviorTree.Status.FAILURE


## Ejecuta los hijos en orden hasta que uno falla. Con memoria: reanuda por el
## hijo que devolvió RUNNING.
class Sequence:
	extends Composite

	func tick(ctx: BehaviorContext, delta: float) -> BehaviorTree.Status:
		while _current < _children.size():
			var status := _children[_current].tick(ctx, delta)
			if status == BehaviorTree.Status.RUNNING:
				last_status = status
				return status
			if status == BehaviorTree.Status.FAILURE:
				_current = 0
				last_status = status
				return status
			_current += 1
		_current = 0
		last_status = BehaviorTree.Status.SUCCESS
		return last_status


## Ejecuta los hijos en orden hasta que uno tiene éxito. Es la alternativa:
## "intenta esto; si no puedes, esto otro".
class Selector:
	extends Composite

	func tick(ctx: BehaviorContext, delta: float) -> BehaviorTree.Status:
		while _current < _children.size():
			var status := _children[_current].tick(ctx, delta)
			if status == BehaviorTree.Status.RUNNING:
				last_status = status
				return status
			if status == BehaviorTree.Status.SUCCESS:
				_current = 0
				last_status = status
				return status
			_current += 1
		_current = 0
		last_status = BehaviorTree.Status.FAILURE
		return last_status


## Ejecuta TODOS los hijos en el mismo tick. Es lo que permite "avanza
## mientras disparas" sin dos árboles ni un estado extra.
##
## `success_threshold` hijos con éxito bastan para tener éxito;
## `failure_threshold` fallos bastan para fallar. Por defecto: falla en cuanto
## uno falla, tiene éxito cuando todos lo tienen.
class Parallel:
	extends Composite

	var success_threshold: int = -1
	var failure_threshold: int = 1

	func tick(ctx: BehaviorContext, delta: float) -> BehaviorTree.Status:
		var successes := 0
		var failures := 0
		for child: BTNode in _children:
			var status := child.tick(ctx, delta)
			if status == BehaviorTree.Status.SUCCESS:
				successes += 1
			elif status == BehaviorTree.Status.FAILURE:
				failures += 1
		var needed := success_threshold if success_threshold > 0 else _children.size()
		if failure_threshold > 0 and failures >= failure_threshold:
			last_status = BehaviorTree.Status.FAILURE
		elif successes >= needed:
			last_status = BehaviorTree.Status.SUCCESS
		else:
			last_status = BehaviorTree.Status.RUNNING
		return last_status


## Hoja de decisión: SUCCESS si el predicado se cumple, FAILURE si no. Nunca
## RUNNING — una condición no tarda.
class Condition:
	extends BTNode

	## `func(ctx: BehaviorContext) -> bool`
	var predicate: Callable = Callable()

	func _init(p_name: StringName = &"", p_predicate: Callable = Callable()) -> void:
		super(p_name)
		predicate = p_predicate

	func tick(ctx: BehaviorContext, _delta: float) -> BehaviorTree.Status:
		# Sin predicado NO se concede el paso. El valor por defecto de una
		# condición no puede ser el permisivo: una condición vacía que
		# devolviera SUCCESS dejaría pasar "¿tengo línea de visión?" sin
		# preguntarlo, y ese es exactamente el bug del legacy.
		if not predicate.is_valid():
			last_status = BehaviorTree.Status.FAILURE
			return last_status
		var ok: bool = predicate.call(ctx)
		last_status = BehaviorTree.Status.SUCCESS if ok else BehaviorTree.Status.FAILURE
		return last_status


## Hoja de ejecución: hace algo en el mundo a través del actuador y devuelve
## RUNNING mientras siga en ello.
class Action:
	extends BTNode

	## `func(ctx: BehaviorContext, delta: float) -> BehaviorTree.Status`
	var routine: Callable = Callable()
	## `func(ctx: BehaviorContext) -> void`. Se llama al abortar. Es donde una
	## acción suelta lo que hubiera reservado.
	var on_abort: Callable = Callable()

	func _init(
		p_name: StringName = &"",
		p_routine: Callable = Callable(),
		p_on_abort: Callable = Callable()
	) -> void:
		super(p_name)
		routine = p_routine
		on_abort = p_on_abort

	func tick(ctx: BehaviorContext, delta: float) -> BehaviorTree.Status:
		if not routine.is_valid():
			last_status = BehaviorTree.Status.FAILURE
			return last_status
		var raw: Variant = routine.call(ctx, delta)
		last_status = int(raw) as BehaviorTree.Status
		return last_status

	func abort(ctx: BehaviorContext) -> void:
		if on_abort.is_valid():
			on_abort.call(ctx)
		reset()


## Envuelve a un hijo y transforma su resultado. La base es transparente; las
## variantes útiles están debajo.
class Decorator:
	extends BTNode

	var child: BTNode = null

	func _init(p_name: StringName = &"", p_child: BTNode = null) -> void:
		super(p_name)
		child = p_child

	func children() -> Array[BTNode]:
		var out: Array[BTNode] = []
		if child != null:
			out.append(child)
		return out

	func reset() -> void:
		super()
		if child != null:
			child.reset()

	func abort(ctx: BehaviorContext) -> void:
		if child != null:
			child.abort(ctx)
		last_status = BehaviorTree.Status.FAILURE

	func tick(ctx: BehaviorContext, delta: float) -> BehaviorTree.Status:
		if child == null:
			last_status = BehaviorTree.Status.FAILURE
			return last_status
		last_status = decorate(child.tick(ctx, delta))
		return last_status

	## Transformación del resultado del hijo. La base no transforma nada.
	func decorate(status: BehaviorTree.Status) -> BehaviorTree.Status:
		return status


## Invierte éxito y fallo. RUNNING pasa tal cual.
class Inverter:
	extends Decorator

	func decorate(status: BehaviorTree.Status) -> BehaviorTree.Status:
		match status:
			BehaviorTree.Status.SUCCESS:
				return BehaviorTree.Status.FAILURE
			BehaviorTree.Status.FAILURE:
				return BehaviorTree.Status.SUCCESS
		return status


## Convierte el fallo en éxito. Sirve para pasos opcionales dentro de una
## secuencia que no deben tumbar el comportamiento entero.
class Succeeder:
	extends Decorator

	func decorate(status: BehaviorTree.Status) -> BehaviorTree.Status:
		if status == BehaviorTree.Status.FAILURE:
			return BehaviorTree.Status.SUCCESS
		return status


## Repite al hijo mientras tenga éxito, devolviendo siempre RUNNING. Es lo que
## sostiene un comportamiento continuo (patrullar, suprimir) sin que la
## secuencia se dé por terminada y el controlador vuelva a IDLE.
class KeepRunning:
	extends Decorator

	func decorate(status: BehaviorTree.Status) -> BehaviorTree.Status:
		if status == BehaviorTree.Status.FAILURE:
			return BehaviorTree.Status.FAILURE
		return BehaviorTree.Status.RUNNING


static func status_name(status: Status) -> String:
	return Status.keys()[int(status)]
