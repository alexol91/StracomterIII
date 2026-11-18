// Mobiliario de oficina realista (3DAssets.dev, CC0): por tipo del juego hay varias variantes
// compuestas con piezas encajadas en la huella de colisión FURNITURE[tipo] (w × d × height), y se
// elige la variante de forma determinista por posición. Además, decoración SIN colisión pegada a
// los muros (relojes, cuadros, extintores, papeleras).
//
// Convenio como en furnmodels.ts: X = ancho, Z = fondo, base en y = 0, centrado; los respaldos de
// sofá, butaca y silla miran a -X. Las piezas llevan un atributo `cls` (0 mate, 1 metal).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ILevel } from '../contracts';
import type { FurnitureInst, FurnitureType, Theme } from '../sim/types';
import { FURNITURE } from '../sim/data';
import { GeoBuilder, Owned } from './geo';
import { box, place, type Box, type PlaceOpts } from './furnmodels';
import { makeContactShadows } from './furniture';
import type { OfficeAssets } from './officeassets';

type Spec = [string, Box, PlaceOpts?];

function rnd(i: number): number { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

/** Divide una geometría con atributo cls en (mate, metal), por triángulos. */
function split(g: THREE.BufferGeometry): { matte: THREE.BufferGeometry | null; metal: THREE.BufferGeometry | null } {
  const cls = g.getAttribute('cls');
  const out: THREE.BufferGeometry[] = [];
  for (const want of [0, 1]) {
    const idx: number[] = [];
    for (let t = 0; t < cls.count; t += 3) if ((cls.getX(t) >= 0.5 ? 1 : 0) === want) idx.push(t, t + 1, t + 2);
    if (!idx.length) { out.push(new THREE.BufferGeometry()); continue; }
    const ng = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color']) {
      const a = g.getAttribute(name), arr = new Float32Array(idx.length * 3);
      idx.forEach((vi, k) => { arr[k * 3] = a.getX(vi); arr[k * 3 + 1] = a.getY(vi); arr[k * 3 + 2] = a.getZ(vi); });
      ng.setAttribute(name, new THREE.BufferAttribute(arr, 3));
    }
    ng.computeBoundingSphere();
    out.push(ng);
  }
  return { matte: out[0].getAttribute('position') ? out[0] : null, metal: out[1].getAttribute('position') ? out[1] : null };
}

/** Hojas verdes de la planta (sin maceta), con cls = 0. */
function leaves(h: number): THREE.BufferGeometry {
  const b = new GeoBuilder(0);
  b.cyl(0, 0.9, 0, 0.02, 0.03, 1.0, 0x3b7a3a, undefined, 6);
  const g = [0x2f8f3a, 0x3fae4a, 0x287a34];
  const spots: [number, number, number, number][] = [[0, h - 0.1, 0, 0.17], [0.08, h - 0.35, 0.04, 0.14], [-0.07, h - 0.55, -0.05, 0.15], [0.07, h - 0.78, -0.06, 0.13], [-0.06, h - 0.98, 0.06, 0.12], [0, h - 0.2, -0.07, 0.12]];
  spots.forEach((s, i) => b.sph(s[0], s[1], s[2], s[3], g[i % 3], undefined, 1, 1.15, 1));
  const { geo } = b.build();
  geo.setAttribute('cls', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count), 1));
  return geo;
}

/** Variantes por tipo: cada una es una lista de piezas encajadas en cajas de la huella. */
function variants(type: FurnitureType, theme: Theme): Spec[][] | null {
  const { w, d, height: h } = FURNITURE[type];
  const hw = w / 2, hd = d / 2;
  switch (type) {
    case 'escritorio': {
      const top = 0.74;
      const mk = (desk: string, chair: string, mon: string): Spec[] => [
        [desk, box(-hw, hw, 0, top, -hd, hd - 0.42), { autoRot: true }],
        [mon, box(-0.27, 0.27, top, h, -hd + 0.1, -hd + 0.34)],
        ['keyboard-full-size', box(-0.22, 0.22, top, top + 0.03, -hd + 0.5, -hd + 0.68)],
        [chair, box(-0.3, 0.3, 0, 1.02, hd - 0.56, hd), { back: 'zp' }],
      ];
      return [mk('desk-executive', 'executive-chair', 'monitor-24-inch'), mk('desk-1800-a-frame', 'task-chair-mesh', 'monitor-34-curved'), mk('desk-1600-panel-end', 'task-chair-upholstered', 'monitor-24-inch')];
    }
    case 'mesa':
      return [[['flip-top-table', box(-hw, hw, 0, h, -hd, hd), { autoRot: true }]], [['desk-1600-panel-end', box(-hw, hw, 0, h, -hd, hd), { autoRot: true }]]];
    case 'mesa_con_sillas': {
      if (theme === 'juntas') {
        const ch = (x: number, z: number): Spec => ['executive-chair', box(x - 0.17, x + 0.17, 0, 0.95, z - 0.17, z + 0.17), { back: z > 0 ? 'zp' : 'zm' }];
        return [[['boardroom-table-8', box(-hw, hw, 0, 0.75, -0.4, 0.4), { autoRot: false }], ch(-0.33, 0.52), ch(0.33, 0.52), ch(-0.33, -0.52), ch(0.33, -0.52)]];
      }
      const mk = (chair: string): Spec[] => {
        const c = 0.46, s = 0.2;
        return [
          ['meeting-table-round-4', box(-0.38, 0.38, 0, 0.75, -0.38, 0.38)],
          [chair, box(c - s, c + s, 0, 0.9, -s, s), { back: 'xp' }], [chair, box(-c - s, -c + s, 0, 0.9, -s, s), { back: 'xm' }],
          [chair, box(-s, s, 0, 0.9, c - s, c + s), { back: 'zp' }], [chair, box(-s, s, 0, 0.9, -c - s, -c + s), { back: 'zm' }],
        ];
      };
      return [mk('meeting-chair-castors'), mk('stacking-chair')];
    }
    case 'estanteria':
      if (theme === 'azotea') return [[['rooftop-ac-unit', box(-hw, hw, 0, h, -hd, hd), { autoRot: true }]]];
      if (theme === 'datos') return [[['L-server-rack-42u-doors', box(-hw, -0.01, 0, h, -hd, hd), { autoRot: false }], ['L-server-rack-42u-doors', box(0.01, hw, 0, h, -hd, hd), { autoRot: false }]]];
      return [
        [['bookcase-open', box(-hw, hw, 0, h, -hd, hd), { autoRot: true }]],
        [['locker-bank-6', box(-hw, -0.01, 0, h, -hd, hd), { autoRot: true }], ['locker-bank-6', box(0.01, hw, 0, h, -hd, hd), { autoRot: true }]],
        [['tambour-cupboard', box(-hw, hw, 0, h / 2, -hd, hd), { autoRot: true }], ['tambour-cupboard', box(-hw, hw, h / 2, h, -hd, hd), { autoRot: true }]],
      ];
    case 'sofa':
      return [[['L-visitor-sofa-two-seat', box(-hw, hw, 0, h, -hd, hd), { back: 'xm' }]], [['sofa-two-seat', box(-hw, hw, 0, h, -hd, hd), { back: 'xm' }]]];
    case 'butaca':
      return [[['lounge-armchair', box(-hw, hw, 0, h, -hd, hd), { back: 'xm' }]], [['L-lobby-armchair', box(-hw, hw, 0, h, -hd, hd), { back: 'xm' }]]];
    case 'silla':
      return [[['task-chair-upholstered', box(-hw, hw, 0, h, -hd, hd), { back: 'xm' }]], [['guest-chair-four-leg', box(-hw, hw, 0, h, -hd, hd), { back: 'xm' }]], [['stacking-chair', box(-hw, hw, 0, h, -hd, hd), { back: 'xm' }]]];
    case 'maceta':
      return [[['floor-planter-large', box(-0.14, 0.14, 0, 0.4, -0.14, 0.14)]]];
    default: return null;
  }
}

function compose(specs: Spec[], a: OfficeAssets, type: FurnitureType): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const [name, b, o] of specs) {
    const src = a.parts.get(name);
    if (!src) return null;
    parts.push(place(src, b, o));
  }
  if (type === 'maceta') parts.push(leaves(FURNITURE.maceta.height));
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g;
}

/** LEDs de los racks (datos): puntitos emisivos en las dos caras. */
function rackLeds(): THREE.BufferGeometry {
  const { w, d } = FURNITURE.estanteria;
  const lb = new GeoBuilder(0);
  const cols = [0x35ff6a, 0x35d0ff, 0xff4040, 0xffb020];
  let n = 0;
  for (const side of [-1, 1]) for (const cx of [-w / 4, w / 4]) for (let r = 0; r < 11; r++) for (let k = 0; k < 3; k++) {
    lb.box(cx - 0.2 + k * 0.07, 0.2 + r * 0.17, side * (d / 2 + 0.012), 0.035, 0.035, 0.012, cols[(n++ * 7 + r) % 4], { outline: false });
  }
  return lb.build().geo;
}

// ───────────────────────── Decoración sin colisión ─────────────────────────

interface DecorSpot { name: string; x: number; y: number; elev: number; yaw: number }
const DECOR: { name: string; elev: number }[] = [
  { name: 'wall-clock', elev: 2.05 }, { name: 'wall-art-panel', elev: 1.45 }, { name: 'L-fire-extinguisher-point', elev: 0 },
  { name: 'waste-bin', elev: 0 }, { name: 'L-wall-wayfinding-panel', elev: 1.7 },
];

function placeDecor(level: ILevel): DecorSpot[] {
  let seed = 0;
  for (const ch of level.map.nombre || 'x') seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const walls = level.walls.filter((w) => !w.perimeter || level.perimeterSegs.length === 0);
  const cands: { x: number; y: number; nx: number; ny: number }[] = [];
  for (const w of walls) {
    const sx = w.x1 - w.x0, sy = w.y1 - w.y0;
    const horiz = sx >= sy;
    const len = horiz ? sx : sy;
    for (let t = 1.2; t < len - 1.2; t += 4.2) {
      for (const side of [-1, 1]) {
        const off = 0.03 + 0.02;
        if (horiz) cands.push({ x: w.x0 + t, y: side < 0 ? w.y0 - off : w.y1 + off, nx: 0, ny: side });
        else cands.push({ x: side < 0 ? w.x0 - off : w.x1 + off, y: w.y0 + t, nx: side, ny: 0 });
      }
    }
  }
  const ok = (c: { x: number; y: number; nx: number; ny: number }): boolean => {
    const fx = c.x + c.nx * 0.7, fy = c.y + c.ny * 0.7;
    if (!level.inside(c.x, c.y) || !level.inside(fx, fy)) return false;
    for (const d of level.doors) {
      const dx = Math.max(d.x0 - c.x, 0, c.x - d.x1), dy = Math.max(d.y0 - c.y, 0, c.y - d.y1);
      if (Math.hypot(dx, dy) < 1.7) return false;
    }
    for (const w of level.walls) {
      for (const [px, py] of [[fx, fy], [c.x + c.ny * 0.3, c.y + c.nx * 0.3], [c.x - c.ny * 0.3, c.y - c.nx * 0.3], [c.x + c.nx * 0.35, c.y + c.ny * 0.35]]) {
        if (px > w.x0 - 0.15 && px < w.x1 + 0.15 && py > w.y0 - 0.15 && py < w.y1 + 0.15) return false;
      }
    }
    for (const f of level.furniture) if (Math.hypot(f.x - fx, f.y - fy) < Math.max(f.hw, f.hd) + 0.6) return false;
    return true;
  };
  const good = cands.filter(ok);
  // mezcla determinista y elige 5..14
  const order = good.map((c, i) => ({ c, k: rnd(seed + i * 7.31) })).sort((a, b) => a.k - b.k);
  const n = Math.min(order.length, 5 + Math.floor(rnd(seed) * 10));
  const out: DecorSpot[] = [];
  for (let i = 0; i < n; i++) {
    const c = order[i].c, kind = DECOR[i % DECOR.length];
    out.push({ name: kind.name, x: c.x, y: c.y, elev: kind.elev, yaw: Math.atan2(c.nx, c.ny) });
  }
  return out;
}

// ───────────────────────── Capa ─────────────────────────

export class RealFurnitureLayer {
  group = new THREE.Group();
  private owned = new Owned();
  private casters: THREE.InstancedMesh[] = [];

  constructor(level: ILevel, a: OfficeAssets) {
    const theme = level.theme;
    const matte = this.owned.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02 }));
    const metal = this.owned.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.85 }));
    const ledMat = this.owned.add(new THREE.MeshBasicMaterial({ vertexColors: true }));
    const q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), m = new THREE.Matrix4();
    const up = new THREE.Vector3(0, 1, 0);

    const byType = new Map<FurnitureType, FurnitureInst[]>();
    for (const f of level.furniture) { const l = byType.get(f.type); if (l) l.push(f); else byType.set(f.type, [f]); }

    const addMesh = (g: THREE.BufferGeometry, mat: THREE.Material, list: { m: THREE.Matrix4 }[], cast: boolean): void => {
      this.owned.add(g);
      const im = new THREE.InstancedMesh(g, mat, list.length);
      list.forEach((it, i) => im.setMatrixAt(i, it.m));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      if (cast) this.casters.push(im);
      this.group.add(im);
    };

    for (const [type, list] of byType) {
      const vs = variants(type, theme);
      const sp = FURNITURE[type];
      const built: { matte: THREE.BufferGeometry | null; metal: THREE.BufferGeometry | null }[] = [];
      for (const specs of vs ?? []) {
        try { const g = compose(specs, a, type); built.push(g ? split(g) : { matte: null, metal: null }); if (g) g.dispose(); } catch { built.push({ matte: null, metal: null }); }
      }
      const usable = built.map((b, i) => (b.matte || b.metal ? i : -1)).filter((i) => i >= 0);
      if (!usable.length) continue;
      const groups = new Map<number, { m: THREE.Matrix4 }[]>();
      for (const f of list) {
        const vi = usable[Math.floor(rnd(Math.round(f.x * 10) * 131 + Math.round(f.y * 10)) * usable.length)];
        q.setFromAxisAngle(up, -f.angle);
        p.set(f.x, 0, f.y);
        s.set(f.hw / (sp.w / 2), (f.height || sp.height) / sp.height, f.hd / (sp.d / 2));
        const it = { m: new THREE.Matrix4().compose(p, q, s) };
        const l = groups.get(vi); if (l) l.push(it); else groups.set(vi, [it]);
      }
      for (const [vi, l] of groups) {
        const b = built[vi];
        if (b.matte) addMesh(b.matte, matte, l, true);
        if (b.metal) addMesh(b.metal, metal, l, true);
      }
      if (type === 'estanteria' && theme === 'datos') {
        const all = list.map((f) => { q.setFromAxisAngle(up, -f.angle); p.set(f.x, 0, f.y); s.set(f.hw / (sp.w / 2), (f.height || sp.height) / sp.height, f.hd / (sp.d / 2)); return { m: new THREE.Matrix4().compose(p, q, s) }; });
        addMesh(rackLeds(), ledMat, all, false);
      }
    }

    // decoración pegada a pared, sin colisión
    const spots = placeDecor(level);
    const byName = new Map<string, DecorSpot[]>();
    for (const d of spots) { const l = byName.get(d.name); if (l) l.push(d); else byName.set(d.name, [d]); }
    for (const [name, l] of byName) {
      const src = a.parts.get(name);
      if (!src) continue;
      const g = src.clone();
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -bb.min.z);    // pivote: centro de la cara trasera, en el suelo
      const sp2 = split(g); g.dispose();
      const items = l.map((d) => ({ m: new THREE.Matrix4().compose(new THREE.Vector3(d.x, d.elev, d.y), new THREE.Quaternion().setFromAxisAngle(up, d.yaw), new THREE.Vector3(1, 1, 1)) }));
      if (sp2.matte) addMesh(sp2.matte, matte, items, false);
      if (sp2.metal) addMesh(sp2.metal, metal, items, false);
    }

    const shadows = makeContactShadows(level.furniture, this.owned);
    if (shadows) this.group.add(shadows);
  }

  setShadows(on: boolean): void { for (const im of this.casters) { im.castShadow = on; im.receiveShadow = on; } }
  dispose(): void { this.owned.disposeAll(); }
}
