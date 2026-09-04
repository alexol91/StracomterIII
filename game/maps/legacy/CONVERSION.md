# Conversión de mapas legacy a Godot 4

Generado automáticamente por `tools/map_converter/build_all.py`. **No editar a mano**: se sobrescribe en cada regeneración.

Fuente: 26 mapas de `legacy/trunk/testFiles/maps/*.xml` más `legacy/trunk/editorMap.xml` (27 en total). Escala 1 unidad legacy = 1/75 m (`docs/01-gdd.md` §5). Validación con `tools/map_converter/validate.py` (ver ese fichero para el criterio exacto de cada comprobación).

| XML origen | Escena | Área (m²) | Muros | Puertas | Obstáculos | Pickups | Player | MiniBoss | MegaBoss | Navmesh (libres / alcanzable) | Resultado | Notas |
|---|---|---:|---:|---:|---:|---:|:-:|:-:|:-:|---:|:-:|---|
| `legacy/trunk/testFiles/maps/finalMap.xml` | `finalMap` **(requerido)** | 740 | 27 | 14 | 0 | 16 | sí | no | sí | 1510 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/gallardoMap.xml` | `gallardoMap` | 326 | 18 | 8 | 29 | 8 | sí | no | no | 1222 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/map1.xml` | `map1` | 870 | 2 | 1 | 5 | 0 | sí | no | no | 1890 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/map4.xml` | `map4` | 326 | 18 | 8 | 29 | 8 | sí | sí | no | 1222 / 100% | OK | aviso: miniBoss en (810,317) cae en una celda no navegable |
| `legacy/trunk/testFiles/maps/map5.xml` | `map5` | 757 | 14 | 3 | 6 | 7 | sí | sí | no | 1625 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/map6.xml` | `map6` | 128 | 13 | 5 | 0 | 0 | sí | sí | no | 1502 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/mapAlex.xml` | `mapAlex` | 517 | 32 | 0 | 0 | 0 | sí | no | no | 1355 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/mapG1.xml` | `mapG1` **(requerido)** | 994 | 18 | 7 | 47 | 8 | sí | sí | no | 2083 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/mapG2.xml` | `mapG2` **(requerido)** | 869 | 15 | 6 | 45 | 6 | sí | sí | no | 1732 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/mapG3.xml` | `mapG3` **(requerido)** | 447 | 12 | 2 | 27 | 8 | sí | sí | no | 1360 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/mapG4.xml` | `mapG4` **(requerido)** | 1173 | 16 | 7 | 31 | 5 | sí | sí | no | 2430 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/mapM1.xml` | `mapM1` **(requerido)** | 307 | 11 | 6 | 38 | 8 | sí | sí | no | 1360 / 100% | OK | aviso: 1 muro(s) cuyo centro cae fuera del perímetro |
| `legacy/trunk/testFiles/maps/mapM2.xml` | `mapM2` | 664 | 20 | 8 | 30 | 11 | sí | sí | no | 1366 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/mapM3.xml` | `mapM3` **(requerido)** | 707 | 9 | 5 | 39 | 6 | sí | sí | no | 1449 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/mapM4.xml` | `mapM4` **(requerido)** | 952 | 15 | 5 | 37 | 5 | sí | sí | no | 1889 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/mapP1.xml` | `mapP1` **(requerido)** | 112 | 6 | 3 | 13 | 2 | sí | sí | no | 1189 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/mapP2.xml` | `mapP2` **(requerido)** | 179 | 5 | 1 | 12 | 2 | sí | sí | no | 1259 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/mapP3.xml` | `mapP3` **(requerido)** | 211 | 6 | 3 | 20 | 4 | sí | sí | no | 817 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/mapP4.xml` | `mapP4` **(requerido)** | 351 | 5 | 1 | 24 | 5 | sí | sí | no | 1032 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/mapRuben.xml` | `mapRuben` | 49 | 2 | 1 | 3 | 4 | sí | no | no | 1047 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/map_01.xml` | `map_01` | 31 | 6 | 0 | 0 | 0 | sí | no | no | 724 / 0% | **FALLO** | ERROR: el spawn del jugador (150,150) está fuera del perímetro; ERROR: el spawn del jugador cae dentro de un muro/obstáculo (celda de navegación bloqueada) |
| `legacy/trunk/testFiles/maps/map_02.xml` | `map_02` | 43 | 5 | 0 | 0 | 0 | sí | no | no | 702 / 0% | **FALLO** | ERROR: el spawn del jugador cae dentro de un muro/obstáculo (celda de navegación bloqueada) |
| `legacy/trunk/testFiles/maps/map_03.xml` | `map_03` | 43 | 2 | 0 | 0 | 0 | no | no | no | 833 / 0% | OK | aviso: sin <object type="player">: no se puede comprobar alcanzabilidad; aviso: sin <object type="player">: el mapa no tiene spawn de jugador |
| `legacy/trunk/testFiles/maps/map_04.xml` | `map_04` | 178 | 4 | 0 | 0 | 0 | sí | no | no | 1600 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/mapaMolon.xml` | `mapaMolon` | 44 | 4 | 0 | 0 | 0 | sí | no | no | 893 / 100% | OK | — |
| `legacy/trunk/testFiles/maps/pruebasMov.xml` | `pruebasMov` | 225 | 0 | 0 | 0 | 0 | sí | no | no | 1600 / 100% | OK | — |
| `legacy/trunk/editorMap.xml` | `editorMap` | 852 | 15 | 6 | 37 | 5 | sí | sí | no | 1686 / 100% | OK | — |

**Totales**: 27 mapas convertidos, 25 validados sin fallos, 2 con fallos.

Notas generales: "Navmesh (libres / alcanzable)" viene de la **rejilla propia** de `validate.py` (flood-fill sobre muros y huella de obstáculos) — es una comprobación rápida en tiempo de conversión, NO el navmesh que usa el juego. La comprobación que manda hornea de verdad con `NavigationServer3D` en `game/tests/maps/test_legacy_maps.gd` y `game/tests/ai/navigation/test_legacy_maps_navigation.gd`: ahí se encontraron y arreglaron dos bugs reales de horneado (bobinado de la colisión del suelo, y una `BoxShape3D` suelta por arista del perímetro que rompía la conectividad en zonas ajenas — ver `tools/map_converter/README.md` §"Bug real"), y con ambos arreglados los 25 mapas sin fallo de carga quedan al 100% salvo `mapaMolon` y `map_03` (bolsillos pequeños alrededor de obstáculos, no zonas enteras tabicadas). Las puertas, obstáculos, pickups y spawns se generan como nodos `Marker3D` con metadatos (`tipo`, posición, ángulo) — no llevan geometría ni colisión: otro agente instanciará las escenas de gameplay reales sobre estos marcadores.

