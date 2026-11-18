// Carga de modelos CC0 (Quaternius y Kenney) desde public/models/. Todo es opcional:
// si algo falla (404, formato) simplemente no estará en el resultado y se usan los modelos de cajas.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type CharSourceId = 'Soldier' | 'Enemy' | 'Hazmat';
export interface CharSource { scene: THREE.Group; anims: THREE.AnimationClip[] }

export const FURN_PARTS = [
  'table', 'tableRound', 'desk', 'chair', 'chairDesk', 'computerScreen', 'computerKeyboard',
  'bookcaseClosed', 'bookcaseClosedWide', 'loungeSofaLong', 'loungeChair', 'pottedPlant',
] as const;

export interface Assets {
  chars: Partial<Record<CharSourceId, CharSource>>;
  /** piezas de mobiliario ya horneadas: geometría sin índice con position, normal y color por vértice */
  furn: Map<string, THREE.BufferGeometry>;
  /** botiquín y granada: geometría horneada, centrada en el origen */
  health: THREE.BufferGeometry | null;
  grenade: THREE.BufferGeometry | null;
}

function baseUrl(): string {
  const b = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL;
  return b ?? './';
}

/**
 * Hornea un objeto (OBJ o glTF estático) en UNA geometría sin índice con color por vértice
 * (color del material). Ignora las mallas con esqueleto. Coordenadas relativas a la raíz del objeto.
 */
export function bakeColored(obj: THREE.Object3D): THREE.BufferGeometry | null {
  obj.updateMatrixWorld(true);
  const inv = obj.matrixWorld.clone().invert();
  const parts: THREE.BufferGeometry[] = [];
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
    let g = m.geometry.clone();
    g.applyMatrix4(inv.clone().multiply(m.matrixWorld));
    if (g.index) g = g.toNonIndexed();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const n = g.getAttribute('position').count;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.Material[];
    const col = new Float32Array(n * 3);
    const fill = (from: number, count: number, mat: THREE.Material | undefined): void => {
      const c = (mat as THREE.MeshPhongMaterial | undefined)?.color ?? new THREE.Color(1, 1, 1);
      for (let i = from; i < Math.min(n, from + count); i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    };
    if (Array.isArray(m.material) && g.groups.length) for (const gr of g.groups) fill(gr.start, gr.count, mats[gr.materialIndex ?? 0]);
    else fill(0, n, mats[0]);
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', g.getAttribute('position'));
    out.setAttribute('normal', g.getAttribute('normal'));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(out);
  });
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
}

let promise: Promise<Assets | null> | null = null;
let ready: Assets | null = null;

/** Estado actual de la carga (null hasta que termina). */
export function getAssets(): Assets | null { return ready; }

/** Precarga todo una sola vez; nunca rechaza. */
export function loadAssets(): Promise<Assets | null> {
  if (promise) return promise;
  promise = doLoad().then((a) => { ready = a; return a; }).catch(() => null);
  return promise;
}

async function doLoad(): Promise<Assets> {
  const base = baseUrl() + 'models/';
  const gl = new GLTFLoader();
  const assets: Assets = { chars: {}, furn: new Map(), health: null, grenade: null };

  const loadChar = async (id: CharSourceId): Promise<void> => {
    try {
      const g = await gl.loadAsync(`${base}chars/Character_${id}.gltf`);
      assets.chars[id] = { scene: g.scene, anims: g.animations };
    } catch { /* sin este modelo */ }
  };
  const loadStatic = async (url: string, size: number): Promise<THREE.BufferGeometry | null> => {
    try {
      const g = await gl.loadAsync(url);
      const geo = bakeColored(g.scene);
      if (!geo) return null;
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      const dim = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) || 1;
      const c = bb.getCenter(new THREE.Vector3());
      geo.translate(-c.x, -c.y, -c.z);
      geo.scale(size / dim, size / dim, size / dim);
      return geo;
    } catch { return null; }
  };
  const loadFurn = async (name: string): Promise<void> => {
    try {
      const mtl = await new MTLLoader().setPath(`${base}furniture/`).loadAsync(`${name}.mtl`);
      mtl.preload();
      const obj = await new OBJLoader().setMaterials(mtl).setPath(`${base}furniture/`).loadAsync(`${name}.obj`);
      const geo = bakeColored(obj);
      if (geo) assets.furn.set(name, geo);
    } catch { /* sin esta pieza */ }
  };

  await Promise.all([
    loadChar('Soldier'), loadChar('Enemy'), loadChar('Hazmat'),
    ...FURN_PARTS.map(loadFurn),
    loadStatic(`${base}env/Health.gltf`, 1).then((g) => { assets.health = g; }),
    loadStatic(`${base}guns/Grenade.gltf`, 0.22).then((g) => { assets.grenade = g; }),
  ]);
  return assets;
}
