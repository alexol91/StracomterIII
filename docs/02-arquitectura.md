# Arquitectura técnica

Godot 4.7.2 · GDScript tipado estricto · Jolt · Forward+

## 1. Estructura del repositorio

```
StracomterIII/
├── game/                        # Proyecto Godot 4.7 (raíz: project.godot)
│   ├── project.godot
│   ├── src/
│   │   ├── core/                # Bucle, estados, servicios, guardado, consola
│   │   ├── gameplay/            # Personajes, armas, objetos, puertas, cobertura
│   │   ├── ai/                  # Percepción, utilidad, árboles, escuadra
│   │   ├── director/            # Simplex, modelo de habilidad, oleadas
│   │   ├── levels/              # Carga de planta, navmesh, generador procedural
│   │   ├── ui/                  # HUD, menús, estrategia, consola
│   │   └── data/                # Recursos .tres de balanceo
│   ├── scenes/                  # .tscn (texto plano, diffeable)
│   ├── assets/                  # Modelos glTF, texturas, audio, fuentes
│   ├── maps/legacy/             # Los 26 mapas convertidos
│   └── tests/                   # GdUnit4, ejecutable en --headless
├── tools/                       # Conversor de mapas legacy, horneado de cobertura
├── docs/                        # ADR, GDD, análisis, roadmap
│   └── analisis/                # Arqueología del código de 2012
├── legacy/                      # El proyecto C++ original, intacto
│   ├── trunk/  tags/  _svn-metadata/
└── .claude/agents/              # Definiciones de los agentes del equipo
```

**Regla de oro:** `legacy/` es de solo lectura. Es el documento fuente. No se compila,
no se parchea, no se toca. Lo que hace falta de ahí se **extrae a `docs/analisis/`** y se
reimplementa en `game/`.

## 2. Capas y dependencias

```
        ┌──────────────────────────────────────────────┐
        │  ui/          (HUD, menús, consola)          │
        └───────────────────┬──────────────────────────┘
                            │ señales, solo lectura del estado
        ┌───────────────────▼──────────────────────────┐
        │  director/    (Simplex, DDA, oleadas)        │
        └───────────────────┬──────────────────────────┘
        ┌───────────────────▼──────────────────────────┐
        │  ai/          (percepción, utilidad, escuadra)│
        └───────────────────┬──────────────────────────┘
        ┌───────────────────▼──────────────────────────┐
        │  gameplay/    (personajes, armas, cobertura) │
        └───────────────────┬──────────────────────────┘
        ┌───────────────────▼──────────────────────────┐
        │  levels/ + core/  (mundo, navmesh, servicios)│
        └──────────────────────────────────────────────┘
```

Las dependencias van **solo hacia abajo**. `gameplay/` no sabe que existe `ai/`; un
personaje expone intenciones (`mover_a`, `disparar_a`, `recargar`) y quien las rellena
es o el input del jugador o un cerebro de IA. Esto es lo que permite que el mismo
`Character` sea jugador, compañero o enemigo, y que la IA sea testeable sin render.

## 3. Servicios globales (autoloads)

| Autoload | Responsabilidad |
|---|---|
| `GameState` | Planta, zona, clase elegida, puntuación, XP, estado de la escuadra. Sustituye al singleton `GameStatus` del legacy |
| `SaveSystem` | Guardado/carga en JSON versionado (el legacy volcaba structs binarios: irreproducible) |
| `EventBus` | Señales globales: `enemy_died`, `noise_emitted`, `floor_cleared`, `door_state_changed` |
| `Blackboard` | Pizarra compartida: contactos, roles, presupuesto del director |
| `Balance` | Carga los `.tres` de estadísticas. **Todo número de juego vive aquí, ninguno en código** |
| `AudioDirector` | Buses, música por estado, eventos posicionales |
| `Console` | Comandos de depuración (`[P13]`) |
| `Settings` | Opciones, remapeo, accesibilidad, idioma |

## 4. ADR-002 — Presupuesto de CPU de la IA

**Problema:** GDScript interpretado, hasta 40 bots, y percepción con raycasts es lo
primero que hunde el frame.

**Decisión:** ningún bot procesa nada en `_process`. Un `AIScheduler` central reparte:

| Sistema | Frecuencia | Reparto |
|---|---|---|
| Percepción (vista/oído) | 10 Hz | Cola por prioridad; techo de **48 raycasts/frame** en toda la escena |
| Decisión (utilidad) | 5 Hz | Round-robin, máx. 8 bots por tick |
| Árbol de comportamiento | 20 Hz | Solo el comportamiento activo |
| Petición de camino | Bajo demanda | Cola, máx. 4 por frame, con caché por par (origen, destino) |
| Puntuación de cobertura | Al cambiar de comportamiento | Nunca por frame |

**Reparto entre frames, no por ráfagas.** La percepción NO se ejecuta de golpe cada
100 ms. Un techo de rayos aplicado a una ráfaga ordenada por prioridad produce
**inanición**: los mismos bots de mayor prioridad se llevan todo el presupuesto y el
resto no percibe nunca. En su lugar, cada frame se atiende una porción de clientes con
un cursor rotatorio y vencimiento por cliente, de modo que el techo por frame solo
introduce **retraso**, nunca hambre. Con 48 rayos/frame a 60 fps hay 2.880 rayos/s
disponibles y 40 bots a 3 rayos y 10 Hz consumen 1.200.

Al cliente se le pasa el **tiempo real transcurrido**, no el periodo nominal: si el
techo lo retrasó, su memoria debe decaer por lo que de verdad ha pasado.

**Prioridad:** distancia al jugador y visibilidad en cámara. Un bot a 60 m detrás de una
pared se actualiza a 2 Hz; el que te está disparando, a tasa completa. **Degradación
elegante, no recorte de calidad**: nunca se baja la calidad de la decisión, se baja su
frecuencia.

**Consecuencia:** todo sistema de IA debe ser una función pura y determinista de
`(estado del bot, pizarra, consulta del mundo)`, lo cual es exactamente lo que lo hace
testeable en `--headless` sin escena.

## 5. ADR-003 — El Simplex se conserva, con aritmética exacta

El original implementaba Simplex con `Rational` (aritmética exacta) y una variante
entera. **Se porta esa decisión, no se sustituye por floats.** Motivos:

1. Los presupuestos del director son enteros pequeños; los floats introducirían
   degeneración y ciclos en el pivote justo en los casos límite.
2. Un solucionador determinista es un solucionador testeable: las mismas entradas dan la
   misma composición enemiga siempre, y eso hace que un bug de balanceo sea reproducible.
3. Es el corazón académico del proyecto original. Reescribirlo con una heurística
   cualquiera sería tirar lo que hacía especial a este juego.

`director/simplex.gd` implementa Simplex de dos fases con racionales enteros
(`num/den` en `int64`) más ramificación y acotación para la solución entera, con reserva
a distribución uniforme si el problema resulta infactible (igual que el legacy).

## 6. ADR-004 — Navegación: navmesh, no grafo triangulado a mano

El legacy triangulaba (Delaunay + GPC + expansión por radio del personaje) para
construir un grafo y correr A* propio. En Godot esto lo hace `NavigationServer3D`: se
hornea un navmesh de la geometría con `agent_radius` y `agent_height`, y se obtienen
gratis rutas suavizadas y evitación local RVO2 entre agentes.

Lo que **sí** se conserva del legacy es la idea buena que había detrás y que Godot no
da: las puertas **modifican la navegación** (`[P08]`). Se implementa con
`NavigationLink3D` conmutables y regiones separadas por puerta, en lugar del
`changeNodeState(id, enabled)` del `NavGraph` original.

Y lo que se **añade**, porque es lo que hace falta para una IA táctica: la **nube de
puntos de cobertura**, horneada de la geometría al construir el nivel y consultada en
ejecución. El legacy usaba la triangulación como fuente de puntos de aparición
(`getTriCenters(2000)`); aquí eso se obtiene muestreando el navmesh.

## 7. ADR-005 — Los datos de juego no viven en el código

El legacy tenía las estadísticas **triplicadas**: hardcodeadas en `CoreNamespace.h`,
en `testFiles/entities.xml` y en `testFiles/features/f1.xml`, con **valores
contradictorios entre las tres**. Es la clase de bug que hace imposible balancear un
juego.

En el remake hay **una** fuente de verdad: recursos `.tres` en `game/src/data/`
(`CharacterStats`, `WeaponStats`, `FloorConfig`, `DirectorProfile`), cargados por el
autoload `Balance`. Un test de CI falla si algún `.gd` contiene un número de balanceo
literal.

## 8. Testing

Todo corre en `godot --headless`, sin ventana ni GPU:

* **Unitarios:** Simplex (contra soluciones conocidas), modelo de habilidad, puntuación
  de utilidad, decaimiento de memoria de percepción, puntuación de cobertura, conversor
  de mapas.
* **Integración:** cargar cada uno de los 26 mapas convertidos y comprobar navmesh no
  vacío, zonas conectadas y spawns válidos.
* **Comportamiento:** escenarios sintéticos con aserciones (§12 del GDD): "un bot con
  vida baja y sin cobertura se retira", "dos bots ante un objetivo con dos accesos
  producen exactamente un flanqueo", "ningún bot dispara a través de geometría opaca".
* **Humo:** arrancar el juego, entrar en la planta 1, simular 30 s de IA, salir sin
  errores ni avisos.

CI (GitHub Actions): lint (`gdlint`) → tests headless → export Linux/macOS/Windows.

## 9. Convenciones de código

* GDScript con **tipado estático obligatorio** (`class_name`, `-> void`, `: float`).
* `snake_case` para ficheros y variables; `PascalCase` para clases y nodos.
* Nombres de dominio **en inglés en el código** (`Captain`, `SquadDirector`) y **en
  español en la UI** (vía traducciones). El legacy mezclaba los dos idiomas dentro de
  la misma clase (`CargarEnemigos`, `getNivelPlanta`, `isVivitoYColeando`) y era ruido.
* Ninguna dependencia externa salvo GdUnit4 (solo en desarrollo). Sin addons de IA de
  terceros: la IA es el núcleo del proyecto y se escribe aquí.
* Toda escena guardada en formato texto (`.tscn`), nunca binario.
