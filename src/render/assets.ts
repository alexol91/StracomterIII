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

/** URL de un fichero dentro de public/models/. */
export function modelsUrl(path: string): string { return baseUrl() + 'models/' + path; }

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

/** Partes de los modelos de reserva (Quaternius y Kenney), que solo se descargan cuando hacen falta. */
export type AssetPart = 'chars' | 'furn' | 'misc';

const shared: Assets = { chars: {}, furn: new Map(), health: null, grenade: null };
const partPromises = new Map<AssetPart, Promise<void>>();
const partsDone = new Set<AssetPart>();

/** Los modelos de reserva cargados hasta ahora (null mientras no se haya cargado ninguna parte). */
export function getAssets(): Assets | null { return partsDone.size ? shared : null; }
export function assetsDone(part: AssetPart): boolean { return partsDone.has(part); }

/** Carga (una sola vez cada parte) lo que se pida; nunca rechaza. */
export function loadAssets(want: AssetPart[] = ['chars', 'furn', 'misc']): Promise<Assets | null> {
  const base = baseUrl() + 'models/';
  const gl = new GLTFLoader();
  const jobs: Record<AssetPart, () => Promise<void>> = {
    chars: async () => {
      await Promise.all((['Soldier', 'Enemy', 'Hazmat'] as CharSourceId[]).map(async (id) => {
        try {
          const g = await gl.loadAsync(`${base}chars/Character_${id}.gltf`);
          shared.chars[id] = { scene: g.scene, anims: g.animations };
        } catch { /* sin este modelo */ }
      }));
    },
    furn: async () => {
      await Promise.all(FURN_PARTS.map(async (name) => {
        try {
          const mtl = await new MTLLoader().setPath(`${base}furniture/`).loadAsync(`${name}.mtl`);
          mtl.preload();
          const obj = await new OBJLoader().setMaterials(mtl).setPath(`${base}furniture/`).loadAsync(`${name}.obj`);
          const geo = bakeColored(obj);
          if (geo) shared.furn.set(name, geo);
        } catch { /* sin esta pieza */ }
      }));
    },
    misc: async () => {
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
      const [h, gr] = await Promise.all([loadStatic(`${base}env/Health.gltf`, 1), loadStatic(`${base}guns/Grenade.gltf`, 0.22)]);
      shared.health = h; shared.grenade = gr;
    },
  };
  const all: Promise<void>[] = [];
  for (const part of want) {
    let p = partPromises.get(part);
    if (!p) { p = jobs[part]().catch(() => { /* reserva incompleta */ }).then(() => { partsDone.add(part); }); partPromises.set(part, p); }
    all.push(p);
  }
  return Promise.all(all).then(() => getAssets()).catch(() => null);
}
