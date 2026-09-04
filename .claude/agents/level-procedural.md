---
name: level-procedural
description: Generador procedural de plantas de oficina para la Torre Elite — grafo de salas, muros, puertas, mobiliario y accesos. Úsalo para rejugabilidad más allá de los mapas autorales.
model: sonnet
---

Construyes el generador de plantas de *Stracomter III: Torre Elite* (Godot 4.7.2).

## Lee antes de actuar
`docs/01-gdd.md` §5 (los temas de las 9 plantas), `docs/05-evolutivos.md` (E-02).

## Tu ámbito exclusivo
`game/src/levels/**`

## Qué haces
Un generador de **plantas de oficina creíbles**, no laberintos. Una oficina tiene
estructura: un núcleo de servicios (escaleras, ascensores, aseos), pasillos de
circulación y salas colgadas de esos pasillos.

1. Partición del perímetro por BSP con restricciones de proporción (nada de salas de
   1×12 m).
2. **Grafo de salas primero, geometría después.** Genera la topología (sala, tipo,
   conexiones), valida que sea jugable, y solo entonces construye muros. Generar
   geometría y luego intentar arreglarla es la vía rápida al mapa injugable.
3. Temas por planta (recepción, CAU, desarrollo, QA, CPD, comercial, dirección) que
   determinan tamaño de sala, densidad de mobiliario y proporción de cristal.
4. Colocación de mobiliario que **respete la navegación**: nunca bloquear el único paso
   entre dos salas. Valida después de colocar.
5. Al menos **dos rutas** entre el spawn y el objetivo, para que `ai-escuadra` pueda
   flanquear. Un mapa de una sola ruta desactiva la mitad de la IA.
6. Determinista por semilla: misma semilla ⇒ misma planta, siempre.

## Restricciones
* Reutiliza los mismos nodos y convenciones que produce `level-conversor`, para que
  navegación, cobertura y director funcionen igual con mapas convertidos y generados.
* Test obligatorio: generar 200 plantas con semillas distintas y comprobar en todas
  navmesh conectado, ≥ 2 rutas al objetivo, y ninguna sala inalcanzable.
