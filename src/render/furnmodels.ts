// Mobiliario a partir de las piezas Kenney (CC0) ya horneadas en assets.ts. Cada tipo del juego se
// compone con varias piezas, cada una encajada (escala NO uniforme) en una caja de la huella de
// colisión FURNITURE[tipo].w × .d × .height: lo que se ve coincide con lo que choca y cubre.
// Convenio: X = ancho (w), Z = fondo (d), base en y = 0, centrado en planta. Los respaldos de
// sofá, butaca y silla miran a -X.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FurnitureType, Theme } from '../sim/types';
import { FURNITURE } from '../sim/data';
import type { Assets } from './assets';
import { GeoBuilder } from './geo';
import { computeHullDir } from './stylized';

export interface PlacedModel { geo: THREE.BufferGeometry; led: THREE.BufferGeometry | null }

export interface Box { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }
type Dir = 'xm' | 'xp' | 'zm' | 'zp';
const DIRS: Record<Dir, [number, number]> = { xm: [-1, 0], xp: [1, 0], zm: [0, -1], zp: [0, 1] };

export interface PlaceOpts {
  /** hacia dónde debe quedar el respaldo (lado donde la pieza es más alta) */
  back?: Dir;
  /** gira 90° si la proporción de la pieza no encaja con la de la caja */
  autoRot?: boolean;
  /** escala uniforme ajustada a la altura de la caja y centrada en planta (plantas) */
  uniform?: boolean;
  /** función de color (por vértice) para teñir */
  tint?: (r: number, g: number, b: number) => [number, number, number];
}

export function place(src: THREE.BufferGeometry, box: Box, o: PlaceOpts = {}): THREE.BufferGeometry {
  const g = src.clone();
  g.computeBoundingBox();
  let bb = g.boundingBox!;
  let k = 0;
  const size = bb.getSize(new THREE.Vector3());
  if (o.back) {
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    const pos = g.getAttribute('position');
    let bx = 0, bz = 0, n = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > bb.min.y + 0.6 * size.y) { bx += pos.getX(i) - cx; bz += pos.getZ(i) - cz; n++; }
    }
    if (n) { bx /= n; bz /= n; }
    if (Math.hypot(bx, bz) > 0.04 * Math.max(size.x, size.z)) {
      const [dx, dz] = DIRS[o.back];
      let best = -Infinity;
      for (let kk = 0; kk < 4; kk++) {
        const t = (kk * Math.PI) / 2;
        const rx = bx * Math.cos(t) + bz * Math.sin(t), rz = -bx * Math.sin(t) + bz * Math.cos(t);
        const sc = rx * dx + rz * dz;
        if (sc > best + 1e-9) { best = sc; k = kk; }
      }
    }
  } else if (o.autoRot) {
    const tw = box.x1 - box.x0, td = box.z1 - box.z0;
    const srcLong = size.x > size.z, tgtLong = tw > td;
    if (srcLong !== tgtLong && Math.abs(size.x - size.z) / Math.max(size.x, size.z) > 0.15 && Math.abs(tw - td) / Math.max(tw, td) > 0.15) k = 1;
  }
  if (k) { g.rotateY((k * Math.PI) / 2); g.computeBoundingBox(); bb = g.boundingBox!; }
  const sz = bb.getSize(new THREE.Vector3());
  if (o.uniform) {
    const s = (box.y1 - box.y0) / (sz.y || 1);
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    g.translate(-cx, -bb.min.y, -cz);
    g.scale(s, s, s);
    g.translate((box.x0 + box.x1) / 2, box.y0, (box.z0 + box.z1) / 2);
  } else {
    g.translate(-bb.min.x, -bb.min.y, -bb.min.z);
    g.scale((box.x1 - box.x0) / (sz.x || 1), (box.y1 - box.y0) / (sz.y || 1), (box.z1 - box.z0) / (sz.z || 1));
    g.translate(box.x0, box.y0, box.z0);
  }
  if (o.tint) {
    const c = g.getAttribute('color');
    for (let i = 0; i < c.count; i++) { const t = o.tint(c.getX(i), c.getY(i), c.getZ(i)); c.setXYZ(i, t[0], t[1], t[2]); }
  }
  return g;
}

export const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Box => ({ x0, x1, y0, y1, z0, z1 });

/** Devuelve el modelo del mueble o null si falta alguna pieza (entonces se usa el de primitivas). */
export function buildFurnitureFromAssets(type: FurnitureType, theme: Theme, a: Assets): PlacedModel | null {
  const sp = FURNITURE[type];
  const { w, d, height: h } = sp;
  const P = (n: string): THREE.BufferGeometry | null => a.furn.get(n) ?? null;
  const parts: THREE.BufferGeometry[] = [];
  let led: THREE.BufferGeometry | null = null;
  const add = (name: string, b: Box, o?: PlaceOpts): boolean => {
    const src = P(name);
    if (!src) return false;
    parts.push(place(src, b, o));
    return true;
  };
  let ok = true;

  switch (type) {
    case 'mesa':
      ok = add('table', box(-w / 2, w / 2, 0, h, -d / 2, d / 2), { autoRot: true });
      break;
    case 'escritorio': {
      const top = 0.74;
      ok = add('desk', box(-w / 2, w / 2, 0, top, -d / 2, d / 2 - 0.4), { autoRot: true })
        && add('computerScreen', box(-0.22, 0.22, top, h, -d / 2 + 0.1, -d / 2 + 0.34), { back: 'zm' })
        && add('computerKeyboard', box(-0.22, 0.22, top, top + 0.04, -d / 2 + 0.5, -d / 2 + 0.72))
        && add('chairDesk', box(-0.27, 0.27, 0, 0.95, d / 2 - 0.5, d / 2), { back: 'zp' });
      break;
    }
    case 'mesa_con_sillas': {
      ok = add('tableRound', box(-0.36, 0.36, 0, 0.75, -0.36, 0.36));
      const c = 0.46, s = 0.2;
      ok = ok
        && add('chair', box(c - s, c + s, 0, 0.9, -s, s), { back: 'xp' })
        && add('chair', box(-c - s, -c + s, 0, 0.9, -s, s), { back: 'xm' })
        && add('chair', box(-s, s, 0, 0.9, c - s, c + s), { back: 'zp' })
        && add('chair', box(-s, s, 0, 0.9, -c - s, -c + s), { back: 'zm' });
      break;
    }
    case 'estanteria': {
      if (theme === 'azotea') return null;                     // máquina de aire acondicionado por código
      if (theme === 'datos') {
        // rack de servidores: dos armarios oscuros con puntitos de luz
        const dark = (r: number, g: number, b: number): [number, number, number] => {
          const l = (r + g + b) / 3;
          return [0.02 + l * 0.12, 0.028 + l * 0.16, 0.045 + l * 0.22];
        };
        ok = add('bookcaseClosed', box(-w / 2, -0.01, 0, h, -d / 2, d / 2), { tint: dark })
          && add('bookcaseClosed', box(0.01, w / 2, 0, h, -d / 2, d / 2), { tint: dark });
        const lb = new GeoBuilder(0);
        const cols = [0x35ff6a, 0x35d0ff, 0xff4040, 0xffb020];
        let n = 0;
        for (const side of [-1, 1]) for (const cx of [-w / 4, w / 4]) for (let r = 0; r < 11; r++) for (let k = 0; k < 3; k++) {
          lb.box(cx - 0.2 + k * 0.07, 0.2 + r * 0.17, side * (d / 2 + 0.012), 0.035, 0.035, 0.012, cols[(n++ * 7 + r) % 4], { outline: false });
        }
        led = lb.build().geo;
      } else {
        ok = add('bookcaseClosedWide', box(-w / 2, w / 2, 0, h, -d / 2, d / 2), { autoRot: true });
      }
      break;
    }
    case 'sofa':
      ok = add('loungeSofaLong', box(-w / 2, w / 2, 0, h, -d / 2, d / 2), { back: 'xm' });
      break;
    case 'butaca':
      ok = add('loungeChair', box(-w / 2, w / 2, 0, h, -d / 2, d / 2), { back: 'xm' });
      break;
    case 'silla':
      ok = add('chairDesk', box(-w / 2, w / 2, 0, h, -d / 2, d / 2), { back: 'xm' });
      break;
    case 'maceta':
      ok = add('pottedPlant', box(-w / 2, w / 2, 0, h, -d / 2, d / 2), { uniform: true });
      break;
  }
  if (!ok || !parts.length) return null;
  const geo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!geo) return null;
  computeHullDir(geo);
  geo.computeBoundingSphere();
  return { geo, led };
}
