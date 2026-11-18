// Estanqueidad de los mapas: con todas las puertas CERRADAS, ningún rayo de visión ni de bala a 1,5 m de altura debe
// cruzar entre dos salas que el suelo transitable mantiene separadas (DEFINICION §14 y 21.5: nadie ve ni dispara a través
// de un muro). Protege contra rendijas en esquinas muro-muro, muro-puerta (jambas) y muro-fachada, p. ej. tras escalar
// o generar un mapa.
//
// QUÉ MODOS DE FALLO NO CUBRE ESTE FICHERO:
//  - Sólo mira rayos horizontales a 1,5 m (altura de ojos/pecho). Una rendija que sólo exista a otra altura (p. ej. bajo
//    un muro de altura parcial) no se vería; los muros del juego son de altura infinita para los rayos.
//  - Las regiones salen de la rejilla de navegación (celdas de 0,25 m con el cuerpo inflado): una grieta más estrecha
//    que el cuerpo no cuenta como paso, así que dos salas unidas SOLO por una rendija de visión se consideran regiones
//    distintas (que es lo que se quiere), pero dos puntos de la misma región nunca se comparan (en una sala abierta
//    puede haber visión legítima).
//  - Se muestrean ~300 parejas por mapa (aleatorias con semilla fija + puntos pegados a esquinas y jambas): no es
//    exhaustivo; una rendija de milímetros en una esquina que ninguna pareja atraviese no se detecta.
//  - No prueba puertas abiertas, boquetes de Demolición ni muebles.

import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/sim/world';
import type { Level } from '../src/sim/level';
import { quickWorld } from './helpers';

/** Etiqueta las regiones conexas de celdas transitables con las puertas cerradas. */
function regiones(L: Level): Int32Array {
  const n = L.gw * L.gh, lab = new Int32Array(n).fill(-1);
  let next = 0;
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (lab[s] >= 0 || !L.passable(s, false)) continue;
    lab[s] = next; stack.push(s);
    while (stack.length) {
      const c = stack.pop()!, x = c % L.gw, y = (c - x) / L.gw;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= L.gw || ny >= L.gh) continue;
        const i = ny * L.gw + nx;
        if (lab[i] < 0 && L.passable(i, false)) { lab[i] = next; stack.push(i); }
      }
    }
    next++;
  }
  return lab;
}

interface Pt { x: number; y: number; r: number }

const MAPAS: [number, number, string][] = [
  [1, 1, 'planta 1 pequeño (real)'], [1, 3, 'planta 1 mediano (real)'], [1, 5, 'planta 1 grande (real)'],
  [2, 1, 'planta 2 pequeño (generado)'], [3, 3, 'planta 3 mediano (generado)'], [5, 5, 'planta 5 grande (generado)'], [8, 4, 'planta 8 mediano (generado)'],
];

describe('estanqueidad: con las puertas cerradas, nada cruza entre salas distintas', () => {
  for (const [floor, zone, nombre] of MAPAS) {
    it(`21.5 · ${nombre}: ~300 parejas entre regiones separadas, ningún rayo 'sight' ni 'bullet' a 1,5 m llega limpio`, () => {
      const { world } = quickWorld(floor, zone);
      const L = world.level;
      for (const d of L.doors) expect(d.open, 'todas las puertas empiezan cerradas').toBe(false);
      const lab = regiones(L);
      const regionDe = (x: number, y: number) => { const c = L.cellOf(x, y); return c >= 0 ? lab[c] : -1; };

      // candidatos: puntos pegados a esquinas de muros y a jambas de puerta (0,45-0,7 m, a los lados) + suelo aleatorio
      const cand: Pt[] = [];
      const add = (x: number, y: number) => { const r = regionDe(x, y); if (r >= 0 && L.walkableAt(x, y, false)) cand.push({ x, y, r }); };
      const rects = [...L.walls.map(w => ({ ...w })), ...L.doors.map(d => ({ x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1 }))];
      for (const r of rects) {
        for (const off of [0.45, 0.7]) {
          for (const [cx, cy] of [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]]) {
            for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(cx + sx * off, cy + sy * off);
          }
          const mx = (r.x0 + r.x1) / 2, my = (r.y0 + r.y1) / 2;
          add(mx, r.y0 - off); add(mx, r.y1 + off); add(r.x0 - off, my); add(r.x1 + off, my);
          // a lo largo de la cara, cada ~1,2 m (por si la rendija está en mitad de un tramo)
          for (let t = r.x0; t <= r.x1; t += 1.2) { add(t, r.y0 - off); add(t, r.y1 + off); }
          for (let t = r.y0; t <= r.y1; t += 1.2) { add(r.x0 - off, t); add(r.x1 + off, t); }
        }
      }
      const rnd = mulberry32(1234 + floor * 10 + zone);
      for (let i = 0; i < 400; i++) add(L.ox + rnd() * L.gw * 0.25, L.oy + rnd() * L.gh * 0.25);
      expect(new Set(cand.map(c => c.r)).size, 'el mapa tiene al menos dos regiones separadas por puertas').toBeGreaterThanOrEqual(2);

      // parejas de regiones distintas, preferentemente cercanas (ahí está el riesgo: un muro fino entre dos puntos próximos)
      const pares: [Pt, Pt][] = [];
      let intentos = 0;
      while (pares.length < 300 && intentos++ < 200000) {
        const a = cand[Math.floor(rnd() * cand.length)], b = cand[Math.floor(rnd() * cand.length)];
        if (a.r === b.r) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 12 || d < 0.3) continue;
        pares.push([a, b]);
      }
      expect(pares.length, 'parejas muestreadas').toBeGreaterThanOrEqual(150);

      const fugas: string[] = [];
      for (const [a, b] of pares) {
        for (const modo of ['sight', 'bullet'] as const) {
          if (L.clear(a.x, a.y, 1.5, b.x, b.y, 1.5, modo)) {
            const minx = Math.min(a.x, b.x) - 0.3, maxx = Math.max(a.x, b.x) + 0.3, miny = Math.min(a.y, b.y) - 0.3, maxy = Math.max(a.y, b.y) + 0.3;
            const cerca = [
              ...L.walls.filter(w => w.x1 >= minx && w.x0 <= maxx && w.y1 >= miny && w.y0 <= maxy).map(w => `muro${w.perimeter ? '(fachada)' : ''}[${w.x0.toFixed(2)},${w.y0.toFixed(2)}→${w.x1.toFixed(2)},${w.y1.toFixed(2)}]`),
              ...L.doors.filter(d => d.x1 >= minx && d.x0 <= maxx && d.y1 >= miny && d.y0 <= maxy).map(d => `puerta${d.id}[${d.x0.toFixed(2)},${d.y0.toFixed(2)}→${d.x1.toFixed(2)},${d.y1.toFixed(2)}]`),
            ].join(' ');
            fugas.push(`${modo}: (${a.x.toFixed(2)},${a.y.toFixed(2)}) región ${a.r} ↔ (${b.x.toFixed(2)},${b.y.toFixed(2)}) región ${b.r}; cerca: ${cerca || 'nada'}`);
          }
        }
      }
      expect(fugas.slice(0, 8), `${fugas.length} rayos atraviesan entre regiones distintas (de ${pares.length} parejas × 2 modos)`).toEqual([]);
    }, 60_000);
  }
});
