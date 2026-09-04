class_name Obstacle
extends StaticBody3D
## Mobiliario de oficina: colisión + altura de cobertura. Réplica de
## `Core::Obstacles` (legacy, `CoreNamespace.h:57-70`; `Obstacle.cc`): 8
## subtipos, sin vida ni destrucción, solo bloquean movimiento y disparo.
##
## Este fichero solo EXPONE el dato de cobertura (altura que protege, si
## bloquea línea de visión). Quién lo CONSULTA para hornear la nube de puntos
## de cobertura o decidir dónde ponerse es `ai/` (GDD §8.3); `gameplay/` no
## calcula puntuaciones de cobertura, solo las hace consultables.

## Réplica exacta de los 8 subtipos del legacy, mismo orden que el enum
## original (`obs_table=0 … obs_mesaConSillas=7`).
enum Kind { TABLE, DESK, COUCH, SOFA, CHAIR, SHELF, PLANT_POT, TABLE_WITH_CHAIRS }

## Hasta dónde protege este obstáculo de un disparo.
enum CoverHeight {
	NONE, ## No detiene balas (p. ej. una planta de interior).
	LOW,  ## Protege agachado, no de pie.
	HIGH, ## Protege también de pie.
}

@export var kind: Kind = Kind.TABLE:
	set(value):
		kind = value
		if is_inside_tree():
			_apply_kind_defaults()

## Altura de cobertura efectiva. Por defecto se deriva de `kind`
## (`default_cover_for`); se puede sobrescribir por instancia en el editor.
@export var cover_height: CoverHeight = CoverHeight.LOW
## Si es true, rompe la línea de visión aunque no proteja de balas.
## GDD §9: "una planta de interior no protege nada pero rompe la línea de
## visión, que a veces vale más".
@export var blocks_line_of_sight: bool = true


func _ready() -> void:
	add_to_group(&"obstacles")


## Altura de cobertura por defecto de cada subtipo. Mobiliario bajo (silla,
## mesa) protege agachado; mobiliario alto (estantería, sofá) protege también
## de pie; una maceta no detiene nada.
## TODO(arquitecto/arte-nivel): mover a datos si se necesitan variantes por
## mapa en vez de un valor fijo por subtipo.
static func default_cover_for(k: Kind) -> CoverHeight:
	match k:
		Kind.PLANT_POT:
			return CoverHeight.NONE
		Kind.SHELF, Kind.COUCH, Kind.SOFA:
			return CoverHeight.HIGH
		_:
			return CoverHeight.LOW


func _apply_kind_defaults() -> void:
	cover_height = default_cover_for(kind)
	blocks_line_of_sight = true
