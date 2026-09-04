class_name EncounterContext
extends RefCounted
## Todo lo que el director necesita saber de una zona para componer su
## encuentro. Dato puro: NO consulta el mundo.
##
## Esta clase es la frontera entre el director y el resto del juego. Quien la
## rellena (el `EncounterDirector` con datos de `ai-navegacion` y del nivel)
## puede tocar el mundo; quien la consume (`EncounterComposer`,
## `TensionCurve`) es una función pura y por eso se puede probar en headless
## sin escena, sin navmesh y sin GPU.
##
## En 2012 el equivalente eran dos números sueltos —`Map::getArea()` y una
## `dificultad` constante— pasados a `CargarFuncionObjetivo`
## (`legacy/trunk/core/lib/GameAction.cc:189-200`). El Simplex era correcto,
## pero sus entradas estaban muertas: no describían ni al jugador ni al mapa.

## Planta (1..9) y zona (1..6) a las que pertenece el encuentro.
var floor_number: int = 1
var zone: int = 1

## Área NAVEGABLE de la zona, en m². Equivalente del `Map::getArea()` del
## legacy, que la sumaba de los triángulos navegables en miles de px².
var navigable_area_m2: float = 0.0

## Dificultad base de la planta (`FloorConfig.base_difficulty`).
var floor_difficulty: float = 1.0
## Salida del modelo de habilidad. 1.0 = jugador neutro. Es la entrada que en
## el original no existía: allí la dificultad era una constante por planta.
var skill_multiplier: float = 1.0

# ---- Forma del mapa ----
## Puntos de cobertura por cada 100 m² de zona. Lo aporta la nube horneada
## por `ai-navegacion` (`CoverProvider.point_count()` sobre el área).
var cover_points_per_100m2: float = 0.0
## Longitud media de línea de visión libre, en metros. Distingue un pasillo
## (pocos metros) de una planta diáfana (decenas).
var mean_line_of_sight_m: float = 0.0
## Número de accesos reales a la zona: puertas, huecos de escalera,
## ascensores. Es también el número de sitios por donde es JUSTO aparecer.
var entry_count: int = 0
## ¿Se han MEDIDO los tres campos de arriba, o están sin rellenar?
##
## No es lo mismo "esta zona no tiene cobertura" que "nadie me ha dicho
## cuánta cobertura tiene", y en punto flotante las dos cosas son 0.0. Sin
## esta bandera, una zona cuyos datos no llegaron se leería como un descampado
## sin un solo parapeto, y el director respondería con menos Veteranos y más
## Sicarios: un balanceo raro que nadie diagnosticaría como lo que es, un dato
## que faltaba. Con ella, la geometría simplemente SE ABSTIENE.
##
## Se pone sola al llamar a `set_map_shape`, que es la única vía correcta.
var shape_measured: bool = false

## Arquetipos que esta planta admite (`FloorConfig.enemy_pool`). Un arquetipo
## fuera de esta lista tiene cota superior 0 en el problema.
var allowed_archetypes: Array[StringName] = []

## Semilla del encuentro. Se deriva de `GameState.run_seed` y de la zona, de
## forma que la misma partida reproduzca las mismas oleadas.
var seed: int = 0


## Rellena la forma de la zona y la marca como medida. Lo llama quien tenga
## acceso al mundo: la nube de coberturas horneada, el navmesh y los accesos
## reales del nivel.
func set_map_shape(
	cover_per_100m2: float,
	line_of_sight_m: float,
	entries: int
) -> void:
	cover_points_per_100m2 = maxf(cover_per_100m2, 0.0)
	mean_line_of_sight_m = maxf(line_of_sight_m, 0.0)
	entry_count = maxi(entries, 0)
	shape_measured = true


## Dificultad que ve el Simplex: planta × jugador. Es la línea que convierte
## el ejercicio académico de 2012 en un director vivo.
func effective_difficulty() -> float:
	return maxf(floor_difficulty, 0.0) * maxf(skill_multiplier, 0.0)


func duplicate_context() -> EncounterContext:
	var copy := EncounterContext.new()
	copy.floor_number = floor_number
	copy.zone = zone
	copy.navigable_area_m2 = navigable_area_m2
	copy.floor_difficulty = floor_difficulty
	copy.skill_multiplier = skill_multiplier
	copy.cover_points_per_100m2 = cover_points_per_100m2
	copy.mean_line_of_sight_m = mean_line_of_sight_m
	copy.entry_count = entry_count
	copy.shape_measured = shape_measured
	copy.allowed_archetypes = allowed_archetypes.duplicate()
	copy.seed = seed
	return copy


func _to_string() -> String:
	return (
		"EncounterContext(planta %d zona %d, %.0f m², dif %.2f × habilidad %.2f, "
		+ "cobertura %.1f/100m², LOS %.1f m, %d accesos)"
	) % [
		floor_number, zone, navigable_area_m2, floor_difficulty, skill_multiplier,
		cover_points_per_100m2, mean_line_of_sight_m, entry_count,
		"" if shape_measured else ", FORMA SIN MEDIR",
	]
