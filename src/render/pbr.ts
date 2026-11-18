// Texturas PBR (Poly Haven / ambientCG, CC0) de public/models/tex/<id>/{color,normal,rough}.jpg y
// entornos HDRI de public/models/hdri/. Carga asíncrona con caché; si falla, devuelve null y el
// material se queda con su color plano.

import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { modelsUrl } from './assets';

export interface PBRSet { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture }

/** Metros que cubre una repetición de cada textura. */
export const PBR_TILE_M: Record<string, number> = {
  marble_tiles: 2.4, terrazzo_tiles: 2.0, dirty_carpet: 4.0, Carpet012: 5.0, large_grey_tiles: 2.0,
  concrete_floor_painted: 3.0, laminate_floor_02: 1.6, rough_concrete: 4.0, white_plaster_02: 2.0,
};

const cache = new Map<string, Promise<PBRSet | null>>();

export function loadPBR(id: string): Promise<PBRSet | null> {
  let p = cache.get(id);
  if (!p) {
    const loader = new THREE.TextureLoader();
    const tile = PBR_TILE_M[id] ?? 2;
    const one = async (file: string, srgb: boolean): Promise<THREE.Texture> => {
      const t = await loader.loadAsync(modelsUrl(`tex/${id}/${file}.jpg`));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1 / tile, 1 / tile);       // las UV están en metros
      t.anisotropy = 8;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    p = Promise.all([one('color', true), one('normal', false), one('rough', false)])
      .then(([map, normalMap, roughnessMap]) => ({ map, normalMap, roughnessMap }))
      .catch(() => null);
    cache.set(id, p);
  }
  return p;
}

export function disposePBRCache(): void {
  for (const p of cache.values()) void p.then((s) => { if (s) { s.map.dispose(); s.normalMap.dispose(); s.roughnessMap.dispose(); } });
  cache.clear();
}

const envCache = new Map<string, Promise<THREE.Texture | null>>();

/** Carga un HDRI (equirrectangular) y lo convierte a entorno PMREM. */
export function loadEnvironment(renderer: THREE.WebGLRenderer, name: string): Promise<THREE.Texture | null> {
  let p = envCache.get(name);
  if (!p) {
    p = new RGBELoader().loadAsync(modelsUrl(`hdri/${name}.hdr`)).then((tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(renderer);
      const env = pm.fromEquirectangular(tex).texture;
      tex.dispose(); pm.dispose();
      return env;
    }).catch(() => null);
    envCache.set(name, p);
  }
  return p;
}
