# Stracomter III

*dos puntos espacio, el mejor juego de la historia*

Shooter táctico en tercera persona: recuperas la Torre Chutaos planta a planta con tu escuadra.
El encargo está en [`DEFINICION-DEL-JUEGO.md`](DEFINICION-DEL-JUEGO.md) y todo lo que se aparta de él
en [`DECISIONES.md`](DECISIONES.md).

## Jugar

Hace falta Node 20 o superior.

```bash
npm install
npm run dev
```

Abre la dirección que imprime (por defecto `http://localhost:5173`). Para jugar en el móvil, con el
móvil en la misma wifi abre la dirección «Network» que imprime el mismo comando y pon el teléfono en
horizontal.

Para generar la versión que se sube a un servidor o se empotra en una app:

```bash
npm run build      # deja el juego en dist/ (ficheros estáticos, rutas relativas)
npm run preview    # sirve dist/ para comprobarlo
```

## Controles

| Ordenador | Acción |
|---|---|
| W A S D | Mover |
| Ratón | Apuntar y girar la cámara (clic en el juego para capturar el ratón) |
| Clic izquierdo / derecho | Disparar con el arma en mano / apuntar al hombro |
| 1 · 2 · 3 · 4 | Arma principal · pistola · cuchillo · granada |
| Q · rueda | Arma anterior · cambiar de arma |
| Mayús · Ctrl (o C) | Correr · agacharse |
| R · E · F | Recargar · puerta · habilidad de clase |
| G · V | Granada rápida · cuchillada rápida |
| T · Tab | Usar objeto · cambiar de objeto |
| Z · X · B · N | Órdenes: a mí · ir ahí · enfocar eso · mantener posición |
| Alt + rueda · Esc | Zoom · pausa |
| º (la tecla a la izquierda del 1) o F2 | Consola de trucos |

Los controles siguen los de Counter-Strike. Ctrl + W cierra la pestaña del navegador: el juego pide
confirmación, y en pantalla completa (Opciones → Controles) el navegador no lo intercepta.

En móvil: stick a la izquierda, arrastrar a la derecha para mirar, botón grande de disparo (se puede
arrastrar sin soltar para apuntar) y apuntado asistido. Todo se puede remapear en Opciones.

Si el navegador no concede la captura del ratón, se puede girar arrastrando con un botón pulsado o con
las flechas del teclado.

## Consola de trucos

`help` lista los comandos: `spawn`, `team`, `kill all|bad|me`, `god`, `noclip`, `ammo`, `health`,
`floor <n>`, `zone <n>`, `tp <x> <y>`, `info [id]`, `ai.debug`, `chutaos on|off`. Usar un truco marca la partida
y deja de puntuar para los récords.

## Comprobar que funciona sin abrir el navegador

```bash
npm test                              # pruebas de la simulación y de los mapas
npm run partida                       # un bot juega la campaña entera con la simulación real
npm run partida -- 3 5                # solo planta 3, zona 5
GOD=1 npm run partida -- campaña 5    # campaña por las zonas grandes, sin poder morir
npx tsx tools/dump-maps.ts            # dibuja todos los mapas en tools/out/index.html
```

El bot comprueba la lógica (que cada planta se puede limpiar, que se guarda, que nadie se atasca), no
que el juego se vea ni se sienta bien: eso hay que jugarlo.

## Estructura

```
src/sim      simulación pura: mundo, IA, director, campaña, consola, mapas (sin DOM)
src/render   dibujo con three.js
src/ui       pantallas, HUD, idiomas, ajustes
src/input    teclado, ratón y táctil
src/audio    sonido y música sintetizados
src/maps     los tres mapas reales de la planta 1
tools        bot de partidas y volcado de mapas
tests        pruebas
```
