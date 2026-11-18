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
import { LevelLayer, makeStars } from './levelMesh';
import { THEMES } from './palette';

export function createRenderer(canvas: HTMLCanvasElement): IRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const maxPR = coarse ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPR));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9aa8bb);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 220);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.7);
  const dir = new THREE.DirectionalLight(0xffffff, 1.7);
  scene.add(hemi, dir, dir.target);

  const chars = new CharManager();
  const fx = new Fx();
  const pickups = new PickupLayer();
  scene.add(chars.group, fx.group, pickups.group);

  let world: IWorld | null = null;
  let levelLayer: LevelLayer | null = null;
  let furnLayer: FurnitureLayer | null = null;
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
  }
  resize(cssW, cssH);

  function clearWorld(): void {
    if (levelLayer) { scene.remove(levelLayer.group); levelLayer.dispose(); levelLayer = null; }
    if (furnLayer) { scene.remove(furnLayer.group); furnLayer.dispose(); furnLayer = null; }
    if (debugLayer) { scene.remove(debugLayer.group); debugLayer.dispose(); debugLayer = null; }
    if (stars) { scene.remove(stars); stars = null; }
    worldOwned.disposeAll();
    chars.clear(); pickups.clear(); fx.clear();
    camInit = false;
  }

  function setWorld(w: IWorld | null): void {
    clearWorld();
    world = w;
    if (!w) {
      scene.background = new THREE.Color(0x0b0d12);
      return;
    }
    const lv = w.level;
    const th = THEMES[lv.theme] ?? THEMES.recepcion;
    scene.background = new THREE.Color(th.bg);
    hemi.color.setHex(th.hemiSky); hemi.groundColor.setHex(th.hemiGround); hemi.intensity = th.hemiI;
    dir.color.setHex(th.dirColor); dir.intensity = th.dirI;
    levelLayer = new LevelLayer(lv);
    scene.add(levelLayer.group);
    furnLayer = new FurnitureLayer(lv.furniture, lv.theme);
    scene.add(furnLayer.group);
    if (lv.theme === 'azotea') { stars = makeStars(worldOwned); scene.add(stars); }
  }

  function onEvents(events: GameEvent[]): void {
    if (!world) return;
    fx.handle(events, world);
  }

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

    // la luz direccional acompaña a la cámara (arriba, detrás y a la izquierda) para que
    // lo que se ve —sobre todo las espaldas de los personajes— siempre esté bien iluminado
    const fxv = Math.cos(c.yaw), fzv = Math.sin(c.yaw);
    dir.position.set(
      camPos.x + (-fxv * 0.5 + fzv * 0.45) * 40,
      camPos.y + 40,
      camPos.z + (-fzv * 0.5 - fxv * 0.45) * 40,
    );
    dir.target.position.copy(camPos);
    dir.target.updateMatrixWorld();
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
    fx.update(dt, w, w.time);

    if (w.cheats.aiDebug) {
      if (!debugLayer) { debugLayer = new AiDebugLayer(); scene.add(debugLayer.group); }
      debugLayer.update(w, (id) => chars.posOf(id));
    } else if (debugLayer) {
      scene.remove(debugLayer.group); debugLayer.dispose(); debugLayer = null;
    }

    renderer.render(scene, camera);
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
    clearWorld();
    world = null;
    chars.dispose(); fx.dispose(); pickups.dispose();
    disposeRamp();
    renderer.dispose();
  }

  return { setWorld, onEvents, render, resize, applySettings, project, dispose };
}
