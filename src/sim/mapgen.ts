// Generador de mapas de las plantas 2 a 9. Código puro y determinista: sin DOM, sin Node, sin Math.random.
//
// Idea general (para quien lo mantenga):
//  1. Cada planta/tamaño tiene un «esqueleto»: un árbol de cortes (BSP) que reparte el rectángulo
//     contenedor en salas. Las hojas marcadas «void» quedan fuera (dan plantas en L/U). Las hojas que
//     comparten identificador de grupo («p@r») forman UNA sala sin tabique interior (pasillos en anillo).
//  2. Los límites entre salas distintas son muros. Se eligen las aberturas (puertas y vanos) con un
//     algoritmo que garantiza un grafo de salas SIN PUENTES (dos rutas entre cualquier par de salas).
//  3. Se escogen inicio y jefe, se amuebla por sala según su papel (cubículos, racks, juntas…) y se
//     reparten los objetos.
//  4. Cada intento se valida con una rejilla de 0,2 m (círculo de radio 0,4): recuentos de la tabla,
//     conectividad, tapiado de cada abertura. Si falla, se prueba otra semilla derivada (sigue siendo
//     determinista) y se devuelve la primera que cumple todo.
//
// Las plantas 6 (comercial) y 9 (azotea) no usan salas: tienen generadores propios.

import type { FurnitureType, ItemType, MapDef, Theme, Vec2 } from './types';
import { FLOOR_THEME, FURNITURE, WALL_THICK } from './data';

type Size = 'pequeno' | 'mediano' | 'grande';
type Rng = () => number;
type P2 = [number, number];

export interface MapInfo {
  map: MapDef;
  /** Vanos abiertos (huecos sin puerta): rectángulos de 4 vértices como las puertas. */
  vanos: Vec2[][];
  /** Avisos de validación interna del último intento aceptado (vacío = todo cumple). */
  avisos: string[];
}

// ---------------------------------------------------------------------------------------------
// Utilidades básicas
// ---------------------------------------------------------------------------------------------

function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const rr = (rng: Rng, a: number, b: number) => a + (b - a) * rng();
function shuffle<T>(rng: Rng, a: T[]): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = r[i]; r[i] = r[j]; r[j] = t;
  }
  return r;
}

const T = WALL_THICK;
const DOOR_W = 1.33;
const SIZES: Size[] = ['pequeno', 'mediano', 'grande'];

interface Rect { x0: number; y0: number; x1: number; y1: number }

// ---------------------------------------------------------------------------------------------
// Geometría de polígonos convexos pequeños (muebles, muros, puertas)
// ---------------------------------------------------------------------------------------------

function rectPoly(cx: number, cy: number, w: number, d: number, angDeg: number): P2[] {
  const a = (angDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const pts: P2[] = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  return pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c] as P2);
}
function circlePoly(cx: number, cy: number, r: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}
function rectToPoly(r: Rect): P2[] {
  return [[r.x0, r.y0], [r.x0, r.y1], [r.x1, r.y1], [r.x1, r.y0]];
}
function bboxOf(p: P2[]): Rect {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}
function bbGap(a: Rect, b: Rect): number {
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
  const dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
  return Math.hypot(dx, dy);
}
function ptSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function pointInPoly(px: number, py: number, P: P2[]): boolean {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if ((P[i][1] > py) !== (P[j][1] > py) &&
      px < ((P[j][0] - P[i][0]) * (py - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
  }
  return c;
}
function ptPolyDist(px: number, py: number, P: P2[]): number {
  if (pointInPoly(px, py, P)) return 0;
  let m = 1e9;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const d = ptSeg(px, py, a[0], a[1], b[0], b[1]);
    if (d < m) m = d;
  }
  return m;
}
function segsCross(a: P2, b: P2, c: P2, d: P2): boolean {
  const o = (p: P2, q: P2, r: P2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}
function polyDist(A: P2[], B: P2[]): number {
  for (const p of A) if (pointInPoly(p[0], p[1], B)) return 0;
  for (const p of B) if (pointInPoly(p[0], p[1], A)) return 0;
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < B.length; j++) {
      if (segsCross(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return 0;
    }
  }
  let m = 1e9;
  for (const p of A) {
    for (let j = 0; j < B.length; j++) {
      const q = B[j], r = B[(j + 1) % B.length];
      const d = ptSeg(p[0], p[1], q[0], q[1], r[0], r[1]);
      if (d < m) m = d;
    }
  }
  for (const p of B) {
    for (let j = 0; j < A.length; j++) {
      const q = A[j], r = A[(j + 1) % A.length];
      const d = ptSeg(p[0], p[1], q[0], q[1], r[0], r[1]);
      if (d < m) m = d;
    }
  }
  return m;
}
function polyArea(P: P2[]): number {
  let s = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

// ---------------------------------------------------------------------------------------------
// Rejilla de transitabilidad (círculo de radio r inflando los obstáculos)
// ---------------------------------------------------------------------------------------------

const RES = 0.2;
interface Grid { nx: number; ny: number; free: Uint8Array }

/** Marca como NO libres las celdas fuera del perímetro o a menos de `infl` de un obstáculo. */
function makeGrid(perim: P2[], polys: P2[][], infl: number): Grid {
  const bb = bboxOf(perim);
  const nx = Math.ceil(bb.x1 / RES) + 2, ny = Math.ceil(bb.y1 / RES) + 2;
  const free = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) free[j * nx + i] = pointInPoly((i + 0.5) * RES, (j + 0.5) * RES, perim) ? 1 : 0;
  }
  const markPoly = (P: P2[], isLine: boolean) => {
    const b = bboxOf(P);
    const i0 = Math.max(0, Math.floor((b.x0 - infl) / RES)), i1 = Math.min(nx - 1, Math.ceil((b.x1 + infl) / RES));
    const j0 = Math.max(0, Math.floor((b.y0 - infl) / RES)), j1 = Math.min(ny - 1, Math.ceil((b.y1 + infl) / RES));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (!free[k]) continue;
        const x = (i + 0.5) * RES, y = (j + 0.5) * RES;
        let d = 1e9;
        if (!isLine && pointInPoly(x, y, P)) d = 0;
        else {
          const n = isLine ? P.length - 1 : P.length;
          for (let e = 0; e < n; e++) {
            const a = P[e], c = P[(e + 1) % P.length];
            const dd = ptSeg(x, y, a[0], a[1], c[0], c[1]);
            if (dd < d) d = dd;
          }
        }
        if (d < infl) free[k] = 0;
      }
    }
  };
  for (let e = 0; e < perim.length; e++) markPoly([perim[e], perim[(e + 1) % perim.length]], true);
  for (const P of polys) markPoly(P, false);
  return { nx, ny, free };
}

function cellOf(g: Grid, x: number, y: number): number {
  const i = Math.max(0, Math.min(g.nx - 1, Math.floor(x / RES)));
  const j = Math.max(0, Math.min(g.ny - 1, Math.floor(y / RES)));
  return j * g.nx + i;
}
function nearestFree(g: Grid, x: number, y: number): number {
  const c0 = cellOf(g, x, y);
  if (g.free[c0]) return c0;
  const ci = c0 % g.nx, cj = Math.floor(c0 / g.nx);
  for (let r = 1; r < 12; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
        if (g.free[j * g.nx + i]) return j * g.nx + i;
      }
    }
  }
  return -1;
}
/** Relleno por inundación (4 vecinos). Devuelve marcas 1 = alcanzada. */
function flood(g: Grid, start: number, free: Uint8Array = g.free): Uint8Array {
  const seen = new Uint8Array(g.nx * g.ny);
  if (start < 0 || !free[start]) return seen;
  const q = new Int32Array(g.nx * g.ny);
  let h = 0, t = 0;
  q[t++] = start; seen[start] = 1;
  while (h < t) {
    const k = q[h++];
    const i = k % g.nx;
    const n4 = [k - 1, k + 1, k - g.nx, k + g.nx];
    for (let n = 0; n < 4; n++) {
      const m = n4[n];
      if (m < 0 || m >= seen.length) continue;
      if (n === 0 && i === 0) continue;
      if (n === 1 && i === g.nx - 1) continue;
      if (free[m] && !seen[m]) { seen[m] = 1; q[t++] = m; }
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------------------------
// Esqueletos (árboles de cortes)
// ---------------------------------------------------------------------------------------------

type Spec = string | { ax: 'x' | 'y'; m: 'f' | 'a' | 'b'; v: number; A: Spec; B: Spec };
// f = fracción del lado, a = metros que mide A, b = metros que mide B.
const X = (v: number, A: Spec, B: Spec): Spec => ({ ax: 'x', m: 'f', v, A, B });
const Xa = (v: number, A: Spec, B: Spec): Spec => ({ ax: 'x', m: 'a', v, A, B });
const Xb = (v: number, A: Spec, B: Spec): Spec => ({ ax: 'x', m: 'b', v, A, B });
const Y = (v: number, A: Spec, B: Spec): Spec => ({ ax: 'y', m: 'f', v, A, B });
const Ya = (v: number, A: Spec, B: Spec): Spec => ({ ax: 'y', m: 'a', v, A, B });
const Yb = (v: number, A: Spec, B: Spec): Spec => ({ ax: 'y', m: 'b', v, A, B });
/** Anillo de pasillo de 2,2 m alrededor de `inner` (las cuatro tiras forman UNA sala). */
const ring = (inner: Spec, w = 2.2): Spec =>
  Xa(w, 'p@r', Xb(w, Ya(w, 'p@r', Yb(w, inner, 'p@r')), 'p@r'));

const SKEL: Record<string, Spec> = {
  // pequeños
  S1: X(0.6, 'h', Y(0.5, 'a', 'b')),
  S2: Yb(2.3, X(0.62, 'h', Y(0.5, 'a', 'b')), 'p'),
  S3: Y(0.5, X(0.5, 'a', 'b'), X(0.42, 'c', 'd')),
  S4: X(0.27, 'a', X(0.72, 'h', 'b')),
  S5: ring(X(0.5, 'a', 'b')),
  // medianos
  M1: Y(0.3, X(0.34, 'a', X(0.5, 'b', 'c')), X(0.72, 'h', Y(0.5, 'd', 'e'))),
  M2: Y(0.4, X(0.3, 'a', X(0.5, 'b', 'c')), Ya(2.3, 'p', X(0.25, 'd', X(0.75, 'h', 'e')))),
  M3: ring(Y(0.5, X(0.5, 'a', 'b'), X(0.5, 'c', 'd'))),
  M4: X(0.22, Y(0.5, 'a', 'b'), X(0.72, 'h', Y(0.5, 'c', 'd'))),
  // grandes
  G1: Y(0.32, X(0.3, 'a', X(0.5, 'b', 'c')), Y(0.62, X(0.3, 'd', X(0.67, 'h', 'e')), X(0.3, 'f', X(0.5, 'g', 'i')))),
  G2: Y(0.36, X(0.3, 'a', X(0.5, 'b', 'c')), Ya(2.4, 'p', X(0.22, 'd', X(0.33, 'e', X(0.5, 'f', 'g'))))),
  G3: ring(X(0.6, 'h', Y(0.5, 'a', 'b'))),
  G5: Y(0.55, X(0.5, 'h', 'k'), X(0.36, 'a', X(0.6, 'b', 'c'))),
  G6: ring(Y(0.5, X(0.34, 'a', X(0.5, 'b', 'c')), X(0.34, 'd', X(0.5, 'e', 'f')))),
  // «Final» (planta 8, grande): laberinto de 13 salas
  F: X(0.2, Y(0.25, 'a', Y(0.33, 'b', Y(0.5, 'c', 'd'))),
    X(0.35, Y(0.4, 'e', Y(0.5, 'f', 'g')),
      X(0.325, Y(0.3, 'h', Y(0.5, 'i', 'j')), Y(0.35, 'k', Y(0.5, 'l', 'm'))))),
};

interface Plan {
  skel: string;
  roles: Record<string, string>;
  /** hoja que se vacía (planta en L). */
  vacio?: string;
  /** tendencia de puertas: 'max' usa el máximo permitido. */
  puertas?: 'max' | 'azar';
  aspecto?: number;
}

const PLANS: Record<number, Partial<Record<Size, Plan>>> = {
  2: {
    pequeno: { skel: 'S2', roles: { h: 'cub', a: 'des', b: 'des', p: 'pas' } },
    mediano: { skel: 'M2', roles: { a: 'des', b: 'des', c: 'des', p: 'pas', d: 'arc', h: 'cub', e: 'des' } },
    grande: { skel: 'G3', roles: { h: 'cub', a: 'des', b: 'arc', p: 'pas' } },
  },
  3: {
    pequeno: { skel: 'S1', roles: { h: 'dev', a: 'cafe', b: 'sala' } },
    mediano: { skel: 'M1', roles: { h: 'dev', a: 'cafe', b: 'sala', c: 'sala', d: 'des', e: 'des' }, vacio: 'e' },
    grande: { skel: 'G1', roles: { h: 'dev', a: 'cafe', b: 'sala', c: 'sala', d: 'dev', e: 'sala', f: 'sala', g: 'dev', i: 'cafe' } },
  },
  4: {
    pequeno: { skel: 'S3', roles: { a: 'lab', b: 'lab', c: 'lab', d: 'ctl' }, puertas: 'max' },
    mediano: { skel: 'M2', roles: { a: 'lab', b: 'lab', c: 'ctl', p: 'pas', d: 'lab', h: 'lab', e: 'lab' }, puertas: 'max' },
    grande: { skel: 'G2', roles: { a: 'lab', b: 'lab', c: 'ctl', p: 'pas', d: 'lab', e: 'lab', f: 'lab', g: 'ctl' }, puertas: 'max' },
  },
  5: {
    pequeno: { skel: 'S1', roles: { h: 'rack', a: 'ctl', b: 'ctl' } },
    mediano: { skel: 'M1', roles: { h: 'rack', a: 'ctl', b: 'ctl', c: 'rack', d: 'rack', e: 'ctl' } },
    grande: { skel: 'G5', roles: { h: 'rack', k: 'rack', a: 'ctl', b: 'rack', c: 'ctl' } },
  },
  7: {
    pequeno: { skel: 'S5', roles: { a: 'dir', b: 'dir', p: 'pas' } },
    mediano: { skel: 'M3', roles: { a: 'dir', b: 'dir', c: 'dir', d: 'dir', p: 'pas' } },
    grande: { skel: 'G6', roles: { a: 'dir', b: 'dir', c: 'dir', d: 'dir', e: 'dir', f: 'dir', p: 'pas' } },
  },
  8: {
    pequeno: { skel: 'S4', roles: { a: 'ante', h: 'sj', b: 'ante' } },
    mediano: { skel: 'M4', roles: { a: 'ante', b: 'ante', h: 'sj', c: 'ante', d: 'ante' } },
    grande: { skel: 'F', roles: {}, puertas: 'max' },
  },
};

// ---------------------------------------------------------------------------------------------
// Tabla de tamaños
// ---------------------------------------------------------------------------------------------

interface Rango { area: [number, number]; muros: [number, number]; puertas: [number, number]; mob: [number, number]; obj: [number, number] }
const RANGOS: Record<Size, Rango> = {
  pequeno: { area: [150, 350], muros: [5, 8], puertas: [2, 3], mob: [12, 24], obj: [2, 5] },
  mediano: { area: [400, 900], muros: [9, 15], puertas: [5, 6], mob: [30, 42], obj: [5, 8] },
  grande: { area: [700, 1170], muros: [12, 18], puertas: [4, 7], mob: [27, 47], obj: [5, 8] },
};
const RANGO_FINAL: Rango = { area: [700, 780], muros: [26, 28], puertas: [13, 15], mob: [0, 0], obj: [16, 16] };
const RANGO_AZOTEA: Rango = { area: [380, 1000], muros: [3, 18], puertas: [0, 2], mob: [12, 18], obj: [5, 8] };

function rangoDe(floor: number, size: Size): Rango {
  if (floor === 9) {
    if (size === 'grande') return RANGO_AZOTEA;
    return { ...RANGO_AZOTEA, area: [150, 1000] };
  }
  if (floor === 8 && size === 'grande') return RANGO_FINAL;
  return RANGOS[size];
}

function areaObjetivo(floor: number, size: Size, rng: Rng): number {
  if (floor === 8 && size === 'grande') return 745;
  if (floor === 9) return size === 'grande' ? 900 : size === 'mediano' ? 625 : 400;
  const [lo, hi] = RANGOS[size].area;
  const t = (floor - 2) / 6;
  // crece con la planta: planta 2 cerca del mínimo, planta 8 cerca del máximo.
  const f = 0.06 + 0.86 * t + (rng() - 0.5) * 0.04;
  return lo + (hi - lo) * Math.max(0.03, Math.min(0.95, f));
}

// ---------------------------------------------------------------------------------------------
// Construcción del plano de salas
// ---------------------------------------------------------------------------------------------

interface Leaf { r: Rect; key: string; gid: string; role: string; void: boolean }
interface Slot { a: number; b: number; ga: string; gb: string; ax: 'v' | 'h'; c: number; lo: number; hi: number; k: number }
interface Opening { ax: 'v' | 'h'; c: number; pos: number; w: number; kind: 'puerta' | 'vano'; ga: string; gb: string }

function expand(spec: Spec, r: Rect, rng: Rng, jit: number, out: { r: Rect; key: string }[]): void {
  if (typeof spec === 'string') { out.push({ r, key: spec }); return; }
  const len = spec.ax === 'x' ? r.x1 - r.x0 : r.y1 - r.y0;
  let pos = spec.m === 'f' ? spec.v * len * (1 + (rng() * 2 - 1) * jit) : spec.m === 'a' ? spec.v : len - spec.v;
  pos = r3(Math.max(1.5, Math.min(len - 1.5, pos)));
  if (spec.ax === 'x') {
    const cx = r3(r.x0 + pos);
    expand(spec.A, { ...r, x1: cx }, rng, jit, out);
    expand(spec.B, { ...r, x0: cx }, rng, jit, out);
  } else {
    const cy = r3(r.y0 + pos);
    expand(spec.A, { ...r, y1: cy }, rng, jit, out);
    expand(spec.B, { ...r, y0: cy }, rng, jit, out);
  }
}

interface Layout {
  leaves: Leaf[];
  perim: P2[];
  W: number; H: number;
  slots: Slot[];
  /** segmentos de muro fusionados (línea completa) */
  lineas: { ax: 'v' | 'h'; c: number; lo: number; hi: number }[];
}

function outline(rects: Rect[]): P2[] | null {
  const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y0, r.y1]))].sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1;
  const fill: boolean[][] = [];
  for (let i = 0; i < nx; i++) {
    fill.push([]);
    for (let j = 0; j < ny; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
      fill[i].push(rects.some((r) => cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1));
    }
  }
  const f = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && fill[i][j];
  const next = new Map<string, P2>();
  const key = (p: P2) => p[0] + ',' + p[1];
  let first: P2 | null = null;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      if (!fill[i][j]) continue;
      const add = (a: P2, b: P2) => { next.set(key(a), b); if (!first) first = a; };
      if (!f(i, j - 1)) add([xs[i], ys[j]], [xs[i + 1], ys[j]]);
      if (!f(i + 1, j)) add([xs[i + 1], ys[j]], [xs[i + 1], ys[j + 1]]);
      if (!f(i, j + 1)) add([xs[i + 1], ys[j + 1]], [xs[i], ys[j + 1]]);
      if (!f(i - 1, j)) add([xs[i], ys[j + 1]], [xs[i], ys[j]]);
    }
  }
  if (!first) return null;
  const pts: P2[] = [];
  let cur: P2 = first;
  for (let n = 0; n < 500; n++) {
    pts.push(cur);
    const nx2 = next.get(key(cur));
    if (!nx2) return null;
    cur = nx2;
    if (cur[0] === first[0] && cur[1] === first[1]) break;
  }
  if (pts.length !== next.size) return null; // más de un bucle (toque en diagonal): no válido
  // elimina vértices colineales
  const res: P2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) > 1e-9) res.push(b);
  }
  return res;
}

function buildLayout(plan: Plan, W0: number, H0: number, areaT: number, rng: Rng, flipX: boolean, flipY: boolean, transp: boolean): Layout | null {
  const spec = SKEL[plan.skel];
  const jit = plan.skel === 'F' ? 0 : 0.07;
  let W = W0, H = H0;
  let leavesRaw: { r: Rect; key: string }[] = [];
  const seedJ = Math.floor(rng() * 1e9);
  for (let pass = 0; pass < 3; pass++) {
    leavesRaw = [];
    expand(spec, { x0: 0, y0: 0, x1: r3(W), y1: r3(H) }, mulberry32(seedJ), jit, leavesRaw);
    let area = 0;
    for (const l of leavesRaw) {
      const letter = l.key.split('@')[0];
      if (letter === plan.vacio) continue;
      area += (l.r.x1 - l.r.x0) * (l.r.y1 - l.r.y0);
    }
    const s = Math.sqrt(areaT / area);
    if (Math.abs(s - 1) < 0.004) break;
    W *= s; H *= s;
  }
  const leaves: Leaf[] = leavesRaw.map((l, idx) => {
    const [letter, g] = l.key.split('@');
    const isVoid = letter === plan.vacio || plan.roles[letter] === 'void';
    let r = l.r;
    if (flipX) r = { ...r, x0: r3(W - r.x1), x1: r3(W - r.x0) };
    if (flipY) r = { ...r, y0: r3(H - r.y1), y1: r3(H - r.y0) };
    if (transp) r = { x0: r.y0, y0: r.x0, x1: r.y1, y1: r.x1 };
    return { r, key: l.key, gid: g ?? 'L' + idx, role: plan.roles[letter] ?? 'laberinto', void: isVoid };
  });
  const live = leaves.filter((l) => !l.void);
  const perim = outline(live.map((l) => l.r));
  if (!perim) return null;
  const bb = bboxOf(perim);
  // desplaza para que el origen quede en (0,0)
  if (Math.abs(bb.x0) > 1e-9 || Math.abs(bb.y0) > 1e-9) {
    for (const l of leaves) { l.r = { x0: r3(l.r.x0 - bb.x0), x1: r3(l.r.x1 - bb.x0), y0: r3(l.r.y0 - bb.y0), y1: r3(l.r.y1 - bb.y0) }; }
    for (const p of perim) { p[0] = r3(p[0] - bb.x0); p[1] = r3(p[1] - bb.y0); }
  }
  const bb2 = bboxOf(perim);
  // Adyacencias
  const slots: Slot[] = [];
  const segs: { ax: 'v' | 'h'; c: number; lo: number; hi: number }[] = [];
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i], b = leaves[j];
      if (a.void || b.void || a.gid === b.gid) continue;
      let c = 0, lo = 0, hi = 0, ax: 'v' | 'h' | null = null;
      if (Math.abs(a.r.x1 - b.r.x0) < 1e-6 || Math.abs(b.r.x1 - a.r.x0) < 1e-6) {
        lo = Math.max(a.r.y0, b.r.y0); hi = Math.min(a.r.y1, b.r.y1);
        if (hi - lo > 1e-3) { ax = 'v'; c = Math.abs(a.r.x1 - b.r.x0) < 1e-6 ? a.r.x1 : a.r.x0; }
      }
      if (!ax && (Math.abs(a.r.y1 - b.r.y0) < 1e-6 || Math.abs(b.r.y1 - a.r.y0) < 1e-6)) {
        lo = Math.max(a.r.x0, b.r.x0); hi = Math.min(a.r.x1, b.r.x1);
        if (hi - lo > 1e-3) { ax = 'h'; c = Math.abs(a.r.y1 - b.r.y0) < 1e-6 ? a.r.y1 : a.r.y0; }
      }
      if (!ax) continue;
      segs.push({ ax, c, lo, hi });
      const L = hi - lo;
      if (L >= 2.5) {
        const cap = L >= 7.2 ? 2 : 1;
        for (let k = 0; k < cap; k++) slots.push({ a: i, b: j, ga: a.gid, gb: b.gid, ax, c, lo, hi, k });
      }
    }
  }
  // fusiona segmentos colineales contiguos
  segs.sort((p, q) => (p.ax === q.ax ? (p.c === q.c ? p.lo - q.lo : p.c - q.c) : p.ax < q.ax ? -1 : 1));
  const lineas: Layout['lineas'] = [];
  for (const s of segs) {
    const last = lineas[lineas.length - 1];
    if (last && last.ax === s.ax && Math.abs(last.c - s.c) < 1e-6 && s.lo <= last.hi + 1e-6) last.hi = Math.max(last.hi, s.hi);
    else lineas.push({ ...s });
  }
  return { leaves, perim, W: bb2.x1, H: bb2.y1, slots, lineas };
}

// ---------------------------------------------------------------------------------------------
// Selección de aberturas sin puentes
// ---------------------------------------------------------------------------------------------

function countBridges(n: number, edges: [number, number][]): number {
  // Devuelve nº de aristas que desconectan; -1 si el grafo ya está desconectado.
  const conn = (skip: number) => {
    const par = Array.from({ length: n }, (_, i) => i);
    const find = (x: number): number => (par[x] === x ? x : (par[x] = find(par[x])));
    let comps = n;
    for (let i = 0; i < edges.length; i++) {
      if (i === skip) continue;
      const a = find(edges[i][0]), b = find(edges[i][1]);
      if (a !== b) { par[a] = b; comps--; }
    }
    return comps === 1;
  };
  if (!conn(-1)) return -1;
  let br = 0;
  for (let i = 0; i < edges.length; i++) if (!conn(i)) br++;
  return br;
}

function selectEdges(n: number, cand: [number, number][], rng: Rng, extra: number): number[] | null {
  if (n < 2) return [];
  const order = shuffle(rng, cand.map((_, i) => i));
  const par = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (par[x] === x ? x : (par[x] = find(par[x])));
  const sel: number[] = [];
  for (const e of order) {
    const a = find(cand[e][0]), b = find(cand[e][1]);
    if (a !== b) { par[a] = b; sel.push(e); }
  }
  if (sel.length !== n - 1) return null;
  const edgesOf = (s: number[]) => s.map((i) => cand[i]);
  for (let guard = 0; guard < 60; guard++) {
    const cur = countBridges(n, edgesOf(sel));
    if (cur === 0) break;
    let best = -1, bestC = cur;
    for (const e of shuffle(rng, cand.map((_, i) => i))) {
      if (sel.includes(e)) continue;
      const c = countBridges(n, edgesOf([...sel, e]));
      if (c < bestC) { bestC = c; best = e; }
    }
    if (best < 0) return null;
    sel.push(best);
  }
  if (countBridges(n, edgesOf(sel)) !== 0) return null;
  const rest = shuffle(rng, cand.map((_, i) => i).filter((i) => !sel.includes(i)));
  while (sel.length < extra && rest.length) sel.push(rest.pop()!);
  return sel;
}

const ABIERTAS = new Set(['pas', 'cub', 'dev', 'rack', 'sj', 'cafe', 'ante', 'hall', 'laberinto']);

interface Aberturas { openings: Opening[]; nPuertas: number; nVanos: number }

function elegirAberturas(lay: Layout, rng: Rng, wT: number, dT: number, dMin: number): Aberturas | null {
  const gids = [...new Set(lay.leaves.filter((l) => !l.void).map((l) => l.gid))];
  const gi = new Map(gids.map((g, i) => [g, i]));
  const cand: [number, number][] = lay.slots.map((s) => [gi.get(s.ga)!, gi.get(s.gb)!]);
  const nLineas = lay.lineas.length;
  const extra = Math.max(wT - nLineas, dMin);
  const sel = selectEdges(gids.length, cand, rng, extra);
  if (!sel) return null;
  const O = sel.length;
  const nDoors = Math.min(O, dT);
  let nVanos = O - nDoors;
  // puntuación de «vano»: ambos lados abiertos y interfaz larga
  const role = (g: string) => lay.leaves.find((l) => l.gid === g)!.role;
  const ranked = sel.map((e) => {
    const s = lay.slots[e];
    const sc = (ABIERTAS.has(role(s.ga)) ? 1 : 0) + (ABIERTAS.has(role(s.gb)) ? 1 : 0);
    return { e, sc: sc + (s.hi - s.lo) / 20 + rng() * 0.5 };
  }).sort((a, b) => b.sc - a.sc);
  const vanoSet = new Set<number>();
  for (const r of ranked) {
    if (vanoSet.size >= nVanos) break;
    const s = lay.slots[r.e];
    if (s.hi - s.lo >= 3.4) vanoSet.add(r.e);
  }
  nVanos = vanoSet.size;
  const placed: Opening[] = [];
  for (const e of sel) {
    const s = lay.slots[e];
    const isVano = vanoSet.has(e);
    const w = isVano ? r3(rr(rng, 1.9, Math.min(2.8, s.hi - s.lo - 1.2))) : DOOR_W;
    const lo = s.lo + w / 2 + 0.55, hi = s.hi - w / 2 - 0.55;
    if (hi < lo) return null;
    let ok = false;
    for (let t = 0; t < 40 && !ok; t++) {
      const pos = r3(lo + (hi - lo) * rng());
      const clash = placed.some((o) => o.ax === s.ax && Math.abs(o.c - s.c) < 1e-6 &&
        Math.abs(o.pos - pos) < (o.w + w) / 2 + 1.3 && o.pos >= s.lo - 3 && o.pos <= s.hi + 3 && o.ga === s.ga && o.gb === s.gb);
      if (clash) continue;
      placed.push({ ax: s.ax, c: s.c, pos, w, kind: isVano ? 'vano' : 'puerta', ga: s.ga, gb: s.gb });
      ok = true;
    }
    if (!ok) return null;
  }
  return { openings: placed, nPuertas: placed.filter((o) => o.kind === 'puerta').length, nVanos: placed.filter((o) => o.kind === 'vano').length };
}

// ---------------------------------------------------------------------------------------------
// Muros y puertas a partir de líneas + aberturas
// ---------------------------------------------------------------------------------------------

function mkRectV(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [[r3(x0), r3(y0)], [r3(x0), r3(y1)], [r3(x1), r3(y1)], [r3(x1), r3(y0)]];
}

function murosYPuertas(lineas: Layout['lineas'], openings: Opening[]): { muros: Vec2[][]; puertas: Vec2[][]; vanos: Vec2[][] } {
  const muros: Vec2[][] = [], puertas: Vec2[][] = [], vanos: Vec2[][] = [];
  const h = T / 2;
  for (const ln of lineas) {
    const ops = openings.filter((o) => o.ax === ln.ax && Math.abs(o.c - ln.c) < 1e-6 && o.pos > ln.lo && o.pos < ln.hi)
      .sort((a, b) => a.pos - b.pos);
    let cur = ln.lo;
    const emit = (a: number, b: number, extA: boolean, extB: boolean) => {
      const aa = r3(a - (extA ? h : 0)), bb = r3(b + (extB ? h : 0));
      if (bb - aa < 0.05) return;
      if (ln.ax === 'h') muros.push(mkRectV(aa, ln.c - h, bb, ln.c + h));
      else muros.push(mkRectV(ln.c - h, aa, ln.c + h, bb));
    };
    ops.forEach((o, i) => {
      const a = r3(o.pos - o.w / 2), b = r3(o.pos + o.w / 2);
      emit(cur, a, i === 0, false);
      const rect = ln.ax === 'h' ? mkRectV(a, ln.c - h, b, ln.c + h) : mkRectV(ln.c - h, a, ln.c + h, b);
      (o.kind === 'puerta' ? puertas : vanos).push(rect);
      cur = b;
    });
    emit(cur, ln.hi, ops.length === 0, true);
  }
  return { muros, puertas, vanos };
}

// ---------------------------------------------------------------------------------------------
// Contexto de amueblado
// ---------------------------------------------------------------------------------------------

interface Furn { tipo: FurnitureType; x: number; y: number; ang: number; poly: P2[]; bb: Rect; gid: number }
interface Ctx {
  rng: Rng;
  perim: P2[];
  facade: P2[][];
  solid: { poly: P2[]; bb: Rect }[];
  openings: P2[];
  excl: { x: number; y: number; r: number }[];
  furn: Furn[];
  nextGid: number;
}

function mkFurn(tipo: FurnitureType, x: number, y: number, ang: number): Furn {
  const s = FURNITURE[tipo];
  const libre = Math.abs(((ang % 90) + 90) % 90) > 0.5 && Math.abs(((ang % 90) + 90) % 90 - 90) > 0.5;
  const poly = libre ? circlePoly(x, y, (Math.hypot(s.w, s.d) / 2) * 1.04) : rectPoly(x, y, s.w, s.d, ang);
  return { tipo, x: r3(x), y: r3(y), ang, poly, bb: bboxOf(poly), gid: 0 };
}

function canPlace(c: Ctx, f: Furn): boolean {
  for (const [x, y] of f.poly) if (!pointInPoly(x, y, c.perim)) return false;
  for (const e of c.facade) if (polyDist(f.poly, e) < 0.02) return false;
  for (const w of c.solid) {
    if (bbGap(f.bb, w.bb) > 0.5) continue;
    if (polyDist(f.poly, w.poly) < 0.02) return false;
  }
  for (const o of c.openings) if (ptPolyDist(o[0], o[1], f.poly) < 1.4) return false;
  for (const e of c.excl) if (ptPolyDist(e.x, e.y, f.poly) < e.r) return false;
  for (const o of c.furn) {
    if (bbGap(f.bb, o.bb) >= 1.15) continue;
    const g = polyDist(f.poly, o.poly);
    if (g < 0.02) return false;
    if (f.tipo === 'silla' || o.tipo === 'silla') continue;
    // o adosados del todo o ≥ 1,15 m de paso (1,0 exigido; el margen absorbe la rejilla de 0,2 m)
    if (g > 0.08) return false;
  }
  return true;
}

type Piece = [FurnitureType, number, number, number];
/** Coloca un grupo todo-o-nada. Devuelve nº de piezas colocadas (0 si falla). */
function put(c: Ctx, pieces: Piece[]): number {
  const gid = c.nextGid++;
  const placed: Furn[] = [];
  for (const [t, x, y, a] of pieces) {
    const f = mkFurn(t, x, y, a);
    f.gid = gid;
    if (!canPlace(c, f)) {
      for (let i = 0; i < placed.length; i++) c.furn.pop();
      return 0;
    }
    c.furn.push(f); placed.push(f);
  }
  return placed.length;
}

const FW = (t: FurnitureType) => FURNITURE[t].w;
const FD = (t: FurnitureType) => FURNITURE[t].d;

function silla(c: Ctx, x: number, y: number): Piece {
  const a = c.rng() < 0.25 ? 0 : Math.round(rr(c.rng, -35, 35));
  return ['silla', x, y, a === 0 ? 0 : (Math.abs(a) < 4 ? 8 : a)];
}

// ---- Patrones de amueblado ---------------------------------------------------------------------

function deskPods(c: Ctx, r: Rect, budget: number): number {
  const W = r.x1 - r.x0 - 0.06, H = r.y1 - r.y0 - 0.06;
  const n = W >= 12 ? 3 : 2;
  const podW = n * 1.75 - 0.02, podH = FD('escritorio') + 0.02 + 0.8;
  const gx = 1.3, gy = 1.3;
  const cols = Math.floor((W + gx) / (podW + gx)), rows = Math.floor((H + gy) / (podH + gy));
  if (cols < 1 || rows < 1) return 0;
  const usedW = cols * podW + (cols - 1) * gx, usedH = rows * podH + (rows - 1) * gy;
  const fx = c.rng() < 0.5, fy = c.rng() < 0.5;
  const x0 = fx ? r.x0 + 0.03 : r.x1 - 0.03 - usedW, y0 = fy ? r.y0 + 0.03 : r.y1 - 0.03 - usedH;
  const cells: [number, number][] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cells.push([i, j]);
  let placed = 0;
  for (const [i, j] of shuffle(c.rng, cells)) {
    if (placed >= budget) break;
    const px = x0 + i * (podW + gx), py = y0 + j * (podH + gy);
    const pcs: Piece[] = [];
    for (let k = 0; k < n; k++) {
      const dx = px + 0.865 + k * 1.75;
      pcs.push(['escritorio', dx, py + 0.735, 0]);
      pcs.push(silla(c, dx + rr(c.rng, -0.2, 0.2), py + 1.47 + 0.02 + 0.41));
    }
    placed += put(c, pcs);
  }
  return placed;
}

function devDoubles(c: Ctx, r: Rect, budget: number): number {
  const W = r.x1 - r.x0 - 0.06, H = r.y1 - r.y0 - 0.06;
  const uW = 2.42, uH = 2.78, gx = 1.3, gy = 1.3;
  const cols = Math.floor((W + gx) / (uW + gx)), rows = Math.floor((H + gy) / (uH + gy));
  if (cols < 1 || rows < 1) return 0;
  const usedW = cols * uW + (cols - 1) * gx, usedH = rows * uH + (rows - 1) * gy;
  const x0 = c.rng() < 0.5 ? r.x0 + 0.03 : r.x1 - 0.03 - usedW, y0 = c.rng() < 0.5 ? r.y0 + 0.03 : r.y1 - 0.03 - usedH;
  const cells: [number, number][] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cells.push([i, j]);
  let placed = 0;
  for (const [i, j] of shuffle(c.rng, cells)) {
    if (placed >= budget) break;
    const px = x0 + i * (uW + gx), py = y0 + j * (uH + gy);
    const pcs: Piece[] = [];
    for (let k = 0; k < 2; k++) {
      const mx = px + 0.6 + k * 1.22;
      pcs.push(['mesa', mx, py + 1.1, 90]);
      pcs.push(['mesa', mx, py + 1.68, 90]);
      pcs.push(silla(c, mx + rr(c.rng, -0.15, 0.15), py + 0.4));
      pcs.push(silla(c, mx + rr(c.rng, -0.15, 0.15), py + 2.38));
    }
    placed += put(c, pcs);
  }
  return placed;
}

function rackRows(c: Ctx, r: Rect, budget: number, aisle: number, dbl: boolean): number {
  const w = r.x1 - r.x0, h = r.y1 - r.y0;
  const alongX = w >= h;
  const L = alongX ? w : h, Wc = alongX ? h : w;
  const tp = dbl ? 0.57 * 2 + 0.02 : 0.57;
  const nPairs = Math.floor((Wc - 2 * 1.2 + aisle) / (tp + aisle));
  if (nPairs < 1) return 0;
  const used = nPairs * tp + (nPairs - 1) * aisle;
  const mCross = (Wc - used) / 2;
  const perRow = dbl ? 2 : 1;
  const maxK = Math.floor((L - 2 * 1.3) / 1.35);
  if (maxK < 2) return 0;
  const k = Math.max(2, Math.min(maxK, Math.round(budget / (nPairs * perRow))));
  const rowLen = k * 1.35 - 0.02;
  const a0 = (alongX ? r.x0 : r.y0) + (L - rowLen) / 2;
  const cr0 = (alongX ? r.y0 : r.x0) + mCross;
  let placed = 0;
  for (let p = 0; p < nPairs; p++) {
    const cc = cr0 + p * (tp + aisle) + tp / 2;
    const rows = dbl ? [cc - 0.295, cc + 0.295] : [cc];
    for (const rc of rows) {
      // si la fila es muy larga se parte en dos con un cruce de 1,5 m
      const segs: [number, number][] = k > 8 ? [[0, Math.ceil(k / 2)], [Math.ceil(k / 2), k]] : [[0, k]];
      for (const [s0, s1] of segs) {
        const pcs: Piece[] = [];
        const gapShift = k > 8 && s0 > 0 ? 1.5 : 0;
        for (let i = s0; i < s1; i++) {
          const a = a0 + 0.665 + i * 1.35 + gapShift - (k > 8 ? 0.75 : 0);
          pcs.push(alongX ? ['estanteria', a, rc, 0] : ['estanteria', rc, a, 90]);
        }
        placed += put(c, pcs);
      }
    }
  }
  return placed;
}

function wallShelves(c: Ctx, r: Rect, budget: number): number {
  let placed = 0;
  for (let tries = 0; tries < 50 && placed < budget; tries++) {
    const wall = Math.floor(c.rng() * 4);
    const k = 1 + Math.floor(c.rng() * 3);
    const len = k * 1.35 - 0.02;
    const wl = wall < 2 ? r.x1 - r.x0 : r.y1 - r.y0;
    if (wl < len + 1.6) continue;
    const st = (wall < 2 ? r.x0 : r.y0) + 0.7 + c.rng() * (wl - len - 1.4);
    const pcs: Piece[] = [];
    for (let i = 0; i < k; i++) {
      const a = st + 0.665 + i * 1.35;
      if (wall === 0) pcs.push(['estanteria', a, r.y0 + 0.03 + 0.285, 0]);
      else if (wall === 1) pcs.push(['estanteria', a, r.y1 - 0.03 - 0.285, 0]);
      else if (wall === 2) pcs.push(['estanteria', r.x0 + 0.03 + 0.285, a, 90]);
      else pcs.push(['estanteria', r.x1 - 0.03 - 0.285, a, 90]);
    }
    placed += put(c, pcs);
  }
  return placed;
}

function sofaRuns(c: Ctx, r: Rect, nSofas: number): number {
  let placed = 0;
  for (let tries = 0; tries < 30 && placed < nSofas; tries++) {
    const wall = Math.floor(c.rng() * 4);
    const k = 1 + Math.floor(c.rng() * 2);
    const len = k * 1.62;
    const wl = wall < 2 ? r.x1 - r.x0 : r.y1 - r.y0;
    if (wl < len + 1.6) continue;
    const st = (wall < 2 ? r.x0 : r.y0) + 0.8 + c.rng() * (wl - len - 1.6);
    const pcs: Piece[] = [];
    for (let i = 0; i < k; i++) {
      const a = st + 0.8 + i * 1.62;
      if (wall === 0) pcs.push(['sofa', a, r.y0 + 0.03 + 0.295, 90]);
      else if (wall === 1) pcs.push(['sofa', a, r.y1 - 0.03 - 0.295, 90]);
      else if (wall === 2) pcs.push(['sofa', r.x0 + 0.03 + 0.295, a, 0]);
      else pcs.push(['sofa', r.x1 - 0.03 - 0.295, a, 0]);
    }
    placed += put(c, pcs);
  }
  return placed;
}

function tableGrid(c: Ctx, r: Rect, budget: number, gap: number): number {
  const W = r.x1 - r.x0, H = r.y1 - r.y0;
  const s = 1.33;
  const cols = Math.floor((W - 2 * 1.2 + gap) / (s + gap)), rows = Math.floor((H - 2 * 1.2 + gap) / (s + gap));
  if (cols < 1 || rows < 1) return 0;
  const mx = (W - (cols * s + (cols - 1) * gap)) / 2, my = (H - (rows * s + (rows - 1) * gap)) / 2;
  const cells: [number, number][] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cells.push([i, j]);
  let placed = 0;
  for (const [i, j] of shuffle(c.rng, cells)) {
    if (placed >= budget) break;
    const ang = c.rng() < 0.3 ? Math.round(rr(c.rng, -30, 30)) : 0;
    placed += put(c, [['mesa_con_sillas', r.x0 + mx + s / 2 + i * (s + gap), r.y0 + my + s / 2 + j * (s + gap), ang === 0 ? 0 : (Math.abs(ang) < 4 ? 10 : ang)]]);
  }
  return placed;
}

function plants(c: Ctx, r: Rect, n: number): number {
  const m = 0.25;
  const spots: [number, number][] = [
    [r.x0 + m, r.y0 + m], [r.x1 - m, r.y0 + m], [r.x0 + m, r.y1 - m], [r.x1 - m, r.y1 - m],
    [(r.x0 + r.x1) / 2, r.y0 + m], [(r.x0 + r.x1) / 2, r.y1 - m], [r.x0 + m, (r.y0 + r.y1) / 2], [r.x1 - m, (r.y0 + r.y1) / 2],
  ];
  let placed = 0;
  for (const [x, y] of shuffle(c.rng, spots)) {
    if (placed >= n) break;
    placed += put(c, [['maceta', x, y, 0]]);
  }
  return placed;
}

function butacasYMesa(c: Ctx, r: Rect): number {
  // rincón de espera: dos butacas enfrentadas con una mesa baja entre ellas, hacia el centro
  const cx = (r.x0 + r.x1) / 2 + rr(c.rng, -0.8, 0.8), cy = (r.y0 + r.y1) / 2 + rr(c.rng, -0.8, 0.8);
  return put(c, [['butaca', cx - 0.3 - 0.265, cy, 0], ['mesa', cx, cy, 0], ['butaca', cx + 0.3 + 0.265, cy, 180]]);
}

function despacho(c: Ctx, r: Rect, rica: boolean): number {
  const W = r.x1 - r.x0, H = r.y1 - r.y0;
  let placed = 0;
  // Escritorio de cara a la sala, con la silla del lado de la pared y las butacas enfrente.
  // Coordenadas locales: u a lo largo de la pared, v hacia dentro. Se prueba cada pared hasta que cabe.
  for (const side of shuffle(c.rng, [0, 1, 2, 3])) {
    const along = side < 2 ? W : H, depth = side < 2 ? H : W;
    if (depth < (rica ? 6.0 : 4.6) || along < 3.6) continue;
    const u0 = r.x0 * 0, mid = along / 2 + rr(c.rng, -0.6, 0.6);
    const toW = (u: number, v: number): [number, number] => {
      if (side === 0) return [r.x0 + u, r.y0 + v];
      if (side === 1) return [r.x0 + u, r.y1 - v];
      if (side === 2) return [r.x0 + v, r.y0 + u];
      return [r.x1 - v, r.y0 + u];
    };
    void u0;
    const ang = side < 2 ? 0 : 90;
    const pcs: Piece[] = [];
    const [dx, dy] = toW(mid, 2.585);
    pcs.push(['escritorio', dx, dy, ang]);
    const [sx, sy] = toW(mid + rr(c.rng, -0.2, 0.2), 1.42);
    pcs.push(silla(c, sx, sy));
    if (rica) {
      const [b1x, b1y] = toW(mid - 0.75, 4.8);
      const [b2x, b2y] = toW(mid + 0.75, 4.8);
      const ba = side === 0 ? 0 : side === 1 ? 180 : side === 2 ? 90 : -90;
      pcs.push(['butaca', b1x, b1y, ba]);
      pcs.push(['butaca', b2x, b2y, ba]);
    }
    placed += put(c, pcs);
    if (placed) break;
  }
  placed += wallShelves(c, r, rica ? 3 : 2);
  if (rica) placed += sofaRuns(c, r, 2);
  placed += plants(c, r, rica ? 2 : 1);
  return placed;
}

function furnishLeaf(c: Ctx, l: Leaf, budget: number): number {
  // los límites de hoja son ejes de muro: se mete medio grosor (+ holgura) para no pisarlos
  const r: Rect = { x0: l.r.x0 + 0.185, y0: l.r.y0 + 0.185, x1: l.r.x1 - 0.185, y1: l.r.y1 - 0.185 };
  const b = Math.max(1, Math.round(budget));
  switch (l.role) {
    case 'cub': return deskPods(c, r, Math.round(b * 0.85)) + wallShelves(c, r, Math.max(1, Math.round(b * 0.1))) + plants(c, r, 1);
    case 'dev': return devDoubles(c, r, Math.round(b * 0.75)) + wallShelves(c, r, Math.max(2, Math.round(b * 0.25)));
    case 'des': return despacho(c, r, false);
    case 'dir': return despacho(c, r, true);
    case 'ctl': return despacho(c, r, false);
    case 'cafe': return tableGrid(c, r, 2, 1.3) + sofaRuns(c, r, 2) + plants(c, r, 2);
    case 'sala': return wallShelves(c, r, Math.max(2, Math.round(b * 0.5))) + butacasYMesa(c, r) + tableGrid(c, r, 1, 1.3) + plants(c, r, 1);
    case 'lab': return rackRows(c, r, Math.round(b * 0.7), 1.5, false) + wallShelves(c, r, 2) + put(c, [['mesa', r.x1 - 1.2, (r.y0 + r.y1) / 2, 0], ['mesa', r.x1 - 1.2 - 0.58, (r.y0 + r.y1) / 2, 0]]);
    case 'rack': return rackRows(c, r, b, 2.0, true);
    case 'arc': return rackRows(c, r, b, 1.4, false) + wallShelves(c, r, 2);
    case 'sj': return tableGrid(c, r, b, 1.3);
    case 'ante': return sofaRuns(c, r, 2) + butacasYMesa(c, r) + plants(c, r, 2);
    case 'pas': return plants(c, r, 1);
    default: return sofaRuns(c, r, 2) + plants(c, r, 1);
  }
}

const PESO: Record<string, number> = { cub: 4, dev: 4, rack: 6, lab: 2.4, des: 1.2, dir: 1.6, ctl: 0.8, cafe: 1.5, sala: 1.8, sj: 5, ante: 1.3, arc: 2.2, pas: 0.12, laberinto: 0 };

// ---------------------------------------------------------------------------------------------
// Objetos
// ---------------------------------------------------------------------------------------------

const TIPOS_OBJ: ItemType[] = ['vida_20', 'vida_50', 'vida_100', 'municion_20', 'municion_50', 'municion_100'];

function repartirObjetos(rng: Rng, n: number, perim: P2[], obstacles: P2[][], openings: P2[], start: P2, boss: P2): { tipo: ItemType; pos: Vec2 }[] {
  const reach = makeGrid(perim, obstacles, 0.4);
  const clear = makeGrid(perim, obstacles, 0.65);
  const seen = flood(reach, nearestFree(reach, start[0], start[1]));
  const cand: P2[] = [];
  for (let j = 0; j < clear.ny; j++) {
    for (let i = 0; i < clear.nx; i++) {
      const k = j * clear.nx + i;
      if (!clear.free[k] || !seen[k]) continue;
      const x = (i + 0.5) * RES, y = (j + 0.5) * RES;
      if (Math.hypot(x - start[0], y - start[1]) < 2.2 || Math.hypot(x - boss[0], y - boss[1]) < 2.2) continue;
      if (openings.some((o) => Math.hypot(o[0] - x, o[1] - y) < 1.5)) continue;
      cand.push([x, y]);
    }
  }
  const chosen: P2[] = [];
  if (cand.length === 0) return [];
  chosen.push(cand[Math.floor(rng() * cand.length)]);
  while (chosen.length < n) {
    let best: P2 | null = null, bs = -1;
    for (let t = 0; t < 500; t++) {
      const p = cand[Math.floor(rng() * cand.length)];
      let d = 1e9;
      for (const q of chosen) d = Math.min(d, Math.hypot(p[0] - q[0], p[1] - q[1]));
      d = Math.min(d, Math.hypot(p[0] - start[0], p[1] - start[1]) * 1.3);
      d *= 0.85 + rng() * 0.3;
      if (d > bs) { bs = d; best = p; }
    }
    chosen.push(best!);
  }
  // seis tipos a partes (casi) iguales
  const tipos: ItemType[] = [];
  while (tipos.length < n) tipos.push(...shuffle(rng, TIPOS_OBJ));
  return chosen.map((p, i) => ({ tipo: tipos[i], pos: [r3(p[0]), r3(p[1])] as Vec2 }));
}

// ---------------------------------------------------------------------------------------------
// Inicio y jefe
// ---------------------------------------------------------------------------------------------

function esquinasConvexas(perim: P2[]): { v: P2; dir: P2 }[] {
  let s = 0;
  for (let i = 0; i < perim.length; i++) { const a = perim[i], b = perim[(i + 1) % perim.length]; s += a[0] * b[1] - b[0] * a[1]; }
  const sign = s > 0 ? 1 : -1;
  const out: { v: P2; dir: P2 }[] = [];
  for (let i = 0; i < perim.length; i++) {
    const a = perim[(i + perim.length - 1) % perim.length], b = perim[i], c = perim[(i + 1) % perim.length];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cr * sign <= 0) continue;
    const d1: P2 = [Math.sign(a[0] - b[0]), Math.sign(a[1] - b[1])];
    const d2: P2 = [Math.sign(c[0] - b[0]), Math.sign(c[1] - b[1])];
    out.push({ v: b, dir: [d1[0] + d2[0], d1[1] + d2[1]] });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Validación con rejilla (misma idea que las pruebas; aquí sirve para reintentar)
// ---------------------------------------------------------------------------------------------

function polysDeMapa(m: MapDef): P2[][] {
  const out: P2[][] = [];
  for (const w of m.muros) out.push(w as P2[]);
  for (const f of m.mobiliario) out.push(rectPoly(f.pos[0], f.pos[1], FW(f.tipo), FD(f.tipo), f.angulo));
  return out;
}

function validarMapa(m: MapDef, vanos: Vec2[][], rg: Rango, soft: boolean): string[] {
  const v: string[] = [];
  const area = polyArea(m.perimetro as P2[]);
  if (area < rg.area[0] || area > rg.area[1]) v.push(`superficie ${area.toFixed(0)}`);
  if (m.muros.length < rg.muros[0] || m.muros.length > rg.muros[1]) v.push(`muros ${m.muros.length}`);
  if (m.puertas.length < rg.puertas[0] || m.puertas.length > rg.puertas[1]) v.push(`puertas ${m.puertas.length}`);
  if (m.mobiliario.length < rg.mob[0] || m.mobiliario.length > rg.mob[1]) v.push(`muebles ${m.mobiliario.length}`);
  if (m.objetos.length < rg.obj[0] || m.objetos.length > rg.obj[1]) v.push(`objetos ${m.objetos.length}`);
  const g = makeGrid(m.perimetro as P2[], polysDeMapa(m), 0.4);
  const s0 = nearestFree(g, m.inicio_jugador[0], m.inicio_jugador[1]);
  const seen = flood(g, s0);
  let orf = 0;
  for (let k = 0; k < seen.length; k++) if (g.free[k] && !seen[k]) orf++;
  if (orf * RES * RES > 0.2) v.push(`suelo aislado ${(orf * RES * RES).toFixed(1)} m2`);
  const bc = nearestFree(g, m.punto_jefe[0], m.punto_jefe[1]);
  if (bc < 0 || !seen[bc]) v.push('jefe inalcanzable');
  for (const o of m.objetos) { const c = nearestFree(g, o.pos[0], o.pos[1]); if (c < 0 || !seen[c]) v.push('objeto inalcanzable'); }
  // tapiado de cada abertura
  const aberturas = [...m.puertas, ...vanos];
  aberturas.forEach((a, idx) => {
    const free2 = g.free.slice();
    const b = bboxOf(a as P2[]);
    const i0 = Math.max(0, Math.floor((b.x0 - 0.4) / RES)), i1 = Math.min(g.nx - 1, Math.ceil((b.x1 + 0.4) / RES));
    const j0 = Math.max(0, Math.floor((b.y0 - 0.4) / RES)), j1 = Math.min(g.ny - 1, Math.ceil((b.y1 + 0.4) / RES));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) * RES, y = (j + 0.5) * RES;
      if (ptPolyDist(x, y, a as P2[]) < 0.4) free2[j * g.nx + i] = 0;
    }
    const st = nearestFree({ ...g, free: free2 }, m.inicio_jugador[0], m.inicio_jugador[1]);
    const sn = flood(g, st, free2);
    let o2 = 0;
    for (let k = 0; k < sn.length; k++) if (free2[k] && !sn[k]) o2++;
    const bj = nearestFree({ ...g, free: free2 }, m.punto_jefe[0], m.punto_jefe[1]);
    if (o2 * RES * RES > 1.8 || bj < 0 || !sn[bj]) v.push(`abertura ${idx} es un puente (${(o2 * RES * RES).toFixed(1)} m2 aislados)`);
  });
  if (!soft) {
    const bb = bboxOf(m.perimetro as P2[]);
    const diag = Math.hypot(bb.x1, bb.y1);
    const d = Math.hypot(m.inicio_jugador[0] - m.punto_jefe[0], m.inicio_jugador[1] - m.punto_jefe[1]);
    if (d < 0.55 * diag) v.push(`jefe cerca (${(d / diag).toFixed(2)} de la diagonal)`);
  }
  return v;
}

// ---------------------------------------------------------------------------------------------
// Generador por salas (plantas 2-5, 7, 8)
// ---------------------------------------------------------------------------------------------

function seedDe(floor: number, size: Size, intento: number): number {
  const base = (floor * 7919 + SIZES.indexOf(size) * 104729 + 12345) >>> 0;
  return (base ^ Math.imul(intento + 1, 0x9e3779b1)) >>> 0;
}

/** Motivos por los que se descartan intentos (para depurar plantillas). */
export const fallos: Record<string, number> = {};
function no(motivo: string): null { fallos[motivo] = (fallos[motivo] ?? 0) + 1; return null; }

function intentoSalas(floor: number, size: Size, plan: Plan, intento: number): MapInfo | null {
  const rng = mulberry32(seedDe(floor, size, intento));
  const rg = rangoDe(floor, size);
  const areaT = areaObjetivo(floor, size, rng);
  const asp = plan.aspecto ?? (size === 'pequeno' ? 1.45 : size === 'mediano' ? 1.4 : 1.15);
  const W0 = Math.sqrt(areaT * asp), H0 = areaT / W0;
  const transp = rng() < 0.4;
  const lay = buildLayout(plan, W0, H0, areaT, rng, rng() < 0.5, rng() < 0.5, transp);
  if (!lay) return no('layout');
  const live = lay.leaves.filter((l) => !l.void);
  // tamaños mínimos de sala
  for (const l of live) {
    const w = l.r.x1 - l.r.x0, h = l.r.y1 - l.r.y0;
    const min = l.role === 'pas' ? 1.8 : 3.5;
    if (l.role === 'pas' && l.gid !== 'r' && Math.min(w, h) < min) return no('sala min '+l.role);
    if (l.role !== 'pas' && Math.min(w, h) < min) return no('sala min '+l.role);
  }
  const area = polyArea(lay.perim);
  const final = floor === 8 && size === 'grande';
  const wT = final ? 27 : Math.round(rr(rng, rg.muros[0] + 0.5, rg.muros[1] + 0.49));
  const dT = final ? 14 : plan.puertas === 'max' ? rg.puertas[1] : Math.round(rr(rng, rg.puertas[0] - 0.49, rg.puertas[1] + 0.49));
  const ab = elegirAberturas(lay, rng, wT, Math.max(rg.puertas[0], Math.min(dT, rg.puertas[1])), rg.puertas[0]);
  if (!ab) return no('aberturas');
  const mp = murosYPuertas(lay.lineas, ab.openings);
  if (mp.muros.length < rg.muros[0] || mp.muros.length > rg.muros[1]) return no('muros '+mp.muros.length);
  if (mp.puertas.length < rg.puertas[0] || mp.puertas.length > rg.puertas[1]) return no('puertas '+mp.puertas.length);
  if (area < rg.area[0] || area > rg.area[1]) return no('area '+Math.round(area));

  const bb = bboxOf(lay.perim);
  const diag = Math.hypot(bb.x1, bb.y1);
  const centrosAb: P2[] = [...mp.puertas, ...mp.vanos].map((q) => {
    const b = bboxOf(q as P2[]);
    return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] as P2;
  });
  const wallPolys: P2[][] = [...mp.muros, ...mp.puertas] as P2[][];

  // --- inicio: esquina convexa dentro de una sala amplia ---
  const hojaDe = (x: number, y: number) => live.find((l) => x >= l.r.x0 && x <= l.r.x1 && y >= l.r.y0 && y <= l.r.y1);
  const grupoArea = (gid: string) => live.filter((l) => l.gid === gid).reduce((s, l) => s + (l.r.x1 - l.r.x0) * (l.r.y1 - l.r.y0), 0);
  interface Cand { p: P2; sc: number }
  const cands: Cand[] = [];
  for (const { v, dir } of esquinasConvexas(lay.perim)) {
    for (const off of [1.4, 1.1]) {
      const p: P2 = [r3(v[0] + dir[0] * off), r3(v[1] + dir[1] * off)];
      if (!pointInPoly(p[0], p[1], lay.perim)) continue;
      const l = hojaDe(p[0], p[1]);
      if (!l) continue;
      const pas = l.role === 'pas';
      if (!pas && (off !== 1.4 || Math.min(l.r.x1 - l.r.x0, l.r.y1 - l.r.y0) < 4.2)) continue;
      if (pas && off !== 1.1) continue;
      if (wallPolys.some((w) => ptPolyDist(p[0], p[1], w) < (pas ? 0.8 : 1.1))) continue;
      if (centrosAb.some((o) => Math.hypot(o[0] - p[0], o[1] - p[1]) < 2.4)) continue;
      cands.push({ p, sc: grupoArea(l.gid) * (0.8 + rng() * 0.4) });
    }
  }
  if (!cands.length) return no('sin inicio');
  const maxSc = Math.max(...cands.map((q) => q.sc));
  const bossDe = (st: P2): { p: P2; d: number } | null => {
    let bp: P2 | null = null, bdist = -1;
    for (const l of live) {
      if (l.role === 'pas') continue;
      if (Math.min(l.r.x1 - l.r.x0, l.r.y1 - l.r.y0) < 4.4) continue;
      const p: P2 = [r3((l.r.x0 + l.r.x1) / 2), r3((l.r.y0 + l.r.y1) / 2)];
      const d = Math.hypot(p[0] - st[0], p[1] - st[1]);
      if (d > bdist) { bdist = d; bp = p; }
    }
    return bp ? { p: bp, d: bdist } : null;
  };
  let start: P2 | null = null, boss: P2 | null = null, bestD = -1;
  for (const q of cands) {
    if (q.sc < maxSc * 0.45) continue;
    const bs = bossDe(q.p);
    if (bs && bs.d * (0.95 + rng() * 0.1) > bestD) { bestD = bs.d * (0.95 + rng() * 0.1); start = q.p; boss = bs.p; }
  }
  if (!start || !boss) return no('sin jefe');

  const rgMob = rg.mob;
  const facade: P2[][] = lay.perim.map((a, i) => {
    const b = lay.perim[(i + 1) % lay.perim.length];
    return [a, b, [b[0] + 0.001, b[1] + 0.001] as P2, [a[0] + 0.001, a[1] + 0.001] as P2];
  });
  const ctx: Ctx = {
    rng, perim: lay.perim, facade,
    solid: wallPolys.map((p) => ({ poly: p, bb: bboxOf(p) })),
    openings: centrosAb,
    excl: [{ x: start[0], y: start[1], r: 2.7 }, { x: boss[0], y: boss[1], r: 2.2 }],
    furn: [], nextGid: 1,
  };
  if (rgMob[1] > 0) {
    const T0 = Math.round(size === 'pequeno' ? rr(rng, 16, 21) : size === 'mediano' ? rr(rng, 35, 40) : rr(rng, 36, 45));
    const grupos = [...new Set(live.map((l) => l.gid))];
    const wa = (l: Leaf) => (PESO[l.role] ?? 1) * (l.r.x1 - l.r.x0) * (l.r.y1 - l.r.y0);
    const tot = live.reduce((s, l) => s + wa(l), 0) || 1;
    void grupos;
    for (const l of live) furnishLeaf(ctx, l, (T0 * wa(l)) / tot);
    // rellena si falta (estanterías pegadas a pared, macetas…) y recorta si sobra
    const grandes = live.filter((l) => l.role !== 'pas' && (PESO[l.role] ?? 1) > 0).sort((a, b) => wa(b) - wa(a));
    for (let it = 0; it < 12 && ctx.furn.length < rgMob[0] + 3 && grandes.length; it++) {
      for (const l of grandes) {
        if (ctx.furn.length >= rgMob[0] + 3) break;
        if (l.role === 'rack') rackRows(ctx, l.r, 6, 2, true);
        else if (l.role === 'cub') deskPods(ctx, l.r, 4);
        else if (l.role === 'dev') devDoubles(ctx, l.r, 4);
        else if (l.role === 'sj') tableGrid(ctx, l.r, 2, 1.3);
        else { wallShelves(ctx, l.r, 2); plants(ctx, l.r, 1); }
      }
    }
    while (ctx.furn.length > rgMob[1]) {
      const g = ctx.furn[ctx.furn.length - 1].gid;
      while (ctx.furn.length && ctx.furn[ctx.furn.length - 1].gid === g) ctx.furn.pop();
    }
  }
  const mobiliario = ctx.furn.map((f) => ({ tipo: f.tipo, pos: [f.x, f.y] as Vec2, angulo: f.ang }));
  const nObj = final ? 16 : size === 'pequeno' ? 3 + Math.floor(rng() * 3) : size === 'mediano' ? 6 + Math.floor(rng() * 3) : 6 + Math.floor(rng() * 3);
  const obstaculos: P2[][] = [...(mp.muros as P2[][]), ...ctx.furn.map((f) => rectPoly(f.x, f.y, FW(f.tipo), FD(f.tipo), f.ang))];
  const objetos = repartirObjetos(rng, nObj, lay.perim, obstaculos, centrosAb, start, boss);
  void diag;
  const map: MapDef = {
    nombre: `P${floor}-${size}`, tamano: size,
    ancho_m: r3(bb.x1), alto_m: r3(bb.y1),
    perimetro: lay.perim.map((p) => [r3(p[0]), r3(p[1])] as Vec2),
    muros: mp.muros, puertas: mp.puertas, mobiliario, objetos,
    inicio_jugador: start, punto_jefe: boss,
    tema: FLOOR_THEME[floor] as Theme, diafano: false,
  };
  const avisos = validarMapa(map, mp.vanos, rg, false);
  return { map, vanos: mp.vanos, avisos };
}

// ---------------------------------------------------------------------------------------------
// Planta 6: comercial (diáfana)
// ---------------------------------------------------------------------------------------------

function intentoComercial(floor: number, size: Size, intento: number): MapInfo | null {
  const rng = mulberry32(seedDe(floor, size, intento));
  const rg = rangoDe(floor, size);
  const areaT = areaObjetivo(floor, size, rng);
  // planta alargada (distancias largas); en L si es grande o mediana
  const plan: Plan = { skel: 'C', roles: {} };
  const asp = size === 'pequeno' ? 1.7 : 1.9;
  const esL = size !== 'pequeno';
  SKEL.C = esL ? X(0.62, 'o@o', Y(0.5, 'o@o', 'v')) : 'o@o';
  plan.vacio = esL ? 'v' : undefined;
  plan.roles = { o: 'abierta', v: 'void' };
  const W0 = Math.sqrt(areaT * asp), H0 = areaT / W0;
  const lay = buildLayout(plan, W0, H0, areaT, rng, rng() < 0.5, rng() < 0.5, rng() < 0.3);
  if (!lay) return null;
  const perim = lay.perim;
  const area = polyArea(perim);
  if (area < rg.area[0] || area > rg.area[1]) return null;
  const bb = bboxOf(perim);
  const diag = Math.hypot(bb.x1, bb.y1);
  const live = lay.leaves.filter((l) => !l.void);
  const inPer = (x: number, y: number, m: number) => pointInPoly(x, y, perim) &&
    perim.every((a, i) => ptSeg(x, y, a[0], a[1], perim[(i + 1) % perim.length][0], perim[(i + 1) % perim.length][1]) >= m);

  // inicio en una esquina convexa; jefe = punto más lejano con holgura
  const esq = esquinasConvexas(perim);
  const e0 = esq[Math.floor(rng() * esq.length)];
  const start: P2 = [r3(e0.v[0] + e0.dir[0] * 1.4), r3(e0.v[1] + e0.dir[1] * 1.4)];
  let boss: P2 | null = null, bd = -1;
  for (let t = 0; t < 400; t++) {
    const x = rr(rng, bb.x0 + 2, bb.x1 - 2), y = rr(rng, bb.y0 + 2, bb.y1 - 2);
    if (!inPer(x, y, 3)) continue;
    const d = Math.hypot(x - start[0], y - start[1]);
    if (d > bd) { bd = d; boss = [r3(x), r3(y)]; }
  }
  if (!boss) return null;

  // tabiques: tramo-puerta-tramo sueltos, más algún pilar
  const nPart = size === 'pequeno' ? 2 + Math.floor(rng() * 2) : size === 'mediano' ? 5 : 5 + Math.floor(rng() * 2);
  const nPil = size === 'pequeno' ? (nPart === 2 ? 2 : 1) : size === 'mediano' ? 1 + Math.floor(rng() * 3) : 2 + Math.floor(rng() * 3);
  const muros: Vec2[][] = [], puertas: Vec2[][] = [];
  const bloques: Rect[] = [];
  const centros: P2[] = [];
  const libre = (r: Rect, m: number) => bloques.every((b) => !(r.x0 - m < b.x1 && r.x1 + m > b.x0 && r.y0 - m < b.y1 && r.y1 + m > b.y0));
  for (let k = 0, tries = 0; k < nPart && tries < 400; tries++) {
    const horiz = rng() < 0.5;
    const a = rr(rng, 1.8, 3.0), b = rr(rng, 1.8, 3.0);
    const len = a + DOOR_W + b;
    const x = rr(rng, bb.x0 + 3, bb.x1 - 3), y = rr(rng, bb.y0 + 3, bb.y1 - 3);
    const rect: Rect = horiz ? { x0: x - len / 2, x1: x + len / 2, y0: y - T / 2, y1: y + T / 2 } : { x0: x - T / 2, x1: x + T / 2, y0: y - len / 2, y1: y + len / 2 };
    const corners: P2[] = [[rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x0, rect.y1], [rect.x1, rect.y1], [(rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2]];
    if (!corners.every((q) => inPer(q[0], q[1], 1.8))) continue;
    if (!libre(rect, 2.6)) continue;
    if (ptPolyDist(start[0], start[1], rectToPoly(rect)) < 3.5 || ptPolyDist(boss![0], boss![1], rectToPoly(rect)) < 3.5) continue;
    const s0 = r3(horiz ? rect.x0 : rect.y0);
    const g0 = r3(s0 + a), g1 = r3(g0 + DOOR_W), e1 = r3(s0 + len);
    if (horiz) {
      muros.push(mkRectV(s0, rect.y0, g0, rect.y1)); muros.push(mkRectV(g1, rect.y0, e1, rect.y1));
      puertas.push(mkRectV(g0, rect.y0, g1, rect.y1));
      centros.push([(g0 + g1) / 2, y]);
    } else {
      muros.push(mkRectV(rect.x0, s0, rect.x1, g0)); muros.push(mkRectV(rect.x0, g1, rect.x1, e1));
      puertas.push(mkRectV(rect.x0, g0, rect.x1, g1));
      centros.push([x, (g0 + g1) / 2]);
    }
    bloques.push(rect);
    k++;
  }
  if (puertas.length < nPart) return null;
  for (let k = 0, tries = 0; k < nPil && tries < 300; tries++) {
    const s = 0.9;
    const x = rr(rng, bb.x0 + 3, bb.x1 - 3), y = rr(rng, bb.y0 + 3, bb.y1 - 3);
    const rect: Rect = { x0: x - s / 2, x1: x + s / 2, y0: y - s / 2, y1: y + s / 2 };
    if (!inPer(x, y, 2.5) || !libre(rect, 2.4)) continue;
    if (Math.hypot(x - start[0], y - start[1]) < 4 || Math.hypot(x - boss![0], y - boss![1]) < 4) continue;
    muros.push(mkRectV(rect.x0, rect.y0, rect.x1, rect.y1));
    bloques.push(rect); k++;
  }
  const wallPolys: P2[][] = [...muros, ...puertas] as P2[][];
  const facade: P2[][] = perim.map((a, i) => {
    const b = perim[(i + 1) % perim.length];
    return [a, b, [b[0] + 0.001, b[1] + 0.001] as P2, [a[0] + 0.001, a[1] + 0.001] as P2];
  });
  const ctx: Ctx = {
    rng, perim, facade, solid: wallPolys.map((p) => ({ poly: p, bb: bboxOf(p) })), openings: centros,
    excl: [{ x: start[0], y: start[1], r: 2.7 }, { x: boss[0], y: boss[1], r: 2.2 }], furn: [], nextGid: 1,
  };
  // mobiliario: cúmulos repartidos por una cuadrícula con jitter
  const objetivo = Math.round(size === 'pequeno' ? rr(rng, 16, 21) : size === 'mediano' ? rr(rng, 34, 40) : rr(rng, 36, 44));
  for (let t = 0; t < 4000 && ctx.furn.length < objetivo; t++) {
    const x = rr(rng, bb.x0 + 1.5, bb.x1 - 1.5), y = rr(rng, bb.y0 + 1.5, bb.y1 - 1.5);
    if (!inPer(x, y, 1.2)) continue;
    const tipo = Math.floor(rng() * 5);
    if (tipo === 0) put(ctx, [['mesa_con_sillas', x, y, 0], ['sofa', x - 0.665 - 0.02 - 0.295, y, 0], ['sofa', x + 0.665 + 0.02 + 0.295, y, 180]]);
    else if (tipo === 1) put(ctx, [['sofa', x, y, 0], ['sofa', x, y + 1.62, 0], ['sofa', x, y + 3.24, 0], ['maceta', x + 0.5, y - 1.3, 0]]);
    else if (tipo === 2) put(ctx, [['mesa_con_sillas', x, y, Math.round(rr(rng, -25, 25)) || 12], ['mesa_con_sillas', x + 1.35, y, 0]]);
    else if (tipo === 3) put(ctx, [['mesa', x, y, 90], ['mesa', x, y + 0.58, 90], silla(ctx, x - 0.3, y - 0.56), silla(ctx, x + 0.3, y + 1.15)]);
    else put(ctx, [['maceta', x, y, 0], ['maceta', x + 1.3, y + 0.4, 0]]);
  }
  while (ctx.furn.length > rg.mob[1]) {
    const g = ctx.furn[ctx.furn.length - 1].gid;
    while (ctx.furn.length && ctx.furn[ctx.furn.length - 1].gid === g) ctx.furn.pop();
  }
  const mobiliario = ctx.furn.map((f) => ({ tipo: f.tipo, pos: [f.x, f.y] as Vec2, angulo: f.ang }));
  const nObj = size === 'pequeno' ? 3 + Math.floor(rng() * 3) : 6 + Math.floor(rng() * 3);
  const obstaculos: P2[][] = [...(muros as P2[][]), ...ctx.furn.map((f) => rectPoly(f.x, f.y, FW(f.tipo), FD(f.tipo), f.ang))];
  const objetos = repartirObjetos(rng, nObj, perim, obstaculos, centros, start, boss);
  void diag; void live;
  const map: MapDef = {
    nombre: `P${floor}-${size}`, tamano: size, ancho_m: r3(bb.x1), alto_m: r3(bb.y1),
    perimetro: perim.map((p) => [r3(p[0]), r3(p[1])] as Vec2), muros, puertas, mobiliario, objetos,
    inicio_jugador: start, punto_jefe: boss, tema: 'comercial', diafano: true,
  };
  return { map, vanos: [], avisos: validarMapa(map, [], rg, false) };
}

// ---------------------------------------------------------------------------------------------
// Planta 9: azotea
// ---------------------------------------------------------------------------------------------

function intentoAzotea(floor: number, size: Size, intento: number): MapInfo | null {
  const rng = mulberry32(seedDe(floor, size, intento));
  const rg = rangoDe(floor, size);
  const S = size === 'grande' ? 30 : size === 'mediano' ? 25 : 20;
  const perim: P2[] = [[0, 0], [S, 0], [S, S], [0, S]];
  const cx = S / 2, cy = S / 2;
  const R_HELI = 6;
  const muros: Vec2[][] = [];
  const bloques: Rect[] = [];
  // casetones: bloques macizos de 3×3 y tramos en L que no cierran recinto
  const nCas = size === 'pequeno' ? 3 : 4;
  const cuadrantes = shuffle(rng, [[-1, -1], [1, -1], [-1, 1], [1, 1]]).slice(0, nCas);
  cuadrantes.forEach(([sx, sy], idx) => {
    const dist = rr(rng, S * 0.3, S * 0.38);
    const x = cx + sx * dist + rr(rng, -1, 1), y = cy + sy * rr(rng, S * 0.22, S * 0.4);
    if (idx % 2 === 0) {
      const r = { x0: x - 1.5, x1: x + 1.5, y0: y - 1.5, y1: y + 1.5 };
      muros.push(mkRectV(r.x0, r.y0, r.x1, r.y1)); bloques.push(r);
    } else {
      // L: brazo horizontal de 4 m y brazo vertical de 3 m
      const hx = -sx, hy = -sy; // la L abre hacia el centro
      const ax0 = Math.min(x, x + hx * 4), ax1 = Math.max(x, x + hx * 4);
      const ay0 = Math.min(y, y + hy * 3), ay1 = Math.max(y, y + hy * 3);
      muros.push(mkRectV(ax0 - (hx < 0 ? 0 : 0), y - T / 2, ax1, y + T / 2));
      muros.push(mkRectV(x - T / 2, ay0, x + T / 2, ay1));
      bloques.push({ x0: Math.min(ax0, x - T / 2), x1: Math.max(ax1, x + T / 2), y0: Math.min(ay0, y - T / 2), y1: Math.max(ay1, y + T / 2) });
    }
  });
  const wallPolys: P2[][] = muros as P2[][];
  for (const b of bloques) {
    if (ptPolyDist(cx, cy, rectToPoly(b)) < R_HELI + 2.5) return null;
    if (b.x0 < 1.8 || b.y0 < 1.8 || b.x1 > S - 1.8 || b.y1 > S - 1.8) return null;
  }
  const esq = esquinasConvexas(perim);
  const e0 = esq[Math.floor(rng() * esq.length)];
  const start: P2 = [r3(e0.v[0] + e0.dir[0] * 1.6), r3(e0.v[1] + e0.dir[1] * 1.6)];
  const boss: P2 = [cx, cy];
  for (const b of bloques) if (ptPolyDist(start[0], start[1], rectToPoly(b)) < 3.2) return null;
  const facade: P2[][] = perim.map((a, i) => {
    const b = perim[(i + 1) % perim.length];
    return [a, b, [b[0] + 0.001, b[1] + 0.001] as P2, [a[0] + 0.001, a[1] + 0.001] as P2];
  });
  const ctx: Ctx = {
    rng, perim, facade, solid: wallPolys.map((p) => ({ poly: p, bb: bboxOf(p) })), openings: [],
    excl: [{ x: start[0], y: start[1], r: 2.7 }, { x: cx, y: cy, r: R_HELI + 0.5 }], furn: [], nextGid: 1,
  };
  const objetivo = size === 'grande' ? Math.round(rr(rng, 14, 18)) : size === 'mediano' ? 14 : 12;
  for (let t = 0; t < 900 && ctx.furn.length < objetivo; t++) {
    const a = rng() * Math.PI * 2, d = rr(rng, R_HELI + 1.6, S * 0.46);
    const ang = rng() < 0.5 ? [0, 90, 180, -90][Math.floor(rng() * 4)] : Math.round(rr(rng, -40, 40)) || 15;
    put(ctx, [['estanteria', cx + Math.cos(a) * d, cy + Math.sin(a) * d, ang]]);
  }
  const mobiliario = ctx.furn.map((f) => ({ tipo: f.tipo, pos: [f.x, f.y] as Vec2, angulo: f.ang }));
  const nObj = size === 'pequeno' ? 3 + Math.floor(rng() * 3) : 6 + Math.floor(rng() * 3);
  const obstaculos: P2[][] = [...wallPolys, ...ctx.furn.map((f) => rectPoly(f.x, f.y, FW(f.tipo), FD(f.tipo), f.ang))];
  const objetos = repartirObjetos(rng, nObj, perim, obstaculos, [], start, boss);
  const map: MapDef = {
    nombre: `P${floor}-${size}`, tamano: size, ancho_m: S, alto_m: S,
    perimetro: perim.map((p) => [p[0], p[1]] as Vec2), muros, puertas: [], mobiliario, objetos,
    inicio_jugador: start, punto_jefe: boss, tema: 'azotea', diafano: true,
  };
  const av = validarMapa(map, [], rg, true);
  // el helipuerto (6 m de radio) tiene que estar completamente despejado
  for (const f of ctx.furn) if (ptPolyDist(cx, cy, f.poly) < R_HELI) av.push('helipuerto ocupado');
  return { map, vanos: [], avisos: av };
}

// ---------------------------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------------------------

const cache = new Map<string, MapInfo>();

/** Igual que generateMap pero devuelve además los vanos (el JSON de mapa no los distingue de un hueco). */
export function generateMapInfo(floor: number, size: Size): MapInfo {
  const key = floor + '/' + size;
  const hit = cache.get(key);
  if (hit) return JSON.parse(JSON.stringify(hit)) as MapInfo;
  let best: MapInfo | null = null;
  const plan = PLANS[floor]?.[size];
  for (let i = 0; i < 400; i++) {
    let r: MapInfo | null = null;
    if (floor === 9) r = intentoAzotea(floor, size, i);
    else if (floor === 6) r = intentoComercial(floor, size, i);
    else if (plan) r = intentoSalas(floor, size, plan, i);
    else throw new Error(`Planta ${floor} no válida (2..9)`);
    if (!r) continue;
    if (r.avisos.length) for (const a of r.avisos) { const k = 'aviso '+a.replace(/[0-9.]+/g,'#'); fallos[k] = (fallos[k] ?? 0) + 1; }
    if (!best || r.avisos.length < best.avisos.length) best = r;
    if (r.avisos.length === 0) break;
  }
  if (!best) throw new Error(`No se pudo generar el mapa ${floor}/${size}`);
  cache.set(key, best);
  return JSON.parse(JSON.stringify(best)) as MapInfo;
}

export function generateMap(floor: number, size: Size): MapDef {
  return generateMapInfo(floor, size).map;
}
