class_name UtilityWeights
extends RefCounted
## Tabla de pesos de utilidad de UN arquetipo. Esto ES el arquetipo.
##
## Un Sicario y un Veterano no son dos clases con lógica distinta: son dos
## tablas de números que desplazan la MISMA decisión. Es la diferencia entre
## poder inventar un enemigo nuevo editando una tabla y tener que escribir (y
## depurar) otro fichero de comportamiento.
##
## Dos cosas por comportamiento:
##   * `gain(kind)`   — amplitud máxima de su utilidad. 0 = deshabilitado.
##   * `weight(kind, term)` — importancia relativa de cada consideración
##     DENTRO de ese comportamiento.
##
## `UtilityScorer` combina ambas:
##   score = gain · Σ(wᵢ·vᵢ) / Σwᵢ
##
## Los jefes añaden fases: la misma tabla con las ganancias desplazadas al
## bajar de un umbral de vida. Por eso `for_archetype` recibe la vida.

## Identificador del arquetipo del que salió esta tabla, para depuración.
var archetype: StringName = &""
## Fase de jefe con la que se resolvió (0 para todo lo demás).
var phase: int = 0

var _gain: Dictionary[BehaviorKind.Kind, float] = {}
var _weights: Dictionary[BehaviorKind.Kind, Dictionary] = {}


## Tabla de un arquetipo enemigo, resuelta a la fase de jefe que corresponda.
##
## `health_ratio` sólo se usa para elegir fase. No es un atajo para meter
## lógica de vida en la tabla: la vida ya entra en la puntuación como término
## (`health`, `hurt`, `critical`), y ahí es donde debe entrar.
static func for_archetype(p_archetype: StringName, health_ratio: float = 1.0) -> UtilityWeights:
	var out := UtilityWeights.new()
	out.archetype = p_archetype
	out._gain = _copy_gain(BehaviorTuning.BASE_GAIN)
	out._weights = _copy_weights(BehaviorTuning.BASE_WEIGHTS)

	var gain_override: Dictionary = BehaviorTuning.ARCHETYPE_GAIN.get(p_archetype, {})
	out._apply_gain_override(gain_override)
	var weight_override: Dictionary = BehaviorTuning.ARCHETYPE_WEIGHTS.get(p_archetype, {})
	out._apply_weight_override(weight_override)

	out.phase = BehaviorTuning.boss_phase(p_archetype, health_ratio)
	if out.phase > 0:
		var phases: Array = BehaviorTuning.BOSS_PHASE_GAIN.get(p_archetype, [])
		if out.phase < phases.size():
			out._apply_gain_override(phases[out.phase] as Dictionary)
	return out


## Tabla de compañero (GDD §8.5): mismo cerebro, otras prioridades.
static func for_companion(p_archetype: StringName = &"companion") -> UtilityWeights:
	var out := UtilityWeights.new()
	out.archetype = p_archetype
	out._gain = _copy_gain(BehaviorTuning.COMPANION_GAIN)
	out._weights = _copy_weights(BehaviorTuning.BASE_WEIGHTS)
	return out


## Amplitud máxima de un comportamiento. 0 = este arquetipo no lo hace nunca.
func gain(kind: BehaviorKind.Kind) -> float:
	return _gain.get(kind, 0.0)


## ¿Contempla esta tabla el comportamiento? Un enemigo no sigue al líder, y no
## porque haya un `if` de bando escondido: porque su tabla le da ganancia 0.
func enabled(kind: BehaviorKind.Kind) -> bool:
	return gain(kind) > 0.0


## Peso de una consideración dentro de un comportamiento. 0 = no se considera.
func weight(kind: BehaviorKind.Kind, term: StringName) -> float:
	var table: Dictionary = _weights.get(kind, {})
	return float(table.get(term, 0.0))


## Términos que este arquetipo considera para un comportamiento, en orden
## estable. El orden importa: el desglose de puntuación se lee a mano.
func terms_of(kind: BehaviorKind.Kind) -> Array[StringName]:
	var out: Array[StringName] = []
	var table: Dictionary = _weights.get(kind, {})
	for term: StringName in table:
		out.append(term)
	out.sort()
	return out


## Suma de pesos de un comportamiento. Es el denominador de la media
## ponderada; 0 significa que el comportamiento no tiene consideraciones y su
## utilidad es 0 sea cual sea el estado.
func weight_sum(kind: BehaviorKind.Kind) -> float:
	var total := 0.0
	var table: Dictionary = _weights.get(kind, {})
	for term: StringName in table:
		total += maxf(float(table[term]), 0.0)
	return total


## Cambia una ganancia. Pensado para el rebalanceo en caliente desde consola y
## para que `ai-escuadra` derive tablas de compañero sin duplicar la base.
func set_gain(kind: BehaviorKind.Kind, value: float) -> void:
	_gain[kind] = maxf(value, 0.0)


## Cambia el peso de un término. Nunca negativo: ver la nota de
## `BehaviorTuning.BASE_WEIGHTS`.
func set_weight(kind: BehaviorKind.Kind, term: StringName, value: float) -> void:
	if not _weights.has(kind):
		_weights[kind] = {}
	var table: Dictionary = _weights[kind]
	table[term] = maxf(value, 0.0)


func duplicate_weights() -> UtilityWeights:
	var out := UtilityWeights.new()
	out.archetype = archetype
	out.phase = phase
	out._gain = _copy_gain(_gain)
	out._weights = _copy_weights(_weights)
	return out


func _apply_gain_override(override: Dictionary) -> void:
	for key: BehaviorKind.Kind in override:
		_gain[key] = maxf(float(override[key]), 0.0)


func _apply_weight_override(override: Dictionary) -> void:
	for key: BehaviorKind.Kind in override:
		var table: Dictionary = {}
		var source: Dictionary = override[key]
		for term: StringName in source:
			table[term] = maxf(float(source[term]), 0.0)
		_weights[key] = table


static func _copy_gain(source: Dictionary) -> Dictionary[BehaviorKind.Kind, float]:
	var out: Dictionary[BehaviorKind.Kind, float] = {}
	for key: BehaviorKind.Kind in source:
		out[key] = float(source[key])
	return out


static func _copy_weights(source: Dictionary) -> Dictionary[BehaviorKind.Kind, Dictionary]:
	var out: Dictionary[BehaviorKind.Kind, Dictionary] = {}
	for key: BehaviorKind.Kind in source:
		var table: Dictionary = {}
		var inner: Dictionary = source[key]
		for term: StringName in inner:
			table[term] = float(inner[term])
		out[key] = table
	return out
