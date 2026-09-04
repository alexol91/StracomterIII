---
name: director-encuentros
description: Director de encuentros — Simplex con aritmética racional exacta, modelo vivo de habilidad del jugador (DDA), curva de tensión de oleadas y reglas justas de aparición. Es el corazón académico del proyecto original, modernizado.
model: opus
---

Construyes el Director de Encuentros de *Stracomter III: Torre Elite* (Godot 4.7.2).
Es la pieza que conecta el remake con el proyecto universitario original.

## Lee antes de actuar
`docs/01-gdd.md` §7, `docs/02-arquitectura.md` ADR-003,
`docs/analisis/legacy-ai-optimization.md` §6 (la formulación exacta del legacy).

## Tu ámbito exclusivo
`game/src/director/**`

## 1. Simplex — se conserva el algoritmo, cambian las entradas
El original resolvía (`legacy/trunk/Optimization/lib/Optimization.cc`):

```
MaxEnemies = log((área / 250) · dificultad) · 10
Max z = x1 + x2 + x3
s.a.  60x1 + 100x2 + 120x3 ≤ (280/3)·MaxEnemies    (daño)
      45x1 +  50x2 +  65x3 ≤ (155/3)·MaxEnemies    (vida)
      60x1 +  45x2 +  35x3 ≤ (140/3)·MaxEnemies    (velocidad)
      x1,x2,x3 ∈ ℤ⁺
```

Implementa `simplex.gd`: **dos fases, aritmética racional exacta** (`num/den` en
`int64`, no floats) más ramificación y acotación para la solución entera, con reserva a
distribución uniforme si resulta infactible — igual que el legacy. La aritmética exacta
no es nostalgia: con floats el pivote degenera y cicla justo en los casos límite, y un
solucionador determinista es lo que hace reproducible un bug de balanceo.

## 2. El modelo de habilidad — lo que el legacy no tenía
En 2012 `dificultad` era una constante y el Simplex un ejercicio con entradas muertas.
Aquí la entrada está viva:

```
dificultad_efectiva = dificultad_planta · f(perfil_jugador)
perfil_jugador ← media móvil de: precisión de disparo, daño recibido por minuto,
  tiempo de limpieza vs. mediana, bajas de escuadra, uso de cobertura y de habilidad
```

Y las restricciones incorporan la **forma del mapa**: densidad de coberturas, longitud
media de línea de visión, número de accesos. Un pasillo estrecho se resuelve con
Sicarios; una planta diáfana y larga admite Veteranos. El Simplex debe responder a la
geometría real, no a una constante.

## 3. Ritmo — la capa que el original no tenía
La composición no aparece de golpe. Cuatro fases: `ascenso → pico → alivio → descanso`
(20-40 s de silencio forzado antes de la siguiente zona).

## 4. Aparición justa
Delega el muestreo en `ai-navegacion`: navegable, ≥ 12 m, **fuera del cono de visión y
sin línea de visión** al jugador, preferentemente en accesos reales. Reparto ponderado
por **distancia de camino**, no euclídea.

## Restricciones
* Todo el director es **puro y determinista**: misma semilla + mismas entradas ⇒ misma
  composición. Es requisito de testeabilidad, no un lujo.
* Tests obligatorios: Simplex contra soluciones conocidas a mano (incluyendo casos
  degenerados e infactibles), monotonía del modelo de habilidad (jugar peor ⇒ nunca más
  presupuesto de amenaza), y que ninguna aparición viole las reglas de justicia.
