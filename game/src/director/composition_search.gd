class_name CompositionSearch
extends RefCounted
## Búsqueda exhaustiva de la composición de un encuentro: enumera TODAS las
## combinaciones viables de enemigos y elige la de mayor puntuación.
##
## [b]Por qué esto y no el Simplex[/b]
##
## El director elige tres números pequeños con tres restricciones, una vez
## por zona. La programación lineal es maquinaria para cientos de variables;
## aquí el espacio entero cabe en unos pocos miles de combinaciones y se
## recorre en microsegundos. Pero la razón de fondo no es el tamaño, es la
## FORMA del objetivo: lo que de verdad queremos maximizar —variedad de la
## composición, novedad frente a la oleada anterior, ajuste a la geometría—
## NO ES LINEAL, y un programa lineal solo admite objetivos lineales. La
## degeneración de 2012 (26 Milicianos de 29) es exactamente el precio de
## haber forzado `max x1+x2+x3` sobre un problema que no era ese.
##
## Aquí la puntuación es una suma ponderada de términos separados y con
## nombre, y cada candidato devuelve su desglose. Eso es lo que hace el
## sistema BALANCEABLE: cuando una planta se siente mal, se ve qué término
## la está decidiendo en lugar de adivinar.
##
## Determinista de principio a fin: ante empate no gana el que salió primero
## del bucle, gana el que decide una función de la semilla de la partida.

## Términos de la puntuación. Los nombres se usan tal cual en la consola.
const TERM_TARGET: StringName = &"objetivo"
const TERM_VARIETY: StringName = &"variedad"
const TERM_NOVELTY: StringName = &"novedad"
const TERM_BUDGET: StringName = &"presupuesto"
const TERM_MAP_FIT: StringName = &"forma"

# TODO(arquitecto): los cinco pesos son balanceo puro y deberían vivir en
# DirectorProfile, en un grupo "Puntuación de composición".

## Cercanía a la composición objetivo de la planta.
const WEIGHT_TARGET: float = 1.0
## Variedad de la mezcla (entropía). Es el término que el Simplex no podía
## expresar y el que impide la degeneración del original.
const WEIGHT_VARIETY: float = 0.6
## Diferencia con la composición anterior: evita dos zonas seguidas iguales.
const WEIGHT_NOVELTY: float = 0.4
## Aprovechamiento del presupuesto: penaliza dejar amenaza sin gastar.
const WEIGHT_BUDGET: float = 0.8
## Ajuste a la forma del mapa.
const WEIGHT_MAP_FIT: float = 0.9

## Tope duro de combinaciones. Si se alcanza, la búsqueda se corta y lo
## declara: más vale una composición peor que un tirón de un segundo.
const MAX_COMBINATIONS: int = 400000
## Dos puntuaciones que difieren menos que esto se consideran empate y las
## desempata la semilla.
const SCORE_EPSILON: float = 0.0000001

## Lo que se busca.
class Request:
	extends RefCounted

	## Cotas por arquetipo, inclusive.
	var lower: Array[int] = [0, 0, 0]
	var upper: Array[int] = [0, 0, 0]
	## Presupuestos de daño, vida y velocidad.
	var budgets: Array[float] = [0.0, 0.0, 0.0]
	## Coeficientes del original, por fila.
	var damage_coefficients: Array[float] = [60.0, 100.0, 120.0]
	var health_coefficients: Array[float] = [45.0, 50.0, 65.0]
	var speed_coefficients: Array[float] = [60.0, 45.0, 35.0]
	## Composición objetivo de la planta, en enemigos.
	var target_counts: Array[float] = [0.0, 0.0, 0.0]
	## Reparto que pide la forma del mapa, 0..1 y sumando 1.
	var affinity_shares: Array[float] = [0.0, 0.0, 0.0]
	## Composición anterior, para el término de novedad. Vacío = no hay.
	var previous_counts: Array[int] = []
	## Tope de enemigos (MaxEnemies).
	var max_total: int = 0
	## Semilla del desempate.
	var seed: int = 0
	## Cuántas composiciones devolver ordenadas.
	var top_k: int = 10

	func archetype_count() -> int:
		return lower.size()


## Una composición puntuada, con el desglose que la explica.
class Candidate:
	extends RefCounted

	var counts: Array[int] = [0, 0, 0]
	## Puntuación total, 0..1.
	var score: float = 0.0
	## Valor 0..1 de cada término, SIN peso.
	var terms: Dictionary[StringName, float] = {}
	## Contribución de cada término a la puntuación, ya ponderada.
	var weighted: Dictionary[StringName, float] = {}
	## Consumo de cada presupuesto.
	var spent: Array[float] = [0.0, 0.0, 0.0]

	func total() -> int:
		var sum: int = 0
		for value: int in counts:
			sum += value
		return sum

	func share(index: int) -> float:
		var sum := total()
		return 0.0 if sum == 0 else float(counts[index]) / float(sum)

	func dominant_share() -> float:
		var sum := total()
		if sum == 0:
			return 0.0
		var biggest: int = 0
		for value: int in counts:
			biggest = maxi(biggest, value)
		return float(biggest) / float(sum)

	## Una línea por composición, con el desglose. Es lo que imprime
	## `director.compose`.
	func describe() -> String:
		var parts: Array[String] = []
		for key: StringName in [
			CompositionSearch.TERM_TARGET,
			CompositionSearch.TERM_VARIETY,
			CompositionSearch.TERM_NOVELTY,
			CompositionSearch.TERM_BUDGET,
			CompositionSearch.TERM_MAP_FIT,
		]:
			var value: float = terms[key] if terms.has(key) else 0.0
			parts.append("%s %.3f" % [key, value])
		return "[%2d/%2d/%2d] total %2d · puntuación %.4f · %s" % [
			counts[0], counts[1], counts[2], total(), score, " ".join(parts),
		]


## Resultado de una búsqueda.
class Result:
	extends RefCounted

	## La mejor composición, o null si ninguna combinación es viable.
	var best: Candidate = null
	## Las `top_k` mejores, de mayor a menor puntuación.
	var ranked: Array[Candidate] = []
	## Combinaciones visitadas por el bucle, podas incluidas.
	var combinations_visited: int = 0
	## Combinaciones que cumplían cotas y presupuestos.
	var feasible_count: int = 0
	## true si se alcanzó `MAX_COMBINATIONS` y la búsqueda se cortó.
	var truncated: bool = false
	var elapsed_usec: int = 0

	func has_solution() -> bool:
		return best != null


## Recorre el espacio y devuelve las mejores composiciones.
##
## La poda es la que hace que esto sea barato: los tres costes crecen con
## cada enemigo, así que en cuanto un prefijo se pasa de presupuesto, todo lo
## que venga detrás en ese bucle también se pasa y se corta el barrido.
static func run(request: Request) -> Result:
	var started := Time.get_ticks_usec()
	var result := Result.new()
	var archetypes := request.archetype_count()
	if archetypes != 3:
		push_error("CompositionSearch: se esperan 3 arquetipos, llegaron %d." % archetypes)
		return result

	var scored: Array[Candidate] = []
	var counts: Array[int] = [0, 0, 0]

	for x0: int in range(request.lower[0], request.upper[0] + 1):
		if not _prefix_fits(request, [x0, 0, 0]):
			break
		for x1: int in range(request.lower[1], request.upper[1] + 1):
			if not _prefix_fits(request, [x0, x1, 0]):
				break
			for x2: int in range(request.lower[2], request.upper[2] + 1):
				result.combinations_visited += 1
				if result.combinations_visited >= MAX_COMBINATIONS:
					result.truncated = true
					break
				counts = [x0, x1, x2]
				if x0 + x1 + x2 > request.max_total:
					break
				if not _prefix_fits(request, counts):
					break
				result.feasible_count += 1
				scored.append(evaluate(counts, request))
			if result.truncated:
				break
		if result.truncated:
			break

	_sort_candidates(scored, request.seed)
	result.ranked = scored.slice(0, maxi(request.top_k, 1))
	if not scored.is_empty():
		result.best = scored[0]
	result.elapsed_usec = Time.get_ticks_usec() - started
	return result


## Puntúa una composición. Pública porque el desglose es lo que se depura.
static func evaluate(counts: Array[int], request: Request) -> Candidate:
	var candidate := Candidate.new()
	candidate.counts = counts.duplicate()
	candidate.spent = spend(counts, request)
	candidate.terms = score_terms(counts, request)

	var weights: Dictionary[StringName, float] = {
		TERM_TARGET: WEIGHT_TARGET,
		TERM_VARIETY: WEIGHT_VARIETY,
		TERM_NOVELTY: WEIGHT_NOVELTY,
		TERM_BUDGET: WEIGHT_BUDGET,
		TERM_MAP_FIT: WEIGHT_MAP_FIT,
	}
	var total_weight: float = 0.0
	var total_score: float = 0.0
	for key: StringName in weights:
		var term_value: float = candidate.terms[key] if candidate.terms.has(key) else 0.0
		var contribution := weights[key] * term_value
		candidate.weighted[key] = contribution
		total_score += contribution
		total_weight += weights[key]
	candidate.score = 0.0 if total_weight <= 0.0 else total_score / total_weight
	return candidate


## Los cinco términos, cada uno normalizado a 0..1 con 1 = mejor.
static func score_terms(counts: Array[int], request: Request) -> Dictionary[StringName, float]:
	return {
		TERM_TARGET: target_term(counts, request),
		TERM_VARIETY: variety_term(counts, request),
		TERM_NOVELTY: novelty_term(counts, request),
		TERM_BUDGET: budget_term(counts, request),
		TERM_MAP_FIT: map_fit_term(counts, request),
	}


## Cercanía a la composición objetivo de la planta.
static func target_term(counts: Array[int], request: Request) -> float:
	var deviation: float = 0.0
	for index: int in counts.size():
		deviation += absf(float(counts[index]) - request.target_counts[index])
	var scale := 2.0 * float(maxi(request.max_total, 1))
	return clampf(1.0 - deviation / scale, 0.0, 1.0)


## VARIEDAD: entropía de Shannon normalizada. Vale 1 cuando la mezcla está
## repartida entre todos los arquetipos disponibles y 0 cuando son todos del
## mismo tipo. Es el término que hace imposible la degeneración de 2012, y es
## justo el que no cabe en una función objetivo lineal.
static func variety_term(counts: Array[int], request: Request) -> float:
	var total: int = 0
	var available: int = 0
	for index: int in counts.size():
		total += counts[index]
		if request.upper[index] > 0:
			available += 1
	if total <= 0:
		return 0.0
	if available <= 1:
		# Con un solo arquetipo disponible, la variedad no es una decisión:
		# no se puede premiar ni castigar por algo que no se puede elegir.
		return 1.0
	var entropy: float = 0.0
	for value: int in counts:
		if value <= 0:
			continue
		var share := float(value) / float(total)
		entropy -= share * log(share)
	return clampf(entropy / log(float(available)), 0.0, 1.0)


## NOVEDAD: distancia a la composición anterior, en reparto. 1 = no se
## parece en nada; 0 = la misma mezcla otra vez.
static func novelty_term(counts: Array[int], request: Request) -> float:
	if request.previous_counts.is_empty():
		return 1.0
	var previous_total: int = 0
	for value: int in request.previous_counts:
		previous_total += value
	var total: int = 0
	for value: int in counts:
		total += value
	if previous_total <= 0 or total <= 0:
		return 1.0
	var distance: float = 0.0
	for index: int in counts.size():
		var mine := float(counts[index]) / float(total)
		var theirs := float(request.previous_counts[index]) / float(previous_total)
		distance += absf(mine - theirs)
	return clampf(distance * 0.5, 0.0, 1.0)


## Aprovechamiento del presupuesto: media de las tres ocupaciones. Deja de
## premiar en cuanto se llena, y no puede pasar de 1 porque lo que se pasa ni
## siquiera entra en la búsqueda.
static func budget_term(counts: Array[int], request: Request) -> float:
	var spent_values := spend(counts, request)
	var total: float = 0.0
	var rows: int = 0
	for index: int in spent_values.size():
		var budget := request.budgets[index]
		if budget <= 0.0:
			continue
		total += clampf(spent_values[index] / budget, 0.0, 1.0)
		rows += 1
	return 0.0 if rows == 0 else total / float(rows)


## Ajuste a la forma del mapa: cuánto se parece el reparto de la composición
## al que pide la geometría de la zona.
static func map_fit_term(counts: Array[int], request: Request) -> float:
	var total: int = 0
	for value: int in counts:
		total += value
	if total <= 0:
		return 0.0
	var distance: float = 0.0
	for index: int in counts.size():
		distance += absf(float(counts[index]) / float(total) - request.affinity_shares[index])
	return clampf(1.0 - distance * 0.5, 0.0, 1.0)


## Consumo de los tres presupuestos.
static func spend(counts: Array[int], request: Request) -> Array[float]:
	return [
		_row_cost(request.damage_coefficients, counts),
		_row_cost(request.health_coefficients, counts),
		_row_cost(request.speed_coefficients, counts),
	]


static func _row_cost(coefficients: Array[float], counts: Array[int]) -> float:
	var total: float = 0.0
	for index: int in counts.size():
		total += coefficients[index] * float(counts[index])
	return total


## Clave de desempate: función determinista de la composición y de la semilla
## de la partida. Dos composiciones con la misma puntuación se ordenan
## siempre igual dentro de una partida, y distinto entre partidas — nunca por
## el orden en que las escupió el bucle.
static func tie_break_key(counts: Array[int], seed_value: int) -> int:
	# FNV-1a de 64 bits sobre la semilla y los conteos.
	var hash_value: int = 0x00000100000001B3
	hash_value = _mix(hash_value, seed_value)
	for value: int in counts:
		hash_value = _mix(hash_value, value)
	return hash_value & 0x7FFFFFFFFFFFFFFF


static func _mix(hash_value: int, value: int) -> int:
	var result := hash_value
	for shift: int in [0, 8, 16, 24, 32, 40, 48, 56]:
		result ^= (value >> shift) & 0xFF
		result = (result * 0x100000001B3) & 0x7FFFFFFFFFFFFFFF
	return result


## ¿Cabe este prefijo en los tres presupuestos? Con coeficientes positivos,
## si un prefijo no cabe, ningún superconjunto suyo cabrá: por eso vale para
## podar.
static func _prefix_fits(request: Request, counts: Array[int]) -> bool:
	var spent_values := spend(counts, request)
	for index: int in spent_values.size():
		if spent_values[index] > request.budgets[index]:
			return false
	return true


static func _sort_candidates(candidates: Array[Candidate], seed_value: int) -> void:
	candidates.sort_custom(func(a: Candidate, b: Candidate) -> bool:
		if absf(a.score - b.score) > SCORE_EPSILON:
			return a.score > b.score
		return tie_break_key(a.counts, seed_value) < tie_break_key(b.counts, seed_value)
	)
