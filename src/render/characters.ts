// Personajes: modelos con primitivas (una silueta propia por tipo), animación y gestor de vistas.
//
// Por personaje: cuerpo fusionado (torso+cabeza+accesorios, color por vértice) + su contorno,
// brazos+arma (un mesh que se mueve para retroceso/tajo/recarga) y dos piernas = 5 llamadas de dibujo.
// Las sombras «blob» y las barras de vida son InstancedMesh únicos para toda la escena.

import * as THREE from 'three';
import type { Entity, Kind } from '../sim/types';
import type { IWorld } from '../contracts';
import { statsOf } from '../sim/data';
import { GeoBuilder, Owned, makeOutlineMat, makeToonVC } from './geo';
import { unitPalette, type UnitPalette } from './palette';

interface Model {
  body: THREE.BufferGeometry;
  hull: THREE.BufferGeometry | null;
  arms: THREE.BufferGeometry;
  legs: THREE.BufferGeometry;
  hipY: number;
  /** altura (desde la cadera) del hombro, pivote de los brazos */
  armPivotY: number;
  legZ: number;
  height: number;
  barW: number;
}

const SKINDARK = 0x1a1a22;

function rifle(a: GeoBuilder, x0: number, x1: number, y: number, z: number, th: number, col: number, mag = true): void {
  a.bar(x0, y, z, x1, y + 0.02, z, th, col);
  a.box(x0 - 0.08, y - 0.02, z, 0.2, th * 1.5, th * 0.9, col);          // culata
  if (mag) a.box(x0 + (x1 - x0) * 0.4, y - 0.13, z, 0.06, 0.18, th * 0.8, col);  // cargador
  a.bar(x1, y + 0.02, z, x1 + 0.18, y + 0.02, z, th * 0.45, 0x555a62, { outline: false }); // boca
}

function arm(a: GeoBuilder, sx: number, sy: number, sz: number, hx: number, hy: number, hz: number, th: number, col: number, skin: number): void {
  a.bar(sx, sy, sz, hx, hy, hz, th, col);
  a.sph(hx, hy, hz, th * 0.62, skin, { outline: false });
}

function legGeo(hipY: number, lw: number, ld: number, col: number, boot: number): THREE.BufferGeometry {
  const b = new GeoBuilder(0);
  b.box(0, -hipY / 2 + 0.04, 0, ld, hipY - 0.08, lw, col);
  b.box(ld * 0.18, -hipY + 0.05, 0, ld * 1.5, 0.1, lw * 1.05, boot);
  return b.build().geo;
}

function head(b: GeoBuilder, y: number, r: number, skin: number, visor = true): void {
  b.sph(0, y, 0, r, skin);
  if (visor) b.box(r * 0.78, y + 0.01, 0, r * 0.45, r * 0.3, r * 1.5, SKINDARK, { outline: false });
}

function buildModel(kind: Kind, cb: boolean): Model {
  const p: UnitPalette = unitPalette(kind, cb);
  const hostile = kind.startsWith('enemy') || kind === 'miniboss' || kind === 'megaboss';
  const b = new GeoBuilder(kind === 'megaboss' ? 0.06 : kind === 'miniboss' ? 0.05 : 0.035);
  const a = new GeoBuilder(0);
  let hipY = 0.88, h = 0.58, w = 0.46, lw = 0.16, ld = 0.17, legZ = 0.12;
  let legCol = p.dark;
  let barW = 0.7;

  const torso = (d: number, col = p.main): void => {
    b.box(0, h / 2, 0, d, h, w, col);
    b.box(0, 0.02, 0, d * 0.96, 0.16, w * 0.88, p.dark);   // pelvis / cinturón
  };

  switch (kind) {
    case 'captain': {
      h = 0.58; w = 0.46; legCol = 0x1a2650;
      torso(0.28);
      b.box(0.145, h * 0.55, 0, 0.02, 0.1, w * 0.7, p.trim, { outline: false });      // galones
      for (const s of [-1, 1]) b.box(0, h - 0.02, s * (w / 2 + 0.07), 0.24, 0.09, 0.2, p.light); // hombreras
      head(b, h + 0.2, 0.16, p.skin);
      b.sph(-0.03, h + 0.33, 0.04, 0.17, 0x0e1a3c, undefined, 1, 0.38, 1);           // boina caída
      b.box(0.08, h + 0.36, 0.04, 0.05, 0.05, 0.05, p.trim, { outline: false });
      arm(a, 0, h - 0.08, w / 2 + 0.02, 0.38, 0.36, 0.2, 0.11, p.main, p.skin);
      arm(a, 0, h - 0.08, -w / 2 - 0.02, 0.58, 0.4, 0.08, 0.11, p.main, p.skin);
      rifle(a, 0.02, 0.95, 0.4, 0.19, 0.07, 0x222831);
      break;
    }
    case 'technic': {
      h = 0.56; w = 0.36; lw = 0.12; ld = 0.14; legZ = 0.1; legCol = 0x155058;
      torso(0.22);
      b.box(0.115, h * 0.5, 0, 0.02, 0.14, w * 0.9, p.dark, { outline: false });
      head(b, h + 0.19, 0.15, p.skin, false);
      b.box(0.12, h + 0.2, 0, 0.08, 0.08, 0.27, p.trim, { outline: false });          // gafas
      b.box(-0.18, h + 0.31, 0, 0.1, 0.06, 0.3, p.dark);                                // diadema
      b.box(-0.19, 0.3, 0, 0.18, 0.4, 0.3, p.dark);                                      // mochila
      b.bar(-0.2, 0.46, 0.1, -0.24, 1.18, 0.1, 0.03, 0x2a2f38);                           // antena larga
      b.sph(-0.24, 1.2, 0.1, 0.05, 0xff3b30, { outline: false });
      arm(a, 0, h - 0.07, w / 2 + 0.02, 0.32, 0.36, 0.16, 0.09, p.main, p.skin);
      arm(a, 0, h - 0.07, -w / 2 - 0.02, 0.42, 0.38, 0.06, 0.09, p.main, p.skin);
      rifle(a, 0.08, 0.6, 0.4, 0.15, 0.06, 0x2a2f38);
      break;
    }
    case 'especialist': {
      h = 0.62; w = 0.64; lw = 0.2; ld = 0.22; legZ = 0.17; legCol = 0x0e3f38;
      torso(0.38);
      b.box(0.2, h * 0.55, 0, 0.02, 0.3, w * 0.7, p.dark);
      b.bar(0.2, h - 0.04, -w * 0.4, 0.2, 0.08, w * 0.4, 0.07, p.trim);                // bandolera de munición
      for (const s of [-1, 1]) b.box(0, h - 0.0, s * (w / 2 + 0.08), 0.28, 0.13, 0.24, p.light);
      head(b, h + 0.2, 0.16, p.skin);
      b.sph(0, h + 0.25, 0, 0.2, p.dark, undefined, 1, 0.85, 1);                         // casco
      arm(a, 0, h - 0.08, w / 2 + 0.04, 0.4, 0.38, 0.22, 0.14, p.main, p.skin);
      arm(a, 0, h - 0.08, -w / 2 - 0.04, 0.7, 0.36, 0.1, 0.14, p.main, p.skin);
      a.bar(-0.2, 0.4, 0.2, 1.15, 0.45, 0.2, 0.09, 0x20252c);                             // ametralladora larga
      a.cyl(0.3, 0.2, 0.2, 0.12, 0.12, 0.14, 0x2a2f38, undefined, 12);                    // tambor
      a.bar(1.0, 0.43, 0.2, 1.15, 0.2, 0.28, 0.03, 0x2a2f38, { outline: false });        // bípode
      a.bar(1.0, 0.43, 0.2, 1.15, 0.2, 0.12, 0.03, 0x2a2f38, { outline: false });
      a.bar(1.15, 0.45, 0.2, 1.4, 0.45, 0.2, 0.05, 0x555a62, { outline: false });
      barW = 0.7;
      break;
    }
    case 'explosives': {
      h = 0.62; w = 0.58; lw = 0.19; ld = 0.21; legZ = 0.16; legCol = 0x16224a;
      torso(0.4);
      b.box(0, h * 0.72, 0, 0.42, 0.09, w + 0.02, p.trim);                              // faja amarilla
      b.box(-0.26, 0.32, 0, 0.14, 0.34, 0.34, p.dark);                                   // caja de munición
      b.box(-0.34, 0.32, 0, 0.03, 0.12, 0.34, p.trim, { outline: false });
      head(b, h + 0.2, 0.16, p.skin);
      b.sph(0, h + 0.24, 0, 0.2, p.dark, undefined, 1, 0.9, 1);
      b.box(0, h + 0.43, 0, 0.34, 0.03, 0.08, p.trim, { outline: false });              // raya del casco
      // lanzador grueso al hombro, sobresale por encima del hombro derecho
      a.tube(-0.45, h + 0.14, 0.3, 0.85, h + 0.14, 0.3, 0.13, 0x3c4048, undefined, 10);
      a.cyl(0.86, h + 0.14, 0.3, 0.12, 0.19, 0.14, 0x2a2d33, { rot: [0, 0, Math.PI / 2] }, 10);
      a.cyl(0.1, h + 0.14, 0.3, 0.145, 0.145, 0.07, p.trim, { rot: [0, 0, Math.PI / 2], outline: false }, 10);
      a.cyl(0.5, h + 0.14, 0.3, 0.145, 0.145, 0.07, p.trim, { rot: [0, 0, Math.PI / 2], outline: false }, 10);
      a.bar(0.2, h + 0.1, 0.3, 0.22, 0.45, 0.27, 0.05, 0x2a2d33);
      arm(a, 0, h - 0.08, w / 2 + 0.04, 0.22, 0.46, 0.27, 0.13, p.main, p.skin);
      arm(a, 0, h - 0.08, -w / 2 - 0.04, 0.5, h + 0.0, 0.2, 0.13, p.main, p.skin);
      barW = 0.7;
      break;
    }
    case 'enemy1': {
      h = 0.55; w = 0.38; lw = 0.12; ld = 0.14; legZ = 0.1; legCol = 0x3a2a1a;
      torso(0.22);
      b.box(0.115, h * 0.5, 0, 0.02, 0.5, 0.11, p.trim, { outline: false });            // camisa clara
      head(b, h + 0.2, 0.15, p.skin, false);
      b.box(0.13, h + 0.21, 0, 0.06, 0.05, 0.24, 0x000000, { outline: false });          // gafas oscuras
      b.cyl(0, h + 0.36, 0, 0.16, 0.16, 0.07, p.dark, undefined, 12);                    // gorra
      b.box(0.17, h + 0.33, 0, 0.14, 0.03, 0.2, p.dark);                                  // visera
      arm(a, 0, h - 0.07, w / 2, 0.46, 0.52, 0.12, 0.09, p.main, p.skin);
      arm(a, 0, h - 0.07, -w / 2, 0.05, 0.2, -0.2, 0.09, p.main, p.skin);
      a.bar(0.42, 0.52, 0.12, 0.66, 0.53, 0.12, 0.06, 0x1d2026);                          // pistola
      barW = 0.6;
      break;
    }
    case 'enemy2': {
      h = 0.58; w = 0.52; lw = 0.16; ld = 0.18; legZ = 0.13; legCol = 0x3a3320;
      torso(0.3);
      b.box(0.02, h * 0.55, 0, 0.32, h * 0.62, w + 0.03, p.dark);                          // chaleco
      b.box(-0.26, 0.3, 0, 0.22, 0.44, 0.4, p.trim);                                       // mochila grande
      b.box(-0.26, 0.58, 0, 0.18, 0.1, 0.34, p.dark);
      head(b, h + 0.2, 0.16, p.skin);
      b.box(0, h + 0.28, 0, 0.33, 0.06, 0.33, 0x701818, { outline: false });              // pañuelo
      for (const s of [-1, 1]) b.box(0, h - 0.02, s * (w / 2 + 0.04), 0.2, 0.07, 0.14, p.dark);
      arm(a, 0, h - 0.08, w / 2 + 0.01, 0.36, 0.38, 0.18, 0.11, p.main, p.skin);
      arm(a, 0, h - 0.08, -w / 2 - 0.01, 0.56, 0.4, 0.06, 0.11, p.main, p.skin);
      rifle(a, 0.02, 0.88, 0.4, 0.17, 0.075, 0x2c2a22);
      break;
    }
    case 'enemy3': {
      h = 0.66; w = 0.7; lw = 0.22; ld = 0.24; legZ = 0.18; legCol = 0x2e0c0c;
      torso(0.42);
      b.box(0.22, h * 0.62, 0, 0.03, 0.34, w * 0.74, p.trim);                             // placa pectoral
      for (const s of [-1, 1]) b.box(0, h + 0.0, s * (w / 2 + 0.08), 0.3, 0.15, 0.26, p.dark);
      for (let i = -1; i <= 1; i++) b.sph(0.2, 0.12, i * 0.2, 0.05, 0x888070, { outline: false }); // granadas
      b.sph(0, h + 0.22, 0, 0.16, p.skin);
      b.box(0.14, h + 0.21, 0, 0.06, 0.07, 0.24, SKINDARK, { outline: false });
      b.sph(0, h + 0.27, 0, 0.22, p.dark, undefined, 1, 0.85, 1);                         // casco
      b.cyl(0, h + 0.21, 0, 0.27, 0.27, 0.04, p.dark, undefined, 14);                    // ala del casco
      arm(a, 0, h - 0.09, w / 2 + 0.05, 0.4, 0.4, 0.24, 0.15, p.main, p.skin);
      arm(a, 0, h - 0.09, -w / 2 - 0.05, 0.64, 0.4, 0.08, 0.15, p.main, p.skin);
      rifle(a, -0.05, 1.0, 0.42, 0.22, 0.11, 0x2a1c1c);
      a.cyl(0.36, 0.22, 0.22, 0.11, 0.11, 0.14, 0x2a1c1c, undefined, 12);
      barW = 0.75;
      break;
    }
    case 'miniboss': {
      hipY = 1.0; h = 0.8; w = 0.98; lw = 0.3; ld = 0.32; legZ = 0.26; legCol = p.dark;
      torso(0.6);
      b.box(0.31, h * 0.6, 0, 0.03, 0.5, w * 0.75, p.trim);
      for (const s of [-1, 1]) {
        b.box(0, h + 0.02, s * (w / 2 + 0.12), 0.42, 0.2, 0.36, p.dark);
        b.cyl(0, h + 0.22, s * (w / 2 + 0.12), 0, 0.11, 0.3, p.trim, undefined, 8);      // pinchos
      }
      head(b, h + 0.22, 0.2, p.skin);
      b.sph(0, h + 0.27, 0, 0.25, p.dark, undefined, 1, 0.85, 1);
      arm(a, 0, h - 0.1, w / 2 + 0.12, 0.45, 0.6, 0.3, 0.22, p.main, p.skin);
      arm(a, 0, h - 0.1, -w / 2 - 0.12, 0.75, 0.55, 0.0, 0.22, p.main, p.skin);
      // lanzacohetes enorme sobre el hombro derecho
      a.tube(-0.7, h + 0.16, 0.5, 1.1, h + 0.16, 0.5, 0.19, 0x3a3d44, undefined, 10);
      a.cyl(1.12, h + 0.16, 0.5, 0.15, 0.27, 0.2, 0x25272c, { rot: [0, 0, Math.PI / 2] }, 10);
      a.cyl(1.0, h + 0.16, 0.5, 0, 0.13, 0.3, 0xff7a1a, { rot: [0, 0, -Math.PI / 2], outline: false }, 8); // ojiva
      a.box(0.3, h - 0.1, 0.5, 0.2, 0.24, 0.14, 0x25272c);
      barW = 1.0;
      break;
    }
    default: { // megaboss
      hipY = 1.1; h = 0.95; w = 1.14; lw = 0.34; ld = 0.36; legZ = 0.3; legCol = p.dark;
      torso(0.66);
      b.box(0.34, h * 0.62, 0, 0.04, 0.6, w * 0.8, p.dark);                               // coraza negra
      b.box(0.37, h * 0.62, 0, 0.02, 0.06, w * 0.82, p.trim, { outline: false });         // vetas doradas
      b.box(0.37, h * 0.4, 0, 0.02, 0.06, w * 0.82, p.trim, { outline: false });
      for (const s of [-1, 1]) {
        b.box(0, h + 0.03, s * (w / 2 + 0.16), 0.5, 0.26, 0.44, p.dark);
        b.box(0, h + 0.17, s * (w / 2 + 0.16), 0.52, 0.04, 0.46, p.trim, { outline: false });
        b.cyl(0, h + 0.4, s * (w / 2 + 0.16), 0, 0.13, 0.4, p.trim, undefined, 8);
      }
      head(b, h + 0.24, 0.23, p.skin, false);
      b.sph(0, h + 0.3, 0, 0.29, p.dark, undefined, 1, 0.9, 1);
      b.box(0.26, h + 0.27, 0, 0.05, 0.07, 0.34, 0xffee00, { outline: false });          // ojos brillantes
      for (const s of [-1, 1]) {                                                          // cuernos
        b.cyl(0, h + 0.62, s * 0.34, 0, 0.09, 0.62, p.trim, { rot: [s * 0.65, 0, 0] }, 8);
      }
      b.box(-0.42, h - 0.5, 0, 0.05, 1.5, w + 0.34, 0x400610);                            // capa
      arm(a, 0, h - 0.12, w / 2 + 0.16, 0.5, 0.65, 0.4, 0.26, p.dark, p.skin);
      arm(a, 0, h - 0.12, -w / 2 - 0.16, 0.8, 0.62, 0.05, 0.26, p.dark, p.skin);
      for (const dz of [-0.09, 0, 0.09]) a.tube(0.1, 0.65, 0.42 + dz, 1.5, 0.65, 0.42 + dz, 0.05, 0x2a2d33, undefined, 8); // minigun
      a.box(0.1, 0.65, 0.42, 0.4, 0.28, 0.3, 0x1c1e22);
      barW = 1.2;
      break;
    }
  }

  // Formas extra para daltonismo: hostiles con crestas, aliados con aureola.
  if (cb) {
    if (hostile) {
      const top = h + (kind === 'megaboss' ? 0.65 : 0.45);
      b.cyl(0, top, 0, 0, 0.09, 0.26, p.trim, undefined, 4);
      for (const s of [-1, 1]) b.cyl(0, h + 0.18, s * (w / 2 + 0.13), 0, 0.07, 0.22, p.trim, { rot: [s * 0.9, 0, 0] }, 4);
    } else {
      b.cyl(0, h + 0.5, 0, 0.2, 0.2, 0.03, 0xffffff, { outline: false }, 14);
    }
  }

  const { geo: body, hull } = b.build();
  const armPivotY = h - 0.08;
  const { geo: arms } = a.build([0, armPivotY, 0]);
  const legs = legGeo(hipY, lw, ld, legCol, 0x15151b);
  const height = statsOf(kind).height;
  return { body, hull, arms, legs, hipY, armPivotY, legZ, height, barW };
}

// ───────────────────────── Gestor ─────────────────────────

const MAX_BARS = 128;
const _qCam = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _scl = new THREE.Vector3();
const _col = new THREE.Color();

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

class CharView {
  root = new THREE.Group();
  fall = new THREE.Group();
  upper = new THREE.Group();
  body: THREE.Mesh;
  hull: THREE.Mesh | null = null;
  arms: THREE.Mesh;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  knife: THREE.Mesh;
  mark: THREE.Mesh | null = null;
  shield: THREE.Mesh | null = null;
  ring: THREE.Mesh | null = null;
  // estado suavizado
  x = 0; y = 0; yaw = 0; crouchK = 0; speed = 0; phase = 0; init = false;
  /** dibujado «fantasma» (translúcido) porque tapa al jugador o a la cámara */
  ghost = false;
  constructor(public model: Model, public kind: Kind, mgr: CharManager) {
    this.body = new THREE.Mesh(model.body, mgr.matChar);
    this.arms = new THREE.Mesh(model.arms, mgr.matChar);
    this.arms.position.y = model.armPivotY;
    this.upper.add(this.body, this.arms);
    if (model.hull) { this.hull = new THREE.Mesh(model.hull, mgr.matHull); this.upper.add(this.hull); }
    this.legL = new THREE.Mesh(model.legs, mgr.matChar);
    this.legR = new THREE.Mesh(model.legs, mgr.matChar);
    this.legL.position.set(0, model.hipY, -model.legZ);
    this.legR.position.set(0, model.hipY, model.legZ);
    this.upper.position.y = model.hipY;
    this.knife = new THREE.Mesh(mgr.knifeGeo, mgr.knifeMat);
    this.knife.visible = false;
    this.knife.position.set(0.4, -0.15, 0.2);   // a la altura de la mano, relativo al hombro
    this.knife.rotation.z = 0.5;
    this.arms.add(this.knife);
    this.fall.add(this.upper, this.legL, this.legR);
    this.root.add(this.fall);
  }
}

export class CharManager {
  group = new THREE.Group();
  matChar: THREE.MeshToonMaterial;
  matDead: THREE.MeshToonMaterial;
  matFlash = new THREE.MeshBasicMaterial({ color: 0xffffff });
  matHull: THREE.MeshBasicMaterial;
  matGhost: THREE.MeshToonMaterial;
  knifeGeo: THREE.BufferGeometry;
  knifeMat = new THREE.MeshBasicMaterial({ color: 0xe6edf5 });
  private markGeo = new THREE.OctahedronGeometry(0.2, 0);
  private markMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  private shieldGeo = new THREE.SphereGeometry(1, 14, 10);
  private shieldMat = new THREE.MeshBasicMaterial({ color: 0x5fd8ff, transparent: true, opacity: 0.28, depthWrite: false });
  private ringGeo = new THREE.RingGeometry(0.66, 0.9, 32).rotateX(-Math.PI / 2);
  private ringMat = new THREE.MeshBasicMaterial({ color: 0xd8f2ff, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  private views = new Map<number, CharView>();
  private models = new Map<string, Model>();
  private shadows: THREE.InstancedMesh;
  private barBg: THREE.InstancedMesh;
  private barFg: THREE.InstancedMesh;
  private cb = false;
  private owned = new Owned();

  constructor() {
    this.matChar = makeToonVC();
    this.matDead = makeToonVC(); this.matDead.color.setHex(0x4a4a50);
    this.matHull = makeOutlineMat();
    this.matGhost = makeToonVC();
    this.matGhost.transparent = true; this.matGhost.opacity = 0.22; this.matGhost.depthWrite = false;
    this.owned.add(this.matGhost);
    this.knifeGeo = new THREE.BoxGeometry(0.34, 0.05, 0.03).translate(0.2, 0, 0);
    this.owned.add(this.matChar); this.owned.add(this.matDead); this.owned.add(this.matFlash); this.owned.add(this.matHull);
    this.owned.add(this.knifeGeo); this.owned.add(this.knifeMat); this.owned.add(this.markGeo); this.owned.add(this.markMat);
    this.owned.add(this.shieldGeo); this.owned.add(this.shieldMat); this.owned.add(this.ringGeo); this.owned.add(this.ringMat);

    const circle = new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2);
    const shMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.owned.add(circle); this.owned.add(shMat);
    this.shadows = new THREE.InstancedMesh(circle, shMat, MAX_BARS);
    this.shadows.frustumCulled = false; this.shadows.renderOrder = 1; this.shadows.count = 0;

    const quad = new THREE.PlaneGeometry(1, 1);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x0c0c12 });
    const fgMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.owned.add(quad); this.owned.add(bgMat); this.owned.add(fgMat);
    this.barBg = new THREE.InstancedMesh(quad, bgMat, MAX_BARS);
    this.barFg = new THREE.InstancedMesh(quad, fgMat, MAX_BARS);
    for (const m of [this.barBg, this.barFg]) { m.frustumCulled = false; m.count = 0; }
    this.barFg.setColorAt(0, _col.set(0xffffff));
    this.group.add(this.shadows, this.barBg, this.barFg);
  }

  setColorblind(cb: boolean): void {
    if (cb === this.cb) return;
    this.cb = cb;
    this.clear();
    for (const m of this.models.values()) { m.body.dispose(); m.hull?.dispose(); m.arms.dispose(); m.legs.dispose(); }
    this.models.clear();
  }

  private modelFor(kind: Kind): Model {
    let m = this.models.get(kind);
    if (!m) { m = buildModel(kind, this.cb); this.models.set(kind, m); }
    return m;
  }

  clear(): void {
    for (const v of this.views.values()) this.group.remove(v.root);
    this.views.clear();
    this.shadows.count = 0; this.barBg.count = 0; this.barFg.count = 0;
  }

  /** Posición suavizada de una entidad (la usa la depuración de IA). */
  posOf(id: number): { x: number; y: number } | null {
    const v = this.views.get(id);
    return v ? { x: v.x, y: v.y } : null;
  }

  update(world: IWorld, dt: number, camera: THREE.Camera): void {
    const time = world.time;
    camera.getWorldQuaternion(_qCam);
    _right.set(1, 0, 0).applyQuaternion(_qCam);
    _fwd.set(0, 0, -1).applyQuaternion(_qCam);

    const seen = new Set<number>();
    let ns = 0, nb = 0;

    for (const e of world.entities) {
      seen.add(e.id);
      let v = this.views.get(e.id);
      if (!v) {
        v = new CharView(this.modelFor(e.kind), e.kind, this);
        this.group.add(v.root);
        this.views.set(e.id, v);
      }
      this.updateGhost(v, e, world, camera);
      this.animate(v, e, time, dt);

      // sombra blob
      if (ns < MAX_BARS) {
        const r = e.radius * (e.alive ? 1.25 : 1.6);
        _scl.set(r, 1, r);
        _mat.compose(_v.set(v.x, 0.03, v.y), IDENT_Q, _scl);
        this.shadows.setMatrixAt(ns++, _mat);
      }

      // barra de vida: enemigos heridos y aliados heridos (el HUD ya enseña la vida del jugador)
      const wantBar = e.alive && !e.isPlayer && e.hp < e.maxHp && !v.ghost;
      if (wantBar && nb < MAX_BARS) {
        const frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
        const bw = v.model.barW;
        const bh = 0.08;
        const crouchH = THREE.MathUtils.lerp(v.model.height, 1.0, v.crouchK);
        _v.set(v.x, crouchH + 0.25, v.y);
        // fondo oscuro
        _scl.set(bw + 0.04, bh + 0.04, 1);
        _mat.compose(_v, _qCam, _scl);
        this.barBg.setMatrixAt(nb, _mat);
        // relleno alineado a la izquierda y un poco hacia la cámara (evita z-fighting)
        _v.addScaledVector(_right, -(bw * (1 - frac)) / 2).addScaledVector(_fwd, -0.02);
        _scl.set(Math.max(0.001, bw * frac), bh, 1);
        _mat.compose(_v, _qCam, _scl);
        this.barFg.setMatrixAt(nb, _mat);
        // verde -> rojo según vida (hostiles en daltonismo: amarillo)
        if (this.cb) _col.setHex(e.team === 'ally' ? 0x6a8cff : 0xffe100);
        else _col.setHSL(0.33 * frac, 0.9, 0.5);
        this.barFg.setColorAt(nb, _col);
        nb++;
      }
    }

    // entidades que ya no existen
    if (this.views.size !== seen.size) {
      for (const [id, v] of this.views) {
        if (!seen.has(id)) { this.group.remove(v.root); this.views.delete(id); }
      }
    }

    this.shadows.count = ns; this.shadows.instanceMatrix.needsUpdate = true;
    this.barBg.count = nb; this.barFg.count = nb;
    this.barBg.instanceMatrix.needsUpdate = true;
    this.barFg.instanceMatrix.needsUpdate = true;
    if (this.barFg.instanceColor) this.barFg.instanceColor.needsUpdate = true;
  }

  /** Decide (con histéresis) si el personaje se dibuja translúcido por taparle la vista al jugador. */
  private updateGhost(v: CharView, e: Entity, world: IWorld, camera: THREE.Camera): void {
    let want = false;
    if (e.alive) {
      const cx = camera.position.x, cz = camera.position.z;
      const px = world.player.x, py = world.player.y;
      if (e.isPlayer) {
        // cámara pegada a una pared: el propio jugador se vuelve fantasma
        want = Math.hypot(cx - px, cz - py) < (v.ghost ? 1.3 : 1.1);
      } else if (e.team === 'ally') {
        const sx = px - cx, sz = py - cz;
        const l2 = sx * sx + sz * sz;
        const dc = Math.hypot(v.x - cx, v.y - cz);
        let near = false;
        if (l2 > 1e-6) {
          const t = ((v.x - cx) * sx + (v.y - cz) * sz) / l2;
          if (t > 0 && t < 1) near = Math.hypot(v.x - (cx + sx * t), v.y - (cz + sz * t)) < (v.ghost ? 1.25 : 1.0);
        }
        want = near || dc < (v.ghost ? 1.9 : 1.6);
      }
    }
    v.ghost = want;
  }

  private animate(v: CharView, e: Entity, time: number, dt: number): void {
    const m = v.model;
    // ── interpolación exponencial de posición y orientación
    const k = 1 - Math.exp(-dt * (e.isPlayer ? 30 : 24));
    if (!v.init || Math.hypot(e.x - v.x, e.y - v.y) > 3) { v.x = e.x; v.y = e.y; v.yaw = e.yaw; v.init = true; }
    else {
      v.x += (e.x - v.x) * k; v.y += (e.y - v.y) * k;
      v.yaw = lerpAngle(v.yaw, e.yaw, 1 - Math.exp(-dt * 18));
    }
    v.root.position.set(v.x, 0, v.y);
    v.root.rotation.y = -v.yaw;

    // ── vivo / muerto
    const alive = e.alive;
    const dead = !alive;
    const mat = dead ? this.matDead : v.ghost ? this.matGhost : this.matChar;
    const hurt = alive && !v.ghost && time - e.lastHurtAt < 0.12 && time >= e.lastHurtAt;
    const bodyMat = hurt ? this.matFlash : mat;
    if (v.hull) v.hull.visible = !v.ghost;
    v.body.material = bodyMat; v.arms.material = bodyMat;
    v.legL.material = mat; v.legR.material = mat;

    // caída
    let fallT = 0;
    if (dead) fallT = e.deadAt < 0 ? 1 : Math.max(0, Math.min(1, (time - e.deadAt) / 0.5));
    const fe = fallT * fallT * (3 - 2 * fallT);
    v.fall.rotation.z = fe * (Math.PI / 2);
    v.fall.position.y = fe * Math.min(0.4, e.radius * 0.55);

    // ── agachado y caminar
    const crouchTarget = alive && e.crouch ? 1 : 0;
    v.crouchK += (crouchTarget - v.crouchK) * (1 - Math.exp(-dt * 14));
    const c = v.crouchK;
    const sp = alive ? Math.hypot(e.vx, e.vy) : 0;
    v.speed += (sp - v.speed) * (1 - Math.exp(-dt * 12));
    v.phase += v.speed * dt * 4.2;
    const amp = Math.min(1, v.speed / 3.2) * 0.75 * (1 - 0.4 * c);
    const sw = Math.sin(v.phase) * amp;
    v.legL.rotation.z = sw; v.legR.rotation.z = -sw;
    const legScale = 1 - 0.6 * c;
    v.legL.scale.y = v.legR.scale.y = legScale;
    v.legL.position.y = v.legR.position.y = m.hipY * legScale;
    const bob = Math.abs(Math.cos(v.phase)) * 0.035 * Math.min(1, v.speed / 3.2);
    v.upper.position.y = m.hipY * legScale + bob;
    v.upper.scale.y = 1 - 0.35 * c;

    // ── brazos: retroceso, tajo, recarga, inclinación del apuntado
    let ax = 0, az = 0, ay = 0, uy = 0;
    if (alive) {
      const ts = time - e.lastShotAt;
      if (ts >= 0 && ts < 0.12) { const f = 1 - ts / 0.12; ax -= 0.09 * f; az += 0.07 * f; }
      const tk = (time - e.lastKnifeAt) / 0.3;
      if (tk >= 0 && tk < 1) {
        ay = (0.5 - tk) * 2.0; ax += 0.28 * Math.sin(Math.PI * tk); uy = ay * 0.35;
        v.knife.visible = true;
      } else v.knife.visible = false;
      if (e.reloading > 0) az -= 0.8;
      if (e.isPlayer) az += e.pitch * 0.7;
    } else v.knife.visible = false;
    v.arms.position.x = ax; v.arms.rotation.z = az; v.arms.rotation.y = ay;
    v.upper.rotation.y = uy;

    // ── marca, escudo y anillo del jugador
    const wantMark = alive && e.marked;
    if (wantMark && !v.mark) { v.mark = new THREE.Mesh(this.markGeo, this.markMat); v.mark.scale.set(1, 1.5, 1); v.root.add(v.mark); }
    if (v.mark) {
      v.mark.visible = wantMark;
      if (wantMark) {
        v.mark.position.y = THREE.MathUtils.lerp(m.height, 1.0, c) + 0.55 + Math.sin(time * 4) * 0.06;
        v.mark.rotation.y = time * 2.5 - v.root.rotation.y;
      }
    }
    const wantShield = alive && e.shielded;
    if (wantShield && !v.shield) { v.shield = new THREE.Mesh(this.shieldGeo, this.shieldMat); v.root.add(v.shield); }
    if (v.shield) {
      v.shield.visible = wantShield;
      if (wantShield) {
        const r = Math.max(m.height * 0.62, e.radius * 1.5) * (1 + Math.sin(time * 5) * 0.025);
        v.shield.scale.set(r * 0.9, r, r * 0.9);
        v.shield.position.y = m.height * 0.5;
      }
    }
    if (e.isPlayer) {
      if (!v.ring) { v.ring = new THREE.Mesh(this.ringGeo, this.ringMat); v.ring.position.y = 0.04; v.ring.renderOrder = 3; v.root.add(v.ring); }
      v.ring.visible = alive;
      const s = 1 + Math.sin(time * 3) * 0.04;
      v.ring.scale.set(s * e.radius / 0.4, 1, s * e.radius / 0.4);
    }
  }

  dispose(): void {
    this.clear();
    for (const m of this.models.values()) { m.body.dispose(); m.hull?.dispose(); m.arms.dispose(); m.legs.dispose(); }
    this.models.clear();
    this.shadows.dispose(); this.barBg.dispose(); this.barFg.dispose();
    this.owned.disposeAll();
  }
}

const IDENT_Q = new THREE.Quaternion();
