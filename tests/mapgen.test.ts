// Pruebas del generador de mapas (plantas 2-9). Se ejecutan con: npx vitest run tests/mapgen.test.ts
//
// QUÉ NO COMPRUEBA LA REJILLA DE ESTAS PRUEBAS (límites conocidos):
//  - Rasteriza a 0,2 m e infla los obstáculos 0,4 m. Un hueco más fino que una celda (p. ej. una ranura de
//    0,15 m entre un mueble y un muro, o un mueble que roza un muro por 1 cm) no se ve en la rejilla: lo
//    cubren las comprobaciones geométricas exactas de solapes, pero no la transitabilidad.
//  - Una abertura de exactamente 1,0 m puede quedar con una sola celda libre (o ninguna) según cómo caiga la
//    rejilla; el generador deja ≥ 1,15 m entre muebles para no depender de ese redondeo, y aquí se comprueba
//    la transitabilidad con la misma rejilla, así que no detectaría un paso de 0,85-0,95 m «cerrado».
//  - Se supone que el personaje es un círculo de 0,4 m. No se simulan agacharse, saltar ni la IA de
//    enemigos: «alcanzable» es alcanzable por un círculo, no que las rutas de los enemigos sean buenas.
//  - La regla de las dos rutas se comprueba tapiando UNA abertura cada vez (no dos a la vez) y exige que no
//    queden más de 2 m² de suelo transitable aislado. No mide si las dos rutas son «largas» o «parecidas».
//  - Los vanos se leen de generateMapInfo(); el JSON de un mapa no los distingue de un hueco cualquiera.
//  - Los ángulos libres (sillas, mesas) se prueban con el rectángulo exacto girado en sentido
//    trigonométrico; el generador usa un círculo circunscrito, así que cubre también el giro inverso.
//  - Tamaño mínimo de sala (3,5 m) y pasillo (1,8 m) no se miden aquí: las salas no están en el JSON. Las
//    comprueba el generador internamente al construir el plano.
//  - No se mira que el mapa «se lea» distinto por planta (eso es de las capturas de tools/dump-maps.ts).

import { describe, expect, it, vi } from 'vitest';
import { generateMap, generateMapInfo } from '../src/sim/mapgen';
import { FURNITURE } from '../src/sim/data';
import type { MapDef, Vec2 } from '../src/sim/types';

vi.setConfig({ testTimeout: 120000 });

type Size = 'pequeno' | 'mediano' | 'grande';
type Pt = [number, number];

// ----------------------------------------------------------------------------------------------
// Casos
// ----------------------------------------------------------------------------------------------

const CASOS: [number, Size][] = [];
for (let f = 2; f <= 8; f++) for (const s of ['pequeno', 'mediano', 'grande'] as const) CASOS.push([f, s]);
CASOS.push([9, 'grande']);

// V2: mapas más grandes y espaciosos (decisión del dueño; se aparta de la tabla del documento).
const TABLA: Record<Size, { area: [number, number]; muros: [number, number]; puertas: [number, number]; mob: [number, number]; obj: [number, number] }> = {
  pequeno: { area: [450, 800], muros: [6, 12], puertas: [3, 5], mob: [25, 45], obj: [4, 7] },
  mediano: { area: [1000, 1700], muros: [12, 22], puertas: [6, 10], mob: [55, 80], obj: [8, 12] },
  grande: { area: [1900, 3000], muros: [16, 30], puertas: [8, 14], mob: [70, 110], obj: [10, 14] },
};
const PUERTA_W = 1.6;
const CALLE = 1.8;

function rango(f: number, s: Size) {
  if (f === 8 && s === 'grande') return { area: [1850, 2150], muros: [30, 45], puertas: [16, 24], mob: [0, 0], obj: [16, 16] } as typeof TABLA.grande;
  if (f === 9) return { area: [900, 2700], muros: [5, 7], puertas: [0, 0], mob: [28, 40], obj: [10, 12] } as typeof TABLA.grande;
  return TABLA[s];
}

const memo = new Map<string, ReturnType<typeof generateMapInfo>>();
function info(f: number, s: Size) {
  const k = f + s;
  if (!memo.has(k)) memo.set(k, generateMapInfo(f, s));
  return memo.get(k)!;
}

// ----------------------------------------------------------------------------------------------
// Geometría (escrita aquí a propósito, sin depender del generador)
// ----------------------------------------------------------------------------------------------

function mueblePoly(f: MapDef['mobiliario'][number]): Pt[] {
  const { w, d } = FURNITURE[f.tipo];
  const a = (f.angulo * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as Pt[]).map(([x, y]) => [f.pos[0] + x * c - y * s, f.pos[1] + x * s + y * c] as Pt);
}
function dPtSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function dentro(p: Pt, P: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if ((P[i][1] > p[1]) !== (P[j][1] > p[1]) && p[0] < ((P[j][0] - P[i][0]) * (p[1] - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
  }
  return c;
}
function cruzan(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
/** Distancia entre dos polígonos convexos/simples; 0 si se tocan o solapan. */
function dPoly(A: Pt[], B: Pt[]): number {
  if (A.some((p) => dentro(p, B)) || B.some((p) => dentro(p, A))) return 0;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
    if (cruzan(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return 0;
  }
  let m = Infinity;
  for (const p of A) for (let j = 0; j < B.length; j++) m = Math.min(m, dPtSeg(p, B[j], B[(j + 1) % B.length]));
  for (const p of B) for (let j = 0; j < A.length; j++) m = Math.min(m, dPtSeg(p, A[j], A[(j + 1) % A.length]));
  return m;
}
function dPtPoly(p: Pt, P: Pt[]): number {
  if (dentro(p, P)) return 0;
  let m = Infinity;
  for (let i = 0; i < P.length; i++) m = Math.min(m, dPtSeg(p, P[i], P[(i + 1) % P.length]));
  return m;
}
function dPtPerim(p: Pt, per: Pt[]): number {
  let m = Infinity;
  for (let i = 0; i < per.length; i++) m = Math.min(m, dPtSeg(p, per[i], per[(i + 1) % per.length]));
  return m;
}
function areaPoly(P: Pt[]): number {
  let s = 0;
  for (let i = 0; i < P.length; i++) s += P[i][0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * P[i][1];
  return Math.abs(s) / 2;
}
function bbox(P: Pt[]) {
  return { x0: Math.min(...P.map((p) => p[0])), x1: Math.max(...P.map((p) => p[0])), y0: Math.min(...P.map((p) => p[1])), y1: Math.max(...P.map((p) => p[1])) };
}
const centro = (P: Pt[]): Pt => { const b = bbox(P); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; };

// ----------------------------------------------------------------------------------------------
// Rejilla de transitabilidad: celdas de 0,2 m, círculo de 0,4 m, relleno por inundación
// ----------------------------------------------------------------------------------------------

const CELDA = 0.2, RADIO = 0.4;
interface Rejilla { nx: number; ny: number; libre: Uint8Array }

const baseCache = new WeakMap<MapDef, Rejilla>();
/** Rejilla base (puertas abiertas) de un mapa, y copia con `bloqueos` (p. ej. una abertura tapiada) si se piden. */
function rejilla(m: MapDef, bloqueos: Pt[][]): Rejilla {
  let base = baseCache.get(m);
  if (!base) {
    const per = m.perimetro as Pt[];
    const nx = Math.ceil(m.ancho_m / CELDA) + 1, ny = Math.ceil(m.alto_m / CELDA) + 1;
    const libre = new Uint8Array(nx * ny);
    const obst: { P: Pt[]; bb: ReturnType<typeof bbox> }[] = [];
    for (const w of m.muros) obst.push({ P: w as Pt[], bb: bbox(w as Pt[]) });
    for (const f of m.mobiliario) { const P = mueblePoly(f); obst.push({ P, bb: bbox(P) }); }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const p: Pt = [(i + 0.5) * CELDA, (j + 0.5) * CELDA];
        if (!dentro(p, per) || dPtPerim(p, per) <= RADIO) continue;
        let ok = true;
        for (const o of obst) {
          if (p[0] < o.bb.x0 - RADIO || p[0] > o.bb.x1 + RADIO || p[1] < o.bb.y0 - RADIO || p[1] > o.bb.y1 + RADIO) continue;
          if (dPtPoly(p, o.P) <= RADIO) { ok = false; break; }
        }
        if (ok) libre[j * nx + i] = 1;
      }
    }
    base = { nx, ny, libre };
    baseCache.set(m, base);
  }
  if (!bloqueos.length) return base;
  const libre = base.libre.slice();
  for (const b of bloqueos) {
    const bb = bbox(b);
    for (let j = Math.max(0, Math.floor((bb.y0 - RADIO) / CELDA)); j <= Math.min(base.ny - 1, Math.ceil((bb.y1 + RADIO) / CELDA)); j++) {
      for (let i = Math.max(0, Math.floor((bb.x0 - RADIO) / CELDA)); i <= Math.min(base.nx - 1, Math.ceil((bb.x1 + RADIO) / CELDA)); i++) {
        if (libre[j * base.nx + i] && dPtPoly([(i + 0.5) * CELDA, (j + 0.5) * CELDA], b) <= RADIO) libre[j * base.nx + i] = 0;
      }
    }
  }
  return { nx: base.nx, ny: base.ny, libre };
}
function celdaCercana(g: Rejilla, p: Pt): number {
  const ci = Math.floor(p[0] / CELDA), cj = Math.floor(p[1] / CELDA);
  let best = -1, bd = Infinity;
  for (let dj = -6; dj <= 6; dj++) for (let di = -6; di <= 6; di++) {
    const i = ci + di, j = cj + dj;
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny || !g.libre[j * g.nx + i]) continue;
    const d = Math.hypot(di, dj);
    if (d < bd) { bd = d; best = j * g.nx + i; }
  }
  return best;
}
function inundar(g: Rejilla, ini: number): Uint8Array {
  const vis = new Uint8Array(g.libre.length);
  if (ini < 0) return vis;
  const pila = [ini]; vis[ini] = 1;
  while (pila.length) {
    const k = pila.pop()!;
    const i = k % g.nx, j = (k - i) / g.nx;
    const vec: [number, number][] = [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]];
    for (const [a, b] of vec) {
      if (a < 0 || b < 0 || a >= g.nx || b >= g.ny) continue;
      const n = b * g.nx + a;
      if (g.libre[n] && !vis[n]) { vis[n] = 1; pila.push(n); }
    }
  }
  return vis;
}
function m2Aislados(g: Rejilla, vis: Uint8Array): number {
  let n = 0;
  for (let k = 0; k < vis.length; k++) if (g.libre[k] && !vis[k]) n++;
  return n * CELDA * CELDA;
}

// ----------------------------------------------------------------------------------------------
// Pruebas
// ----------------------------------------------------------------------------------------------

describe('generateMap: determinismo', () => {
  it.each(CASOS)('planta %i %s: dos llamadas dan el mismo JSON y la primera tarda < 1,5 s', (f, s) => {
    const t0 = performance.now();
    const a = JSON.stringify(generateMap(f, s));
    const ms = performance.now() - t0;
    expect(a).toBe(JSON.stringify(generateMap(f, s)));
    expect(ms, `${f}/${s} tardó ${ms.toFixed(0)} ms`).toBeLessThan(1500);
  });
  it('la planta 9 no falla con ningún tamaño', () => {
    for (const s of ['pequeno', 'mediano', 'grande'] as const) {
      const m = generateMap(9, s);
      expect(m.tema).toBe('azotea');
      expect(m.diafano).toBe(true);
    }
  });
  it('llamar a otro mapa en medio no cambia el resultado (sin estado oculto)', () => {
    const a = JSON.stringify(generateMap(4, 'mediano'));
    generateMap(7, 'grande');
    expect(JSON.stringify(generateMap(4, 'mediano'))).toBe(a);
  });
});

describe.each(CASOS)('planta %i %s', (f, s) => {
  const I = () => info(f, s);
  const M = () => I().map;
  const R = rango(f, s);

  it('campos y formato', () => {
    const m = M();
    expect(m.nombre).toBe(`P${f}-${s}`);
    expect(m.tamano).toBe(s);
    expect(m.tema).toBe(['', '', 'soporte', 'desarrollo', 'calidad', 'datos', 'comercial', 'direccion', 'juntas', 'azotea'][f]);
    expect(m.diafano).toBe(f === 6 || f === 9);
    const per = m.perimetro as Pt[];
    const b = bbox(per);
    expect(b.x0).toBeCloseTo(0, 1);
    expect(b.y0).toBeCloseTo(0, 1);
    expect(m.ancho_m).toBeCloseTo(b.x1, 2);
    expect(m.alto_m).toBeCloseTo(b.y1, 2);
    // lados alineados con los ejes
    for (let i = 0; i < per.length; i++) {
      const a = per[i], c = per[(i + 1) % per.length];
      expect(Math.min(Math.abs(a[0] - c[0]), Math.abs(a[1] - c[1]))).toBeLessThan(1e-6);
    }
    // muros: rectángulos alineados, grosor 0,33 (salvo los bloques macizos de los casetones de la azotea)
    for (const w of m.muros) {
      expect(w.length).toBe(4);
      const bb = bbox(w as Pt[]);
      const lado = Math.min(bb.x1 - bb.x0, bb.y1 - bb.y0);
      if (f === 9) expect(lado).toBeGreaterThanOrEqual(0.33 - 0.011);
      else expect(lado).toBeCloseTo(0.33, 1);
    }
    for (const p of m.puertas) {
      const bb = bbox(p as Pt[]);
      const dims = [bb.x1 - bb.x0, bb.y1 - bb.y0].sort((x, y) => x - y);
      expect(dims[0]).toBeCloseTo(0.33, 1);
      expect(dims[1]).toBeCloseTo(PUERTA_W, 1);
    }
    for (const v of I().vanos) {
      const bb = bbox(v as Pt[]);
      expect(Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0)).toBeGreaterThanOrEqual(2.4);
    }
  });

  it('cumple los rangos de la tabla', () => {
    const m = M();
    const area = areaPoly(m.perimetro as Pt[]);
    expect(area).toBeGreaterThanOrEqual(R.area[0]);
    expect(area).toBeLessThanOrEqual(R.area[1]);
    expect(m.muros.length).toBeGreaterThanOrEqual(R.muros[0]);
    expect(m.muros.length).toBeLessThanOrEqual(R.muros[1]);
    expect(m.puertas.length).toBeGreaterThanOrEqual(R.puertas[0]);
    expect(m.puertas.length).toBeLessThanOrEqual(R.puertas[1]);
    expect(m.mobiliario.length).toBeGreaterThanOrEqual(R.mob[0]);
    expect(m.mobiliario.length).toBeLessThanOrEqual(R.mob[1]);
    expect(m.objetos.length).toBeGreaterThanOrEqual(R.obj[0]);
    expect(m.objetos.length).toBeLessThanOrEqual(R.obj[1]);
  });

  it('la superficie crece con la planta dentro de cada rango (no se comprueba aquí entre plantas)', () => {
    // Se comprueba en el bloque «crecimiento» de abajo; esta entrada solo evita áreas absurdas.
    expect(areaPoly(M().perimetro as Pt[])).toBeGreaterThan(100);
  });

  it('todo está dentro del perímetro', () => {
    const m = M();
    const per = m.perimetro as Pt[];
    for (const f2 of m.mobiliario) for (const p of mueblePoly(f2)) {
      expect(dentro(p, per), `${f2.tipo} en ${f2.pos}`).toBe(true);
    }
    for (const o of m.objetos) expect(dentro(o.pos as Pt, per)).toBe(true);
    expect(dentro(m.inicio_jugador as Pt, per)).toBe(true);
    expect(dentro(m.punto_jefe as Pt, per)).toBe(true);
  });

  it('los muebles no se solapan entre sí ni con muros, puertas o fachada', () => {
    const m = M();
    const per = m.perimetro as Pt[];
    const P = m.mobiliario.map(mueblePoly);
    for (let i = 0; i < P.length; i++) {
      for (let j = i + 1; j < P.length; j++) {
        expect(dPoly(P[i], P[j]), `${m.mobiliario[i].tipo} ${m.mobiliario[i].pos} / ${m.mobiliario[j].tipo} ${m.mobiliario[j].pos}`).toBeGreaterThan(0.005);
      }
      for (const w of [...m.muros, ...m.puertas]) {
        expect(dPoly(P[i], w as Pt[]), `${m.mobiliario[i].tipo} ${m.mobiliario[i].pos} contra pared`).toBeGreaterThan(0.005);
      }
      for (let e = 0; e < per.length; e++) {
        for (const q of P[i]) expect(dPtSeg(q, per[e], per[(e + 1) % per.length])).toBeGreaterThan(0.005);
      }
    }
  });

  it('holguras: ≥1,2 m en puertas y vanos, ≥4 m del inicio, ≥2 m del jefe', () => {
    const m = M();
    const P = m.mobiliario.map(mueblePoly);
    const aberturas = [...m.puertas, ...I().vanos].map((a) => centro(a as Pt[]));
    P.forEach((p, i) => {
      for (const c of aberturas) expect(dPtPoly(c, p), `${m.mobiliario[i].tipo} ${m.mobiliario[i].pos} tapa una abertura`).toBeGreaterThanOrEqual(1.2);
      expect(dPtPoly(m.inicio_jugador as Pt, p), `inicio / ${m.mobiliario[i].tipo} ${m.mobiliario[i].pos}`).toBeGreaterThanOrEqual(4);
      expect(dPtPoly(m.punto_jefe as Pt, p), `jefe / ${m.mobiliario[i].tipo} ${m.mobiliario[i].pos}`).toBeGreaterThanOrEqual(f === 9 ? 6 : 2);
    });
  });

  it('desde el inicio hay ≥8 m despejados (con holgura de personaje) en alguna dirección', () => {
    const m = M();
    const per = m.perimetro as Pt[];
    const obst: Pt[][] = [...m.muros as Pt[][], ...m.mobiliario.map(mueblePoly)];
    let algunaOk = false;
    for (let k = 0; k < 24 && !algunaOk; k++) {
      const a = (k / 24) * Math.PI * 2;
      let ok = true;
      for (let d = 0.25; d <= 8 && ok; d += 0.25) {
        const p: Pt = [m.inicio_jugador[0] + Math.cos(a) * d, m.inicio_jugador[1] + Math.sin(a) * d];
        ok = dentro(p, per) && dPtPerim(p, per) >= RADIO && obst.every((P) => dPtPoly(p, P) >= RADIO);
      }
      algunaOk = ok;
    }
    expect(algunaOk).toBe(true);
  });

  it('entre conjuntos de muebles hay calles de ≥1,8 m (≥1,0 si es una maceta; las sillas solo no pueden solaparse)', () => {
    const m = M();
    const P = m.mobiliario.map(mueblePoly);
    for (let i = 0; i < P.length; i++) {
      for (let j = i + 1; j < P.length; j++) {
        if (m.mobiliario[i].tipo === 'silla' || m.mobiliario[j].tipo === 'silla') continue;
        const d = dPoly(P[i], P[j]);
        if (d <= 0.1) continue; // adosados
        // piezas de una misma fila adosada (A-B-C): A y C quedan a menos de 1,8 m pero B las une
        const min = m.mobiliario[i].tipo === 'maceta' || m.mobiliario[j].tipo === 'maceta' ? 1.0 : CALLE;
        if (d >= min) continue;
        const puente = P.some((q, k) => k !== i && k !== j && m.mobiliario[k].tipo !== 'silla' && dPoly(q, P[i]) <= 0.1 && dPoly(q, P[j]) <= 0.1);
        if (puente) continue;
        expect(d, `${m.mobiliario[i].tipo} ${m.mobiliario[i].pos} / ${m.mobiliario[j].tipo} ${m.mobiliario[j].pos}`).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it('las puertas están exactamente en un hueco de muro (o entre muro y fachada)', () => {
    const m = M();
    const per = m.perimetro as Pt[];
    for (const p of m.puertas) {
      const bb = bbox(p as Pt[]);
      const horiz = bb.x1 - bb.x0 > bb.y1 - bb.y0; // puerta de muro horizontal: se cruza andando en y
      const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
      const finales: Pt[] = horiz ? [[bb.x0 - 0.04, cy], [bb.x1 + 0.04, cy]] : [[cx, bb.y0 - 0.04], [cx, bb.y1 + 0.04]];
      for (const q of finales) {
        const tocaMuro = m.muros.some((w) => dentro(q, w as Pt[]));
        const tocaFachada = dPtPerim(q, per) < 0.2 || !dentro(q, per);
        expect(tocaMuro || tocaFachada, `puerta ${[bb.x0, bb.y0]} sin tramo de muro en un extremo`).toBe(true);
      }
      // y la propia puerta no se solapa con ningún muro
      for (const w of m.muros) {
        const wb = bbox(w as Pt[]);
        const ox = Math.min(bb.x1, wb.x1) - Math.max(bb.x0, wb.x0), oy = Math.min(bb.y1, wb.y1) - Math.max(bb.y0, wb.y0);
        expect(ox > 0.02 && oy > 0.02, 'puerta solapada con un muro').toBe(false);
      }
    }
  });

  it('inicio junto a un borde, jefe lejos, objetos bien puestos', () => {
    const m = M();
    const per = m.perimetro as Pt[];
    expect(dPtPerim(m.inicio_jugador as Pt, per)).toBeLessThanOrEqual(3.2);
    const b = bbox(per);
    const diag = Math.hypot(b.x1, b.y1);
    const d = Math.hypot(m.inicio_jugador[0] - m.punto_jefe[0], m.inicio_jugador[1] - m.punto_jefe[1]);
    // en la azotea (30 m) el jefe está en el centro y el inicio en una esquina: el máximo posible es el 50 %
    // de la diagonal, así que ahí se exige 44 % (no se puede llegar al 55 %)
    expect(d / diag).toBeGreaterThanOrEqual(f === 9 ? 0.44 : 0.55);
    // objetos a ≥0,6 m de cualquier obstáculo, y repartidos
    const obst: Pt[][] = [...m.muros as Pt[][], ...m.mobiliario.map(mueblePoly)];
    for (const o of m.objetos) {
      for (const P of obst) expect(dPtPoly(o.pos as Pt, P)).toBeGreaterThanOrEqual(0.6);
      expect(dPtPerim(o.pos as Pt, per)).toBeGreaterThanOrEqual(0.6);
    }
    if (m.objetos.length > 1) {
      let min = Infinity;
      for (let i = 0; i < m.objetos.length; i++) for (let j = i + 1; j < m.objetos.length; j++) {
        min = Math.min(min, Math.hypot(m.objetos[i].pos[0] - m.objetos[j].pos[0], m.objetos[i].pos[1] - m.objetos[j].pos[1]));
      }
      expect(min).toBeGreaterThanOrEqual(3.5);
    }
    // seis tipos a partes (casi) iguales
    const cuenta: Record<string, number> = {};
    for (const o of m.objetos) cuenta[o.tipo] = (cuenta[o.tipo] ?? 0) + 1;
    const vals = ['vida_20', 'vida_50', 'vida_100', 'municion_20', 'municion_50', 'municion_100'].map((t) => cuenta[t] ?? 0);
    expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(m.objetos.length >= 6 ? 1 : 1);
  });

  it('conectividad con las puertas abiertas: inicio → jefe, objetos y todo el suelo transitable', () => {
    const m = M();
    const g = rejilla(m, []);
    const ini = celdaCercana(g, m.inicio_jugador as Pt);
    expect(ini).toBeGreaterThanOrEqual(0);
    const vis = inundar(g, ini);
    const jefe = celdaCercana(g, m.punto_jefe as Pt);
    expect(jefe >= 0 && vis[jefe] === 1, 'jefe inalcanzable').toBe(true);
    for (const o of m.objetos) {
      const c = celdaCercana(g, o.pos as Pt);
      expect(c >= 0 && vis[c] === 1, `objeto ${o.pos} inalcanzable`).toBe(true);
    }
    expect(m2Aislados(g, vis)).toBeLessThanOrEqual(0.2);
  });

  it('dos rutas: tapiando cada abertura (puerta o vano) todo sigue conectado', () => {
    const m = M();
    const aberturas = [...m.puertas, ...I().vanos] as Pt[][];
    expect(aberturas.length).toBeGreaterThanOrEqual(f === 9 || f === 6 ? 0 : 2);
    aberturas.forEach((a, idx) => {
      const g = rejilla(m, [a]);
      const vis = inundar(g, celdaCercana(g, m.inicio_jugador as Pt));
      const jefe = celdaCercana(g, m.punto_jefe as Pt);
      expect(jefe >= 0 && vis[jefe] === 1, `tapiando la abertura ${idx} (${centro(a).map((v) => v.toFixed(1))}) el jefe queda aislado`).toBe(true);
      const aislado = m2Aislados(g, vis);
      expect(aislado, `tapiando la abertura ${idx} (${centro(a).map((v) => v.toFixed(1))}) quedan ${aislado.toFixed(1)} m2 aislados`).toBeLessThanOrEqual(2);
    });
  });
});

describe('rasgos propios de cada planta', () => {
  it('cada planta se lee distinta: composición de mobiliario', () => {
    const frac = (f: number, t: string) => {
      const m = info(f, 'mediano').map;
      return m.mobiliario.filter((x) => x.tipo === t).length / m.mobiliario.length;
    };
    expect(frac(5, 'estanteria')).toBeGreaterThan(0.6); // racks: casi solo estanterías
    expect(frac(8, 'mesa_con_sillas')).toBeGreaterThan(0.45); // sala de juntas
    expect(frac(2, 'escritorio')).toBeGreaterThan(0.1); // cubículos
    expect(frac(3, 'mesa')).toBeGreaterThan(0.15); // mesas dobles
  });

  it('planta 8 grande: «Final», sin muebles y con 16 objetos', () => {
    const m = info(8, 'grande').map;
    expect(m.mobiliario.length).toBe(0);
    expect(m.objetos.length).toBe(16);
    expect(m.muros.length).toBeGreaterThanOrEqual(30);
    expect(m.puertas.length).toBeGreaterThanOrEqual(16);
  });

  it('planta 6 diáfana: pocos tabiques, ninguno cierra una sala (el suelo sigue en un solo trozo sin puertas)', () => {
    for (const s of ['pequeno', 'mediano', 'grande'] as const) {
      const m = info(6, s).map;
      expect(m.diafano).toBe(true);
      // con las puertas de los tabiques tapiadas todo sigue conectado: nada de recintos
      const g = rejilla(m, m.puertas as Pt[][]);
      const vis = inundar(g, celdaCercana(g, m.inicio_jugador as Pt));
      expect(m2Aislados(g, vis)).toBeLessThanOrEqual(0.2);
    }
  });

  it('planta 9: ~50×50 m, helipuerto de 6 m despejado, 5-7 muros (casetones) y 28-40 estanterías en islas de 2-4', () => {
    const m = info(9, 'grande').map;
    expect(m.punto_jefe[0]).toBeCloseTo(m.ancho_m / 2, 1);
    expect(m.punto_jefe[1]).toBeCloseTo(m.alto_m / 2, 1);
    expect(m.ancho_m).toBeGreaterThanOrEqual(48);
    expect(m.puertas.length).toBe(0);
    expect(m.muros.length).toBeGreaterThanOrEqual(5);
    expect(m.muros.length).toBeLessThanOrEqual(7);
    // casetones de 4×4 a 6×6 (o tramos en L)
    const bloques = m.muros.map((w) => bbox(w as Pt[])).filter((b) => Math.min(b.x1 - b.x0, b.y1 - b.y0) > 1);
    expect(bloques.length).toBeGreaterThanOrEqual(4);
    for (const b of bloques) { expect(b.x1 - b.x0).toBeGreaterThanOrEqual(3.9); expect(b.x1 - b.x0).toBeLessThanOrEqual(6.1); }
    for (const f of m.mobiliario) {
      expect(f.tipo).toBe('estanteria');
      expect(dPtPoly(m.punto_jefe as Pt, mueblePoly(f))).toBeGreaterThanOrEqual(6);
    }
    for (const w of m.muros) expect(dPtPoly(m.punto_jefe as Pt, w as Pt[])).toBeGreaterThanOrEqual(6);
    // islas: componentes conexas (separación ≤ 0.1 m) de 2 a 4 piezas
    const P = m.mobiliario.map(mueblePoly);
    const comp = P.map((_, i) => i);
    const raiz = (i: number): number => (comp[i] === i ? i : (comp[i] = raiz(comp[i])));
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) if (dPoly(P[i], P[j]) <= 0.1) comp[raiz(i)] = raiz(j);
    const tam = new Map<number, number>();
    for (let i = 0; i < P.length; i++) tam.set(raiz(i), (tam.get(raiz(i)) ?? 0) + 1);
    for (const n of tam.values()) { expect(n).toBeGreaterThanOrEqual(2); expect(n).toBeLessThanOrEqual(4); }
  });

  it('la superficie crece con la planta (2 cerca del mínimo, 7 cerca del máximo del rango)', () => {
    for (const s of ['pequeno', 'mediano', 'grande'] as const) {
      const a2 = areaPoly(info(2, s).map.perimetro as Pt[]);
      const a7 = areaPoly(info(7, s).map.perimetro as Pt[]);
      expect(a7).toBeGreaterThan(a2);
      const [lo, hi] = TABLA[s].area;
      expect(a2 - lo).toBeLessThan((hi - lo) * 0.4);
      expect(a7 - lo).toBeGreaterThan((hi - lo) * 0.5);
    }
  });

  it('las variantes de planta pasan por el formato JSON sin pérdida', () => {
    for (const [f, s] of CASOS) {
      const m = info(f, s).map;
      expect(JSON.parse(JSON.stringify(m))).toEqual(m);
    }
  });
});

// Los dos tipos usados arriba solo para que TypeScript no se queje de importaciones sin uso.
export type _Vec = Vec2;
