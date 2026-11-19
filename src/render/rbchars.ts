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
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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
/** Escudo antidisturbios, hombreras y bandolera (cm, espacio del modelo: +Z delante, +X izquierda). */
export const RIOT_SHIELD = { pos: [14, 118, 36] as [number, number, number], size: [55, 85, 4] as [number, number, number], visorY: 28 };
export const PAD_POS = { x: 26, y: 152, size: [22, 14, 26] as [number, number, number], plate: [0, 128, 24] as [number, number, number], plateSize: [46, 40, 6] as [number, number, number] };
/** Tinte claro/civil del rehén */
export const CIVIL_TINT: TintSpec = { tono: 0.58, satMul: 0, satAdd: 0.12, valMul: 1.15 };
export const BANDOLIER = { pos: [0, 126, 17] as [number, number, number], rotZ: 0.62 };
/** Duración (s) de la voltereta y de la transición al levantarse un derribado. */
export const ROLL_TIME = 0.5;
export const REVIVE_FADE = 0.4;
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
  Sniper: { pos: [6, 0, 0], rot: [0, 180, 0], scale: 1 },
  Sniper_2: { pos: [6, 0, 0], rot: [0, 180, 0], scale: 1 },
  GrenadeLauncher: { pos: [6, 0, 0], rot: [0, 180, 0], scale: 1 },
  // armas nuevas: el origen del modelo está en la empuñadura, el cañón apunta a -X y arriba es +Y (ver canonicalizeTasty)
  M4A1: { pos: [6, 0, 0], rot: [0, 180, 0], scale: 1 },
  MP5: { pos: [6, 0, 0], rot: [0, 180, 0], scale: 1 },
  M249: { pos: [6, 0, 0], rot: [0, 180, 0], scale: 1 },
  MGL: { pos: [6, 0, 0], rot: [0, 180, 0], scale: 1 },
  M1911: { pos: [5, 0, 0], rot: [0, 180, 0], scale: 1 },
  REM870: { pos: [6, 0, 0], rot: [0, 180, 0], scale: 1 },
  SVD: { pos: [6, 0, 0], rot: [0, 180, 0], scale: 1 },
  M67: { pos: [5, 0, 0], rot: [0, 0, 0], scale: 1 },
  Knife_1: { pos: [5, 0, 0], rot: [0, 0, -90], scale: 1 },   // el cuchillo del pack es largo en Y: se tumba a lo largo del antebrazo (X de la mano)
  Grenade: { pos: [5, 0, 0], rot: [0, 0, 0], scale: 1 },
};
/** Peso del blocaje de puntería durante la recarga (la animación sube el arma ~47°; así quedan ~10°). */
const RELOAD_LOCK = 0.8;
/** Armas cuyo agarre se calcula solo a partir de la pose de apuntado (ver RbLibrary.calibrateGrips). */
const AUTO_GRIP: Record<string, true> = { M4A1: true, MP5: true, M249: true, MGL: true, M1911: true, REM870: true, SVD: true };
/** Longitud real (m) de cada arma. */
/**
 * Armas nuevas (TastyTony, Sketchfab, CC BY 4.0): clave de juego → carpeta en public/models/armas, punto de agarre
 * [fracción de la longitud desde la culata, fracción de la altura desde abajo] de la empuñadura, y el arma del pack anterior
 * que se usa como reserva si falla la carga.
 */
export const TASTY: Record<string, { folder: string; grip: [number, number]; fallback: string }> = {
  M4A1: { folder: 'm4a1', grip: [0.27, 0.40], fallback: 'AK' },
  MP5: { folder: 'mp5', grip: [0.41, 0.40], fallback: 'SMG' },
  M249: { folder: 'm249', grip: [0.31, 0.34], fallback: 'ShortCannon' },
  MGL: { folder: 'milkor', grip: [0.27, 0.40], fallback: 'RocketLauncher' },
  M1911: { folder: 'm1911', grip: [0.17, 0.35], fallback: 'Pistol' },
  REM870: { folder: 'remington870', grip: [0.10, 0.32], fallback: 'Shotgun' },
  SVD: { folder: 'dragunov', grip: [0.20, 0.22], fallback: 'Sniper' },
  M67: { folder: 'm67', grip: [0.5, 0.5], fallback: 'Grenade' },
};
/** Longitud total real (m) de cada arma nueva (M67: alto). */
export const GUN_LEN_NEW: Record<string, number> = { M4A1: 0.84, MP5: 0.68, M249: 1.04, MGL: 0.78, M1911: 0.22, REM870: 1.0, SVD: 1.22, M67: 0.09 };
export const GUN_LEN: Record<string, number> = { Sniper: 1.1, Sniper_2: 1.05, GrenadeLauncher: 0.75, AK: 0.9, SMG: 0.6, ShortCannon: 0.8, RocketLauncher: 0.8, Pistol: 0.2, Shotgun: 1.0, Knife_1: 0.28, Grenade: 0.1, ...GUN_LEN_NEW };

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
  /** teñir también el material de la cabeza (lleva la gorra/casco; la máscara «sinpiel» respeta la piel) */
  tintHead?: boolean;
  /** brazalete en los dos brazos */
  both?: boolean;
  bandRadius?: number;
  barW: number;
}

const CFG: Record<Kind, Cfg> = {
  captain: { avatar: 'Military_Male_01', gun: 'M4A1', tints: [], wx: 1, band: 'none', barW: 0.7 },
  technic: { avatar: 'Military_Male_05', gun: 'MP5', tints: [NAVY], wx: 1, band: 'none', tintHead: true, barW: 0.7 },
  especialist: { avatar: 'Military_Male_04', gun: 'M249', tints: [URBAN_GREY], wx: 1.05, band: 'ally', barW: 0.75 },
  explosives: { avatar: 'Military_Male_03', gun: 'MGL', tints: [BLACK], wx: 1.05, band: 'none', barW: 0.75 },
  enemy1: { avatar: 'Security_Male_01', gun: 'M1911', tints: [], wx: 0.95, band: 'hostile', barW: 0.6 },
  enemy2: {
    avatar: 'Police_Male_01', gun: 'MP5', wx: 1, band: 'hostile', barW: 0.7,
    tints: [BLACK, { tono: 0.0, satMul: 0, satAdd: 0.55, valMul: 0.5 }, { tono: 0.09, satMul: 0, satAdd: 0.35, valMul: 0.6 }, { tono: 0.07, satMul: 0, satAdd: 0.45, valMul: 0.42 }],
  },
  enemy3: { avatar: 'Police_Male_02', gun: 'REM870', tints: [{ tono: 0.03, satMul: 0, satAdd: 0.5, valMul: 0.5 }], wx: 1.08, band: 'hostile', barW: 0.75 },
  miniboss: { avatar: 'Police_Male_02', gun: 'RocketLauncher', tints: [{ tono: 0.0, satMul: 0, satAdd: 0.12, valMul: 0.26 }], wx: 1.15, band: 'hostile', bandRadius: 7.6, barW: 1.0 },
  megaboss: { avatar: 'Military_Male_02', gun: 'M249', tints: [{ tono: 0.97, satMul: 0, satAdd: 0.5, valMul: 0.28 }], wx: 1.15, band: 'hostile', both: true, bandRadius: 7.4, barW: 1.2 },
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
/** arma alternativa de la clase (primaryVariant 1): el capitán conserva su fusil */
export const VARIANT_GUN: Partial<Record<Kind, string>> = { technic: 'REM870', especialist: 'SVD', explosives: 'MGL' };
/** tintes sobrios de los oficios de enemigo */
export const VARIANT_TINT: Record<string, TintSpec> = {
  asaltante: { tono: 0.0, satMul: 0, satAdd: 0.42, valMul: 0.42 },
  tirador: { tono: 0.6, satMul: 0, satAdd: 0.03, valMul: 0.5 },
  granadero: { tono: 0.25, satMul: 0, satAdd: 0.38, valMul: 0.48 },
  blindado: { tono: 0.62, satMul: 0, satAdd: 0.42, valMul: 0.34 },
};
const EXTRA_GUNS = ['M1911', 'Knife_1', 'M67'];
const SLOT_GUN: Record<string, string> = { secondary: 'M1911', knife: 'Knife_1', grenade: 'M67' };
const IN_PLACE = new Set(['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Fwd_Loop', 'Idle_Loop', 'Roll']);
export const RB_CLIPS = ['Pistol_Idle_Loop', 'Pistol_Aim_Neutral', 'Pistol_Shoot', 'Pistol_Reload', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop',
  'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Punch_Jab', 'Punch_Cross', 'Hit_Chest', 'Hit_Head', 'Death01', 'Sword_Attack'];

type Layer = 'legs' | 'torso';

function filterClip(clip: THREE.AnimationClip, bones: Set<string>, suffix: string): THREE.AnimationClip {
  return new THREE.AnimationClip(`${clip.name}:${suffix}`, clip.duration, clip.tracks.filter((t) => bones.has(t.name.split('.')[0])).map((t) => t.clone()));
}

/** Registro de armas en las manos (para reajustar el agarre en vivo con ?armas=1). */
export interface GunEntry { mesh: THREE.Object3D; weapon: string; k: number; maxDim: number; mul?: number; len?: number }
const gunRegistry = new Set<GunEntry>();
/** Para las vistas de desarrollo (armas.html): permite el ajuste en vivo ?armas=1 sobre su propia malla. */
export function registerGun(e: GunEntry): () => void { gunRegistry.add(e); return () => { gunRegistry.delete(e); }; }
export function applyGrip(e: GunEntry): void {
  const g = GUN_GRIP[e.weapon] ?? { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 };
  e.mesh.position.set(g.pos[0], g.pos[1], g.pos[2]);
  e.mesh.rotation.set(THREE.MathUtils.degToRad(g.rot[0]), THREE.MathUtils.degToRad(g.rot[1]), THREE.MathUtils.degToRad(g.rot[2]));
  const s = ((e.len ?? GUN_LEN[e.weapon] ?? 0.8) / e.maxDim) * e.k * g.scale * (e.mul ?? 1);
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
  /** materiales originales (sin tinte) en el orden de las mallas */
  base: (THREE.Material | THREE.Material[])[] = [];
  private sets = new Map<string, (THREE.Material | THREE.Material[])[]>();
  dead: (THREE.Material | THREE.Material[])[] = [];
  height = 1.8;
  barW = 0.7;
  gun = '';
  private full = new Map<string, THREE.AnimationClip | null>();
  private layers = new Map<string, THREE.AnimationClip | null>();

  constructor(public kind: Kind, private lib: RbLibrary) {}

  /** Materiales con el tinte de un oficio de enemigo (se crean una vez y se comparten). */
  tintSet(key: string, spec: TintSpec): (THREE.Material | THREE.Material[])[] {
    let r = this.sets.get(key);
    if (!r) {
      const each = (m: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] =>
        Array.isArray(m) ? m.map((x) => (isTintable(x.name) ? tintMaterial(x, spec) : x)) : (isTintable(m.name) ? tintMaterial(m, spec) : m);
      r = this.base.map(each);
      this.sets.set(key, r);
      this.lib.fixNormals(r);
    }
    return r;
  }

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

// ───────────────────────── Armas: materiales PBR creíbles ─────────────────────────

function noiseCanvas(size: number, base: number, amp: number, blobs: number, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  let sd = seed;
  const r = (): number => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  g.fillStyle = `rgb(${base},${base},${base})`; g.fillRect(0, 0, size, size);
  for (let i = 0; i < blobs; i++) {
    const x = r() * size, y = r() * size, rad = size * (0.06 + r() * 0.2), v = base + (r() - 0.5) * 2 * amp;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${v | 0},${v | 0},${v | 0},0.5)`); gr.addColorStop(1, `rgba(${v | 0},${v | 0},${v | 0},0)`);
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function woodCanvas(): THREE.CanvasTexture {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;
  let sd = 77;
  const r = (): number => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  g.fillStyle = '#4c3a2c'; g.fillRect(0, 0, S, S);       // nogal oscuro y poco saturado
  for (let i = 0; i < 70; i++) {                       // vetas largas a lo largo de u
    const y = r() * S, a = 0.08 + r() * 0.16;
    g.strokeStyle = r() > 0.5 ? `rgba(24,16,10,${a})` : `rgba(110,90,70,${a})`; g.lineWidth = 0.6 + r() * 1.6;
    g.beginPath(); g.moveTo(0, y);
    g.bezierCurveTo(S * 0.3, y + (r() - 0.5) * 8, S * 0.7, y + (r() - 0.5) * 8, S, y + (r() - 0.5) * 4); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** metal pavonado, polímero negro mate, madera con veta, detalles más claros y pintura (granada), con rugosidad variable de baja frecuencia. */
function makeGunMaterials(): THREE.MeshStandardMaterial[] {
  const rough = noiseCanvas(128, 200, 40, 40, 5);        // rugosidad × 0,78..1 en G: desgaste sutil de baja frecuencia
  return [
    new THREE.MeshStandardMaterial({ color: 0x2a2d32, metalness: 0.85, roughness: 0.42, roughnessMap: rough }),
    new THREE.MeshStandardMaterial({ color: 0x121315, metalness: 0.0, roughness: 0.7, roughnessMap: rough }),
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodCanvas(), metalness: 0.0, roughness: 0.6 }),
    new THREE.MeshStandardMaterial({ color: 0x5c6066, metalness: 0.6, roughness: 0.5, roughnessMap: rough }),
    new THREE.MeshStandardMaterial({ color: 0x4a5238, metalness: 0.2, roughness: 0.65, roughnessMap: rough }),
    // 5: polímero o pintura color arena (FDE), mate y sin veta: los marrones claros de armas que no son de madera
    new THREE.MeshStandardMaterial({ color: 0x8a7a5c, metalness: 0.0, roughness: 0.82, roughnessMap: rough }),
  ];
}

/** Clase de pieza por el color original del material del pack (0 metal, 1 polímero, 2 madera, 3 detalle). */
function gunClass(r: number, g: number, b: number, wood = true): number {
  const sr = Math.pow(r, 1 / 2.2), sg = Math.pow(g, 1 / 2.2), sb = Math.pow(b, 1 / 2.2);
  const mx = Math.max(sr, sg, sb), mn = Math.min(sr, sg, sb), sat = mx > 0 ? (mx - mn) / mx : 0;
  const lum = 0.299 * sr + 0.587 * sg + 0.114 * sb;
  let hue = 0;
  if (mx > mn) {
    const d = mx - mn;
    hue = mx === sr ? ((sg - sb) / d) % 6 : mx === sg ? (sb - sr) / d + 2 : (sr - sg) / d + 4;
    hue *= 60; if (hue < 0) hue += 360;
  }
  if (hue >= 12 && hue <= 50 && sat > 0.28 && lum > 0.06) return wood ? 2 : 5;   // marrón: madera (o arena mate en las armas que no la llevan)
  if (sat > 0.35) return 3;                                              // verdes, azules, naranjas planos del pack: detalle gris
  if (lum < 0.2) return 1;                                               // negro: polímero
  if (lum > 0.62) return 3;                                              // claros: miras, cargador
  return 0;
}

/** Armas con madera de verdad (veta); en el resto los marrones claros son polímero/pintura arena. */
const WOODEN = new Set(['SVD', 'REM870', 'AK', 'Shotgun', 'Sniper', 'Sniper_2', 'SMG', 'ShortCannon', 'RocketLauncher', 'GrenadeLauncher', 'Pistol', 'Knife_1', 'Grenade']);

/** Pasada de realismo por código sobre el modelo del pack: normales con pliegue (35°), grosor moderado, UV planares y grupos por material. */
function refineGun(geo0: THREE.BufferGeometry, name: string, squash = false): THREE.BufferGeometry {
  const g = toCreasedNormals(geo0, THREE.MathUtils.degToRad(35));
  g.computeBoundingBox();
  const size = g.boundingBox!.getSize(new THREE.Vector3());
  const dims = [size.x, size.y, size.z];
  const L = dims.indexOf(Math.max(...dims));
  const len = dims[L];
  const others = [0, 1, 2].filter((i) => i !== L);
  // si el modelo es demasiado «gordo» se afina el grosor (como mucho -25 %)
  const thick = Math.max(dims[others[0]], dims[others[1]]) / len;
  const f = squash && thick > 0.3 ? Math.max(0.75, 0.3 / thick) : 1;
  if (f < 1) g.scale(others.includes(0) ? f : 1, others.includes(1) ? f : 1, others.includes(2) ? f : 1);
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), col = g.getAttribute('color');
  const n = pos.count, tris = n / 3;
  const cls = new Uint8Array(tris), counts = [0, 0, 0, 0, 0, 0];
  for (let t = 0; t < tris; t++) {
    const nade = name === 'Grenade' || name === 'M67';
    let k = nade ? 4 : gunClass(col.getX(t * 3), col.getY(t * 3), col.getZ(t * 3), WOODEN.has(name));
    if (nade && col.getX(t * 3) + col.getY(t * 3) + col.getZ(t * 3) < 0.18) k = 1;
    cls[t] = k; counts[k]++;
  }
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
  const out = new THREE.BufferGeometry();
  let w = 0;
  for (let k = 0; k < 6; k++) {
    const start = w;
    for (let t = 0; t < tris; t++) {
      if (cls[t] !== k) continue;
      for (let v = 0; v < 3; v++, w++) {
        const i = t * 3 + v;
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        P[w * 3] = x; P[w * 3 + 1] = y; P[w * 3 + 2] = z;
        N[w * 3] = nor.getX(i); N[w * 3 + 1] = nor.getY(i); N[w * 3 + 2] = nor.getZ(i);
        const a = [x, y, z];
        U[w * 2] = a[L] * 2.0; U[w * 2 + 1] = (a[others[0]] + a[others[1]]) * 2.0;
      }
    }
    if (w > start) out.addGroup(start, w - start, k);
  }
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

/** Color lineal del material: el difuso de KHR_materials_pbrSpecularGlossiness (que three ya no interpreta) o el base. */
function gunMatColor(m: THREE.Material): [number, number, number] {
  const ext = (m.userData?.gltfExtensions as { KHR_materials_pbrSpecularGlossiness?: { diffuseFactor?: number[] } } | undefined)?.KHR_materials_pbrSpecularGlossiness;
  if (ext?.diffuseFactor) return [ext.diffuseFactor[0], ext.diffuseFactor[1], ext.diffuseFactor[2]];
  const c = (m as THREE.MeshStandardMaterial).color;
  return c ? [c.r, c.g, c.b] : [0.04, 0.04, 0.04];
}

/**
 * Carga un modelo de TastyTony (CC BY 4.0), lo hornea en su pose de reposo (varias mallas llevan esqueleto de Blender sin
 * animación), lo coloca en el marco canónico del juego —origen en la empuñadura, cañón hacia -X, arriba +Y— y le aplica la
 * pasada de materiales PBR. Todos estos modelos traen el cañón hacia +X (comprobado sobre su silueta), así que basta girar 180° en Y.
 */
async function loadTasty(key: string, folder: string, grip: [number, number]): Promise<{ geo: THREE.BufferGeometry; maxDim: number; len: number; muzzle?: [number, number, number]; eject?: [number, number, number] }> {
  const g = await new GLTFLoader().loadAsync(modelsUrl(`armas/${folder}/scene.gltf`));
  g.scene.updateMatrixWorld(true);
  const pos: number[] = [], col: number[] = [];
  const v = new THREE.Vector3();
  g.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const sk = m as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh) sk.skeleton.update();
    const geo = m.geometry, p = geo.getAttribute('position'), idx = geo.index;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.Material[];
    const n = idx ? idx.count : p.count;
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count: n, materialIndex: 0 }];
    for (const gr of groups) {
      const c = gunMatColor(mats[gr.materialIndex ?? 0] ?? mats[0]);
      for (let t = gr.start; t < gr.start + gr.count; t++) {
        const i = idx ? idx.getX(t) : t;
        v.fromBufferAttribute(p, i);
        if (sk.isSkinnedMesh) sk.applyBoneTransform(i, v);
        v.applyMatrix4(m.matrixWorld);
        pos.push(v.x, v.y, v.z); col.push(c[0], c[1], c[2]);
      }
    }
  });
  if (!pos.length) throw new Error('sin geometría');
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i]); minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]); minZ = Math.min(minZ, pos[i + 2]); maxZ = Math.max(maxZ, pos[i + 2]);
  }
  const sx = maxX - minX, sy = maxY - minY;
  const grenade = key === 'M67';
  // marco canónico
  let gx = 0, gy = 0, gz = (minZ + maxZ) / 2;
  if (grenade) { gx = (minX + maxX) / 2; gy = (minY + maxY) / 2; }
  else { gx = minX + grip[0] * sx; gy = minY + grip[1] * sy; }
  for (let i = 0; i < pos.length; i += 3) {
    if (grenade) { pos[i] -= gx; pos[i + 1] -= gy; pos[i + 2] -= gz; }
    else { pos[i] = gx - pos[i]; pos[i + 1] -= gy; pos[i + 2] = -(pos[i + 2] - gz); }       // giro de 180° en Y y traslado a la empuñadura
  }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo = refineGun(geo, key, false);
  geo.computeBoundingBox();
  const bs = geo.boundingBox!.getSize(new THREE.Vector3());
  const maxDim = Math.max(bs.x, bs.y, bs.z) || 1;
  const len = GUN_LEN_NEW[key] ?? 0.8;
  const sc = len / maxDim;
  // boca del cañón (para el fogonazo) y recámara (para los casquillos), en metros del marco canónico
  let muzzle: [number, number, number] | undefined, eject: [number, number, number] | undefined;
  if (!grenade) {
    const bb = geo.boundingBox!;
    const P = geo.getAttribute('position');
    const ys: number[] = [];
    for (let i = 0; i < P.count; i++) if (P.getX(i) < bb.min.x + 0.04 * (bb.max.x - bb.min.x)) ys.push(P.getY(i));
    ys.sort((a, b) => a - b);
    muzzle = [bb.min.x * sc, (ys.length ? ys[ys.length >> 1] : 0) * sc, 0];
    eject = [-0.08 * len, 0.075, 0.025];
  }
  return { geo, maxDim, len, muzzle, eject };
}

/** Registra el arma de un clon (hueso Bip01_R_Hand, malla «arma») para el ajuste en vivo ?armas=1. Devuelve el desregistro. */
export function trackGun(root: THREE.Object3D, weapon: string): () => void {
  void weapon;
  const added: GunEntry[] = [];
  for (const name of ['arma', 'arma_secondary', 'arma_knife', 'arma_grenade']) {
    const o = root.getObjectByName(name);
    if (!o) continue;
    const e: GunEntry = { mesh: o, weapon: o.userData.weapon, k: o.userData.k, maxDim: o.userData.maxDim, len: o.userData.len };
    gunRegistry.add(e); added.push(e);
  }
  return () => { for (const e of added) gunRegistry.delete(e); };
}

export class RbLibrary {
  templates = new Map<Kind, RbTemplate>();
  ual: { animations: THREE.AnimationClip[] } | null = null;
  ualOrigin: THREE.Object3D | null = null;
  avatars = new Map<string, THREE.Group>();
  private guns = new Map<string, { geo: THREE.BufferGeometry; maxDim: number; len: number; muzzle?: [number, number, number]; eject?: [number, number, number]; fromPack?: boolean }>();
  private gunMats: THREE.MeshStandardMaterial[] | null = null;
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
  /** se llama cuando llega una arma pedida bajo demanda (las vistas se recrean para incluirla) */
  onChange: (() => void) | null = null;
  private extraNeed = new Set<string>();
  fixNormals(sets: (THREE.Material | THREE.Material[])[]): void {
    for (const m of sets) for (const mat of Array.isArray(m) ? m : [m]) {
      const sm = mat as THREE.MeshStandardMaterial;
      if (!this.normalOf.has(sm)) this.normalOf.set(sm, sm.normalMap);
      const want = this.useNormals ? this.normalOf.get(sm) ?? null : null;
      if (sm.normalMap !== want) { sm.normalMap = want; sm.needsUpdate = true; }
    }
  }
  gunGeo(name: string): { geo: THREE.BufferGeometry; maxDim: number; len: number; muzzle?: [number, number, number]; eject?: [number, number, number]; fromPack?: boolean } | null { return this.guns.get(name) ?? null; }
  /** Pide un arma que solo usa esta planta (variantes de arma y de enemigo). */
  needGun(name: string): void {
    this.extraNeed.add(name);
    if (this.guns.has(name) || this.gunPromises.has(name)) return;
    const p = this.loadGun(name).then(() => { this.calibrateGrips(); this.onChange?.(); });
    this.gunPromises.set(name, p);
  }

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
    for (const g of this.extraNeed) { total++; if (this.guns.has(g)) done++; }   // armas de variantes, solo si la planta las usa
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

  /** Carga el arma de la clave de juego: el modelo nuevo (CC BY 4.0, TastyTony) y, si falla, el del pack anterior. */
  private async loadGun(key: string): Promise<void> {
    const t = TASTY[key];
    if (t) {
      try {
        const r = await loadTasty(key, t.folder, t.grip);
        this.guns.set(key, r);
        return;
      } catch (e) { console.warn('Armas: no se pudo cargar el modelo nuevo, uso el del pack anterior', key, e); }
    }
    const old = t ? t.fallback : key;
    try {
      const g = await new GLTFLoader().loadAsync(modelsUrl(`guns/${old}.gltf`));
      let geo = bakeColored(g.scene);
      if (!geo) return;
      geo = refineGun(geo, old, true);
      geo.computeBoundingBox();
      const s = geo.boundingBox!.getSize(new THREE.Vector3());
      this.guns.set(key, { geo, maxDim: Math.max(s.x, s.y, s.z) || 1, len: GUN_LEN[old] ?? 0.8, fromPack: true });
    } catch (e) { console.warn('Rocketbox: arma no cargada', key, e); }
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
    this.calibrateGrips();
  }

  /** Armas cuyo agarre ya se calibró a partir de la pose real, y ángulo (grados) entre su cañón y el frente del avatar (< 3 esperado). */
  private gripDone = new Set<string>();
  gripAngle: Record<string, number> = {};

  /**
   * Agarre automático: con el avatar en la pose de apuntado real (torso Pistol_Aim_Neutral), calcula la rotación local de la mano
   * que deja el cañón del arma (-X del marco canónico) en el frente del avatar (+Z antes de girarlo al yaw), horizontal, y el
   * «arriba» del arma en +Y de mundo. No depende de los ejes de cada modelo: solo de que el marco canónico sea el del juego.
   */
  calibrateGrips(): void {
    const tpl = this.templates.get('captain') ?? [...this.templates.values()][0];
    if (!tpl || !this.ual) return;
    const todo = Object.keys(AUTO_GRIP).filter((k) => this.guns.has(k) && !this.gripDone.has(k));
    if (!todo.length) return;
    const aim = tpl.layerClip('Pistol_Aim_Neutral', 'torso'), idle = tpl.layerClip('Pistol_Idle_Loop', 'legs');
    if (!aim) return;
    const root = new THREE.Group();
    const inner = SkeletonUtils.clone(tpl.holder);
    root.add(inner);
    inner.traverse((o) => { if (o.name.startsWith('arma')) o.visible = false; });
    const mixer = new THREE.AnimationMixer(inner);
    if (idle) mixer.clipAction(idle).play();
    mixer.clipAction(aim).play();
    mixer.update(0);
    root.updateMatrixWorld(true);
    const hand = inner.getObjectByName('Bip01_R_Hand');
    if (!hand) return;
    const qh = new THREE.Quaternion(), p0 = new THREE.Vector3(), s0 = new THREE.Vector3();
    hand.matrixWorld.decompose(p0, qh, s0);
    const want = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)));   // cañón (-X) -> +Z, arriba (+Y) -> +Y
    const local = qh.clone().invert().multiply(want);
    const eu = new THREE.Euler().setFromQuaternion(local, 'XYZ');
    const rot: [number, number, number] = [THREE.MathUtils.radToDeg(eu.x), THREE.MathUtils.radToDeg(eu.y), THREE.MathUtils.radToDeg(eu.z)];
    for (const k of todo) {
      const g0 = GUN_GRIP[k] ?? { pos: [6, 0, 0], rot: [0, 0, 0], scale: 1 };
      GUN_GRIP[k] = { ...g0, rot: [...rot] as [number, number, number] };
      this.gripDone.add(k);
      // comprobación: cañón en mundo frente al frente del avatar
      const gg = this.guns.get(k)!;
      const m = new THREE.Mesh(gg.geo); hand.add(m);
      applyGrip({ mesh: m, weapon: k, k: 1 / inner.scale.y, maxDim: gg.maxDim, len: gg.len });
      root.updateMatrixWorld(true);
      const d = new THREE.Vector3(-1, 0, 0).transformDirection(m.matrixWorld);
      this.gripAngle[k] = THREE.MathUtils.radToDeg(d.angleTo(new THREE.Vector3(0, 0, 1)));
      hand.remove(m);
    }
    // las mallas de las plantillas ya creadas toman el agarre nuevo
    for (const t of this.templates.values()) {
      t.holder.traverse((o) => {
        const w = o.userData?.weapon as string | undefined;
        if (w && this.gripDone.has(w) && o.userData.maxDim) applyGrip({ mesh: o, weapon: w, k: o.userData.k, maxDim: o.userData.maxDim, len: o.userData.len });
      });
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
    t.base = meshes.map((m) => m.material);
    const variants = cfg.tints.length ? cfg.tints : [null];
    for (const tint of variants) {
      t.variants.push(meshes.map((m) => each(m.material, (mat) => (tint && (isTintable(mat.name) || (cfg.tintHead && /_head$/.test(mat.name))) ? tintMaterial(mat, tint) : mat))));
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
      const mesh = new THREE.Mesh(gun.geo, this.gunMaterial());
      mesh.name = 'arma';
      mesh.frustumCulled = false;
      mesh.userData.weapon = cfg.gun;
      mesh.userData.k = 1 / s;
      mesh.userData.maxDim = gun.maxDim; mesh.userData.len = gun.len;
      hand.add(mesh);
      applyGrip({ mesh, weapon: cfg.gun, k: 1 / s, maxDim: gun.maxDim, len: gun.len });
    }
    if (hand && RbLibrary.SQUAD.includes(kind)) {
      for (const [slot, name] of Object.entries(SLOT_GUN)) {
        const g = this.guns.get(name);
        if (!g) continue;
        const m = new THREE.Mesh(g.geo, this.gunMaterial());
        m.name = 'arma_' + slot; m.frustumCulled = false; m.visible = false;
        m.userData.weapon = name; m.userData.k = 1 / s; m.userData.maxDim = g.maxDim; m.userData.len = g.len;
        hand.add(m);
        applyGrip({ mesh: m, weapon: name, k: 1 / s, maxDim: g.maxDim, len: g.len });
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

  /** Materiales PBR del arma por clase de pieza: 0 metal pavonado, 1 polímero, 2 madera, 3 detalles, 4 pintura (granada). */
  gunMaterial(): THREE.Material[] { return (this.gunMats ??= makeGunMaterials()); }

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
    if (this.gunMats) for (const m of this.gunMats) { m.map?.dispose(); m.roughnessMap?.dispose(); m.dispose(); }
    this.gunMats = null;
    gunRegistry.clear();
  }
}

// ───────────────────────── Accesorios por código (cm, espacio del modelo) ─────────────────────────

let propMat: THREE.MeshStandardMaterial | null = null;
let visorMat: THREE.MeshStandardMaterial | null = null;
let oliveMat: THREE.MeshStandardMaterial | null = null;
function props(): { dark: THREE.MeshStandardMaterial; visor: THREE.MeshStandardMaterial; olive: THREE.MeshStandardMaterial } {
  propMat ??= new THREE.MeshStandardMaterial({ color: 0x1f2429, roughness: 0.5, metalness: 0.45 });
  visorMat ??= new THREE.MeshStandardMaterial({ color: 0x35506a, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.5, depthWrite: false });
  oliveMat ??= new THREE.MeshStandardMaterial({ color: 0x4a5238, roughness: 0.7, metalness: 0.1 });
  return { dark: propMat, visor: visorMat, olive: oliveMat };
}
const boxMesh = (w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.frustumCulled = false; return m; };

/** Escudo antidisturbios: placa rectangular oscura con visor translúcido. */
function makeRiotShield(): THREE.Group {
  const { dark, visor } = props();
  const g = new THREE.Group();
  const [w, h, d] = RIOT_SHIELD.size;
  g.add(boxMesh(w, h, d, dark));
  const v = boxMesh(w * 0.66, h * 0.15, d + 0.6, visor); v.position.y = RIOT_SHIELD.visorY; g.add(v);
  const rim = boxMesh(w + 2, 3, d + 1, dark); rim.position.y = h / 2; g.add(rim);
  g.position.set(...RIOT_SHIELD.pos);
  return g;
}
/** Hombreras y placa frontal de la embestida. */
function makeRamArmor(): THREE.Group {
  const { dark } = props();
  const g = new THREE.Group();
  for (const sx of [-1, 1]) { const p = boxMesh(...PAD_POS.size, dark); p.position.set(sx * PAD_POS.x, PAD_POS.y, 0); g.add(p); }
  const plate = boxMesh(...PAD_POS.plateSize, dark); plate.position.set(...PAD_POS.plate); g.add(plate);
  return g;
}
/** Bandolera con granadas del granadero. */
function makeBandolier(m67?: { geo: THREE.BufferGeometry; maxDim: number; len: number }, mats?: THREE.Material[], cmPerM = 100): THREE.Group {
  const { dark, olive } = props();
  const g = new THREE.Group();
  const band = boxMesh(6, 70, 3, dark); band.rotation.z = BANDOLIER.rotZ; g.add(band);
  for (let i = -1; i <= 1; i++) {
    // granadas M67 (modelo nuevo) o, si no cargó, cilindros oliva
    const gr = m67 && mats ? new THREE.Mesh(m67.geo, mats) : new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 9, 8), olive);
    gr.frustumCulled = false;
    if (m67 && mats) gr.scale.setScalar((m67.len / m67.maxDim) * cmPerM);
    gr.position.set(-Math.sin(BANDOLIER.rotZ) * i * 22 - 1, Math.cos(BANDOLIER.rotZ) * i * 22, 4); g.add(gr);
  }
  g.position.set(...BANDOLIER.pos);
  return g;
}

/** Aro azul pulsante del derribado: se rellena con la reanimación. */
function makeReviveRing(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uProg: { value: 0 }, uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uProg; uniform float uTime; varying vec2 vUv;
    void main(){
      vec2 p = vUv - 0.5; float r = length(p) * 2.0;
      float ring = smoothstep(0.62, 0.7, r) * (1.0 - smoothstep(0.92, 1.0, r));
      float a = (atan(p.y, p.x) + 3.14159) / 6.28318;
      float pulse = 0.5 + 0.5 * sin(uTime * 5.0);
      float fill = step(a, uProg) * step(0.001, uProg);
      float al = ring * mix(0.28 + 0.25 * pulse, 0.95, fill);
      gl_FragColor = vec4(vec3(0.25, 0.6, 1.0) * 1.4, al);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2), mat);
  m.position.y = 0.06; m.renderOrder = 5; m.frustumCulled = false;
  return m;
}

// ───────────────────────── Vista de un personaje ─────────────────────────

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _ax = new THREE.Vector3(1, 0, 0), _dl = new THREE.Vector3();

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const _qh = new THREE.Quaternion(), _qd = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _eu = new THREE.Euler();
const _m4 = new THREE.Matrix4(), _vx = new THREE.Vector3(), _vy = new THREE.Vector3(), _vz = new THREE.Vector3(), _vp = new THREE.Vector3(), _vs = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class RbView {
  /** Peso (0..1) con que el arma se orienta a la dirección de mira en vez de seguir la mano animada. */
  private lockTarget = 0; private lockW = 0;
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
  private full: THREE.AnimationAction | null = null;
  private fullName = '';
  private fadeOverride = 0;
  private throwUntil = 0;
  private throwNew = false;
  private normalSet: (THREE.Material | THREE.Material[])[] = [];
  private riot: THREE.Group | null = null;
  private riotDown = 0;
  private reviveRing: THREE.Mesh | null = null;
  private wasDowned = false;
  private captive = false;
  private hostage = false;
  mark: THREE.Mesh | null = null;
  shield: THREE.Mesh | null = null;
  ring: THREE.Mesh | null = null;
  x = 0; y = 0; yaw = 0; crouchK = 0; speed = 0; init = false; ghost = false;
  pendingDt = 0;
  height: number; barW: number;

  constructor(private tpl: RbTemplate, id: number, private lib: RbLibrary, ent?: Entity) {
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
      const e: GunEntry = { mesh: o, weapon: o.userData.weapon, k: o.userData.k, maxDim: o.userData.maxDim, len: o.userData.len };
      this.slotGuns.set(slot, e); gunRegistry.add(e);
    }
    this.normalSet = tpl.variants[this.variant];
    if (ent) this.setupFor(ent);
    this.mixer = new THREE.AnimationMixer(this.inner);
    for (const [name, k] of [['Bip01_Spine1', 0.45], ['Bip01_Spine2', 0.55]] as [string, number][]) {
      const b = this.inner.getObjectByName(name);
      if (b) this.tilt.push({ bone: b, saved: new THREE.Quaternion(), k, has: false });
    }
    this.height = tpl.height; this.barW = tpl.barW;
  }

  /** Oficio, variante de jefe y variante de arma de esta entidad: tinte, arma en la mano y accesorios por código. */
  private setupFor(e: Entity): void {
    const kind = this.tpl.kind;
    if ((e as { hostage?: boolean }).hostage === true) {
      // rehén: sin brazalete, sin arma y con tinte claro de civil
      this.hostage = true;
      this.normalSet = this.tpl.tintSet('civil', CIVIL_TINT);
      this.inner.traverse((o) => { if (o.name === 'brazalete') o.visible = false; });
      for (const g of this.slotGuns.values()) g.mesh.visible = false;
      return;
    }
    if (e.variant && VARIANT_TINT[e.variant]) this.normalSet = this.tpl.tintSet(e.variant, VARIANT_TINT[e.variant]);
    const hand = this.hand;
    const add = (name: string, mul = 1): GunEntry | null => {
      const g = this.lib.gunGeo(name);
      if (!g) { this.lib.needGun(name); return null; }
      if (!hand) return null;
      const m = new THREE.Mesh(g.geo, this.lib.gunMaterial());
      m.name = 'arma_x'; m.frustumCulled = false;
      this.extra.push(m);
      hand.add(m);
      const entry: GunEntry = { mesh: m, weapon: name, k: 1 / this.inner.scale.y, maxDim: g.maxDim, mul, len: g.len };
      applyGrip(entry);
      gunRegistry.add(entry);
      return entry;
    };
    let main: GunEntry | null = null;
    if (e.primaryVariant === 1 && VARIANT_GUN[kind]) main = add(VARIANT_GUN[kind]!);
    else if (e.variant === 'tirador') main = add('SVD');
    else if (e.variant === 'asaltante') main = add('Knife_1');
    else if (e.bossVariant === 'ametrallador') main = add('M249', 1.25);
    if (main) {
      const old = this.slotGuns.get('primary');
      if (old) old.mesh.visible = false;
      this.slotGuns.set('primary', main);
    }
    // accesorios por código (cm, espacio del modelo)
    const attach = (g: THREE.Group): void => { this.inner.add(g); g.traverse((o) => { if ((o as THREE.Mesh).isMesh) this.extra.push(o); }); };
    if (e.variant === 'blindado') { this.riot = makeRiotShield(); attach(this.riot); }
    if (e.bossVariant === 'embestida') attach(makeRamArmor());
    if (e.variant === 'granadero') { const g = this.lib.gunGeo('M67'); attach(makeBandolier(g ?? undefined, g ? this.lib.gunMaterial() : undefined, 1 / this.inner.scale.y)); }
  }

  private glowMats: (THREE.Material | THREE.Material[])[] | null = null;
  /** Copia de los materiales de esta vista con emisivo (se conserva el tinte); solo la crean los jefes expuestos o enfurecidos. */
  private glowSet(): (THREE.Material | THREE.Material[])[] {
    if (!this.glowMats) {
      const cl = (m: THREE.Material): THREE.Material => {
        const c = m.clone();
        c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey;
        return c;
      };
      this.glowMats = this.normalSet.map((m) => (Array.isArray(m) ? m.map(cl) : cl(m)));
    }
    return this.glowMats;
  }

  /** Rehén atado: agachado hasta que empieza la escolta. */
  setCaptive(on: boolean): void { this.captive = on; }

  /** El granadero lanza: el torso hace un movimiento de brazo. */
  triggerThrow(time: number): void { this.throwUntil = time + 0.7; this.throwNew = true; }

  /** Animación de cuerpo entero (voltereta, derribado): las capas de piernas y torso se apartan. */
  private playFull(name: string, once: boolean, ts: number, frozenAt?: number, fade = FADE_TIME): void {
    if (this.fullName === name) { this.full?.setEffectiveTimeScale(ts); return; }
    const a = this.action(name, 'full');
    if (!a) return;
    this.legs?.fadeOut(fade); this.torso?.fadeOut(fade);
    this.legsName = ''; this.torsoName = '';
    a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once;
    a.setEffectiveWeight(1); a.fadeIn(fade); a.play(); a.setEffectiveTimeScale(ts);
    if (frozenAt !== undefined) { a.time = frozenAt * a.getClip().duration; a.paused = true; } else a.paused = false;
    this.full = a; this.fullName = name;
  }
  private endFull(fade: number): void {
    if (!this.full) return;
    this.full.paused = false;
    this.full.fadeOut(fade);
    this.full = null; this.fullName = '';
    this.fadeOverride = fade;
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

  private setLayer(layer: Layer, name: string, once: boolean, ts: number, fade0 = FADE_TIME, restart = false): void {
    const fade = this.fadeOverride > 0 ? this.fadeOverride : fade0;
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
    this.lockTarget = 0;
    if (!e.alive) {
      if (!this.death) {
        const a = this.action('Death01', 'full');
        if (a) {
          this.legs?.fadeOut(0.1); this.torso?.fadeOut(0.1); this.full?.fadeOut(0.1);
          a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.fadeIn(0.1); a.play();
          const dur = a.getClip().duration;
          const el = e.deadAt < 0 ? dur : Math.max(0, time - e.deadAt);
          if (el > 0.05) a.time = Math.min(dur, el);
          this.death = a;
        }
      }
      return;
    }
    if (this.hostage && this.captive && e.alive) { this.setLayer('legs', 'Crouch_Idle_Loop', false, 1); this.setLayer('torso', 'Crouch_Idle_Loop', false, 1); return; }
    // derribado: pose tumbada (la muerte congelada al 60 %); al reanimarlo se levanta en 0,4 s
    if (e.downed) { this.playFull('Death01', true, 1, 0.6, 0.25); return; }
    if (this.fullName === 'Death01') this.endFull(REVIVE_FADE);
    // voltereta: clip de cuerpo entero, 0,5 s
    if ((e.rollUntil ?? 0) > time) {
      const dur = this.tpl.fullClip('Roll')?.duration ?? 1.47;
      this.playFull('Roll', true, dur / ROLL_TIME, undefined, 0.08);
      return;
    }
    if (this.fullName === 'Roll') this.endFull(0.15);
    const sp = this.speed;
    const moving = sp > MOVE_MIN_SPEED;
    const rushing = e.sprinting || e.variant === 'asaltante';       // el asaltante corre siempre con cuchillo
    // piernas
    let legName: string, ref: number;
    if (e.crouch) { legName = moving ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop'; ref = CROUCH_REF_SPEED; }
    else if (!moving) { legName = 'Pistol_Idle_Loop'; ref = 1; }
    else if (rushing) { legName = 'Sprint_Loop'; ref = SPRINT_REF_SPEED; }
    else if (sp < WALK_MAX_SPEED) { legName = 'Walk_Loop'; ref = WALK_REF_SPEED; }
    else if (sp < JOG_MAX_SPEED) { legName = 'Jog_Fwd_Loop'; ref = JOG_REF_SPEED; }
    else { legName = 'Sprint_Loop'; ref = SPRINT_REF_SPEED; }
    const ts = moving ? Math.min(TIMESCALE_MAX, Math.max(TIMESCALE_MIN, sp / ref)) : 1;
    this.setLayer('legs', legName, false, ts);
    const slot = e.isPlayer ? (e.weapon ?? 'primary') : 'primary';
    const armed = (slot === 'primary' || slot === 'secondary') && e.variant !== 'asaltante';
    // torso
    const staggered = (e.staggerUntil ?? 0) > time;
    if (staggered) {
      // reacción de impacto fuerte, una vez por aturdimiento (Hit_Head si existe, Hit_Chest al 100 %)
      const hit = this.tpl.fullClip('Hit_Head') ? 'Hit_Head' : 'Hit_Chest';
      this.setLayer('torso', hit, true, 1, 0.05, e.staggerUntil !== this.lastStagger);
      if (e.staggerUntil !== this.lastStagger) { this.lastStagger = e.staggerUntil ?? 0; this.kick = 1; }
    } else if (e.lastKnifeAt !== this.lastKnife && time - e.lastKnifeAt < 0.6 && time >= e.lastKnifeAt) {
      this.lastKnife = e.lastKnifeAt; this.punchAlt = !this.punchAlt;
      const stab = (slot === 'knife' || e.variant === 'asaltante') && this.tpl.fullClip('Sword_Attack');
      this.setLayer('torso', stab ? 'Sword_Attack' : this.punchAlt ? 'Punch_Jab' : 'Punch_Cross', true, stab ? 1.5 : 1.3, 0.08, true);
    } else if (time - e.lastKnifeAt < 0.6 && time >= e.lastKnifeAt) {
      // sigue el golpe
    } else if (this.throwUntil > time) {
      this.setLayer('torso', 'Punch_Jab', true, 1.1, 0.08, this.throwNew);      // el granadero lanza
      this.throwNew = false;
    } else if (!armed) {
      this.setLayer('torso', legName, false, ts);              // cuchillo o granada: brazo bajado, sin apuntar
    } else if (rushing && moving) {
      this.setLayer('torso', legName, false, ts);              // esprintando: el torso del propio clip, arma baja
    } else if (e.reloading > 0) {
      this.setLayer('torso', 'Pistol_Reload', false, 1);
      this.lockTarget = RELOAD_LOCK;                           // al recargar el arma sube hacia la cara, pero sin apuntar al cielo
    } else if (time - e.lastShotAt < 0.35 && time >= e.lastShotAt) {
      this.setLayer('torso', 'Pistol_Shoot', true, 1, 0.04, e.lastShotAt !== this.lastShot);
      this.lastShot = e.lastShotAt;
      this.lockTarget = 1;
    } else if ((time - e.lastShotAt < 0.6 && time >= e.lastShotAt) || (e.isPlayer && e.aiming)) {
      this.setLayer('torso', 'Pistol_Aim_Neutral', false, 1);   // apuntando, aunque no dispare
      this.lockTarget = 1;
    } else {
      this.setLayer('torso', legName, false, ts);
      if (!moving && !e.crouch) this.lockTarget = 1;           // parado con el arma: la de la pose de reposo, al frente
    }
    this.fadeOverride = 0;
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
    else {
      this.x += (e.x - this.x) * k; this.y += (e.y - this.y) * k;
      // voltereta: el cuerpo se orienta en la dirección de movimiento (parado, hacia atrás)
      const rolling = e.alive && !e.downed && (e.rollUntil ?? 0) > time;
      const sp0 = Math.hypot(e.vx, e.vy);
      const target = rolling ? (sp0 > 0.3 ? Math.atan2(e.vy, e.vx) : e.yaw + Math.PI) : e.yaw;
      this.yaw = lerpAngle(this.yaw, target, 1 - Math.exp(-dt * (rolling ? 40 : 18)));
    }
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
      for (const [k, g] of this.slotGuns) g.mesh.visible = k === slot && !this.hostage;
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

    this.speed += ((alive ? Math.hypot(e.vx, e.vy) : 0) - this.speed) * (1 - Math.exp(-dt * 12));
    this.crouchK += ((alive && e.crouch ? 1 : 0) - this.crouchK) * (1 - Math.exp(-dt * 14));

    // materiales: normal (con tinte), muerto, fantasma o destello (compartidos)
    const hurt = alive && !this.ghost && time - e.lastHurtAt < 0.12 && time >= e.lastHurtAt;
    // jefe expuesto: emisivo ámbar pulsante (la ventana para pegarle); enfurecido: rojo tenue permanente
    const hc = !!(host as { highContrast?: boolean }).highContrast;
    const glow = alive && (e.exposedUntil ?? 0) > time ? 'a' : alive && e.enraged ? 'r' : alive && hc ? (this.hostage ? 'g' : e.team === 'enemy' ? 'm' : 'c') : '';
    const state = !alive ? 'dead' : this.ghost ? 'ghost' : hurt ? 'flash' : 'norm' + this.variant + glow;
    if (state !== this.matState) {
      this.matState = state;
      const set = state === 'dead' ? this.tpl.dead : state === 'norm' + this.variant + glow ? (glow ? this.glowSet() : this.normalSet) : null;
      this.meshes.forEach((m, i) => { m.material = set ? set[i] : state === 'flash' ? host.matFlash : this.lib.ghostMaterial(); });
      const cast = host.shadowsOn && state !== 'ghost';
      for (const m of this.meshes) m.castShadow = cast;
      for (const o of this.extra) o.castShadow = cast;
    }
    if (glow && this.glowMats) {
      const amber = glow === 'a';
      for (const m of this.glowMats) for (const mat of Array.isArray(m) ? m : [m]) {
        const sm = mat as THREE.MeshStandardMaterial;
        const hcCol = glow === 'm' ? 0xff1a6e : glow === 'c' ? 0x18b4ff : glow === 'g' ? 0x20ff60 : 0;
        sm.emissive.setHex(hcCol || (amber ? 0xffa000 : 0xc01010));
        sm.emissiveIntensity = hcCol ? 0.6 : amber ? 0.45 + 0.35 * Math.sin(time * 8) : 0.12;   // alto contraste: uniforme
      }
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
      this.aimGun(e, animDt);
    }
    this.overlays(e, time, host, alive, dt);
  }

  /**
   * Blocaje de puntería: la mano sigue la animación (Pistol_Aim/Shoot/Idle, pensadas para pistola), pero el arma larga debe
   * apuntar siempre donde mira el personaje. Con el hueso de la mano ya en su pose, se calcula la rotación local que deja el cañón
   * (-X del marco canónico) en la dirección (yaw, pitch) con el «arriba» del arma en +Y de mundo. El retroceso de Pistol_Shoot,
   * el vaivén de caderas al andar y el giro de tronco quedan absorbidos por la muñeca (unos grados), no por el cañón.
   */
  private aimGun(e: Entity, dt: number): void {
    const gun = this.slotGuns.get(this.slot) ?? this.slotGuns.get('primary');
    if (!gun || !this.hand || !AUTO_GRIP[gun.weapon]) return;
    this.lockW += (this.lockTarget - this.lockW) * (1 - Math.exp(-Math.max(dt, 0.001) * 14));
    const gr = GUN_GRIP[gun.weapon];
    _eu.set(THREE.MathUtils.degToRad(gr.rot[0]), THREE.MathUtils.degToRad(gr.rot[1]), THREE.MathUtils.degToRad(gr.rot[2]), 'XYZ');
    _qb.setFromEuler(_eu);
    if (this.lockW < 0.005) { gun.mesh.quaternion.copy(_qb); return; }
    this.hand.updateWorldMatrix(true, false);
    this.hand.matrixWorld.decompose(_vp, _qh, _vs);
    const cp = Math.cos(e.pitch ?? 0), wy = this.yaw;                   // dirección de mira del cuerpo (suavizada hacia e.yaw)
    _vx.set(-Math.cos(wy) * cp, -Math.sin(e.pitch ?? 0), -Math.sin(wy) * cp).normalize();   // -dirección de mira = eje X del arma
    _vz.crossVectors(_vx, _up).normalize();
    _vy.crossVectors(_vz, _vx);
    _m4.makeBasis(_vx, _vy, _vz);
    _qd.setFromRotationMatrix(_m4);
    _qd.premultiply(_qh.invert());                                      // rotación local respecto a la mano
    gun.mesh.quaternion.slerpQuaternions(_qb, _qd, Math.min(1, this.lockW));
  }

  /** Giro de un hueso alrededor del eje lateral del modelo, compuesto sobre la animación. */
  private tiltBone(bone: THREE.Object3D, angle: number): void {
    if (Math.abs(angle) < 1e-4) return;
    _q.identity();
    for (let o: THREE.Object3D | null = bone.parent; o && o !== this.inner; o = o.parent) _q.premultiply(o.quaternion);
    _q2.setFromAxisAngle(_ax, angle);
    bone.quaternion.premultiply(_q).premultiply(_q2).premultiply(_q.clone().invert());
  }

  private overlays(e: Entity, time: number, host: CharHost, alive: boolean, dt = 0.016): void {
    // escudo antidisturbios: se baja al ser aturdido o cegado
    if (this.riot) {
      const want = alive && (((e.staggerUntil ?? 0) > time) || ((e.blindedUntil ?? 0) > time) || e.reloading > 0) ? 1 : 0;
      this.riotDown += (want - this.riotDown) * (1 - Math.exp(-dt * 10));
      this.riot.visible = alive;
      this.riot.rotation.x = this.riotDown * 1.1;
      this.riot.position.set(RIOT_SHIELD.pos[0], RIOT_SHIELD.pos[1] - this.riotDown * 30, RIOT_SHIELD.pos[2] - this.riotDown * 8);
    }
    // aro azul del derribado (y su relleno al reanimarlo)
    const downed = alive && !!e.downed;
    if (downed && !this.reviveRing) { this.reviveRing = makeReviveRing(); this.root.add(this.reviveRing); }
    if (this.reviveRing) {
      this.reviveRing.visible = downed;
      if (downed) {
        const u = (this.reviveRing.material as THREE.ShaderMaterial).uniforms;
        u.uTime.value = time; u.uProg.value = Math.min(1, Math.max(0, e.reviveProgress ?? 0));
      }
    }
    this.wasDowned = downed;
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
    if (this.glowMats) for (const m of this.glowMats) for (const mat of Array.isArray(m) ? m : [m]) mat.dispose();
    for (const m of this.meshes) (m as THREE.SkinnedMesh).skeleton?.dispose();
  }
}

/** Biblioteca compartida por el juego y la vista previa del escuadrón (misma caché de modelos y clips). */
export const sharedRbLibrary = new RbLibrary();
