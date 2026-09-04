class_name BehaviorFilter
extends RefCounted
## Veto DURO de comportamientos. Es el puerto por el que `ai-escuadra` hace
## cumplir las reglas de grupo del GDD §8.4.
##
## Existe porque una regla de grupo que sólo BAJA la utilidad no es una regla:
## se cuela en cuanto el resto de utilidades bajan. "Nadie asalta sin
## supresión activa" tiene que ser imposible, no improbable. Por eso el
## selector multiplica por cero lo que este filtro veta, en lugar de restarle
## puntos.
##
## Dos modos:
##   * permisivo (el de fábrica): todo permitido salvo lo explícitamente
##     vetado con `deny()`;
##   * lista blanca (`allow_only()`): sólo lo enumerado.
##
## Una lista blanca VACÍA no permite nada, y eso es deliberado. El valor por
## defecto de una consulta de la que depende una decisión de justicia nunca
## puede ser el permisivo: si el director de escuadra calcula mal y entrega
## una lista vacía, el bot se queda quieto (`IDLE`), que es visible y
## depurable. Interpretarla como "todo vale" convertiría un error de la
## escuadra en un bot que asalta sin supresión, sin error y sin aviso.

## true = sólo se permite lo que esté en `_allowed`.
var _allowlist_mode: bool = false
var _allowed: Dictionary[BehaviorKind.Kind, bool] = {}
var _denied: Dictionary[BehaviorKind.Kind, bool] = {}
## Motivo del veto, por comportamiento. Sólo para depuración: sin esto, "el
## bot no flanquea" no tiene respuesta.
var _reasons: Dictionary[BehaviorKind.Kind, String] = {}


## Filtro que sólo permite los comportamientos enumerados.
static func allow_only(kinds: Array[BehaviorKind.Kind]) -> BehaviorFilter:
	var out := BehaviorFilter.new()
	out._allowlist_mode = true
	for kind: BehaviorKind.Kind in kinds:
		out._allowed[kind] = true
	return out


## Filtro permisivo con vetos puntuales.
static func denying(kinds: Array[BehaviorKind.Kind], reason: String = "") -> BehaviorFilter:
	var out := BehaviorFilter.new()
	for kind: BehaviorKind.Kind in kinds:
		out.deny(kind, reason)
	return out


func deny(kind: BehaviorKind.Kind, reason: String = "") -> BehaviorFilter:
	_denied[kind] = true
	if not reason.is_empty():
		_reasons[kind] = reason
	return self


func allow(kind: BehaviorKind.Kind) -> BehaviorFilter:
	_denied.erase(kind)
	_reasons.erase(kind)
	if _allowlist_mode:
		_allowed[kind] = true
	return self


func is_allowed(kind: BehaviorKind.Kind) -> bool:
	if _denied.has(kind):
		return false
	if _allowlist_mode:
		return _allowed.has(kind)
	return true


## Motivo por el que un comportamiento está vetado, o cadena vacía.
func reason_for(kind: BehaviorKind.Kind) -> String:
	if is_allowed(kind):
		return ""
	var stored: String = _reasons.get(kind, "")
	if not stored.is_empty():
		return stored
	return "vetado por la escuadra"


## ¿Permite este filtro algo? Una lista blanca vacía no permite nada, y quien
## la construyó querrá enterarse.
func allows_anything() -> bool:
	if not _allowlist_mode:
		return true
	for kind: BehaviorKind.Kind in _allowed:
		if not _denied.has(kind):
			return true
	return false


func to_text() -> String:
	var parts: Array[String] = []
	if _allowlist_mode:
		var names: Array[String] = []
		for kind: BehaviorKind.Kind in _allowed:
			names.append(BehaviorKind.name_of(kind))
		names.sort()
		parts.append("lista blanca: %s" % ", ".join(names))
	for kind: BehaviorKind.Kind in _denied:
		parts.append("veto %s (%s)" % [BehaviorKind.name_of(kind), reason_for(kind)])
	if parts.is_empty():
		return "sin restricciones"
	return " | ".join(parts)
