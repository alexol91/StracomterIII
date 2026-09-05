# Roadmap — épicas, tareas y asignación a agentes

Nomenclatura: `[P##]` = requisito de paridad con el original (GDD §2).
`[E-##]` = evolutivo (`05-evolutivos.md`). Estado: ⬜ pendiente · 🟨 en curso · ✅ hecho.

---

## Hito 0 — Arqueología y fundamentos

| # | Tarea | Agente | Estado |
|---|---|---|---|
| 0.1 | Analizar IA, Simplex y triangulación del legacy | `arqueologo-legacy` (Fable 5.1) | ✅ |
| 0.2 | Reconstruir las reglas de juego del legacy | `arqueologo-legacy` (Fable 5.1) | ✅ |
| 0.3 | Inventariar datos, assets y especificar el conversor | `arqueologo-legacy` (Fable 5.1) | ✅ |
| 0.4 | Analizar los cinco motores propios y sus dependencias | `arqueologo-legacy` (Fable 5.1) | ✅ |
| 0.5 | ADR de motor y stack | PO Técnico (Opus 5) | ✅ |
| 0.6 | GDD completo | PO Técnico (Opus 5) | ✅ |
| 0.7 | Arquitectura y ADR-002..005 | `godot-arquitecto` (Opus 5) | ✅ |
| 0.8 | Roster de agentes y reglas de equipo | PO Técnico (Opus 5) | ✅ |
| 0.9 | Mover el proyecto C++ a `legacy/` preservando historia | PO Técnico | ✅ |

## Hito 1 — Esqueleto jugable *(el objetivo es "se mueve y dispara", no "es bonito")*

| # | Tarea | Paridad | Agente | Estado |
|---|---|---|---|---|
| 1.1 | `project.godot`, estructura, autoloads, contratos base | — | `godot-arquitecto` | ✅ |
| 1.2 | Recursos `.tres` de balanceo con los valores canónicos del legacy | P01 P02 | `godot-arquitecto` | ✅ |
| 1.3 | `Character` + `CharacterBody3D` + intenciones | P01 | `godot-gameplay` | ✅ |
| 1.4 | Controlador del jugador + cámara TPS + mando | P17 | `godot-gameplay` | ✅ |
| 1.5 | Armas: fuego, cuchillo, explosivo, munición, recarga | P06 | `godot-gameplay` | ✅ |
| 1.6 | Salud, daño localizado, muerte, puntuación, XP | P06 P12 | `godot-gameplay` | ✅ |
| 1.7 | `AIScheduler` con presupuesto de CPU (ADR-002) | — | `godot-arquitecto` | ✅ |
| 1.8 | Conversor de mapas legacy + validador | P16 | `level-conversor` | ✅ |
| 1.9 | Navmesh, enlaces de puerta, muestreo de spawns | P08 P10 | `ai-navegacion` | ✅ |
| 1.10 | CI: gdlint + tests headless + 3 exports | — | `devops-ci` | ✅ |

## Hito 2 — La IA que justifica el remake

| # | Tarea | Paridad | Agente | Estado |
|---|---|---|---|---|
| 2.1 | Percepción: visión con oclusión, dos conos | P07 | `ai-percepcion` | ✅ |
| 2.2 | Oído propagado por navmesh + eventos sonoros | E-04 | `ai-percepcion` | ✅ |
| 2.3 | Memoria de contactos con confianza decreciente | P07 | `ai-percepcion` | ✅ |
| 2.4 | Difusión de contactos con retardo de reacción | — | `ai-percepcion` | ✅ |
| 2.5 | Selector por utilidad + histéresis | — | `ai-comportamiento` | ✅ |
| 2.6 | Árboles de comportamiento y ejecución | — | `ai-comportamiento` | ✅ |
| 2.7 | Arquetipos como tablas de pesos | P02 | `ai-comportamiento` | ✅ |
| 2.8 | Horneado y puntuación de puntos de cobertura | P09 | `ai-navegacion` | ✅ |
| 2.9 | Rutas alternativas disjuntas para flanqueo | — | `ai-navegacion` | ✅ |
| 2.10 | `SquadDirector`, roles, supresión, repliegue | — | `ai-escuadra` | 🟨 escrito y **sin enchufar** (T-03) |
| 2.11 | Compañeros + moral + órdenes del jugador | P05 | `ai-escuadra` | 🟨 escrito y **sin enchufar** (T-04) |
| 2.12 | Escenarios de comportamiento con aserciones (GDD §12) | — | `qa-tests` | ✅ |

## Hito 3 — Director de encuentros

| # | Tarea | Paridad | Agente | Estado |
|---|---|---|---|---|
| 3.1 | Simplex de dos fases con racionales exactos + entero | P11 | `director-encuentros` | ✅ |
| 3.2 | Modelo vivo de habilidad del jugador (DDA) | E-03 | `director-encuentros` | ✅ |
| 3.3 | Restricciones sensibles a la forma del mapa | E-03 | `director-encuentros` | ✅ |
| 3.4 | Curva de tensión y oleadas | E-03 | `director-encuentros` | ✅ |
| 3.5 | Reglas justas de aparición | — | `director-encuentros` | ✅ |
| 3.6 | Tests del director (determinismo, monotonía, justicia) | — | `qa-tests` | ✅ |

## Hito 4 — Progresión, torre y UI

| # | Tarea | Paridad | Agente | Estado |
|---|---|---|---|---|
| 4.1 | Máquina de estados de juego: Menú/Estrategia/Acción/Créditos | P14 | `godot-arquitecto` | ✅ |
| 4.2 | 8 plantas × 6 zonas + tabla de selección de mapa | P03 | `godot-arquitecto` | ✅ |
| 4.3 | Recompensas por zona | P04 | `godot-gameplay` | ✅ |
| 4.4 | Guardado/carga en JSON versionado | P12 | `godot-arquitecto` | ✅ |
| 4.5 | HUD completo | — | `ui-ux` | ✅ |
| 4.6 | **Pantalla de Estrategia** (el hueco del original) | P14 | `ui-ux` | ✅ |
| 4.7 | Menús, pausa, game over, victoria, créditos | P14 | `ui-ux` | ✅ |
| 4.8 | Consola de comandos | P13 | `ui-ux` | ✅ |
| 4.9 | Accesibilidad + i18n ES/EN | — | `ui-ux` | ✅ |
| 4.10 | Puertas, obstáculos, pickups como escenas | P08 P09 | `godot-gameplay` | ✅ |

## Hito 5 — Contenido y presentación

| # | Tarea | Paridad | Agente | Estado |
|---|---|---|---|---|
| 5.1 | Cel-shading + materiales + paleta | — | `arte-audio` | ✅ |
| 5.2 | Personajes y mobiliario con modelos de verdad | — | `arte-audio` | ✅ |
| 5.3 | **Auditoría de licencias de los assets del legacy** | — | `arte-audio` | ✅ |
| 5.4 | Buses de audio, música por estado, eventos 3D | — | `arte-audio` | 🟨 |
| 5.5 | Paquete de sonido opcional "Chutaos" | — | `arte-audio` | 🟨 |
| 5.6 | MiniBoss y MegaBoss con fases | P02 | `ai-comportamiento` | ⬜ |
| 5.7 | Planta 9 (azotea) y combate final | — | `level-procedural` | ⬜ |
| 5.8 | Generador procedural de plantas | E-02 | `level-procedural` | ⬜ |
| 5.9 | Habilidades de clase | E-01 | `godot-gameplay` | ✅ |
| 5.10 | Revisión adversarial de rutas críticas | — | `revisor-critico` | ⬜ |

## Deuda técnica conocida

| # | Asunto | Dueño | Estado |
|---|---|---|---|
| D.1 | ~~Mapas tabicados~~ — resuelto: bobinado de colisión invertido y perímetro fundido en el trimesh. 24 de 24 jugables al 100 % | `level-conversor` | ✅ |
| D.2 | ~~Validador con rejilla propia~~ — resuelto: las pruebas de mapas hornean contra física real | `ai-navegacion` | ✅ |
| D.3 | ~~Obstáculos sin colisión~~ — resuelto: `LevelLoader` instancia las escenas reales sobre los marcadores | `godot-arquitecto` | ✅ |
| D.4 | `NavTuning` sigue en código. La mayoría son presupuestos de ingeniería y no balanceo, pero las de geometría de cobertura sí lo son | `godot-arquitecto` | ⬜ |
| D.5 | ~~Falsos positivos del criterio de CI~~ — resuelto: el filtro ancla los prefijos reales del motor al principio de línea, y hay prueba de que discrimina en ambos sentidos | `godot-arquitecto` | ✅ |

## Hito 6 — Publicable

| # | Tarea | Agente | Estado |
|---|---|---|---|
| 6.1 | Pruebas de rendimiento: 60 fps con 40 bots | `qa-tests` | ⬜ |
| 6.2 | Balanceo con datos de partidas reales | `director-encuentros` | ⬜ |
| 6.3 | Exports de Linux y Windows (macOS pendiente, ver T-13) | `devops-ci` | 🟨 |
| 6.4 | README, capturas, guía de contribución | PO Técnico | ⬜ |
| 6.5 | Licencia (BSD, como el original) y atribuciones | PO Técnico | ⬜ |

---

## Grafo de dependencias (lo que no se puede paralelizar)

```
1.1 contratos ─┬─→ 1.3 …1.6 gameplay ──┐
               ├─→ 1.7 scheduler ──────┼─→ 2.1…2.4 percepción ─┐
               └─→ 1.2 balance         │                        ├─→ 2.5…2.7 comportamiento ─┐
1.8 conversor ─────→ 1.9 navmesh ──────┴─→ 2.8 2.9 cobertura ──┘                            ├─→ 2.10 2.11 escuadra
                                                                                              │
3.1 simplex (independiente) ─→ 3.2…3.5 director ←──────────────────────────────────────────────┘
```

**Se puede lanzar ya en paralelo, sin bloqueos entre sí:** 1.1+1.2 (contratos y datos),
1.8 (conversor, solo depende del análisis), 3.1 (Simplex, puro y aislado), 1.10 (CI).
El resto espera a que existan los contratos: **un agente nunca inventa la interfaz de
otro** (regla 3 del equipo).

---

# Trabajo pendiente, en detalle

Esta lista sustituye a los `⬜` sueltos de arriba. Está ordenada por lo que más
le falta al juego, medido JUGÁNDOLO, no leyendo el código. El criterio de
"hecho" de cada tarea es una comprobación que se puede ejecutar.

> Por qué hace falta este apartado: las tablas de hitos dicen ✅ en cosas que
> están escritas, probadas y **desconectadas**. Ya pasó dos veces —el director
> sin nodo en la escena, los cerebros sin nadie que los montara— y la tercera
> está viva ahora mismo: toda la capa de escuadra. Una tarea no está hecha
> hasta que se nota en partida.

## Bloque A — Que el combate exista

### T-01 · Los bots no ven al jugador aunque lo tengan al lado ✅ `ai-percepcion`

**Medido antes**: cuatro enemigos a entre 0,7 y 6,6 m del jugador durante 30 s
de partida real, los cuatro en `PATROL`, con `has_line_of_sight = false` y
`target_confidence = 0.00`. Cero disparos.

**Tres causas, ninguna con mensaje de error**:

1. **El bot que patrulla no giraba la cabeza.** `move_along_path` mueve por
   dirección y no fija punto de mira, y `CharacterController` solo rota el
   cuerpo si alguien se lo pide: el rumbo se quedaba clavado en el que tenía al
   nacer. El ángulo al jugador se mantuvo en 81° los treinta segundos. Ahora
   `BehaviorActions.sweep_look` hace un vaivén de ±55° alrededor del rumbo.
2. **Nadie se enteraba de a quién tenía al lado.** Ver es cosa del cono; notar
   a alguien a dos metros, no. `PerceptionProfile.proximity_awareness_m` abre
   la puerta del cono por debajo de ese radio (2,5 m el sicario, 3,5 el normal,
   4,5 el veterano). No da rayos X: la oclusión se sigue comprobando.
3. **Los bots veían a través de las puertas CERRADAS.** `VisionSensor` solo
   tenía la capa "world" en su máscara de oclusión; `WeaponSystem` sí tenía la
   de puertas. Así que decidían atacar a través de una puerta y sus balas se la
   comían: 41 disparos, 0 impactos. Es el bug del legacy otra vez, por otra
   puerta.

**Y una cuarta al medir el resultado**: apuntaban al ORIGEN del contacto, que
son los pies. Los impactos salían a 27 cm de altura y las zonas de impacto
—cabeza, torso— no se tocaban nunca. `BehaviorContext.aim_point()` sube al
pecho.

**Medido después**: 30 s, ~60 disparos, ~30 impactos, y el jugador quieto pierde
un 20 % de vida. Lo vigila `tools/combat_probe/`.

### T-02 · La cadena intención → disparo, medida de punta a punta ✅ `qa-tests`

`tools/combat_probe/probe.sh` arranca una partida de verdad, deja correr 30 s y
falla si el director no pone enemigos, si ninguno dispara, si no aciertan o si
el jugador no recibe daño. Corre en CI detrás del arranque limpio.

Hacía falta porque el runner de pruebas es **síncrono**: no puede esperar pasos
de física, así que ninguna prueba cruza la frontera entre "la IA decide
disparar" y "la bala hace daño". Ahí vivían los cuatro fallos de T-01.

Su primera ejecución encontró uno más, ajeno a la IA: `SkillModel` conectaba a
`character_damaged` un manejador de TRES parámetros para una señal de CINCO.
Godot no protesta al conectar, protesta al emitir y por consola. El modelo de
habilidad no contaba ni un punto del daño recibido, así que el jugador le
parecía invencible y el director subía la dificultad.

### T-03 · La escuadra enemiga está escrita y nadie la usa ⬜ `ai-escuadra`

`SquadDirector`, `SquadRunner`, `SquadRoleAssignment`, `SquadMorale` y
`SquadOrder` no aparecen fuera de sus propias pruebas. En partida los enemigos
son individuos sueltos: no hay roles, ni supresión, ni flanqueo coordinado, ni
repliegue. Todo el hito 2.10 es código muerto en el juego.

**Hecho cuando**: `AIRuntime` monta un `SquadRunner` por escuadra, los enemigos
reciben rol, y una prueba comprueba que con tres enemigos y un jugador visible
hay al menos un `SUPPRESS` y un `FLANK` simultáneos.

### T-04 · El jugador no tiene compañeros ⬜ `ai-escuadra`

La pantalla de Estrategia deja elegir a quién te llevas a la planta —Técnico,
Especialista, Explosivo, con su casilla "Llevar a la planta"— y **no aparece
nadie**. `LoadedLevel.companion_spawns` se rellena y no lo lee nadie;
`CompanionController`, `CompanionSquad` y `CompanionFormation` no se instancian.
Es una promesa de la interfaz que el juego no cumple.

**Hecho cuando**: los compañeros marcados aparecen en la planta, siguen al
jugador y una prueba comprueba que el estado de `GameState.squad` decide
cuántos hay.

## Bloque B — Que la partida termine

### T-05 · MiniBoss y MegaBoss con fases ⬜ `ai-comportamiento`

Existen como arquetipos con estadísticas y modelo, pero se comportan igual que
un sicario. El GDD les pide fases.

### T-06 · Planta 9 y combate final ⬜ `level-procedural`

`floor_9.tres` existe; no hay azotea ni final. Ahora mismo la torre se acaba sin
acabarse.

### T-07 · Generador procedural de plantas ⬜ `level-procedural`

`game/src/levels/` solo tiene `floor_runner.gd` y `level_loader.gd`. El
evolutivo E-02 está sin empezar. Los 24 mapas de 2012 dan para una partida.

## Bloque C — Que se note que es un juego

### T-08 · Audio de verdad ⬜ `arte-audio`

18 ficheros de sonido en total y una sola pista de música (`credits.ogg`). Hay
buses, `AudioDirector` y el conmutador del paquete de broma; falta el contenido:
música por estado (menú, exploración, combate, jefe) y los eventos 3D que ya
tienen sus llamadas.

### T-09 · Iluminación interior ⬜ `arte-audio`

En la captura de la planta 1 hay paredes en negro absoluto. Puede ser el
renderizador de Compatibilidad del contenedor —ver el aviso de
`tools/screenshots/`— pero hay que verlo en Forward+ antes de darlo por bueno.

### T-10 · La cámara en pasillos estrechos 🟨 `godot-gameplay`

Ya no se mete dentro de las paredes (esfera de 28 cm en el `SpringArm3D`), pero
en una esquina cóncava el brazo se colapsa y se acaba mirando la nuca. Falta la
solución buena: desplazar la cámara en vez de acortarla.

### T-11 · Traducción inglesa incompleta ⬜ `ui-ux`

Con el sistema en inglés, la pantalla de Estrategia mezcla los dos idiomas
("STRATEGY", "Next floor", "Squad", "Back" en inglés; el resto en español).
Faltan claves en la columna `en` de `strings.csv`.

## Bloque D — Publicable

### T-12 · Rendimiento: 60 fps con 40 bots ⬜ `qa-tests`

Sin medir. Con `AIScheduler` y sus techos debería salir, pero "debería" no es un
número.

### T-13 · Export de macOS ⬜ `devops-ci`

Falla desde Linux en una comprobación de configuración que Godot **no nombra**
—el mensaje llega vacío—. Además, un binario sin firmar no se abre en un Mac sin
desactivar Gatekeeper. Necesita un Mac o firma real.

### T-14 · README, capturas y guía de contribución ⬜ PO Técnico

### T-15 · Licencia del remake (BSD, como el original) y atribuciones ⬜ PO Técnico

`game/assets/LICENCIAS.md` cubre los assets. Falta la licencia del código.

### T-16 · `NavTuning` sigue en código ⬜ `godot-arquitecto`

Era la deuda D.4. La mayoría son presupuestos de ingeniería y se quedan donde
están, pero las de geometría de cobertura son balanceo y deberían vivir en un
`.tres`.

### T-17 · Revisión adversarial de las rutas críticas ⬜ `revisor-critico`

Antes de dar por cerrada la versión: IA, director, navegación y conversión de
mapas.
