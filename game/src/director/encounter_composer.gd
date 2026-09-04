class_name EncounterComposer
extends RefCounted
## Decide QUÉ enemigos aparecen en una zona. Es la pieza que conecta el
## remake con el proyecto universitario de 2012, y la que corrige su error.
##
## [b]La formulación original y por qué está rota[/b]
##
## `legacy/trunk/Optimization/lib/Optimization.cc:90-109` planteaba:
## [codeblock]
## MaxEnemies = ln((area / 250) * dificultad) * 10
## Max z = x1 + x2 + x3
## s.a. 60x1 + 100x2 + 120x3 <= (280/3) * MaxEnemies   (daño)
##      45x1 +  50x2 +  65x3 <= (155/3) * MaxEnemies   (vida)
##      60x1 +  45x2 +  35x3 <= (140/3) * MaxEnemies   (velocidad)
## [/codeblock]
##
## El algoritmo era correcto. El problema es el OBJETIVO: `max x1+x2+x3` solo
## cuenta cabezas, así que es INDIFERENTE a la composición. Para
## MaxEnemies = 30 hay 28 soluciones enteras óptimas distintas, todas con
## Z = 29: desde (10, 11, 8), perfectamente variada, hasta (3, 26, 0), que es
## 26 Milicianos y ni un Veterano. Como el solucionador es determinista,
## siempre devolvía la misma —y era una de las sesgadas—, planta tras planta.
## El original no producía variedad: producía un artefacto del orden de
## pivotaje. `test_composer_degeneracy.gd` lo demuestra con números.
##
## [b]Qué hace el remake[/b]
##
## Lo que se quiere optimizar —variedad de la mezcla, novedad frente a la
## zona anterior, ajuste a la geometría— NO ES LINEAL, y un programa lineal
## solo admite objetivos lineales. Por eso el mecanismo por defecto es
## [CompositionSearch]: enumerar el espacio entero (unos pocos miles de
## combinaciones) y puntuarlo con términos con nombre y peso.
##
## Lo que SÍ se conserva del original, porque es lo que describía bien el
## problema, son los tres presupuestos y sus coeficientes: siguen siendo las
## restricciones duras, ahora moduladas por la forma del mapa.
##
## [b]A cada arquetipo lo limita un presupuesto distinto[/b]
##
## No es casualidad de los coeficientes de 2012, es lo que hace que las tres
## restricciones signifiquen algo, y quien rebalancee dentro de un año no lo
## va a deducir solo:
##
## | Arquetipo | Daño | Vida | Velocidad | Le limita |
## |---|---|---|---|---|
## | Sicario    |  60 | 45 | [b]60[/b]  | la VELOCIDAD: es el más caro de la tercera fila |
## | Miliciano  | 100 | 50 | 45         | ninguno en particular: por eso es el relleno |
## | Veterano   | [b]120[/b] | 65 | 35 | el DAÑO: es el más caro de la primera fila |
##
## La fila de velocidad va al revés que las otras dos (60/45/35, descendente),
## así que una misma zona sostiene casi los mismos Sicarios que Veteranos —29
## y 29 con 2 000 m²— aunque el Veterano cueste el doble en daño. Subir el
## presupuesto de velocidad abre la puerta a más Sicarios; subir el de daño, a
## más Veteranos. Fijado en `test_each_archetype_is_limited_by_a_different_budget`.
##
## Los tres modos conviven a propósito (ver [enum Mode]): el Simplex se queda
## como pieza histórica y como evidencia de por qué se sustituyó.

## Orden canónico de arquetipos. Es x1, x2, x3 de la formulación original:
## `e_enemy1`, `e_enemy2`, `e_enemy3` del legacy.
const ARCHETYPE_ORDER: Array[StringName] = [
	&"enemy_thug",        # Sicario:    frágil, rápido, numeroso
	&"enemy_militiaman",  # Miliciano:  equilibrado, usa cobertura
	&"enemy_veteran",     # Veterano:   duro, suprime a distancia
]

## Mecanismo con el que se decide la composición.
enum Mode {
	## Enumeración exhaustiva del espacio + puntuación por términos.
	## Es el mecanismo por defecto: admite objetivos no lineales (variedad,
	## novedad) y devuelve el desglose que hace balanceable el sistema.
	SEARCH,
	## Simplex exacto con la formulación de 2012 (`max x1+x2+x3`). Se
	## conserva para poder comparar y para demostrar su degeneración.
	LEGACY_SIMPLEX,
	## Simplex exacto con objetivo de composición (minimizar desviación
	## respecto a un objetivo, con cotas por arquetipo). Es el arreglo
	## LINEAL del problema de 2012: mejor que el original, pero incapaz de
	## expresar variedad o novedad. Se conserva como paso intermedio
	## documentado.
	GOAL_SIMPLEX,
}

# ---- Constantes de forma del mapa ----
# TODO(arquitecto): estas nueve siguen en código porque no tienen sitio en
# DirectorProfile todavía. Son las referencias con las que se normaliza la
# geometría de una zona y los pesos con los que cada arquetipo se lleva bien
# con ella. Propuesta: un grupo "Afinidad con la geometría".

## Referencias de normalización de la forma del mapa. Una zona con líneas de
## tiro de 30 m o más se considera completamente diáfana; una con 6 puntos de
## cobertura por 100 m², completamente parapetada.
const REFERENCE_LINE_OF_SIGHT_M: float = 30.0
const REFERENCE_COVER_PER_100M2: float = 6.0
const REFERENCE_ENTRY_COUNT: float = 4.0
## Pesos de afinidad de cada arquetipo con la geometría.
const THUG_TIGHTNESS_WEIGHT: float = 0.5
const THUG_ENTRY_WEIGHT: float = 0.5
const MILITIA_COVER_WEIGHT: float = 0.5
const MILITIA_MIDRANGE_WEIGHT: float = 0.5
const VETERAN_OPENNESS_WEIGHT: float = 0.7
const VETERAN_COVER_WEIGHT: float = 0.3

## Peso del desempate "más enemigos" del objetivo lineal. NO es balanceo: es
## el epsilon que garantiza que el desempate nunca domina a la desviación.
const COUNT_TIE_BREAK_NUMERATOR: int = 1
const COUNT_TIE_BREAK_DENOMINATOR: int = 1000

## De dónde salió la composición devuelta.
enum Source {
	## La decidió el mecanismo configurado.
	SOLVER,
	## No había ninguna composición viable: reparto uniforme, como el
	## `E1=E2=E3=MaxEnemies/3` del legacy (`Optimization.cc:126-128`).
	FALLBACK_UNIFORM,
	## MaxEnemies <= 0: zona sin enemigos. El legacy hacía lo mismo cuando
	## `(area/250)*dif < 1` daba logaritmo negativo.
	EMPTY,
}

## Resultado de componer un encuentro.
class Composition:
	extends RefCounted

	## Número de enemigos por arquetipo, en el orden de `ARCHETYPE_ORDER`.
	var counts: Array[int] = [0, 0, 0]
	## MaxEnemies del que se partió (ya entero).
	var max_enemies: int = 0
	## Composición objetivo perseguida, en enemigos (fraccionaria).
	var target_counts: Array[float] = [0.0, 0.0, 0.0]
	## Presupuestos efectivos: daño, vida, velocidad.
	var budgets: Array[float] = [0.0, 0.0, 0.0]
	## Consumo real de cada presupuesto.
	var spent: Array[float] = [0.0, 0.0, 0.0]
	var effective_difficulty: float = 0.0
	var source: Source = Source.EMPTY
	var mode: Mode = Mode.SEARCH
	## Puntuación total y desglose por término (solo en `SEARCH`).
	var score: float = 0.0
	var score_terms: Dictionary[StringName, float] = {}
	## Las mejores composiciones con su desglose (solo en `SEARCH`).
	var ranked: Array[CompositionSearch.Candidate] = []
	## Diagnóstico de la búsqueda.
	var combinations_visited: int = 0
	var feasible_count: int = 0
	var search_usec: int = 0
	## Diagnóstico del Simplex, cuando se usó.
	var solver_status: IntegerSimplex.Status = IntegerSimplex.Status.NOT_SOLVED
	var nodes_explored: int = 0

	func total() -> int:
		return counts[0] + counts[1] + counts[2]

	## Fracción del encuentro que representa un arquetipo, 0..1.
	func share(index: int) -> float:
		var sum := total()
		return 0.0 if sum == 0 else float(counts[index]) / float(sum)

	## Fracción del arquetipo más numeroso. Es la medida de degeneración:
	## 1.0 significa "todos los enemigos son del mismo tipo".
	func dominant_share() -> float:
		var sum := total()
		if sum == 0:
			return 0.0
		var biggest: int = 0
		for value: int in counts:
			biggest = maxi(biggest, value)
		return float(biggest) / float(sum)

	func count_for(archetype: StringName) -> int:
		var index := EncounterComposer.ARCHETYPE_ORDER.find(archetype)
		return 0 if index < 0 else counts[index]

	## Lista plana de arquetipos a generar, en orden canónico. Es lo que
	## consume la curva de tensión para repartir en oleadas.
	func to_archetype_list() -> Array[StringName]:
		var out: Array[StringName] = []
		for index: int in counts.size():
			for _i: int in counts[index]:
				out.append(EncounterComposer.ARCHETYPE_ORDER[index])
		return out

	func describe() -> String:
		return "%d enemigos [Sicario %d / Miliciano %d / Veterano %d] · N=%d · %s · %s" % [
			total(), counts[0], counts[1], counts[2], max_enemies,
			Mode.keys()[int(mode)], Source.keys()[int(source)],
		]


## Mecanismo con el que se compone. `SEARCH` por defecto.
var mode: Mode = Mode.SEARCH
## Cuántas composiciones ordenadas se devuelven en `ranked`.
var top_k: int = 10
## Tope de nodos de ramificación y acotación (modos con Simplex).
var max_nodes: int = IntegerSimplex.DEFAULT_MAX_NODES

var _profile: DirectorProfile = null
## Composición anterior, para el término de novedad.
var _previous_counts: Array[int] = []


func _init(profile: DirectorProfile = null) -> void:
	_profile = profile if profile != null else Balance.director_profile()
	if _profile == null:
		_profile = DirectorProfile.new()


func profile() -> DirectorProfile:
	return _profile


## Fija la composición contra la que se mide la novedad. La pone el director
## al cambiar de zona; también sirve para reproducir un caso en un test.
func set_previous_counts(counts: Array[int]) -> void:
	_previous_counts = counts.duplicate()


func previous_counts() -> Array[int]:
	return _previous_counts


static func mode_name(value: Mode) -> String:
	return Mode.keys()[int(value)]


## Traduce el argumento de consola a modo.
static func mode_from_string(text: String) -> Mode:
	match text.strip_edges().to_lower():
		"search", "busqueda", "búsqueda":
			return Mode.SEARCH
		"legacy", "simplex", "legacy_simplex":
			return Mode.LEGACY_SIMPLEX
		"goal", "objetivo", "goal_simplex":
			return Mode.GOAL_SIMPLEX
		_:
			return Mode.SEARCH


# ---- Composición ----

func compose(context: EncounterContext) -> Composition:
	var result := Composition.new()
	result.mode = mode
	result.effective_difficulty = context.effective_difficulty()
	result.max_enemies = max_enemies(context)
	if result.max_enemies <= 0:
		result.source = Source.EMPTY
		return result

	var budgets := _budgets(context, result.max_enemies)
	result.budgets = Rational.array_to_floats(budgets)
	var allowed := _allowed_flags(context)
	var lower := _lower_bounds(result.max_enemies, allowed)
	var upper := _upper_bounds(result.max_enemies, allowed)

	if mode == Mode.SEARCH:
		_compose_by_search(context, result, budgets, lower, upper, allowed)
	else:
		_compose_by_simplex(context, result, budgets, lower, upper)

	if result.counts.is_empty() or (result.total() == 0 and result.max_enemies > 0):
		result.counts = _uniform_fallback(result.max_enemies, allowed, budgets)
		result.source = Source.FALLBACK_UNIFORM
	result.spent = _spend(result.counts)
	_previous_counts = result.counts.duplicate()
	return result


## Las `k` mejores composiciones con su desglose. Solo tiene sentido en
## `SEARCH`; en los modos con Simplex devuelve la única solución.
func compose_ranked(context: EncounterContext, k: int = 10) -> Array[CompositionSearch.Candidate]:
	var previous_k := top_k
	top_k = maxi(k, 1)
	var result := compose(context)
	top_k = previous_k
	if not result.ranked.is_empty():
		return result.ranked
	var single := CompositionSearch.Candidate.new()
	single.counts = result.counts.duplicate()
	single.spent = result.spent.duplicate()
	return [single]


## MaxEnemies = ln((área / divisor) * dificultad_efectiva) * multiplicador.
## Réplica exacta de `Optimization.cc:91`, con dos diferencias: el área llega
## en m² y se convierte a las unidades del legacy (miles de px²) con el mismo
## factor que usa el resto del remake, y la dificultad ya viene multiplicada
## por el modelo de habilidad.
func max_enemies(context: EncounterContext) -> int:
	var area_units := area_in_legacy_units(context.navigable_area_m2)
	var divisor := maxf(_profile.max_enemies_area_divisor, 0.0001)
	var argument := (area_units / divisor) * context.effective_difficulty()
	if argument <= 1.0:
		# El legacy dejaba MaxEnemies negativo y CalcularEnemigos no hacía
		# nada (`Optimization.cc:113`): misma consecuencia, dicha en claro.
		return 0
	return maxi(int(log(argument) * _profile.max_enemies_multiplier), 0)


## Convierte m² a las unidades de área del legacy (miles de px²), usando el
## único factor de conversión del proyecto (`Balance.LEGACY_TO_METERS`).
static func area_in_legacy_units(area_m2: float) -> float:
	var pixels_per_meter := 1.0 / Balance.LEGACY_TO_METERS
	return area_m2 * pixels_per_meter * pixels_per_meter / 1000.0


## Composición objetivo DE LA PLANTA: reparto uniforme entre los arquetipos
## que admite, sin mirar la geometría. En `SEARCH` la geometría no se mezcla
## aquí sino que puntúa aparte, para que los dos términos se puedan depurar
## por separado.
func base_target_shares(context: EncounterContext) -> Array[float]:
	var allowed := _allowed_flags(context)
	var count := _allowed_count(allowed)
	var shares: Array[float] = [0.0, 0.0, 0.0]
	if count == 0:
		return shares
	for index: int in ARCHETYPE_ORDER.size():
		shares[index] = 1.0 / float(count) if allowed[index] else 0.0
	return shares


## Reparto objetivo inclinado por la forma del mapa. Lo usa `GOAL_SIMPLEX`,
## que no puede puntuar la geometría aparte porque su objetivo es lineal.
func target_shares(context: EncounterContext) -> Array[float]:
	var allowed := _allowed_flags(context)
	var allowed_count := _allowed_count(allowed)
	var shares: Array[float] = [0.0, 0.0, 0.0]
	if allowed_count == 0:
		return shares

	var affinities := shape_affinities(context)
	var raw: Array[float] = [0.0, 0.0, 0.0]
	var total: float = 0.0
	for index: int in ARCHETYPE_ORDER.size():
		if not allowed[index]:
			continue
		# Factor en [1 − ganancia, 1 + ganancia]: la geometría inclina el
		# reparto, no lo dicta.
		var gain := _profile.shape_gain
		var factor := 1.0 - gain + 2.0 * gain * affinities[index]
		raw[index] = factor / float(allowed_count)
		total += raw[index]
	if total <= 0.0:
		return shares
	for index: int in ARCHETYPE_ORDER.size():
		shares[index] = raw[index] / total
	return shares


## Afinidad de cada arquetipo con la forma del mapa, 0..1.
##
## * Sicario: pasillo estrecho y muchos accesos. Es frágil y rápido: solo
##   funciona si puede llegar encima y en tromba.
## * Miliciano: cobertura y distancias medias. Es el que flanquea.
## * Veterano: líneas de tiro largas y cobertura desde la que suprimir.
func shape_affinities(context: EncounterContext) -> Array[float]:
	var openness := clampf(context.mean_line_of_sight_m / REFERENCE_LINE_OF_SIGHT_M, 0.0, 1.0)
	var cover := clampf(context.cover_points_per_100m2 / REFERENCE_COVER_PER_100M2, 0.0, 1.0)
	var entries := clampf(float(context.entry_count) / REFERENCE_ENTRY_COUNT, 0.0, 1.0)
	var midrange := 1.0 - absf(openness - 0.5) * 2.0
	return [
		clampf(THUG_TIGHTNESS_WEIGHT * (1.0 - openness) + THUG_ENTRY_WEIGHT * entries, 0.0, 1.0),
		clampf(MILITIA_COVER_WEIGHT * cover + MILITIA_MIDRANGE_WEIGHT * midrange, 0.0, 1.0),
		clampf(VETERAN_OPENNESS_WEIGHT * openness + VETERAN_COVER_WEIGHT * cover, 0.0, 1.0),
	]


## Reparto que pide la geometría, normalizado a 1 sobre los arquetipos
## permitidos. Es el objetivo del término `forma` de la búsqueda.
func affinity_shares(context: EncounterContext) -> Array[float]:
	var allowed := _allowed_flags(context)
	var affinities := shape_affinities(context)
	var shares: Array[float] = [0.0, 0.0, 0.0]
	var total: float = 0.0
	for index: int in ARCHETYPE_ORDER.size():
		if allowed[index]:
			total += affinities[index]
	if total <= 0.0:
		return base_target_shares(context)
	for index: int in ARCHETYPE_ORDER.size():
		shares[index] = affinities[index] / total if allowed[index] else 0.0
	return shares


## Presupuestos efectivos (daño, vida, velocidad) para `enemy_total` enemigos.
func budgets_for(context: EncounterContext, enemy_total: int) -> Array[float]:
	return Rational.array_to_floats(_budgets(context, enemy_total))


## Cotas por arquetipo para un encuentro de `enemy_total` enemigos.
func bounds_for(context: EncounterContext, enemy_total: int) -> Array[Array]:
	var allowed := _allowed_flags(context)
	return [
		_to_int_array(_lower_bounds(enemy_total, allowed)),
		_to_int_array(_upper_bounds(enemy_total, allowed)),
	]


# ---- Mecanismo 1: búsqueda exhaustiva ----

func _compose_by_search(
	context: EncounterContext,
	result: Composition,
	budgets: Array[Rational],
	lower: PackedInt64Array,
	upper: PackedInt64Array,
	_allowed: Array[bool]
) -> void:
	var request := CompositionSearch.Request.new()
	# Pesos y coeficientes salen del perfil; cotas, presupuestos y objetivo
	# los calcula esta clase para cada zona.
	request.apply_profile(_profile)
	request.lower = _to_int_array(lower)
	request.upper = _to_int_array(upper)
	request.budgets = Rational.array_to_floats(budgets)
	request.affinity_shares = affinity_shares(context)
	request.previous_counts = _previous_counts.duplicate()
	request.max_total = result.max_enemies
	request.seed = context.seed
	request.top_k = top_k

	var base_shares := base_target_shares(context)
	var targets: Array[float] = []
	for index: int in ARCHETYPE_ORDER.size():
		targets.append(base_shares[index] * float(result.max_enemies))
	request.target_counts = targets
	result.target_counts = targets

	var search := CompositionSearch.run(request)
	result.combinations_visited = search.combinations_visited
	result.feasible_count = search.feasible_count
	result.search_usec = search.elapsed_usec
	result.ranked = search.ranked
	if not search.has_solution():
		result.counts = []
		return
	result.counts = search.best.counts.duplicate()
	result.score = search.best.score
	result.score_terms = search.best.terms.duplicate()
	result.source = Source.SOLVER


# ---- Mecanismo 2: Simplex exacto (pieza histórica) ----

func _compose_by_simplex(
	context: EncounterContext,
	result: Composition,
	budgets: Array[Rational],
	lower: PackedInt64Array,
	upper: PackedInt64Array
) -> void:
	var problem: IntegerSimplex = null
	if mode == Mode.LEGACY_SIMPLEX:
		problem = _build_legacy_problem(budgets, upper)
	else:
		var shares := target_shares(context)
		var targets: Array[Rational] = []
		var target_floats: Array[float] = []
		for index: int in ARCHETYPE_ORDER.size():
			var value := shares[index] * float(result.max_enemies)
			target_floats.append(value)
			targets.append(Rational.from_float(value))
		result.target_counts = target_floats
		problem = _build_goal_problem(budgets, targets, lower, upper)
	problem.max_nodes = max_nodes

	result.solver_status = problem.solve()
	result.nodes_explored = problem.nodes_explored()
	if not problem.has_solution():
		result.counts = []
		return
	var values := problem.get_solution_ints()
	result.counts = [values[0], values[1], values[2]]
	result.source = Source.SOLVER


func _budgets(context: EncounterContext, enemy_total: int) -> Array[Rational]:
	var base: Array[float] = [
		_profile.damage_budget_per_enemy,
		_profile.health_budget_per_enemy,
		_profile.speed_budget_per_enemy,
	]
	if mode == Mode.LEGACY_SIMPLEX:
		# El legacy calculaba `(280/3)*MaxEnemies` con división ENTERA de C++
		# (93, 51, 46) y además truncaba el término independiente con `atoi`
		# (`Simplex.cc:193`). Se replica al pie de la letra.
		var out: Array[Rational] = []
		for index: int in base.size():
			out.append(Rational.from_int(int(floorf(base[index])) * enemy_total))
		return out

	# La geometría modula cuánta amenaza tolera la zona:
	# * Más cobertura -> el jugador tiene dónde parapetarse -> cabe más daño.
	# * Líneas de tiro largas -> puede batir a distancia -> cabe más vida.
	# * Más accesos -> más rutas que cubrir -> caben enemigos más móviles.
	var openness := clampf(context.mean_line_of_sight_m / REFERENCE_LINE_OF_SIGHT_M, 0.0, 1.0)
	var cover := clampf(context.cover_points_per_100m2 / REFERENCE_COVER_PER_100M2, 0.0, 1.0)
	var entries := clampf(float(context.entry_count) / REFERENCE_ENTRY_COUNT, 0.0, 1.0)
	var gain := _profile.budget_shape_gain
	var modulation: Array[float] = [
		1.0 + gain * (cover - 0.5) * 2.0,
		1.0 + gain * (openness - 0.5) * 2.0,
		1.0 + gain * (entries - 0.5) * 2.0,
	]
	var budgets: Array[Rational] = []
	for index: int in base.size():
		budgets.append(Rational.from_float(base[index] * modulation[index] * float(enemy_total)))
	return budgets


## Objetivo de composición con desviaciones, resuelto por Simplex entero.
## Variables: x1 x2 x3 | d1+ d1− | d2+ d2− | d3+ d3−.
func _build_goal_problem(
	budgets: Array[Rational],
	targets: Array[Rational],
	lower: PackedInt64Array,
	upper: PackedInt64Array
) -> IntegerSimplex:
	var archetypes := ARCHETYPE_ORDER.size()
	var variables := archetypes * 3
	var problem := IntegerSimplex.new(variables)

	var objective: Array[Rational] = []
	var epsilon := Rational.new(COUNT_TIE_BREAK_NUMERATOR, COUNT_TIE_BREAK_DENOMINATOR)
	for _index: int in archetypes:
		# Desempate: entre dos composiciones igual de buenas, la más poblada.
		# Es lo único que sobrevive del `max x1+x2+x3` original.
		objective.append(epsilon.negate())
	for _index: int in archetypes * 2:
		objective.append(Rational.one())
	problem.set_objective(objective, false)

	for row: int in archetypes:
		problem.add_constraint(_padded(_coefficients(row), variables),
			Simplex.Relation.LESS_EQUAL, budgets[row])

	for index: int in archetypes:
		# x_i − d_i+ + d_i− = objetivo_i
		var goal: Array[Rational] = []
		for column: int in variables:
			goal.append(Rational.zero())
		goal[index] = Rational.one()
		goal[archetypes + index * 2] = Rational.from_int(-1)
		goal[archetypes + index * 2 + 1] = Rational.one()
		problem.add_constraint(goal, Simplex.Relation.EQUAL, targets[index])
		problem.set_integer(archetypes + index * 2, false)
		problem.set_integer(archetypes + index * 2 + 1, false)
		problem.set_bounds(index, lower[index], upper[index])
	return problem


## Formulación de 2012, tal cual: `max x1 + x2 + x3` con los tres
## presupuestos y ninguna cota más allá de los arquetipos de la planta.
func _build_legacy_problem(budgets: Array[Rational], upper: PackedInt64Array) -> IntegerSimplex:
	var archetypes := ARCHETYPE_ORDER.size()
	var problem := IntegerSimplex.new(archetypes)
	problem.set_objective_ints([1, 1, 1], true)
	for row: int in archetypes:
		problem.add_constraint(_coefficients(row), Simplex.Relation.LESS_EQUAL, budgets[row])
	for index: int in archetypes:
		problem.set_bounds(index, 0, upper[index])
	return problem


## Coeficientes de la restricción `row`: 0 daño, 1 vida, 2 velocidad. Son los
## del original, conservados como DATO en `DirectorProfile`.
func _coefficients(row: int) -> Array[Rational]:
	var out: Array[Rational] = []
	for value: float in _coefficient_floats(row):
		out.append(Rational.from_float(value))
	return out


func _coefficient_floats(row: int) -> Array[float]:
	var source: PackedFloat32Array
	match row:
		0:
			source = _profile.damage_coefficients
		1:
			source = _profile.health_coefficients
		_:
			source = _profile.speed_coefficients
	var out: Array[float] = []
	for index: int in ARCHETYPE_ORDER.size():
		out.append(source[index] if index < source.size() else 0.0)
	return out


func _padded(values: Array[Rational], size: int) -> Array[Rational]:
	var out: Array[Rational] = values.duplicate()
	while out.size() < size:
		out.append(Rational.zero())
	return out


# ---- Cotas y reserva ----

func _allowed_flags(context: EncounterContext) -> Array[bool]:
	var flags: Array[bool] = [false, false, false]
	if context.allowed_archetypes.is_empty():
		# Sin lista, todo vale: es el comportamiento del legacy, que no tenía
		# el concepto de "reparto de enemigos por planta".
		return [true, true, true]
	for index: int in ARCHETYPE_ORDER.size():
		flags[index] = context.allowed_archetypes.has(ARCHETYPE_ORDER[index])
	return flags


func _allowed_count(allowed: Array[bool]) -> int:
	var count: int = 0
	for flag: bool in allowed:
		if flag:
			count += 1
	return count


func _lower_bounds(enemy_total: int, allowed: Array[bool]) -> PackedInt64Array:
	var bounds := PackedInt64Array()
	var share := minf(_profile.min_share_per_archetype, 1.0 / float(maxi(_allowed_count(allowed), 1)))
	for index: int in ARCHETYPE_ORDER.size():
		bounds.append(int(floorf(share * float(enemy_total))) if allowed[index] else 0)
	return bounds


func _upper_bounds(enemy_total: int, allowed: Array[bool]) -> PackedInt64Array:
	var bounds := PackedInt64Array()
	# Con un solo arquetipo permitido la cota máxima no puede ser una
	# fracción: no habría con qué completar el encuentro.
	var share := maxf(_profile.max_share_per_archetype, 1.0 / float(maxi(_allowed_count(allowed), 1)))
	for index: int in ARCHETYPE_ORDER.size():
		bounds.append(int(ceilf(share * float(enemy_total))) if allowed[index] else 0)
	return bounds


## Reserva del legacy: reparto uniforme (`E1=E2=E3=MaxEnemies/3`), pero solo
## entre los arquetipos permitidos y recortado hasta caber en los
## presupuestos. El original no recortaba y podía devolver una composición que
## violaba sus propias restricciones.
func _uniform_fallback(
	enemy_total: int,
	allowed: Array[bool],
	budgets: Array[Rational]
) -> Array[int]:
	var counts: Array[int] = [0, 0, 0]
	var count := _allowed_count(allowed)
	if count == 0 or enemy_total <= 0:
		return counts
	@warning_ignore("integer_division")
	var each: int = enemy_total / count
	var remainder: int = enemy_total - each * count
	for index: int in ARCHETYPE_ORDER.size():
		if not allowed[index]:
			continue
		counts[index] = each
		if remainder > 0:
			counts[index] += 1
			remainder -= 1
	# Recorte determinista: se quita del arquetipo más numeroso (empate por
	# índice menor) hasta que los tres presupuestos se cumplen.
	var guard: int = 0
	while not _fits(counts, budgets) and guard < enemy_total + 1:
		guard += 1
		var biggest: int = -1
		for index: int in ARCHETYPE_ORDER.size():
			if counts[index] > 0 and (biggest < 0 or counts[index] > counts[biggest]):
				biggest = index
		if biggest < 0:
			break
		counts[biggest] -= 1
	return counts


func _fits(counts: Array[int], budgets: Array[Rational]) -> bool:
	for row: int in budgets.size():
		var coefficients := _coefficients(row)
		var total := Rational.zero()
		for index: int in ARCHETYPE_ORDER.size():
			total = total.add(coefficients[index].scaled(counts[index]))
		if total.greater_than(budgets[row]):
			return false
	return true


func _spend(counts: Array[int]) -> Array[float]:
	var out: Array[float] = []
	for row: int in ARCHETYPE_ORDER.size():
		var coefficients := _coefficient_floats(row)
		var total: float = 0.0
		for index: int in ARCHETYPE_ORDER.size():
			total += coefficients[index] * float(counts[index])
		out.append(total)
	return out


static func _to_int_array(values: PackedInt64Array) -> Array[int]:
	var out: Array[int] = []
	for value: int in values:
		out.append(value)
	return out
