// Sombreado estilizado propio («hero shooter»): rampa suave de tres tonos (sombra fría, medio
// tono, luz cálida), luz de contorno (fresnel) y especular ancho y suave.
//
// Se construye sobre MeshToonMaterial con onBeforeCompile, así que hereda de three: color por
// vértice, `map`, `normalMap`, `emissive`, instancing, skinning (SkinnedMesh) y sombras proyectadas.
//
// Uso con modelos GLB: `mesh.material = makeStylized(mesh.material)` conserva color, texturas,
// emisivo, transparencia y doble cara del material original.

import * as THREE from 'three';

let _ramp: THREE.DataTexture | null = null;
/** Rampa suave: cuatro texels interpolados linealmente (sombra, medio, luz, brillo). */
export function toonRamp(): THREE.DataTexture {
  if (!_ramp) {
    _ramp = new THREE.DataTexture(new Uint8Array([140, 190, 235, 255]), 4, 1, THREE.RedFormat);
    _ramp.minFilter = THREE.LinearFilter;
    _ramp.magFilter = THREE.LinearFilter;
    _ramp.generateMipmaps = false;
    _ramp.needsUpdate = true;
  }
  return _ramp;
}
export function disposeRamp(): void { _ramp?.dispose(); _ramp = null; }

export interface StylizedOptions {
  /** intensidad de la luz de contorno (0 = sin contorno luminoso; el suelo usa 0). Por defecto 0.55. */
  rim?: number;
  /** color de la luz de contorno. Por defecto azul claro. */
  rimColor?: number;
  /** intensidad del especular ancho. Por defecto 0.6. */
  spec?: number;
}

export type StylizedSource = THREE.Material | THREE.MeshToonMaterialParameters;

/**
 * Devuelve un MeshToonMaterial con el sombreado estilizado. `src` puede ser un material existente
 * (MeshStandardMaterial de un GLB, etc.: se copian color, map, normalMap, emissive, alphaMap,
 * vertexColors, transparent, opacity, side, alphaTest, depthWrite) o un objeto de parámetros.
 */
export function makeStylized(src: StylizedSource = {}, opts: StylizedOptions = {}): THREE.MeshToonMaterial {
  const p: THREE.MeshToonMaterialParameters = {};
  if (src instanceof THREE.Material) {
    const s = src as unknown as Record<string, unknown>;
    for (const k of ['color', 'map', 'normalMap', 'emissive', 'emissiveMap', 'emissiveIntensity', 'alphaMap', 'vertexColors',
      'transparent', 'opacity', 'side', 'alphaTest', 'depthWrite'] as const) {
      const v = s[k];
      if (v === undefined) continue;
      const rec = p as Record<string, unknown>;
      rec[k] = v instanceof THREE.Color ? v.clone() : v;
    }
    p.name = src.name;
  } else Object.assign(p, src);
  p.gradientMap = toonRamp();
  const m = new THREE.MeshToonMaterial(p);

  const rim = opts.rim ?? 0.55;
  const spec = opts.spec ?? 0.6;
  const rimColor = new THREE.Color(opts.rimColor ?? 0xbfdcff);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: rimColor };
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uSpec = { value: spec };
    shader.uniforms.uCool = { value: new THREE.Vector3(0.80, 0.89, 1.12) };
    shader.uniforms.uWarm = { value: new THREE.Vector3(1.08, 1.03, 0.92) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uRimColor; uniform float uRim; uniform float uSpec; uniform vec3 uCool; uniform vec3 uWarm;`)
      .replace('#include <opaque_fragment>', `
{
  vec3 sV = normalize(vViewPosition);
  vec3 sN = normalize(normal);
  // tinte frío en sombras y cálido en luces, según la luminosidad
  float sLum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
  outgoingLight *= mix(vec3(1.0), uCool, 1.0 - smoothstep(0.18, 0.75, sLum));
  outgoingLight *= mix(vec3(1.0), uWarm, smoothstep(0.65, 1.15, sLum));
  #if NUM_DIR_LIGHTS > 0
    vec3 sH = normalize(directionalLights[0].direction + sV);
    outgoingLight += directionalLights[0].color * (pow(max(dot(sN, sH), 0.0), 18.0) * uSpec * 0.06);
  #endif
  // luz de contorno: solo en superficies no horizontales, más fuerte hacia arriba
  vec3 sWN = inverseTransformDirection(sN, viewMatrix);
  float sRim = pow(1.0 - clamp(dot(sN, sV), 0.0, 1.0), 2.6);
  sRim *= 1.0 - smoothstep(0.55, 0.95, abs(sWN.y));
  sRim *= 0.55 + 0.45 * clamp(sWN.y * 0.5 + 0.5, 0.0, 1.0);
  outgoingLight += uRimColor * (sRim * uRim);
}
#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'stylized-v1';
  return m;
}

/**
 * Material de contorno por «casco invertido» con desplazamiento por normal en el vértice (sirve para
 * SkinnedMesh e InstancedMesh). Usa el atributo `hullDir` (normales suavizadas, ver computeHullDir);
 * si la geometría no lo tiene, no desplaza.
 */
export function makeHullMaterial(thick: number, color = 0x1a1426): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uThick = { value: thick };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 hullDir;\nuniform float uThick;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  if (dot(hullDir, hullDir) > 0.0) transformed += normalize(hullDir) * uThick;');
  };
  m.customProgramCacheKey = () => 'hull-v1';
  return m;
}

/** Añade `hullDir`: normal suavizada (promedio de las normales de los vértices coincidentes). */
export function computeHullDir(g: THREE.BufferGeometry): void {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const n = pos.count;
  const sums = new Map<string, [number, number, number]>();
  const key = (i: number): string => `${Math.round(pos.getX(i) * 2000)},${Math.round(pos.getY(i) * 2000)},${Math.round(pos.getZ(i) * 2000)}`;
  for (let i = 0; i < n; i++) {
    const k = key(i);
    const s = sums.get(k) ?? [0, 0, 0];
    s[0] += nor.getX(i); s[1] += nor.getY(i); s[2] += nor.getZ(i);
    sums.set(k, s);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const s = sums.get(key(i))!; out[i * 3] = s[0]; out[i * 3 + 1] = s[1]; out[i * 3 + 2] = s[2]; }
  g.setAttribute('hullDir', new THREE.BufferAttribute(out, 3));
}
