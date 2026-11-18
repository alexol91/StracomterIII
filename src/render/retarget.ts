// Traspaso de animaciones entre esqueletos humanoides distintos (retargeteo).
//
// Para qué: los personajes realistas (Microsoft Rocketbox, esqueleto «Bip01») no traen animaciones de
// combate, y la biblioteca CC0 que sí las trae (Quaternius, Universal Animation Library) usa otro
// esqueleto, con otros nombres, otros ejes locales y otra pose de reposo.
//
// Cómo: en espacio de MUNDO, que es lo único que los dos esqueletos tienen en común.
//   1. Se orienta el origen para que mire hacia donde mira el destino (giro en vertical).
//   2. Se «coloca» el destino en la pose de reposo del origen: por cada hueso se compara la dirección
//      hueso→hijo en reposo en uno y otro, y se guarda el giro que las hace coincidir. Así da igual que
//      uno esté en T y el otro en A.
//   3. En cada instante: giro del hueso de origen respecto a su reposo (en mundo) aplicado sobre el
//      reposo alineado del destino. De ahí se saca el giro local dividiendo por el del padre.
//   4. La cadera se desplaza lo mismo que la de origen, a escala de la altura de cadera de cada uno.
//
// Lo que NO hace: no corrige el giro alrededor del propio eje del hueso (si los dos reposos difieren en
// eso, antebrazos y manos pueden quedar algo torcidos), no evita que los pies resbalen ni que las manos
// atraviesen el cuerpo si las proporciones son muy distintas, y no anima dedos ni cara.

import * as THREE from 'three';

export interface BonePair {
  /** hueso del origen que manda sobre este hueso del destino */
  src: string;
  /** hijos (destino / origen) que definen la dirección del hueso para alinear los reposos */
  tgtChild?: string;
  srcChild?: string;
}

export interface RetargetSpec {
  /** hueso del destino → pareja en el origen */
  bones: Record<string, BonePair>;
  /** hueso del destino que recibe el desplazamiento de la cadera, y la cadera del origen */
  hipsTgt: string;
  hipsSrc: string;
  /** muslos izquierdo y derecho de cada uno: definen hacia dónde mira el personaje y dónde está el suelo */
  thighsTgt: [string, string];
  thighsSrc: [string, string];
  /** pies de cada uno (para medir la altura de la cadera) */
  feetTgt: [string, string];
  feetSrc: [string, string];
}

export interface RetargetOpts {
  fps?: number;
  /** quita el desplazamiento horizontal de la cadera (animaciones «en el sitio») */
  inPlace?: boolean;
  name?: string;
}

const UP = new THREE.Vector3(0, 1, 0);

function need(root: THREE.Object3D, name: string): THREE.Object3D {
  const o = root.getObjectByName(name);
  if (!o) throw new Error(`retarget: no existe el hueso «${name}»`);
  return o;
}

function forwardOf(root: THREE.Object3D, thighs: [string, string]): THREE.Vector3 {
  const l = need(root, thighs[0]).getWorldPosition(new THREE.Vector3());
  const r = need(root, thighs[1]).getWorldPosition(new THREE.Vector3());
  const f = l.sub(r).cross(UP);
  f.y = 0;
  return f.lengthSq() > 1e-10 ? f.normalize() : new THREE.Vector3(0, 0, 1);
}

function hipHeight(root: THREE.Object3D, hips: string, feet: [string, string]): number {
  const h = need(root, hips).getWorldPosition(new THREE.Vector3()).y;
  const a = need(root, feet[0]).getWorldPosition(new THREE.Vector3()).y;
  const b = need(root, feet[1]).getWorldPosition(new THREE.Vector3()).y;
  return Math.max(1e-4, h - (a + b) / 2);
}

/**
 * Convierte `clip` (hecho para el esqueleto de `srcRoot`) en un clip para el esqueleto de `tgtRoot`.
 * Los dos deben estar en su pose de reposo al llamar. `srcRoot` se anima durante el cálculo y se devuelve
 * a su reposo; `tgtRoot` no se toca.
 */
export function retargetClip(
  clip: THREE.AnimationClip, srcRoot: THREE.Object3D, tgtRoot: THREE.Object3D, spec: RetargetSpec, opts: RetargetOpts = {},
): THREE.AnimationClip {
  const fps = opts.fps ?? 30;
  srcRoot.updateMatrixWorld(true);
  tgtRoot.updateMatrixWorld(true);

  // ── reposo del origen (se guarda para restaurarlo) ──
  const srcSaved: { o: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[] = [];
  srcRoot.traverse(o => srcSaved.push({ o, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }));

  // 1. giro vertical que pone al origen mirando como el destino
  const fS = forwardOf(srcRoot, spec.thighsSrc), fT = forwardOf(tgtRoot, spec.thighsTgt);
  const qa = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(fT.x, fT.z) - Math.atan2(fS.x, fS.z));
  const qaInv = qa.clone().invert();

  // huesos emparejados
  const names = Object.keys(spec.bones);
  const tgtBone = new Map<string, THREE.Object3D>();
  const srcBone = new Map<string, THREE.Object3D>();
  const srcRestInv = new Map<string, THREE.Quaternion>(); // (qa·Rs_reposo)^-1
  const tgtRestAligned = new Map<string, THREE.Quaternion>();
  const align = new Map<string, THREE.Quaternion>();
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion();

  for (const n of names) {
    const pair = spec.bones[n];
    const tb = need(tgtRoot, n), sb = need(srcRoot, pair.src);
    tgtBone.set(n, tb); srcBone.set(n, sb);
    srcRestInv.set(n, qa.clone().multiply(sb.getWorldQuaternion(new THREE.Quaternion())).invert());
    // 2. alinear los reposos por la dirección hueso→hijo
    const a = new THREE.Quaternion();
    if (pair.tgtChild && pair.srcChild) {
      const dt = need(tgtRoot, pair.tgtChild).getWorldPosition(v1).sub(tb.getWorldPosition(v2)).normalize().clone();
      const ds = need(srcRoot, pair.srcChild).getWorldPosition(v1).sub(sb.getWorldPosition(v2)).applyQuaternion(qa).normalize().clone();
      if (dt.lengthSq() > 0.5 && ds.lengthSq() > 0.5) a.setFromUnitVectors(dt, ds);
    }
    align.set(n, a);
  }
  // los huesos sin hijo de referencia (manos sin dedo emparejado, cabeza, dedos del pie) heredan la alineación del padre emparejado
  for (const n of names) {
    const pair = spec.bones[n];
    if (pair.tgtChild && pair.srcChild) continue;
    let p = tgtBone.get(n)!.parent;
    while (p && !tgtBone.has(p.name)) p = p.parent;
    if (p && p.name !== spec.hipsTgt) {
      const pp = spec.bones[p.name];
      // la cabeza y el cuello no heredan: se quedan con su reposo propio
      if (pp && /hand|foot|forearm|calf|shin|toe/i.test(n + pair.src)) align.get(n)!.copy(align.get(p.name)!);
    }
  }
  for (const n of names) {
    tgtRestAligned.set(n, align.get(n)!.clone().multiply(tgtBone.get(n)!.getWorldQuaternion(new THREE.Quaternion())));
  }

  // jerarquía del destino en orden de recorrido (padres antes que hijos), desde el ancestro común de los emparejados
  const order: THREE.Object3D[] = [];
  tgtRoot.traverse(o => { if ((o as THREE.Bone).isBone || tgtBone.has(o.name)) order.push(o); });
  const restLocal = new Map<THREE.Object3D, THREE.Quaternion>();
  const staticParentQ = new Map<THREE.Object3D, THREE.Quaternion>();
  const inOrder = new Set(order);
  for (const o of order) {
    restLocal.set(o, o.quaternion.clone());
    if (o.parent && !inOrder.has(o.parent)) staticParentQ.set(o, o.parent.getWorldQuaternion(new THREE.Quaternion()));
  }

  // 4. cadera: escala y espacio del padre
  const hipsS = need(srcRoot, spec.hipsSrc), hipsT = need(tgtRoot, spec.hipsTgt);
  const scale = hipHeight(tgtRoot, spec.hipsTgt, spec.feetTgt) / hipHeight(srcRoot, spec.hipsSrc, spec.feetSrc);
  const hipsSRest = hipsS.getWorldPosition(new THREE.Vector3());
  const hipsTRestLocal = hipsT.position.clone();
  const hipsParentQInv = hipsT.parent ? hipsT.parent.getWorldQuaternion(new THREE.Quaternion()).invert() : new THREE.Quaternion();
  const hipsParentScale = hipsT.parent ? hipsT.parent.getWorldScale(new THREE.Vector3()) : new THREE.Vector3(1, 1, 1);

  // ── muestreo ──
  const mixer = new THREE.AnimationMixer(srcRoot);
  const action = mixer.clipAction(clip);
  action.play();
  const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(frames);
  const quats = new Map<string, Float32Array>();
  for (const n of names) quats.set(n, new Float32Array(frames * 4));
  const pos = new Float32Array(frames * 3);
  const worldQ = new Map<THREE.Object3D, THREE.Quaternion>();
  for (const o of order) worldQ.set(o, new THREE.Quaternion());
  const last = new Map<string, THREE.Quaternion>();
  const rs = new THREE.Quaternion(), local = new THREE.Quaternion(), pw = new THREE.Quaternion();

  for (let f = 0; f < frames; f++) {
    const t = Math.min(clip.duration, f / fps);
    times[f] = t;
    mixer.setTime(t);
    srcRoot.updateMatrixWorld(true);
    for (const o of order) {
      const parentW = o.parent && worldQ.has(o.parent) ? worldQ.get(o.parent)! : (staticParentQ.get(o) ?? pw.identity());
      const w = worldQ.get(o)!;
      if (tgtBone.get(o.name) === o) {
        const n = o.name;
        // 3. giro del origen respecto a su reposo, en mundo, sobre el reposo alineado del destino
        srcBone.get(n)!.getWorldQuaternion(rs);
        w.copy(qa).multiply(rs).multiply(srcRestInv.get(n)!).multiply(tgtRestAligned.get(n)!);
        local.copy(parentW).invert().multiply(w).normalize();
        const prev = last.get(n);
        if (prev && prev.dot(local) < 0) local.set(-local.x, -local.y, -local.z, -local.w); // sin saltos de signo
        if (prev) prev.copy(local); else last.set(n, local.clone());
        local.toArray(quats.get(n)!, f * 4);
      } else {
        w.copy(parentW).multiply(restLocal.get(o)!);
      }
    }
    // cadera
    const d = hipsS.getWorldPosition(v1).sub(hipsSRest).applyQuaternion(qa).multiplyScalar(scale);
    if (opts.inPlace) { d.x = 0; d.z = 0; }
    d.applyQuaternion(hipsParentQInv);
    d.set(d.x / hipsParentScale.x, d.y / hipsParentScale.y, d.z / hipsParentScale.z).add(hipsTRestLocal);
    d.toArray(pos, f * 3);
  }

  // restaurar el origen
  action.stop(); mixer.uncacheRoot(srcRoot);
  for (const s of srcSaved) { s.o.position.copy(s.p); s.o.quaternion.copy(s.q); s.o.scale.copy(s.s); }
  srcRoot.updateMatrixWorld(true);
  void q1; void qaInv;

  const tracks: THREE.KeyframeTrack[] = [];
  for (const n of names) tracks.push(new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times as unknown as number[], quats.get(n)! as unknown as number[]));
  tracks.push(new THREE.VectorKeyframeTrack(`${spec.hipsTgt}.position`, times as unknown as number[], pos as unknown as number[]));
  return new THREE.AnimationClip(opts.name ?? clip.name, clip.duration, tracks);
}

// ───────────────────────── mapas de huesos ─────────────────────────

function side(tpl: (s: 'L' | 'R') => Record<string, BonePair>): Record<string, BonePair> {
  return { ...tpl('L'), ...tpl('R') };
}

/** Quaternius Universal Animation Library (huesos «DEF-…», ya sin puntos tras cargar) → Microsoft Rocketbox («Bip01_…»). */
export const UAL_TO_ROCKETBOX: RetargetSpec = {
  hipsTgt: 'Bip01', hipsSrc: 'DEF-hips',
  thighsTgt: ['Bip01_L_Thigh', 'Bip01_R_Thigh'], thighsSrc: ['DEF-thighL', 'DEF-thighR'],
  feetTgt: ['Bip01_L_Foot', 'Bip01_R_Foot'], feetSrc: ['DEF-footL', 'DEF-footR'],
  bones: {
    Bip01_Pelvis: { src: 'DEF-hips' },
    Bip01_Spine: { src: 'DEF-spine001', tgtChild: 'Bip01_Spine1', srcChild: 'DEF-spine002' },
    Bip01_Spine1: { src: 'DEF-spine002', tgtChild: 'Bip01_Spine2', srcChild: 'DEF-spine003' },
    Bip01_Spine2: { src: 'DEF-spine003', tgtChild: 'Bip01_Neck', srcChild: 'DEF-neck' },
    Bip01_Neck: { src: 'DEF-neck', tgtChild: 'Bip01_Head', srcChild: 'DEF-head' },
    Bip01_Head: { src: 'DEF-head' },
    ...side(s => ({
      [`Bip01_${s}_Clavicle`]: { src: `DEF-shoulder${s}`, tgtChild: `Bip01_${s}_UpperArm`, srcChild: `DEF-upper_arm${s}` },
      [`Bip01_${s}_UpperArm`]: { src: `DEF-upper_arm${s}`, tgtChild: `Bip01_${s}_Forearm`, srcChild: `DEF-forearm${s}` },
      [`Bip01_${s}_Forearm`]: { src: `DEF-forearm${s}`, tgtChild: `Bip01_${s}_Hand`, srcChild: `DEF-hand${s}` },
      [`Bip01_${s}_Hand`]: { src: `DEF-hand${s}`, tgtChild: `Bip01_${s}_Finger2`, srcChild: `DEF-f_middle01${s}` },
      [`Bip01_${s}_Thigh`]: { src: `DEF-thigh${s}`, tgtChild: `Bip01_${s}_Calf`, srcChild: `DEF-shin${s}` },
      [`Bip01_${s}_Calf`]: { src: `DEF-shin${s}`, tgtChild: `Bip01_${s}_Foot`, srcChild: `DEF-foot${s}` },
      [`Bip01_${s}_Foot`]: { src: `DEF-foot${s}`, tgtChild: `Bip01_${s}_Toe0`, srcChild: `DEF-toe${s}` },
      [`Bip01_${s}_Toe0`]: { src: `DEF-toe${s}` },
    })),
  },
};

/** La misma biblioteca → esqueleto tipo Mixamo de 24 huesos (el soldado de Grab3D). */
export const UAL_TO_MIXAMO24: RetargetSpec = {
  hipsTgt: 'Hips', hipsSrc: 'DEF-hips',
  thighsTgt: ['LeftUpLeg', 'RightUpLeg'], thighsSrc: ['DEF-thighL', 'DEF-thighR'],
  feetTgt: ['LeftFoot', 'RightFoot'], feetSrc: ['DEF-footL', 'DEF-footR'],
  bones: {
    Hips: { src: 'DEF-hips' },
    Spine02: { src: 'DEF-spine001', tgtChild: 'Spine01', srcChild: 'DEF-spine002' },
    Spine01: { src: 'DEF-spine002', tgtChild: 'Spine', srcChild: 'DEF-spine003' },
    Spine: { src: 'DEF-spine003', tgtChild: 'neck', srcChild: 'DEF-neck' },
    neck: { src: 'DEF-neck', tgtChild: 'Head', srcChild: 'DEF-head' },
    Head: { src: 'DEF-head' },
    ...({
      LeftShoulder: { src: 'DEF-shoulderL', tgtChild: 'LeftArm', srcChild: 'DEF-upper_armL' },
      LeftArm: { src: 'DEF-upper_armL', tgtChild: 'LeftForeArm', srcChild: 'DEF-forearmL' },
      LeftForeArm: { src: 'DEF-forearmL', tgtChild: 'LeftHand', srcChild: 'DEF-handL' },
      LeftHand: { src: 'DEF-handL' },
      LeftUpLeg: { src: 'DEF-thighL', tgtChild: 'LeftLeg', srcChild: 'DEF-shinL' },
      LeftLeg: { src: 'DEF-shinL', tgtChild: 'LeftFoot', srcChild: 'DEF-footL' },
      LeftFoot: { src: 'DEF-footL', tgtChild: 'LeftToeBase', srcChild: 'DEF-toeL' },
      LeftToeBase: { src: 'DEF-toeL' },
      RightShoulder: { src: 'DEF-shoulderR', tgtChild: 'RightArm', srcChild: 'DEF-upper_armR' },
      RightArm: { src: 'DEF-upper_armR', tgtChild: 'RightForeArm', srcChild: 'DEF-forearmR' },
      RightForeArm: { src: 'DEF-forearmR', tgtChild: 'RightHand', srcChild: 'DEF-handR' },
      RightHand: { src: 'DEF-handR' },
      RightUpLeg: { src: 'DEF-thighR', tgtChild: 'RightLeg', srcChild: 'DEF-shinR' },
      RightLeg: { src: 'DEF-shinR', tgtChild: 'RightFoot', srcChild: 'DEF-footR' },
      RightFoot: { src: 'DEF-footR', tgtChild: 'RightToeBase', srcChild: 'DEF-toeR' },
      RightToeBase: { src: 'DEF-toeR' },
    } as Record<string, BonePair>),
  },
};
