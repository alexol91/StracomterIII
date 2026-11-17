# Cómo trabajar en este repositorio

Este repositorio empieza vacío. El encargo está en `DEFINICION-DEL-JUEGO.md` y los tres
mapas de referencia en `MAPAS-DE-MUESTRA.json`.

Aquí no hay ninguna decisión técnica tomada. Motor, lenguaje, estructura y herramientas
los eliges tú. Lo que sigue son reglas de método, no de tecnología.

## El documento de definición es el contrato

* **No lo edites.** Es el encargo, no un borrador.
* Si algo del documento es imposible, contradictorio o una mala idea, **dilo en voz
  alta**; no lo ignores en silencio ni lo cambies por tu cuenta.
* Cada vez que te desvíes de lo que pide —otro número, otra mecánica, algo que recortas—
  **apúntalo en `DECISIONES.md`** con una línea: qué cambiaste y por qué. Ese fichero es
  parte de la entrega.

## Reparto de modelos

Este proyecto se trabaja con varios modelos a propósito. **Usa el más barato que haga
bien el trabajo**, y delega en subagentes indicando el modelo de forma explícita.

| Trabajo | Modelo |
|---|---|
| Diseño del juego, arquitectura, decisiones difíciles, el comportamiento de los enemigos, depurar lo que nadie entiende | **Fable** (`claude-fable-5-2`) |
| Revisión crítica, depuración metódica, repasar una entrega antes de darla por buena | **Opus** (`claude-opus-5-5`) |
| Todo lo demás: escribir pruebas, repetir patrones ya establecidos, maquetar interfaz, conectar assets, scripts de construcción, renombrar, documentar, convertir datos | **Sonnet** (`claude-sonnet-5-5`) |
| Buscar en ficheros, listar, comprobaciones mecánicas | **Haiku** (`claude-haiku-5-5`) |

Regla práctica: **si la tarea ya está decidida y solo hay que teclearla, no la hagas
tú.** Escribe el encargo con precisión y mándalo a Sonnet. Fable es para los problemas
que no se sabe cómo resolver, no para el trabajo que ya se sabe cómo hacer.

Lo mismo con la lectura: no te leas un fichero de 2.000 líneas para contestar a una
pregunta concreta; manda a buscarlo.

## Qué significa «terminado»

* **Juega una partida entera antes de decir que algo funciona.** Que compile y que las
  pruebas pasen en verde no significa que se juegue: los fallos de un juego de este tipo
  no dan error. Un enemigo que camina a un tercio de su velocidad, una pantalla que se
  muestra y se tapa en el mismo frame, un truco que contesta y no hace nada: ninguno sale
  por consola.
* **Mira lo que entregas.** Si es visual, haz una captura y míralo. Y mírala **desde
  donde se juega**, no desde un ángulo cómodo.
* **Monta pronto algo que se ejecute**, aunque sea feo, y manténlo ejecutable en todo
  momento. Es mucho peor descubrir al final que las piezas no encajan.
* La lista de la sección 21 del documento es la que decide. Repásala entera antes de
  entregar y di honestamente qué cumple y qué no. **Un punto a medias es un punto que
  no cumple.**

## Dos trampas que van a aparecer

* **Un valor por defecto no puede ser el permisivo.** Cuando a una comprobación le falta
  un dato —«¿me ve este enemigo?», «¿hay pared en medio?»— la respuesta por defecto
  tiene que ser la restrictiva. Un «sí» por defecto da enemigos con rayos X, y no
  produce ningún error.
* **Un doble de prueba más amable que la realidad hace que las pruebas mientan.** Si
  escribes una simulación para probar algo sin ejecutar el juego, anota qué modos de
  fallo reproduce y **cuáles no**.

## Licencias

Nada que cueste dinero ni obligue a pagar royalties, ahora o al distribuir. Antes de
meter una dependencia, una fuente, un modelo, una textura o un sonido, **comprueba su
licencia**. Si no puedes comprobarla, no lo metas. Anota en `DECISIONES.md` de dónde
sale cada asset de terceros.

## Idioma

* Interfaz del juego en **español**, con inglés disponible. Arranca en español.
* Explicaciones, documentación y commits **en español**.
