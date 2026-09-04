class_name TensionCurve
extends RefCounted
## Ritmo del encuentro: la capa que el original no tenía.
##
## En 2012 la planta entera aparecía de golpe al cargar el mapa
## (`Optimization::CargarEnemigos`, `Optimization.cc:135-172`): un cálculo
## único, todos los enemigos colocados a la vez y ninguna noción de ritmo. El
## remake libera la misma composición en cuatro fases (GDD §7):
##
## | Fase | Qué hace | Cuándo termina |
## |---|---|---|
## | `RISE` (ascenso) | Oleadas pequeñas mientras el jugador avanza | Cuando se han soltado todas y queda poca presión |
## | `PEAK` (pico) | Se gasta el resto del presupuesto de golpe | Cuando no queda ningún hostil |
## | `RELIEF` (alivio) | Rezagados y botín | Cuando no quedan hostiles y pasa `relief_duration_s` |
## | `REST` (descanso) | SILENCIO FORZADO, no se genera nada | Tras `rest_duration_s` (20-40 s) |
##
## Es determinista de principio a fin: no usa azar. Dadas la misma
## composición y la misma secuencia de llamadas a `advance`, produce las
## mismas oleadas en el mismo orden. El azar del director vive en dónde
## aparece cada enemigo, no en cuántos ni cuándo.

enum Phase {
	RISE,
	PEAK,
	RELIEF,
	REST,
	## El encuentro ha terminado; la zona siguiente puede empezar.
	DONE,
}

## Rango del silencio forzado que exige el GDD §7. El `rest_duration_s` del
## perfil se recorta a este rango: 5 s de descanso no serían un descanso, y
## 300 s no serían un juego. No es balanceo ajustable, es el contrato de la
## fase.
const REST_DURATION_MIN_S: float = 20.0
const REST_DURATION_MAX_S: float = 40.0

## Una oleada: qué se genera y en qué fase.
class Wave:
	extends RefCounted

	var phase: Phase = Phase.RISE
	## Enemigos por arquetipo, en el orden de `EncounterComposer.ARCHETYPE_ORDER`.
	var counts: Array[int] = [0, 0, 0]
	## Posición de la oleada en el plan.
	var index: int = 0

	func total() -> int:
		var sum: int = 0
		for value: int in counts:
			sum += value
		return sum

	func is_empty() -> bool:
		return total() == 0

	func to_archetype_list() -> Array[StringName]:
		var out: Array[StringName] = []
		for index_archetype: int in counts.size():
			for _i: int in counts[index_archetype]:
				out.append(EncounterComposer.ARCHETYPE_ORDER[index_archetype])
		return out

	func describe() -> String:
		return "oleada %d (%s): %d enemigos [%d/%d/%d]" % [
			index, Phase.keys()[int(phase)], total(), counts[0], counts[1], counts[2],
		]


var _profile: DirectorProfile = null
var _waves: Array[Wave] = []
var _phase: Phase = Phase.RISE
var _time_in_phase_s: float = 0.0
var _time_since_wave_s: float = 0.0
var _next_wave: int = 0
var _started: bool = false


func _init(profile: DirectorProfile = null) -> void:
	_profile = profile if profile != null else Balance.director_profile()
	if _profile == null:
		_profile = DirectorProfile.new()


# ---- Plan ----

## Reparte una composición en oleadas por fase. Función PURA: mismo reparto
## para la misma composición, sin azar de por medio.
func plan(composition: EncounterComposer.Composition) -> Array[Wave]:
	_waves = []
	var per_phase := split_by_phase(composition.counts, phase_fractions())
	var phases: Array[Phase] = [Phase.RISE, Phase.PEAK, Phase.RELIEF]
	var wave_counts: Array[int] = [
		_profile.rise_wave_count, _profile.peak_wave_count, _profile.relief_wave_count,
	]
	for phase_index: int in phases.size():
		var counts: Array[int] = per_phase[phase_index]
		var waves := _split_into_waves(counts, wave_counts[phase_index])
		for wave_counts_row: Array[int] in waves:
			var wave := Wave.new()
			wave.phase = phases[phase_index]
			wave.counts = wave_counts_row
			wave.index = _waves.size()
			if not wave.is_empty():
				_waves.append(wave)
	_next_wave = 0
	return _waves


func waves() -> Array[Wave]:
	return _waves


## Reparte los enemigos de una fase entre sus oleadas.
##
## Las oleadas de una misma fase crecen linealmente (1, 2, 3...): el ascenso
## tiene que ascender de verdad, no ser tres oleadas iguales seguidas.
func _split_into_waves(counts: Array[int], wave_count: int) -> Array[Array]:
	var count := maxi(wave_count, 1)
	var fractions := wave_fractions(count)
	var waves: Array[Array] = []
	for _index: int in count:
		waves.append([0, 0, 0] as Array[int])
	for archetype: int in counts.size():
		var parts := largest_remainder(counts[archetype], fractions)
		for wave_index: int in count:
			var row: Array[int] = waves[wave_index]
			row[archetype] = parts[wave_index]
	return waves


## Pesos crecientes de las oleadas de una fase, normalizados a 1.
static func wave_fractions(wave_count: int) -> Array[float]:
	var count := maxi(wave_count, 1)
	var out: Array[float] = []
	var total := float(count * (count + 1)) * 0.5
	for index: int in count:
		out.append(float(index + 1) / total)
	return out


## Fracciones de presupuesto por fase (ascenso, pico, alivio), normalizadas.
func phase_fractions() -> Array[float]:
	var raw := _profile.phase_budget_fractions
	var out: Array[float] = []
	var total: float = 0.0
	for index: int in 3:
		var value := maxf(raw[index] if index < raw.size() else 0.0, 0.0)
		out.append(value)
		total += value
	if total <= 0.0:
		return [1.0, 0.0, 0.0]
	for index: int in out.size():
		out[index] = out[index] / total
	return out


## Reparte los enemigos de cada arquetipo entre las fases por el método del
## mayor resto: sin pérdidas ni enemigos inventados, y determinista.
static func split_by_phase(counts: Array[int], fractions: Array[float]) -> Array[Array]:
	var result: Array[Array] = []
	for _index: int in fractions.size():
		result.append([0, 0, 0] as Array[int])
	for archetype: int in counts.size():
		var shares := largest_remainder(counts[archetype], fractions)
		for phase_index: int in fractions.size():
			var row: Array[int] = result[phase_index]
			row[archetype] = shares[phase_index]
	return result


## Reparte `total` unidades según `fractions` sin perder ninguna: parte
## entera y luego los restos mayores, empate por índice menor.
static func largest_remainder(total: int, fractions: Array[float]) -> Array[int]:
	var out: Array[int] = []
	var remainders: Array[float] = []
	var assigned: int = 0
	for fraction: float in fractions:
		var exact := float(total) * fraction
		var whole := int(floorf(exact))
		out.append(whole)
		remainders.append(exact - float(whole))
		assigned += whole
	var left := total - assigned
	while left > 0:
		var best: int = -1
		for index: int in remainders.size():
			if best < 0 or remainders[index] > remainders[best]:
				best = index
		if best < 0:
			break
		out[best] += 1
		remainders[best] = -1.0
		left -= 1
	# Si quedaran unidades (todos los restos consumidos), van a la primera
	# fase con fracción positiva: nunca se pierde un enemigo por redondeo.
	var cursor: int = 0
	while left > 0 and cursor < out.size():
		if fractions[cursor] > 0.0:
			out[cursor] += 1
			left -= 1
		else:
			cursor += 1
	return out


# ---- Máquina de estados ----

func begin() -> void:
	_phase = Phase.RISE
	_time_in_phase_s = 0.0
	_time_since_wave_s = _profile.min_wave_interval_s
	_next_wave = 0
	_started = true


## Avanza el reloj del encuentro. `hostiles_alive` es el número de enemigos
## vivos AHORA: es lo que hace que el ritmo responda al jugador y no a un
## temporizador ciego.
func advance(delta_s: float, hostiles_alive: int) -> Phase:
	if not _started:
		begin()
	var step := maxf(delta_s, 0.0)
	_time_in_phase_s += step
	_time_since_wave_s += step

	match _phase:
		Phase.RISE:
			if not _has_pending_in(Phase.RISE) and hostiles_alive <= _profile.max_hostiles_for_peak:
				_enter(Phase.PEAK)
		Phase.PEAK:
			if not _has_pending_in(Phase.PEAK) and hostiles_alive <= 0:
				_enter(Phase.RELIEF)
		Phase.RELIEF:
			var quiet := hostiles_alive <= 0 and not _has_pending_in(Phase.RELIEF)
			if quiet and _time_in_phase_s >= _profile.relief_duration_s:
				_enter(Phase.REST)
		Phase.REST:
			if _time_in_phase_s >= rest_duration_s():
				_enter(Phase.DONE)
		Phase.DONE:
			pass
	return _phase


## Devuelve la oleada que toca generar AHORA, o null. Consume la oleada: la
## siguiente llamada ya no la devuelve.
func take_wave(hostiles_alive: int) -> Wave:
	if _phase == Phase.REST or _phase == Phase.DONE:
		return null  # el descanso es silencio forzado: aquí no se genera nada
	if _next_wave >= _waves.size():
		return null
	var wave := _waves[_next_wave]
	if wave.phase != _phase:
		return null
	if _time_since_wave_s < _profile.min_wave_interval_s:
		return null
	# En el pico se suelta todo de golpe; en ascenso y alivio se espera a que
	# la presión baje, para que las oleadas no se apilen.
	if _phase != Phase.PEAK and hostiles_alive > _profile.max_hostiles_for_next_wave:
		return null
	_next_wave += 1
	_time_since_wave_s = 0.0
	return wave


func phase() -> Phase:
	return _phase


func time_in_phase_s() -> float:
	return _time_in_phase_s


func is_finished() -> bool:
	return _phase == Phase.DONE


func pending_wave_count() -> int:
	return maxi(_waves.size() - _next_wave, 0)


## Duración del silencio forzado, recortada al rango del GDD.
func rest_duration_s() -> float:
	return clampf(_profile.rest_duration_s, REST_DURATION_MIN_S, REST_DURATION_MAX_S)


static func phase_name(value: Phase) -> String:
	return Phase.keys()[int(value)]


func _enter(next_phase: Phase) -> void:
	_phase = next_phase
	_time_in_phase_s = 0.0
	# Al entrar en una fase su primera oleada puede salir ya: el intervalo
	# mínimo es entre oleadas de la misma fase, no entre fases.
	_time_since_wave_s = _profile.min_wave_interval_s


func _has_pending_in(target: Phase) -> bool:
	for index: int in range(_next_wave, _waves.size()):
		if _waves[index].phase == target:
			return true
	return false
