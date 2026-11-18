// Personajes realistas: avatares Microsoft Rocketbox (MIT) con animaciones del maniquí Universal Animation
// Library (Quaternius, CC0) retargeteadas a su esqueleto «Bip01» (retarget.ts).
//
// Pieza a pieza:
//  · RbLibrary carga los .fbx (FBXLoader, texturas de color por manifiesto), el maniquí UAL y las armas,
//    construye una plantilla por tipo (tinte, brazaletes, arma en la mano, escala) y retargetea los clips
//    de forma perezosa/repartida.
//  · RbView es un personaje: un clon de la plantilla con su AnimationMixer y dos capas de animación
//    (piernas y torso) para combinar locomoción con apuntado.

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Entity, Kind } from '../sim/types';
import { statsOf } from '../sim/data';
import { bakeColored, modelsUrl } from './assets';
import { retargetClip, UAL_TO_ROCKETBOX } from './retarget';
import { addArmband, isTintable, tintMaterial, type BandStyle, type TintSpec } from './tint';
import type { CharHost } from './skinchars';

// ───────────────────────── Constantes de ajuste ─────────────────────────

/** Giro (rad) añadido al frente del avatar (miran a +Z). Si salen al revés, poner Math.PI. */
export const RB_YAW_OFFSET = 0;
/** Velocidad (m/s) a la que cada ciclo avanza a su ritmo natural (timeScale = v / ref, acotado). */
export const WALK_REF_SPEED = 1.4;
export const JOG_REF_SPEED = 3.2;
export const SPRINT_REF_SPEED = 5.5;
export const CROUCH_REF_SPEED = 1.1;
export const TIMESCALE_MIN = 0.6;
export const TIMESCALE_MAX = 1.6;
/** Umbrales de velocidad (m/s): quieto / andar / trotar / esprintar. */
export const MOVE_MIN_SPEED = 0.4;
export const WALK_MAX_SPEED = 2.6;
export const JOG_MAX_SPEED = 5.6;
/** Altura visual (m) de un personaje agachado (barras de vida y marcas). */
export const RB_CROUCH_HEIGHT = 1.1;
/** Fracción del cabeceo del jugador que se reparte entre Spine1 y Spine2. */
export const RB_PITCH_FACTOR = 0.7;
export const FADE_TIME = 0.15;
/** Desplazamiento (m) del cadáver alejándose del tirador, y retroceso del arma por disparo (cm, duración s). */
export const DEATH_PUSH = 0.4;
export const GUN_KICK_CM = 3;
export const GUN_KICK_TIME = 0.06;
/** Curvatura (rad) de las falanges para el agarre fijo; eje local en el que se curvan los dedos. */
export const FINGER_CURL = { proximal: 0.55, middle: 0.8, distal: 0.6, thumb: 0.3 };
export const FINGER_AXIS: 'x' | 'y' | 'z' = 'z';

/** Pose del arma en la mano derecha (Bip01_R_Hand): pos en cm (espacio del hueso), rot en grados, escala sobre el tamaño real. */
export interface GunGrip { pos: [number, number, number]; rot: [number, number, number]; scale: number }
export const GUN_GRIP: Record<string, GunGrip> = {
  AK: { pos: [6, 0, 0], rot: [0, 180, 0], scale: 1 },
  SMG: { pos: [6, 0, 0], rot: [0, 180, 0], scale: 1 },
  ShortCannon: { pos: [6, 0, 0], rot: [0, 180, 0], scale: 1 },
  RocketLauncher: { pos: [6, 0, 0], rot: [0, 180, 0], scale: 1 },
  Pistol: { pos: [5, 0, 0], rot: [0, 180, 0], scale: 1 },
  Shotgun: { pos: [6, 0, 0], rot: [0, 180, 0], scale: 1 },
  Knife_1: { pos: [5, 0, 0], rot: [0, 180, 0], scale: 1 },
  Grenade: { pos: [5, 0, 0], rot: [0, 0, 0], scale: 1 },
};
/** Longitud real (m) de cada arma. */
export const GUN_LEN: Record<string, number> = { AK: 0.85, SMG: 0.6, ShortCannon: 0.8, RocketLauncher: 1.1, Pistol: 0.22, Shotgun: 0.95, Knife_1: 0.28, Grenade: 0.1 };

// ───────────────────────── Configuración por tipo ─────────────────────────

const NAVY: TintSpec = { tono: 0.62, satMul: 0, satAdd: 0.5, valMul: 0.5 };
const URBAN_GREY: TintSpec = { tono: 0.6, satMul: 0, satAdd: 0.04, valMul: 0.8 };
const BLACK: TintSpec = { tono: 0.6, satMul: 0, satAdd: 0, valMul: 0.3 };

interface Cfg {
  avatar: string; gun: string;
  /** variantes de tinte; con varias se elige por entity.id % n; sin ellas, el original */
  tints: TintSpec[];
  wx: number;
  band: 'none' | 'ally' | 'hostile';
  /** brazalete en los dos brazos */
  both?: boolean;
  bandRadius?: number;
  barW: number;
}

const CFG: Record<Kind, Cfg> = {
  captain: { avatar: 'Military_Male_01', gun: 'AK', tints: [], wx: 1, band: 'none', barW: 0.7 },
  technic: { avatar: 'Military_Male_05', gun: 'SMG', tints: [NAVY], wx: 1, band: 'none', barW: 0.7 },
  especialist: { avatar: 'Military_Male_04', gun: 'ShortCannon', tints: [URBAN_GREY], wx: 1.05, band: 'ally', barW: 0.75 },
  explosives: { avatar: 'Military_Male_03', gun: 'RocketLauncher', tints: [BLACK], wx: 1.05, band: 'none', barW: 0.75 },
  enemy1: { avatar: 'Security_Male_01', gun: 'Pistol', tints: [], wx: 0.95, band: 'hostile', barW: 0.6 },
  enemy2: {
    avatar: 'Police_Male_01', gun: 'SMG', wx: 1, band: 'hostile', barW: 0.7,
    tints: [BLACK, { tono: 0.0, satMul: 0, satAdd: 0.55, valMul: 0.5 }, { tono: 0.09, satMul: 0, satAdd: 0.35, valMul: 0.6 }, { tono: 0.07, satMul: 0, satAdd: 0.45, valMul: 0.42 }],
  },
  enemy3: { avatar: 'Police_Male_02', gun: 'Shotgun', tints: [{ tono: 0.03, satMul: 0, satAdd: 0.5, valMul: 0.5 }], wx: 1.08, band: 'hostile', barW: 0.75 },
  miniboss: { avatar: 'Police_Male_02', gun: 'RocketLauncher', tints: [{ tono: 0.0, satMul: 0, satAdd: 0.12, valMul: 0.26 }], wx: 1.15, band: 'hostile', bandRadius: 7.6, barW: 1.0 },
  megaboss: { avatar: 'Military_Male_02', gun: 'ShortCannon', tints: [{ tono: 0.97, satMul: 0, satAdd: 0.5, valMul: 0.28 }], wx: 1.15, band: 'hostile', both: true, bandRadius: 7.4, barW: 1.2 },
};

function bandStyle(cfg: Cfg, cb: boolean): BandStyle {
  const r = cfg.bandRadius;
  if (cfg.band === 'ally') return { color: 0x2a63ff, emissive: 0x0a1f66, radius: r };
  return cb ? { color: 0xffe100, emissive: 0x554400, stripe: 0x111111, radius: r } : { color: 0xd01818, emissive: 0x600000, radius: r };
}

// ───────────────────────── Carga ─────────────────────────

const LEG_BONES = new Set(['Bip01', 'Bip01_Pelvis', 'Bip01_Spine', 'Bip01_L_Thigh', 'Bip01_R_Thigh', 'Bip01_L_Calf', 'Bip01_R_Calf', 'Bip01_L_Foot', 'Bip01_R_Foot', 'Bip01_L_Toe0', 'Bip01_R_Toe0']);
const TORSO_BONES = new Set(['Bip01_Spine1', 'Bip01_Spine2', 'Bip01_Neck', 'Bip01_Head', 'Bip01_L_Clavicle', 'Bip01_R_Clavicle', 'Bip01_L_UpperArm', 'Bip01_R_UpperArm',
  'Bip01_L_Forearm', 'Bip01_R_Forearm', 'Bip01_L_Hand', 'Bip01_R_Hand']);
/** armas extra de las ranuras del jugador: pistola, cuchillo, granada */
const EXTRA_GUNS = ['Pistol', 'Knife_1', 'Grenade'];
const SLOT_GUN: Record<string, string> = { secondary: 'Pistol', knife: 'Knife_1', grenade: 'Grenade' };
const IN_PLACE = new Set(['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Fwd_Loop', 'Idle_Loop', 'Roll']);
export const RB_CLIPS = ['Pistol_Idle_Loop', 'Pistol_Aim_Neutral', 'Pistol_Shoot', 'Pistol_Reload', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop',
  'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Punch_Jab', 'Punch_Cross', 'Hit_Chest', 'Hit_Head', 'Death01', 'Sword_Attack'];

type Layer = 'legs' | 'torso';

function filterClip(clip: THREE.AnimationClip, bones: Set<string>, suffix: string): THREE.AnimationClip {
  return new THREE.AnimationClip(`${clip.name}:${suffix}`, clip.duration, clip.tracks.filter((t) => bones.has(t.name.split('.')[0])).map((t) => t.clone()));
}

/** Registro de armas en las manos (para reajustar el agarre en vivo con ?armas=1). */
interface GunEntry { mesh: THREE.Object3D; weapon: string; k: number; maxDim: number }
const gunRegistry = new Set<GunEntry>();
function applyGrip(e: GunEntry): void {
  const g = GUN_GRIP[e.weapon] ?? { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 };
  e.mesh.position.set(g.pos[0], g.pos[1], g.pos[2]);
  e.mesh.rotation.set(THREE.MathUtils.degToRad(g.rot[0]), THREE.MathUtils.degToRad(g.rot[1]), THREE.MathUtils.degToRad(g.rot[2]));
  const s = ((GUN_LEN[e.weapon] ?? 0.8) / e.maxDim) * e.k * g.scale;
  e.mesh.scale.setScalar(s);
}
try {
  if (new URLSearchParams(location.search).get('armas') === '1') {
    (window as unknown as Record<string, unknown>).__armas = {
      get: (arma: string) => GUN_GRIP[arma],
      set: (arma: string, g: Partial<GunGrip>) => {
        GUN_GRIP[arma] = { ...(GUN_GRIP[arma] ?? { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 }), ...g };
        for (const e of gunRegistry) if (e.weapon === arma) applyGrip(e);
      },
    };
  }
} catch { /* sin ventana (pruebas en Node) */ }

export class RbTemplate {
  /** avatar escalado y colocado, listo para clonar */
  holder = new THREE.Group();
  /** copia en reposo, nunca animada, con la misma escala: origen/destino del retargeteo */
  ref!: THREE.Object3D;
  variants: (THREE.Material | THREE.Material[])[][] = [];
  dead: (THREE.Material | THREE.Material[])[] = [];
  height = 1.8;
  barW = 0.7;
  gun = '';
  private full = new Map<string, THREE.AnimationClip | null>();
  private layers = new Map<string, THREE.AnimationClip | null>();

  constructor(public kind: Kind, private lib: RbLibrary) {}

  /** Clip retargeteado entero (perezoso). */
  fullClip(name: string): THREE.AnimationClip | null {
    if (this.full.has(name)) return this.full.get(name) ?? null;
    let r: THREE.AnimationClip | null = null;
    try {
      const src = this.lib.ual?.animations.find((c) => c.name === name);
      if (src && this.lib.ualOrigin) r = retargetClip(src, this.lib.ualOrigin, this.ref, UAL_TO_ROCKETBOX, { inPlace: IN_PLACE.has(name), name });
    } catch (e) { console.warn('retargeteo', this.kind, name, e); }
    this.full.set(name, r);
    return r;
  }

  layerClip(name: string, layer: Layer): THREE.AnimationClip | null {
    const key = `${name}:${layer}`;
    if (this.layers.has(key)) return this.layers.get(key) ?? null;
    const f = this.fullClip(name);
    const r = f ? filterClip(f, layer === 'legs' ? LEG_BONES : TORSO_BONES, layer) : null;
    this.layers.set(key, r);
    return r;
  }
}

/** Registra el arma de un clon (hueso Bip01_R_Hand, malla «arma») para el ajuste en vivo ?armas=1. Devuelve el desregistro. */
export function trackGun(root: THREE.Object3D, weapon: string): () => void {
  void weapon;
  const added: GunEntry[] = [];
  for (const name of ['arma', 'arma_secondary', 'arma_knife', 'arma_grenade']) {
    const o = root.getObjectByName(name);
    if (!o) continue;
    const e: GunEntry = { mesh: o, weapon: o.userData.weapon, k: o.userData.k, maxDim: o.userData.maxDim };
    gunRegistry.add(e); added.push(e);
  }
  return () => { for (const e of added) gunRegistry.delete(e); };
}

export class RbLibrary {
  templates = new Map<Kind, RbTemplate>();
  ual: { animations: THREE.AnimationClip[] } | null = null;
  ualOrigin: THREE.Object3D | null = null;
  avatars = new Map<string, THREE.Group>();
  private guns = new Map<string, { geo: THREE.BufferGeometry; maxDim: number }>();
  private gunMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.7 });
  private manifest: Record<string, Record<string, { color?: string; normal?: string }>> = {};
  private ghost: THREE.Material | null = null;
  loaded = false;
  /** sin normal maps en los personajes (calidad media): se guardan los originales para poder volver */
  private useNormals = true;
  private normalOf = new Map<THREE.Material, THREE.Texture | null>();

  /** URL (dentro de public/models) del maniquí de animaciones recortado (tools/recortar-ual.ts). */
  ualUrl = 'anim/ual-min.glb';
  /** true si algo imprescindible falló: el juego usa los Quaternius de reserva */
  failed = false;
  private wanted = new Set<Kind>();
  private ualPromise: Promise<void> | null = null;
  private avatarPromises = new Map<string, Promise<void>>();
  private gunPromises = new Map<string, Promise<void>>();
  private ualReady = false;
  private cbLast = false;
  warmed = new Set<Kind>();
  private extrasDone = false;

  /** Los cuatro operadores de la escuadra (la vista previa y todas las partidas los necesitan). */
  static readonly SQUAD: Kind[] = ['captain', 'technic', 'especialist', 'explosives'];

  /** Compatibilidad: carga lo mínimo (la escuadra). */
  load(): Promise<boolean> { return this.ensure(RbLibrary.SQUAD); }

  /** Carga (solo lo que falte) el UAL, los avatares y las armas de esos tipos. Nunca rechaza. */
  ensure(kinds: Kind[]): Promise<boolean> {
    for (const k of kinds) this.wanted.add(k);
    return this.doEnsure();
  }

  private async doEnsure(): Promise<boolean> {
    try {
      this.ualPromise ??= (async () => {
        const [man, ual] = await Promise.all([
          fetch(modelsUrl('rb/texturas.json')).then((r) => r.json()),
          new GLTFLoader().loadAsync(modelsUrl(this.ualUrl)),
        ]);
        this.manifest = man;
        this.ual = { animations: ual.animations };
        this.ualOrigin = SkeletonUtils.clone(ual.scene);
        this.ualOrigin.updateMatrixWorld(true);
        this.ualReady = true;
      })();
      const jobs: Promise<void>[] = [this.ualPromise];
      for (const k of this.wanted) {
        const cfg = CFG[k];
        if (!this.avatarPromises.has(cfg.avatar)) this.avatarPromises.set(cfg.avatar, this.ualPromise.then(() => this.loadAvatar(cfg.avatar)));
        if (!this.gunPromises.has(cfg.gun)) this.gunPromises.set(cfg.gun, this.loadGun(cfg.gun));
        jobs.push(this.avatarPromises.get(cfg.avatar)!, this.gunPromises.get(cfg.gun)!);
      }
      // los cuatro operadores llevan también pistola, cuchillo y granada para el cambio de ranura del jugador
      if (RbLibrary.SQUAD.some((k) => this.wanted.has(k))) {
        for (const g of EXTRA_GUNS) {
          if (!this.gunPromises.has(g)) this.gunPromises.set(g, this.loadGun(g));
          jobs.push(this.gunPromises.get(g)!);
        }
      }
      await Promise.all(jobs);
      this.loaded = true;
      this.extrasDone = true;
    } catch (e) {
      console.warn('Rocketbox: no se pudo cargar', e);
      this.failed = true;
      this.loaded = false;
    }
    return this.loaded;
  }

  /** Fracción (0..1) de lo necesario para esos tipos ya cargado y con sus clips retargeteados. 1 si falló (se usa la reserva). */
  progress(kinds: Kind[]): number {
    if (this.failed) return 1;
    let done = this.ualReady ? 1 : 0, total = 1;
    total += 1; if (this.extrasDone) done++;          // pistola, cuchillo y granada del jugador
    for (const k of kinds) {
      total += 2;
      if (this.avatars.has(CFG[k].avatar)) done++;
      if (this.warmed.has(k)) done++;
    }
    return Math.min(1, done / total);
  }

  /** ¿Hay (o ha fallado) plantilla para este tipo? */
  has(kind: Kind): boolean { return this.templates.has(kind); }

  private async loadAvatar(name: string): Promise<void> {
    const g = await new FBXLoader().loadAsync(modelsUrl(`rb/${name}/${name}.fbx`));
    const mats = this.manifest[name] ?? {};
    const tl = new THREE.TextureLoader();
    const tex = async (f: string | undefined, color: boolean): Promise<THREE.Texture | undefined> => {
      if (!f) return undefined;
      try {
        const t = await tl.loadAsync(modelsUrl(`rb/${name}/${f}`));
        t.anisotropy = 8;
        if (color) t.colorSpace = THREE.SRGBColorSpace;
        return t;
      } catch { return undefined; }
    };
    const conv = new Map<THREE.Material, Promise<THREE.Material>>();
    const convert = (m: THREE.Material): Promise<THREE.Material> => {
      let p = conv.get(m);
      if (!p) {
        p = (async () => {
          const d = mats[m.name] ?? {};
          const [map, normalMap] = await Promise.all([tex(d.color, true), tex(d.normal, false)]);
          const mt = new THREE.MeshStandardMaterial({ name: m.name, roughness: 0.78, metalness: 0, side: (m as THREE.MeshPhongMaterial).side });
          if (map) mt.map = map;
          if (normalMap) mt.normalMap = normalMap;
          return mt;
        })();
        conv.set(m, p);
      }
      return p;
    };
    const meshes: THREE.Mesh[] = [];
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    for (const m of meshes) {
      m.material = Array.isArray(m.material) ? await Promise.all(m.material.map(convert)) : await convert(m.material);
      m.frustumCulled = false;
    }
    this.avatars.set(name, g);
  }

  private async loadGun(name: string): Promise<void> {
    try {
      const g = await new GLTFLoader().loadAsync(modelsUrl(`guns/${name}.gltf`));
      const geo = bakeColored(g.scene);
      if (!geo) return;
      // acero pavonado y polímero negro: se reasignan los colores por luminosidad
      const c = geo.getAttribute('color');
      const olive = name === 'Grenade';
      const steel = new THREE.Color(olive ? 0x4a5238 : 0x30343a), poly = new THREE.Color(olive ? 0x2c3224 : 0x0e0f12);
      for (let i = 0; i < c.count; i++) {
        const lum = 0.299 * c.getX(i) + 0.587 * c.getY(i) + 0.114 * c.getZ(i);
        const k = lum > 0.12 ? steel : poly;
        c.setXYZ(i, k.r, k.g, k.b);
      }
      geo.computeBoundingBox();
      const s = geo.boundingBox!.getSize(new THREE.Vector3());
      this.guns.set(name, { geo, maxDim: Math.max(s.x, s.y, s.z) || 1 });
    } catch (e) { console.warn('Rocketbox: arma no cargada', name, e); }
  }

  setNormals(on: boolean): void {
    this.useNormals = on;
    for (const t of this.templates.values()) this.applyNormals(t);
  }

  private applyNormals(t: RbTemplate): void {
    const each = (m: THREE.Material | THREE.Material[]): void => {
      for (const mat of Array.isArray(m) ? m : [m]) {
        const sm = mat as THREE.MeshStandardMaterial;
        if (!this.normalOf.has(sm)) this.normalOf.set(sm, sm.normalMap);
        const want = this.useNormals ? this.normalOf.get(sm) ?? null : null;
        if (sm.normalMap !== want) { sm.normalMap = want; sm.needsUpdate = true; }
      }
    };
    for (const v of t.variants) for (const m of v) each(m);
    for (const m of t.dead) each(m);
  }

  /** Construye (o reconstruye, p. ej. al cambiar daltonismo) las plantillas de todos los tipos. */
  build(cb: boolean, onlyMissing = false): void {
    if (!onlyMissing || cb !== this.cbLast) { this.templates.clear(); this.warmed.clear(); }
    this.cbLast = cb;
    if (!this.loaded) return;
    for (const kind of this.wanted) {
      if (this.templates.has(kind) || !this.avatars.has(CFG[kind].avatar)) continue;
      try { const t = this.buildOne(kind, cb); this.templates.set(kind, t); this.applyNormals(t); } catch (e) { console.warn('Rocketbox: plantilla', kind, e); }
    }
  }

  private buildOne(kind: Kind, cb: boolean): RbTemplate {
    const cfg = CFG[kind];
    const base = this.avatars.get(cfg.avatar);
    if (!base) throw new Error('falta el avatar ' + cfg.avatar);
    const t = new RbTemplate(kind, this);
    const model = SkeletonUtils.clone(base);
    t.holder.add(model);
    t.holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(t.holder, true);
    const target = statsOf(kind).height;
    const s = target / Math.max(1e-3, box.max.y - box.min.y);
    t.holder.scale.set(s * cfg.wx, s, s * cfg.wx);
    t.holder.position.y = -box.min.y * s;
    t.holder.updateMatrixWorld(true);
    t.height = target; t.barW = cfg.barW; t.gun = cfg.gun;
    // referencia para el retargeteo: el avatar en reposo, con la escala con que se dibuja
    t.ref = SkeletonUtils.clone(t.holder);
    t.ref.updateMatrixWorld(true);

    // materiales: una lista por variante de tinte, alineada con el orden de las mallas con esqueleto
    const meshes: THREE.Mesh[] = [];
    model.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const each = (m: THREE.Material | THREE.Material[], f: (x: THREE.Material) => THREE.Material): THREE.Material | THREE.Material[] =>
      (Array.isArray(m) ? m.map(f) : f(m));
    const variants = cfg.tints.length ? cfg.tints : [null];
    for (const tint of variants) {
      t.variants.push(meshes.map((m) => each(m.material, (mat) => (tint && isTintable(mat.name) ? tintMaterial(mat, tint) : mat))));
    }
    t.dead = meshes.map((m) => each(m.material, (mat) => { const c = (mat as THREE.MeshStandardMaterial).clone(); c.color.multiplyScalar(0.35); return c; }));
    // las mallas del modelo base usan la variante 0
    meshes.forEach((m, i) => { m.material = t.variants[0][i]; });

    // brazaletes y dedos
    if (cfg.band !== 'none') {
      const st = bandStyle(cfg, cb);
      addArmband(model, 'L', st);
      if (cfg.band === 'hostile' || cfg.both) addArmband(model, 'R', st);   // hostiles: en los dos brazos, visibles desde cualquier lado
    }
    this.curlFingers(model);

    // arma en la mano derecha
    const gun = this.guns.get(cfg.gun);
    const hand = model.getObjectByName('Bip01_R_Hand');
    if (gun && hand) {
      const mesh = new THREE.Mesh(gun.geo, this.gunMat);
      mesh.name = 'arma';
      mesh.frustumCulled = false;
      mesh.userData.weapon = cfg.gun;
      mesh.userData.k = 1 / s;
      mesh.userData.maxDim = gun.maxDim;
      hand.add(mesh);
      applyGrip({ mesh, weapon: cfg.gun, k: 1 / s, maxDim: gun.maxDim });
    }
    if (hand && RbLibrary.SQUAD.includes(kind)) {
      for (const [slot, name] of Object.entries(SLOT_GUN)) {
        const g = this.guns.get(name);
        if (!g) continue;
        const m = new THREE.Mesh(g.geo, this.gunMat);
        m.name = 'arma_' + slot; m.frustumCulled = false; m.visible = false;
        m.userData.weapon = name; m.userData.k = 1 / s; m.userData.maxDim = g.maxDim;
        hand.add(m);
        applyGrip({ mesh: m, weapon: name, k: 1 / s, maxDim: g.maxDim });
      }
    }
    return t;
  }

  /** Agarre fijo: curva las tres falanges de cada dedo de las dos manos. */
  private curlFingers(model: THREE.Object3D): void {
    model.traverse((o) => {
      const m = /^Bip01_[LR]_Finger(\d)(\d?)$/.exec(o.name);
      if (!m) return;
      const finger = Number(m[1]), phalanx = m[2] === '' ? 0 : Number(m[2]);
      const ang = finger === 0 ? FINGER_CURL.thumb : phalanx === 0 ? FINGER_CURL.proximal : phalanx === 1 ? FINGER_CURL.middle : FINGER_CURL.distal;
      const ax = new THREE.Vector3(FINGER_AXIS === 'x' ? 1 : 0, FINGER_AXIS === 'y' ? 1 : 0, FINGER_AXIS === 'z' ? 1 : 0);
      o.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(ax, ang));
    });
  }

  ghostMaterial(): THREE.Material {
    if (!this.ghost) this.ghost = new THREE.MeshStandardMaterial({ color: 0x9db4d6, transparent: true, opacity: 0.22, depthWrite: false, roughness: 1 });
    return this.ghost;
  }

  /** Retargetea todos los clips repartiendo el trabajo (un clip por tarea) para no bloquear el hilo. */
  async prewarm(): Promise<void> {
    for (const [kind, t] of this.templates) {
      if (this.warmed.has(kind)) continue;
      for (const n of RB_CLIPS) {
        t.layerClip(n, 'legs'); t.layerClip(n, 'torso');
        t.fullClip(n);
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      this.warmed.add(kind);
    }
  }

  dispose(): void {
    this.templates.clear();
    this.gunMat.dispose();
    gunRegistry.clear();
  }
}

// ───────────────────────── Vista de un personaje ─────────────────────────

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _ax = new THREE.Vector3(1, 0, 0), _dl = new THREE.Vector3();

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class RbView {
  readonly skinned = true;
  root = new THREE.Group();
  inner: THREE.Object3D;
  private meshes: THREE.Mesh[] = [];
  private extra: THREE.Object3D[] = [];
  mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private legs: THREE.AnimationAction | null = null; private legsName = '';
  private torso: THREE.AnimationAction | null = null; private torsoName = '';
  private death: THREE.AnimationAction | null = null;
  private variant = 0;
  private matState = '';
  private lastShot = -1; private lastKnife = -1; private punchAlt = false; private lastHurt = -1;
  private hitUntil = 0;
  private lastStagger = 0;
  private kick = 0;
  private deathFrom: { x: number; y: number } | null = null;
  private recoil = 0;
  private tilt: { bone: THREE.Object3D; saved: THREE.Quaternion; k: number; has: boolean }[] = [];
  private slotGuns = new Map<string, GunEntry>();
  private slot = 'primary';
  private hand: THREE.Object3D | null = null;
  private drawDur = 0.35;
  mark: THREE.Mesh | null = null;
  shield: THREE.Mesh | null = null;
  ring: THREE.Mesh | null = null;
  x = 0; y = 0; yaw = 0; crouchK = 0; speed = 0; init = false; ghost = false;
  pendingDt = 0;
  height: number; barW: number;

  constructor(private tpl: RbTemplate, id: number, private lib: RbLibrary) {
    this.inner = SkeletonUtils.clone(tpl.holder);
    this.root.add(this.inner);
    this.inner.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) this.meshes.push(o as THREE.Mesh);
      else if ((o as THREE.Mesh).isMesh) this.extra.push(o);
    });
    this.variant = tpl.variants.length > 1 ? id % tpl.variants.length : 0;
    this.hand = this.inner.getObjectByName('Bip01_R_Hand') ?? null;
    for (const [slot, name] of [['primary', 'arma'], ['secondary', 'arma_secondary'], ['knife', 'arma_knife'], ['grenade', 'arma_grenade']] as [string, string][]) {
      const o = this.inner.getObjectByName(name);
      if (!o) continue;
      const e: GunEntry = { mesh: o, weapon: o.userData.weapon, k: o.userData.k, maxDim: o.userData.maxDim };
      this.slotGuns.set(slot, e); gunRegistry.add(e);
    }
    this.mixer = new THREE.AnimationMixer(this.inner);
    for (const [name, k] of [['Bip01_Spine1', 0.45], ['Bip01_Spine2', 0.55]] as [string, number][]) {
      const b = this.inner.getObjectByName(name);
      if (b) this.tilt.push({ bone: b, saved: new THREE.Quaternion(), k, has: false });
    }
    this.height = tpl.height; this.barW = tpl.barW;
  }

  /** Posición del tirador que dio el golpe final (para orientar y empujar la caída). */
  setDeathFrom(x: number, y: number): void { this.deathFrom = { x, y }; }

  private action(name: string, layer: Layer | 'full'): THREE.AnimationAction | null {
    const key = `${name}:${layer}`;
    let a = this.actions.get(key);
    if (!a) {
      const clip = layer === 'full' ? this.tpl.fullClip(name) : this.tpl.layerClip(name, layer);
      if (!clip) return null;
      a = this.mixer.clipAction(clip);
      this.actions.set(key, a);
    }
    return a;
  }

  private setLayer(layer: Layer, name: string, once: boolean, ts: number, fade = FADE_TIME, restart = false): void {
    const cur = layer === 'legs' ? this.legs : this.torso;
    const curName = layer === 'legs' ? this.legsName : this.torsoName;
    if (curName !== name || restart) {
      const next = this.action(name, layer);
      if (!next) return;
      next.reset();
      next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = once;
      next.setEffectiveWeight(1);
      next.fadeIn(fade);
      next.play();
      if (cur && cur !== next) cur.fadeOut(fade);
      if (layer === 'legs') { this.legs = next; this.legsName = name; } else { this.torso = next; this.torsoName = name; }
      next.setEffectiveTimeScale(ts);
    } else if (cur) cur.setEffectiveTimeScale(ts);
  }

  /** Decide las animaciones según el estado de la entidad. */
  private decide(e: Entity, time: number): void {
    if (!e.alive) {
      if (!this.death) {
        const a = this.action('Death01', 'full');
        if (a) {
          this.legs?.fadeOut(0.1); this.torso?.fadeOut(0.1);
          a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.fadeIn(0.1); a.play();
          const dur = a.getClip().duration;
          const el = e.deadAt < 0 ? dur : Math.max(0, time - e.deadAt);
          if (el > 0.05) a.time = Math.min(dur, el);
          this.death = a;
        }
      }
      return;
    }
    const sp = this.speed;
    const moving = sp > MOVE_MIN_SPEED;
    // piernas
    let legName: string, ref: number;
    if (e.crouch) { legName = moving ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop'; ref = CROUCH_REF_SPEED; }
    else if (!moving) { legName = 'Pistol_Idle_Loop'; ref = 1; }
    else if (e.sprinting) { legName = 'Sprint_Loop'; ref = SPRINT_REF_SPEED; }
    else if (sp < WALK_MAX_SPEED) { legName = 'Walk_Loop'; ref = WALK_REF_SPEED; }
    else if (sp < JOG_MAX_SPEED) { legName = 'Jog_Fwd_Loop'; ref = JOG_REF_SPEED; }
    else { legName = 'Sprint_Loop'; ref = SPRINT_REF_SPEED; }
    const ts = moving ? Math.min(TIMESCALE_MAX, Math.max(TIMESCALE_MIN, sp / ref)) : 1;
    this.setLayer('legs', legName, false, ts);
    const slot = e.isPlayer ? (e.weapon ?? 'primary') : 'primary';
    const armed = slot === 'primary' || slot === 'secondary';
    // torso
    const staggered = (e.staggerUntil ?? 0) > time;
    if (staggered) {
      // reacción de impacto fuerte, una vez por aturdimiento (Hit_Head si existe, Hit_Chest al 100 %)
      const hit = this.tpl.fullClip('Hit_Head') ? 'Hit_Head' : 'Hit_Chest';
      this.setLayer('torso', hit, true, 1, 0.05, e.staggerUntil !== this.lastStagger);
      if (e.staggerUntil !== this.lastStagger) { this.lastStagger = e.staggerUntil ?? 0; this.kick = 1; }
    } else if (e.lastKnifeAt !== this.lastKnife && time - e.lastKnifeAt < 0.6 && time >= e.lastKnifeAt) {
      this.lastKnife = e.lastKnifeAt; this.punchAlt = !this.punchAlt;
      const stab = slot === 'knife' && this.tpl.fullClip('Sword_Attack');
      this.setLayer('torso', stab ? 'Sword_Attack' : this.punchAlt ? 'Punch_Jab' : 'Punch_Cross', true, stab ? 1.5 : 1.3, 0.08, true);
    } else if (time - e.lastKnifeAt < 0.6 && time >= e.lastKnifeAt) {
      // sigue el golpe
    } else if (!armed) {
      this.setLayer('torso', legName, false, ts);              // cuchillo o granada: brazo bajado, sin apuntar
    } else if (e.sprinting && moving) {
      this.setLayer('torso', legName, false, ts);              // esprintando: el torso del propio clip, arma baja
    } else if (e.reloading > 0) {
      this.setLayer('torso', 'Pistol_Reload', false, 1);
    } else if (time - e.lastShotAt < 0.35 && time >= e.lastShotAt) {
      this.setLayer('torso', 'Pistol_Shoot', true, 1, 0.04, e.lastShotAt !== this.lastShot);
      this.lastShot = e.lastShotAt;
    } else if ((time - e.lastShotAt < 0.6 && time >= e.lastShotAt) || (e.isPlayer && e.aiming)) {
      this.setLayer('torso', 'Pistol_Aim_Neutral', false, 1);   // apuntando, aunque no dispare
    } else {
      this.setLayer('torso', legName, false, ts);
    }
    // golpe recibido: Hit_Chest mezclado al 60 %
    if (!staggered && e.lastHurtAt !== this.lastHurt && time - e.lastHurtAt < 0.3 && time >= e.lastHurtAt) {
      this.lastHurt = e.lastHurtAt;
      const h = this.action('Hit_Chest', 'torso');
      if (h) { h.reset(); h.setLoop(THREE.LoopOnce, 1); h.clampWhenFinished = false; h.setEffectiveWeight(0.6); h.play(); this.hitUntil = time + 0.33; this.torso?.setEffectiveWeight(0.4); }
    } else if (this.hitUntil > 0 && time > this.hitUntil) { this.hitUntil = 0; this.torso?.setEffectiveWeight(1); }
  }

  update(e: Entity, time: number, dt: number, host: CharHost, animate: boolean, animDt: number): void {
    const k = 1 - Math.exp(-dt * (e.isPlayer ? 30 : 24));
    if (!this.init || Math.hypot(e.x - this.x, e.y - this.y) > 3) { this.x = e.x; this.y = e.y; this.yaw = e.yaw; this.init = true; }
    else { this.x += (e.x - this.x) * k; this.y += (e.y - this.y) * k; this.yaw = lerpAngle(this.yaw, e.yaw, 1 - Math.exp(-dt * 18)); }
    const alive = e.alive;
    let px = this.x, pz = this.y;
    if (!alive && this.deathFrom) {
      // cae alejándose del tirador: el cadáver se gira de cara a él (la animación cae hacia atrás) y se desplaza un poco
      const f = this.deathFrom;
      this.yaw = lerpAngle(this.yaw, Math.atan2(f.y - this.y, f.x - this.x), 1 - Math.exp(-dt * 14));
      const dx = this.x - f.x, dz = this.y - f.y, l = Math.hypot(dx, dz) || 1;
      const dur = this.tpl.fullClip('Death01')?.duration ?? 2.4;
      const p = e.deadAt < 0 ? 1 : Math.min(1, Math.max(0, (time - e.deadAt) / (dur * 0.6)));
      const ease = 1 - (1 - p) * (1 - p);
      px += (dx / l) * DEATH_PUSH * ease; pz += (dz / l) * DEATH_PUSH * ease;
    }
    this.root.position.set(px, 0, pz);
    this.root.rotation.y = Math.PI / 2 - this.yaw + RB_YAW_OFFSET;
    // pequeño retroceso del cuerpo al ser aturdido
    this.kick *= Math.exp(-dt * 9);
    this.inner.position.z = -this.kick * 0.12;
    // arma en la mano según la ranura activa (solo el jugador cambia de ranura): el arma sube desde abajo hasta drawUntil
    const slot = e.isPlayer ? (e.weapon ?? 'primary') : 'primary';
    if (slot !== this.slot) {
      this.slot = slot;
      for (const [k, g] of this.slotGuns) g.mesh.visible = k === slot;
      this.drawDur = Math.max(0.1, (e.drawUntil ?? 0) - time);
      this.recoil = -1;                          // fuerza recolocar el arma nueva
    }
    const gun = this.slotGuns.get(this.slot) ?? this.slotGuns.get('primary');
    if (gun && alive) {
      // retroceso (60 ms) tras cada disparo, hacia atrás a lo largo del cañón (+X del hueso de la mano)
      const ts = time - e.lastShotAt;
      const r = ts >= 0 && ts < GUN_KICK_TIME ? GUN_KICK_CM * (1 - ts / GUN_KICK_TIME) : 0;
      const drawing = (e.drawUntil ?? 0) > time && e.isPlayer;
      if (r !== this.recoil || drawing) {
        this.recoil = r;
        const g = GUN_GRIP[gun.weapon];
        if (g) {
          let ox = g.pos[0] - r, oy = g.pos[1], oz = g.pos[2];
          if (drawing && this.hand) {
            const p = Math.min(1, Math.max(0, 1 - ((e.drawUntil ?? 0) - time) / this.drawDur));
            this.hand.getWorldQuaternion(_q).invert();
            _dl.set(0, -1, 0).applyQuaternion(_q);
            const cm = (1 - p) * (0.4 / Math.max(1e-3, this.inner.scale.y));     // 40 cm de recorrido, en el espacio del hueso (cm)
            ox += _dl.x * cm; oy += _dl.y * cm; oz += _dl.z * cm;
          }
          gun.mesh.position.set(ox, oy, oz);
        }
      }
    }

    // materiales: normal (con tinte), muerto, fantasma o destello (compartidos)
    const hurt = alive && !this.ghost && time - e.lastHurtAt < 0.12 && time >= e.lastHurtAt;
    const state = !alive ? 'dead' : this.ghost ? 'ghost' : hurt ? 'flash' : 'norm' + this.variant;
    if (state !== this.matState) {
      this.matState = state;
      const set = state === 'dead' ? this.tpl.dead : state === 'norm' + this.variant ? this.tpl.variants[this.variant] : null;
      this.meshes.forEach((m, i) => { m.material = set ? set[i] : state === 'flash' ? host.matFlash : this.lib.ghostMaterial(); });
      const cast = host.shadowsOn && state !== 'ghost';
      for (const m of this.meshes) m.castShadow = cast;
      for (const o of this.extra) o.castShadow = cast;
    }

    if (animate) {
      // restaura la pose animada de los huesos inclinados antes de mezclar (el mezclador no reescribe lo que no cambia)
      for (const t of this.tilt) if (t.has) t.bone.quaternion.copy(t.saved);
      this.decide(e, time);
      this.mixer.update(animDt);
      const tiltOn = alive && e.isPlayer;
      for (const t of this.tilt) {
        t.has = tiltOn;
        if (tiltOn) { t.saved.copy(t.bone.quaternion); this.tiltBone(t.bone, -e.pitch * RB_PITCH_FACTOR * t.k); }
      }
    }
    this.overlays(e, time, host, alive);
  }

  /** Giro de un hueso alrededor del eje lateral del modelo, compuesto sobre la animación. */
  private tiltBone(bone: THREE.Object3D, angle: number): void {
    if (Math.abs(angle) < 1e-4) return;
    _q.identity();
    for (let o: THREE.Object3D | null = bone.parent; o && o !== this.inner; o = o.parent) _q.premultiply(o.quaternion);
    _q2.setFromAxisAngle(_ax, angle);
    bone.quaternion.premultiply(_q).premultiply(_q2).premultiply(_q.clone().invert());
  }

  private overlays(e: Entity, time: number, host: CharHost, alive: boolean): void {
    const h = THREE.MathUtils.lerp(this.height, RB_CROUCH_HEIGHT, this.crouchK);
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
    for (const e of this.slotGuns.values()) gunRegistry.delete(e);
    for (const m of this.meshes) (m as THREE.SkinnedMesh).skeleton?.dispose();
  }
}

/** Biblioteca compartida por el juego y la vista previa del escuadrón (misma caché de modelos y clips). */
export const sharedRbLibrary = new RbLibrary();
