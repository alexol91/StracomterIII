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
  quieto delante de él sí se paga). En fase 2 añade granadas y en fase 3 cohetes y más velocidad. Mientras lleva el escudo
  no dispara: esa fase se pelea contra los refuerzos.
* **Los jefes no se quedan sin munición.**
* **Botín de los enemigos.** Al morir sueltan a veces una caja de munición pequeña (12 %) o un botiquín
  pequeño (10 %); los jefes, un botiquín mediano. Si el Especialista ha muerto (no hay aura de
  munición), la probabilidad de munición sube al 50 %. Y si a toda la escuadra le quedan menos de 40 balas, el
  siguiente caído suelta munición seguro (nunca te quedas a cuchillo sin remedio). La vida no se regenera y se arrastra de planta en
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
* **Compensación por compañeros caídos.** Cada compañero muerto quita un 12 % de enemigos a las plantas
  siguientes (y de refuerzos del MegaBoss, que además deja 1,2 s más entre ráfagas por cada uno que
  falte). La muerte es permanente, como pide el documento, pero sin esto llegar solo a la azotea era
  una campaña sin salida.
* **Piedad tras tres derrotas seguidas en la misma planta.** Desde el cuarto intento se entra con la vida
  llena y al menos 120 balas, y cada intento quita otro 15 % de enemigos (hasta la mitad). Con la vida
  arrastrándose entre plantas y los compañeros muriendo para siempre, se podía llegar a un guardado del
  que no había forma de salir. El contador se pone a cero al superar la planta.
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

## V2: mapas más grandes (decisión del dueño, 2026-11-18)

Tras jugar, el dueño encontró pequeños los pasillos, las salas y los mapas. **Se aparta de la tabla de
tamaños de la sección 11 y de «constrúyelos tal cual» para los mapas de muestra:**

* **Los tres mapas reales de la planta 1 se amplían ×1,6 en planta** (`SAMPLE_MAP_SCALE` en
  `src/sim/maps.ts`). Se escalan las posiciones; los muebles y el grosor de los muros conservan su tamaño
  real, y las puertas pasan a ~2,1 m. La distribución sigue siendo la original.
* **Plantas 2 a 9 regeneradas:** pequeño 450-800 m², mediano 1.000-1.700, grande 1.900-3.000; salas de
  6-7 m de lado mínimo, pasillos de 3,4-4,2 m, puertas de 1,6 m; azotea de 50×50 m. Más muebles, en
  conjuntos (islas de escritorios, filas de racks, rincones de sofá).
* El número de enemigos por zona no cambia (es la tabla de la sección 8): hay más espacio por enemigo.
* Efecto secundario bueno: la regla de aparecer a 12 m ya cabe en todos los mapas, y el MiniBoss ya no se
  ve desde la entrada en ninguno.

## V2: estilo realista, interfaz y audio (decisiones del dueño, 2026-11-18)

Sustituye al «cambio de estilo gráfico» de más abajo, que queda como reserva (`?estilo=comic`).

* **Personajes realistas: Microsoft Rocketbox (licencia MIT).** Reparto elegido por el dueño: escuadra =
  Military_Male_01 (Capitán, original), 05 (Técnico, azul marino), 04 (Especialista, gris urbano con
  brazalete azul) y 03 (Explosivo, negro). Hostiles = Security_Male_01 (Sicario), Police_Male_01
  (Miliciano, en negro, rojo oscuro, tierra o marrón) y Police_Male_02 (Veterano, marrón rojizo), todos
  con brazalete rojo. Jefes (decisión nuestra): MiniBoss = Police_Male_02 a 2,2 m; MegaBoss =
  Military_Male_02 a 2,6 m. El dueño pidió brazalete rojo también en el aliado gris; se le ha puesto
  azul para no confundirlo con un hostil.
* **Animaciones de combate retargeteadas.** Rocketbox no trae ninguna. Se adaptan en tiempo de carga las
  de la «Universal Animation Library» de Quaternius (CC0) con `src/render/retarget.ts`. Son animaciones
  de PISTOLA a dos manos aunque el personaje lleve fusil, y no existe animación específica de fusil.
* **Armas:** siguen siendo las estilizadas de Quaternius, oscurecidas. No se encontró una colección de
  armas realistas con licencia utilizable (las de CuiGames prohíben redistribuir los ficheros).
* **Escenario:** mobiliario de oficina de 3DAssets.dev (CC0 según el sitio, **generado por IA**, sin
  garantía de originalidad: aceptado expresamente por el dueño), texturas PBR y HDRI de Poly Haven y
  ambientCG (CC0).
* **En táctil (calidad baja) se siguen usando los personajes de Quaternius:** los de Rocketbox (10-15 mil
  triángulos, 80 huesos) pesan demasiado para un móvil de gama media.
* **Interfaz rediseñada** con el fondo y el ejemplo de menú aportados por el dueño
  (`public/ui/fondo-torre.webp`). Fuentes del sistema (condensadas), sin descargas.
* **Audio original del juego**, aportado por el dueño (`public/audio/`, metadatos «Chutaos Team»): tema
  musical en menús, estrategia, victoria y jefes; efectos de pistola, ametralladora, cuchillo, quejido y
  muerte. En combate normal no hay música melódica, solo ambiente (decisión nuestra: el tema dura 57 s).
  El resto de efectos sigue sintetizado.
* **Truco nuevo `chutaos on|off` («Modo Chutaos»)**, pedido por el dueño: los efectos pasan a ser las
  voces de broma del equipo original. «go» suena con las órdenes y al empezar zona, y «sexo» al recoger
  o usar un objeto (asignación nuestra, a falta de indicación).
* **Peso:** el juego construido pasa de 12 a ~46 MB (modelos, texturas, animaciones).

## Cambio de estilo gráfico (decisión del dueño, 2026-11-18)

Tras jugar la primera versión, el dueño pidió subir la calidad gráfica hacia un estilo de «hero shooter»
estilizado y autorizó usar packs CC0. **Esto se aparta de la sección 20** («colores planos y contorno
marcado, estilo cómic», «modelos sencillos») y de «ningún asset descargado» de la primera entrega:

* Personajes con esqueleto y animaciones (Quaternius), muebles de oficina (Kenney), sombras proyectadas,
  sombreado por rampas con luz de contorno, fachada acristalada con ciudad al fondo, posprocesado ligero.
  Se conserva el contorno oscuro.
* **Solo hay tres modelos de personaje** con el mismo esqueleto. Los cuatro aliados y los cinco hostiles
  se distinguen por color, arma, complexión y un accesorio propio (boina, mochila con antena, casco,
  cuernos…), no por ser modelos distintos.
* **No existe en CC0**, y por tanto no está: animación de recarga (no se anima), ametralladora pesada
  (el Especialista lleva un cañón corto), rack de servidores y máquina de aire acondicionado (siguen
  hechos por código).
* Los modelos de cajas originales siguen en el código como reserva: se usan mientras cargan los modelos
  y si alguno falla al cargar.
* Calidad `high` (sombras, contorno, posprocesado) en ordenador y `low` en táctiles de alta densidad;
  se fuerza con `?quality=low|high`.

## v1.2: tacto de disparo, progresión y versión pública (decisión del dueño, 2026-11-18)

Nada de esta sección está en el documento de definición: son añadidos que el dueño aprobó tras el
análisis de producto («me gustan todas las ideas… vamos a ello»). Lo que cambia respecto al encargo:

* **Esprint** (Mayús): ×1,45 de velocidad, no se dispara, 0,35 s para volver a levantar el arma, pasos más ruidosos. El §11 no lo contemplaba.
* **Apuntar al hombro** (clic derecho): velocidad ×0,55, dispersión ×0,45, cámara a 2 m y campo de visión 60→42. **El cuchillo pasa de clic derecho a la tecla X** (los ajustes guardados se migran solos).
* **Dispersión dinámica y retroceso** por clase (`GUN_FEEL` en `src/sim/data.ts`): el arma del jugador ya no es perfectamente precisa; se abre al disparar seguido o moverse. El retroceso mueve la cámara, no la entrada del jugador.
* **Aturdimiento**: un golpe de ≥ 18 de daño (≥ 20 si es explosión) deja al enemigo 0,35 s sin disparar, con 1,2 s de enfriamiento.
* **Mejoras de campaña**: al terminar cada planta se elige 1 de 3 (20 en total, `UPGRADES`), obligatoria y para el resto de la campaña. Es un sistema de progresión nuevo que altera los números del §6-§8 (cargador, vida, recarga…) solo para quien las elige.
* **Nota de zona** S-D (precisión 25 + daño recibido 25 + tiempo 25 + escuadra 15 + tiros a la cabeza 10) y **récords locales** por planta y dificultad. Usar cualquier truco marca la partida («TRUCOS») y no puntúa ni guarda récord; la partida rápida tampoco guarda récords.
* **Tutorial guiado** en la planta 1 la primera vez (12 pasos, se puede omitir y repetir). Mientras dura, los enemigos no aparecen ni detectan (`world.hold`) hasta el paso de disparar.
* **Confirmación de impactos, registro de bajas, retícula dinámica, marcas de bala, polvo por superficie, casquillos y disparos por capas con cola de sala**: solo presentación.
* **Controles al estilo Counter-Strike** (pedido del dueño): 1-4 eligen arma (principal, pistola, cuchillo, granada), Q vuelve a la anterior, la rueda cambia de arma (el zoom pasa a Alt + rueda), Ctrl agacha (C también), Mayús corre. Las órdenes pasan de 1/2/3/V a Z/X/B/N, usar objeto de Q a T, granada rápida a G y cuchillada rápida a V. Los atajos guardados de versiones anteriores se sustituyen por los nuevos (eran incompatibles) con un aviso en el Título. **Diferencia con CS dicha en voz alta**: allí se corre por defecto y Mayús es andar; aquí Mayús es esprintar. Y **Ctrl+W cierra la pestaña** y una web no puede impedirlo: se mitiga con confirmación al cerrar durante la partida y un botón de pantalla completa.
* **Pistola secundaria** (no estaba en el documento; hace falta para tener «secundaria»): 14 de daño, 5 disparos/s, cargador de 12, recarga 1,3 s y **reserva infinita**, para todas las clases. Cambiar de arma tarda 0,25-0,45 s y cancela la recarga. Con pistola se anda ×1,05 y con cuchillo ×1,12. Solo el jugador cambia de arma; aliados y enemigos llevan siempre la principal.
* **Efectos realistas** de disparo y explosión en el estilo realista (sprites suaves, trazadoras que viajan, humo, chispas, marca de quemado; explosión sonora por capas). El estilo cómic conserva los antiguos. Página de prueba solo de desarrollo: `efectos.html`.
* **Versión pública**: los ganchos de prueba (`window.__stracomter`, `?test`, `?auto`) solo existen en desarrollo o con `?debug=1`. La consola de trucos se mantiene (la pide el §18).
* **Registro de partidas** para pruebas con personas: se guarda solo en el navegador (`stracomter3.playlog`) y se exporta a mano desde Opciones. No se envía nada a ningún sitio.
* **Carga**: animaciones recortadas a los 16 clips que se usan (`tools/recortar-ual.ts`, 6,5 MB → 0,8 MB), HDRI a 512 px (`tools/reducir-hdri.ts`), texturas de personajes a 1024/512, y modelos de reserva solo si hacen falta. Build de 47 a 33 MB. Los originales siguen en `assets-src/` (fuera del repositorio).

Sin comprobar con el bot: el bot no esprinta ni apunta al hombro, así que el equilibrio de esas dos
mecánicas solo está probado a mano. Las pruebas `tests/v12-*.test.ts` anotan qué no cubren.

## v1.3, oleada de combate (decisión del dueño, 2026-11-18)

Añadidos que no están en el documento, aprobados por el dueño. Lo que cambia respecto al encargo:

* **Compañeros derribados**: al llegar a 0 de vida quedan 25 s en el suelo y se les puede reanimar (mantener E 3 s, o lo hace otro compañero) con el 30 % de vida. Si no, mueren para siempre, como pide el encargo. **Suaviza la regla «un compañero muerto sigue muerto»**: dicho en voz alta.
* **Voltereta** (Espacio): 3,5 m en 0,5 s, mitad de daño de explosiones los primeros 0,25 s, 1,5 s de espera.
* **Granadas tácticas**: además de 3 explosivas, 2 cegadoras (ciegan 3 s a quien la ve a ≤ 9 m, también a ti y a los tuyos 2 s) y 1 de humo (8 s; tapa la visión, no las balas).
* **Recarga**: recargar con balas conserva una en recámara; esprintar la cancela.
* **Dos armas principales por clase** (se elige en Estrategia), con el daño por segundo de la alternativa dentro de ±10 %: fusil de ráfaga (pausa de 0,23 s en vez de los 0,32 s previstos, que daban −26 %), escopeta de 8 perdigones, fusil de tirador y lanzador de rebote.
* **Orden contextual** (botón central) y **combos** de habilidades: marcado + Supresión clava 3 s; Demolición aturde 2 s al otro lado del boquete; Hackeo sin puerta a la vista apaga las luces 10 s (los enemigos ven la mitad). Antes el Hackeo sin puerta fallaba.
* **Cuatro oficios de enemigo** que sustituyen (no añaden) enemigos normales — 10 % en planta 2, 20 % en 3-4, 28 % en 5-6, 35 % en 7-9: asaltante (a cuchillo, 20 de daño), granadero, tirador (láser de 1,4 s —1,0 s en difícil— y bala de 30) y blindado (escudo frontal; lo baja al recargar, con explosión o cegadora). Los números se bajaron respecto al diseño (tirador 55→30 y 1 vivo como máximo, cuchillada 25→20, blindado más lento disparando) **porque el bot no sabe esquivar el láser ni rodear el escudo**; a los compañeros IA, láser, cuchillada y embestida les hacen ×0,4 porque tampoco esquivan. Queda pendiente subirlos cuando se prueben con personas.
* **Jefes de planta distintos**: artillero (el de siempre) en 2 y 6, ametrallador en 3 y 7, ariete en 4 y 8, patrón con escoltas que lo curan en 5; en 6-8 con +15 % de vida y dos acompañantes de oficio. Cada uno avisa su ataque y queda expuesto (×1,5 de daño) después.
* **Avisos**: círculo donde va a estallar una granada o cohete, láser del tirador, pasillos de embestida y de barrido, y frases cortas ligadas al estado real de enemigos y compañeros.
* **Mando**: soporte de mando estándar con vibración; sin probar con un mando real.
* Equilibrio medido con el bot (una campaña por celda, con mucha varianza): Fácil 0 muertes, Normal 2-3, Difícil 0-1. Antes de los oficios, Normal eran 0-2.

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

Nada de pago ni con royalties. Los únicos assets descargados son los modelos CC0 de la tabla; texturas,
sonidos y fuentes siguen sin ser de terceros.

| Qué | De dónde | Licencia |
|---|---|---|
| three.js 0.170 | npm | MIT |
| Vite, vitest | npm (solo desarrollo) | MIT |
| TypeScript | npm (solo desarrollo) | Apache-2.0 |
| tsx, @types/* | npm (solo desarrollo) | MIT |
| Personajes realistas (8 avatares) | Microsoft Rocketbox — github.com/microsoft/Microsoft-Rocketbox | MIT (aviso en `public/models/rb/LICENSE-Microsoft-Rocketbox.md`) |
| Animaciones de combate | Quaternius, «Universal Animation Library» | CC0 |
| Mobiliario de oficina | 3DAssets.dev | CC0 según el sitio; generado por IA |
| Texturas PBR, HDRI, botiquín y caja de munición | Poly Haven y ambientCG | CC0 |
| Fondo del menú (`public/ui/fondo-torre.webp`) | Aportado por el dueño | del dueño |
| Música y efectos originales, voces del Modo Chutaos (`public/audio/`) | Aportados por el dueño (Chutaos Team) | del dueño |
| Retratos de la selección de personaje | Vistas previas de Microsoft Rocketbox | MIT |
| Personajes, armas, botiquín, granada | Quaternius, «Toon Shooter Game Kit» — quaternius.com/packs/toonshootergamekit.html | CC0 (consta en la página del autor; la descarga no trae fichero de licencia) |
| Mesas, escritorios, sillas, estanterías, sofás, butacas, macetas | Kenney, «Furniture Pack 1.0» — opengameart.org/content/furniture-kit | CC0 (`public/models/furniture/LICENSE-Kenney.txt`) |
| Escenario, racks, aire acondicionado, modelos de reserva | Generados por código (`src/render`) | propio |
| Texturas (baldosas, helipuerto) | Dibujadas en un canvas en tiempo de ejecución | propio |
| Sonidos y música | Sintetizados con Web Audio (`src/audio`); melodías propias | propio |
| Fuentes | Las del sistema (Impact / Arial Black / sans-serif) | — |
| Mapas de la planta 1 | `MAPAS-DE-MUESTRA.json`, del encargo | del proyecto |

La música original de Adrián Gómez Marín y Almudena Segovia Calabuig **no se usa** (no la tengo); sus
nombres están en los créditos como pide el §22.
