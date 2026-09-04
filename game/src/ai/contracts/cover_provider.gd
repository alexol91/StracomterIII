class_name CoverProvider
extends RefCounted
## Interfaz de la nube de puntos de cobertura.
##
## El legacy triangulaba (Delaunay + GPC) para PODER navegar. Aquí la
## geometría se usa además para DECIDIR DÓNDE PONERSE, que es lo que hace que
## un enemigo parezca inteligente en lugar de solo funcional.
##
## La nube se hornea al construir el nivel y NO se recalcula por frame.

## Calidad de cobertura en una dirección.
enum Quality { NONE, LOW, HIGH }

## Un punto de cobertura horneado.
class CoverPoint:
	extends RefCounted

	var position: Vector3 = Vector3.ZERO
	## Calidad por cada una de las 8 direcciones cardinales, a altura de pecho.
	var chest: Array[Quality] = []
	## Calidad por dirección a altura de cabeza. Una mesa cubre agachado pero
	## no de pie: por eso hacen falta las dos alturas.
	var head: Array[Quality] = []
	## Puntuación asignada en la última consulta. Solo para depuración.
	var last_score: float = 0.0

	## Calidad de cobertura frente a una amenaza situada en `threat_position`.
	func quality_against(threat_position: Vector3, crouched: bool) -> Quality:
		var dir := (threat_position - position)
		dir.y = 0.0
		if dir.length_squared() < 0.0001:
			return Quality.NONE
		var table := chest if crouched else head
		if table.is_empty():
			return Quality.NONE
		var angle := atan2(dir.z, dir.x)
		var sector := int(roundf(angle / (TAU / 8.0))) % 8
		if sector < 0:
			sector += 8
		if sector >= table.size():
			return Quality.NONE
		return table[sector]


## Los `k` mejores puntos de cobertura para un bot.
##
## Puntuación esperada (GDD §8.3):
##   protección frente a amenazas conocidas
##   − exposición a las demás amenazas
##   − coste de camino
##   + progreso hacia el objetivo
func query(
	_from: Vector3,
	_threats: Array[Vector3],
	_objective: Vector3,
	_crouched: bool,
	_k: int = 3
) -> Array[CoverPoint]:
	return []


## Exposición de un punto arbitrario frente a un conjunto de amenazas.
## 0 = a cubierto, 1 = a pecho descubierto. Alimenta `BotState.exposure`.
func exposure_at(_point: Vector3, _threats: Array[Vector3], _crouched: bool) -> float:
	return 1.0


## Número de puntos horneados. Un nivel con 0 no ha sido horneado y la IA
## táctica no funcionará: los tests deben comprobarlo.
func point_count() -> int:
	return 0
