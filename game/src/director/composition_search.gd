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
	## Coeficientes de coste por arquetipo, una fila por presupuesto. Los
	## rellena `EncounterComposer` desde `DirectorProfile` (ADR-005): aquí no
	## hay valores por defecto de balanceo, solo ceros inertes.
	var damage_coefficients: Array[float] = [0.0, 0.0, 0.0]
	var health_coefficients: Array[float] = [0.0, 0.0, 0.0]
	var speed_coefficients: Array[float] = [0.0, 0.0, 0.0]
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

	## Pesos de los cinco términos. Son balanceo: viven en `DirectorProfile` y
	## los rellena `apply_profile`. En crudo valen cero para que nadie los
	## herede por accidente de un valor inventado aquí.
	var weight_target: float = 0.0
	var weight_variety: float = 0.0
	var weight_novelty: float = 0.0
	var weight_budget: float = 0.0
	var weight_map_fit: float = 0.0

	func archetype_count() -> int:
		return lower.size()

	## Copia del perfil todo lo que es balanceo: los pesos de la puntuación y
	## los coeficientes de coste de los tres presupuestos. Lo demás (cotas,
	## presupuestos, objetivo, afinidades) lo calcula el composer por zona.
	func apply_profile(profile: DirectorProfile) -> void:
		weight_target = profile.weight_target
		weight_variety = profile.weight_variety
		weight_novelty = profile.weight_novelty
		weight_budget = profile.weight_budget
		weight_map_fit = profile.weight_map_fit
		damage_coefficients = _floats_of(profile.damage_coefficients)
		health_coefficients = _floats_of(profile.health_coefficients)
		speed_coefficients = _floats_of(profile.speed_coefficients)

	## Suma de los cinco pesos. Si es cero, la puntuación no significa nada y
	## `run` lo dice en vez de devolver ceros con cara de resultado.
	func weight_sum() -> float:
		return weight_target + weight_variety + weight_novelty + weight_budget + weight_map_fit

	static func _floats_of(values: PackedFloat32Array) -> Array[float]:
		var out: Array[float] = []
		for index: int in 3:
			out.append(values[index] if index < values.size() else 0.0)
		return out


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
## Dos decisiones que hacen que esto sea barato de verdad:
##
## 1. [b]Poda analítica[/b]: como los tres costes crecen linealmente con cada
##    enemigo, para un prefijo (x0, x1) dado se DESPEJA el mayor x2 que cabe
##    en los tres presupuestos, y el bucle interior recorre solo el tramo
##    viable. No se enumera para descartar: no se enumera lo inviable.
## 2. [b]El cuerpo del bucle está en línea[/b], sin llamadas ni objetos
##    intermedios. En GDScript interpretado, cinco llamadas por candidato
##    cuestan más que toda la aritmética junta.
##
## Esa segunda decisión duplica la función de puntuación, así que hay una
## prueba (`test_composition_search.gd`) que compara candidato a candidato
## este bucle contra `evaluate`, que es la implementación de referencia. Si
## alguien toca una y no la otra, salta.
static func run(request: Request) -> Result:
	var started := Time.get_ticks_usec()
	var result := Result.new()
	if request.archetype_count() != 3:
		push_error("CompositionSearch: se esperan 3 arquetipos, llegaron %d."
			% request.archetype_count())
		return result

	var damage := request.damage_coefficients
	var health := request.health_coefficients
	var speed := request.speed_coefficients
	var budget_damage := request.budgets[0]
	var budget_health := request.budgets[1]
	var budget_speed := request.budgets[2]

	# Todo lo que no cambia dentro del bucle se calcula una vez.
	var target_0 := request.target_counts[0]
	var target_1 := request.target_counts[1]
	var target_2 := request.target_counts[2]
	var target_scale := 2.0 * float(maxi(request.max_total, 1))
	var affinity_0 := request.affinity_shares[0]
	var affinity_1 := request.affinity_shares[1]
	var affinity_2 := request.affinity_shares[2]

	var available: int = 0
	for index: int in 3:
		if request.upper[index] > 0:
			available += 1
	var single_archetype := available <= 1
	var variety_scale := 0.0 if single_archetype else 1.0 / log(float(available))

	var previous_total: int = 0
	for value: int in request.previous_counts:
		previous_total += value
	var has_previous := previous_total > 0 and request.previous_counts.size() == 3
	var previous_inverse := 0.0 if not has_previous else 1.0 / float(previous_total)
	var previous_0 := 0.0 if not has_previous else float(request.previous_counts[0]) * previous_inverse
	var previous_1 := 0.0 if not has_previous else float(request.previous_counts[1]) * previous_inverse
	var previous_2 := 0.0 if not has_previous else float(request.previous_counts[2]) * previous_inverse

	var budget_rows: int = 0
	for index: int in 3:
		if request.budgets[index] > 0.0:
			budget_rows += 1
	var budget_divisor := 0.0 if budget_rows == 0 else 1.0 / float(budget_rows)
	var inverse_damage := 0.0 if budget_damage <= 0.0 else 1.0 / budget_damage
	var inverse_health := 0.0 if budget_health <= 0.0 else 1.0 / budget_health
	var inverse_speed := 0.0 if budget_speed <= 0.0 else 1.0 / budget_speed
	# Los pesos se leen del perfil UNA vez, aquí: dentro del bucle serían
	# cinco accesos a propiedad por candidato, y hay decenas de miles.
	var weight_target := request.weight_target
	var weight_variety := request.weight_variety
	var weight_novelty := request.weight_novelty
	var weight_budget := request.weight_budget
	var weight_map_fit := request.weight_map_fit
	var total_weight := request.weight_sum()
	if total_weight <= 0.0:
		push_error("CompositionSearch: los pesos suman cero; ¿falta apply_profile()?")
		return result
	var inverse_weight := 1.0 / total_weight

	var wanted := maxi(request.top_k, 1)
	var best_scores: Array[float] = []
	var best_counts: Array[Array] = []
	# Array reutilizado: `_offer` duplica al insertar, así que nadie se queda
	# con una referencia a este.
	var scratch: Array[int] = [0, 0, 0]

	for x0: int in range(request.lower[0], request.upper[0] + 1):
		var damage_0 := damage[0] * float(x0)
		var health_0 := health[0] * float(x0)
		var speed_0 := speed[0] * float(x0)
		if damage_0 > budget_damage or health_0 > budget_health or speed_0 > budget_speed:
			break
		if x0 > request.max_total:
			break
		for x1: int in range(request.lower[1], request.upper[1] + 1):
			result.combinations_visited += 1
			var damage_1 := damage_0 + damage[1] * float(x1)
			var health_1 := health_0 + health[1] * float(x1)
			var speed_1 := speed_0 + speed[1] * float(x1)
			if damage_1 > budget_damage or health_1 > budget_health or speed_1 > budget_speed:
				break
			if x0 + x1 > request.max_total:
				break

			# Mayor x2 que cabe: se despeja de cada presupuesto y del tope.
			var limit := request.upper[2]
			limit = mini(limit, _limit_from(budget_damage - damage_1, damage[2]))
			limit = mini(limit, _limit_from(budget_health - health_1, health[2]))
			limit = mini(limit, _limit_from(budget_speed - speed_1, speed[2]))
			limit = mini(limit, request.max_total - x0 - x1)

			var deviation_prefix := absf(float(x0) - target_0) + absf(float(x1) - target_1)
			for x2: int in range(request.lower[2], limit + 1):
				result.combinations_visited += 1
				result.feasible_count += 1
				if result.combinations_visited >= MAX_COMBINATIONS:
					result.truncated = true
					break

				var total := x0 + x1 + x2
				# --- objetivo ---
				var deviation := deviation_prefix + absf(float(x2) - target_2)
				var term_target := clampf(1.0 - deviation / target_scale, 0.0, 1.0)
				# --- variedad, novedad y forma (todas sobre el reparto) ---
				var term_variety := 0.0
				var term_novelty := 1.0
				var term_fit := 0.0
				if total > 0:
					var inverse := 1.0 / float(total)
					var share_0 := float(x0) * inverse
					var share_1 := float(x1) * inverse
					var share_2 := float(x2) * inverse
					if single_archetype:
						term_variety = 1.0
					else:
						var entropy := 0.0
						if x0 > 0:
							entropy -= share_0 * log(share_0)
						if x1 > 0:
							entropy -= share_1 * log(share_1)
						if x2 > 0:
							entropy -= share_2 * log(share_2)
						term_variety = clampf(entropy * variety_scale, 0.0, 1.0)
					term_fit = clampf(1.0 - 0.5 * (
						absf(share_0 - affinity_0)
						+ absf(share_1 - affinity_1)
						+ absf(share_2 - affinity_2)
					), 0.0, 1.0)
					if has_previous:
						term_novelty = clampf(0.5 * (
							absf(share_0 - previous_0)
							+ absf(share_1 - previous_1)
							+ absf(share_2 - previous_2)
						), 0.0, 1.0)
				# --- presupuesto ---
				var spent_damage := damage_1 + damage[2] * float(x2)
				var spent_health := health_1 + health[2] * float(x2)
				var spent_speed := speed_1 + speed[2] * float(x2)
				var occupancy := 0.0
				if inverse_damage > 0.0:
					occupancy += clampf(spent_damage * inverse_damage, 0.0, 1.0)
				if inverse_health > 0.0:
					occupancy += clampf(spent_health * inverse_health, 0.0, 1.0)
				if inverse_speed > 0.0:
					occupancy += clampf(spent_speed * inverse_speed, 0.0, 1.0)
				var term_budget := occupancy * budget_divisor

				var score := inverse_weight * (
					weight_target * term_target
					+ weight_variety * term_variety
					+ weight_novelty * term_novelty
					+ weight_budget * term_budget
					+ weight_map_fit * term_fit
				)
				scratch[0] = x0
				scratch[1] = x1
				scratch[2] = x2
				_offer(best_scores, best_counts, score, scratch, wanted, request.seed)
			if result.truncated:
				break
		if result.truncated:
			break

	for index: int in best_counts.size():
		var counts: Array[int] = best_counts[index]
		result.ranked.append(evaluate(counts, request))
	if not result.ranked.is_empty():
		result.best = result.ranked[0]
	result.elapsed_usec = Time.get_ticks_usec() - started
	return result


## Mayor número entero de enemigos que caben en lo que queda de presupuesto.
static func _limit_from(remaining: float, coefficient: float) -> int:
	if coefficient <= 0.0:
		return MAX_COMBINATIONS
	if remaining < 0.0:
		return -1
	return floori(remaining / coefficient + 0.000000001)


## Inserta una composición en el ranking parcial si se lo gana.
static func _offer(
	scores: Array[float],
	counts_list: Array[Array],
	score: float,
	counts: Array[int],
	wanted: int,
	seed_value: int
) -> void:
	if scores.size() >= wanted:
		var last: Array[int] = counts_list[scores.size() - 1]
		if not _is_better(score, counts, scores[scores.size() - 1], last, seed_value):
			return
	var position := scores.size()
	for index: int in scores.size():
		var other: Array[int] = counts_list[index]
		if _is_better(score, counts, scores[index], other, seed_value):
			position = index
			break
	scores.insert(position, score)
	counts_list.insert(position, counts.duplicate())
	while scores.size() > wanted:
		scores.remove_at(scores.size() - 1)
		counts_list.remove_at(counts_list.size() - 1)


## Orden TOTAL y determinista: primero la puntuación redondeada a la
## precisión de `SCORE_EPSILON` (para que dos puntuaciones indistinguibles no
## dependan del ruido de coma flotante), y el empate lo rompe una función de
## la semilla de la partida — nunca el orden del bucle.
static func _is_better(
	score_a: float,
	counts_a: Array[int],
	score_b: float,
	counts_b: Array[int],
	seed_value: int
) -> bool:
	var rank_a := _rank(score_a)
	var rank_b := _rank(score_b)
	if rank_a != rank_b:
		return rank_a > rank_b
	return tie_break_key(counts_a, seed_value) < tie_break_key(counts_b, seed_value)


static func _rank(score: float) -> int:
	return roundi(score / SCORE_EPSILON)


## Puntúa una composición y devuelve su desglose. Se usa para materializar
## las ganadoras y en los tests; el bucle caliente la lleva en línea.
static func evaluate(counts: Array[int], request: Request) -> Candidate:
	var candidate := Candidate.new()
	candidate.counts = counts.duplicate()
	candidate.spent = spend(counts, request)
	candidate.terms = score_terms(counts, request)

	var weights: Dictionary[StringName, float] = {
		TERM_TARGET: request.weight_target,
		TERM_VARIETY: request.weight_variety,
		TERM_NOVELTY: request.weight_novelty,
		TERM_BUDGET: request.weight_budget,
		TERM_MAP_FIT: request.weight_map_fit,
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
	var total := counts[0] + counts[1] + counts[2]
	var spent_values := spend(counts, request)
	return {
		TERM_TARGET: _target_term(counts, request),
		TERM_VARIETY: _variety_term(counts, total, request),
		TERM_NOVELTY: _novelty_term(counts, total, request),
		TERM_BUDGET: _budget_term(spent_values[0], spent_values[1], spent_values[2], request),
		TERM_MAP_FIT: _map_fit_term(counts, total, request),
	}


## Cercanía a la composición objetivo de la planta.
static func target_term(counts: Array[int], request: Request) -> float:
	return _target_term(counts, request)


## VARIEDAD: entropía de Shannon normalizada. Vale 1 cuando la mezcla está
## repartida entre todos los arquetipos disponibles y 0 cuando son todos del
## mismo tipo. Es el término que hace imposible la degeneración de 2012, y es
## justo el que NO cabe en una función objetivo lineal: la entropía no es
## lineal en los conteos, así que ningún Simplex puede perseguirla.
static func variety_term(counts: Array[int], request: Request) -> float:
	return _variety_term(counts, counts[0] + counts[1] + counts[2], request)


## NOVEDAD: distancia a la composición anterior, en reparto. 1 = no se
## parece en nada; 0 = la misma mezcla otra vez.
static func novelty_term(counts: Array[int], request: Request) -> float:
	return _novelty_term(counts, counts[0] + counts[1] + counts[2], request)


## Aprovechamiento del presupuesto: media de las tres ocupaciones. Penaliza
## dejar amenaza sin gastar; no puede pasar de 1 porque lo que se pasa del
## presupuesto ni siquiera entra en la búsqueda.
static func budget_term(counts: Array[int], request: Request) -> float:
	var spent_values := spend(counts, request)
	return _budget_term(spent_values[0], spent_values[1], spent_values[2], request)


## Ajuste a la forma del mapa: cuánto se parece el reparto de la composición
## al que pide la geometría de la zona.
static func map_fit_term(counts: Array[int], request: Request) -> float:
	return _map_fit_term(counts, counts[0] + counts[1] + counts[2], request)


static func _target_term(counts: Array[int], request: Request) -> float:
	var deviation: float = 0.0
	for index: int in counts.size():
		deviation += absf(float(counts[index]) - request.target_counts[index])
	var scale := 2.0 * float(maxi(request.max_total, 1))
	return clampf(1.0 - deviation / scale, 0.0, 1.0)


static func _variety_term(counts: Array[int], total: int, request: Request) -> float:
	if total <= 0:
		return 0.0
	var available: int = 0
	for index: int in counts.size():
		if request.upper[index] > 0:
			available += 1
	if available <= 1:
		# Con un solo arquetipo disponible, la variedad no es una decisión:
		# no se puede premiar ni castigar por algo que no se puede elegir.
		return 1.0
	var entropy: float = 0.0
	var inverse := 1.0 / float(total)
	for value: int in counts:
		if value <= 0:
			continue
		var share := float(value) * inverse
		entropy -= share * log(share)
	return clampf(entropy / log(float(available)), 0.0, 1.0)


static func _novelty_term(counts: Array[int], total: int, request: Request) -> float:
	if request.previous_counts.is_empty() or total <= 0:
		return 1.0
	var previous_total: int = 0
	for value: int in request.previous_counts:
		previous_total += value
	if previous_total <= 0:
		return 1.0
	var distance: float = 0.0
	var inverse := 1.0 / float(total)
	var previous_inverse := 1.0 / float(previous_total)
	for index: int in counts.size():
		distance += absf(
			float(counts[index]) * inverse - float(request.previous_counts[index]) * previous_inverse
		)
	return clampf(distance * 0.5, 0.0, 1.0)


static func _budget_term(
	spent_damage: float,
	spent_health: float,
	spent_speed: float,
	request: Request
) -> float:
	var total: float = 0.0
	var rows: int = 0
	var spent_values: Array[float] = [spent_damage, spent_health, spent_speed]
	for index: int in 3:
		var budget := request.budgets[index]
		if budget <= 0.0:
			continue
		total += clampf(spent_values[index] / budget, 0.0, 1.0)
		rows += 1
	return 0.0 if rows == 0 else total / float(rows)


static func _map_fit_term(counts: Array[int], total: int, request: Request) -> float:
	if total <= 0:
		return 0.0
	var distance: float = 0.0
	var inverse := 1.0 / float(total)
	for index: int in counts.size():
		distance += absf(float(counts[index]) * inverse - request.affinity_shares[index])
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
