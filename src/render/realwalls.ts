// Muros, puertas y fachada del estilo realista: oficina corporativa moderna en blanco, antracita
// (RAL 7016 ≈ #383e42) y cristal. Todo por código, con geometría fusionada (muros, marcos, pilares,
// carpintería) o instanciada (hojas de puerta, que se animan con door.anim).

import * as THREE from 'three';
import type { ILevel } from '../contracts';
import type { Door, Theme } from '../sim/types';
import { DOOR_HEIGHT, WALL_HEIGHT } from '../sim/data';
import { GeoBuilder, Owned } from './geo';
import { aoQuad, wallBox } from './levelMesh';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ───────────────────────── Constantes de ajuste ─────────────────────────

export const REAL_COLORS = {
  white: 0xf3f2ee,        // pared: blanco roto limpio
  anthracite: 0x383e42,   // RAL 7016: zócalos, marcos, hojas, carpintería
  steel: 0xb4b9bf,        // acero cepillado: tiradores y umbral
  glassFacade: 0x8fc4ea,  // cristal de fachada, ligeramente azulado
  glassDoor: 0x0b1014,    // vidrio de la hoja: oscuro
  parapet: 0xdcdcdc,      // peto de la azotea
};
export const REAL_DIMS = {
  baseboard: 0.10,        // zócalo antracita
  baseboardOver: 0.012,   // cuánto sobresale del muro
  capH: 0.03,             // cantonera superior
  accentH: 0.025, accentY: 1.1, accentMinLen: 3.0, accentChance: 0.5,   // línea de acento en paños largos
  endPillar: 0.45,        // pilar de extremo libre de tabique (planta cuadrada)
  doorJamb: 0.065,        // ancho de jamba y cabecero del marco
  doorFrameOver: 0.015,   // el marco sobresale del muro por cada cara
  leafThick: 0.04, leafGap: 0.003, leafBottom: 0.014, leafTop: 2.03,
  glassW: 0.18, glassH: 1.2, glassY0: 0.7,                 // vidrio vertical de la hoja
  handleLen: 0.6, handleR: 0.012, handleY: 1.05, handleFromEdge: 0.09, handleStandoff: 0.032,
  threshold: 0.012,       // umbral metálico
  pillar: 0.5,            // pilar de fachada (sección cuadrada, centrado en la línea de fachada: 0,25 m hacia dentro)
  pillarEvery: 4.5,       // ritmo de pilares (m)
  mullionEvery: 1.35,     // montantes de carpintería (m)
  mullion: [0.05, 0.07],  // sección del montante (a lo largo, fondo)
  sillH: 0.35,            // antepecho antracita
  transomY: 1.0,
  parapetH: 1.1, parapetThick: 0.3,
};

const D = REAL_DIMS, C = REAL_COLORS;

export interface RealWallGeos {
  main: THREE.BufferGeometry | null;
  glass: THREE.BufferGeometry | null;
  metal: THREE.BufferGeometry | null;
  ao: THREE.BufferGeometry | null;
}

function rnd(i: number): number { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

function segDist(px: number, pz: number, x0: number, z0: number, x1: number, z1: number): number {
  const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz;
  const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / l2)) : 0;
  return Math.hypot(px - (x0 + dx * t), pz - (z0 + dz * t));
}

/** ¿Hay algo (otro muro, una puerta o la fachada) tocando el punto P? Si no, es un extremo libre. */
function touched(level: ILevel, px: number, py: number, self: object): boolean {
  const m = 0.12;
  for (const w of level.walls) {
    if (w === self) continue;
    if (px > w.x0 - m && px < w.x1 + m && py > w.y0 - m && py < w.y1 + m) return true;
  }
  for (const d of level.doors) if (px > d.x0 - m && px < d.x1 + m && py > d.y0 - m && py < d.y1 + m) return true;
  for (const [x0, y0, x1, y1] of level.perimeterSegs) if (segDist(px, py, x0, y0, x1, y1) < 0.25) return true;
  return false;
}

export function buildRealWalls(level: ILevel, theme: Theme, accent: number, wallColor: number): RealWallGeos {
  const main: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const metal: THREE.BufferGeometry[] = [];
  const ao: number[] = [];
  const H = WALL_HEIGHT;
  const hasSegs = level.perimeterSegs.length > 0;
  const roof = theme === 'azotea';

  // ── tabiques interiores
  for (const w of level.walls) {
    if (w.perimeter && hasSegs) continue;
    const sx = w.x1 - w.x0, sz = w.y1 - w.y0;
    if (sx <= 0 || sz <= 0) continue;
    const cx = (w.x0 + w.x1) / 2, cz = (w.y0 + w.y1) / 2;
    const o = D.baseboardOver * 2;
    main.push(wallBox(cx, cz, sx, sz, 0, 0, H, wallColor, wallColor, true, true));
    main.push(wallBox(cx, cz, sx + o, sz + o, 0, 0, D.baseboard, C.anthracite, C.anthracite, false));
    main.push(wallBox(cx, cz, sx + o, sz + o, 0, H - D.capH, H, C.anthracite, C.anthracite, false));
    const long = Math.max(sx, sz);
    if (!roof && long >= D.accentMinLen && rnd(w.x0 * 7.1 + w.y0 * 3.7) < D.accentChance) {
      main.push(wallBox(cx, cz, sx + 0.008, sz + 0.008, 0, D.accentY, D.accentY + D.accentH, accent, accent, false));
    }
    aoQuad(ao, w.x0, w.y0, w.x1, w.y0, 0, -1, 0.6, 0.3);
    aoQuad(ao, w.x1, w.y1, w.x0, w.y1, 0, 1, 0.6, 0.3);
    aoQuad(ao, w.x0, w.y1, w.x0, w.y0, -1, 0, 0.6, 0.3);
    aoQuad(ao, w.x1, w.y0, w.x1, w.y1, 1, 0, 0.6, 0.3);
    // extremos libres: remate tipo pilar
    if (!roof) {
      const ends: [number, number][] = sx >= sz ? [[w.x0, cz], [w.x1, cz]] : [[cx, w.y0], [cx, w.y1]];
      for (const [px, py] of ends) {
        if (touched(level, px, py, w)) continue;
        const p = D.endPillar, po = p + o;
        main.push(wallBox(px, py, p, p, 0, 0, H, wallColor, wallColor, true, true));
        main.push(wallBox(px, py, po, po, 0, 0, D.baseboard, C.anthracite, C.anthracite, false));
        main.push(wallBox(px, py, po, po, 0, H - D.capH, H, C.anthracite, C.anthracite, false));
      }
    }
  }

  // ── puertas: marco, dintel y umbral (las hojas son instancias aparte)
  for (const d of level.doors) {
    const vertical = d.vertical;
    const L = vertical ? d.y1 - d.y0 : d.x1 - d.x0;
    const t = vertical ? d.x1 - d.x0 : d.y1 - d.y0;
    const put = (list: THREE.BufferGeometry[], u: number, len: number, acr: number, y0: number, y1: number, col: number, grad = false, soft = false): void => {
      if (vertical) list.push(wallBox(d.cx, d.cy + u, acr, len, 0, y0, y1, col, col, grad, soft));
      else list.push(wallBox(d.cx + u, d.cy, len, acr, 0, y0, y1, col, col, grad, soft));
    };
    const J = D.doorJamb, acr = t + 2 * D.doorFrameOver;
    put(main, -(L / 2 - J / 2), J, acr, 0, DOOR_HEIGHT, C.anthracite);
    put(main, L / 2 - J / 2, J, acr, 0, DOOR_HEIGHT, C.anthracite);
    put(main, 0, L, acr, DOOR_HEIGHT - J, DOOR_HEIGHT, C.anthracite);
    put(main, 0, L, t, DOOR_HEIGHT, H, wallColor, true, true);                       // dintel de pared blanca
    put(metal, 0, L - 2 * J, t, 0, D.threshold, C.steel);                           // umbral
  }

  // ── fachada (no en la azotea: allí, peto)
  const seen = new Set<string>();
  for (const [x0, y0, x1, y1] of level.perimeterSegs) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.05) continue;
    const a = Math.atan2(y1 - y0, x1 - x0);
    const ux = Math.cos(a), uz = Math.sin(a);
    const mx = (x0 + x1) / 2, mz = (y0 + y1) / 2;
    const along = (list: THREE.BufferGeometry[], u: number, l: number, t: number, ya: number, yb: number, col: number, grad = false): void => {
      list.push(wallBox(mx + ux * u, mz + uz * u, l, t, -a, ya, yb, col, col, grad, true));
    };
    if (roof) {
      along(main, 0, len + 0.3, D.parapetThick, 0, D.parapetH, C.parapet, true);
      along(main, 0, len + 0.36, D.parapetThick + 0.08, D.parapetH, D.parapetH + 0.06, 0xefefef);   // albardilla
      continue;
    }
    const n = Math.max(1, Math.round(len / D.pillarEvery)), pitch = len / n;
    for (let i = 0; i <= n; i++) {
      const u = -len / 2 + i * pitch;
      const px = mx + ux * u, pz = mz + uz * u;
      const key = `${Math.round(px * 10)},${Math.round(pz * 10)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = D.pillar;
      main.push(wallBox(px, pz, p, p, -a, 0, H, C.white, C.white, true, true));
      main.push(wallBox(px, pz, p + 0.024, p + 0.024, -a, 0, D.baseboard, C.anthracite, C.anthracite, false));
    }
    // paños entre pilares: antepecho, travesaño, perfiles y montantes antracita + cristal
    for (let i = 0; i < n; i++) {
      const uc = -len / 2 + (i + 0.5) * pitch;
      const span = pitch - D.pillar;
      if (span < 0.2) continue;
      const th = 0.12;
      along(main, uc, span, th + 0.04, 0, D.sillH, C.anthracite);                              // antepecho / zócalo
      along(main, uc, span, th, D.sillH, D.sillH + 0.05, C.anthracite);                        // perfil inferior
      along(main, uc, span, th, H - 0.1, H, C.anthracite);                                     // perfil superior
      along(main, uc, span, th, D.transomY, D.transomY + 0.05, C.anthracite);                  // travesaño
      const m = Math.max(1, Math.round(span / D.mullionEvery)), cell = span / m;
      for (let k = 1; k < m; k++) along(main, uc - span / 2 + k * cell, D.mullion[0], D.mullion[1], D.sillH + 0.05, H - 0.1, C.anthracite);
      for (let k = 0; k < m; k++) {
        const cu = uc - span / 2 + (k + 0.5) * cell;
        along(glass, cu, cell - 0.04, 0.02, D.sillH + 0.05, D.transomY, C.glassFacade, true);
        along(glass, cu, cell - 0.04, 0.02, D.transomY + 0.05, H - 0.1, C.glassFacade, true);
      }
    }
    aoQuad(ao, x0, y0, x1, y1, -uz, ux, 0.6, 0.25);
    aoQuad(ao, x1, y1, x0, y0, uz, -ux, 0.6, 0.25);
  }

  const m = (l: THREE.BufferGeometry[]): THREE.BufferGeometry | null => {
    if (!l.length) return null;
    const g = mergeGeometries(l, false);
    for (const p of l) p.dispose();
    return g;
  };
  let aoGeo: THREE.BufferGeometry | null = null;
  if (ao.length) {
    aoGeo = new THREE.BufferGeometry();
    const arr = new Float32Array(ao.length / 7 * 3), col = new Float32Array(ao.length / 7 * 4);
    for (let i = 0; i < ao.length / 7; i++) {
      arr[i * 3] = ao[i * 7]; arr[i * 3 + 1] = ao[i * 7 + 1]; arr[i * 3 + 2] = ao[i * 7 + 2];
      col[i * 4 + 3] = ao[i * 7 + 6];
    }
    aoGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    aoGeo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  }
  return { main: m(main), glass: m(glass), metal: m(metal), ao: aoGeo };
}

// ───────────────────────── Hojas de puerta (instanciadas) ─────────────────────────

interface Leaf { door: Door; hx: number; hz: number; th0: number; flip: boolean }
interface LeafGroup { leaves: Leaf[]; meshes: THREE.InstancedMesh[] }

/** Dos hojas por hueco, abisagradas en cada jamba, abriendo 90° hacia el mismo lado con door.anim. */
export class DoorSet {
  group = new THREE.Group();
  private owned = new Owned();
  private groups: LeafGroup[] = [];
  private last = new Map<Door, number>();
  private bodies: THREE.InstancedMesh[] = [];
  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _p = new THREE.Vector3();
  private _s = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  constructor(doors: Door[]) {
    const matBody = this.owned.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25, side: THREE.DoubleSide }));
    const matGlass = this.owned.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    const matSteel = this.owned.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.9 }));
    const byWidth = new Map<number, Leaf[]>();
    for (const d of doors) {
      const L = d.vertical ? d.y1 - d.y0 : d.x1 - d.x0;
      const w = (L - 2 * D.doorJamb) / 2 - D.leafGap;
      if (w < 0.2) continue;
      const key = Math.round(w * 1000);
      const ux = d.vertical ? 0 : 1, uz = d.vertical ? 1 : 0;
      const th0 = Math.atan2(-uz, ux);
      const hA = -(L / 2) + D.doorJamb, hB = L / 2 - D.doorJamb;
      const list = byWidth.get(key) ?? [];
      list.push({ door: d, hx: d.cx + ux * hA, hz: d.cy + uz * hA, th0, flip: false });
      list.push({ door: d, hx: d.cx + ux * hB, hz: d.cy + uz * hB, th0, flip: true });
      byWidth.set(key, list);
    }
    for (const [key, leaves] of byWidth) {
      const w = key / 1000;
      const body = new GeoBuilder(0), glass = new GeoBuilder(0), steel = new GeoBuilder(0);
      const hh = D.leafTop - D.leafBottom;
      body.box(w / 2, D.leafBottom + hh / 2, 0, w, hh, D.leafThick, REAL_COLORS.anthracite);
      glass.box(w / 2, D.glassY0 + D.glassH / 2, 0, D.glassW, D.glassH, D.leafThick + 0.006, REAL_COLORS.glassDoor);
      for (const s of [-1, 1]) {              // tirador de barra vertical por las dos caras (tamaño fijo)
        const x = w - D.handleFromEdge, zb = s * (D.leafThick / 2 + D.handleStandoff);
        steel.tube(x, D.handleY - D.handleLen / 2, zb, x, D.handleY + D.handleLen / 2, zb, D.handleR, REAL_COLORS.steel, undefined, 10);
        for (const dy of [-0.24, 0.24]) steel.tube(x, D.handleY + dy, s * D.leafThick / 2, x, D.handleY + dy, zb, 0.008, REAL_COLORS.steel, undefined, 6);
      }
      const geos = [body.build().geo, glass.build().geo, steel.build().geo];
      const mats = [matBody, matGlass, matSteel];
      const meshes = geos.map((g, i) => {
        this.owned.add(g);
        const im = new THREE.InstancedMesh(g, mats[i], leaves.length);
        im.frustumCulled = false;
        if (i === 0) this.bodies.push(im);
        this.group.add(im);
        return im;
      });
      this.groups.push({ leaves, meshes });
    }
    this.update(true);
  }

  update(force = false): void {
    for (const g of this.groups) {
      // solo se recalculan las matrices si alguna puerta de este grupo cambió
      let changed = force;
      if (!changed) for (const lf of g.leaves) if (this.last.get(lf.door) !== lf.door.anim) { changed = true; break; }
      if (!changed) continue;
      g.leaves.forEach((lf, i) => {
        const phi = Math.max(0, Math.min(1, lf.door.anim)) * (Math.PI / 2);
        const th = lf.flip ? lf.th0 + Math.PI - phi : lf.th0 + phi;
        this._q.setFromAxisAngle(this.up, th);
        this._p.set(lf.hx, 0, lf.hz);
        this._m.compose(this._p, this._q, this._s);
        for (const im of g.meshes) im.setMatrixAt(i, this._m);
      });
      for (const im of g.meshes) im.instanceMatrix.needsUpdate = true;
      for (const lf of g.leaves) this.last.set(lf.door, lf.door.anim);
    }
  }

  setShadows(on: boolean): void { for (const b of this.bodies) b.castShadow = on; }
  dispose(): void { this.owned.disposeAll(); }
}
