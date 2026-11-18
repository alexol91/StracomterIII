// Vista previa 3D de los cuatro operadores para la pantalla «Elige a tu personaje».
//
// Un renderer propio (independiente del del juego) dibuja cada operador dentro del rectángulo de su hueco
// HTML, con setViewport/setScissor sobre un lienzo transparente a pantalla completa. Los personajes son los
// mismos que en el juego en estilo realista (plantillas de rbchars.ts: avatar Rocketbox, tinte, arma, dedos;
// brazalete solo el azul del Especialista) con animaciones del UAL retargeteadas EN EL SITIO:
// Idle_Loop de base y, cada 6-10 s, un Sprint_Loop o un Roll.

import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import type { ClassId } from '../sim/types';
import { modelsUrl } from './assets';
import { sharedRbLibrary, trackGun, type RbTemplate } from './rbchars';

export interface SquadPreview {
  /** Llamar cuando cambie el tamaño de ventana o la maquetación. */
  resize(): void;
  /** Operador resaltado (el que tiene el foco/ratón), o null. */
  setActive(c: ClassId | null): void;
  dispose(): void;
}
export interface SquadPreviewOpts {
  /** Se llama cuando el modelo de ese operador ya se está dibujando (la interfaz oculta entonces el retrato fijo). */
  onReady?: (c: ClassId) => void;
}

// ───────────────────────── Constantes de ajuste ─────────────────────────

/** FOV vertical de la cámara (grados). */
export const PV_FOV = 26;
/** Fracción del hueco, desde arriba, a la que queda la cabeza; y desde abajo, a la que quedan los pies. */
export const PV_HEAD_MARGIN = 0.12;
export const PV_FEET_MARGIN = 0.04;
/** Semianchura (m) que debe caber con el cuerpo en Sprint o Roll. */
export const PV_HALF_WIDTH = 1.0;
/** Altura (m) del avatar. */
export const PV_BODY_HEIGHT = 1.8;
/** Cuánto por debajo del centro de encuadre va la cámara (contrapicado suave), en metros. */
export const PV_CAMERA_DROP = 0.4;
/** Intervalo aleatorio entre acciones (s), duración del Sprint (s), desfase entre operadores (s), mínimo tras activar (s). */
export const PV_ACTION_MIN = 6;
export const PV_ACTION_MAX = 10;
export const PV_SPRINT_TIME = 2.2;
export const PV_STAGGER = 1.9;
export const PV_ACTIVE_MIN_GAP = 3;
export const PV_FADE = 0.2;
/** Brillo de los operadores no resaltados (1 = plena luz) y rapidez de la transición. */
export const PV_DIM = 0.65;
export const PV_DIM_SPEED = 6;
/** Luces de estudio: color, intensidad y posición (el personaje mira a +Z, la cámara está delante). */
export const PV_LIGHTS = {
  key: { color: 0xffe0bd, intensity: 3.2, pos: [-1.6, 2.6, 3.2] as [number, number, number] },
  fill: { color: 0x9db9ff, intensity: 0.9, pos: [2.8, 1.3, 2.4] as [number, number, number] },
  rimA: { color: 0xd6e8ff, intensity: 4.5, pos: [1.2, 2.6, -3.0] as [number, number, number] },
  rimB: { color: 0xffd9b0, intensity: 3.0, pos: [-2.2, 2.2, -2.6] as [number, number, number] },
  hemi: 0.3,
  env: 0.35,
};

const IDS: ClassId[] = ['captain', 'technic', 'especialist', 'explosives'];

function rand(a: number, b: number): number { return a + Math.random() * (b - a); }

interface Op {
  id: ClassId;
  scene: THREE.Scene;
  cam: THREE.PerspectiveCamera;
  inner: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  cur: THREE.AnimationAction | null;
  curName: string;
  /** instante en que termina la acción en curso (0 = en reposo) */
  actionUntil: number;
  nextAt: number;
  lastActionAt: number;
  dim: number;
  lights: { l: THREE.Light; base: number }[];
  untrack: () => void;
  ready: boolean;
}

export function createSquadPreview(canvas: HTMLCanvasElement, slots: Record<ClassId, HTMLElement>, opts: SquadPreviewOpts = {}): SquadPreview {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.autoClear = false;

  let disposed = false;
  let raf = 0;
  let active: ClassId | null = null;
  let clock = 0;
  let last = performance.now();
  const ops: Op[] = [];
  const tpls = new Map<ClassId, RbTemplate>();
  let env: THREE.Texture | null = null;
  const owned: { dispose(): void }[] = [];

  function resize(): void {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth), h = Math.max(1, canvas.clientHeight || window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
  }
  resize();

  // sombra de contacto: disco con degradado radial
  const discTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const rg = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    rg.addColorStop(0, 'rgba(0,0,0,0.7)'); rg.addColorStop(0.55, 'rgba(0,0,0,0.35)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const discGeo = new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2);
  const discMat = new THREE.MeshBasicMaterial({ map: discTex, transparent: true, depthWrite: false });
  owned.push(discTex, discGeo, discMat);

  function makeOp(id: ClassId, i: number, tpl: RbTemplate): Op {
    const scene = new THREE.Scene();
    const lights: { l: THREE.Light; base: number }[] = [];
    const dirLight = (c: { color: number; intensity: number; pos: [number, number, number] }): void => {
      const l = new THREE.DirectionalLight(c.color, c.intensity);
      l.position.set(...c.pos);
      scene.add(l); lights.push({ l, base: c.intensity });
    };
    dirLight(PV_LIGHTS.key); dirLight(PV_LIGHTS.fill); dirLight(PV_LIGHTS.rimA); dirLight(PV_LIGHTS.rimB);
    const hemi = new THREE.HemisphereLight(0xcfd8ff, 0x20242c, PV_LIGHTS.hemi);
    scene.add(hemi); lights.push({ l: hemi, base: PV_LIGHTS.hemi });

    const inner = SkeletonUtils.clone(tpl.holder);
    scene.add(inner);
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.y = 0.01;
    scene.add(disc);

    const op: Op = {
      id, scene, cam: new THREE.PerspectiveCamera(PV_FOV, 0.5, 0.1, 30), inner, mixer: new THREE.AnimationMixer(inner),
      actions: new Map(), cur: null, curName: '', actionUntil: 0, nextAt: 0, lastActionAt: -99, dim: 1, lights,
      untrack: trackGun(inner, tpl.gun), ready: false,
    };
    op.nextAt = rand(PV_ACTION_MIN, PV_ACTION_MAX) + i * PV_STAGGER;
    return op;
  }

  function action(op: Op, tpl: RbTemplate, name: string): THREE.AnimationAction | null {
    let a = op.actions.get(name);
    if (!a) {
      const clip = tpl.fullClip(name);
      if (!clip) return null;
      a = op.mixer.clipAction(clip);
      op.actions.set(name, a);
    }
    return a;
  }

  function play(op: Op, name: string, once: boolean): void {
    const tpl = tpls.get(op.id);
    if (!tpl) return;
    const next = action(op, tpl, name);
    if (!next || op.curName === name) return;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.setEffectiveWeight(1);
    next.fadeIn(PV_FADE);
    next.play();
    if (op.cur) op.cur.fadeOut(PV_FADE);
    op.cur = next; op.curName = name;
  }

  function trigger(op: Op, name: 'Sprint_Loop' | 'Roll'): void {
    const tpl = tpls.get(op.id);
    if (!tpl) return;
    const dur = name === 'Roll' ? (tpl.fullClip('Roll')?.duration ?? 1.5) : PV_SPRINT_TIME;
    play(op, name, name === 'Roll');
    op.actionUntil = clock + dur - (name === 'Roll' ? PV_FADE : 0);
    op.lastActionAt = clock;
    op.nextAt = clock + dur + rand(PV_ACTION_MIN, PV_ACTION_MAX);
  }

  /** Encuadre: el cuerpo entero cabe siempre, también en Sprint y Roll, según la proporción del hueco. */
  function frame(op: Op, aspect: number): void {
    const usable = 1 - PV_HEAD_MARGIN - PV_FEET_MARGIN;
    const spanV = Math.max(PV_BODY_HEIGHT / usable, (2 * PV_HALF_WIDTH) / Math.max(0.2, aspect));
    const half = THREE.MathUtils.degToRad(PV_FOV / 2);
    const dist = spanV / 2 / Math.tan(half);
    const cy = spanV / 2 - PV_FEET_MARGIN * spanV;          // centro del encuadre: los pies quedan a PV_FEET_MARGIN del borde inferior
    op.cam.aspect = aspect;
    op.cam.fov = PV_FOV;
    op.cam.updateProjectionMatrix();
    op.cam.position.set(0, Math.max(0.5, cy - PV_CAMERA_DROP), dist);
    op.cam.lookAt(0, cy, 0);
  }

  function loop(now: number): void {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden) { last = now; return; }
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    clock += dt;

    renderer.setScissorTest(false);
    renderer.clear(true, true, true);
    const cr = canvas.getBoundingClientRect();
    for (const op of ops) {
      if (!op.ready) continue;
      const r = slots[op.id].getBoundingClientRect();
      const offscreen = r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth;
      // el brillo avanza aunque no se dibuje
      const target = active === null || active === op.id ? 1 : PV_DIM;
      op.dim += (target - op.dim) * (1 - Math.exp(-dt * PV_DIM_SPEED));
      if (offscreen) continue;

      if (op.actionUntil > 0 && clock >= op.actionUntil) { op.actionUntil = 0; play(op, 'Idle_Loop', false); }
      else if (op.actionUntil === 0 && clock >= op.nextAt) trigger(op, Math.random() < 0.5 ? 'Sprint_Loop' : 'Roll');
      op.mixer.update(dt);

      for (const { l, base } of op.lights) l.intensity = base * op.dim;
      op.scene.environmentIntensity = PV_LIGHTS.env * op.dim;

      const x = Math.max(0, r.left - cr.left), y = Math.max(0, cr.height - (r.bottom - cr.top));
      const w = Math.min(r.width, cr.width - x), h = Math.min(r.height, cr.height - y);
      if (w < 2 || h < 2) continue;
      frame(op, w / h);
      renderer.setViewport(x, y, w, h);
      renderer.setScissor(x, y, w, h);
      renderer.setScissorTest(true);
      renderer.clearDepth();
      renderer.render(op.scene, op.cam);
    }
  }

  // ── carga: plantillas compartidas con el juego; si falla, no se dibuja nada ni se llama a onReady
  void (async () => {
    try {
      const lib = sharedRbLibrary;
      if (!(await lib.load()) || disposed) return;
      lib.build(false, true);
      // entorno tenue propio (el PMREM es por contexto: no se comparte con el renderer del juego)
      void new RGBELoader().loadAsync(modelsUrl('hdri/unfinished_office_1k.hdr')).then((tex) => {
        if (disposed) { tex.dispose(); return; }
        tex.mapping = THREE.EquirectangularReflectionMapping;
        const pm = new THREE.PMREMGenerator(renderer);
        env = pm.fromEquirectangular(tex).texture;
        tex.dispose(); pm.dispose();
        owned.push(env);
        for (const o of ops) o.scene.environment = env;
      }).catch(() => { /* sin entorno: solo luces de estudio */ });

      for (const [i, id] of IDS.entries()) {
        const tpl = lib.templates.get(id);
        if (!tpl) continue;
        tpls.set(id, tpl);
        const op = makeOp(id, i, tpl);
        if (env) op.scene.environment = env;
        // clips retargeteados uno por tarea para no bloquear el hilo
        for (const n of ['Idle_Loop', 'Sprint_Loop', 'Roll']) {
          tpl.fullClip(n);
          await new Promise<void>((res) => setTimeout(res, 0));
          if (disposed) return;
        }
        if (!tpl.fullClip('Idle_Loop')) continue;       // sin animación de reposo no hay nada que enseñar
        play(op, 'Idle_Loop', false);
        op.mixer.update(Math.random() * 2);              // fase inicial distinta para cada operador
        op.ready = true;
        ops.push(op);
        opts.onReady?.(id);
      }
    } catch (e) {
      console.warn('Vista previa del escuadrón: no se pudo cargar', e);
    }
  })();

  raf = requestAnimationFrame(loop);

  return {
    resize,
    setActive(c: ClassId | null): void {
      active = c;
      if (!c) return;
      const op = ops.find((o) => o.id === c);
      if (op && op.ready && clock - op.lastActionAt >= PV_ACTIVE_MIN_GAP && op.actionUntil === 0) trigger(op, 'Sprint_Loop');
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      for (const op of ops) {
        op.mixer.stopAllAction();
        op.mixer.uncacheRoot(op.inner);
        op.untrack();
        // los clones: geometría y materiales son de las plantillas compartidas con el juego y no se liberan aquí
        op.inner.traverse((o) => { const sk = o as THREE.SkinnedMesh; if (sk.isSkinnedMesh) sk.skeleton.dispose(); });
      }
      ops.length = 0;
      for (const o of owned) o.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
