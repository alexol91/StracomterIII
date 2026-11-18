# Torre Chutaos — definición del juego

Documento de encargo. Describe **qué se juega**. Ninguna decisión de implementación
está tomada: motor, lenguaje, arquitectura, estructura de ficheros, bibliotecas y
algoritmos los eliges tú entero.

Los números de este documento son los de un juego real que se jugó y funcionó. No son
estimaciones. Úsalos tal cual salvo que te estorben para que el juego sea jugable; si
cambias alguno, dímelo y por qué.

Junto a este fichero está **`MAPAS-DE-MUESTRA.json`**: tres mapas originales completos
con coordenadas exactas en metros. Sirven de referencia de escala y densidad. Úsalos.

---

## 1. El juego en una frase

**Shooter táctico en tercera persona en el que recuperas tu propia empresa, planta a
planta, acompañado de una escuadra.**

Un comando armado ha tomado la **Torre Chutaos**, la sede de la empresa que fundaron
cuatro ingenieros informáticos. Ocupan de la planta 1 a la 8, y su jefe espera en la
azotea. Tú eres uno de los cuatro socios fundadores. Entras por abajo y subes.

La fantasía no es «soy un supersoldado»: es **«esta empresa es mía»**. El escenario es
una oficina de verdad —mesas, sillas, cubículos, estanterías, sofás, máquinas de café,
macetas— y eso es lo que lo hace memorable: se combate entre escritorios, no en un
búnker genérico.

Un solo jugador. Los tres compañeros los lleva la máquina.

---

## 2. Requisitos de la entrega

Restricciones del encargo, no de diseño. Son las únicas que te impongo:

1. **Se juega en ordenador y en móvil.** Si puede ser abriendo un enlace, mejor:
   interesa poder jugarlo en el navegador y también empotrarlo luego en una app.
2. **Cámara en tercera persona**, detrás del personaje. No cenital.
3. **Nada que cueste dinero ni obligue a pagar licencias o royalties**, ni ahora ni si
   el juego se distribuyera.
4. **Controles reales para las dos plataformas**: teclado y ratón en ordenador,
   táctiles en móvil. Un control táctil que haga el juego injugable no cuenta como
   entregado. En móvil el apuntado va asistido.
5. **Se entrega funcionando**: se abre, se juega y se puede terminar la campaña entera.

---

## 3. Los tres bucles

* **30 segundos:** entras en una sala, la lees, limpias la resistencia con tu escuadra,
  recoges el botín.
* **8-12 minutos:** eliges por qué zona entras a la planta, la limpias, cobras la
  recompensa, subes.
* **45-90 minutos:** planta 1 → planta 8 → azotea → final.

---

## 4. Estructura de una partida

* **Campaña:** 9 niveles. Cada uno tiene **6 zonas** y entras por la que elijas.
* **Se gana una zona matando a todos los enemigos**, jefe incluido. Entonces aparece la
  pantalla de fin de planta, se cobra la recompensa y se sube.
* **Se pierde cuando muere el personaje que controlas.** Los compañeros pueden morir sin
  que acabe la partida.
* **La muerte de un compañero es permanente** para el resto de la campaña. No resucitan.
  Como el jugador nunca «muere guardado», siempre queda al menos uno.
* **Se guarda al terminar cada planta**, no durante.
* **Partida rápida:** una planta suelta, sin progresión ni guardado, para probar.

---

## 5. Las cuatro clases

Siempre están las cuatro en el nivel: **controlas una y las otras tres son tus
compañeros**. Eliges cuál controlas entre planta y planta.

| Clase | Vida | Velocidad | Disparos/s | Daño/bala | Rasgo propio |
|---|---|---|---|---|---|
| **Capitán** | 160 | 5,3 m/s | 10 | 10 | **Aura de moral**: +1 de vida cada 2 s a los aliados a menos de 8 m |
| **Técnico** | 85 | 6,7 m/s | 12,5 | 7 | El más rápido y el de mayor cadencia. Muy frágil |
| **Especialista** | 125 | 5,3 m/s | 5 | 5 | **Aura de munición**: +10 balas cada 4 s a los aliados a menos de 8 m |
| **Explosivo** | 110 | 6,0 m/s | 2 | 60 en el centro | Su disparo **estalla**: radio 2 m, daño con caída lineal |

Comunes a las cuatro:

* **50 balas** al empezar la campaña. Tope 999.
* **Cuchillo:** 30 de daño, un golpe cada 0,5 s, alcance ~1 m.
* **Granada:** 50 de daño, radio 2 m, con munición propia limitada y tiempo de recarga.
* **No hay salto.** El juego es horizontal.
* El personaje mide ~1,8 m y ocupa un radio de 0,4 m.

**Las auras del original tenían radio 2,7 m**, más corto que la propia formación de la
escuadra, así que casi nunca alcanzaban a nadie. Usa **8 m**. Es el único número del
original que sé con certeza que estaba mal.

### 5.1 Habilidad activa por clase

Con tiempo de recarga, en torno a 20-30 s:

* **Capitán — Órdenes:** marca un objetivo y toda la escuadra lo enfoca.
* **Técnico — Hackeo:** abre a distancia una puerta cerrada.
* **Especialista — Supresión:** fuego sostenido que clava a los enemigos en cobertura
  y les impide avanzar mientras dura.
* **Explosivo — Demolición:** **abre un agujero en un muro** y crea una ruta que no
  existía. Los enemigos tienen que darse cuenta y usarla también.

### 5.2 Inventario

Cinco ranuras. Se llenan con las recompensas de fin de planta y con lo que recojas del
suelo. Se cicla con una tecla y se usa con otra. **Los compañeros usan el suyo solos**,
con estos umbrales (del original, funcionan):

| Clase | Usa botiquín si la vida baja de | Usa munición si le quedan menos de |
|---|---|---|
| Capitán | 30 | 5 |
| Técnico | 10 | 1 |
| Especialista | 15 | 10 |
| Explosivo | 50 | 1 |

---

## 6. La escuadra

Los tres compañeros **te siguen en formación**, en V detrás de ti. Posiciones relativas
a tu espalda, del original:

| Posición | Desplazamiento |
|---|---|
| Izquierda | 1,6 m a la izquierda, 0,8 m detrás |
| Derecha | 1,6 m a la derecha, 0,8 m detrás |
| Centro | 1,6 m detrás |

Quién ocupa cada sitio, según a quién controles:

| Controlas | Izquierda | Derecha | Centro |
|---|---|---|---|
| Capitán | Explosivo | Técnico | Especialista |
| Técnico | Explosivo | Especialista | Capitán |
| Especialista | Explosivo | Técnico | Capitán |
| Explosivo | Capitán | Técnico | Especialista |

**Comportamiento:** siguen la formación mientras no pase nada; si ven un enemigo
atacan; si les disparan se giran hacia quien dispara; si se alejan más de ~6 m de ti
vuelven; si les queda poca vida se repliegan hacia el Capitán (por el aura) y si les
queda poca munición hacia el Especialista.

**Órdenes del jugador**, tres: **ir ahí**, **enfocar eso** y **mantener la posición**.
Más una cuarta que es la del original y sigue siendo útil: **a mí** (reagrupar).

**Moral:** sube con el aura del Capitán y con los encuentros ganados; baja cuando caen
compañeros. Con la moral alta obedecen; con la moral baja priorizan sobrevivir. En el
original la moral solo habilitaba la regeneración del aura: aquí hace las dos cosas.

---

## 7. Los enemigos

| Tipo | Vida | Velocidad | Disparos/s | Daño | Puntos | Cómo pelea |
|---|---|---|---|---|---|---|
| **Sicario** | 45 | 2,0 m/s | 2 | 1 | 3 | Frágil y numeroso. Presiona por cantidad |
| **Miliciano** | 50 | 1,9 m/s | 1,25 | 3 | 5 | Equilibrado. Usa cobertura y rodea |
| **Veterano** | 65 | 1,7 m/s | 1,66 | 2 | 7 | Duro. Te fija mientras otro avanza |
| **MiniBoss** | 200 | 1,1 m/s | 2 | 30 | 50 | Guardián de planta. Ataque **explosivo en área** |
| **MegaBoss** | 500 | 0,8 m/s | 5 | 10 | 500 | Azotea. Pelea **por fases** y pide refuerzos al cambiar de fase |

Los tres tipos básicos **no suben de estadísticas** según la planta. Lo que cambia es
cuántos hay, de qué mezcla y cómo se comportan. Subir la vida planta a planta es la
forma barata de escalar la dificultad; escalar composición y táctica es la buena.

**El jugador es entre 2,5 y 3,8 veces más rápido que cualquier enemigo.** No es un
error: es la fantasía del juego y se conserva. Lo que compensa esa ventaja es que ellos
se coordinan y son muchos.

**Munición enemiga:** 50 balas. En el original no recargaban, así que un Sicario podía
hacer 50 de daño *en toda la partida* y después se quedaba de adorno. Aquí **recargan o
se lanzan al cuerpo a cuerpo**.

**Jefes:** un **MiniBoss por planta, de la 2 a la 8** (la planta 1 es tutorial y no
tiene). El **MegaBoss** está en la azotea y es el final del juego. Cada mapa trae
marcado el punto donde aparece el jefe.

---

## 8. Cuántos enemigos hay en cada zona

Esta tabla sale de la fórmula del original aplicada a los mapas reales. Es el ritmo que
tenía el juego; úsala como referencia, en dificultad Normal:

| Planta | Zonas 1-2 (mapa pequeño) | Zonas 3-4 (mediano) | Zonas 5-6 (grande) |
|---|---|---|---|
| 1 | 9 | 19 | 31 |
| 2 | 21 | 26 | 37 |
| 3 | 26 | 34 | 34 |
| 4 | 34 | 44 | 46 |
| 5 | 25 | 47 | 47 |
| 6 | 32 | 48 | 48 |
| 7 | 35 | 47 | 42 |
| 8 | 49 | 49 | 49 |
| 9 (azotea) | MegaBoss + ~24 en refuerzos por fase | | |

Las bajadas de la planta 5 y la 7 son porque el original reutilizaba mapas pequeños.
Si te estorban, súbelas: la curva debería crecer.

Más **un jefe** encima de esa cuenta.

**Mezcla por planta.** El original calculaba la composición resolviendo un problema de
optimización, y le salía mal: producía ~26 Milicianos y casi nada más, planta tras
planta. Usa directamente esta progresión:

| Planta | Sicario | Miliciano | Veterano |
|---|---|---|---|
| 1 | 80 % | 20 % | — |
| 2 | 65 % | 30 % | 5 % |
| 3 | 50 % | 40 % | 10 % |
| 4 | 40 % | 40 % | 20 % |
| 5 | 30 % | 35 % | 35 % |
| 6 | 30 % | 40 % | 30 % |
| 7 | 25 % | 35 % | 40 % |
| 8 | 20 % | 35 % | 45 % |
| 9 | 25 % | 35 % | 40 % |

A partir de la planta 4, **ningún tipo baja del 15 %**: la variedad es lo que hace que
cada encuentro se lea distinto.

**Ajusta la cantidad a cómo vaya el jugador.** Si va sobrado —buena puntería, poco daño
recibido, limpia rápido, no pierde compañeros— sube hasta un 30 %; si va ahogado, baja
hasta un 30 %. Dos condiciones:

* La referencia tiene que ser **fija** (un tiempo esperado según el tamaño del
  encuentro), no la media del propio jugador. Si la referencia se mueve con él, jugar
  peor acaba dando más enemigos, que es justo lo contrario.
* El ajuste es **lento**: nunca más de un escalón por zona.

**Y no aparecen todos de golpe.** Cada zona tiene un ritmo:

1. **Ascenso:** oleadas pequeñas mientras avanzas. ~40 % del total.
2. **Pico:** se suelta el grueso de golpe. ~50 %.
3. **Alivio:** solo algún rezagado suelto, para que recojas botín sin que el sitio
   parezca apagado. ~10 %, unos 15 s.
4. **Descanso:** silencio, 20-40 s, y a la siguiente zona.

**Una zona se da por limpia cuando no queda nada por soltar y no queda nadie vivo**, no
cuando se acaba el reloj de la curva.

---

## 9. Dónde aparecen

Aleatorio, pero nunca injusto. El original los ponía **a 2,7 m del jugador**, que es
aparecer en la cara. Reglas:

* Nunca a menos de **12 m** del jugador.
* **Nunca dentro de su campo de visión**, ni donde pueda verlos aparecer.
* Siempre en sitio desde el que **se pueda llegar andando** hasta el jugador. Si una
  puerta cerrada deja una zona aislada, ahí no aparece nadie.
* Preferentemente por **accesos reales** —puertas, escaleras, ascensores— y no en mitad
  de una sala.
* Repartidos por el mapa, no todos por el mismo sitio.

---

## 10. La torre

| Planta | Qué es | Ambiente |
|---|---|---|
| 1 | Recepción y vestíbulo | Mármol, tornos, mostrador. Tutorial encubierto |
| 2 | Soporte y atención al usuario | Cubículos, tickets impresos |
| 3 | Desarrollo | Mesas dobles, pizarras, cafeteras |
| 4 | Calidad y preproducción | Salas de pruebas, armarios de equipos |
| 5 | Centro de datos | Pasillos fríos, rejillas, poca luz, casi sin cobertura |
| 6 | Comercial y marketing | Diáfano, cristal, moqueta. Distancias largas |
| 7 | Dirección | Despachos cerrados, madera |
| 8 | Sala de juntas | El asalto final al interior |
| 9 | Azotea | Helipuerto, viento, de noche. **MegaBoss** |

---

## 11. Los mapas

Cada planta tiene 6 zonas y **3 mapas**: zonas 1-2 el pequeño, 3-4 el mediano, 5-6 el
grande. Mapa más grande = más enemigos = mejor recompensa. Esa es la decisión principal
de la partida.

Tamaños reales de los doce mapas del original, para que calibres:

| Tamaño | Superficie | Muros interiores | Puertas | Muebles | Objetos en el suelo |
|---|---|---|---|---|---|
| Pequeño | 112-351 m² | 5-6 | 1-3 | 12-24 | 2-5 |
| Mediano | 307-952 m² | 9-15 | 5-6 | 37-39 | 5-8 |
| Grande | 447-1.173 m² | 12-18 | 2-7 | 27-47 | 5-8 |
| Final (planta 8) | 740 m² | 27 | 14 | 0 | 16 |

Plantas de oficina de una sola altura, con muros interiores de 3 m y puertas de 2,1 m.

**En `MAPAS-DE-MUESTRA.json` tienes tres mapas completos** —uno pequeño, uno mediano y
uno grande— con el perímetro, cada muro, cada puerta, cada mueble con su posición y su
giro, los objetos del suelo, dónde empieza el jugador y dónde está el jefe. Todo en
metros. Son las tres zonas de la planta 1 del juego original. Constrúyelos tal cual y
usa su densidad como patrón para el resto.

Requisito de diseño para los mapas que inventes: **siempre al menos dos rutas** entre
dos puntos cualesquiera del mapa. Si solo hay un camino, los enemigos no pueden
flanquear y el juego se vuelve un pasillo.

### 11.1 Mobiliario

Ocho tipos, con sus medidas reales. Son cobertura y obstáculo:

| Mueble | Medidas | Protege |
|---|---|---|
| Mesa | 0,56 × 1,20 m | Agachado |
| Escritorio | 1,73 × 1,47 m | Agachado |
| Mesa con sillas | 1,33 × 1,33 m | Agachado |
| Estantería | 1,33 × 0,57 m | De pie |
| Sofá | 0,59 × 1,60 m | Agachado |
| Butaca | 0,59 × 0,53 m | Agachado, mal |
| Silla | 0,53 × 0,53 m | Nada |
| Maceta | 0,27 × 0,27 m | Nada, pero **rompe la línea de visión** |

Lo del último punto importa: una maceta no para una bala pero sí impide que te vean, y
a veces eso vale más. Los enemigos tienen que entender la diferencia.

### 11.2 Puertas

* Empiezan **cerradas**.
* **Cambian por dónde se puede pasar**: una puerta cerrada corta el camino, para ti y
  para ellos.
* El jugador las abre y las cierra acercándose. Sin llaves ni coste.
* **En el original solo las abría el jugador**, y eso dejaba a los enemigos encerrados
  sin que ellos supieran por qué. Aquí **los enemigos también las abren**: cerrar una
  puerta te da tiempo, no inmunidad.

---

## 12. Entre planta y planta: la pantalla de Estrategia

Al limpiar una planta el juego se detiene y muestra **el plano de la planta siguiente**
con sus seis zonas. De cada zona se ve **la recompensa** y **una lectura de la amenaza**
(tamaño del mapa, si es diáfano o de pasillos, si hay MiniBoss).

| Zona | Recompensa | Mapa |
|---|---|---|
| 1 | +20 de munición | Pequeño |
| 2 | +20 de vida | Pequeño |
| 3 | +50 de munición | Mediano |
| 4 | +50 de vida | Mediano |
| 5 | +100 de munición | Grande |
| 6 | +100 de vida | Grande |

**La recompensa la recibe cada superviviente** y entra en su inventario, no se aplica
sola. Si tu Técnico está muerto, no cobra.

**Se ve el plano; no se ve la composición enemiga.** El jugador decide con información
parcial: eso es lo que convierte una elección en una decisión.

Aquí también:

* **Eliges a cuál de los cuatro controlas** en la planta siguiente. Los muertos salen
  en gris y no se pueden elegir.
* Se ve la puntuación acumulada.

---

## 13. Cómo se siente el combate

* **Las balas impactan al instante.** Sin proyectiles viajando.
* **Apuntar importa:** cabeza ×2,5, torso ×1, brazos y piernas ×0,7.
* **Fallar cuesta:** la bala se gasta igual.
* **Hay recarga**, con su tiempo muerto. El original no tenía y era un problema.
* **Las explosiones hacen daño amigo; los disparos normales no.** En el original el
  fuego amigo era total y con tres compañeros IA detrás es insufrible. En las
  explosiones sí, porque es lo que da peso a la clase Explosivo — y el Explosivo puede
  herirse a sí mismo.
* **Las explosiones necesitan línea de visión:** no atraviesan paredes. El daño cae
  linealmente hasta cero en 2 m.
* **La vida no se regenera sola.** Se recupera con el aura del Capitán, con los
  botiquines y con la recompensa de zona. **No pasa del máximo de la clase** (en el
  original no tenía tope y era un fallo).
* **El alcance del arma tiene que funcionar a la escala de las salas.** El original
  disparaba a 6,7 m en mapas de 40 m: todo tiroteo era una pelea a cuchillo. Usa
  **26-34 m**.
* **Puntuación = experiencia de la víctima** (3/5/7/50/500). Se acumula y se ve.

---

## 14. Qué tienen que hacer los enemigos

Esta es la parte importante y es donde se nota si el juego está bien hecho. Descrito en
lo que el jugador **ve**:

* **No ven a través de las paredes.** Estar dentro de su campo de visión no basta: si
  hay un muro, una puerta cerrada o una estantería en medio, no te ven. El original
  comprobaba el cono y no la pared, y disparaban a través de los tabiques.
* **Tienen dos conos:** uno frontal estrecho donde te detectan rápido, y uno periférico
  más ancho donde tardan más. Usa en torno a **±35° a 20 m** el primario y **±70° a
  10 m** el periférico. El original usaba ±20° a 6,7 m y los bots estaban prácticamente
  ciegos: solo reaccionaban cuando ya los tenías encima.
* **Oyen.** Disparos, explosiones, puertas y pasos. El sonido **se propaga por donde se
  puede andar**, no en línea recta: un disparo al otro lado de un tabique se oye
  lejano; el mismo disparo al final de un pasillo recto se oye encima. Oír un disparo
  tiene que bastar para que vayan a mirar.
* **Recuerdan, y se equivocan de forma creíble.** Al perderte de vista van a donde
  **creen** que estás. Esa creencia se desdibuja con el tiempo: primero van directos,
  luego buscan por la zona, luego se rinden y vuelven a patrullar.
* **Se avisan entre ellos**, con un retardo de **0,3 a 0,8 s** según el tipo. El grupo
  reacciona como grupo, pero no todos a la vez ni al instante.
* **Se cubren.** Buscan activamente dónde ponerse para que no les des, y eso depende de
  dónde estés tú. No se quedan de pie en mitad de la sala.
* **Se reparten el trabajo.** Mientras uno te dispara para que no asomes, otro te rodea
  **por un camino distinto** — no «el mismo camino girado 90 grados». Nadie avanza a
  pecho descubierto si nadie le está cubriendo.
* **Se retiran.** Si el grupo pierde más de la mitad, se repliega a la sala anterior y
  se reagrupa en lugar de ir muriendo de uno en uno.
* **Patrullan** una ruta por su zona mientras no te han visto. No se quedan quietos.
* **No se atascan.** Nunca más de 3 segundos dando vueltas contra una esquina.
* **No cambian de idea cada instante.** Cuando eligen qué hacer, se comprometen al menos
  1-2 segundos. Un enemigo que oscila entre cubrirse y avanzar diez veces por segundo
  parece roto aunque la decisión sea correcta cada vez.

### 14.1 El mínimo aceptable

Lo de arriba es el objetivo y es lo que quiero ver. Pero prefiero un juego entero con
enemigos simples que medio juego con enemigos brillantes. **Si tienes que recortar,
recorta por aquí y dímelo**, en este orden —lo último de la lista es lo primero que se
cae—:

1. **No negociable:** no ven a través de las paredes, te persiguen, te disparan, no se
   atascan, patrullan cuando no te ven.
2. **Muy importante:** se cubren, recuerdan tu última posición, se avisan entre ellos.
3. **Importante:** oyen y van a mirar.
4. **Deseable:** flanquean por otra ruta, suprimen, se repliegan.

Lo que **no** acepto en ningún caso es un enemigo que dispare a través de un tabique o
que se quede clavado mirando a una pared. Eso no es «IA simple», es un fallo.

---

## 15. Objetos del suelo

Repartidos por el mapa, se recogen al pasar por encima. Los recoge quien pase, jugador o
compañero. Entre 2 y 16 por mapa, de los seis tipos a partes iguales:

| Objeto | Efecto |
|---|---|
| Botiquín pequeño / mediano / grande | +20 / +50 / +100 de vida |
| Caja de munición pequeña / mediana / grande | +20 / +50 / +100 de balas |

---

## 16. Controles

### Ordenador

| Entrada | Acción |
|---|---|
| W A S D | Mover |
| Ratón | Apuntar y girar la cámara |
| Clic izquierdo | Disparar |
| Clic derecho | Cuchillo |
| R | Recargar |
| Espacio | Granada |
| F | Habilidad de clase |
| E | Abrir / cerrar puerta |
| Q | Usar el objeto seleccionado |
| Tab | Cambiar de objeto |
| V | Orden: a mí |
| 1 / 2 / 3 | Órdenes: ir ahí · enfocar eso · mantener posición |
| Rueda | Zoom de cámara |
| Esc | Pausa |
| Tecla de consola | Abrir la consola |

Sin salto.

### Móvil

* Stick izquierdo para moverse, stick derecho para la cámara.
* Botón de disparo grande, en el pulgar derecho. **Apuntado asistido obligatorio**: sin
  él, este juego en una pantalla táctil no se puede jugar.
* Botones secundarios: recargar, cuchillo, granada, habilidad, usar objeto.
* El botón de **interactuar es contextual**: solo aparece cuando hay una puerta o un
  objeto cerca. No llenes la pantalla de botones.
* Las órdenes de escuadra, en un menú que se despliega.
* La interfaz tiene que caber en un móvil en horizontal sin tapar el centro de la
  pantalla.

---

## 17. Interfaz y pantallas

**Durante el juego:** vida, munición, estado y vida de los tres compañeros, moral,
puntuación, tiempo, enemigos restantes, objeto seleccionado, y un **indicador de por
dónde te están disparando**.

**Pantallas:** Título · Elección de clase · Estrategia · Juego · Pausa · Fin de planta ·
Derrota · Victoria · Créditos · Opciones.

Tres cosas que es fácil dejarse y que rompen el juego:

* **La pantalla de Victoria tiene que verse.** Limpiar la azotea termina la partida y
  eso se celebra; no se salta directo a los créditos.
* **El resumen de fin de planta tiene que durar en pantalla** lo suficiente para leerlo.
* **La pantalla de Derrota tiene que ofrecer reintentar** la misma planta.

**Textos del original que quiero conservar**, porque son la identidad del proyecto:

| Dónde | Texto |
|---|---|
| Título | **Stracomter III** |
| Subtítulo | *dos puntos espacio, el mejor juego de la historia* |
| Derrota | **¡Segmentation Fault!** |
| Fin de planta | **¡Nivel completado!** |
| Final del juego | **¡ENHORABUENA!** Tras derrotar al grupo terrorista, el Chutaos Team recupera el control de sus instalaciones. Jorobate Flanders. |

**Opciones:** volumen de música y de efectos, dificultad (Fácil / Normal / Difícil, que
multiplica la cantidad de enemigos por 1,0 / 1,3 / 1,5), sensibilidad, remapeo de
controles, subtítulos, tamaño de interfaz, modo daltónico y poder desactivar la sacudida
de cámara.

**Idiomas: español e inglés desde el primer día**, y el juego **arranca en español**.

---

## 18. Consola de trucos

El original tenía una consola de comandos y era su mejor herramienta de trabajo. Quiero
la misma, accesible con una tecla:

| Comando | Qué hace |
|---|---|
| `spawn <tipo> <x> <y>` | Crea un enemigo o aliado del tipo indicado |
| `team <tipo> <x> <y>` | Crea diez de golpe |
| `kill all` / `kill bad` / `kill me` | Mata a todos / solo a los enemigos / al jugador |
| `god` | Invulnerable |
| `noclip` | Atravesar paredes |
| `ammo` / `health` | Munición y vida al máximo |
| `floor <n>` / `zone <n>` | Saltar a una planta o zona |
| `tp <x> <y>` | Teletransportarse |
| `info <id>` | Vida, munición y estado de una entidad |
| `ai.debug` | Dibujar conos de visión, caminos y qué está haciendo cada enemigo |

Tipos aceptados: `captain`, `technic`, `especialist`, `explosives`, `enemy1`, `enemy2`,
`enemy3`, `miniboss`, `megaboss`.

**Un truco que no hace nada es peor que un truco que no existe:** si `god` contesta
«modo dios activado» y el jugador se sigue muriendo, manda a buscar el problema a otro
sitio. Cada comando que registres tiene que tener a alguien que lo lea. Compruébalo.

---

## 19. Guardado

Se guarda **al terminar cada planta**. Hay que guardar:

* La planta en la que estás y a qué personaje controlas.
* La puntuación.
* De cada uno de los cuatro: vida, munición y las cinco ranuras de inventario. Vida 0
  significa muerto para el resto de la campaña.

---

## 20. Aspecto y sonido

**Colores planos y contorno marcado**, estilo cómic. Es deliberado: hace que unos
modelos sencillos parezcan intencionados en vez de pobres, y a este juego le va.

* Gris corporativo y azul para la torre; naranja y rojo para los hostiles.
* Modelos sencillos pero **legibles de un vistazo**: hay que distinguir un Sicario de un
  Veterano a diez metros y de espaldas. Si no se distinguen, el combate no se puede leer.
* **Sonido posicional**: oír de dónde viene un disparo tiene que servir para jugar.
* Música distinta en menú, en estrategia, en combate y contra el jefe.
* Que se oigan: disparo, explosión, cuchillo, pasos, recarga, puerta, impacto recibido,
  muerte.

**No uses música ni sonidos de los que no tengas derechos.** El original usaba The
Prodigy y por eso su banda sonora es inservible. Si no hay material libre, prefiero
silencio o algo generado antes que un problema de licencia.

---

## 21. Cómo se juzga que está terminado

Esta es la lista. Se comprueba **jugando**, no leyendo el código. Cuando me lo entregues,
dime cuáles cumple y cuáles no:

1. Se abre en un ordenador y en un móvil, y se juega en los dos.
2. El jugador se mueve, apunta, dispara, recarga, usa el cuchillo, la granada y su
   habilidad de clase.
3. Los tres compañeros te siguen, disparan y obedecen las cuatro órdenes.
4. Los enemigos te ven, te persiguen, te disparan y te aciertan.
5. Los enemigos **no disparan a través de las paredes** ni te ven a través de una puerta
   cerrada.
6. Los enemigos **patrullan** cuando no te han visto y **no se quedan atascados**.
7. Los enemigos **se cubren** y al menos a veces **te rodean por otro camino**.
8. Una zona se puede **limpiar**, y al limpiarla el juego lo detecta y lo dice.
9. La recompensa se cobra, entra en el inventario y se puede usar.
10. Se **sube de planta**, se puede cambiar de personaje controlado y la planta
    siguiente es distinta.
11. Los tres mapas de muestra están construidos y son reconocibles.
12. Se llega a la azotea, se pelea contra el MegaBoss y **aparece la pantalla de
    Victoria**.
13. Se puede morir y la pantalla de Derrota deja reintentar.
14. Se guarda y se carga la partida, y un compañero muerto sigue muerto.
15. La consola funciona y **cada truco hace de verdad lo que dice**.
16. Arranca en español.
17. Va fluido con **40 enemigos a la vez** en un portátil normal y no se arrastra en un
    móvil de gama media.

### Dos avisos por experiencia

**Que compile y que pasen las pruebas no significa que se juegue.** Los fallos de este
tipo de juego no dan error: un enemigo que camina a un tercio de su velocidad, una
pantalla que se muestra y se tapa en el mismo frame, un truco que no hace nada, un bot
que te oye disparar a tres metros y se va a patrullar. Ninguno sale por consola. **Juega
una partida entera antes de decirme que está.**

**Y mira lo que entregas.** Si la interfaz sale en inglés, si el suelo no se dibuja, si
no has puesto ni una luz: eso se ve a la primera captura de pantalla y no lo detecta
ninguna prueba.

---

## 22. De dónde viene esto

Es la especificación de un juego real: *Stracomter III*, hecho en 2011-2012 por cuatro
estudiantes de Ingeniería Informática de la Universidad de Alicante —**Sergio Gallardo
Sales, Alejandro Oñate Latorre, Martín Candela Calabuig y Rubén Pardo Millá**, el
*Chutaos Team*— y calificado con matrícula de honor.

Los nombres deben aparecer en los créditos, junto con los de la música original,
**Adrián Gómez Marín y Almudena Segovia Calabuig**.

Los números de las tablas son los que se jugaron. Donde el original estaba mal, lo he
dicho y he puesto el valor corregido. Si alguno te estorba para que el juego sea
jugable, cámbialo y dímelo.
