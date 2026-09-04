# Roadmap — épicas, tareas y asignación a agentes

Nomenclatura: `[P##]` = requisito de paridad con el original (GDD §2).
`[E-##]` = evolutivo (`05-evolutivos.md`). Estado: ⬜ pendiente · 🟨 en curso · ✅ hecho.

---

## Hito 0 — Arqueología y fundamentos

| # | Tarea | Agente | Estado |
|---|---|---|---|
| 0.1 | Analizar IA, Simplex y triangulación del legacy | `arqueologo-legacy` (Fable 5.1) | ✅ |
| 0.2 | Reconstruir las reglas de juego del legacy | `arqueologo-legacy` (Fable 5.1) | ✅ |
| 0.3 | Inventariar datos, assets y especificar el conversor | `arqueologo-legacy` (Fable 5.1) | ✅ |
| 0.4 | Analizar los cinco motores propios y sus dependencias | `arqueologo-legacy` (Fable 5.1) | ✅ |
| 0.5 | ADR de motor y stack | PO Técnico (Opus 5) | ✅ |
| 0.6 | GDD completo | PO Técnico (Opus 5) | ✅ |
| 0.7 | Arquitectura y ADR-002..005 | `godot-arquitecto` (Opus 5) | ✅ |
| 0.8 | Roster de agentes y reglas de equipo | PO Técnico (Opus 5) | ✅ |
| 0.9 | Mover el proyecto C++ a `legacy/` preservando historia | PO Técnico | ✅ |

## Hito 1 — Esqueleto jugable *(el objetivo es "se mueve y dispara", no "es bonito")*

| # | Tarea | Paridad | Agente | Estado |
|---|---|---|---|---|
| 1.1 | `project.godot`, estructura, autoloads, contratos base | — | `godot-arquitecto` | 🟨 |
| 1.2 | Recursos `.tres` de balanceo con los valores canónicos del legacy | P01 P02 | `godot-arquitecto` | 🟨 |
| 1.3 | `Character` + `CharacterBody3D` + intenciones | P01 | `godot-gameplay` | 🟨 |
| 1.4 | Controlador del jugador + cámara TPS + mando | P17 | `godot-gameplay` | 🟨 |
| 1.5 | Armas: fuego, cuchillo, explosivo, munición, recarga | P06 | `godot-gameplay` | 🟨 |
| 1.6 | Salud, daño localizado, muerte, puntuación, XP | P06 P12 | `godot-gameplay` | 🟨 |
| 1.7 | `AIScheduler` con presupuesto de CPU (ADR-002) | — | `godot-arquitecto` | 🟨 |
| 1.8 | Conversor de mapas legacy + validador | P16 | `level-conversor` | 🟨 |
| 1.9 | Navmesh, enlaces de puerta, muestreo de spawns | P08 P10 | `ai-navegacion` | 🟨 |
| 1.10 | CI: gdlint + tests headless + 3 exports | — | `devops-ci` | 🟨 |

## Hito 2 — La IA que justifica el remake

| # | Tarea | Paridad | Agente | Estado |
|---|---|---|---|---|
| 2.1 | Percepción: visión con oclusión, dos conos | P07 | `ai-percepcion` | 🟨 |
| 2.2 | Oído propagado por navmesh + eventos sonoros | E-04 | `ai-percepcion` | 🟨 |
| 2.3 | Memoria de contactos con confianza decreciente | P07 | `ai-percepcion` | 🟨 |
| 2.4 | Difusión de contactos con retardo de reacción | — | `ai-percepcion` | 🟨 |
| 2.5 | Selector por utilidad + histéresis | — | `ai-comportamiento` | 🟨 |
| 2.6 | Árboles de comportamiento y ejecución | — | `ai-comportamiento` | 🟨 |
| 2.7 | Arquetipos como tablas de pesos | P02 | `ai-comportamiento` | 🟨 |
| 2.8 | Horneado y puntuación de puntos de cobertura | P09 | `ai-navegacion` | 🟨 |
| 2.9 | Rutas alternativas disjuntas para flanqueo | — | `ai-navegacion` | 🟨 |
| 2.10 | `SquadDirector`, roles, supresión, repliegue | — | `ai-escuadra` | 🟨 |
| 2.11 | Compañeros + moral + órdenes del jugador | P05 | `ai-escuadra` | 🟨 |
| 2.12 | Escenarios de comportamiento con aserciones (GDD §12) | — | `qa-tests` | 🟨 |

## Hito 3 — Director de encuentros

| # | Tarea | Paridad | Agente | Estado |
|---|---|---|---|---|
| 3.1 | Simplex de dos fases con racionales exactos + entero | P11 | `director-encuentros` | 🟨 |
| 3.2 | Modelo vivo de habilidad del jugador (DDA) | E-03 | `director-encuentros` | 🟨 |
| 3.3 | Restricciones sensibles a la forma del mapa | E-03 | `director-encuentros` | 🟨 |
| 3.4 | Curva de tensión y oleadas | E-03 | `director-encuentros` | 🟨 |
| 3.5 | Reglas justas de aparición | — | `director-encuentros` | 🟨 |
| 3.6 | Tests del director (determinismo, monotonía, justicia) | — | `qa-tests` | ⬜ |

## Hito 4 — Progresión, torre y UI

| # | Tarea | Paridad | Agente | Estado |
|---|---|---|---|---|
| 4.1 | Máquina de estados de juego: Menú/Estrategia/Acción/Créditos | P14 | `godot-arquitecto` | ⬜ |
| 4.2 | 8 plantas × 6 zonas + tabla de selección de mapa | P03 | `godot-arquitecto` | ⬜ |
| 4.3 | Recompensas por zona | P04 | `godot-gameplay` | ⬜ |
| 4.4 | Guardado/carga en JSON versionado | P12 | `godot-arquitecto` | ⬜ |
| 4.5 | HUD completo | — | `ui-ux` | ⬜ |
| 4.6 | **Pantalla de Estrategia** (el hueco del original) | P14 | `ui-ux` | ⬜ |
| 4.7 | Menús, pausa, game over, victoria, créditos | P14 | `ui-ux` | ⬜ |
| 4.8 | Consola de comandos | P13 | `ui-ux` | ⬜ |
| 4.9 | Accesibilidad + i18n ES/EN | — | `ui-ux` | ⬜ |
| 4.10 | Puertas, obstáculos, pickups como escenas | P08 P09 | `godot-gameplay` | ⬜ |

## Hito 5 — Contenido y presentación

| # | Tarea | Paridad | Agente | Estado |
|---|---|---|---|---|
| 5.1 | Cel-shading + materiales + paleta | — | `arte-audio` | ⬜ |
| 5.2 | Bloqueo de personajes y mobiliario | — | `arte-audio` | ⬜ |
| 5.3 | **Auditoría de licencias de los assets del legacy** | — | `arte-audio` | ⬜ |
| 5.4 | Buses de audio, música por estado, eventos 3D | — | `arte-audio` | ⬜ |
| 5.5 | Paquete de sonido opcional "Chutaos" | — | `arte-audio` | ⬜ |
| 5.6 | MiniBoss y MegaBoss con fases | P02 | `ai-comportamiento` | ⬜ |
| 5.7 | Planta 9 (azotea) y combate final | — | `level-procedural` | ⬜ |
| 5.8 | Generador procedural de plantas | E-02 | `level-procedural` | ⬜ |
| 5.9 | Habilidades de clase | E-01 | `godot-gameplay` | ⬜ |
| 5.10 | Revisión adversarial de rutas críticas | — | `revisor-critico` | ⬜ |

## Hito 6 — Publicable

| # | Tarea | Agente | Estado |
|---|---|---|---|
| 6.1 | Pruebas de rendimiento: 60 fps con 40 bots | `qa-tests` | ⬜ |
| 6.2 | Balanceo con datos de partidas reales | `director-encuentros` | ⬜ |
| 6.3 | Exports firmados de las 3 plataformas | `devops-ci` | ⬜ |
| 6.4 | README, capturas, guía de contribución | PO Técnico | ⬜ |
| 6.5 | Licencia (BSD, como el original) y atribuciones | PO Técnico | ⬜ |

---

## Grafo de dependencias (lo que no se puede paralelizar)

```
1.1 contratos ─┬─→ 1.3 …1.6 gameplay ──┐
               ├─→ 1.7 scheduler ──────┼─→ 2.1…2.4 percepción ─┐
               └─→ 1.2 balance         │                        ├─→ 2.5…2.7 comportamiento ─┐
1.8 conversor ─────→ 1.9 navmesh ──────┴─→ 2.8 2.9 cobertura ──┘                            ├─→ 2.10 2.11 escuadra
                                                                                              │
3.1 simplex (independiente) ─→ 3.2…3.5 director ←──────────────────────────────────────────────┘
```

**Se puede lanzar ya en paralelo, sin bloqueos entre sí:** 1.1+1.2 (contratos y datos),
1.8 (conversor, solo depende del análisis), 3.1 (Simplex, puro y aislado), 1.10 (CI).
El resto espera a que existan los contratos: **un agente nunca inventa la interfaz de
otro** (regla 3 del equipo).
