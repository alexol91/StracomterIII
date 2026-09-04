# ADR-001 — Motor y stack tecnológico del remake

**Estado:** Aceptada · **Fecha:** 2026-09-04 · **Decide:** PO Técnico / Arquitectura

## Contexto

Hay que reimplementar *StracomterIII* (C++/OpenGL/SFML/Box2D, 2011-2012, ~50.000 LOC
propias) sobre tecnología moderna, con tres restricciones duras del cliente:

1. Desarrollo en **Linux, macOS y Windows**.
2. **Sin licencia comercial** ni royalties: es un experimento personal.
3. El desarrollo lo ejecutan **agentes de IA**, no un equipo humano a tiempo completo.

La restricción (3) es la que realmente decide, y es la que normalmente se ignora.
Un motor cuyo estado de proyecto vive en ficheros binarios propietarios convierte a
un agente en un operador ciego: no puede leer una escena, no puede hacer diff, no
puede revisarla en un PR y no puede regenerarla de forma determinista.

## Decisión

**Godot 4.7.2 (stable, 26-ago-2026), GDScript, render Forward+, física Jolt.**

## Justificación

| Criterio | Godot 4.7 | Unity 6 | Unreal 5 |
|---|---|---|---|
| Licencia | **MIT. 0 € y 0 % royalties, siempre** | Gratis <200 k$ ingresos, requiere activación de cuenta | Gratis hasta 1 M$, luego 5 % royalties |
| Editor en Linux | **Soportado de primera clase** | Build de Linux secundaria | Sí, pero pesada |
| Tamaño del toolchain | **~120 MB** | ~15 GB | ~100+ GB |
| Formato de escena | **`.tscn` / `.tres` = texto plano, diffeable** | `.unity`/`.prefab` YAML con GUIDs frágiles | `.uasset` **binario** |
| ¿Un agente puede escribir una escena a mano? | **Sí, y es la vía normal** | A duras penas | No |
| Modo headless para CI/tests | **`--headless` nativo** | Batch mode con licencia | Commandlets, muy pesado |
| Navegación 3D + evitación | `NavigationServer3D` + RVO2 integrado | NavMesh (AI Navigation) | Navmesh + EQS |
| Exportación multiplataforma | Un binario de export templates | Módulos por plataforma | Sí |

Los tres motores sirven para hacer este juego. Solo uno permite que **el código fuente
del juego entero —lógica, escenas, materiales, configuración— sea texto revisable en un
pull request**. Con `.uasset` binario, un remake dirigido por agentes es inviable: no
hay diff, no hay revisión, no hay reproducibilidad. Con Godot, una escena es un fichero
de texto que un agente escribe, otro agente revisa y CI valida en headless.

Beneficio secundario nada trivial: el proyecto original se construía con `cmake` +
`./construir.sh` y **hoy no compila** (OpenGL de pipeline fijo, SFML 1.6, GLUT). Godot
elimina de un golpe los cinco motores propios (gráfico, físico, sonido, partículas,
GUI) que representan la mayor parte de esas 50.000 líneas, y deja al equipo trabajar
en lo único que sigue teniendo valor: **el diseño de juego y la IA**.

## Consecuencias

* **A favor:** iteración rápida, CI real (`godot --headless` corre los tests), export a
  Linux/macOS/Windows desde cualquier host, cero coste, cero fricción legal.
* **En contra:** GDScript es más lento que C++ en bucles calientes. Mitigación: el
  presupuesto de CPU de la IA se controla con *time-slicing* (ver ADR-002 en
  `02-arquitectura.md`); si un sistema concreto se convierte en cuello de botella, se
  reescribe como extensión GDExtension en C++ sin tocar el resto.
* **En contra:** menos assets de tienda que Unity. Irrelevante: los assets se rehacen.
* Los cinco motores propios del legacy quedan **descartados como código**, pero
  **preservados como especificación**: `docs/analisis/` documenta su comportamiento
  exacto para que el remake pueda replicarlo.

## Stack completo

| Capa | Elección | Motivo |
|---|---|---|
| Motor | Godot 4.7.2 stable | ADR-001 |
| Lenguaje | GDScript (tipado estático estricto) | Sin toolchain de compilación; el agente edita y ejecuta |
| Física | Jolt (integrada en Godot ≥4.4) | Determinista, rápida, 3D real (el legacy simulaba en 2D) |
| Render | Forward+ | Luces dinámicas y sombras en interiores de oficina |
| Navegación | `NavigationServer3D` + navmesh horneado | Sustituye triangulación Delaunay + A* propios |
| Tests | GdUnit4 (en `--headless`) | Los sistemas de IA y el director son testeables sin render |
| CI | GitHub Actions | Lint + tests headless + export de las 3 plataformas |
| Assets 3D | glTF 2.0 (`.glb`) | Estándar abierto; el `.3ds` del legacy está muerto |
| Datos de juego | Recursos `.tres` + JSON | Texto, diffeable, editable por agentes y por humanos |
| Localización | `.csv` → `.translation` | ES / EN desde el día uno |

## Lo que NO se decide aquí

No se elige C# aunque Godot lo soporte. C# añade el SDK de .NET al toolchain, duplica
el ciclo de build y obliga a recompilar para que un agente vea el efecto de un cambio.
GDScript se recarga en caliente y se ejecuta desde `--headless` sin build previo. Si
más adelante hace falta rendimiento en un sistema concreto, la salida es GDExtension en
C++ (que además reaprovecha el conocimiento del equipo original), no C#.
