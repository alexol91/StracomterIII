// Modelos de oficina de 3DAssets.dev (CC0, generados por IA, GLB con KHR_mesh_quantization) y props
// con textura de Poly Haven. Cada GLB se hornea en UNA geometría Float32 sin índice con color por
// vértice y un atributo `cls` (0 = mate, 1 = metal) para dibujar con dos materiales PBR.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { modelsUrl } from './assets';

export const OFFICE_FILES = [
  'desk-executive', 'desk-1600-panel-end', 'desk-1800-a-frame', 'executive-chair', 'task-chair-mesh', 'task-chair-upholstered',
  'monitor-24-inch', 'monitor-34-curved', 'keyboard-full-size', 'meeting-table-round-4', 'meeting-chair-castors', 'boardroom-table-8',
  'bookcase-open', 'locker-bank-6', 'tambour-cupboard', 'sofa-two-seat', 'lounge-armchair', 'guest-chair-four-leg', 'stacking-chair',
  'flip-top-table', 'floor-planter-large', 'wall-clock', 'waste-bin', 'wall-art-panel', 'rooftop-ac-unit',
  'L-server-rack-42u-doors', 'L-lobby-armchair', 'L-visitor-sofa-two-seat', 'L-fire-extinguisher-point', 'L-wall-wayfinding-panel',
] as const;

export interface OfficeAssets {
  /** piezas horneadas por nombre de fichero (sin .glb) */
  parts: Map<string, THREE.BufferGeometry>;
  /** botiquín y caja de munición (glTF con texturas), o null */
  medical: THREE.Object3D | null;
  ammo: THREE.Object3D | null;
}

function toFloat(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const out = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i++) { out[i * 3] = a.getX(i); out[i * 3 + 1] = a.getY(i); out[i * 3 + 2] = a.getZ(i); }
  return new THREE.BufferAttribute(out, 3);
}

/** Hornea un glTF estático: coordenadas relativas a la raíz, color de material por vértice, clase mate/metal. */
export function bakeClasses(obj: THREE.Object3D): THREE.BufferGeometry | null {
  obj.updateMatrixWorld(true);
  const inv = obj.matrixWorld.clone().invert();
  const pos: number[] = [], nor: number[] = [], col: number[] = [], cls: number[] = [];
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
    const M = inv.clone().multiply(m.matrixWorld);
    nm.getNormalMatrix(M);
    const g = m.geometry;
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    const idx = g.index;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
    const count = idx ? idx.count : p.count;
    const groups = g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0] ?? mats[0];
      const c = mat.color ?? new THREE.Color(1, 1, 1);
      const name = (mat.name || '').toLowerCase();
      const isGlass = name === 'glass';
      const cr = isGlass ? 0.02 : c.r, cg = isGlass ? 0.03 : c.g, cb = isGlass ? 0.04 : c.b;
      const k = !isGlass && (mat.metalness ?? 0) >= 0.5 ? 1 : 0;
      for (let t = gr.start; t < gr.start + gr.count; t++) {
        const vi = idx ? idx.getX(t) : t;
        v.set(p.getX(vi), p.getY(vi), p.getZ(vi)).applyMatrix4(M);
        pos.push(v.x, v.y, v.z);
        if (n) { v.set(n.getX(vi), n.getY(vi), n.getZ(vi)).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z); } else nor.push(0, 1, 0);
        col.push(cr, cg, cb); cls.push(k);
      }
    }
  });
  if (!pos.length) return null;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('cls', new THREE.Float32BufferAttribute(cls, 1));
  void toFloat;
  return out;
}

let promise: Promise<OfficeAssets | null> | null = null;
let ready: OfficeAssets | null = null;
export function getOffice(): OfficeAssets | null { return ready; }

export function loadOffice(): Promise<OfficeAssets | null> {
  if (promise) return promise;
  promise = doLoad().then((a) => { ready = a; return a; }).catch(() => null);
  return promise;
}

async function doLoad(): Promise<OfficeAssets> {
  const gl = new GLTFLoader();
  const out: OfficeAssets = { parts: new Map(), medical: null, ammo: null };
  await Promise.all([
    ...OFFICE_FILES.map(async (n) => {
      try {
        const g = await gl.loadAsync(modelsUrl(`office/${n}.glb`));
        const geo = bakeClasses(g.scene);
        if (geo) out.parts.set(n, geo);
      } catch { /* sin esta pieza */ }
    }),
    gl.loadAsync(modelsUrl('props/medical_box/medical_box_1k.gltf')).then((g) => { out.medical = g.scene; }).catch(() => { /* reserva */ }),
    gl.loadAsync(modelsUrl('props/ammo_box/ammo_box_1k.gltf')).then((g) => { out.ammo = g.scene; }).catch(() => { /* reserva */ }),
  ]);
  return out;
}
