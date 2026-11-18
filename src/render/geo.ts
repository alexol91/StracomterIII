// Utilidades de geometría: constructor de mallas fusionadas con color por vértice y
// «casco invertido» para el contorno de cómic, y materiales planos compartidos.
//
// Convenio de modelos: +X es «delante», +Y arriba, +Z es la derecha del personaje.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeStylized, toonRamp, disposeRamp } from './stylized';

export { makeStylized, toonRamp, disposeRamp };

export interface PrimOpts {
  /** false = sin contorno (detalles pequeños). Por defecto sí. */
  outline?: boolean;
  /** rotación Euler (rad) aplicada a la primitiva alrededor de su centro */
  rot?: [number, number, number];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * Acumula primitivas (cajas, cilindros, esferas, barras) y las fusiona en UNA geometría con
 * color por vértice, más otra geometría «casco» (cada primitiva inflada) para el contorno.
 * El casco inflado por primitiva cierra bien las esquinas, cosa que no consigue escalar por normales.
 */
export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];
  private hulls: THREE.BufferGeometry[] = [];
  constructor(private t = 0.035) {}

  private add(make: (infl: number) => THREE.BufferGeometry, m: THREE.Matrix4, color: number, outline: boolean): void {
    const g = make(0);
    g.applyMatrix4(m);
    this.parts.push(this.finish(g, color));
    if (outline && this.t > 0) {
      const h = make(this.t);
      h.applyMatrix4(m);
      const hh = h.index ? h.toNonIndexed() : h;
      hh.deleteAttribute('uv');
      hh.deleteAttribute('normal');
      this.hulls.push(hh);
    }
  }

  private finish(g0: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
    const g = g0.index ? g0.toNonIndexed() : g0;
    g.deleteAttribute('uv');
    const n = g.getAttribute('position').count;
    const c = new THREE.Color(color);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  }

  private mat(cx: number, cy: number, cz: number, o?: PrimOpts, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
    _p.set(cx, cy, cz);
    if (o?.rot) _q.setFromEuler(_e.set(o.rot[0], o.rot[1], o.rot[2]));
    else _q.identity();
    _s.set(sx, sy, sz);
    return _m.clone().compose(_p, _q, _s);
  }

  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: number, o?: PrimOpts): this {
    this.add((t) => new THREE.BoxGeometry(sx + 2 * t, sy + 2 * t, sz + 2 * t), this.mat(cx, cy, cz, o), color, o?.outline !== false);
    return this;
  }

  /** Cilindro (o cono si rt = 0) con eje Y local; usa `rot` para tumbarlo. */
  cyl(cx: number, cy: number, cz: number, rt: number, rb: number, h: number, color: number, o?: PrimOpts, seg = 10): this {
    this.add(
      (t) => new THREE.CylinderGeometry(rt > 0 ? rt + t : 0, rb + t, h + 2 * t, seg),
      this.mat(cx, cy, cz, o), color, o?.outline !== false,
    );
    return this;
  }

  /** Esfera (elipsoide con sx, sy, sz). */
  sph(cx: number, cy: number, cz: number, r: number, color: number, o?: PrimOpts, sx = 1, sy = 1, sz = 1): this {
    this.add((t) => new THREE.SphereGeometry(r + t, 10, 8), this.mat(cx, cy, cz, o, sx, sy, sz), color, o?.outline !== false);
    return this;
  }

  /** Barra de sección cuadrada entre dos puntos (brazos, cañones, antenas). */
  bar(ax: number, ay: number, az: number, bx: number, by: number, bz: number, thick: number, color: number, o?: PrimOpts): this {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1e-4;
    _q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    _p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    _s.set(1, 1, 1);
    const m = _m.clone().compose(_p, _q, _s);
    this.add((t) => new THREE.BoxGeometry(len + 2 * t, thick + 2 * t, thick + 2 * t), m, color, o?.outline !== false);
    return this;
  }

  /** Cilindro tumbado entre dos puntos. */
  tube(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, color: number, o?: PrimOpts, seg = 8): this {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1e-4;
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    _p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    _s.set(1, 1, 1);
    const m = _m.clone().compose(_p, _q, _s);
    this.add((t) => new THREE.CylinderGeometry(r + t, r + t, len + 2 * t, seg), m, color, o?.outline !== false);
    return this;
  }

  isEmpty(): boolean { return this.parts.length === 0; }

  /** Devuelve la geometría con color y el casco de contorno. `pivot` desplaza el origen. */
  build(pivot?: [number, number, number]): { geo: THREE.BufferGeometry; hull: THREE.BufferGeometry | null } {
    const geo = mergeGeometries(this.parts, false) ?? new THREE.BufferGeometry();
    const hull = this.hulls.length ? mergeGeometries(this.hulls, false) : null;
    if (pivot) { geo.translate(-pivot[0], -pivot[1], -pivot[2]); hull?.translate(-pivot[0], -pivot[1], -pivot[2]); }
    for (const p of this.parts) p.dispose();
    for (const p of this.hulls) p.dispose();
    this.parts = []; this.hulls = [];
    geo.computeBoundingSphere();
    hull?.computeBoundingSphere();
    return { geo, hull };
  }
}

// ───────────────────────── Materiales compartidos ─────────────────────────

/** Material de contorno: negro, solo caras traseras (casco invertido). */
export function makeOutlineMat(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: 0x1a1426, side: THREE.BackSide });
}

/** Material estilizado con color por vértice. */
export function makeToonVC(): THREE.MeshToonMaterial {
  return makeStylized({ vertexColors: true });
}

/** Lista de recursos a liberar al terminar. */
export class Owned {
  private list: { dispose(): void }[] = [];
  add<T extends { dispose(): void }>(x: T): T { this.list.push(x); return x; }
  disposeAll(): void { for (const x of this.list) x.dispose(); this.list = []; }
}
