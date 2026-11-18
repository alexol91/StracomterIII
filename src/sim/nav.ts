// Búsqueda de caminos sobre la rejilla del nivel.

import { CELL, Level } from './level';
import type { Vec2 } from './types';

const SQ2 = Math.SQRT2;
const NB_DX = [1, -1, 0, 0, 1, 1, -1, -1];
const NB_DY = [0, 0, 1, -1, 1, -1, 1, -1];
/** Coste extra (en metros) de cruzar una puerta cerrada: hay que pararse a abrirla. */
export const CLOSED_DOOR_COST = 3;

class Heap {
  idx: Int32Array; key: Float32Array; n = 0;
  constructor(cap: number) { this.idx = new Int32Array(cap); this.key = new Float32Array(cap); }
  clear(): void { this.n = 0; }
  push(i: number, k: number): void {
    if (this.n >= this.idx.length) {
      const ni = new Int32Array(this.idx.length * 2); ni.set(this.idx); this.idx = ni;
      const nk = new Float32Array(this.key.length * 2); nk.set(this.key); this.key = nk;
    }
    let c = this.n++;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.key[p] <= k) break;
      this.idx[c] = this.idx[p]; this.key[c] = this.key[p]; c = p;
    }
    this.idx[c] = i; this.key[c] = k;
  }
  pop(): number {
    const top = this.idx[0];
    const li = this.idx[--this.n], lk = this.key[this.n];
    let c = 0;
    for (;;) {
      let ch = 2 * c + 1;
      if (ch >= this.n) break;
      if (ch + 1 < this.n && this.key[ch + 1] < this.key[ch]) ch++;
      if (this.key[ch] >= lk) break;
      this.idx[c] = this.idx[ch]; this.key[c] = this.key[ch]; c = ch;
    }
    this.idx[c] = li; this.key[c] = lk;
    return top;
  }
}

export interface PathOpts {
  /** true: puede cruzar puertas cerradas (las abrirá). false: una puerta cerrada corta el camino. */
  doors: boolean;
  /** coste extra por celda (metros), p. ej. celdas a la vista del jugador para flanquear */
  penalty?: Float32Array | null;
  maxNodes?: number;
}

export class Nav {
  private g: Float32Array = new Float32Array(0);
  private from: Int32Array = new Int32Array(0);
  private stamp: Uint32Array = new Uint32Array(0);
  private closed: Uint32Array = new Uint32Array(0);
  private cur = 0;
  private heap = new Heap(4096);
  private n = 0;

  constructor(public level: Level) { this.ensure(); }

  private ensure(): void {
    const n = this.level.gw * this.level.gh;
    if (n !== this.n) {
      this.n = n;
      this.g = new Float32Array(n); this.from = new Int32Array(n);
      this.stamp = new Uint32Array(n); this.closed = new Uint32Array(n);
      this.cur = 0;
    }
  }

  private stepCost(L: Level, i: number, doors: boolean): number {
    const d = L.doorCell[i];
    if (d && doors && !L.doors[d - 1].open) return CLOSED_DOOR_COST / 3; // ~3 celdas de grosor
    return 0;
  }

  /** Camino alisado de (sx,sy) a (tx,ty), sin incluir el origen. null si no hay. */
  path(sx: number, sy: number, tx: number, ty: number, opts: PathOpts): Vec2[] | null {
    this.ensure();
    const L = this.level, gw = L.gw;
    const s = L.nearestFree(sx, sy, opts.doors), t = L.nearestFree(tx, ty, opts.doors);
    if (s < 0 || t < 0) return null;
    if (s === t) return [[tx, ty]];
    const tcx = t % gw, tcy = (t / gw) | 0;
    const cur = ++this.cur;
    const heap = this.heap; heap.clear();
    const pen = opts.penalty ?? null;
    this.g[s] = 0; this.from[s] = -1; this.stamp[s] = cur;
    heap.push(s, 0);
    let nodes = 0;
    const maxNodes = opts.maxNodes ?? 60000;
    let found = false;
    while (heap.n > 0) {
      const c = heap.pop();
      if (this.closed[c] === cur) continue;
      this.closed[c] = cur;
      if (c === t) { found = true; break; }
      if (++nodes > maxNodes) break;
      const cx = c % gw, cy = (c / gw) | 0;
      const gc = this.g[c];
      for (let k = 0; k < 8; k++) {
        const nx = cx + NB_DX[k], ny = cy + NB_DY[k];
        if (nx < 0 || ny < 0 || nx >= gw || ny >= L.gh) continue;
        const ni = ny * gw + nx;
        if (this.closed[ni] === cur || !L.passable(ni, opts.doors)) continue;
        if (k >= 4) { // sin atajar esquinas
          if (!L.passable(cy * gw + nx, opts.doors) || !L.passable(ny * gw + cx, opts.doors)) continue;
        }
        let ng = gc + (k >= 4 ? SQ2 : 1) * CELL + this.stepCost(L, ni, opts.doors);
        if (pen) ng += pen[ni];
        if (this.stamp[ni] !== cur || ng < this.g[ni]) {
          this.g[ni] = ng; this.from[ni] = c; this.stamp[ni] = cur;
          const hx = Math.abs(nx - tcx), hy = Math.abs(ny - tcy);
          const h = (Math.max(hx, hy) + (SQ2 - 1) * Math.min(hx, hy)) * CELL;
          heap.push(ni, ng + h);
        }
      }
    }
    if (!found) return null;
    const raw: Vec2[] = [];
    for (let c = t; c !== -1 && c !== s; c = this.from[c]) raw.push([L.cellX(c), L.cellY(c)]);
    raw.reverse();
    if (L.walkableAt(tx, ty, opts.doors)) raw.push([tx, ty]);
    // alisado: quita puntos intermedios mientras haya paso recto. Con penalización no se alisa a lo bruto
    // (el alisado devolvería el camino a la zona penalizada): se alisa en tramos cortos.
    const out: Vec2[] = [];
    let ax = sx, ay = sy, i = 0;
    const look = pen ? 6 : 40;
    while (i < raw.length) {
      let j = Math.min(raw.length - 1, i + look);
      while (j > i && !L.walkLine(ax, ay, raw[j][0], raw[j][1], opts.doors)) j--;
      out.push(raw[j]);
      ax = raw[j][0]; ay = raw[j][1];
      i = j + 1;
    }
    return out;
  }

  /**
   * Campo de distancias andando desde (sx,sy). Infinity = inalcanzable.
   * doors=true: las puertas cerradas se cruzan con un coste extra `doorCost` (m).
   */
  field(sx: number, sy: number, doors: boolean, doorCost: number, maxDist = Infinity, out?: Float32Array): Float32Array {
    this.ensure();
    const L = this.level, gw = L.gw, n = this.n;
    const dist = out && out.length === n ? out : new Float32Array(n);
    dist.fill(Infinity);
    const s = L.nearestFree(sx, sy, doors);
    if (s < 0) return dist;
    const heap = this.heap; heap.clear();
    dist[s] = 0; heap.push(s, 0);
    const perCell = doorCost / 3;
    while (heap.n > 0) {
      const k0 = heap.key[0];
      const c = heap.pop();
      if (k0 > dist[c] + 1e-4) continue;
      if (k0 > maxDist) break;
      const cx = c % gw, cy = (c / gw) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + NB_DX[k], ny = cy + NB_DY[k];
        if (nx < 0 || ny < 0 || nx >= gw || ny >= L.gh) continue;
        const ni = ny * gw + nx;
        if (!L.passable(ni, doors)) continue;
        if (k >= 4 && (!L.passable(cy * gw + nx, doors) || !L.passable(ny * gw + cx, doors))) continue;
        let nd = k0 + (k >= 4 ? SQ2 : 1) * CELL;
        const d = L.doorCell[ni];
        if (d && !L.doors[d - 1].open) nd += perCell;
        if (nd < dist[ni]) { dist[ni] = nd; heap.push(ni, nd); }
      }
    }
    return dist;
  }

  /**
   * Mapa de penalización: celdas que se ven desde (tx,ty) a la altura de los ojos cuestan `cost` m extra.
   * Se muestrea a 0,5 m. Sirve para buscar rutas de flanqueo que no pasen por delante del objetivo.
   */
  exposure(tx: number, ty: number, range: number, cost: number): Float32Array {
    this.ensure();
    const L = this.level, gw = L.gw, gh = L.gh;
    const pen = new Float32Array(this.n);
    const r2 = range * range;
    for (let cy = 0; cy < gh; cy += 2) for (let cx = 0; cx < gw; cx += 2) {
      const i = cy * gw + cx;
      const x = L.ox + (cx + 1) * CELL, y = L.oy + (cy + 1) * CELL;
      const d2 = (x - tx) * (x - tx) + (y - ty) * (y - ty);
      if (d2 > r2) continue;
      if (!L.walk[i] && !(cx + 1 < gw && L.walk[i + 1])) continue;
      if (L.clear(tx, ty, 1.5, x, y, 1.2, 'sight')) {
        // cuanto más cerca del objetivo, más caro
        const c = cost * (1 + 6 / (1 + Math.sqrt(d2)));
        pen[i] = c;
        if (cx + 1 < gw) pen[i + 1] = c;
        if (cy + 1 < gh) { pen[i + gw] = c; if (cx + 1 < gw) pen[i + gw + 1] = c; }
      }
    }
    return pen;
  }
}

export function pathLength(x: number, y: number, p: Vec2[]): number {
  let d = 0, ax = x, ay = y;
  for (const q of p) { d += Math.hypot(q[0] - ax, q[1] - ay); ax = q[0]; ay = q[1]; }
  return d;
}
