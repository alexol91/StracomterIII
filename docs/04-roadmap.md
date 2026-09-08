# Roadmap — épicas, tareas y asignación a agentes

Nomenclatura: `[P##]` = requisito de paridad con el original (GDD §2).
`[E-##]` = evolutivo (`05-evolutivos.md`). Estado: ⬜ pendiente · 🟨 en curso · ✅ hecho.

---

## Dónde está el proyecto

Tres cuentas distintas, porque mezclarlas es lo que produce un «90 %» que no
significa nada.

### 1. Paridad con el original: **17 de 17 requisitos**

| Estado | Requisitos |
|---|---|
| ✅ completos (16) | P01 clases · P02 arquetipos, MiniBoss y MegaBoss con fases y refuerzos · P03 plantas y zonas · P04 recompensas · P05 compañeros · P06 combate · P07 percepción · P08 puertas que alteran la navegación · P09 mobiliario como cobertura · P10 pathfinding · P11 Simplex · P12 guardado y puntuación · P13 consola · P16 los 26 mapas · P17 cámara 2D/3D |
| ✅ por rediseño (1) | **P15** editor de mapas: no se reimplementa, los mapas son `.tscn` en texto y se editan en el propio editor de Godot |

Con dos matices que no son deuda técnica sino decisiones, y están abajo: falta
el «modo libre» del menú de 2012 (último hueco de P14) y dos de las cuatro
pistas de música, que no se pueden distribuir.

Fuera de la lista de paridad, dos cosas del original que **no** están y no van a
estar tal cual:

* **La música.** El original usaba dos temas de The Prodigy en menú y acción:
  no se puede distribuir. Solo se reutiliza `credits.ogg`, que compuso el
  equipo (`ARTIST=Chutaos Team`). Los otros dos estados están en silencio hasta
  tener pista propia (T-08).
* **El «modo libre»** del menú de 2012: `GameState.Mode.FREE` está declarado y
  no lo usa nadie. Es el último hueco de P14.

### 2. Lo que hace que esto no sea un port: **~90 %**

Los subsistemas que el GDD justifica como la razón del remake, no como paridad.
Todos funcionando y probados: percepción con oclusión real y memoria con
confianza que decae, oído propagado por navmesh, selector por utilidad con
histéresis más árboles de comportamiento, arquetipos como tablas de pesos,
director de escuadra con roles y flanqueo por rutas disjuntas, compañeros con
moral, nube de coberturas horneada y puntuada en ejecución, reglas justas de
aparición, Simplex de racionales exactos con el problema reformulado, modelo
vivo de habilidad del jugador, curva de tensión, pantalla de Estrategia como
decisión informada, conversor automático de los 26 mapas, cel-shading, i18n,
y las cuatro sondas que comprueban que todo eso *se juega*.

Lo que falta de este bloque: la revisión adversarial de las rutas críticas
(T-17) y mover `NavTuning`/`BehaviorTuning` a datos (T-16).

### 3. Evolutivos ideados para después: **4 de 13, ~35 %**

| Estado | Evolutivos |
|---|---|
| ✅ | E-01 habilidades de clase · E-03 director adaptativo · E-04 sonido como información táctica · E-11 cámara conmutable |
| 🟨 | E-05 destructibilidad (la habilidad del Explosivo abre un muro y rehornea navegación; no hay física de oficina) |
| ⬜ | E-02 generación procedural · E-06 meta-progresión · E-07 cooperativo · E-08 modo Horda (la azotea ya existe: es el escenario) · E-09 editor en el juego · E-10 personalidad y aprendizaje · E-12 repeticiones · E-13 Workshop |

### ¿Se juega?

Sí, de principio a fin, y está comprobado en cada empujón por CI:

```
717 pruebas · arranque limpio sin un aviso
sonda de combate    → los enemigos pelean (planta 3-5 y azotea)
sonda de partida    → 9 plantas, Victoria y créditos en 17 s
sonda de rendimiento→ 40 bots: 5,1 ms de simulación por frame (2,1 de IA)
```

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
| 2.10 | `SquadDirector`, roles, supresión, repliegue | — | `ai-escuadra` | ✅ |
| 2.11 | Compañeros + moral + órdenes del jugador | P05 | `ai-escuadra` | ✅ |
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
| 5.4 | Buses de audio, música por estado, eventos 3D | — | `arte-audio` | 🟨 falta música propia: la del original son dos temas de The Prodigy |
| 5.5 | Paquete de sonido opcional "Chutaos" | — | `arte-audio` | 🟨 |
| 5.6 | MiniBoss y MegaBoss con fases | P02 | `ai-comportamiento` | ✅ |
| 5.7 | Planta 9 (azotea) y combate final | — | `level-procedural` | ✅ |
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

### T-03 · La escuadra enemiga está escrita y nadie la usa ✅ `ai-escuadra`

`AIRuntime` monta ahora un `SquadRunner` por grupo enemigo y le entrega el
`BehaviorController` de cada bot, que es lo que hace que el reparto no se quede
en la pizarra sino que llegue como `BehaviorFilter`. `EncounterRuntime` reparte
los enemigos en grupos de cuatro por orden de aparición —sembrado, así que las
escuadras son reproducibles—, que es el tamaño con el que `SquadTuning` reparte
sus cuatro roles sin dejar a nadie de reserva mirando.

Efecto medido en la sonda: la precisión enemiga sube de 133 impactos en 143
disparos a 43 en 43, porque el que fija fija y el que asalta asalta.

**Y un fallo latente que solo salía con cuerpos de verdad**: `SquadRunner`
guardaba el orden de sus bots en un `PackedInt32Array`. Un `bot_id` es un
`get_instance_id()` de 64 bits, y ese contenedor lo TRUNCA sin decir nada: el
índice guardado dejaba de existir en el diccionario y el recorrido reventaba
con «Out of bounds get index». No se había visto porque las pruebas del
subsistema usan ids sintéticos (1, 2, 3) — un doble más amable que la realidad.
Corregido también en `CompanionSquad` y `SquadRoleAssignment`.

### T-04 · El jugador no tiene compañeros 🟨 `ai-escuadra`

Ya bajan, y ya son una escuadra:

* `Main` guarda las casillas de la pantalla de Estrategia en
  `GameState.squad_taken` —antes las tiraba— y `GameState.companions_for_floor()`
  aplica las tres reglas: vivos, marcados, y nunca el propio jugador.
* `LevelLoader` los coloca y `CompanionRunner` —la pieza que faltaba, gemela de
  `SquadRunner`— los gobierna en el planificador: moral por cercanía al
  Capitán, directiva por compañero, y el hueco de formación puesto en
  `BehaviorContext.objective`, que es de donde `FOLLOW_LEADER` lo lee.
* Medido: tres compañeros bajan, sobreviven los 30 s y se mantienen a 1–2,5 m
  del jugador.

**Lo que falta (T-18)**: no devuelven el fuego. Encajan 33 puntos de daño y
disparan cero veces.

Tres fallos ya corregidos por el camino:

1. **Un compañero disparaba al jugador.** La percepción decidía la hostilidad
   con `team != team`, y para un compañero (1) el jugador (0) es «otro equipo».
   Ahora hay una sola regla, `Character.teams_are_hostile`, y solo cuenta si
   eres ENEMY.
2. **Un compañero se cayó de la torre**, a −78 m y bajando. Su hueco de
   formación caía fuera del suelo —la planta de 2012 es un polígono, no un
   rectángulo— y `move_along_path` hace la aproximación final en línea recta
   cuando el destino está cerca sin ruta: eso es caminar por el aire.
   `CompanionRunner` proyecta ahora el hueco sobre el navmesh, y aparecen en el
   punto del jugador, que es el único que se sabe bueno.
3. **«Bajo fuego» exigía verlos.** La oclusión es ASIMÉTRICA: un enemigo tras
   un mueble a la altura de la cintura te acierta al pecho mientras tu rayo al
   suyo se come el mueble. Definido así, un compañero encajaba cuarenta puntos
   de daño sin que su propia lógica lo considerara en peligro.

### T-18 · Los compañeros no devuelven el fuego ✅ `ai-comportamiento`

**Cuatro fallos encontrados y corregidos**, y el problema sigue a medias.

1. **Ningún árbol de espera disparaba.** `TAKE_COVER` acababa en
   `hold_position`, que encara la amenaza y no hace nada más. Un bot que se
   cubre lo hace PARA disparar. Ahora hay una acción `fire_if_able` —dispara
   si puede, y devuelve SUCCESS siempre porque es un paso INTERMEDIO: fallar
   por no tener ángulo abortaría la secuencia y con ella la cobertura.
2. **El ORDEN dentro del árbol lo decidía todo**, y costó tres medidas:
   al final no se disparaba nunca (`move_along_path` devuelve RUNNING mientras
   camina y una secuencia se para en el primer RUNNING); detrás de
   `elegir_cobertura` se disparaba una o dos veces en treinta segundos
   (`pick_cover` FALLA con la nube vacía y aborta la secuencia). Devolver el
   fuego no puede depender de encontrar cobertura: va primero.
3. **Un callejón sin salida.** Un bot sin ningún contacto puede elegir
   cubrirse —TAKE_COVER puntúa por exposición y gana a PATROL sin que nadie
   sepa nada— y en ese árbol no barría con la mirada. Se quedaba en su
   cobertura mirando al mismo sitio, así que no podía adquirir un contacto
   JAMÁS. Medido: cinco enemigos treinta segundos a cubierto, confianza 0.00,
   cero disparos y **cero fallos de árbol**: todo «funcionando».
4. **Un NaN en el barrido.** `move_goal` es INF cuando se aguanta una posición,
   y restar INF da un vector infinito cuyo `length_squared()` no es cero: el
   guardia no lo atrapaba, `normalized()` devolvía NaN y el bot «miraba» a un
   punto imposible. La comprobación tenía que ser de finitud, no de longitud.

`FOLLOW_LEADER` e `INVESTIGATE` también devuelven fuego ahora: es donde pasa la
mayor parte del tiempo un compañero.

**Cerrado por la cadena de T-20**, y no por donde se buscaba. La hipótesis era
que faltaba un verbo («reposicionarse para tener ángulo»); era falsa. Los
compañeros disparaban poco por lo mismo que los enemigos no disparaban nada:
caminaban a un tercio de su velocidad, la supresión aliada caducaba con el
reloj de pared y su árbol leía el objetivo de una pizarra vacía. Con eso
arreglado, la misma sonda que medía 1 disparo mide **52 con 37 aciertos**, y el
jugador quieto baja de 155 puntos de daño recibidos a 8: la escuadra le cubre.

Queda como observación, no como tarea: si en el futuro se ve a un compañero
atascado sin ángulo, el verbo sigue sin existir.

### T-19 · La sonda de combate ya es un instrumento ✅ `qa-tests`

Medía con el mismo código entre 0 y 143 disparos enemigos. Con esa dispersión
no se puede saber si un cambio en la IA ha ayudado o ha sido suerte, y encima
fallaba sola en CI de vez en cuando. Dos causas:

* `GameState.reset_run(0)` pone `run_seed = randi()`, así que cada ejecución
  montaba un encuentro distinto. La sonda fija la semilla — el proyecto ya
  prometía determinismo desde ahí (regla 6), solo había que usarlo.
* el delta de `_process` es el tiempo real del frame, así que el planificador
  de IA decidía en instantes distintos. `--fixed-fps 60`.

Ahora dos ejecuciones seguidas dan el mismo número.

**Corrección a esa última frase**: no lo daban. La sonda seguía alternando
entre «los enemigos pelean» y cero disparos con el MISMO código y la misma
semilla — verde una vez de cada dos. Esa inestabilidad no era del instrumento,
era lo que medía; ver T-20.

Y la sonda tenía un fallo propio, del tipo más irónico: en cuanto la IA
funcionó de verdad, el jugador quieto MURIÓ, su nodo se liberó y el informe
final llamaba a `_player.health_ratio()` sobre un objeto muerto — SIGSEGV. Una
sonda que se cae justo cuando lo que mide empieza a funcionar. Ahora cachea la
vida en cada paso y publica «MUERTO» como resultado legítimo.

### T-20 · El combate era una moneda al aire ✅ `ai-comportamiento`

Cinco fallos encadenados, ninguno con mensaje de error, todos en la frontera
entre «la IA decide» y «el cuerpo hace». El síntoma agregado era el peor
posible: la sonda pasaba la mitad de las veces.

1. **Los bots caminaban a un TERCIO de su velocidad.** `intent_move` se
   borraba al final de cada paso de física, junto a disparar y recargar. Pero
   moverse no es un evento, es un NIVEL: el input humano lo reescribe en cada
   paso y al jugador no le pasaba nada, mientras un cerebro de IA lo escribe en
   su tick de comportamiento a 20 Hz y la física va a 60. Dos de cada tres
   pasos con la intención ya borrada. El Sicario, con 2 m/s en su ficha, medido
   a 0,66 m/s. Con eso, cruzar la planta no cabía en los treinta segundos de la
   sonda, y desde el sofá se lee como «la IA es pasiva».
2. **El ruido se lo comía el contacto.** `_absorb_noise` hacía contacto O
   pista, nunca las dos, y como `_known_target` busca en la lista de objetivos
   registrados —que son todos los personajes del nivel— un disparo hostil
   entraba SIEMPRE por la rama del contacto. El contacto que deja un disparo
   oído tiene confianza ~0,2: por debajo del 0,25 que cuenta como amenaza y del
   0,45 que se difunde a la escuadra. El bot se quedaba sin ninguna de las dos
   entradas que le harían moverse. INVESTIGATE existía y estaba muerto para el
   ruido más importante del juego.
3. **La calma era lineal y el margen de conmutación absoluto.**
   `calm = 1 − confianza` sostiene PATROL. Con confianza 0,15, PATROL puntuaba
   0,37 contra 0,40 de INVESTIGATE: gana ir a mirar, pero por 0,03, y el margen
   de histéresis es 0,12. El bot oía el disparo, lo registraba, y seguía su
   ronda. Un bot no está «un 85 % tranquilo» porque haya oído un tiro: oír algo
   rompe la calma de golpe. Y de paso, INVESTIGATE se puntuaba con la certeza,
   que es justo al revés — cuanto más seguro estás, menos hay que investigar y
   más hay que atacar. Ahora tiene su propio término (`lead`).
4. **Un bot dependía de habérselo contado a alguien.** `BehaviorContext` leía
   el objetivo SOLO de la pizarra de escuadra, y a la pizarra solo llegan los
   contactos por encima de `min_broadcast_confidence`. Así que el bot podía
   puntuar «ve a mirar» y no tener ningún punto al que ir ni al que apuntar. La
   pizarra es para COMPARTIR, no para recordar: ahora, si la escuadra no sabe
   nada, se usa lo que sabe el propio bot. No da vista de rayos X — disparar
   sigue exigiendo un rayo confirmado en el tick.
5. **La supresión caducaba con el reloj de PARED.** `Blackboard` guardaba la
   marca en `Time.get_ticks_msec()`, que no respeta `time_scale`, no se detiene
   con la pausa y en una simulación a paso fijo avanza a su aire. Una regla de
   escuadra del GDD —«nadie asalta sin supresión activa»— decidida por lo
   ocupado que estuviera el procesador. `AIScheduler` ya llevaba su reloj
   simulado por esta razón y lo dejaba escrito en su cabecera.

Resultado en la sonda, tres ejecuciones seguidas: 23, 36 y 31 disparos
enemigos, todas con veredicto «los enemigos pelean». El jugador quieto en la
planta 3 zona 5 ahora se muere.

## Bloque B — Que la partida termine

### T-05 · MiniBoss y MegaBoss con fases ✅ `ai-comportamiento`

Las fases **ya estaban** y funcionan: `BOSS_PHASE_THRESHOLDS` (media vida para
el MiniBoss; dos tercios y un tercio para el MegaBoss) y `BOSS_PHASE_GAIN`
desplazan las ganancias, así que un MiniBoss herido deja de guardar la puerta y
carga. Ahora hay prueba de que los números cambian de verdad.

Lo que faltaba era peor: **los jefes no los instanciaba nadie.** Los marcadores
`miniBoss`/`megaBoss` de los mapas convertidos se leían a
`LoadedLevel.miniboss_spawn` y esa variable no la usaba ningún fichero. Una
planta con `has_miniboss = true` se jugaba exactamente igual que una sin él.

`EncounterRuntime` los pone ahora, con tres decisiones:

* la regla de qué zona tiene jefe es la MISMA que la interfaz ya le promete al
  jugador (`ZoneThreatReading.has_boss_presence`). Escrita aparte, el aviso
  «⚠ Posible jefe» y la realidad divergirían sin que nada falle;
* el jefe NO cuenta contra el presupuesto del Simplex: ese presupuesto es para
  la tropa, un jefe es contenido de la planta;
* va en su PROPIA escuadra. Metido en el grupo de cuatro sicarios se llevaría
  un rol de reserva y se quedaría esperando en cobertura.

Sin marcador se recurre a `EncounterDirector.pick_spawn_positions()`, que aplica
las mismas reglas de justicia que una oleada. Ante la duda, el jefe aparece.

**Los refuerzos ya están** («Fases + refuerzos», GDD §5). Lo que faltaba no era
el enganche sino el AVISO: `BehaviorController` detectaba el cambio de fase y se
lo guardaba —cambiaba la tabla de pesos en silencio—, así que el director no
podía reaccionar aunque quisiera. Ahora el controlador emite una señal LOCAL y
pura (se sigue probando sin autoloads), `BotBrain` la convierte en
`EventBus.boss_phase_changed` porque es quien tiene cuerpo e identidad, y
`EncounterRuntime` decide cuánta tropa trae: la IA cuenta lo que le pasa, no
cuántos refuerzos merece.

Cuántos vienen es dato (`DirectorProfile.boss_reinforcements_per_phase`, en
vigor `[0, 2, 3]`), y por defecto está VACÍO: un perfil que no lo declare no
invoca tropa de la nada. La posición 0 nunca se usa —a la fase 0 no se entra, se
empieza en ella—. Salen por las mismas reglas de justicia que una oleada, en su
propia escuadra, y no cuentan contra el presupuesto del Simplex, por lo mismo
que no cuenta el jefe.

Medido en partida, planta 9 con el MegaBoss (500 de vida, umbrales en 2/3 y
1/3): al cruzar el primero la planta pasa de 4 enemigos a 6, y al cruzar el
segundo de 6 a 9.

La sonda de combate juega ahora la **planta 3 zona 5**, que es la primera con
MiniBoss, y falla si no aparece. Y su jugador **dispara cada dos segundos**: un
jugador que no hace ruido no le da a nadie un motivo para acercarse, así que en
un mapa grande los treinta segundos se iban en cero contactos. Disparar ejercita
además el bucle completo —oído propagado por navmesh, investigar, adquirir,
disparar—, que es justo lo que la sonda existe para vigilar.

### T-06 · Planta 9 y combate final 🟨 `level-procedural`

`floor_9.tres` apuntaba a `res://maps/legacy/rooftop.tscn` y ese fichero **no
existía**: llegar a la planta 9 era llegar a un `load()` nulo. Ninguna prueba
lo cogía porque las de mapas recorren el directorio `legacy/` y comprueban lo
que HAY, no lo que los datos de balanceo PIDEN. Ahora hay una prueba que mira
desde el otro lado: de las nueve plantas hacia las escenas.

**La azotea existe** (`game/maps/rooftop.tscn`, 597 m², navegación 100 %
alcanzable). Se escribe en la misma gramática XML de 2012
(`game/maps/source/rooftop.xml`) y se convierte con el mismo
`tools/map_converter/` en vez de montarse a mano, porque el conversor ya sabe
tres cosas que costaron caras: el bobinado que exige el horneador de
navegación (contrario al del mesh visual), la triangulación del suelo con las
aristas del perímetro, y que el zócalo del perímetro tiene que fundirse en el
trimesh y no quedarse en cajas sueltas que rompen la conectividad. No es
legacy y no vive en `legacy/`: el original acababa la torre en `finalMap` y
nunca tuvo azotea.

Planta: 30 × 22 m con la esquina noreste recortada, caseta de escalera con
puerta por donde sale el jugador, dos cuerpos de máquinas y un depósito de
agua como cobertura, paravientos partiendo el flanqueo por el este, y el
MegaBoss en la esquina opuesta a 19 m. El helipuerto es el centro despejado
—el descampado que hay que cruzar—; su marca en el suelo es presentación y
está sin hacer.

**Noche**, como pide el GDD: el conversor marca la planta con
`metadata/exterior` (`--exterior`) y `WorldLighting` lo lee para dos cosas —no
repartir luminarias de techo donde no hay techo, y cambiar a paleta nocturna
con la luna haciendo de sol—. Ambiente nocturno LEGIBLE (0,55 con color
explícito), no oscuridad real: la mitad de este proyecto es aprender que una
planta a oscuras no se juega.

Comprobado JUGÁNDOLO, con la sonda apuntada a la planta 9
(`PROBE_FLOOR=9 PROBE_ZONE=1`, ahora también en CI): aparecen cuatro hostiles
con el MegaBoss entre ellos, pelean, y un jugador quieto en la azotea se muere
en cinco segundos. Y visto en captura cenital.

**Lo que queda**: el viento (audio y partículas) y la marca del helipuerto son
presentación sin hacer.

### T-21 · La partida no terminaba ✅ `ui-ux` + `director-encuentros`

Tres fallos en cadena entre limpiar una zona y ver el final de la torre. Los
tres silenciosos, y los tres encontrados por una sonda nueva
(`tools/run_probe/`) que juega las NUEVE plantas seguidas con el truco
`killall` y comprueba a dónde lleva cada una. Tarda diecisiete segundos y ya
está en CI.

1. **Una zona limpia tardaba 45 segundos en darse por limpia.** `FloorRunner`
   pregunta `has_pending_budget()` antes de declarar la victoria, y eso
   devolvía `_active`, que no se apaga hasta que la curva de tensión llega a
   DONE: 15 s de alivio MÁS 30 s de silencio forzado. Con todos los enemigos
   muertos, el jugador daba vueltas por una planta vacía sin que nada le
   dijera por qué. Nueve plantas así son siete minutos de espera. Lo que hay
   que preguntar no es «¿ha acabado la curva?» sino «¿queda algo por
   soltar?»: el descanso de la curva es silencio, no contenido pendiente.
2. **El resumen de fin de planta duraba un frame.** Se ponía a la vista y
   `FloorRunner` entraba en modo Estrategia acto seguido; `UiRoot` solo lo
   muestra en modo Acción. Un resumen que dura un frame es un resumen que no
   existe. La intención `floor_end_acknowledged` no la escuchaba NADIE — la
   propia cabecera de `UiRoot` lo dejaba escrito— así que el botón
   «Continuar» no llevaba a ningún sitio.
3. **La pantalla de Victoria no se veía jamás.** La azotea limpia saltaba
   directa a los créditos: `advance_floor()` dejaba la planta en 10 y
   `run_completed` desmontaba y cambiaba de modo en el mismo frame. La
   pantalla estaba escrita, con sus dos botones, su prueba de estilo y su
   comentario explicando que es «el final de la partida, no el paso a la
   siguiente». Ahora la planta se queda montada detrás mientras el jugador
   lee, y los créditos son una decisión suya.

Y dos trucos de consola que **no hacían nada**: `god` y `noclip` escribían un
metadato que nadie leía. Contestaban «Modo dios activado» y el jugador se
seguía muriendo y chocando con las paredes. Un truco que no hace nada es peor
que uno que no existe: manda a buscar el problema a otro sitio. El primero lo
usa ahora `Character.apply_damage` (y el capturador de pantallas, que sin él
retrataba la pantalla de Game Over en vez de la azotea); el segundo,
`CharacterController`.

### T-07 · Generador procedural de plantas ⬜ `level-procedural`

`game/src/levels/` solo tiene `floor_runner.gd` y `level_loader.gd`. El
evolutivo E-02 está sin empezar. Los 24 mapas de 2012 dan para una partida.

## Bloque C — Que se note que es un juego

### T-08 · Audio de verdad ⬜ `arte-audio`

18 ficheros de sonido en total y una sola pista de música (`credits.ogg`). Hay
buses, `AudioDirector` y el conmutador del paquete de broma; falta el contenido:
música por estado (menú, exploración, combate, jefe) y los eventos 3D que ya
tienen sus llamadas.

### T-09 · Iluminación interior ✅ `arte-audio`

Era real, no un artefacto del renderizador: la cara INTERIOR de un muro no ve
el sol —solo le llega el ambiente— y en la vista cenital salía casi negra
mientras la exterior se leía en gris claro. Subir el ambiente no era la
respuesta (a partir de cierto punto el suelo se sobreexpone y se come la
dirección de arte) y apoyarse más en el aporte del cielo tampoco: eso es
imagen, cambia con el renderizador.

Una oficina se ilumina desde el techo. `WorldLighting` reparte luminarias
`OmniLight3D` sin sombras en rejilla de 4,5 m sobre el suelo REAL —los
triángulos que deja el conversor en el nodo `Floor`, no la caja envolvente, que
en una planta en L tiene la mitad fuera del edificio—, con tope de 48 luces por
planta: si la rejilla se pasa, se separan más las luminarias en vez de cortar
el recorrido y dejar media planta a oscuras. Apagadas en modo Chutaos, que
conserva la luz plana de 2012.

Medido sobre la captura cenital: la mediana de luminancia del interior sube de
150 a 171 sin recorte en las altas (máximo 231 de 255). Y el fallo que casi se
colaba: la primera versión truncaba las columnas con `floor()`, así que un mapa
de 14 × 9 m con 5 m de separación se quedaba en DOS luminarias cada siete
metros — indistinguible de no tener ninguna. Hay prueba del recuento.

`tools/screenshots/capture.sh` acepta ahora `SHOT_TOPDOWN=1`, que conmuta la
cámara a vista cenital antes de capturar: es la única forma de juzgar una
planta entera sin que la cámara en tercera persona se meta en la geometría.

### T-22 · El perímetro se veía negro desde dentro ✅ `arte-audio`

Los muros del perímetro usan la superficie TRIM —acero oscuro— a propósito: es
información táctica, oscuro es infranqueable y claro es tabique que alguien
puede cruzar. Su `metallic` ya se había bajado una vez de 0,85 a 0,45 «porque
salía negro en el interior», y seguía saliendo: **medido** sobre una captura en
tercera persona, luminancia 36 sobre 255 (percentil 10 en 20) junto a un
tabique en 231.

Lo que falló fue el punto de vista de la comprobación: la primera corrección se
validó con una captura CENITAL, donde ese mismo muro se lee como un borde del
mapa y el defecto no aparece. Un metal sin sondas de reflexión solo tiene el
cielo, y una cara vertical que mira a la mitad «suelo» del cielo procedural no
refleja nada.

Con `metallic` a 0,15, albedo 0,40 y rugosidad 0,52 el muro sube a 69 —el
cepillado del acero se ve— y sigue siendo la superficie más oscura de la planta
(tabique 0,74, suelo 0,44), así que la lectura táctica se mantiene sin depender
de un reflejo que en un interior no existe.

De paso, dos cosas de texto que solo se ven mirando: el subtítulo del menú
empezaba con dos puntos («: el mejor juego de la historia», porque la clave
llevaba el signo dentro) y la pantalla de Estrategia titulaba la rejilla de
zonas «Planta siguiente», que se lee como que las zonas son de la planta que
viene. Ahora es «Elige por dónde subes».

Y el capturador acepta `SHOT_SEED`: sin semilla fija, `reset_run()` pone
`run_seed = randi()` y dos capturas de la misma planta traen enemigos distintos
en sitios distintos. Comparar dos capturas es justo para lo que existe esa
herramienta.

### T-10 · La cámara en pasillos estrechos 🟨 `godot-gameplay`

Ya no se mete dentro de las paredes (esfera de 28 cm en el `SpringArm3D`), y
ahora tampoco se queda mirando una nuca ni deja que los compañeros tapen medio
plano. Lo que sigue pendiente es lo de fondo: **desplazar** la cámara en vez de
acortarla.

**Hecho**, porque son las dos consecuencias y se arreglan sin realimentar la
colisión del brazo:

* el PIVOTE sube con el colapso: en un rincón la vista pasa de «sobre el
  hombro» a «sobre la cabeza», que es la que queda libre;
* si el brazo se queda corto de verdad, se esconde el modelo del jugador. Entre
  ver su nuca a diez centímetros y ver la habitación, la habitación;
* y un ALIADO que se ponga entre la cámara y el jugador se vuelve
  semitransparente. Solo aliados: a un enemigo no se le toca la transparencia
  ni cuando tapa, porque su cuerpo es información y ocultarla para limpiar el
  plano es hacerle trampas al jugador en su contra. Ojo: esa propiedad solo la
  respeta Forward+, así que este efecto NO se puede juzgar en una captura de
  CI, que corre en Compatibilidad.

**Intentado y retirado**: elegir entre hombro, eje y hombro contrario el que
deje más brazo. Y el motivo por el que se retiró no es el que parecía, así que
queda escrito para quien lo retome:

> **el banco de pruebas no servía.** El diagnóstico teletransportaba al jugador
> contra el muro más cercano y le ponía el `yaw` mirándolo, y ese `yaw` no se
> aplicaba como se creía: seis ejecuciones del MISMO escenario dieron
> 0,56 · 3,11 · 0,28 · 3,75 · 2,82 · 3,43 m de brazo porque la cámara miraba a
> un sitio distinto en cada una. Comparar dos versiones con ese instrumento es
> comparar ruido, y las conclusiones que salieron de ahí —«el eje está menos
> libre que el hombro»— **no están demostradas**.

Lo que sí quedó medido, y ahorra tiempo al siguiente:

* el rayo y la esfera barrida **sí** ven el perímetro desde dentro (2,35 m y
  2,07 m, exactamente el borde del polígono y el borde menos el radio), así que
  la colisión del zócalo funciona: la sospecha de que la cámara se salía del
  nivel por ahí no está confirmada;
* leer `_camera.global_position` a mitad de frame da un valor que no existe en
  ningún instante — el rig ya se movió y el `SpringArm3D` no ha recolocado a
  sus hijos—. Mismo frame: 0,65 m visto desde dentro del nodo y 3,80 m desde
  fuera. Con eso, el modelo del jugador desaparecía en mitad de un pasillo
  despejado. Lo que hay que preguntar es `get_hit_length()`.

Lo primero que necesita quien lo retome no es código: es un banco de pruebas
que controle de verdad hacia dónde mira la cámara.

### T-11 · Traducción inglesa incompleta ✅ NO REPRODUCE `ui-ux`

Se cerró mirándolo: la pantalla de Estrategia capturada con `SHOT_LOCALE=en`
sale **entera en inglés**. Y en `strings.csv` no falta ni una clave: de las 143,
las 20 cuyo valor coincide en los dos idiomas son nombres propios, formatos
(`%d/%d`), letras de brújula y términos médicos —Protanopia, Deuteranopia—, que
es como tienen que estar.

La captura mezclada que motivó esta tarea salía de una ejecución en la que el
idioma se aplicaba DESPUÉS de construir la pantalla: los textos montados con
`Localization.t()` en `_ready()` quedaban congelados y solo se refrescaban los
`text = "CLAVE"` que traduce `AutoLocalize`. `tools/screenshots/capture.gd` fija
el idioma antes de instanciar nada, así que con la herramienta actual no se
reproduce.

## Bloque D — Publicable

### T-12 · Rendimiento: 60 fps con 40 bots 🟨 `qa-tests`

Ya es un número. `tools/perf_probe/probe.sh` mide dos tramos iguales en la
planta 5 zona 5 con **40 bots**, uno con el planificador de IA encendido y otro
con él apagado: la diferencia es el coste de la IA. Medir solo el total no
distingue «la IA es cara» de «esta máquina es lenta», y el contenedor de CI es
lento.

```
40 bots · 50 clientes en el planificador
frame con IA:  media 5,1 ms · p95 10,9 ms · peor 25,6 ms
frame sin IA:  media 3,1 ms · p95  3,5 ms
coste de la IA: 2,1 ms de media (40 % del frame)
techos respetados: ≤48 rayos/frame, ≤8 decisiones/tick
```

La media cabe con holgura en el frame de 16,6 ms **antes de dibujar**, y los
techos duros de ADR-002 se respetan con 50 clientes. Lo que queda por mirar son
los **picos**: un p95 de 11 ms y algún frame de 25 deja poco sitio al
renderizado, y no son ruido de la máquina —el tramo sin IA tiene un p95 de
3,5 ms—. La sospecha está en el horneado de coberturas y en los lotes de
peticiones de camino; la sonda falla si el p95 pasa de 16,6 ms, así que la
regresión se vería.

Y no está medido lo que no se puede medir en `--headless`: el coste de dibujar.

### T-13 · Export de macOS ✅ `devops-ci`

Estaba descartado con el diagnóstico «exportarlo desde Linux falla en una
comprobación de configuración que Godot no nombra». Era falso, y el método por
el que se cayó merece quedar escrito: **Godot sí nombra el error, pero solo el
último que le queda**. La validación del preset corta en el primero, y con
`application/bundle_identifier` vacío el mensaje es «errores de configuración»
sin decir cuál — se probaron arquitecturas, versiones mínimas, firma y tipo de
distribución a ciegas contra el error equivocado. Con un identificador válido
aparece el de verdad, con nombre y remedio: `Cannot export for universal or
arm64 if ETC2 ASTC texture format is disabled`.

Dos líneas: `textures/vram_compression/import_etc2_astc=true` en
`project.godot` y el preset con su `bundle_identifier`. Sale un `.app`
**universal** (x86_64 + arm64, comprobado con `file`) dentro de un `.zip` de
100 MB, y macOS entra en la matriz de exportación de CI.

Queda sin firmar, así que Gatekeeper lo bloquea la primera vez:
`xattr -dr com.apple.quarantine <app>`. Firmarlo y notarizarlo exige una cuenta
de desarrollador de Apple, que es una decisión del dueño del proyecto, no una
tarea técnica.


### T-14 · README, capturas y guía de contribución ✅ PO Técnico

Capturas generadas con la herramienta (no a mano), sección de descarga del
ejecutable, y una guía de contribución que apunta a lo que de verdad ahorra
tiempo: los cuatro apartados de `CLAUDE.md` y las tres comprobaciones que
tienen que estar en verde.

### T-15 · Licencia del remake (BSD, como el original) y atribuciones ⬜ PO Técnico

`game/assets/LICENCIAS.md` cubre los assets. Falta la licencia del código.

### T-16 · `NavTuning` sigue en código ⬜ `godot-arquitecto`

Era la deuda D.4. La mayoría son presupuestos de ingeniería y se quedan donde
están, pero las de geometría de cobertura son balanceo y deberían vivir en un
`.tres`.

### T-17 · Revisión adversarial de las rutas críticas ⬜ `revisor-critico`

Antes de dar por cerrada la versión: IA, director, navegación y conversión de
mapas.
