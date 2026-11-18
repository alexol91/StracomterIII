// Módulo de dibujo (three.js). Implementa IRenderer.
//
// Convenios: plano de simulación (x, y) -> three (X = x, Z = y); altura z -> Y.
// El dibujo NO modifica el mundo: solo lo lee. La cámara es world.cam tal cual (con un suavizado
// de posición del mismo orden que el del jugador para que su modelo no tiemble en pantalla)
// más la sacudida opcional.

import * as THREE from 'three';
import type { GameEvent, Kind } from '../sim/types';
import type { IRenderer, IWorld, Settings } from '../contracts';
import { CharManager } from './characters';
import { AiDebugLayer } from './debug';
import { Fx } from './fx';
import { FurnitureLayer, PickupLayer } from './furniture';
import { disposeRamp, Owned } from './geo';
import { assetsDone, getAssets, loadAssets, type AssetPart, type Assets } from './assets';
import { ENEMY_MIX } from '../sim/data';
import { RbLibrary, sharedRbLibrary } from './rbchars';
import { FOG, LevelLayer, makeStars, pbrIdsFor, SKY } from './levelMesh';
import { THEMES } from './palette';
import { getStyleMode, setStyleMode, type Style } from './style';
import { isEnvReady, isPBRReady, loadEnvironment } from './pbr';
import { getOffice, loadOffice, type OfficeAssets } from './officeassets';
import { RealFurnitureLayer } from './officefurn';
import type { Theme } from '../sim/types';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Calidad de dibujo:
 *  · 'high' (auto en ordenador): sombras reales, posprocesado, normal maps en personajes.
 *  · 'medium' (auto en táctil): personajes Rocketbox sin normales, muebles y texturas PBR, entorno HDRI, sombras blob,
 *    sin posprocesado, devicePixelRatio ≤ 1,5 y animación lejana (> 18 m) a 1 de cada 3 frames.
 *  · 'low': personajes Quaternius de reserva, sin HDRI.
 */
export type RenderQuality = 'low' | 'medium' | 'high';
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
  recepcion: { exposure: 0.88, env: 0.75, hemi: 0.3, dir: 1.6, hdri: 'unfinished_office_1k' },
  soporte: { exposure: 0.9, env: 0.8, hemi: 0.3, dir: 1.6, hdri: 'unfinished_office_1k' },
  desarrollo: { exposure: 0.9, env: 0.8, hemi: 0.3, dir: 1.6, hdri: 'unfinished_office_1k' },
  calidad: { exposure: 0.88, env: 0.75, hemi: 0.3, dir: 1.6, hdri: 'unfinished_office_1k' },
  datos: { exposure: 1.0, env: 0.5, hemi: 0.3, dir: 1.6, hdri: 'unfinished_office_1k' },
  comercial: { exposure: 0.88, env: 0.75, hemi: 0.3, dir: 1.6, hdri: 'unfinished_office_1k' },
  direccion: { exposure: 0.88, env: 0.8, hemi: 0.28, dir: 1.5, hdri: 'unfinished_office_1k' },
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

  // calidad: auto = 'medium' en táctil y 'high' en ordenador; ?quality=high|medium|low la fuerza; Settings.graphics la elige
  const autoQuality: RenderQuality = coarse ? 'medium' : 'high';
  let urlQuality: RenderQuality | null = null;
  try {
    const q = new URLSearchParams(location.search).get('quality');
    if (q === 'low' || q === 'medium' || q === 'high') urlQuality = q;
  } catch { /* sin acceso a la URL */ }
  let quality: RenderQuality = urlQuality ?? autoQuality;
  /** devicePixelRatio máximo según la calidad */
  const prLimit = (): number => Math.min(maxPR, quality === 'medium' ? 1.5 : 2);
  const shadowMapSize = coarse ? 1024 : 2048;
  let composer: EffectComposer | null = null;

  const chars = new CharManager();
  const rb = sharedRbLibrary;
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, prLimit()));
    renderer.setSize(cssW, cssH, true);
    camera.aspect = cssW / cssH;
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
      if (quality !== 'low') {
        hemi.intensity = L.hemi;
        void loadEnvironment(renderer, L.hdri).then((env) => {
          if (disposed || currentTheme !== theme || quality === 'low' || getStyleMode() !== 'realista') return;
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
    lastLevelVersion = lv.version;
    extraKinds.clear();
    applyLighting(lv.theme, th);
    const [fogNear, fogFar] = FOG[lv.theme];
    scene.fog = new THREE.Fog(SKY[lv.theme][1], fogNear, fogFar);
    scene.background = new THREE.Color(SKY[lv.theme][1]);
    levelLayer = new LevelLayer(lv, quality === 'high');
    scene.add(levelLayer.group, levelLayer.sky);
    buildFurniture();
    if (lv.theme === 'azotea') { stars = makeStars(worldOwned); scene.add(stars); }
    ensureAll();
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

  // ───────────── carga bajo demanda ─────────────
  let officeState: 'idle' | 'loading' | 'done' | 'failed' = 'idle';
  let rbBusy = false;
  let rbKey = '';
  const extraKinds = new Set<Kind>();     // tipos que aparecen en la partida y no estaban previstos (suceso spawn)
  let lastLevelVersion = -1;

  /** Tipos de personaje que necesita el mundo actual: siempre la escuadra y, según la planta, los enemigos. */
  function kindsForWorld(w: IWorld | null): Kind[] {
    const ks: Kind[] = [...RbLibrary.SQUAD, 'enemy1'];
    if (w) {
      const mix = ENEMY_MIX[w.floor] ?? [1, 0, 0];
      if (mix[1] > 0) ks.push('enemy2');
      if (mix[2] > 0) ks.push('enemy3');
      if (w.floor >= 2) ks.push('miniboss');
      if (w.floor >= 8) ks.push('megaboss');
    }
    for (const k of extraKinds) if (!ks.includes(k)) ks.push(k);
    return ks;
  }

  function ensureOffice(): void {
    if (getStyleMode() !== 'realista' || officeState !== 'idle' || disposed) return;
    officeState = 'loading';
    void loadOffice().then((o: OfficeAssets | null) => {
      if (disposed) return;
      officeState = o && o.parts.size > 0 ? 'done' : 'failed';
      if (o) pickups.setOffice(o);
      buildFurniture();
      ensureReserve();
    }).catch(() => { officeState = 'failed'; ensureReserve(); });
  }

  /** Modelos de reserva (Quaternius y Kenney): solo en cómic, en calidad baja o si falla lo realista. */
  function reserveParts(): AssetPart[] {
    if (getStyleMode() !== 'realista') return ['chars', 'furn', 'misc'];
    const parts: AssetPart[] = [];
    if (quality === 'low' || rb.failed) parts.push('chars');
    if (officeState === 'failed') parts.push('furn', 'misc');
    return parts;
  }
  function ensureReserve(): void {
    const need = reserveParts().filter((p) => !assetsDone(p));
    if (need.length) void loadAssets(need).then((a) => { if (a && !disposed) useAssets(a); });
  }

  function ensureAll(): void { ensureOffice(); ensureRb(); ensureReserve(); }

  /** Fracción (0..1) de lo que necesita el mundo actual, en el estilo y calidad actuales, ya cargado y listo para verse. */
  function loadProgress(): number {
    const w = world;
    if (!w) return 1;
    let done = 0, total = 0;
    const add = (d: number, wt = 1): void => { done += d * wt; total += wt; };
    const real = getStyleMode() === 'realista';
    if (real) {
      add(officeState === 'done' || officeState === 'failed' ? 1 : 0, 2);
      for (const id of pbrIdsFor(w.level.theme)) add(isPBRReady(id) ? 1 : 0);
      if (quality !== 'low') add(isEnvReady(REAL_LIGHT[w.level.theme].hdri) ? 1 : 0);
      if (rbWanted()) add(rb.progress(kindsForWorld(w)), 4);
    }
    for (const p of reserveParts()) add(assetsDone(p) ? 1 : 0, p === 'chars' ? 2 : 1);
    return total === 0 ? 1 : Math.max(0, Math.min(1, done / total));
  }

  function onEvents(events: GameEvent[]): void {
    if (!world) return;
    fx.handle(events, world);
    chars.onEvents(events);
    for (const ev of events) if (ev.type === 'spawn' && rbWanted() && !rb.has(ev.kind) && !extraKinds.has(ev.kind)) { extraKinds.add(ev.kind); ensureRb(); }
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
  function rbWanted(): boolean { return getStyleMode() === 'realista' && quality !== 'low'; }
  function updateUseRb(): void { rb.setNormals(quality === 'high'); chars.setUseRb(rbWanted() && rb.loaded && rb.templates.size > 0); }
  function ensureRb(): void {
    if (!rbWanted() || disposed || !world || rbBusy) return;
    const kinds = kindsForWorld(world);
    const key = kinds.join(',');
    if (kinds.every((k) => rb.has(k)) || key === rbKey) return;     // nada nuevo que cargar (o ya se intentó con este conjunto)
    rbKey = key;
    rbBusy = true;
    void rb.ensure(kinds).then(async (ok) => {
      if (disposed) return;
      if (!ok) { ensureReserve(); return; }            // falló: se usan los Quaternius de reserva
      rb.build(colorblind, true);
      await rb.prewarm();                              // retargeteo repartido en tareas pequeñas; mientras, se ven los de reserva
      if (disposed) return;
      chars.setRb(rb);
      updateUseRb();
    }).finally(() => { rbBusy = false; if (!disposed) ensureRb(); });
  }

  function applyQuality(): void {
    const high = quality === 'high';
    renderer.shadowMap.enabled = high;
    dir.castShadow = high;
    if (dir.shadow.map && dir.shadow.mapSize.x !== shadowMapSize) { dir.shadow.map.dispose(); dir.shadow.map = null; }
    dir.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    chars.setShadows(high);
    chars.setFarAnimDist(quality === 'medium' ? 18 : 30);
    fx.setHighQuality(high);
    levelLayer?.setShadows(high);
    furnLayer?.setShadows(high);
    if (!high && composer) { composer.dispose(); composer = null; }
    resize(cssW, cssH);                    // el límite de devicePixelRatio depende de la calidad
    if (currentTheme) applyLighting(currentTheme);
    fx.setDecalQuality(quality);
    ensureAll(); updateUseRb();
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
    // campo de visión vertical de la simulación (se cierra al apuntar); en pantallas verticales se abre un 25 %
    const wantFov = Math.min(110, (c.fov ?? 60) * (camera.aspect < 1 ? 1.25 : 1));
    if (Math.abs(camera.fov - wantFov) > 0.01) { camera.fov = wantFov; camera.updateProjectionMatrix(); }
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
    if (w.level.version !== lastLevelVersion) { lastLevelVersion = w.level.version; fx.clearDecals(); }   // boquete: las marcas ya no valen
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
    if (s.graphics !== undefined && !urlQuality) setQuality(s.graphics === 'auto' ? autoQuality : s.graphics);   // ?quality= en la URL manda sobre el ajuste
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
    chars.dispose(); fx.dispose(); pickups.dispose();
    disposeRamp();
    renderer.dispose();
  }

  function setQuality(q: RenderQuality): void {
    if (q === quality) return;
    quality = q;
    applyQuality();
  }

  function setStyle(st: Style): void {
    if (st === getStyleMode()) return;
    setStyleMode(st);
    composer?.dispose(); composer = null;      // se recrea con los pases del estilo
    chars.restyle(); pickups.restyle();
    ensureAll(); updateUseRb();
    const w = world;
    if (w) setWorld(w);                        // reconstruye escenario, mobiliario y luz con el estilo nuevo
  }

  return { setWorld, onEvents, render, resize, applySettings, project, dispose, setQuality, getQuality: () => quality, loadProgress, setStyle, getStyle: () => getStyleMode() };
}
