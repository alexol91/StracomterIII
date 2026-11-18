# Decisiones

Todo lo que se aparta de `DEFINICION-DEL-JUEGO.md`, lo que el documento dejaba sin fijar y de dónde
sale cada cosa de terceros. Una línea por decisión: qué y por qué.

## Tecnología (el documento no la fijaba)

* **Web: TypeScript + Vite + three.js.** Se abre con un enlace en ordenador y móvil, y el resultado
  (`dist/`, rutas relativas) se puede empotrar tal cual en un WebView de app.
* **La simulación (`src/sim`) no depende del navegador.** Se ejecuta igual en Node: así se pueden
  jugar partidas enteras sin pantalla (`npm run partida`) y probar la lógica con `vitest`.
* **Guardado en `localStorage`** (clave `stracomter3.save`). Sin servidor.

## Cosas del documento que he cambiado o interpretado

### Contradicciones del propio documento (dichas en voz alta)

* **Dificultad.** §8 dice que la tabla de enemigos es «en dificultad Normal» y §17 que Normal
  multiplica por 1,3. No pueden ser verdad las dos. He tomado la tabla como Normal: Fácil = tabla ÷ 1,3,
  Normal = tabla, Difícil = tabla × 1,5 ÷ 1,3 (se conserva la proporción 1,0 / 1,3 / 1,5).
* **«Nunca a menos de 12 m» en el mapa pequeño de muestra.** El mapa mide 14 × 9 m: muchas veces no
  existe ningún punto a 12 m que además no se vea. Regla aplicada: 12 m siempre que exista; si durante
  3 s no hay sitio, se afloja de 2 en 2 m (mínimo 5 m). **Lo que no se afloja es «fuera de la vista»**
  salvo como último recurso tras 15 s sin sitio (azotea despejada), y entonces solo a la espalda del
  jugador y lo más lejos posible.
* **La azotea tiene una sola zona**, no seis. La tabla del §8 solo da una fila para la planta 9 y seis
  entradas con el mismo mapa y recompensas distintas (después del final no hay nada que cobrar) serían
  una elección falsa.
* **«Descanso: silencio, 20-40 s, y a la siguiente zona».** Como se juega una zona por planta, el
  descanso es la pantalla de fin de planta: la zona se da por limpia en cuanto no queda nadie vivo ni
  por salir (que es lo que manda el propio §8).

### Números cambiados

* **Bajadas de las plantas 5 y 7 suavizadas** (el documento lo permitía): zonas pequeñas 25→34 y
  35→38; planta 6 pequeña 32→36; planta 3 grande 34→38; planta 7 mediana/grande 47/42→48/49. La curva
  ya no baja.
* **Las auras incluyen a quien las lleva.** Si el jugador es el Especialista y su aura no le da balas a
  él, tiene 50 balas de 5 de daño para toda la campaña.
* **El multiplicador por zona (cabeza ×2,5, extremidades ×0,7) solo se aplica a los disparos de la
  escuadra.** Los enemigos hacen siempre su daño base. Con 40 tiradores, los ×2,5 fortuitos mataban al
  jugador de golpe sin que pudiera hacer nada; «apuntar importa» habla de quien apunta.
* **El ataque del MiniBoss es un cohete que viaja** (9 m/s, visible), no un impacto instantáneo como el
  resto de balas. 30 de daño en área, instantáneo y a 2 disparos/s mataba a un Técnico en 1,5 s sin
  posibilidad de esquivar. Dispara de dos en dos y recarga (2,6 s).
* **El MegaBoss pelea por fases con escudo.** Al bajar a 2/3 y a 1/3 de vida se cubre con un escudo y
  llama a 12 refuerzos; el escudo cae cuando quedan 3 o menos (o a los 45 s, para que nunca bloquee la
  partida). Con 500 de vida y una escuadra que hace más de 200 de daño por segundo, sin esto el final
  del juego duraba tres segundos. Total de refuerzos: 24, más una escolta inicial de 6. Dispara en
  ráfagas de 0,8 s con pausas de 2,6-3,8 s y es muy impreciso contra un blanco que corre (quedarse
  quieto delante de él sí se paga). En fase 2 añade granadas y en fase 3 cohetes y más velocidad.
* **Los jefes no se quedan sin munición.**
* **Botín de los enemigos.** Al morir sueltan a veces una caja de munición pequeña (12 %) o un botiquín
  pequeño (10 %); los jefes, un botiquín mediano. La vida no se regenera y se arrastra de planta en
  planta: sin esto la campaña no se podía terminar, y si muere el Especialista la escuadra se queda sin
  balas.
* **Turnos de fuego.** Contra un mismo blanco solo dispara a la vez un número limitado de enemigos
  (jugador: 2 + planta/3; compañero: 2). El resto se cubre o maniobra. No está en el documento; sin
  ello una planta diáfana con 40 enemigos es un fusilamiento.
* **Seguro del lanzador del Explosivo.** El jugador Explosivo no puede disparar contra algo que tiene a
  menos de 2,6 m (suena el clic de vacío). El autodaño sigue existiendo a media distancia, pero rozar una
  esquina con la mira ya no te mata de un tiro.
* **Zona limpia = a salvo.** Desde que la zona se da por limpia la escuadra no recibe daño (un cohete
  que aún iba volando te mataba después de ganar).
* **Repliegue solo en grupos de 4 o más** (un grupo de 2-3 que pierde a uno no «se repliega»: sigue).
* **A menos de 1,6 m te notan aunque les vengas por la espalda** (siempre que no haya pared): tocarles
  sin que reaccionaran parecía un fallo.
* **Al morir, el ajuste dinámico baja un escalón.** El documento solo habla de ajustar «por zona»;
  morir es la señal más clara de ir ahogado.

### Cosas añadidas

* **Agacharse** (tecla C, botón en móvil). El documento dice que los muebles «protegen agachado» pero no
  da control para agacharse; sin él la cobertura baja solo servía a los enemigos.
* **Parámetro `?test=1` y `window.__stracomter`** para pruebas automáticas (no se pausa al perder el
  foco, se puede avanzar la simulación a mano).

### Lo que el documento no fijaba (valores nuestros)

* Cargadores y recarga: Capitán 30 / 1,6 s, Técnico 25 / 1,2 s, Especialista 50 / 2,2 s, Explosivo
  4 / 2,0 s. Enemigos 10-12 balas / 1,8-2,0 s, con las 50 del documento en total; al agotarlas cargan
  a cuchillo (6 / 8 / 10 de daño).
* Granadas: 3 por zona, 3 s entre lanzamientos. Alcance del arma: 30 m.
* Habilidades: Órdenes y Hackeo 20 s; Supresión y Demolición 25 s. Supresión dura 6 s (fuego automático
  al doble de cadencia sin gastar balas; clava a los enemigos a la vista en un cono de ±35°).
  Demolición abre 1,9 m de boquete en un muro interior a menos de 6 m (la fachada no se puede abrir).
* Alturas de los muebles (para decidir qué tapan): mesa 0,78 m, escritorio 1,05, mesa con sillas 0,90,
  estantería 2,10, sofá 0,90, butaca 0,85 (para balas solo hasta 0,70: «protege mal»), silla (no para
  nada), maceta 1,60 (tapa la vista, no para balas).
* Visión enemiga: los conos del documento (±35° a 20 m, ±70° a 10 m) valen mientras no saben de ti. Ya
  en combate, mirando hacia donde te han visto, el cono se abre a ±60° y llega a 30 m (alcance del arma).
* Moral: empieza en 60; +1 cada 2 s con el Capitán vivo, +6 por grupo enemigo eliminado, +10 por zona
  limpia, −30 por compañero caído. Por debajo de 20 el aura no cura; por debajo de 30 los compañeros no
  obedecen «ir ahí» ni «enfocar» y se repliegan antes.
* Los compañeros IA usan Órdenes (Capitán) y Supresión (Especialista) por su cuenta. El Capitán IA solo
  marca el blanco (los demás lo priorizan); no cambia la orden que haya dado el jugador. **Hackeo y
  Demolición solo las usa el jugador**: un compañero abriendo boquetes o puertas por su cuenta molesta
  más que ayuda.
* Los compañeros disparan en ráfagas cortas con pausas y con peor puntería que el jugador: apoyan, no
  ganan la partida solos (con los números del documento y puntería perfecta limpiaban la planta sin ti).
  El Explosivo IA no dispara si la explosión alcanzaría a un amigo.
* Recompensa de zona con el inventario lleno: se aplica directamente (con tope). Objeto del suelo con
  el inventario lleno: se usa al momento si hace falta; si no, se queda en el suelo.
* `kill all` mata a todos, **jugador incluido** (es lo que dice el documento, literalmente).
* Radio de colisión de los cuerpos contra muros y muebles: 0,26 m (el radio «de juego» sigue siendo
  0,4 m para balas y entre cuerpos). Con 0,4 m, los huecos de 1 m entre muebles de los mapas de muestra
  no dejaban pasar a nadie.
* Las IAs del mismo bando se pueden apretar entre sí (solapan hasta un 45 %): dos grupos cruzándose por
  una puerta de 1,33 m se taponaban.
* Subtítulos desactivados por defecto (se activan en Opciones).

## Lo que se ha recortado

* **Sección 14.1, punto 4 («deseable»): flanqueo, supresión y repliegue están hechos, pero el flanqueo
  es simple**: el flanqueador busca un punto al otro lado del objetivo y va por un camino que evita lo
  que el objetivo tiene a la vista. No coordina tiempos con quien fija.
* **Planta 1 sin flanqueo ni repliegue**, a propósito: es el tutorial encubierto.
* **Hackeo solo abre puertas.** Como cualquiera puede abrirlas acercándose, su valor es abrir a
  distancia y a salvo; no bloquea ni inutiliza nada.
* **Mapas de las plantas 2 a 9: los produce un generador con semilla fija** (`src/sim/mapgen.ts`), no
  están dibujados a mano. Son siempre los mismos y cumplen la tabla de tamaños y la regla de las dos
  rutas (comprobado con pruebas), pero no tienen la intención de un diseñador. La planta 7 tiene menos
  despachos de los que pide su ambiente porque la tabla limita las puertas.
* **Música**: generada por código (cinco temas distintos). Suena a sintetizador sencillo.
* **Modelos**: hechos con primitivas. Sin animación de esqueleto.

## Licencias y procedencia

Nada de pago ni con royalties. Ningún asset descargado: ni modelos, ni texturas, ni sonidos, ni fuentes.

| Qué | De dónde | Licencia |
|---|---|---|
| three.js 0.170 | npm | MIT |
| Vite, vitest | npm (solo desarrollo) | MIT |
| TypeScript | npm (solo desarrollo) | Apache-2.0 |
| tsx, @types/* | npm (solo desarrollo) | MIT |
| Modelos, muebles, escenario | Generados por código (`src/render`) | propio |
| Texturas (baldosas, helipuerto) | Dibujadas en un canvas en tiempo de ejecución | propio |
| Sonidos y música | Sintetizados con Web Audio (`src/audio`); melodías propias | propio |
| Fuentes | Las del sistema (Impact / Arial Black / sans-serif) | — |
| Mapas de la planta 1 | `MAPAS-DE-MUESTRA.json`, del encargo | del proyecto |

La música original de Adrián Gómez Marín y Almudena Segovia Calabuig **no se usa** (no la tengo); sus
nombres están en los créditos como pide el §22.
