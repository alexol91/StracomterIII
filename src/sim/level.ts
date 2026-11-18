// Geometría del nivel: obstáculos, rayos (visión y balas), colisión y rejilla de navegación.
//
// Regla de la casa: ante la duda, la respuesta es la RESTRICTIVA. Un rayo que no se puede
// evaluar (NaN, fuera del mapa) está bloqueado; una celda dudosa no es transitable.

import type { ILevel } from '../contracts';
import { DOOR_HEIGHT, FLOOR_THEME, FURNITURE, WALL_HEIGHT } from './data';
import type { Door, FurnitureInst, MapDef, Theme, Vec2, WallRect } from './types';

export const CELL = 0.25;
/** Radio con el que se inflan los obstáculos en la rejilla y con el que colisionan los cuerpos contra lo estático. */
export const NAV_RADIUS = 0.32;
const PERIM_THICK = 0.24;

export const enum OT { Wall = 0, Perim = 1, Door = 2, Furn = 3 }

export interface Obst {
  type: OT;
  px: number[]; py: number[]; // polígono convexo en sentido antihorario
  minx: number; miny: number; maxx: number; maxy: number;
  /** altura hasta la que para balas / tapa la vista. Infinity = muro. */
  bulletH: number;
  sightH: number;
  blocksMove: boolean;
  /** índice de puerta o de mueble; -1 si no aplica */
  ref: number;
}

export interface CoverPoint { x: number; y: number; high: boolean; taken: number /* id de quien lo ocupa o -1 */ }

function mkObst(type: OT, pts: Vec2[], bulletH: number, sightH: number, ref: number): Obst {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const p = area < 0 ? pts.slice().reverse() : pts;
  const px = p.map(v => v[0]), py = p.map(v => v[1]);
  return {
    type, px, py, bulletH, sightH, blocksMove: true, ref,
    minx: Math.min(...px), miny: Math.min(...py), maxx: Math.max(...px), maxy: Math.max(...py),
  };
}

/** Recorta el segmento contra un polígono convexo. Devuelve [tEntrada, tSalida] o null. */
function clipSeg(o: Obst, x0: number, y0: number, dx: number, dy: number, out: [number, number]): boolean {
  let te = 0, tx = 1;
  const n = o.px.length;
  for (let i = 0; i < n; i++) {
    const ax = o.px[i], ay = o.py[i];
    const ex = o.px[(i + 1) % n] - ax, ey = o.py[(i + 1) % n] - ay;
    const N = ex * (y0 - ay) - ey * (x0 - ax);
    const D = ex * dy - ey * dx;
    if (D === 0) { if (N < 0) return false; continue; }
    const t = -N / D;
    if (D > 0) { if (t > te) te = t; } else { if (t < tx) tx = t; }
    if (te > tx) return false;
  }
  out[0] = te; out[1] = tx;
  return true;
}

function pointInPoly(px: number[], py: number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = px.length - 1; i < px.length; j = i++) {
    if ((py[i] > y) !== (py[j] > y) && x < ((px[j] - px[i]) * (y - py[i])) / (py[j] - py[i]) + px[i]) inside = !inside;
  }
  return inside;
}

/** Punto del polígono convexo más cercano a (x,y). Devuelve distancia con signo (<0 dentro). */
function closestOnObst(o: Obst, x: number, y: number, out: Vec2): number {
  const n = o.px.length;
  let best = Infinity, inside = true;
  for (let i = 0; i < n; i++) {
    const ax = o.px[i], ay = o.py[i], bx = o.px[(i + 1) % n], by = o.py[(i + 1) % n];
    const ex = bx - ax, ey = by - ay;
    if (ex * (y - ay) - ey * (x - ax) < 0) inside = false;
    const l2 = ex * ex + ey * ey;
    let t = l2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + ex * t, cy = ay + ey * t;
    const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    if (d < best) { best = d; out[0] = cx; out[1] = cy; }
  }
  const d = Math.sqrt(best);
  return inside ? -d : d;
}

const _clip: [number, number] = [0, 0];
const _cp: Vec2 = [0, 0];

export class Level implements ILevel {
  map: MapDef;
  theme: Theme;
  walls: WallRect[] = [];
  perimeterSegs: [number, number, number, number][] = [];
  doors: Door[] = [];
  furniture: FurnitureInst[] = [];
  version = 0;

  obst: Obst[] = [];
  private doorObst: Obst[] = [];
  private perimX: number[]; private perimY: number[];

  // rejilla
  ox = 0; oy = 0; gw = 0; gh = 0;
  /** 1 = transitable (ignorando puertas) */
  walk: Uint8Array = new Uint8Array(0);
  /** id de puerta + 1 si la celda pertenece al paso de una puerta */
  doorCell: Uint8Array = new Uint8Array(0);
  cover: CoverPoint[] = [];
  /** superficie transitable aproximada, m² */
  area = 0;

  constructor(map: MapDef, floor = 1) {
    this.map = map;
    this.theme = map.tema ?? FLOOR_THEME[floor] ?? 'recepcion';
    this.perimX = map.perimetro.map(p => p[0]);
    this.perimY = map.perimetro.map(p => p[1]);
    const P = map.perimetro;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      this.perimeterSegs.push([a[0], a[1], b[0], b[1]]);
    }
    for (const m of map.muros) {
      const xs = m.map(p => p[0]), ys = m.map(p => p[1]);
      this.walls.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), perimeter: false });
    }
    map.puertas.forEach((m, id) => {
      const xs = m.map(p => p[0]), ys = m.map(p => p[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
      this.doors.push({ id, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, vertical: y1 - y0 > x1 - x0, open: false, anim: 0 });
    });
    for (const f of map.mobiliario) {
      const s = FURNITURE[f.tipo];
      if (!s) continue;
      this.furniture.push({ type: f.tipo, x: f.pos[0], y: f.pos[1], angle: (f.angulo * Math.PI) / 180, hw: s.w / 2, hd: s.d / 2, height: s.height });
    }
    this.rebuild();
  }

  /** Reconstruye obstáculos, rejilla y puntos de cobertura. Llamar tras cambiar muros. */
  rebuild(): void {
    this.obst = [];
    this.doorObst = [];
    for (const s of this.perimeterSegs) {
      const dx = s[2] - s[0], dy = s[3] - s[1];
      const l = Math.hypot(dx, dy) || 1;
      const nx = (-dy / l) * PERIM_THICK / 2, ny = (dx / l) * PERIM_THICK / 2;
      const ex = (dx / l) * PERIM_THICK / 2, ey = (dy / l) * PERIM_THICK / 2;
      this.obst.push(mkObst(OT.Perim, [
        [s[0] - ex + nx, s[1] - ey + ny], [s[2] + ex + nx, s[3] + ey + ny],
        [s[2] + ex - nx, s[3] + ey - ny], [s[0] - ex - nx, s[1] - ey - ny]], Infinity, Infinity, -1));
    }
    for (const w of this.walls) {
      this.obst.push(mkObst(OT.Wall, [[w.x0, w.y0], [w.x1, w.y0], [w.x1, w.y1], [w.x0, w.y1]], Infinity, Infinity, -1));
    }
    for (const d of this.doors) {
      const o = mkObst(OT.Door, [[d.x0, d.y0], [d.x1, d.y0], [d.x1, d.y1], [d.x0, d.y1]], Infinity, Infinity, d.id);
      this.doorObst[d.id] = o;
      this.obst.push(o);
    }
    this.furniture.forEach((f, i) => {
      const s = FURNITURE[f.type];
      const c = Math.cos(f.angle), sn = Math.sin(f.angle);
      const pts: Vec2[] = [[-f.hw, -f.hd], [f.hw, -f.hd], [f.hw, f.hd], [-f.hw, f.hd]].map(
        ([lx, ly]) => [f.x + lx * c - ly * sn, f.y + lx * sn + ly * c] as Vec2);
      this.obst.push(mkObst(OT.Furn, pts, s.bulletH, s.sightH, i));
    });
    this.buildGrid();
    this.buildCover();
    this.version++;
  }

  inside(x: number, y: number): boolean {
    return pointInPoly(this.perimX, this.perimY, x, y);
  }

  // ───────────── rayos ─────────────

  /**
   * Rayo 3D de (x0,y0,z0) a (x1,y1,z1). Devuelve la fracción t∈[0,1] del primer bloqueo, o 1 si llega.
   * mode 'sight': tapa lo que tapa la vista (muros, puertas cerradas, estanterías, macetas…).
   * mode 'bullet': para lo que para balas (una maceta o una silla NO).
   */
  ray(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mode: 'sight' | 'bullet'): number {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    if (!(dx === dx && dy === dy && dz === dz)) return 0; // NaN: bloqueado
    const minx = Math.min(x0, x1), maxx = Math.max(x0, x1), miny = Math.min(y0, y1), maxy = Math.max(y0, y1);
    let best = 1;
    const obst = this.obst;
    for (let i = 0; i < obst.length; i++) {
      const o = obst[i];
      if (o.maxx < minx || o.minx > maxx || o.maxy < miny || o.miny > maxy) continue;
      const H = mode === 'sight' ? o.sightH : o.bulletH;
      if (H <= 0) continue;
      if (o.type === OT.Door && this.doors[o.ref].open) continue;
      if (!clipSeg(o, x0, y0, dx, dy, _clip)) continue;
      const te = _clip[0], tx = _clip[1];
      if (te >= best) continue;
      let t: number;
      if (H === Infinity) t = te;
      else {
        const ze = z0 + dz * te, zx = z0 + dz * tx;
        if (ze < H) t = te;
        else if (zx < H) t = dz !== 0 ? (H - z0) / dz : te; // el rayo baja y entra por arriba
        else continue;
      }
      if (t < best) best = t;
    }
    // suelo
    if (z1 < 0 && dz < 0) { const tf = -z0 / dz; if (tf < best) best = tf; }
    return best;
  }

  /**
   * v1.2 — Igual que `ray` (misma t, mismas reglas) pero además dice qué ha parado el rayo y la normal aproximada
   * en planta de la cara golpeada (unidad, apuntando hacia el origen del rayo). `ray` no se toca.
   */
  rayInfo(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mode: 'sight' | 'bullet'):
    { t: number; surface: 'wall' | 'door' | 'furniture' | 'floor' | 'none'; nx: number; ny: number } {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const dl = Math.hypot(dx, dy) || 1;
    const back = { nx: -dx / dl, ny: -dy / dl };
    if (!(dx === dx && dy === dy && dz === dz)) return { t: 0, surface: 'wall', ...back };
    const minx = Math.min(x0, x1), maxx = Math.max(x0, x1), miny = Math.min(y0, y1), maxy = Math.max(y0, y1);
    let best = 1;
    let bo: Obst | null = null, bFace = -1, bTop = false;
    const obst = this.obst;
    for (let i = 0; i < obst.length; i++) {
      const o = obst[i];
      if (o.maxx < minx || o.minx > maxx || o.maxy < miny || o.miny > maxy) continue;
      const H = mode === 'sight' ? o.sightH : o.bulletH;
      if (H <= 0) continue;
      if (o.type === OT.Door && this.doors[o.ref].open) continue;
      // recorte propio para saber por qué cara entra el rayo
      let te = 0, tx = 1, face = -1, ok = true;
      const n = o.px.length;
      for (let k = 0; k < n; k++) {
        const ax = o.px[k], ay = o.py[k];
        const ex = o.px[(k + 1) % n] - ax, ey = o.py[(k + 1) % n] - ay;
        const N = ex * (y0 - ay) - ey * (x0 - ax);
        const D = ex * dy - ey * dx;
        if (D === 0) { if (N < 0) { ok = false; break; } continue; }
        const t = -N / D;
        if (D > 0) { if (t > te) { te = t; face = k; } } else { if (t < tx) tx = t; }
        if (te > tx) { ok = false; break; }
      }
      if (!ok || te >= best) continue;
      let t: number, top = false;
      if (H === Infinity) t = te;
      else {
        const ze = z0 + dz * te, zx = z0 + dz * tx;
        if (ze < H) t = te;
        else if (zx < H) { t = dz !== 0 ? (H - z0) / dz : te; top = true; }
        else continue;
      }
      if (t < best) { best = t; bo = o; bFace = face; bTop = top; }
    }
    let surface: 'wall' | 'door' | 'furniture' | 'floor' | 'none' = 'none';
    let nx = back.nx, ny = back.ny;
    if (bo) {
      surface = bo.type === OT.Door ? 'door' : bo.type === OT.Furn ? 'furniture' : 'wall';
      if (bFace >= 0 && !bTop) {
        const n = bo.px.length;
        const ax = bo.px[bFace], ay = bo.py[bFace];
        const ex = bo.px[(bFace + 1) % n] - ax, ey = bo.py[(bFace + 1) % n] - ay;
        const l = Math.hypot(ex, ey) || 1;
        let fx = ey / l, fy = -ex / l; // normal exterior de un polígono antihorario
        if (fx * back.nx + fy * back.ny < 0) { fx = -fx; fy = -fy; }
        nx = fx; ny = fy;
      }
    }
    // suelo
    if (z1 < 0 && dz < 0) { const tf = -z0 / dz; if (tf < best) { best = tf; surface = 'floor'; nx = back.nx; ny = back.ny; } }
    return { t: best, surface, nx, ny };
  }

  /** ¿Hay línea limpia? Por defecto NO (restrictivo) si algo no cuadra. */
  clear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mode: 'sight' | 'bullet'): boolean {
    return this.ray(x0, y0, z0, x1, y1, z1, mode) >= 0.9999;
  }

  // ───────────── colisión de cuerpos ─────────────

  /** Empuja el círculo fuera de lo estático. Devuelve la posición corregida en `out`. */
  resolve(x: number, y: number, r: number, out: Vec2): void {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (let i = 0; i < this.obst.length; i++) {
        const o = this.obst[i];
        if (x + r < o.minx || x - r > o.maxx || y + r < o.miny || y - r > o.maxy) continue;
        if (o.type === OT.Door && this.doors[o.ref].open) continue;
        const d = closestOnObst(o, x, y, _cp);
        if (d >= r) continue;
        let nx = x - _cp[0], ny = y - _cp[1];
        const l = Math.hypot(nx, ny);
        if (d < 0) {
          // dentro: salir por el borde más cercano
          if (l > 1e-6) { x = _cp[0] - (nx / l) * r; y = _cp[1] - (ny / l) * r; }
          else { x += r; }
        } else if (l > 1e-6) {
          nx /= l; ny /= l;
          x = _cp[0] + nx * r; y = _cp[1] + ny * r;
        }
        moved = true;
      }
      if (!moved) break;
    }
    out[0] = x; out[1] = y;
  }

  // ───────────── puertas y boquetes ─────────────

  setDoor(id: number, open: boolean): void {
    const d = this.doors[id];
    if (d) d.open = open;
  }

  /** Puerta más cercana a (x,y) dentro de `maxDist` (distancia al rectángulo), o -1. */
  nearestDoor(x: number, y: number, maxDist: number): number {
    let best = -1, bd = maxDist;
    for (const d of this.doors) {
      const cx = Math.max(d.x0, Math.min(x, d.x1)), cy = Math.max(d.y0, Math.min(y, d.y1));
      const dist = Math.hypot(x - cx, y - cy);
      if (dist < bd) { bd = dist; best = d.id; }
    }
    return best;
  }

  /**
   * Abre un boquete de `width` metros en el muro interior que corte el segmento. Devuelve el punto o null.
   * La fachada no se puede abrir.
   */
  breach(x0: number, y0: number, x1: number, y1: number, width: number): Vec2 | null {
    let best = 1.0001, bi = -1;
    const dx = x1 - x0, dy = y1 - y0;
    this.walls.forEach((w, i) => {
      const o = mkObst(OT.Wall, [[w.x0, w.y0], [w.x1, w.y0], [w.x1, w.y1], [w.x0, w.y1]], Infinity, Infinity, -1);
      if (clipSeg(o, x0, y0, dx, dy, _clip) && _clip[0] < best) { best = _clip[0]; bi = i; }
    });
    if (bi < 0) return null;
    // algo sólido antes del muro (fachada, otra puerta): no
    const w = this.walls[bi];
    const hx = x0 + dx * best, hy = y0 + dy * best;
    const horiz = w.x1 - w.x0 >= w.y1 - w.y0;
    const pieces: WallRect[] = [];
    if (horiz) {
      const c = Math.max(w.x0 + width / 2, Math.min(hx, w.x1 - width / 2));
      if (w.x1 - w.x0 <= width + 0.4) { /* se cae entero */ }
      else {
        if (c - width / 2 - w.x0 > 0.25) pieces.push({ ...w, x1: c - width / 2 });
        if (w.x1 - (c + width / 2) > 0.25) pieces.push({ ...w, x0: c + width / 2 });
      }
    } else {
      const c = Math.max(w.y0 + width / 2, Math.min(hy, w.y1 - width / 2));
      if (w.y1 - w.y0 <= width + 0.4) { /* se cae entero */ }
      else {
        if (c - width / 2 - w.y0 > 0.25) pieces.push({ ...w, y1: c - width / 2 });
        if (w.y1 - (c + width / 2) > 0.25) pieces.push({ ...w, y0: c + width / 2 });
      }
    }
    this.walls.splice(bi, 1, ...pieces);
    this.rebuild();
    return [hx, hy];
  }

  // ───────────── rejilla ─────────────

  cellOf(x: number, y: number): number {
    const cx = Math.floor((x - this.ox) / CELL), cy = Math.floor((y - this.oy) / CELL);
    if (cx < 0 || cy < 0 || cx >= this.gw || cy >= this.gh) return -1;
    return cy * this.gw + cx;
  }
  cellX(i: number): number { return this.ox + ((i % this.gw) + 0.5) * CELL; }
  cellY(i: number): number { return this.oy + (Math.floor(i / this.gw) + 0.5) * CELL; }

  /** ¿Se puede estar en la celda? doors=true: las puertas cerradas cuentan como paso (quien pasa las abre). */
  passable(i: number, doors: boolean): boolean {
    if (i < 0 || !this.walk[i]) return false;
    const d = this.doorCell[i];
    if (d === 0 || doors) return true;
    return this.doors[d - 1].open;
  }
  walkableAt(x: number, y: number, doors = true): boolean {
    return this.passable(this.cellOf(x, y), doors);
  }

  private buildGrid(): void {
    const minx = Math.min(...this.perimX), maxx = Math.max(...this.perimX);
    const miny = Math.min(...this.perimY), maxy = Math.max(...this.perimY);
    this.ox = minx - CELL; this.oy = miny - CELL;
    this.gw = Math.ceil((maxx - minx) / CELL) + 2;
    this.gh = Math.ceil((maxy - miny) / CELL) + 2;
    const n = this.gw * this.gh;
    this.walk = new Uint8Array(n);
    this.doorCell = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      this.walk[i] = this.inside(this.cellX(i), this.cellY(i)) ? 1 : 0;
    }
    const mark = (o: Obst, isDoor: boolean) => {
      const r = NAV_RADIUS;
      const cx0 = Math.max(0, Math.floor((o.minx - r - this.ox) / CELL)), cx1 = Math.min(this.gw - 1, Math.floor((o.maxx + r - this.ox) / CELL));
      const cy0 = Math.max(0, Math.floor((o.miny - r - this.oy) / CELL)), cy1 = Math.min(this.gh - 1, Math.floor((o.maxy + r - this.oy) / CELL));
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const i = cy * this.gw + cx;
        const d = closestOnObst(o, this.ox + (cx + 0.5) * CELL, this.oy + (cy + 0.5) * CELL, _cp);
        if (d < r) { if (isDoor) this.doorCell[i] = o.ref + 1; else this.walk[i] = 0; }
      }
    };
    for (const o of this.obst) if (o.type === OT.Door) mark(o, true);
    for (const o of this.obst) if (o.type !== OT.Door) mark(o, false);
    let a = 0;
    for (let i = 0; i < n; i++) { if (!this.walk[i]) this.doorCell[i] = 0; else a++; }
    this.area = a * CELL * CELL;
  }

  /** Celda transitable más cercana a (x,y) (búsqueda en espiral). -1 si no hay. */
  nearestFree(x: number, y: number, doors = true, maxR = 12): number {
    const c = this.cellOf(x, y);
    if (this.passable(c, doors)) return c;
    const cx = Math.floor((x - this.ox) / CELL), cy = Math.floor((y - this.oy) / CELL);
    for (let r = 1; r <= maxR; r++) {
      let best = -1, bd = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const X = cx + dx, Y = cy + dy;
        if (X < 0 || Y < 0 || X >= this.gw || Y >= this.gh) continue;
        const i = Y * this.gw + X;
        if (!this.passable(i, doors)) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** ¿El segmento recto es transitable entero? (para alisar caminos) */
  walkLine(x0: number, y0: number, x1: number, y1: number, doors: boolean): boolean {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(d / (CELL * 0.5)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (!this.passable(this.cellOf(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t), doors)) return false;
    }
    return true;
  }

  // ───────────── cobertura ─────────────

  private buildCover(): void {
    const pts: CoverPoint[] = [];
    const add = (x: number, y: number, high: boolean) => {
      if (!this.walkableAt(x, y, false) || this.doorCell[this.cellOf(x, y)]) return;
      for (const p of pts) if (Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5) return;
      pts.push({ x, y, high, taken: -1 });
    };
    for (const f of this.furniture) {
      const s = FURNITURE[f.type];
      if (s.cover === 'none') continue;
      const c = Math.cos(f.angle), sn = Math.sin(f.angle);
      const off = 0.6;
      const loc: Vec2[] = [[f.hw + off, 0], [-f.hw - off, 0], [0, f.hd + off], [0, -f.hd - off]];
      for (const [lx, ly] of loc) add(f.x + lx * c - ly * sn, f.y + lx * sn + ly * c, s.cover === 'high');
    }
    for (const w of this.walls) {
      const horiz = w.x1 - w.x0 >= w.y1 - w.y0;
      const off = 0.62;
      if (horiz) {
        const my0 = w.y0 - off, my1 = w.y1 + off;
        for (const ex of [w.x0 + 0.35, w.x1 - 0.35]) { add(ex, my0, true); add(ex, my1, true); }
      } else {
        const mx0 = w.x0 - off, mx1 = w.x1 + off;
        for (const ey of [w.y0 + 0.35, w.y1 - 0.35]) { add(mx0, ey, true); add(mx1, ey, true); }
      }
    }
    this.cover = pts;
  }
}

export function buildLevel(map: MapDef, floor = 1): Level {
  return new Level(map, floor);
}

export { DOOR_HEIGHT, WALL_HEIGHT };
