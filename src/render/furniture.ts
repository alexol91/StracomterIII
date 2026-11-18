// Mobiliario (InstancedMesh por tipo) y objetos del suelo (botiquines y munición).
//
// Convenio de los modelos: X local = ancho (w), Z local = fondo (d), con la medida de FURNITURE.
// En la simulación el eje local y del mueble es el Z de three, y el ángulo gira sobre el plano:
// la rotación de three alrededor de Y es -angle.

import * as THREE from 'three';
import type { FurnitureInst, FurnitureType, ItemType, Theme } from '../sim/types';
import type { IWorld } from '../contracts';
import { FURNITURE } from '../sim/data';
import { GeoBuilder, Owned, makeOutlineMat, makeToonVC } from './geo';
import { THEMES, type ThemeDef } from './palette';
import type { Assets } from './assets';
import { buildFurnitureFromAssets } from './furnmodels';
import { computeHullDir, makeHullMaterial } from './stylized';

interface FurnModel { geo: THREE.BufferGeometry; hull: THREE.BufferGeometry | null; led: THREE.BufferGeometry | null; /** modelo Kenney: el contorno usa la misma geometría con desplazamiento por normal */ fancy?: boolean }

/** Número pseudoaleatorio determinista (para libros y luces: el mismo resultado en cada partida). */
function rnd(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function shade(hex: number, f: number): number {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return c.getHex();
}

function buildFurniture(type: FurnitureType, th: ThemeDef, theme: Theme): FurnModel {
  const sp = FURNITURE[type];
  const { w, d, height: h } = sp;
  const b = new GeoBuilder(0.016);
  let led: THREE.BufferGeometry | null = null;
  const wood = th.wood, fab = th.fabric, met = th.metal;

  switch (type) {
    case 'mesa': {
      b.box(0, h - 0.03, 0, w, 0.05, d, wood);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * (w / 2 - 0.05), (h - 0.05) / 2, sz * (d / 2 - 0.07), 0.05, h - 0.05, 0.05, shade(wood, 0.7));
      break;
    }
    case 'escritorio': {
      b.box(0, h - 0.03, 0, w, 0.05, d, wood);
      b.box(0, (h - 0.05) / 2, d / 2 - 0.04, w - 0.1, h - 0.05, 0.05, met);                      // panel frontal
      b.box(-w / 2 + 0.3, (h - 0.05) / 2, -0.12, 0.5, h - 0.05, d - 0.5, shade(wood, 0.75));     // cajonera
      b.box(w / 2 - 0.05, (h - 0.05) / 2, -0.1, 0.05, h - 0.05, d - 0.4, shade(wood, 0.7));
      b.box(0.2, h + 0.19, 0.1, 0.55, 0.34, 0.05, 0x1b1f27);                                      // monitor
      b.box(0.2, h + 0.03, 0.1, 0.12, 0.06, 0.1, 0x1b1f27, { outline: false });
      b.box(0.2, h + 0.02, -0.2, 0.42, 0.025, 0.14, 0x2e3440, { outline: false });                // teclado
      b.box(-0.45, h + 0.04, -0.3, 0.3, 0.06, 0.22, 0xe8e8e0, { outline: false });                // papeles
      break;
    }
    case 'mesa_con_sillas': {
      b.box(0, 0.75, 0, 0.72, 0.05, 0.72, wood);
      b.box(0, 0.38, 0, 0.1, 0.72, 0.1, shade(wood, 0.7));
      b.box(0, 0.03, 0, 0.5, 0.05, 0.1, shade(wood, 0.7), { outline: false });
      for (const s of [-1, 1]) {
        b.box(s * 0.47, 0.45, 0, 0.42, 0.06, 0.42, fab);
        b.box(s * 0.65, 0.7, 0, 0.05, 0.42, 0.42, fab);
        b.box(0, 0.45, s * 0.47, 0.42, 0.06, 0.42, fab);
        b.box(0, 0.7, s * 0.65, 0.42, 0.42, 0.05, fab);
      }
      break;
    }
    case 'estanteria': {
      if (theme === 'azotea') {
        // máquina de aire acondicionado
        b.box(0, (h - 0.1) / 2, 0, w, h - 0.1, d, 0xb9c0ca);
        b.box(0, h - 0.1, 0, w + 0.06, 0.06, d + 0.06, 0x7d8592);
        for (const s of [-1, 1]) b.cyl(s * w * 0.25, h - 0.04, 0, 0.22, 0.22, 0.06, 0x23272e, undefined, 14);
        for (let i = 0; i < 6; i++) b.box(0, 0.3 + i * 0.22, d / 2 + 0.005, w * 0.85, 0.07, 0.02, 0x4a515c, { outline: false });
        b.box(w / 2 + 0.03, 0.3, 0, 0.08, 0.5, 0.3, 0x7d8592);
        b.tube(w / 2 + 0.07, 0.3, 0, w / 2 + 0.4, 0.15, 0, 0.04, 0x9aa2ad, undefined, 6);
      } else if (theme === 'datos') {
        // dos racks de servidores con lucecitas (las luces van en un mesh sin iluminación aparte)
        const lb = new GeoBuilder(0);
        for (const s of [-1, 1]) {
          const cx = s * (w / 4 + 0.01);
          const rw = w / 2 - 0.05;
          b.box(cx, h / 2, 0, rw, h, d, 0x1b2230);
          b.box(cx, h - 0.02, 0, rw + 0.04, 0.04, d + 0.04, 0x0b0f18);
          for (let r = 0; r < 12; r++) {
            const y = 0.12 + r * 0.16;
            b.box(cx, y, d / 2 + 0.004, rw - 0.08, 0.1, 0.012, r % 2 ? 0x2a3447 : 0x333f55, { outline: false });
            for (let k = 0; k < 3; k++) {
              const n = r * 7 + k + (s > 0 ? 40 : 0);
              const cols = [0x35ff6a, 0x35d0ff, 0xff4040, 0xffb020];
              lb.box(cx - rw / 2 + 0.09 + k * 0.06, y, d / 2 + 0.014, 0.035, 0.035, 0.012, cols[Math.floor(rnd(n) * 4)], { outline: false });
            }
          }
        }
        led = lb.build().geo;
      } else {
        const wd = shade(wood, 0.85);
        for (const s of [-1, 1]) b.box(s * (w / 2 - 0.02), h / 2, 0, 0.04, h, d, wd);
        b.box(0, h / 2, -d / 2 + 0.015, w, h, 0.03, shade(wood, 0.5));
        const sh = [0.03, 0.45, 0.87, 1.29, 1.71, h - 0.02];
        for (const y of sh) b.box(0, y, 0, w - 0.06, 0.035, d - 0.03, wd);
        const cols = [0xc0392b, 0x2c6fbb, 0xe0b341, 0x2e8b57, 0xe8e0d0, 0x7a4fa0];
        let n = 0;
        for (let s = 0; s < sh.length - 1; s++) {
          let x = -w / 2 + 0.08;
          while (x < w / 2 - 0.12) {
            const bw = 0.04 + rnd(n) * 0.04, bh = 0.22 + rnd(n + 9) * 0.14;
            if (rnd(n + 3) > 0.15) b.box(x + bw / 2, sh[s] + 0.02 + bh / 2, 0, bw, bh, d - 0.18, cols[Math.floor(rnd(n + 5) * cols.length)], { outline: false });
            x += bw + 0.01 + (rnd(n + 7) > 0.8 ? 0.12 : 0);
            n++;
          }
        }
      }
      break;
    }
    case 'sofa': {
      b.box(0, 0.2, 0, w, 0.32, d, fab);
      b.box(0.07, 0.42, 0, w - 0.18, 0.13, d - 0.34, shade(fab, 1.18));          // cojín del asiento
      b.box(-w / 2 + 0.07, 0.6, 0, 0.14, 0.62, d, fab);                           // respaldo (atrás = -X)
      for (const s of [-1, 1]) b.box(0.0, 0.46, s * (d / 2 - 0.08), w, 0.36, 0.16, shade(fab, 0.85));
      break;
    }
    case 'butaca': {
      b.box(0, 0.2, 0, w, 0.3, d, fab);
      b.box(0.06, 0.4, 0, w - 0.16, 0.12, d - 0.3, shade(fab, 1.18));
      b.box(-w / 2 + 0.06, 0.58, 0, 0.12, 0.55, d, fab);
      for (const s of [-1, 1]) b.box(0.0, 0.43, s * (d / 2 - 0.06), w, 0.3, 0.12, shade(fab, 0.85));
      break;
    }
    case 'silla': {
      b.box(0, 0.45, 0, 0.46, 0.06, 0.46, shade(fab, 1.0));
      b.box(-0.21, 0.7, 0, 0.05, 0.42, 0.44, fab);
      b.cyl(0, 0.22, 0, 0.03, 0.03, 0.4, 0x2a2f38, undefined, 6);
      b.box(0, 0.03, 0, 0.44, 0.04, 0.06, 0x2a2f38, { outline: false });
      b.box(0, 0.03, 0, 0.06, 0.04, 0.44, 0x2a2f38, { outline: false });
      break;
    }
    case 'maceta': {
      b.cyl(0, 0.17, 0, 0.13, 0.095, 0.34, 0xb5651d, undefined, 10);
      b.cyl(0, 0.34, 0, 0.115, 0.115, 0.02, 0x4a3320, { outline: false }, 10);
      b.cyl(0, 0.9, 0, 0.02, 0.03, 1.1, 0x3b7a3a, undefined, 6);
      const g = [0x2f8f3a, 0x3fae4a, 0x287a34];
      const spots: [number, number, number, number][] = [
        [0, 1.5, 0, 0.17], [0.08, 1.25, 0.04, 0.14], [-0.07, 1.05, -0.05, 0.15], [0.07, 0.82, -0.06, 0.13], [-0.06, 0.62, 0.06, 0.12], [0, 1.4, -0.07, 0.12],
      ];
      spots.forEach((s, i) => b.sph(s[0], s[1], s[2], s[3], g[i % 3], undefined, 1, 1.15, 1));
      break;
    }
  }
  const { geo, hull } = b.build();
  return { geo, hull, led };
}

/** Muebles estáticos de un nivel. Un InstancedMesh por tipo + otro de contorno. */
export class FurnitureLayer {
  group = new THREE.Group();
  private owned = new Owned();
  private casters: THREE.InstancedMesh[] = [];

  constructor(furniture: FurnitureInst[], theme: Theme, assets: Assets | null = null) {
    const th = THEMES[theme];
    const byType = new Map<FurnitureType, FurnitureInst[]>();
    for (const f of furniture) {
      const l = byType.get(f.type);
      if (l) l.push(f); else byType.set(f.type, [f]);
    }
    const mat = this.owned.add(makeToonVC());
    const hullMat = this.owned.add(makeOutlineMat());
    const fancyHull = this.owned.add(makeHullMaterial(0.02));
    const ledMat = this.owned.add(new THREE.MeshBasicMaterial({ vertexColors: true }));
    const q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), m = new THREE.Matrix4();
    const up = new THREE.Vector3(0, 1, 0);

    for (const [type, list] of byType) {
      let model: FurnModel | null = null;
      if (assets) {
        try {
          const m = buildFurnitureFromAssets(type, theme, assets);
          if (m) model = { geo: m.geo, hull: m.geo, led: m.led, fancy: true };
        } catch { model = null; }
      }
      if (!model) model = buildFurniture(type, th, theme);
      const sp = FURNITURE[type];
      const meshes: THREE.InstancedMesh[] = [];
      const mk = (g: THREE.BufferGeometry, mt: THREE.Material): THREE.InstancedMesh => {
        this.owned.add(g);
        const im = new THREE.InstancedMesh(g, mt, list.length);
        meshes.push(im);
        this.group.add(im);
        return im;
      };
      const body = mk(model.geo, mat);
      this.casters.push(body);
      const hull = model.hull ? mk(model.hull, model.fancy ? fancyHull : hullMat) : null;
      const led = model.led ? mk(model.led, ledMat) : null;
      list.forEach((f, i) => {
        q.setFromAxisAngle(up, -f.angle);
        p.set(f.x, 0, f.y);
        s.set(f.hw / (sp.w / 2), (f.height || sp.height) / sp.height, f.hd / (sp.d / 2));
        m.compose(p, q, s);
        body.setMatrixAt(i, m); hull?.setMatrixAt(i, m); led?.setMatrixAt(i, m);
      });
      for (const im of meshes) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
    }
    this.buildContactShadows(furniture);
  }

  /** Oclusión falsa: mancha suave y oscura bajo cada mueble (un solo InstancedMesh). */
  private buildContactShadows(furniture: FurnitureInst[]): void {
    if (!furniture.length) return;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const rg = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    rg.addColorStop(0, 'rgba(0,0,0,0.55)'); rg.addColorStop(0.6, 'rgba(0,0,0,0.3)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    const tex = this.owned.add(new THREE.CanvasTexture(c));
    const geo = this.owned.add(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    const mat = this.owned.add(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    const im = new THREE.InstancedMesh(geo, mat, furniture.length);
    const q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), m = new THREE.Matrix4();
    const up = new THREE.Vector3(0, 1, 0);
    furniture.forEach((f, i) => {
      q.setFromAxisAngle(up, -f.angle);
      p.set(f.x, 0.014, f.y);
      s.set(f.hw * 2 + 0.7, 1, f.hd * 2 + 0.7);
      im.setMatrixAt(i, m.compose(p, q, s));
    });
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    this.group.add(im);
  }

  /** Activa/desactiva proyectar y recibir sombras reales. */
  setShadows(on: boolean): void {
    for (const im of this.casters) { im.castShadow = on; im.receiveShadow = on; }
  }

  dispose(): void { this.owned.disposeAll(); }
}

// ───────────────────────── Objetos del suelo ─────────────────────────

const ITEM_SIZE: Record<string, number> = { '20': 0.34, '50': 0.46, '100': 0.6 };

function buildItem(type: ItemType): { geo: THREE.BufferGeometry; hull: THREE.BufferGeometry | null; size: number } {
  const isMed = type.startsWith('vida');
  const size = ITEM_SIZE[type.split('_')[1]] ?? 0.4;
  const s = size;
  const b = new GeoBuilder(0.018);
  if (isMed) {
    b.box(0, 0, 0, s, s * 0.85, s, 0xf4f6f4);
    const g = 0x1fa84f, e = 0.006;
    const hy = s * 0.85 / 2;
    for (const sg of [-1, 1]) {
      b.box(sg * (s / 2 + e), 0, 0, 0.012, s * 0.56, s * 0.17, g, { outline: false });
      b.box(sg * (s / 2 + e), 0, 0, 0.012, s * 0.17, s * 0.56, g, { outline: false });
      b.box(0, 0, sg * (s / 2 + e), s * 0.17, s * 0.56, 0.012, g, { outline: false });
      b.box(0, 0, sg * (s / 2 + e), s * 0.56, s * 0.17, 0.012, g, { outline: false });
    }
    b.box(0, hy + e, 0, s * 0.56, 0.012, s * 0.17, g, { outline: false });
    b.box(0, hy + e, 0, s * 0.17, 0.012, s * 0.56, g, { outline: false });
  } else {
    b.box(0, 0, 0, s, s * 0.85, s, 0xf2c200);
    const k = 0x15151a;
    b.box(0, s * 0.22, 0, s * 1.015, s * 0.14, s * 1.015, k, { outline: false });
    b.box(0, -s * 0.22, 0, s * 1.015, s * 0.14, s * 1.015, k, { outline: false });
    b.box(0, s * 0.85 / 2 + 0.006, 0, s * 0.5, 0.012, s * 0.2, k, { outline: false });   // «asa»
  }
  const { geo, hull } = b.build();
  return { geo, hull, size };
}

interface PickupView { root: THREE.Group; size: number }

export class PickupLayer {
  group = new THREE.Group();
  private assets: Assets | null = null;
  private healthHull = makeHullMaterial(0.035);
  private models = new Map<ItemType, { geo: THREE.BufferGeometry; hull: THREE.BufferGeometry | null; size: number }>();
  private views = new Map<number, PickupView>();
  private mat = makeToonVC();
  private hullMat = makeOutlineMat();

  /** Botiquín del modelo Quaternius (CC0), cuando termina la carga. */
  setAssets(a: Assets | null): void {
    this.assets = a;
    if (a?.health && !a.health.getAttribute('hullDir')) computeHullDir(a.health);
    this.clear();
    for (const m of this.models.values()) { m.geo.dispose(); m.hull?.dispose(); }
    this.models.clear();
  }

  update(world: IWorld, time: number): void {
    const seen = new Set<number>();
    for (const pk of world.pickups) {
      if (pk.taken) continue;
      seen.add(pk.id);
      let v = this.views.get(pk.id);
      if (!v) {
        const useHealth = pk.type.startsWith('vida') && this.assets?.health;
        let md = this.models.get(pk.type);
        if (!md) {
          md = useHealth ? { geo: this.assets!.health!, hull: null, size: ITEM_SIZE[pk.type.split('_')[1]] ?? 0.4 } : buildItem(pk.type);
          this.models.set(pk.type, md);
        }
        const root = new THREE.Group();
        if (useHealth) {
          // modelo normalizado a 1 m: se escala al tamaño del botiquín (20/50/100)
          const m1 = new THREE.Mesh(md.geo, this.mat), m2 = new THREE.Mesh(md.geo, this.healthHull);
          const sc = md.size * 1.5;
          m1.scale.setScalar(sc); m2.scale.setScalar(sc);
          root.add(m1, m2);
        } else {
          root.add(new THREE.Mesh(md.geo, this.mat));
          if (md.hull) root.add(new THREE.Mesh(md.hull, this.hullMat));
        }
        this.group.add(root);
        v = { root, size: md.size };
        this.views.set(pk.id, v);
      }
      v.root.position.set(pk.x, 0.45 + v.size * 0.45 + Math.sin(time * 2.2 + pk.id) * 0.08, pk.y);
      v.root.rotation.y = time * 1.3 + pk.id;
    }
    if (this.views.size !== seen.size) {
      for (const [id, v] of this.views) if (!seen.has(id)) { this.group.remove(v.root); this.views.delete(id); }
    }
  }

  clear(): void {
    for (const v of this.views.values()) this.group.remove(v.root);
    this.views.clear();
  }

  dispose(): void {
    this.clear();
    for (const m of this.models.values()) { m.geo.dispose(); m.hull?.dispose(); }
    this.models.clear();
    this.mat.dispose(); this.hullMat.dispose(); this.healthHull.dispose();
  }
}
