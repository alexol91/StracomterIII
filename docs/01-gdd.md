# Stracomter III: Torre Elite — Documento de Diseño de Juego (GDD)

> Remake 2026 de *StracomterIII dos puntos espacio, el mejor juego de la historia*
> (Chutaos Team, Universidad de Alicante, ABP 2011-2012 — matrícula de honor).
> Autores originales: Sergio Gallardo Sales, Alejandro Oñate Latorre,
> Martín Candela Calabuig, Rubén Pardo Millá.

---

## 1. Concepto

**Shooter táctico en tercera persona, por plantas, con escuadra y progresión roguelite.**

Un comando terrorista asalta la **Torre Elite**, la sede de la empresa fundada por
**La Elite**, un grupo de ingenieros informáticos. La torre está tomada de la planta 1
a la 8. Tú eres uno de los cuatro socios fundadores. Subes.

La fantasía no es "soy un supersoldado": es **"esta empresa es mía y voy a recuperarla
planta por planta"**. El escenario es una oficina real —mesas, sillas, estanterías,
plantas de interior, puertas de cristal— y eso es precisamente lo que la hace
memorable: se lucha entre cubículos, no en un búnker genérico.

**Loop de juego (30 s):** entrar en una zona → leer la disposición → limpiar la
resistencia con la escuadra → recoger botín.
**Loop de misión (8-12 min):** elegir zona de la planta → limpiarla → recompensa →
subir.
**Loop de partida (45-90 min):** planta 1 → planta 8 → **azotea (MegaBoss)**.

**Plataformas:** Windows, macOS, Linux. Teclado+ratón y mando.
**Jugadores:** 1 (escuadra controlada por IA). Cooperativo online = evolutivo E-07.

---

## 2. Paridad con el original (alcance obligatorio)

Esto no es un juego nuevo inspirado en el original: es el mismo juego, bien hecho.
Todo lo de esta sección estaba implementado en el C++ de 2012 y **debe existir en el
remake**. Se marca `[P#]` como identificador rastreable en el roadmap.

| Id | Sistema del original | Estado obligatorio en el remake |
|---|---|---|
| P01 | 4 clases jugables con estadísticas propias | Réplica exacta de valores |
| P02 | 3 arquetipos de enemigo + MiniBoss + MegaBoss | Réplica exacta de valores |
| P03 | 8 plantas × 6 zonas, con mapa por combinación | Réplica de la tabla de selección |
| P04 | Recompensa por zona (botiquines y munición t1-t3, rifle) | Réplica |
| P05 | Compañeros de escuadra IA con moral y formación | Réplica + rediseño de IA |
| P06 | Combate: arma de fuego (cadencia/daño), cuchillo, explosivo con radio | Réplica de fórmulas |
| P07 | Conos de visión primario y secundario, ceguera, memoria de objetivos | Rediseño con oclusión real |
| P08 | Puertas que abren/cierran y **alteran la navegación** | Réplica |
| P09 | Mobiliario de oficina como cobertura y obstáculo | Réplica + cobertura táctica real |
| P10 | Pathfinding sobre grafo de navegación con A* | Rediseño sobre navmesh 3D |
| P11 | Composición de enemigos calculada por **Simplex** según área y dificultad | Réplica del algoritmo, objetivo rediseñado |
| P12 | Guardado/carga de partida, puntuación y experiencia por muerte | Réplica |
| P13 | Consola de comandos en juego (`spawn enemy1 x y`) | Réplica ampliada |
| P14 | Menú, selección de planta/zona, créditos, modo libre | Réplica (el modo Estrategia **nunca se terminó**: aquí sí) |
| P15 | Editor de mapas | Rediseño: editor en el propio editor de Godot |
| P16 | Los 26 mapas originales | **Convertidos automáticamente** a escenas 3D |
| P17 | Modo 2D cenital y modo 3D | Cámara conmutable |

> El original tenía `GameStrategy.h` documentado literalmente como
> *"Inutilizado por el momento"*. El modo Estrategia era el hueco del proyecto de 2012.
> En el remake es una pantalla real: es donde vive la decisión interesante (§6).

---

## 3. Personajes jugables

**Fuente canónica: `legacy/trunk/testFiles/features/f1.xml`.** La arqueología del código
(`docs/analisis/legacy-gameplay.md` §3.1) determinó que las constantes de
`CoreNamespace.h` estaban en una rama **inalcanzable** de `Character::generateFeatures`
—el singleton `CharacterFeature::getInstance()` nunca devuelve `NULL`, así que el `else`
con los valores del header era código muerto— y que `entities.xml` usaba un esquema que
el parser ni reconoce. El juego de 2012 corría con `f1.xml`. Esos son los valores del
remake.

| Clase | HP | Vel. | Fuerza | Cadencia (ms) | Daño | Moral | Rol real en 2012 |
|---|---|---|---|---|---|---|---|
| **Capitán** | 160 | 400 | 3 | 100 | 10 | 3 | **Aura de moral** (radio 200 u): regenera +1 HP/2 s a los aliados cercanos |
| **Técnico** | 85 | 500 | 4 | 80 | 7 | 2 | El más rápido y de mayor cadencia. Sin habilidad pasiva |
| **Especialista** | 125 | 400 | 4 | 200 | 5 | 2 | **Aura de munición** (radio 200 u): +10 balas/4 s a los aliados |
| **Explosivo** | 110 | 450 | 4 | 500 | 60 | 2 | Su disparo **primario es una explosión** (radio 150 u, caída lineal), no un rayo |

Comunes a todos: munición inicial **50**, cuchillo **30** de daño con **500 ms** de
cadencia, radio de cuerpo 30 u.

> Los valores del header (Capitán 100/150, Técnico 85/175…) se conservan documentados
> como **variante de balanceo alternativa**, seleccionable por datos. Son más lentos y
> más equilibrados; puede que sean mejores. Pero no son los que se jugaron.

**Habilidades activas (nuevo, `E-01`).** En el original las cuatro clases se
diferenciaban en estadísticas y en dos auras pasivas: elegir clase era elegir números.
Se añade una habilidad activa por clase que convierte esa elección en una forma de jugar:
*Órdenes* (Capitán), *Hackeo* (Técnico), *Supresión* (Especialista), *Demolición*
(Explosivo — abre un muro nuevo y obliga a rehornear navegación y coberturas en caliente).

**Moral.** En el original la moral **solo habilitaba la regeneración del aura del
Capitán**; no era un recurso de escuadra, y el estado `ComeBack` de los compañeros era
inalcanzable. Se replica el aura como paridad (`[P05]`) y se **amplía**: la moral pasa a
modular también la obediencia de los compañeros, que es el hueco que el original dejó
abierto.

**Progresión intra-partida:** cada muerte da experiencia (`expKill`), que se gasta al
final de cada planta en la pantalla de Estrategia.

## 4. Enemigos

Valores en vigor (`f1.xml`). Ojo a las cadencias: son **5-8 veces más lentas** que las
del header, y es lo que hacía el combate de 2012 legible en lugar de una lluvia de balas.

| Arquetipo | HP | Vel. | Cadencia | Daño | XP | Comportamiento |
|---|---|---|---|---|---|---|
| **Sicario** (`enemy1`) | 45 | 150 | 500 | 1 | 3 | Frágil y numeroso. Presiona por volumen, no por daño |
| **Miliciano** (`enemy2`) | 50 | 140 | 800 | 3 | 5 | Equilibrado. Usa cobertura y flanquea |
| **Veterano** (`enemy3`) | 65 | 130 | 600 | 2 | 7 | Duro. Suprime y avanza en formación |
| **MiniBoss** | 200 | 80 | 500 | 30 | 50 | Guardián de planta. Ataque **explosivo en área**, como el Explosivo |
| **MegaBoss** | 500 | 60 | 200 | 10 | 500 | Azotea. Fases + refuerzos |

Munición enemiga: **50 balas sin regeneración** (en el original, un enemigo que las
gastaba se quedaba inútil — el remake lo corrige haciendo que recargue o cambie a cuerpo
a cuerpo).

El jugador es **2,5-3,8× más rápido** que cualquier enemigo con los valores de `f1.xml`.
Eso no es un error de balanceo: es la fantasía del juego, y se conserva. Lo que compensa
la diferencia no son las estadísticas enemigas sino **la coordinación** (§8), que es
precisamente lo que el original no tenía.

Los tres arquetipos base **no cambian de estadísticas** entre plantas: lo que cambia es
cuántos hay, de qué tipo y cómo se comportan, y eso lo decide el Director (§7). Subir HP
planta a planta es la forma barata de escalar dificultad; escalar composición y táctica
es la buena, y es la que honra el algoritmo original.

## 5. La Torre Elite

9 niveles. Cada planta tiene **6 zonas**; el jugador elige por qué zona entra, y la
zona determina el mapa y la recompensa.

| Planta | Nombre | Tema | Amenaza |
|---|---|---|---|
| 1 | Recepción y vestíbulo | Mármol, tornos, mostrador | Sicarios. Tutorial encubierto |
| 2 | Soporte y CAU | Cubículos, tickets impresos | Sicarios + Milicianos |
| 3 | Desarrollo | Mesas dobles, pizarras, cafeteras | Milicianos. Primer MiniBoss |
| 4 | QA y preproducción | Salas de pruebas, racks | Composición mixta |
| 5 | CPD | Pasillos fríos, rejillas, poca luz | Veteranos. Cobertura escasa |
| 6 | Comercial y marketing | Diáfano, cristal, moqueta | Combate a distancia larga |
| 7 | Dirección | Despachos cerrados, madera | Veteranos + MiniBoss |
| 8 | Sala de juntas | El mapa final del original (`finalMap.xml`) | Asalto completo |
| 9 | Azotea | Helipuerto, viento, noche | **MegaBoss** |

**Mapas.** Tres fuentes, en este orden de prioridad:
1. **Convertidos del original** (`[P16]`): los 26 XML de `legacy/trunk/testFiles/maps/`
   se convierten automáticamente a escenas 3D. Es diseño de nivel real, hecho a mano en
   2012 por cuatro personas, y tirarlo sería absurdo.
2. **Autorales nuevos** para las plantas temáticas que lo necesiten.
3. **Procedurales** (`E-02`): generador de plantas de oficina para rejugabilidad.

**Tabla de mapas del original**, reconstruida de `GameAction::selectionMap`. Se replica
tal cual (`[P03]`), incluidas sus rarezas —la planta 3 usa el mismo mapa en cuatro zonas
y `mapM2.xml` no se usaba nunca:

| Planta \ Zona | 1-2 | 3-4 | 5-6 |
|---|---|---|---|
| 1 | `mapP1` | `mapM1` | `mapG1` |
| 2 | `mapP2` | `mapM1` | `mapG2` |
| 3 | `mapP3` | `mapG3` | `mapG3` |
| 4 | `mapP4` | `mapM4` | `mapG4` |
| 5 | `mapP1` | `mapG1` | `mapG1` |
| 6 | `mapP2` | `mapG2` | `mapG2` |
| 7 | `mapP3` | `mapM3` | `mapG3` |
| 8 | `finalMap` en las seis zonas | | |

Los prefijos son las iniciales de sus autores (P: Pardo, M: Martín, G: Gallardo), y por
eso hay tres tamaños de mapa por planta: pequeño, mediano y grande. Esa correspondencia
—zona baja = mapa pequeño = menos enemigos = recompensa peor— es la lógica de diseño que
el remake conserva y explicita en la pantalla de Estrategia.

**Escala.** El legacy usa unidades donde el radio del personaje es 30. El remake
trabaja en metros con el personaje a 0,4 m de radio → **factor de conversión 1 u = 1/75
m (≈0,0133)**. Los muros se extruyen a 3,0 m de altura; las puertas a 2,1 m.

---

## 6. Modo Estrategia — la decisión que el original nunca tuvo

Entre plantas, el juego se detiene y muestra el **plano de la planta siguiente** con sus
6 zonas. Cada zona anuncia dos cosas: **su recompensa** y **una lectura de su amenaza**.

| Zona | Recompensa (exacta del original) | Coste táctico (nuevo) |
|---|---|---|
| 1 | +20 munición | Mapa pequeño, ruta corta, poca cobertura |
| 2 | +20 vida | Mapa pequeño, enemigos agrupados |
| 3 | +50 munición | Mapa mediano (zona por defecto del original) |
| 4 | +50 vida | Mapa mediano, más puertas cerradas |
| 5 | +100 munición | Mapa grande, presencia de MiniBoss |
| 6 | +100 vida | Mapa grande, espacio abierto y visión larga |

**Cómo se elegía la zona en 2012, y por qué se cambia.** El original no dejaba elegir:
mostraba una ruleta octogonal cuyos tres sectores tenían **tamaños aleatorios**
(`TRadioButton::Octogonal`), y el número de porciones de un sector *era* el número de
zona. Sólo se podían obtener cuatro repartos —(3,2,3), (4,2,2), (5,1,2), (6,1,1)— y las
zonas 4-6 sólo aparecían en el sector grande. Era ingenioso y era **azar disfrazado de
decisión**: el jugador pulsaba un color, no elegía una ruta.

El remake mantiene la tensión (mapa grande = más enemigos = mejor recompensa) pero la
convierte en **elección informada**: se ve el plano, la recompensa y una lectura de
amenaza, y se decide. El azar se queda donde aporta —la composición enemiga y su
posición, que las decide el Director— y no en el menú.

Aquí también se gasta la experiencia, se reasigna la escuadra (qué compañeros llevas y
con qué clase) y se reparan las bajas. **El plano se ve, la composición enemiga no**:
el jugador decide con información parcial, que es lo que convierte una elección en una
decisión.

Esto cierra el hueco de `GameStrategy` y da al Simplex del original un lugar donde
importar: el presupuesto de amenaza de la zona elegida es la entrada del Director.

---

## 7. Director de encuentros — el Simplex, 14 años después

El original resolvía un problema de programación lineal para decidir la composición
enemiga (`legacy/trunk/Optimization/lib/Optimization.cc`):

```
MaxEnemies = log((área / 250) · dificultad) · 10

Max  z = x1 + x2 + x3
s.a.  60·x1 + 100·x2 + 120·x3 ≤ (280/3)·MaxEnemies    (presupuesto de daño)
      45·x1 +  50·x2 +  65·x3 ≤ (155/3)·MaxEnemies    (presupuesto de vida)
      60·x1 +  45·x2 +  35·x3 ≤ (140/3)·MaxEnemies    (presupuesto de velocidad)
      x1, x2, x3 ∈ ℤ⁺
```

**Un defecto real de la formulación original, y hay que arreglarlo.** La arqueología
(`docs/analisis/legacy-ai-optimization.md` §6) resolvió la LP por fuerza bruta y el
resultado es revelador: con los coeficientes de 2012, el óptimo entero es
**masivamente degenerado hacia el enemigo tipo 2** — para `MaxEnemies = 30` la solución
es `3 / 26 / 0`. Es decir: la "composición adaptativa" del original producía, en la
práctica, 26 Milicianos y nada más, planta tras planta. El algoritmo era correcto; la
formulación no describía el problema que se quería resolver.

El remake **conserva el solucionador y reformula el problema**: se sustituye el objetivo
`max x1+x2+x3` (que sólo premia contar cabezas) por uno que persigue una **composición
objetivo** por planta, con cotas mínimas y máximas por arquetipo, para que la solución
sea variada por construcción y no por casualidad. Los coeficientes originales se
conservan como datos en `DirectorProfile` para poder comparar ambas formulaciones.

**Se conserva el algoritmo. Se cambia de dónde vienen los números.**

En 2012, `dificultad` era una constante por planta y `área` un dato geométrico: el
Simplex era un ejercicio académico correcto pero con entradas muertas. En el remake, el
vector de entrada lo produce un **modelo vivo de habilidad del jugador**:

```
dificultad_efectiva = dificultad_planta · f(perfil_jugador)

perfil_jugador ← media móvil de:
    precisión de disparo            (aciertos / disparos)
    daño recibido por minuto
    tiempo de limpieza por zona vs. mediana
    bajas de la escuadra
    uso de coberturas y de habilidad de clase
```

Y las restricciones dejan de ser tres presupuestos fijos para incorporar la **forma del
mapa**: densidad de coberturas, longitud media de línea de visión y número de accesos
a la zona. Un mapa abierto y largo admite Veteranos; un pasillo estrecho se resuelve
mejor con Sicarios. El Simplex ahora **responde a la geometría real y al rendimiento
real**, no a una constante.

Encima del Simplex se añade la capa que el original no tenía: **ritmo**. La composición
total no aparece de golpe, se libera con una curva de tensión de cuatro fases
(`ascenso → pico → alivio → descanso`), estilo director de *Left 4 Dead*:

* **Ascenso:** oleadas pequeñas mientras el jugador avanza.
* **Pico:** se gasta el resto del presupuesto de golpe.
* **Alivio:** se dejan de generar enemigos, se permite recoger botín.
* **Descanso:** silencio forzado de 20-40 s antes de la siguiente zona.

**Reglas de aparición (spawn).** Aleatorio pero nunca injusto:
* Sobre navmesh navegable, a **≥ 12 m** del jugador (el original usaba 200 u ≈ 2,7 m,
  que es demasiado cerca y produce apariciones a la cara).
* **Nunca dentro del cono de visión del jugador** ni con línea de visión directa.
* Preferentemente en **puntos de entrada reales** —puertas, huecos de escalera,
  ascensores— y no en medio de una sala.
* Reparto ponderado por distancia de camino, no por distancia euclídea.

---

## 8. Inteligencia de los bots — lo que sustituye a la FSM

El original usaba una máquina de estados finitos de 5 estados por enemigo
(`Patrol → Attack → Pursue → Ensure`, con transiciones por códigos numéricos 10/20/30/40).
Funcionaba, y era exactamente lo que pedía la asignatura. Como IA de combate es
insuficiente: un bot con FSM plana no tiene memoria útil, no coopera, no razona sobre
el espacio y se delata en cuanto el jugador se asoma dos veces por la misma esquina.

La arquitectura nueva tiene **cuatro capas**, y ninguna de ellas es una FSM plana:

### 8.1 Percepción (por bot)
* **Vista:** cono de FOV con **raycast de oclusión real** (el original comprobaba
  inclusión en un triángulo, sin comprobar si había pared en medio). Dos conos, como el
  original: primario (foco, detección rápida) y secundario (periférico, detección lenta).
* **Oído:** los disparos, explosiones, puertas y pasos emiten eventos sonoros con
  intensidad y radio; la propagación se estima por **coste de camino en navmesh**, no
  por distancia recta. Un disparo al otro lado de una pared se oye lejano; el mismo
  disparo al final de un pasillo recto se oye encima.
* **Memoria:** cada contacto se guarda con **posición, antigüedad y confianza**, y la
  confianza decae con el tiempo. Un bot no "olvida de golpe": va a buscarte a donde
  cree que estás, y se equivoca de forma creíble.
* **Contacto compartido:** al detectar, el bot difunde el contacto a su escuadra con un
  retardo de reacción (0,3-0,8 s según arquetipo). Así el grupo reacciona como grupo
  sin que todos tengan visión mágica.

> **Escala de percepción: cambio deliberado y documentado.** El original usaba un cono
> de **500 u ≈ 6,7 m y ±20°**, y su cono secundario era código inalcanzable
> (`isInsideFOV` nunca devolvía 2). Con esos valores en un mapa de 30 m los bots están
> prácticamente ciegos y sólo reaccionan cuando ya los tienes encima. El remake usa
> 18-30 m según arquetipo y ±30-45° de cono primario, y **sí** implementa el secundario.
> Es la diferencia entre un enemigo que te embosca y uno que se tropieza contigo.

### 8.2 Decisión (utilidad + árbol de comportamiento)
Un **selector por utilidad** puntúa 0..1 un conjunto de comportamientos
(`Atacar`, `Flanquear`, `Suprimir`, `Buscar cobertura`, `Recargar`, `Reagrupar`,
`Investigar`, `Retirarse`, `Patrullar`) según vida, munición, distancia, exposición,
confianza del contacto y rol asignado. El de mayor utilidad se **ejecuta como árbol de
comportamiento**, que es lo que aporta secuencias fiables y abortos limpios.

Utilidad para *decidir qué*, árbol para *ejecutar cómo*. Es la combinación que evita
los dos fallos clásicos: el árbol puro no sabe priorizar, y la utilidad pura produce
bots indecisos que cambian de idea cada frame (se corrige con histéresis y un tiempo
mínimo de compromiso por comportamiento).

### 8.3 Táctica espacial — puntos de cobertura
Se **hornea offline** una nube de puntos de cobertura a partir de la geometría del
nivel: para cada punto navegable se lanzan raycasts en 8 direcciones a altura de pecho
y de cabeza, y se clasifica como cobertura alta, baja o nula por dirección.

En tiempo de ejecución, un bot que quiere cobertura puntúa los candidatos por:
`protección frente a las amenazas conocidas − exposición a las demás − coste de camino
+ progreso hacia el objetivo`. Esto es lo que sustituye a la triangulación Delaunay del
original: el original triangulaba para *poder navegar*; aquí se usa la geometría para
*decidir dónde ponerse*. Y es lo que hace que un enemigo parezca inteligente.

### 8.4 Coordinación de escuadra
Un **Director de Escuadra** por grupo mantiene una pizarra compartida y **reparte roles
sin duplicarlos**: `Fijador` (mantiene la presión de frente), `Flanqueador` (rodea por
otra ruta del navmesh), `Asaltante` (avanza cuando hay supresión), `Reserva`.

Reglas que se hacen cumplir a nivel de grupo:
* No más de un flanqueador por ruta, y el flanqueo se calcula con rutas de navmesh
  realmente disjuntas, no con "ángulo + 90°".
* Nadie asalta sin supresión activa de un compañero.
* Si el grupo baja del 40 % de efectivos, se repliega a la sala anterior y se reagrupa
  en lugar de morir de uno en uno.
* Los ángulos de cobertura se reparten para que el grupo no mire todo al mismo sitio.

### 8.5 Los compañeros usan el mismo cerebro
Los compañeros del jugador (`[P05]`) corren la **misma** arquitectura con otra tabla de
utilidad: se anteponen la formación, la cobertura del jugador y el fuego de apoyo. El
jugador puede dar tres órdenes (`Ir ahí`, `Enfocar eso`, `Mantener posición`), y la
**moral** modula la obediencia: con moral baja, un compañero prioriza sobrevivir. Un
solo sistema de IA sirve para amigos y enemigos; eso es la mitad del código y el doble
de calidad en los dos lados.

### 8.6 Presupuesto de CPU
La IA se reparte en el tiempo (*time-slicing*): percepción a 10 Hz, decisión a 5 Hz,
navegación bajo demanda, y **como máximo N raycasts de percepción por frame** en toda
la escena, con cola de prioridad por cercanía al jugador. Objetivo: **60 fps con 40
bots activos** en un portátil sin GPU dedicada.

---

## 9. Combate

Todo hitscan, sin proyectiles, igual que el original.

| Regla | Original (2012) | Remake | Motivo del cambio |
|---|---|---|---|
| Alcance del arma | 500 u ≈ **6,7 m** | 26-34 m según arma | 6,7 m en un mapa de 30 m es una pelea a cuchillo; en tercera persona 3D es injugable |
| Munición inicial | 50 balas | 50 (por cargador, con recarga) | El original no tenía recarga: gastabas 50 y quedabas inútil |
| Munición enemiga | 50 balas **sin regeneración** | Recargan o pasan a cuerpo a cuerpo | Un Sicario del original sólo podía hacer 50 de daño **en toda la partida** |
| Bala al fallar | Se consume igual | Se consume igual | Correcto: penaliza disparar al aire |
| Cuchillo | 30 daño, cadencia 500 ms, alcance 80 u ≈ 1,07 m | Idéntico | Réplica |
| Explosión | radio 150 u ≈ **2 m**, `daño × (1 − dist/150)`, requiere línea de visión | Idéntica, con caída lineal y LOS | Réplica exacta |
| Fuego amigo | **Total** (el filtro estaba comentado) | Sólo en explosiones | Total en hitscan es frustrante con compañeros IA; en explosivos es lo que da peso a la clase |
| Granada | Espacio, **gratis**: sin munición ni cadencia, 50 daño, sin puntos | Recurso limitado, con cadencia, da puntos | Era resto de depuración, no diseño |
| Daño localizado | No existía | cabeza ×2,5 · torso ×1 · extremidades ×0,7 | Es lo que hace que apuntar importe |
| Salud | No regenera; aura del Capitán da +1 HP/2 s en radio 200 u | Igual, con el aura como paridad (`[P05]`) | Réplica |
| Puntuación | = experiencia de la víctima (3/5/7/50/500) | Igual, y la XP se gasta en Estrategia | El original acumulaba XP sin nada en que gastarla |

**Coberturas.** El mobiliario para balas según altura: una mesa protege agachado, una
planta de interior no protege nada pero **rompe la línea de visión**, que a veces vale
más. El original tenía el mobiliario pero sólo como obstáculo de colisión; aquí es
información táctica para las dos partes.

## 10. Interfaz

* **HUD:** vida, munición, moral/escuadra, puntuación, tiempo, brújula de planta,
  indicador de dirección del daño. Réplica de lo que mostraba `UpdateGraphics`, más lo
  que hoy es imprescindible.
* **Pantallas:** Título · Selección de clase · **Estrategia (§6)** · Acción · Pausa ·
  Fin de planta · Game Over · Victoria · Créditos (con los cuatro nombres originales) ·
  Opciones.
* **Consola** (`[P13]`): `spawn <tipo> <x> <y>`, `god`, `noclip`, `give <objeto>`,
  `floor <n>`, `ai.debug`, `nav.debug`, `director.status`, `cover.debug`. La consola es
  la herramienta de trabajo de los agentes: es como se prueba el juego sin manos.
* **Accesibilidad:** remapeo completo, subtítulos, escala de HUD, modo daltónico,
  sensibilidad y FOV ajustables, opción de desactivar sacudida de cámara.
* **Idiomas:** español y inglés desde el primer día.

---

## 11. Arte y sonido

Estética **cel-shading con contorno**, recuperando el `CellShading.frag` que el equipo
original ya tenía escrito. Es una elección honesta: permite que assets sencillos se vean
deliberados en lugar de pobres, y conecta con el shader del proyecto de 2012.

* Paleta: gris corporativo y azul Elite para la torre; naranja y rojo para los hostiles
  (los colores exactos que el original asignaba por tipo de entidad).
* Modelos: bloqueo con primitivas primero, glTF después. **Ningún `.3ds` del original se
  reutiliza**: el formato está muerto y varias texturas del legacy son de terceros
  (`*_flat.tga` con nombres de clases de Team Fortress 2) — riesgo legal, se rehacen.
* Sonido: eventos posicionales 3D, música por estado (menú, estrategia, combate,
  tensión, jefe). Las voces cachondas del original (`testFiles/sound/joke/`) se
  preservan como **paquete de sonido opcional "Chutaos"**, porque son parte de la
  identidad del proyecto.

---

## 12. Cómo se sabe que está bien

| Métrica | Objetivo |
|---|---|
| Rendimiento | 60 fps con 40 bots, portátil sin GPU dedicada |
| Tiempo de carga de planta | < 3 s |
| Duración de zona | 6-12 min |
| Partida completa | 45-90 min |
| Muertes por partida (jugador medio) | 3-8 |
| Cobertura de tests de sistemas de IA y Director | ≥ 80 % |
| Arranque en headless sin errores | Obligatorio en CI |
| Los 26 mapas legacy convertidos y navegables | Obligatorio |

**Criterio de "IA buena", medible y no opinable:** en una prueba automatizada de 100
encuentros, los bots deben (a) usar cobertura en > 70 % de los intercambios,
(b) flanquear en > 30 % de los encuentros con dos o más accesos, (c) no quedarse nunca
atascados > 3 s sin ruta, (d) no disparar nunca a través de geometría opaca.

---

## 13. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| GDScript insuficiente para 40 bots | Alto | Time-slicing desde el día 1 (§8.6); salida a GDExtension C++ |
| Conversión de mapas produce geometría inválida | Alto | Validador automático: navmesh no vacío + todas las zonas conectadas |
| La IA "buena" se percibe como injusta | Medio | Reglas de aparición justas (§7), retardo de reacción, tiempo de gracia al detectar |
| Assets de terceros en el legacy | **Legal** | Auditoría de assets; se rehace todo lo dudoso |
| Alcance excesivo | Alto | Paridad (§2) primero; evolutivos (`05-evolutivos.md`) después, y solo después |
| Simplex infactible con presupuestos extremos | Bajo | Reserva a distribución uniforme, igual que el original |
