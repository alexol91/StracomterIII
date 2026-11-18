// Módulo de dibujo (three.js). Implementa IRenderer.
//
// Convenios: plano de simulación (x, y) -> three (X = x, Z = y); altura z -> Y.
// El dibujo NO modifica el mundo: solo lo lee. La cámara es world.cam tal cual (con un suavizado
// de posición del mismo orden que el del jugador para que su modelo no tiemble en pantalla)
// más la sacudida opcional.

import * as THREE from 'three';
import type { GameEvent } from '../sim/types';
import type { IRenderer, IWorld, Settings } from '../contracts';
import { CharManager } from './characters';
import { AiDebugLayer } from './debug';
import { Fx } from './fx';
import { FurnitureLayer, PickupLayer } from './furniture';
import { disposeRamp, Owned } from './geo';
import { getAssets, loadAssets, type Assets } from './assets';
import { RbLibrary } from './rbchars';
import { FOG, LevelLayer, makeStars, SKY } from './levelMesh';
import { THEMES } from './palette';
import { getStyleMode, setStyleMode, type Style } from './style';
import { loadEnvironment } from './pbr';
import { getOffice, loadOffice, type OfficeAssets } from './officeassets';
import { RealFurnitureLayer } from './officefurn';
import type { Theme } from '../sim/types';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Calidad de dibujo: 'high' = sombras reales + posprocesado; 'low' = sombras blob, sin posprocesado. */
export type RenderQuality = 'low' | 'high';
export type RendererWithQuality = IRenderer & {
  setQuality(q: RenderQuality): void; getQuality(): RenderQuality;
  /** 'realista' (PBR, HDRI) o 'comic' (el de antes). También se fuerza con ?estilo= en la URL. */
  setStyle(s: Style): void; getStyle(): Style;
};

/** Posprocesado opcional (solo calidad alta): se activa con ?ao=1 / ?bloom=1 o cambiando estas constantes. */
const AO_DEFAULT = false;
const BLOOM_DEFAULT = false;

/** Luz del estilo realista por tema: exposición, intensidad del entorno HDRI, hemisférica, direccional y HDRI. */
export const REAL_LIGHT: Record<Theme, { exposure: number; env: number; hemi: number; dir: number; hdri: string }> = {
  recepcion: { exposure: 0.9, env: 0.85, hemi: 0.3, dir: 1.7, hdri: 'newman_lobby_1k' },
  soporte: { exposure: 0.9, env: 0.8, hemi: 0.3, dir: 1.6, hdri: 'unfinished_office_1k' },
  desarrollo: { exposure: 0.9, env: 0.8, hemi: 0.3, dir: 1.6, hdri: 'unfinished_office_1k' },
  calidad: { exposure: 0.9, env: 0.85, hemi: 0.3, dir: 1.7, hdri: 'unfinished_office_1k' },
  datos: { exposure: 1.0, env: 0.5, hemi: 0.3, dir: 1.6, hdri: 'unfinished_office_1k' },
  comercial: { exposure: 0.9, env: 0.85, hemi: 0.3, dir: 1.7, hdri: 'newman_lobby_1k' },
  direccion: { exposure: 0.88, env: 0.8, hemi: 0.28, dir: 1.5, hdri: 'newman_lobby_1k' },
  juntas: { exposure: 0.88, env: 0.8, hemi: 0.28, dir: 1.5, hdri: 'unfinished_office_1k' },
  azotea: { exposure: 1.0, env: 0.1, hemi: 0.18, dir: 1.6, hdri: 'unfinished_office_1k' },
};

/** Pase final propio: saturación, curva de contraste y viñeta suave. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uVig: { value: 0.3 }, uSat: { value: 1.12 }, uCon: { value: 1.07 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig; uniform float uSat; uniform float uCon; varying vec2 vUv;
  void main(){
    vec4 c = texture2D(tDiffuse, vUv);
    float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    c.rgb = mix(vec3(l), c.rgb, uSat);
    c.rgb = (c.rgb - 0.18) * uCon + 0.18;
    vec2 d = (vUv - 0.5) * vec2(1.0, 0.9);
    float v = 1.0 - smoothstep(0.25, 0.85, length(d) * 1.15);
    c.rgb *= mix(1.0 - uVig, 1.0, v);
    gl_FragColor = vec4(max(c.rgb, 0.0), c.a);
  }`,
};

const SHADOW_SPAN = 28;   // lado (m) del frustum ortográfico de la sombra
const SHADOW_DIR = new THREE.Vector3(-20, 42, -14).normalize();   // hacia la luz

export function createRenderer(canvas: HTMLCanvasElement): RendererWithQuality {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const maxPR = coarse ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPR));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;   // comprime las luces fuertes sin quemar el suelo claro
  renderer.toneMappingExposure = 0.9;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9aa8bb);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 220);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.7);
  const dir = new THREE.DirectionalLight(0xffffff, 1.7);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);   // relleno sin sombra que acompaña a la cámara
  scene.add(hemi, dir, dir.target, fill, fill.target);
  dir.shadow.camera.left = dir.shadow.camera.bottom = -SHADOW_SPAN / 2;
  dir.shadow.camera.right = dir.shadow.camera.top = SHADOW_SPAN / 2;
  dir.shadow.camera.near = 1; dir.shadow.camera.far = 150;
  dir.shadow.camera.updateProjectionMatrix();   // sin esto el frustum se queda en el de fábrica (10×10 m)
  dir.shadow.bias = -0.0004; dir.shadow.normalBias = 0.04;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // calidad: 'high' por defecto; 'low' en táctiles con densidad de pixel alta (o por ?quality= / localStorage)
  let quality: RenderQuality = coarse && (window.devicePixelRatio || 1) >= 2 ? 'low' : 'high';
  try {
    const q = new URLSearchParams(location.search).get('quality') ?? localStorage.getItem('torre.quality');
    if (q === 'low' || q === 'high') quality = q;
  } catch { /* sin acceso a la URL o al almacenamiento */ }
  const shadowMapSize = coarse ? 1024 : 2048;
  let composer: EffectComposer | null = null;

  const chars = new CharManager();
  const rb = new RbLibrary();
  let rbStarted = false;
  const fx = new Fx();
  const pickups = new PickupLayer();
  scene.add(chars.group, fx.group, pickups.group);

  let disposed = false;
  let world: IWorld | null = null;
  let levelLayer: LevelLayer | null = null;
  let furnLayer: FurnitureLayer | RealFurnitureLayer | null = null;
  let currentTheme: Theme | null = null;
  const q0 = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); } })();
  const useAO = q0.get('ao') ? q0.get('ao') === '1' : AO_DEFAULT;
  const useBloom = q0.get('bloom') ? q0.get('bloom') === '1' : BLOOM_DEFAULT;
  let debugLayer: AiDebugLayer | null = null;
  let stars: THREE.Points | null = null;
  const worldOwned = new Owned();

  let cssW = canvas.clientWidth || window.innerWidth || 800;
  let cssH = canvas.clientHeight || window.innerHeight || 600;
  let colorblind = false;
  let cameraShake = true;

  // cámara suavizada
  const camPos = new THREE.Vector3();
  let camInit = false;

  function resize(w: number, h: number): void {
    cssW = Math.max(1, w); cssH = Math.max(1, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPR));
    renderer.setSize(cssW, cssH, true);
    camera.aspect = cssW / cssH;
    camera.fov = camera.aspect < 1 ? 75 : 60;
    camera.updateProjectionMatrix();
    if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(cssW, cssH); }
  }
  resize(cssW, cssH);

  function clearWorld(): void {
    if (levelLayer) { scene.remove(levelLayer.group, levelLayer.sky); levelLayer.dispose(); levelLayer = null; }
    scene.fog = null;
    if (furnLayer) { scene.remove(furnLayer.group); furnLayer.dispose(); furnLayer = null; }
    if (debugLayer) { scene.remove(debugLayer.group); debugLayer.dispose(); debugLayer = null; }
    if (stars) { scene.remove(stars); stars = null; }
    worldOwned.disposeAll();
    chars.clear(); pickups.clear(); fx.clear();
    camInit = false;
  }

  /** Luz y tono según estilo, tema y calidad. */
  function applyLighting(theme: Theme, th = THEMES[theme] ?? THEMES.recepcion): void {
    if (getStyleMode() === 'realista') {
      const L = REAL_LIGHT[theme];
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = L.exposure;
      hemi.color.setHex(th.hemiSky); hemi.groundColor.setHex(th.hemiGround);
      dir.color.setHex(th.dirColor); dir.intensity = L.dir;
      fill.color.setHex(th.dirColor); fill.intensity = L.dir * 0.12;
      if (quality === 'high') {
        hemi.intensity = L.hemi;
        void loadEnvironment(renderer, L.hdri).then((env) => {
          if (disposed || currentTheme !== theme || quality !== 'high' || getStyleMode() !== 'realista') return;
          scene.environment = env; scene.environmentIntensity = L.env;
        });
      } else { scene.environment = null; hemi.intensity = theme === 'azotea' ? 0.7 : 2.4; }   // sin HDRI en calidad baja
    } else {
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 0.9;
      scene.environment = null;
      hemi.color.setHex(th.hemiSky); hemi.groundColor.setHex(th.hemiGround); hemi.intensity = th.hemiI;
      dir.color.setHex(th.dirColor); dir.intensity = th.dirI * 0.9;
      fill.color.setHex(th.dirColor); fill.intensity = th.dirI * 0.3;
    }
  }

  function setWorld(w: IWorld | null): void {
    clearWorld();
    world = w;
    if (!w) {
      scene.background = new THREE.Color(0x0b0d12);
      scene.environment = null;
      currentTheme = null;
      return;
    }
    const lv = w.level;
    const th = THEMES[lv.theme] ?? THEMES.recepcion;
    scene.background = new THREE.Color(th.bg);
    currentTheme = lv.theme;
    applyLighting(lv.theme, th);
    const [fogNear, fogFar] = FOG[lv.theme];
    scene.fog = new THREE.Fog(SKY[lv.theme][1], fogNear, fogFar);
    scene.background = new THREE.Color(SKY[lv.theme][1]);
    levelLayer = new LevelLayer(lv, quality === 'high');
    scene.add(levelLayer.group, levelLayer.sky);
    buildFurniture();
    if (lv.theme === 'azotea') { stars = makeStars(worldOwned); scene.add(stars); }
  }

  /** Aplica los modelos CC0 cuando termina la carga (setWorld funciona antes con los modelos de cajas). */
  function useAssets(a: Assets): void {
    if (disposed) return;
    chars.setAssets(a); pickups.setAssets(a); fx.setAssets(a);
    buildFurniture();
  }

  /** Mobiliario del estilo actual: PBR de oficina si ya cargó; si no, el de reserva (Kenney / cajas). */
  function buildFurniture(): void {
    if (!world || !levelLayer) return;
    if (furnLayer) { scene.remove(furnLayer.group); furnLayer.dispose(); furnLayer = null; }
    const off = getOffice();
    if (getStyleMode() === 'realista' && off && off.parts.size > 0) {
      try { furnLayer = new RealFurnitureLayer(world.level, off); } catch { furnLayer = null; }
    }
    if (!furnLayer) furnLayer = new FurnitureLayer(world.level.furniture, world.level.theme, getAssets());
    furnLayer.setShadows(quality === 'high');
    scene.add(furnLayer.group);
  }
  void loadOffice().then((o: OfficeAssets | null) => { if (o && !disposed) { pickups.setOffice(o); buildFurniture(); } }).catch(() => { /* reserva */ });
  void loadAssets().then((a) => { if (a) useAssets(a); }).catch(() => { /* se quedan los modelos de cajas */ });

  function onEvents(events: GameEvent[]): void {
    if (!world) return;
    fx.handle(events, world);
  }

  // ── sombras: frustum ortográfico centrado en el jugador, con la luz cuantizada a téxeles
  const _sr = new THREE.Vector3(), _su = new THREE.Vector3(), _sc = new THREE.Vector3(), _sd = new THREE.Vector3();
  function updateShadowRig(px: number, pz: number): void {
    _sd.copy(SHADOW_DIR);
    _sr.crossVectors(new THREE.Vector3(0, 1, 0), _sd).normalize();
    _su.crossVectors(_sd, _sr).normalize();
    _sc.set(px, 0, pz);
    const texel = SHADOW_SPAN / shadowMapSize;
    const a = Math.round(_sc.dot(_sr) / texel) * texel;
    const b = Math.round(_sc.dot(_su) / texel) * texel;
    const d = _sc.dot(_sd);
    _sc.set(0, 0, 0).addScaledVector(_sr, a).addScaledVector(_su, b).addScaledVector(_sd, d);
    dir.target.position.copy(_sc);
    dir.position.copy(_sc).addScaledVector(_sd, 70);
    dir.target.updateMatrixWorld();
  }

  /** Rocketbox solo en estilo realista y calidad alta (en 'low' el skinning de ~10k triángulos × 49 sale caro: Quaternius). */
  function rbWanted(): boolean { return getStyleMode() === 'realista' && quality === 'high'; }
  function updateUseRb(): void { chars.setUseRb(rbWanted() && rb.loaded && rb.templates.size > 0); }
  function ensureRb(): void {
    if (!rbWanted() || rbStarted || disposed) return;
    rbStarted = true;
    void rb.load().then(async (ok) => {
      if (!ok || disposed) return;
      rb.build(colorblind);
      await rb.prewarm();                  // retargeteo repartido en tareas pequeñas; mientras, se ven los Quaternius
      if (disposed) return;
      chars.setRb(rb);
      updateUseRb();
    });
  }

  function applyQuality(): void {
    const high = quality === 'high';
    renderer.shadowMap.enabled = high;
    dir.castShadow = high;
    if (dir.shadow.map && dir.shadow.mapSize.x !== shadowMapSize) { dir.shadow.map.dispose(); dir.shadow.map = null; }
    dir.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    chars.setShadows(high);
    fx.setHighQuality(high);
    levelLayer?.setShadows(high);
    furnLayer?.setShadows(high);
    if (!high && composer) { composer.dispose(); composer = null; }
    if (currentTheme) applyLighting(currentTheme);
    ensureRb(); updateUseRb();
  }
  function ensureComposer(): EffectComposer {
    if (composer) return composer;
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(Math.floor(cssW * pr), Math.floor(cssH * pr), { samples: 4, type: THREE.HalfFloatType });
    composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(pr);
    composer.setSize(cssW, cssH);
    composer.addPass(new RenderPass(scene, camera));
    if (useAO && getStyleMode() === 'realista') composer.addPass(new GTAOPass(scene, camera, cssW, cssH));
    if (useBloom && getStyleMode() === 'realista') composer.addPass(new UnrealBloomPass(new THREE.Vector2(cssW, cssH), 0.22, 0.5, 0.92));
    composer.addPass(new ShaderPass(GradeShader));
    composer.addPass(new OutputPass());
    return composer;
  }
  applyQuality();

  const _tmp = new THREE.Vector3();

  function updateCamera(w: IWorld, dt: number): void {
    const c = w.cam;
    const tx = c.x, ty = c.z, tz = c.y;
    if (!camInit || camPos.distanceToSquared(_tmp.set(tx, ty, tz)) > 6) {
      camPos.set(tx, ty, tz); camInit = true;
    } else {
      const k = 1 - Math.exp(-dt * 30);
      camPos.x += (tx - camPos.x) * k; camPos.y += (ty - camPos.y) * k; camPos.z += (tz - camPos.z) * k;
    }
    camera.position.copy(camPos);
    if (cameraShake && fx.shake > 0) {
      const a = fx.shake;
      camera.position.x += (Math.random() - 0.5) * 2 * a;
      camera.position.y += (Math.random() - 0.5) * 2 * a;
      camera.position.z += (Math.random() - 0.5) * 2 * a;
    }
    const cp = Math.cos(c.pitch);
    camera.up.set(0, 1, 0);
    camera.lookAt(
      camera.position.x + Math.cos(c.yaw) * cp,
      camera.position.y + Math.sin(c.pitch),
      camera.position.z + Math.sin(c.yaw) * cp,
    );
    if (cameraShake && fx.shake > 0) camera.rotateZ((Math.random() - 0.5) * fx.shake * 0.12);
    camera.updateMatrixWorld(true);

    // la luz de relleno acompaña a la cámara (arriba, detrás y a la izquierda) para que las
    // espaldas de los personajes siempre se lean; la principal (con sombras) es fija en el mundo
    const fxv = Math.cos(c.yaw), fzv = Math.sin(c.yaw);
    fill.position.set(
      camPos.x + (-fxv * 0.5 + fzv * 0.45) * 40,
      camPos.y + 40,
      camPos.z + (-fzv * 0.5 - fxv * 0.45) * 40,
    );
    fill.target.position.copy(camPos);
    fill.target.updateMatrixWorld();
    updateShadowRig(w.player.x, w.player.y);
    levelLayer?.followCamera(camPos.x, camPos.y, camPos.z);
    if (stars) stars.position.copy(camPos);
  }

  function render(dt: number): void {
    dt = Math.min(Math.max(dt, 0), 0.1);
    const w = world;
    if (!w) { renderer.render(scene, camera); return; }

    levelLayer?.update();
    updateCamera(w, dt);
    chars.update(w, dt, camera);
    pickups.update(w, w.time);
    fx.update(dt, w, w.time, camera);

    if (w.cheats.aiDebug) {
      if (!debugLayer) { debugLayer = new AiDebugLayer(); scene.add(debugLayer.group); }
      debugLayer.update(w, (id) => chars.posOf(id));
    } else if (debugLayer) {
      scene.remove(debugLayer.group); debugLayer.dispose(); debugLayer = null;
    }

    if (quality === 'high') ensureComposer().render(dt); else renderer.render(scene, camera);
  }

  function applySettings(s: Settings): void {
    colorblind = !!s.colorblind;
    cameraShake = !!s.cameraShake;
    chars.setColorblind(colorblind);
    fx.setColorblind(colorblind);
    if (!cameraShake) fx.shake = 0;
  }

  const _pv = new THREE.Vector3();
  function project(x: number, y: number, z: number): { x: number; y: number } | null {
    camera.updateMatrixWorld();
    _pv.set(x, z, y).applyMatrix4(camera.matrixWorldInverse);
    if (_pv.z >= -camera.near) return null;       // detrás de la cámara
    _pv.set(x, z, y).project(camera);
    return { x: (_pv.x * 0.5 + 0.5) * cssW, y: (-_pv.y * 0.5 + 0.5) * cssH };
  }

  function dispose(): void {
    disposed = true;
    clearWorld();
    world = null;
    composer?.dispose(); composer = null;
    rb.dispose();
    chars.dispose(); fx.dispose(); pickups.dispose();
    disposeRamp();
    renderer.dispose();
  }

  function setQuality(q: RenderQuality): void {
    if (q === quality) return;
    quality = q;
    try { localStorage.setItem('torre.quality', q); } catch { /* ignorar */ }
    applyQuality();
  }

  function setStyle(st: Style): void {
    if (st === getStyleMode()) return;
    setStyleMode(st);
    composer?.dispose(); composer = null;      // se recrea con los pases del estilo
    chars.restyle(); pickups.restyle();
    ensureRb(); updateUseRb();
    const w = world;
    if (w) setWorld(w);                        // reconstruye escenario, mobiliario y luz con el estilo nuevo
  }

  return { setWorld, onEvents, render, resize, applySettings, project, dispose, setQuality, getQuality: () => quality, setStyle, getStyle: () => getStyleMode() };
}
