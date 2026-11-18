// Geometría del nivel: suelo (con textura generada), muros fusionados con dintel de puertas,
// hojas de puerta animadas, círculo del helipuerto y estrellas de la azotea.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ILevel } from '../contracts';
import type { Door } from '../sim/types';
import { DOOR_HEIGHT, WALL_HEIGHT } from '../sim/data';
import { GeoBuilder, Owned, makeOutlineMat, makeToonVC } from './geo';
import { THEMES, type ThemeDef } from './palette';

// ───────────────────────── Texturas generadas ─────────────────────────

function canvas(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, g: c.getContext('2d')! };
}

function hex(n: number): string { return '#' + n.toString(16).padStart(6, '0'); }

function rnd(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function floorTexture(th: ThemeDef): THREE.CanvasTexture {
  const S = 256;
  const { c, g } = canvas(S);
  const r = rnd(7);
  g.fillStyle = hex(th.floorA); g.fillRect(0, 0, S, S);
  if (th.pattern === 'tiles') {
    const n = 2, t = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = hex((i + j) % 2 ? th.floorB : th.floorA);
      g.fillRect(i * t, j * t, t, t);
    }
    g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 3;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, S); g.stroke(); g.beginPath(); g.moveTo(0, i * t); g.lineTo(S, i * t); g.stroke(); }
    // vetas de mármol
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.5;
    for (let k = 0; k < 10; k++) { g.beginPath(); const x = r() * S, y = r() * S; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 60); g.stroke(); }
  } else if (th.pattern === 'carpet') {
    for (let k = 0; k < 2200; k++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
      g.fillRect(r() * S, r() * S, 2, 2);
    }
    g.fillStyle = hex(th.floorB);
    g.fillRect(0, 0, S, 3); g.fillRect(0, 0, 3, S);       // junta de moqueta
    g.fillRect(0, S / 2, S, 2); g.fillRect(S / 2, 0, 2, S);
  } else if (th.pattern === 'wood') {
    const n = 8, t = S / n;
    for (let j = 0; j < n; j++) {
      g.fillStyle = hex(j % 2 ? th.floorB : th.floorA); g.fillRect(0, j * t, S, t);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, j * t, S, 2);
      const off = r() * S;
      g.fillRect(off, j * t, 2, t);
      g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 1;
      for (let k = 0; k < 3; k++) { const y = j * t + 4 + r() * (t - 8); g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
    }
  } else {
    for (let k = 0; k < 1800; k++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.12)';
      g.fillRect(r() * S, r() * S, 2 + r() * 2, 2 + r() * 2);
    }
    g.fillStyle = hex(th.floorB);
    g.fillRect(0, 0, S, 3); g.fillRect(0, 0, 3, S);
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(30, 40); g.lineTo(80, 90); g.lineTo(120, 80); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / th.tileM, 1 / th.tileM);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function helipadTexture(): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = canvas(S);
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#2b2f37'; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 6, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#f2c200'; g.lineWidth = 14; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 22, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#f2f2f2'; g.lineWidth = 6; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 46, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#f2f2f2';
  g.fillRect(S * 0.3, S * 0.25, S * 0.07, S * 0.5);
  g.fillRect(S * 0.63, S * 0.25, S * 0.07, S * 0.5);
  g.fillRect(S * 0.3, S * 0.47, S * 0.4, S * 0.07);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ───────────────────────── Muros ─────────────────────────

function wallBox(cx: number, cz: number, sx: number, sz: number, rotY: number, y0: number, y1: number, main: number, cap: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, y1 - y0, sz);
  g.rotateY(rotY);
  g.translate(cx, (y0 + y1) / 2, cz);
  const n = g.toNonIndexed();
  g.dispose();
  n.deleteAttribute('uv');
  const count = n.getAttribute('position').count;
  const cm = new THREE.Color(main), cc = new THREE.Color(cap);
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const face = Math.floor(i / 6);          // 0 +x, 1 -x, 2 +y (tapa), 3 -y, 4 +z, 5 -z
    const col = face === 2 ? cc : cm;
    arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b;
  }
  n.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return n;
}

function buildWallGeometry(level: ILevel, th: ThemeDef): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  const H = WALL_HEIGHT;
  const hasSegs = level.perimeterSegs.length > 0;

  for (const w of level.walls) {
    if (w.perimeter && hasSegs) continue;   // la fachada se dibuja desde perimeterSegs
    const sx = w.x1 - w.x0, sz = w.y1 - w.y0;
    if (sx <= 0 || sz <= 0) continue;
    parts.push(wallBox((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, sx, sz, 0, 0, H, w.perimeter ? th.facade : th.wall, th.cap));
  }
  for (const [x0, y0, x1, y1] of level.perimeterSegs) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.01) continue;
    const a = Math.atan2(y1 - y0, x1 - x0);
    // un poco más largos que el tramo para cerrar las esquinas
    parts.push(wallBox((x0 + x1) / 2, (y0 + y1) / 2, len + 0.2, 0.2, -a, 0, H, th.facade, th.cap));
  }
  for (const d of level.doors) {
    // dintel sobre el hueco de la puerta
    parts.push(wallBox(d.cx, d.cy, d.x1 - d.x0, d.y1 - d.y0, 0, DOOR_HEIGHT, H, th.wall, th.cap));
  }
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

// ───────────────────────── Capa del nivel ─────────────────────────

interface DoorView { door: Door; pivot: THREE.Group }

export class LevelLayer {
  group = new THREE.Group();
  private owned = new Owned();
  private wallGroup = new THREE.Group();
  private wallOwned = new Owned();
  private doors: DoorView[] = [];
  private version: number;
  private th: ThemeDef;

  constructor(private level: ILevel) {
    this.th = THEMES[level.theme] ?? THEMES.recepcion;
    this.version = level.version;
    this.buildFloor();
    this.buildWalls();
    this.buildDoors();
    this.group.add(this.wallGroup);
    if (level.theme === 'azotea') this.buildRoofExtras();
  }

  private buildFloor(): void {
    const per = this.level.map.perimetro;
    const shape = new THREE.Shape();
    per.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, -y) : shape.lineTo(x, -y)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);       // (x, -y, 0) -> (x, 0, y), normal hacia arriba
    const tex = floorTexture(this.th);
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    this.owned.add(geo); this.owned.add(tex); this.owned.add(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -0.01;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  private buildWalls(): void {
    // vacía lo anterior
    this.wallOwned.disposeAll();
    this.wallGroup.clear();
    const geo = buildWallGeometry(this.level, this.th);
    if (!geo) return;
    const mat = this.wallOwned.add(makeToonVC());
    this.wallOwned.add(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.wallGroup.add(mesh);
    // borde oscuro en las aristas
    const eg = this.wallOwned.add(new THREE.EdgesGeometry(geo, 25));
    const lm = this.wallOwned.add(new THREE.LineBasicMaterial({ color: 0x090b10 }));
    const lines = new THREE.LineSegments(eg, lm);
    lines.frustumCulled = false;
    this.wallGroup.add(lines);
  }

  private buildDoors(): void {
    const mat = this.owned.add(makeToonVC());
    const hullMat = this.owned.add(makeOutlineMat());
    for (const d of this.level.doors) {
      const L = d.vertical ? d.y1 - d.y0 : d.x1 - d.x0;
      const hgt = DOOR_HEIGHT - 0.03;
      const th = 0.09;
      const b = new GeoBuilder(0.02);
      b.box(L / 2, hgt / 2, 0, L - 0.02, hgt, th, this.th.door);
      b.box(L / 2, hgt * 0.58, 0, (L - 0.02) * 0.72, hgt * 0.7, th + 0.02, shade(this.th.door, 1.35), { outline: false });
      b.sph(L * 0.86, 1.0, th / 2 + 0.05, 0.04, 0xd9b84a, { outline: false });
      b.sph(L * 0.86, 1.0, -th / 2 - 0.05, 0.04, 0xd9b84a, { outline: false });
      const { geo, hull } = b.build();
      this.owned.add(geo);
      const pivot = new THREE.Group();
      pivot.add(new THREE.Mesh(geo, mat));
      if (hull) { this.owned.add(hull); pivot.add(new THREE.Mesh(hull, hullMat)); }
      if (d.vertical) pivot.position.set(d.cx, 0, d.y0);
      else pivot.position.set(d.x0, 0, d.cy);
      this.group.add(pivot);
      this.doors.push({ door: d, pivot });
    }
    this.updateDoors();
  }

  private updateDoors(): void {
    for (const dv of this.doors) {
      const a = Math.max(0, Math.min(1, dv.door.anim));
      dv.pivot.rotation.y = dv.door.vertical ? -Math.PI / 2 - a * (Math.PI / 2) : -a * (Math.PI / 2);
    }
  }

  private buildRoofExtras(): void {
    const [bx, by] = this.level.map.punto_jefe;
    const tex = helipadTexture();
    const R = 6.5;
    const geo = new THREE.PlaneGeometry(R * 2, R * 2).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
    this.owned.add(tex); this.owned.add(geo); this.owned.add(mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(bx, 0.015, by);
    m.renderOrder = 0;
    this.group.add(m);
  }

  /** Cada frame: reconstruye muros si cambió la geometría, y mueve las puertas. */
  update(): void {
    if (this.level.version !== this.version) {
      this.version = this.level.version;
      this.buildWalls();
    }
    this.updateDoors();
  }

  dispose(): void {
    this.wallOwned.disposeAll();
    this.owned.disposeAll();
  }
}

function shade(hexv: number, f: number): number {
  const c = new THREE.Color(hexv);
  c.multiplyScalar(f);
  return c.getHex();
}

/** Estrellas del cielo de la azotea. */
export function makeStars(owned: Owned): THREE.Points {
  const n = 260;
  const pos = new Float32Array(n * 3);
  const r = rnd(99);
  for (let i = 0; i < n; i++) {
    const az = r() * Math.PI * 2, el = 0.12 + r() * 1.2;
    const R = 160;
    pos[i * 3] = Math.cos(az) * Math.cos(el) * R;
    pos[i * 3 + 1] = Math.sin(el) * R;
    pos[i * 3 + 2] = Math.sin(az) * Math.cos(el) * R;
  }
  const g = owned.add(new THREE.BufferGeometry());
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = owned.add(new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false }));
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}
