# Equipo de agentes — roster, modelos y responsabilidades

El desarrollo lo ejecuta un equipo de agentes especializados. Cada uno está definido
como fichero real en `.claude/agents/` y es invocable desde este repositorio.

## Criterio de asignación de modelo

No se asigna el modelo más caro a todo: se asigna según **si el error es detectable por
un test o no**.

| Modelo | Cuándo | Por qué |
|---|---|---|
| **Opus 5** | Diseño arquitectónico, algoritmos con corrección no obvia, IA táctica, revisión crítica | Un fallo de diseño en la arquitectura de IA no lo detecta ningún test: se propaga a todo el proyecto y se paga meses después. Aquí el coste del modelo es irrelevante frente al coste del rediseño |
| **Sonnet 5** | Implementación con especificación cerrada: gameplay, UI, herramientas, tests | El resultado es verificable de inmediato (compila, pasa el test, se ve en pantalla). Un modelo de gama media con especificación buena rinde igual que uno superior, y permite paralelizar más agentes a la vez |
| **Fable 5.1** | Análisis por abanico, inventarios, auditoría de assets, CI, audio, conversiones mecánicas | Trabajo de volumen y baja ambigüedad. Su ventaja es la latencia: 4 agentes Fable en paralelo terminan la arqueología del legacy en el tiempo que un solo agente grande tardaría en leerse un módulo |

## Roster

| # | Agente | Modelo | Ámbito | Ficheros que le pertenecen |
|---|---|---|---|---|
| 01 | `godot-arquitecto` | Opus 5 | Estructura del proyecto, autoloads, convenciones, revisión de diseño. Tiene voto de veto técnico | `game/project.godot`, `game/src/core/**` |
| 02 | `godot-gameplay` | Sonnet 5 | Personajes, controlador, cámara TPS, armas, salud, pickups, puertas | `game/src/gameplay/**` |
| 03 | `ai-percepcion` | Opus 5 | Vista con oclusión, oído por navmesh, memoria con confianza, contacto compartido | `game/src/ai/perception/**` |
| 04 | `ai-comportamiento` | Opus 5 | Selector por utilidad, árboles de comportamiento, arquetipos de enemigo | `game/src/ai/behavior/**` |
| 05 | `ai-escuadra` | Opus 5 | Roles, flanqueo, supresión, repliegue, compañeros y moral | `game/src/ai/squad/**` |
| 06 | `ai-navegacion` | Opus 5 | Navmesh, enlaces de puerta, horneado y puntuación de coberturas | `game/src/ai/navigation/**` |
| 07 | `director-encuentros` | Opus 5 | Simplex racional exacto, modelo de habilidad (DDA), curva de tensión, reglas de aparición | `game/src/director/**` |
| 08 | `level-conversor` | Sonnet 5 | Conversor XML legacy → `.tscn` 3D y validación de los 26 mapas | `tools/map_converter/**`, `game/maps/legacy/**` |
| 09 | `level-procedural` | Sonnet 5 | Generador de plantas de oficina, colocación de mobiliario y accesos | `game/src/levels/**` |
| 10 | `ui-ux` | Sonnet 5 | HUD, menús, pantalla de Estrategia, consola, accesibilidad, i18n | `game/src/ui/**` |
| 11 | `arte-audio` | Fable 5.1 | Cel-shading, materiales, bloqueo de assets, buses de audio, **auditoría de licencias** | `game/assets/**` |
| 12 | `qa-tests` | Sonnet 5 | GdUnit4 headless, escenarios de comportamiento, pruebas de humo | `game/tests/**` |
| 13 | `devops-ci` | Fable 5.1 | GitHub Actions, `gdlint`, exports de las 3 plataformas | `.github/workflows/**` |
| 14 | `arqueologo-legacy` | Fable 5.1 | Arqueología del C++ de 2012. **Solo lectura sobre `legacy/`** | `docs/analisis/**` |
| 15 | `revisor-critico` | Opus 5 | Revisión adversarial de rutas críticas. No escribe features, solo encuentra fallos | — (revisa, no posee) |

## Reglas de trabajo del equipo

1. **Propiedad exclusiva de ficheros.** Cada agente escribe solo en su ámbito. Los
   conflictos de merge entre agentes en paralelo son el fallo más caro y más evitable de
   este modelo de trabajo, y la forma de evitarlo es que dos agentes nunca puedan tocar
   el mismo fichero.
2. **`legacy/` es de solo lectura.** Sin excepciones. Es el documento fuente.
3. **Contratos antes que implementación.** `godot-arquitecto` publica las interfaces
   (`class_name`, firmas, señales) antes de que los agentes de IA implementen contra
   ellas. Un agente nunca inventa la interfaz de otro.
4. **Ningún número de balanceo en código.** Todo a `.tres` (ADR-005). Hay un test que
   lo comprueba.
5. **Todo sistema de IA es testeable en headless.** Si un sistema necesita render para
   probarse, está mal diseñado y `revisor-critico` lo rechaza.
6. **Paridad antes que evolutivos.** Nada de `05-evolutivos.md` se empieza hasta que
   la tabla de paridad `[P01]..[P17]` esté cerrada.
7. **Cada tarea entrega tests.** Una implementación sin test no se considera entregada.
