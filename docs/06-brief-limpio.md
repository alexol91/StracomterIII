# Torre Chutaos — definición del juego

Documento de encargo. Describe **qué se juega**, no cómo se construye.
Ninguna decisión de implementación está tomada: motor, lenguaje, arquitectura,
estructura de ficheros y algoritmos los eliges tú.

---

## 1. El juego en una frase

**Shooter táctico en tercera persona en el que recuperas tu propia empresa, planta
por planta, acompañado de una escuadra.**

Un comando armado ha tomado la **Torre Chutaos**, la sede de la empresa que fundaron
cuatro ingenieros informáticos. Controlan de la planta 1 a la 8, y su jefe espera en
la azotea. Tú eres uno de los cuatro socios fundadores. Entras por abajo y subes.

La fantasía no es «soy un supersoldado»: es **«esta empresa es mía»**. El escenario es
una oficina de verdad —mesas, sillas, cubículos, estanterías, puertas de cristal,
máquinas de café, plantas de interior— y eso es lo que lo hace memorable: se combate
entre escritorios, no en un búnker genérico.

Es un juego de un solo jugador. Los compañeros los lleva la máquina.

---

## 2. Requisitos de la entrega

Son restricciones del encargo, no de diseño:

1. **Se juega en ordenador y en móvil.** Si puede ser en un navegador, mejor:
   interesa poder abrirlo con un enlace y también empotrarlo después en una app móvil.
2. **Nada que cueste dinero ni obligue a pagar licencias ni royalties**, ni ahora ni
   si el juego se distribuyera. Tecnología libre o gratuita sin condiciones.
3. **Controles para las dos plataformas**: teclado y ratón en ordenador, controles
   táctiles en móvil. No es aceptable un control táctil que haga el juego injugable.
4. **Se entrega funcionando**: se abre, se juega una partida entera de principio a
   fin y se puede terminar. Una demo que arranca y no se puede acabar no cuenta.

---

## 3. Los tres bucles

* **30 segundos:** entras en una zona, lees la disposición de la sala, limpias la
  resistencia con tu escuadra, recoges el botín.
* **8-12 minutos:** eliges por qué zona entras a la planta, la limpias, cobras la
  recompensa, subes.
* **45-90 minutos:** planta 1 → planta 8 → azotea → final.

---

## 4. Las cuatro clases jugables

Eliges una al empezar la partida. Los compañeros también tienen clase.

| Clase | Vida | Velocidad | Cadencia de disparo | Daño por bala | Lo que la distingue |
|---|---|---|---|---|---|
| **Capitán** | 160 | normal | 10 disparos/s | 10 | **Aura de moral**: cura +1 de vida cada 2 s a los aliados a menos de 8 m |
| **Técnico** | 85 | la más alta (+25 %) | 12,5 disparos/s | 7 | El más rápido y el de mayor cadencia. Frágil |
| **Especialista** | 125 | normal | 5 disparos/s | 5 | **Aura de munición**: +10 balas cada 4 s a los aliados a menos de 8 m |
| **Explosivo** | 110 | +12 % | 2 disparos/s | 60 en el centro | Su disparo **estalla**: daño en un radio de 2 m con caída lineal |

Comunes a todas: **50 balas** de munición inicial. **Cuchillo** cuerpo a cuerpo: 30 de
daño, un golpe cada 0,5 s, alcance ~1 m.

El jugador se mueve **entre 2,5 y 3,8 veces más rápido que cualquier enemigo**. No es
un error: es la fantasía del juego. Lo que compensa esa ventaja es que los enemigos se
coordinan y tú estás rodeado.

**Cada clase tiene además una habilidad activa**, con tiempo de recarga:

* **Capitán — Órdenes:** marca un objetivo y toda la escuadra lo enfoca.
* **Técnico — Hackeo:** abre a distancia una puerta cerrada.
* **Especialista — Supresión:** fuego sostenido que clava a los enemigos en cobertura
  y les impide avanzar.
* **Explosivo — Demolición:** **abre un agujero en un muro** y crea una ruta que no
  existía. Los enemigos deben darse cuenta y usarla también.

---

## 5. Los enemigos

| Tipo | Vida | Velocidad | Cadencia | Daño | Puntos | Cómo pelea |
|---|---|---|---|---|---|---|
| **Sicario** | 45 | 150 | 2 disparos/s | 1 | 3 | Frágil y numeroso. Presiona por cantidad, no por daño |
| **Miliciano** | 50 | 140 | 1,25 disparos/s | 3 | 5 | Equilibrado. Usa cobertura y rodea |
| **Veterano** | 65 | 130 | 1,66 disparos/s | 2 | 7 | Duro. Dispara para fijarte mientras otro avanza |
| **MiniBoss** | 200 | 80 | 2 disparos/s | 30 | 50 | Guardián de planta. Su ataque **estalla en área** |
| **MegaBoss** | 500 | 60 | 5 disparos/s | 10 | 500 | Azotea. Pelea **por fases** y pide refuerzos al cambiar de fase |

Los tres tipos básicos **no suben de estadísticas** según la planta. Lo que cambia es
cuántos hay, de qué tipo y cómo se comportan. Subir la vida de los enemigos planta a
planta es la forma barata de escalar la dificultad; escalar la composición y la táctica
es la buena.

Los enemigos tienen munición limitada: cuando se les acaba, recargan o se lanzan al
cuerpo a cuerpo. No se quedan quietos sin hacer nada.

---

## 6. La torre

Nueve niveles. Cada uno tiene su carácter y su amenaza dominante.

| Planta | Qué es | Ambiente | Amenaza |
|---|---|---|---|
| 1 | Recepción y vestíbulo | Mármol, tornos, mostrador | Sicarios. Tutorial encubierto |
| 2 | Soporte y atención al usuario | Cubículos, tickets impresos | Sicarios y Milicianos |
| 3 | Desarrollo | Mesas dobles, pizarras, cafeteras | Milicianos. Primer MiniBoss |
| 4 | Calidad y preproducción | Salas de pruebas, armarios de equipos | Mezcla de todo |
| 5 | Centro de datos | Pasillos fríos, rejillas, poca luz | Veteranos. Casi no hay dónde cubrirse |
| 6 | Comercial y marketing | Diáfano, cristal, moqueta | Combate a distancia larga |
| 7 | Dirección | Despachos cerrados, madera, moqueta buena | Veteranos y MiniBoss |
| 8 | Sala de juntas | El asalto final al interior | Todo a la vez |
| 9 | Azotea | Helipuerto, viento, de noche | **MegaBoss** |

**Cada planta tiene 6 zonas** y el jugador elige por cuál entra. La zona determina el
mapa que se juega y la recompensa que se cobra al limpiarlo. Las zonas bajas son mapas
pequeños con menos enemigos y peor recompensa; las altas son mapas grandes, con más
enemigos y mejor recompensa. Esa tensión es la decisión principal de la partida.

El escenario tiene **puertas que se abren y se cierran**, y cerrar una **cambia por
dónde se puede pasar** — para ti y para ellos. El mobiliario de oficina sirve de
cobertura y de obstáculo: una mesa te protege agachado, una planta de interior no para
una bala pero **rompe la línea de visión**, que a veces vale más.

---

## 7. Entre planta y planta: la pantalla de Estrategia

Al limpiar una planta el juego se detiene y muestra **el plano de la planta siguiente**
con sus seis zonas. De cada zona se ve **la recompensa** y **una lectura de la amenaza**
(tamaño del mapa, si hay MiniBoss, si es espacio abierto o pasillos).

| Zona | Recompensa |
|---|---|
| 1 | +20 de munición |
| 2 | +20 de vida |
| 3 | +50 de munición |
| 4 | +50 de vida |
| 5 | +100 de munición |
| 6 | +100 de vida |

**Se ve el plano; no se ve la composición enemiga.** El jugador decide con información
parcial, que es lo que convierte una elección en una decisión.

Aquí también se gasta la experiencia acumulada (cada enemigo muerto da los puntos de su
tabla), se recompone la escuadra —qué compañeros llevas y de qué clase— y se recuperan
las bajas.

---

## 8. Cómo se siente el combate

* **Las balas impactan al instante.** No hay proyectiles viajando por el aire.
* **Apuntar importa:** a la cabeza hace 2,5 veces el daño, al torso el normal, a brazos
  y piernas un 30 % menos.
* **Fallar cuesta:** la bala se gasta igual. Hay recarga, con su tiempo muerto.
* **Las explosiones hacen daño amigo**; los disparos normales no. Es lo que da peso a
  la clase Explosivo sin hacer insufribles a los compañeros.
* **Las explosiones necesitan línea de visión**: no atraviesan paredes, y su daño cae
  con la distancia hasta cero en 2 m.
* **La vida no se regenera sola.** Se recupera con el aura del Capitán y con la
  recompensa de zona.
* **Granada** disponible como recurso limitado, con su tiempo de recarga.
* **El alcance de las armas debe funcionar a la escala de las salas.** Si un mapa mide
  30 m, un arma que alcanza 7 m convierte todo tiroteo en una pelea a cuchillo.

---

## 9. Qué tienen que hacer los enemigos

Esto es el corazón del juego y es donde se nota si está bien hecho. Descrito en lo que
el jugador **ve**, no en cómo se programa:

* **No ven a través de las paredes.** Estar dentro de su campo de visión no basta: si
  hay un muro, una puerta cerrada o un armario en medio, no te ven. Y lo contrario: si
  sales de su campo de visión, dejan de verte.
* **Oyen.** Los disparos, las explosiones, las puertas y los pasos se oyen, y el sonido
  **se propaga por donde se puede andar**, no en línea recta: un disparo al otro lado de
  una pared se oye lejano, el mismo disparo al final de un pasillo recto se oye encima.
* **Recuerdan, y se equivocan de forma creíble.** Al perderte de vista van a donde
  creen que estás, no a donde estás. Esa creencia se va desdibujando con el tiempo:
  primero van directos, luego buscan por la zona, luego se rinden y vuelven a patrullar.
* **Se avisan entre ellos**, con un pequeño retardo de reacción. El grupo reacciona como
  grupo, pero no todos a la vez ni al instante.
* **Se cubren.** Buscan activamente dónde ponerse para que no les des, y eso depende de
  dónde estés tú. No se quedan de pie en mitad de la sala.
* **Se reparten el trabajo.** Mientras uno te dispara para que no asomes la cabeza, otro
  te rodea **por otro camino distinto** — no «el mismo camino girado 90 grados».
  Nadie avanza a pecho descubierto si nadie le está cubriendo.
* **Se retiran.** Si el grupo pierde más de la mitad, se repliega y se reagrupa en lugar
  de ir muriendo de uno en uno.
* **No se quedan atascados.** Nunca más de 3 segundos dando vueltas contra una esquina.

**Cantidad y mezcla de enemigos.** No se escribe a mano por planta: se calcula a partir
de **el tamaño y la forma de la zona** (un pasillo estrecho pide Sicarios; una sala
abierta y larga admite Veteranos) y de **cómo lo está haciendo el jugador** —puntería,
daño recibido, tiempo que tarda en limpiar, compañeros caídos—. Si el jugador va
sobrado, sube; si va ahogado, baja. Debe ser **monótono**: jugar peor nunca puede
acabar dando más amenaza.

**Y no aparecen todos de golpe.** Una zona tiene un ritmo: primero oleadas pequeñas
mientras avanzas, después un pico donde se gasta el grueso, después un alivio con algún
rezagado suelto para que puedas recoger botín sin que el sitio parezca apagado, y por
último silencio antes de pasar a la siguiente.

**Aparecer tiene reglas, y son de justicia:**
* Nunca a menos de 12 m del jugador.
* **Nunca dentro de su campo de visión** ni donde pueda verlos aparecer.
* Preferentemente por accesos reales —puertas, escaleras, ascensores— y no en mitad de
  una sala.
* Siempre en un sitio desde el que se pueda llegar andando hasta el jugador.

---

## 10. Los compañeros

Van contigo, pelean, y usan **el mismo cerebro que los enemigos** con otras prioridades:
mantener la formación, cubrirte y apoyarte con fuego.

Les puedes dar tres órdenes: **ir ahí**, **enfocar eso** y **mantener la posición**.

Tienen **moral**, y la moral modula la obediencia: con la moral alta hacen lo que les
dices; con la moral baja priorizan sobrevivir. La moral baja cuando caen compañeros y
sube con el aura del Capitán y con los encuentros ganados.

---

## 11. Pantallas e interfaz

**Durante el juego:** vida, munición, estado de la escuadra, moral, puntuación, tiempo,
enemigos restantes, y un indicador de **por dónde te están disparando**.

**Pantallas:** Título · Elección de clase · Estrategia · Juego · Pausa · Fin de planta ·
Derrota · Victoria · Créditos · Opciones.

Dos cosas que es muy fácil dejarse y que rompen el juego:
* **La pantalla de Victoria tiene que verse.** Limpiar la azotea termina la partida y
  eso se celebra; no se salta directo a los créditos.
* **El resumen de fin de planta tiene que durar en pantalla** lo suficiente para
  leerlo.

**Accesibilidad:** remapeo de controles, subtítulos, tamaño de interfaz ajustable, modo
daltónico, sensibilidad y campo de visión ajustables, y poder desactivar la sacudida de
cámara.

**Idiomas: español e inglés desde el primer día**, y el juego arranca en español.

---

## 12. Consola de trucos

El original tenía una consola de comandos y era su mejor herramienta. Se quiere igual,
accesible con una tecla:

| Comando | Qué hace |
|---|---|
| `spawn <tipo> <x> <y>` | Crea un enemigo o aliado del tipo indicado |
| `team <tipo> <x> <y>` | Crea diez de golpe |
| `kill all` / `kill bad` / `kill me` | Mata a todos / solo a los enemigos / al jugador |
| `god` | Invulnerable |
| `noclip` | Atravesar paredes |
| `ammo` / `health` | Munición y vida al máximo |
| `floor <n>` | Saltar a una planta |

**Un truco que no hace nada es peor que un truco que no existe:** si `god` contesta
«modo dios activado» y el jugador se sigue muriendo, manda a buscar el problema a otro
sitio. Cada comando que se registre tiene que tener a alguien que lo lea.

---

## 13. Aspecto y sonido

**Colores planos y contorno marcado**, estilo cómic. Es una elección deliberada: hace
que unos modelos sencillos parezcan intencionados en lugar de pobres.

* Gris corporativo y azul para la torre; naranja y rojo para los hostiles.
* Modelos sencillos, legibles de un vistazo: hay que distinguir un Sicario de un
  Veterano a diez metros y de espaldas.
* **Sonido posicional**: oír de dónde viene un disparo tiene que servir para jugar.
* Música distinta en menú, en estrategia, en combate y contra el jefe.

**No uses música ni sonidos de los que no tengas derechos.** Si no hay material libre,
prefiero silencio o algo generado antes que un problema de licencia.

---

## 14. Modos de partida

* **Campaña:** planta 1 a la azotea, con guardado y carga.
* **Partida rápida:** una planta suelta, sin progresión, para probar.

---

## 15. Cómo se juzga que está terminado

Esta es la lista. Nada de esto es opcional y todo se comprueba **jugando**, no leyendo
el código:

1. Se abre en un ordenador y en un móvil, y se puede jugar en los dos.
2. El jugador se mueve, apunta, dispara, recarga, usa el cuchillo y su habilidad.
3. Los enemigos **reaccionan**: te ven, te persiguen, te disparan y te aciertan.
4. Los enemigos **no disparan a través de las paredes** ni te ven a través de una
   puerta cerrada.
5. Los enemigos **se cubren** y al menos a veces **te rodean por otro camino**.
6. Los compañeros te siguen, disparan y obedecen las órdenes.
7. Una zona se puede **limpiar**, y al limpiarla el juego lo detecta y lo dice.
8. La recompensa se cobra y se nota en vida o munición.
9. Se puede **subir de planta** y la planta siguiente es distinta.
10. Se llega a la azotea, se pelea contra el MegaBoss y **aparece la pantalla de
    Victoria**.
11. Se puede morir, y aparece la pantalla de Derrota con opción de reintentar.
12. Se guarda y se carga la partida.
13. La consola funciona y **cada truco hace de verdad lo que dice**.
14. Arranca en español.
15. Va fluido con **40 enemigos activos a la vez** en un portátil normal.

---

## 16. De dónde viene esto

Es la especificación de un juego real: *Stracomter III*, hecho en 2011-2012 por cuatro
estudiantes de Ingeniería Informática de la Universidad de Alicante —**Sergio Gallardo
Sales, Alejandro Oñate Latorre, Martín Candela Calabuig y Rubén Pardo Millá**, el
*Chutaos Team*— y calificado con matrícula de honor. Los nombres deben aparecer en los
créditos.

Los números de las tablas son los que se jugaron de verdad. Los he conservado porque
funcionaban. Si alguno te estorba para que el juego sea jugable, cámbialo y dímelo.
