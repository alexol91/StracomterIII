# Stracomter III: Torre Elite

Remake en **Godot 4.7** de *StracomterIII dos puntos espacio, el mejor juego de la
historia*, el shooter táctico que **Chutaos Team** desarrolló en C++ durante el curso
2011-2012 como proyecto ABP de la Universidad de Alicante, y que obtuvo matrícula de
honor.

> Un comando terrorista toma la **Torre Elite**, la sede de la empresa fundada por *La
> Elite*, un grupo de ingenieros informáticos. Ocho plantas, seis zonas por planta, una
> escuadra y una azotea. Se sube matando.

**Equipo original:** Sergio Gallardo Sales · Alejandro Oñate Latorre ·
Martín Candela Calabuig · Rubén Pardo Millá.
El proyecto de 2012 se liberó bajo licencia BSD.

---

## Estado

En desarrollo activo. El proyecto original vive intacto en `legacy/` y **ya no se
compila**: se ha convertido en especificación. La arqueología completa de aquel código
—con cita `fichero:línea` de cada afirmación— está en `docs/analisis/`.

## Qué hay aquí

```
game/         Proyecto Godot 4.7 (abre esta carpeta en el editor)
docs/         Decisión de motor, GDD, arquitectura, roadmap y evolutivos
docs/analisis/ Arqueología del C++ de 2012: reglas, IA, Simplex, datos y motores
legacy/       El proyecto original de 2011-2012, intacto y de SOLO LECTURA
tools/        Conversor de los 26 mapas originales a escenas de Godot
.claude/agents/ Los 15 agentes especializados que desarrollan el proyecto
```

Empieza por [`docs/01-gdd.md`](docs/01-gdd.md) si te interesa el juego, o por
[`docs/00-decision-tecnologica.md`](docs/00-decision-tecnologica.md) si te interesa por
qué Godot.

## Cómo ejecutarlo

Necesitas **Godot 4.7.2** ([descarga](https://godotengine.org/download)). No hace falta
nada más: ni compilador, ni SDK, ni licencia.

```bash
godot --path game                      # abrir el juego
godot --headless --path game res://tests/run_tests.tscn   # pruebas, sin GPU
```

Las pruebas salen con código distinto de cero si algo falla, y es lo que corre CI.

## Qué se conserva del original y qué no

**Se conserva** el diseño de juego completo: las cuatro clases con sus estadísticas
reales, los tres arquetipos de enemigo y los dos jefes, las 8 plantas × 6 zonas con su
tabla exacta de mapas y recompensas, los compañeros de escuadra, las puertas que alteran
la navegación, el combate con sus fórmulas, **los 26 mapas dibujados a mano en 2012**
(convertidos automáticamente a 3D) y el **Simplex** que decidía la composición enemiga.

**Se rehace** todo lo que en 2012 hubo que escribir a mano porque no había motor: el
motor gráfico sobre OpenGL de pipeline fijo, el wrapper de Box2D, el de sonido, el de
partículas y la biblioteca de widgets propia. Godot los da hechos y mejores, y eso libera
al proyecto para trabajar en lo único que sigue teniendo valor: **el diseño y la IA**.

**Se corrige** lo que la arqueología demostró que estaba roto. Tres ejemplos:

* Las estadísticas estaban **triplicadas y contradictorias** en tres ficheros, y las que
  el juego usaba de verdad no eran las que parecía.
* La programación lineal que elegía los enemigos era **degenerada**: su óptimo entero
  daba ~26 enemigos del mismo tipo, planta tras planta. Se conserva el solucionador
  (con aritmética racional exacta, como el original) y se reformula el problema.
* Los bots veían **a través de las paredes** —comprobaban el cono de visión pero no la
  oclusión— y su cono periférico era código inalcanzable.

## Licencia

Pendiente de fijar; la intención es **BSD**, como el proyecto original. Los assets del
legacy están bajo auditoría: hay material de terceros que no se reutilizará.
