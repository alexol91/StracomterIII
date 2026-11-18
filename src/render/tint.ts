// Tinte selectivo de la ropa (respeta la piel) y brazaletes para los avatares Rocketbox.
// La lógica viene de la galería de pruebas, aquí es independiente.

import * as THREE from 'three';

export interface TintSpec {
  /** tono (0..1) al que se lleva la ropa; sat = s·satMul + satAdd; valor = v·valMul */
  tono: number; satMul: number; satAdd: number; valMul: number;
  /** cuánto del dibujo original (camuflaje) se conserva del tono */
  hueKeep?: number;
}

const GLSL_TINTE = /* glsl */ `
uniform float uHueKeep; uniform float uTono; uniform float uSatMul; uniform float uSatAdd; uniform float uValMul;
vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1.0e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)), d/(q.x+e), q.x); }
vec3 hsv2rgb(vec3 c){ vec4 K=vec4(1.,2./3.,1./3.,3.); vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www); return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y); }
vec3 tinteRopa(vec3 lin){
  vec3 s = pow(max(lin, vec3(0.)), vec3(1./2.2));
  vec3 hsv = rgb2hsv(s);
  // «sinpiel»: todo salvo tonos de piel (rosa/naranja con saturación apreciable); sirve para grises y negros
  float piel = (1. - smoothstep(0.09, 0.13, hsv.x) + smoothstep(0.94, 0.98, hsv.x)) * smoothstep(0.15, 0.22, hsv.y);
  float m = (1. - clamp(piel, 0., 1.)) * smoothstep(0.04, 0.12, hsv.z);
  float h = fract(uTono + (hsv.x - 0.22) * uHueKeep);
  float sa = clamp(hsv.y * uSatMul + uSatAdd, 0., 1.);
  float va = clamp(hsv.z * uValMul, 0., 1.);
  return pow(mix(s, hsv2rgb(vec3(h, sa, va)), m), vec3(2.2));
}`;

/** Clona el material con el tinte aplicado (las texturas se comparten, el material no). */
export function tintMaterial(original: THREE.Material, t: TintSpec): THREE.Material {
  const mt = (original as THREE.MeshStandardMaterial).clone();
  mt.onBeforeCompile = (sh) => {
    sh.uniforms.uHueKeep = { value: t.hueKeep ?? 0 };
    sh.uniforms.uTono = { value: t.tono };
    sh.uniforms.uSatMul = { value: t.satMul };
    sh.uniforms.uSatAdd = { value: t.satAdd };
    sh.uniforms.uValMul = { value: t.valMul };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_TINTE)
      .replace('#include <map_fragment>', '#include <map_fragment>\n#ifdef USE_MAP\ndiffuseColor.rgb = tinteRopa(diffuseColor.rgb);\n#endif');
  };
  mt.customProgramCacheKey = () => 'tinte-ropa-v1';
  return mt;
}

/** Materiales que NO se tiñen: cabeza (piel), arma, cuchillo y pelo con opacidad. */
export function isTintable(name: string): boolean { return !/(_head|_pistol|_knife|_opacity)/.test(name); }

export interface BandStyle { color: number; emissive: number; stripe?: number; radius?: number; height?: number }

/** Brazalete: banda ceñida a la parte alta del brazo (hueso Bip01_?_UpperArm, eje X a lo largo del miembro, cm). */
export function addArmband(model: THREE.Object3D, side: 'L' | 'R', st: BandStyle): void {
  const bone = model.getObjectByName(`Bip01_${side}_UpperArm`);
  if (!bone) return;
  const r = st.radius ?? 6.6, h = st.height ?? 9;
  const g = new THREE.Group();
  g.name = 'brazalete';
  const mat = new THREE.MeshStandardMaterial({ color: st.color, emissive: st.emissive, emissiveIntensity: 0.6, roughness: 0.6, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20, 1, true), mat));
  if (st.stripe !== undefined) {
    const sm = new THREE.MeshStandardMaterial({ color: st.stripe, roughness: 0.7, side: THREE.DoubleSide });
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(r + 0.12, r + 0.12, h * 0.28, 20, 1, true), sm));
  }
  g.rotation.z = Math.PI / 2;
  g.position.set(14, 0, 0);
  for (const c of g.children) (c as THREE.Mesh).frustumCulled = false;
  bone.add(g);
}
