# Evolutivos — de "réplica funcional" a "juego que apetece jugar"

La paridad con el original (GDD §2) hace que el juego **exista**. Estas propuestas son
las que hacen que alguien lo juegue dos veces. Regla del equipo nº 6: **nada de aquí se
empieza hasta que la tabla `[P01]..[P17]` esté cerrada.**

Cada evolutivo lleva **impacto** (cuánto mejora el juego) y **coste** (cuánto trabajo es).
Están ordenados por relación impacto/coste, que es el único orden que importa cuando el
tiempo es finito.

---

## Prioridad alta — poco trabajo, mucho juego

### E-01 · Habilidades de clase · Impacto alto · Coste bajo
En el original las cuatro clases se diferenciaban **solo en estadísticas**: elegir clase
era elegir un número, no una forma de jugar. Una habilidad activa por clase cambia eso
por completo:

* **Capitán — Órdenes:** marca un objetivo y toda la escuadra lo enfoca.
* **Técnico — Hackeo:** abre puertas cerradas, desactiva cámaras y torretas.
* **Especialista — Supresión:** fuego sostenido que fija a los enemigos en cobertura.
* **Explosivo — Demolición:** abre un **muro nuevo** en el mapa, creando una ruta que no
  existía.

La de Demolición es la más interesante y la que exige más del resto del sistema: si el
Explosivo abre un muro, el navmesh y la nube de coberturas deben **rehornearse en
caliente** y la IA adaptarse a una topología que no existía al empezar el nivel. Es
exactamente el tipo de cosa que un motor moderno permite y que en 2012 era impensable.

### E-02 · Generación procedural de plantas · Impacto alto · Coste medio
Los 26 mapas convertidos dan una campaña. Un generador de plantas de oficina da
**rejugabilidad indefinida**. Grafo de salas primero, geometría después, temas por planta,
y siempre ≥ 2 rutas al objetivo para que la IA pueda flanquear. Determinista por semilla:
una planta interesante se puede compartir con un número.

### E-03 · Director adaptativo completo · Impacto alto · Coste medio
Ya está en el alcance de paridad como pieza central (§7 del GDD), pero su versión
completa merece nombre propio: el Simplex alimentado por un modelo vivo de habilidad,
restricciones sensibles a la geometría del mapa y curva de tensión. Es **la** razón
técnica por la que este remake es más interesante que el original, y la forma de que el
juego sea difícil sin ser injusto.

### E-04 · Sonido como información táctica · Impacto alto · Coste bajo
Si el oído de los bots se propaga por el navmesh (§8.1), el **jugador** debería tener la
misma herramienta: pasos audibles y direccionales, disparos que delatan posición,
puertas que se oyen abrir, y la opción de **caminar sigiloso** a cambio de velocidad.
Convierte cada planta en un problema de información, no solo de puntería. Coste bajo
porque la mitad del sistema ya existe para la IA.

### E-05 · Física y destructibilidad de oficina · Impacto medio · Coste bajo
El escenario es una oficina: sillas que ruedan, monitores que estallan, papeles que
vuelan, cristal que se rompe y **deja de dar cobertura visual al romperse**. Con Jolt
sale casi gratis y es lo que hace que el espacio se sienta real en lugar de pintado.

---

## Prioridad media — cambian la forma del juego

### E-06 · Meta-progresión roguelite · Impacto alto · Coste medio
Al morir se pierde la partida pero se conserva un recurso persistente para desbloquear
clases, mejoras y variantes de arma. Convierte una derrota en progreso y una campaña de
90 minutos en algo que se juega veinte veces. Es el cambio que más alarga la vida del
juego por unidad de trabajo.

### E-07 · Cooperativo online 2-4 jugadores · Impacto muy alto · Coste alto
Cuatro clases, una escuadra, una torre: el juego **está pedido** para cooperativo, y las
cuatro clases del original con habilidades complementarias (E-01) lo piden a gritos.
Coste alto y honesto: el multijugador se diseña desde el principio o se paga muy caro
después. Requiere autoridad del servidor, predicción del cliente y reconciliación, y
obliga a que el director trabaje con el rendimiento **agregado** del grupo.
Recomendación: **decidir pronto si se hará**, aunque se implemente tarde, porque
determina la arquitectura de estado.

### E-08 · Modo Horda en la azotea · Impacto medio · Coste bajo
Oleadas infinitas con el director subiendo el presupuesto de amenaza sin techo, tabla de
puntuaciones y una sola planta. Es el modo más barato de construir que existe (todos los
sistemas ya están) y el que más horas de juego da por línea de código.

### E-09 · Editor de niveles en el juego · Impacto medio · Coste medio
El original tenía editor de mapas (`mapEditor.cc`) y `[P15]` lo resuelve usando el editor
de Godot. Un editor **dentro del juego**, con validación de navegación en vivo y
compartición de mapas, es lo que convierte a los jugadores en autores. Encaja
especialmente bien con el conversor: el formato de salida ya está definido.

### E-10 · Bots con personalidad y aprendizaje intra-partida · Impacto alto · Coste medio
Los bots ya tienen tablas de utilidad por arquetipo. Dos pasos más:
1. **Variación individual:** cada bot recibe pequeñas desviaciones (agresividad, puntería,
   paciencia). Dos Milicianos dejan de ser el mismo Miliciano.
2. **Adaptación dentro de la partida:** el director observa **cómo** gana el jugador (¿se
   asoma siempre por la izquierda? ¿siempre flanquea? ¿camina o corre?) y ajusta los pesos
   de los bots de las plantas siguientes. Nada de aprendizaje automático: heurísticas
   observables, depurables y **desactivables**. La sensación buscada es "estos me han
   cogido el truco", que es memorable, no "esto hace trampa", que es odioso.

---

## Prioridad baja — cuando todo lo demás funcione

### E-11 · Cámara conmutable con modo 2D cenital · Coste bajo
El original tenía modo 2D y 3D (`isMode3D`). Recuperarlo como opción táctica —vista
cenital que muestra más del mapa a cambio de menos inmersión— es barato y guiña al
proyecto de 2012.

### E-12 · Repeticiones y modo espectador · Coste medio
Grabar las entradas y la semilla del director permite **reproducir una partida entera**.
Además de ser una función atractiva, es la mejor herramienta de depuración de IA que
existe: un bug de comportamiento deja de ser "me pasó una vez" y pasa a ser un fichero.

### E-13 · Steam Workshop / mapas de la comunidad · Coste medio
Depende de E-09. Los mapas ya son texto plano y validables: la infraestructura está.

### E-14 · Extra "Chutaos" · Coste bajo
Una planta secreta que reproduce el `editorMap.xml` original con el paquete de voces
cachondas, los colores planos de 2012 y los cuatro nombres del equipo en las mesas. Es
puro cariño por el proyecto y cuesta una tarde.

---

## Lo que deliberadamente NO se hará

| Descartado | Motivo |
|---|---|
| Microtransacciones, pases, moneda premium | Es un experimento personal, no un producto |
| Enemigos que escalan HP por planta | Escalar números es la forma barata de dificultad; escalar composición y táctica es la buena, y es la que honra al Simplex original |
| Regeneración automática de salud | Elimina la tensión y hace irrelevantes las recompensas por zona (`[P04]`) |
| Bots con visión o audición perfecta | Difícil ≠ injusto. Un bot que hace trampa se nota y quema la confianza del jugador |
| Aprendizaje automático en la IA | No depurable, no determinista, no testeable. Rompe los tres principios de la arquitectura para resolver un problema que las heurísticas ya resuelven |
| Portar los cinco motores propios del legacy | El motor gráfico, físico, de sonido, de partículas y la GUI eran el ejercicio académico de 2012. Reimplementarlos hoy es trabajo sin valor: Godot los da hechos y mejores |
