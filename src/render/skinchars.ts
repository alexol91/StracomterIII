// Personajes con esqueleto (Quaternius, CC0). Por tipo se construye UNA plantilla: todas las mallas
// (cuerpo, cabeza, hombreras, el arma elegida y los accesorios de silueta) se hornean en UNA sola
// geometría con esqueleto y color por vértice (con el tinte del tipo). Así cada personaje cuesta
// 1 llamada de dibujo (+1 del contorno en calidad alta) y los materiales se comparten entre todos.

import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Entity, Kind } from '../sim/types';
import { statsOf } from '../sim/data';
import type { Assets, CharSourceId } from './assets';
import { GeoBuilder } from './geo';
import { unitPalette, type UnitPalette } from './palette';
import { computeHullDir } from './stylized';
import { outlinesOn } from './style';

// ───────────────────────── Constantes de ajuste ─────────────────────────

/** Giro (rad) añadido al «frente» del modelo. El modelo mira a +Z; si en pantalla mira al revés, poner Math.PI. */
export const MODEL_YAW_OFFSET = 0;
/** Velocidad (m/s) a la que los ciclos de Walk y Run avanzan a su ritmo natural (timeScale = v / ref). */
export const WALK_REF_SPEED = 1.9;
export const RUN_REF_SPEED = 5.2;
/** Por debajo de esta velocidad el personaje está quieto; por debajo de WALK_MAX anda en vez de correr. */
export const MOVE_MIN_SPEED = 0.4;
export const WALK_MAX_SPEED = 2.6;
/** Fracción (0..1) de la animación Duck en la que se queda congelado para la pose agachada. */
export const DUCK_POSE_T = 0.4;
/** Altura visual (m) aproximada de un personaje agachado (la usan barras de vida y marcas). */
export const CROUCH_VISUAL_HEIGHT = 1.05;
/** Grosor del contorno en unidades del modelo (se escala con el personaje). */
export const OUTLINE_THICK = 0.03;
/** Fracción del cabeceo del jugador que se aplica al torso. */
export const PITCH_FACTOR = 0.6;
/** Duración (s) de los fundidos entre animaciones. */
export const FADE_TIME = 0.15;

// ───────────────────────── Configuración por tipo ─────────────────────────

interface Cfg {
  src: CharSourceId; weapon: string;
  main: number; pants: number;
  /** factor de altura extra y de anchura (X/Z) */
  sy: number; wx: number;
  barW: number;
}

const WEAPONS = ['AK', 'GrenadeLauncher', 'Knife_1', 'Knife_2', 'Pistol', 'Revolver', 'Revolver_Small', 'RocketLauncher',
  'ShortCannon', 'Shotgun', 'Shovel', 'SMG', 'Sniper', 'Sniper_2'];
const MAIN_MATS = new Set(['Character_Main', 'Enemy_Red', 'Hazmat_Main']);

const CFG: Record<Kind, Cfg> = {
  captain: { src: 'Soldier', weapon: 'AK', main: 0x1f3a6e, pants: 0x16264d, sy: 1, wx: 1, barW: 0.7 },
  technic: { src: 'Soldier', weapon: 'SMG', main: 0x2ec4d6, pants: 0x155058, sy: 0.95, wx: 0.92, barW: 0.7 },
  especialist: { src: 'Soldier', weapon: 'ShortCannon', main: 0x1f8a7a, pants: 0x0e3f38, sy: 1.05, wx: 1.1, barW: 0.75 },
  explosives: { src: 'Soldier', weapon: 'RocketLauncher', main: 0xf2c200, pants: 0x1a1a1a, sy: 1, wx: 1.08, barW: 0.75 },
  enemy1: { src: 'Enemy', weapon: 'Pistol', main: 0xffa24a, pants: 0x6a4a2a, sy: 1, wx: 0.9, barW: 0.6 },
  enemy2: { src: 'Enemy', weapon: 'SMG', main: 0xe8591f, pants: 0x4a2412, sy: 1, wx: 1, barW: 0.7 },
  enemy3: { src: 'Enemy', weapon: 'Shotgun', main: 0x8a1c1c, pants: 0x2e0c0c, sy: 1, wx: 1.15, barW: 0.75 },
  miniboss: { src: 'Enemy', weapon: 'RocketLauncher', main: 0x6a0f1a, pants: 0x15090c, sy: 1, wx: 1.2, barW: 1.0 },
  megaboss: { src: 'Hazmat', weapon: 'ShortCannon', main: 0x5a1a8a, pants: 0x120a1a, sy: 1, wx: 1.15, barW: 1.2 },
};

// ───────────────────────── Accesorios de silueta ─────────────────────────
// Se dibujan con GeoBuilder en coordenadas «de modelo en reposo» (cabeza hacia y≈1,87 y delante a +Z),
// con el convenio del GeoBuilder (x = delante, z = derecha) y luego se giran al convenio del modelo.

interface Acc { bone: 'Head' | 'Torso'; build: (b: GeoBuilder) => void }

function accessories(kind: Kind, p: UnitPalette): Acc[] {
  const HF = 0.16;                      // z (delante) del centro de la cabeza en el modelo
  const HY = 1.87;                      // y del centro de la cabeza
  const out: Acc[] = [];
  switch (kind) {
    case 'captain':
      out.push({ bone: 'Head', build: (b) => { b.sph(HF - 0.05, HY + 0.33, 0.1, 0.46, 0x0e1a3c, undefined, 1, 0.3, 1); b.box(HF + 0.3, HY + 0.36, 0.1, 0.06, 0.06, 0.06, p.trim); } });
      break;
    case 'technic':
      out.push({ bone: 'Torso', build: (b) => { b.box(-0.4, 1.0, 0, 0.28, 0.6, 0.5, p.dark); b.bar(-0.45, 1.2, 0.15, -0.5, 2.55, 0.15, 0.06, 0x2a2f38); b.sph(-0.5, 2.58, 0.15, 0.09, 0xff3b30, { outline: false }); } });
      break;
    case 'especialist':
      out.push({ bone: 'Head', build: (b) => { b.sph(HF, HY + 0.12, 0, 0.55, p.dark, undefined, 1.05, 0.8, 1.15); } });
      out.push({ bone: 'Torso', build: (b) => { b.box(-0.42, 1.0, 0, 0.36, 0.62, 0.8, 0x5a5a3a); b.box(-0.42, 1.2, 0.5, 0.2, 0.3, 0.15, p.trim); b.box(-0.42, 1.2, -0.5, 0.2, 0.3, 0.15, p.trim); } });
      break;
    case 'explosives':
      out.push({ bone: 'Torso', build: (b) => { b.box(-0.43, 1.0, 0, 0.4, 0.85, 0.65, 0xf2c200); for (const y of [0.75, 1.05, 1.35]) b.box(-0.43, y, 0, 0.42, 0.1, 0.67, 0x151515, { outline: false }); } });
      out.push({ bone: 'Head', build: (b) => { b.sph(HF, HY + 0.18, 0, 0.5, 0x151515, undefined, 1, 0.55, 1); b.box(HF, HY + 0.44, 0, 0.6, 0.05, 0.14, 0xf2c200, { outline: false }); } });
      break;
    case 'enemy1':
      out.push({ bone: 'Head', build: (b) => { b.cyl(HF, HY + 0.32, 0, 0.45, 0.45, 0.16, p.dark, undefined, 14); b.box(HF + 0.48, HY + 0.27, 0, 0.36, 0.05, 0.6, p.dark); } });
      break;
    case 'enemy2':
      out.push({ bone: 'Torso', build: (b) => { b.box(-0.42, 1.0, 0, 0.34, 0.65, 0.6, 0x3a3320); b.box(-0.42, 1.38, 0, 0.3, 0.14, 0.5, p.dark); b.bar(0.1, 1.45, 0.4, 0.1, 0.75, -0.4, 0.1, 0x3a3320); } });
      break;
    case 'enemy3':
      out.push({ bone: 'Head', build: (b) => { b.sph(HF, HY + 0.2, 0, 0.55, p.dark, undefined, 1.0, 0.7, 1.1); b.box(HF + 0.5, HY + 0.1, 0, 0.3, 0.06, 0.85, p.dark); } });
      out.push({ bone: 'Torso', build: (b) => { for (const s of [-1, 1]) b.box(0, 1.42, s * 0.55, 0.5, 0.2, 0.4, p.dark); } });
      break;
    case 'miniboss':
      out.push({ bone: 'Torso', build: (b) => {
        for (const s of [-1, 1]) { b.box(0, 1.42, s * 0.6, 0.65, 0.25, 0.6, p.trim); b.cyl(0, 1.7, s * 0.6, 0, 0.14, 0.45, 0xd0d0d0, undefined, 8); }
      } });
      out.push({ bone: 'Head', build: (b) => { for (const s of [-1, 1]) b.cyl(HF, HY + 0.32, s * 0.38, 0, 0.1, 0.42, 0xe8e0c8, { rot: [s * 0.6, 0, 0] }, 8); } });
      break;
    case 'megaboss':
      out.push({ bone: 'Torso', build: (b) => {
        b.box(-0.45, 0.95, 0, 0.07, 1.4, 1.2, 0x2a0a40);                                   // capa
        for (const s of [-1, 1]) { b.box(0, 1.45, s * 0.62, 0.7, 0.28, 0.6, p.dark); b.cyl(0, 1.8, s * 0.62, 0, 0.16, 0.55, 0xffc400, undefined, 8); }
      } });
      out.push({ bone: 'Head', build: (b) => {
        for (let i = 0; i < 9; i++) {                                                       // aureola dentada
          const a = (i / 8) * Math.PI;           // 0..π: arco por encima de la cabeza
          const cy = HY + 0.05 + Math.sin(a) * 0.55, cz = Math.cos(a) * 0.6;
          b.cyl(HF - 0.3, cy, cz, 0, 0.09, 0.32, 0xffc400, { rot: [Math.PI / 2 - a, 0, 0] }, 6);
        }
        b.sph(HF, HY + 0.1, 0, 0.5, p.dark, undefined, 1, 0.5, 1);
      } });
      break;
    default:
      break;
  }
  return out;
}

// ───────────────────────── Plantilla ─────────────────────────

export interface SkinTemplate {
  root: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  scaleY: number;
  scaleXZ: number;
  height: number;
  barW: number;
}

function cleanSkinned(g0: THREE.BufferGeometry, tint: (c: THREE.Color) => THREE.Color, mat: THREE.Material): THREE.BufferGeometry {
  const g = g0.index ? g0.toNonIndexed() : g0.clone();
  const n = g.getAttribute('position').count;
  const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const ia = new Uint16Array(n * 4), wa = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { ia[i * 4 + k] = si.getComponent(i, k); wa[i * 4 + k] = sw.getComponent(i, k); }
  const c = tint(((mat as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1)).clone());
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  out.setAttribute('normal', g.getAttribute('normal'));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('skinIndex', new THREE.BufferAttribute(ia, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(wa, 4));
  return out;
}

function boneAncestor(o: THREE.Object3D): THREE.Bone | null {
  for (let p: THREE.Object3D | null = o.parent; p; p = p.parent) if ((p as THREE.Bone).isBone) return p as THREE.Bone;
  return null;
}

export function buildTemplate(kind: Kind, cb: boolean, assets: Assets): SkinTemplate | null {
  const cfg = CFG[kind];
  const src = assets.chars[cfg.src];
  if (!src) return null;
  const root = SkeletonUtils.clone(src.scene);
  root.updateMatrixWorld(true);

  const skinned: THREE.SkinnedMesh[] = [];
  const statics: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(m as THREE.SkinnedMesh);
    else if (m.isMesh) statics.push(m);
  });
  if (!skinned.length) return null;
  const ref = skinned[0];
  const skel = ref.skeleton;
  const bindInv = ref.bindMatrix.clone().invert();
  const parent = ref.parent!;

  // altura real del modelo (sin armas ni accesorios): parte alta de la cabeza en reposo
  const headBox = new THREE.Box3();
  for (const m of statics) {
    if (boneAncestor(m)?.name !== 'Head') continue;
    let weapon = false;
    for (let p: THREE.Object3D | null = m; p; p = p.parent) if (WEAPONS.includes(p.name)) weapon = true;
    if (!weapon) headBox.expandByObject(m);
  }
  // Enemy y Hazmat llevan la cabeza dentro de la malla con esqueleto: mismo rig, así que la altura es
  // la del hueso Head en reposo más lo que sobresale la cabeza del Soldier (≈ 0,72).
  const headBone = root.getObjectByName('Head');
  const headY = headBone ? headBone.getWorldPosition(new THREE.Vector3()).y : 1.46;
  const modelH = !headBox.isEmpty() && headBox.max.y > 0.5 ? headBox.max.y : headY + 0.72;

  // paleta y tinte
  const pal = unitPalette(kind, cb);
  const mainC = new THREE.Color(cb ? pal.main : cfg.main);
  const pantsC = new THREE.Color(cb ? pal.dark : cfg.pants);
  const tintFor = (name: string) => (c: THREE.Color): THREE.Color => (MAIN_MATS.has(name) ? mainC.clone() : name === 'Pants' ? pantsC.clone() : c);
  const matName = (m: THREE.Material | THREE.Material[]): string => (Array.isArray(m) ? m[0] : m).name;

  const pieces: THREE.BufferGeometry[] = [];
  for (const sm of skinned) {
    const mat = Array.isArray(sm.material) ? sm.material[0] : sm.material;
    pieces.push(cleanSkinned(sm.geometry, tintFor(mat.name), mat));
  }

  // piezas rígidas pegadas a un hueso: se convierten al espacio de la malla con pesos 1 sobre ese hueso
  const rigid = (g0: THREE.BufferGeometry, world: THREE.Matrix4, bone: THREE.Bone, flat: THREE.Color | null): void => {
    const bi = skel.bones.indexOf(bone);
    if (bi < 0) return;
    const g = g0.index ? g0.toNonIndexed() : g0.clone();
    g.applyMatrix4(world.clone().premultiply(
      bindInv.clone()
        .multiply(skel.boneInverses[bi].clone().invert())
        .multiply(bone.matrixWorld.clone().invert()),
    ));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const n = g.getAttribute('position').count;
    const ia = new Uint16Array(n * 4), wa = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { ia[i * 4] = bi; wa[i * 4] = 1; }
    let colAttr = g.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (flat || !colAttr) {
      const col = new Float32Array(n * 3);
      const c = flat ?? new THREE.Color(1, 1, 1);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      colAttr = new THREE.BufferAttribute(col, 3);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', g.getAttribute('position'));
    out.setAttribute('normal', g.getAttribute('normal'));
    out.setAttribute('color', colAttr);
    out.setAttribute('skinIndex', new THREE.BufferAttribute(ia, 4));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(wa, 4));
    pieces.push(out);
  };

  for (const m of statics) {
    // arma: solo la elegida; el resto no entra
    let skip = false, inChosen = false;
    for (let p: THREE.Object3D | null = m; p; p = p.parent) {
      if (WEAPONS.includes(p.name)) { if (p.name === cfg.weapon) inChosen = true; else skip = true; }
    }
    if (skip && !inChosen) continue;
    const bone = boneAncestor(m);
    if (!bone) continue;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const c = tintFor(matName(m.material))(((mat as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1)).clone());
    rigid(m.geometry, m.matrixWorld, bone, c);
  }

  // accesorios de silueta
  const bonesByName = (n: string): THREE.Bone | null => (root.getObjectByName(n) as THREE.Bone | undefined) ?? null;
  for (const acc of accessories(kind, pal)) {
    const bone = bonesByName(acc.bone);
    if (!bone) continue;
    const b = new GeoBuilder(0);
    acc.build(b);
    if (b.isEmpty()) continue;
    const { geo } = b.build();
    geo.rotateY(-Math.PI / 2);          // convenio del GeoBuilder (+X delante) -> modelo (+Z delante)
    rigid(geo, new THREE.Matrix4(), bone, null);
  }

  const merged = mergeGeometries(pieces, false);
  if (!merged) return null;
  computeHullDir(merged);
  merged.computeBoundingSphere();

  // quita las mallas originales y pone la fusionada + el contorno
  for (const m of [...skinned, ...statics]) m.removeFromParent();
  const body = new THREE.SkinnedMesh(merged, new THREE.MeshBasicMaterial());
  body.name = 'BodyMerged'; body.frustumCulled = false;
  parent.add(body);
  body.bind(skel, ref.bindMatrix);
  const hull = new THREE.SkinnedMesh(merged, new THREE.MeshBasicMaterial());
  hull.name = 'BodyHull'; hull.frustumCulled = false;
  parent.add(hull);
  hull.bind(skel, ref.bindMatrix);

  const clips = new Map<string, THREE.AnimationClip>();
  for (const c of src.anims) clips.set(c.name, c);

  const height = statsOf(kind).height * cfg.sy;
  const s = height / modelH;
  return { root, clips, scaleY: s, scaleXZ: s * cfg.wx, height, barW: cfg.barW };
}

// ───────────────────────── Vista de un personaje ─────────────────────────

/** Lo que la vista necesita del gestor (materiales y geometrías compartidas). */
export interface CharHost {
  matChar: THREE.Material; matDead: THREE.Material; matGhost: THREE.Material; matFlash: THREE.Material;
  matHullSkin: THREE.Material;
  markGeo: THREE.BufferGeometry; markMat: THREE.Material;
  shieldGeo: THREE.BufferGeometry; shieldMat: THREE.Material;
  ringGeo: THREE.BufferGeometry; ringMat: THREE.Material;
  shadowsOn: boolean;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _ax = new THREE.Vector3(1, 0, 0);

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class SkinView {
  root = new THREE.Group();
  inner: THREE.Object3D;
  body: THREE.SkinnedMesh;
  hull: THREE.SkinnedMesh;
  mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private cur: THREE.AnimationAction | null = null;
  private curName = '';
  private torso: THREE.Object3D | null;
  private abdomen: THREE.Object3D | null;
  mark: THREE.Mesh | null = null;
  shield: THREE.Mesh | null = null;
  ring: THREE.Mesh | null = null;
  x = 0; y = 0; yaw = 0; crouchK = 0; speed = 0; init = false; ghost = false;
  /** tiempo de animación pendiente de aplicar (para actualizar menos veces a los lejanos) */
  pendingDt = 0;
  height: number; barW: number;

  constructor(private tpl: SkinTemplate) {
    this.inner = SkeletonUtils.clone(tpl.root);
    this.inner.scale.set(tpl.scaleXZ, tpl.scaleY, tpl.scaleXZ);
    this.inner.rotation.y = MODEL_YAW_OFFSET;
    this.root.add(this.inner);
    this.body = this.inner.getObjectByName('BodyMerged') as THREE.SkinnedMesh;
    this.hull = this.inner.getObjectByName('BodyHull') as THREE.SkinnedMesh;
    // el contorno comparte el esqueleto del cuerpo (una sola evaluación de huesos)
    if (this.hull.skeleton !== this.body.skeleton) { this.hull.skeleton.dispose(); this.hull.bind(this.body.skeleton, this.body.bindMatrix); }
    this.mixer = new THREE.AnimationMixer(this.inner);
    this.torso = this.inner.getObjectByName('Torso') ?? null;
    this.abdomen = this.inner.getObjectByName('Abdomen') ?? null;
    this.height = tpl.height; this.barW = tpl.barW;
  }

  private action(name: string): THREE.AnimationAction | null {
    let a = this.actions.get(name);
    if (!a) {
      const clip = this.tpl.clips.get(name);
      if (!clip) return null;
      a = this.mixer.clipAction(clip);
      this.actions.set(name, a);
    }
    return a;
  }

  /** Cambia (con fundido) a la animación `name`; `once` = una sola vez y se queda en el último fotograma. */
  private play(name: string, once: boolean, timeScale: number, startFrac = 0, freeze = false): void {
    const next = this.action(name);
    if (!next) return;
    if (this.curName !== name) {
      next.reset();
      next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = once;
      next.setEffectiveWeight(1);
      next.fadeIn(FADE_TIME);
      next.play();
      if (startFrac > 0) next.time = startFrac * next.getClip().duration;
      next.paused = freeze;
      if (this.cur) this.cur.fadeOut(FADE_TIME);
      this.cur = next;
      this.curName = name;
    }
    next.setEffectiveTimeScale(timeScale);
    next.paused = freeze;
  }

  update(e: Entity, time: number, dt: number, host: CharHost, animate: boolean, animDt: number): void {
    // — interpolación de posición y orientación
    const k = 1 - Math.exp(-dt * (e.isPlayer ? 30 : 24));
    if (!this.init || Math.hypot(e.x - this.x, e.y - this.y) > 3) { this.x = e.x; this.y = e.y; this.yaw = e.yaw; this.init = true; }
    else { this.x += (e.x - this.x) * k; this.y += (e.y - this.y) * k; this.yaw = lerpAngle(this.yaw, e.yaw, 1 - Math.exp(-dt * 18)); }
    this.root.position.set(this.x, 0, this.y);
    // el modelo mira a +Z: giro para que +Z apunte a (cos yaw, sin yaw) en (x, z)
    this.root.rotation.y = Math.PI / 2 - this.yaw;

    const alive = e.alive;
    const sp = alive ? Math.hypot(e.vx, e.vy) : 0;
    this.speed += (sp - this.speed) * (1 - Math.exp(-dt * 12));
    this.crouchK += ((alive && e.crouch ? 1 : 0) - this.crouchK) * (1 - Math.exp(-dt * 14));

    // — materiales (compartidos): normal, muerto, fantasma, destello
    const hurt = alive && !this.ghost && time - e.lastHurtAt < 0.12 && time >= e.lastHurtAt;
    this.body.material = !alive ? host.matDead : this.ghost ? host.matGhost : hurt ? host.matFlash : host.matChar;
    this.body.castShadow = host.shadowsOn && !this.ghost;
    this.hull.visible = host.shadowsOn && !this.ghost && outlinesOn();
    this.hull.material = host.matHullSkin;

    // — animación
    if (animate) {
      const shooting = alive && time - e.lastShotAt < 0.35 && time >= e.lastShotAt;
      if (!alive) {
        const dur = this.tpl.clips.get('Death')?.duration ?? 0.77;
        const elapsed = e.deadAt < 0 ? dur : Math.max(0, time - e.deadAt);
        const first = this.curName !== 'Death';
        this.play('Death', true, 1);
        if (first && elapsed > 0.05 && this.cur) this.cur.time = Math.min(dur, elapsed);
      } else if (time - e.lastKnifeAt < 0.5 && time >= e.lastKnifeAt) {
        this.play('Punch', true, 1.4);
      } else if (e.crouch) {
        this.play('Duck', true, 1, DUCK_POSE_T, true);
      } else if (this.speed > MOVE_MIN_SPEED) {
        const run = this.speed >= WALK_MAX_SPEED;
        const ref = run ? RUN_REF_SPEED : WALK_REF_SPEED;
        const ts = Math.min(1.8, Math.max(0.5, this.speed / ref));
        this.play(shooting ? (run ? 'Run_Shoot' : 'Walk_Shoot') : (run ? 'Run_Gun' : 'Walk'), false, ts);
      } else if (shooting) {
        this.play('Idle_Shoot', false, 1);
      } else if (time - e.lastHurtAt < 0.43 && time >= e.lastHurtAt) {
        this.play('HitReact', true, 1);
      } else {
        this.play('Idle', false, 1);
      }
      // El mezclador solo reescribe un hueso cuando su valor animado cambia: si no se deshace la inclinación
      // del frame anterior, se acumula (el jugador acababa doblado 90°). Se restaura la pose animada y se reaplica.
      if (this.tilted) {
        if (this.abdomen) this.abdomen.quaternion.copy(this.baseAbd);
        if (this.torso) this.torso.quaternion.copy(this.baseTor);
        this.tilted = false;
      }
      this.mixer.update(animDt);

      // el jugador inclina el torso con el cabeceo para que se vea hacia dónde apunta
      if (alive && e.isPlayer) {
        if (this.abdomen) this.baseAbd.copy(this.abdomen.quaternion);
        if (this.torso) this.baseTor.copy(this.torso.quaternion);
        this.tilt(this.abdomen, -e.pitch * PITCH_FACTOR * 0.4);
        this.tilt(this.torso, -e.pitch * PITCH_FACTOR * 0.6);
        this.tilted = true;
      }
    }

    this.overlays(e, time, host, alive);
  }

  /** Giro de un hueso alrededor del eje lateral del modelo (X local del modelo), compuesto sobre la animación. */
  private tilted = false;
  private baseAbd = new THREE.Quaternion();
  private baseTor = new THREE.Quaternion();
  private tilt(bone: THREE.Object3D | null, angle: number): void {
    if (!bone || Math.abs(angle) < 1e-4) return;
    _q.identity();
    for (let o: THREE.Object3D | null = bone.parent; o && o !== this.inner; o = o.parent) _q.premultiply(o.quaternion);   // cuaternión del padre en espacio del modelo
    _q2.setFromAxisAngle(_ax, angle);
    // nuevo = padre^-1 · R · padre · local
    bone.quaternion.premultiply(_q).premultiply(_q2).premultiply(_q.clone().invert());
  }

  private overlays(e: Entity, time: number, host: CharHost, alive: boolean): void {
    const c = this.crouchK;
    const h = THREE.MathUtils.lerp(this.height, CROUCH_VISUAL_HEIGHT, c);
    const wantMark = alive && e.marked;
    if (wantMark && !this.mark) { this.mark = new THREE.Mesh(host.markGeo, host.markMat); this.mark.scale.set(1, 1.5, 1); this.root.add(this.mark); }
    if (this.mark) {
      this.mark.visible = wantMark;
      if (wantMark) { this.mark.position.y = h + 0.55 + Math.sin(time * 4) * 0.06; this.mark.rotation.y = time * 2.5 - this.root.rotation.y; }
    }
    const wantShield = alive && e.shielded;
    if (wantShield && !this.shield) { this.shield = new THREE.Mesh(host.shieldGeo, host.shieldMat); this.root.add(this.shield); }
    if (this.shield) {
      this.shield.visible = wantShield;
      if (wantShield) {
        const r = Math.max(this.height * 0.62, e.radius * 1.5) * (1 + Math.sin(time * 5) * 0.025);
        this.shield.scale.set(r * 0.9, r, r * 0.9);
        this.shield.position.y = this.height * 0.5;
      }
    }
    if (e.isPlayer) {
      if (!this.ring) { this.ring = new THREE.Mesh(host.ringGeo, host.ringMat); this.ring.position.y = 0.04; this.ring.renderOrder = 3; this.root.add(this.ring); }
      this.ring.visible = alive;
      const s = (1 + Math.sin(time * 3) * 0.04) * e.radius / 0.4;
      this.ring.scale.set(s, 1, s);
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.inner);
    this.body.skeleton.dispose();
  }
}
