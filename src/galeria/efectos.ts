// Página de prueba de los efectos de disparo y explosión (solo desarrollo): abre /efectos.html con `npm run dev`.
// Usa el Fx real del juego sobre un suelo, una pared blanca, un mueble y una puerta, sin simulación.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Fx } from '../render/fx';
import { getStyleMode, setStyleMode } from '../render/style';
import type { IWorld } from '../contracts';
import type { GameEvent } from '../sim/types';

const canvas = document.getElementById('lienzo') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2e36);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
camera.position.set(7, 2.6, 8);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.2, -2);
controls.update();

scene.add(new THREE.HemisphereLight(0xdde6ff, 0x4a4a52, 1.0));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.4); sun.position.set(-4, 8, 6); scene.add(sun);

// suelo, pared, mueble y puerta
const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6d7078, roughness: 0.9 }));
const wall = new THREE.Mesh(new THREE.BoxGeometry(14, 3, 0.3), new THREE.MeshStandardMaterial({ color: 0xf1f0ec, roughness: 0.9 }));
wall.position.set(0, 1.5, -5.15);
const desk = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.75, 0.8), new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.6 }));
desk.position.set(-3, 0.375, -4.4);
const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.05, 0.06), new THREE.MeshStandardMaterial({ color: 0x383e42, roughness: 0.55, metalness: 0.25 }));
door.position.set(3.2, 1.03, -5.0);
scene.add(floor, wall, desk, door);

// mundo mínimo para Fx
const world = {
  cam: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
  player: { id: 1 },
  projectiles: [] as unknown[],
  order: { kind: 'follow', x: 0, y: 0, targetId: -1 },
  entities: [], pickups: [], time: 0,
  entityById: () => undefined,
  level: { version: 0 },
} as unknown as IWorld;

const fx = new Fx();
scene.add(fx.group);
(fx as unknown as { setHighQuality(on: boolean): void }).setHighQuality(true);
const q0 = new URLSearchParams(location.search).get('quality');
let quality: 'low' | 'medium' | 'high' = q0 === 'low' || q0 === 'medium' ? q0 : 'high';
fx.setDecalQuality(quality);

const ev = (e: GameEvent[]): void => fx.handle(e, world);
const shot = (kind: string, from: [number, number, number], to: [number, number, number], surface: string, extra: Partial<{ weapon: string; nx: number; ny: number; hit: string }> = {}): GameEvent =>
  ({ type: 'shot', id: kind === 'captain' ? 1 : 2, kind, team: kind === 'captain' ? 'ally' : 'enemy', fx: from[0], fy: from[1], fz: from[2], tx: to[0], ty: to[1], tz: to[2],
    hit: extra.hit ?? (surface === 'body' ? 'entity' : 'wall'), surface, nx: extra.nx ?? 0, ny: extra.ny ?? 1, weapon: extra.weapon }) as unknown as GameEvent;

// coordenadas de la simulación: x, y(=z de three) y altura z(=y de three); la pared está en y = -5
function explosion(radius: number, x = 0, y = -2): void {
  ev([{ type: 'explosion', x, y, z: 0.6, radius } as GameEvent]);
}
let burstTimer = 0;
function rafaga(kind: string, n = 30, weapon?: string): void {
  let i = 0;
  const t = setInterval(() => {
    const spread = (Math.random() - 0.5) * 3.2;
    ev([shot(kind, [0, 4, 1.35], [spread, -5, 1.0 + Math.random() * 1.4], 'wall', { weapon, nx: 0, ny: 1 })]);
    if (++i >= n) clearInterval(t);
  }, kind === 'enemy1' ? 220 : 85);
  burstTimer = Number(t);
}
function impactos(): void {
  ev([
    shot('captain', [0, 4, 1.4], [-1, -5, 1.6], 'wall'),
    shot('captain', [0, 4, 1.4], [-3, -4.8, 0.6], 'furniture', { nx: 0, ny: 1 }),
    shot('captain', [0, 4, 1.4], [3.2, -4.97, 1.2], 'door', { nx: 0, ny: 1 }),
    shot('captain', [0, 4, 1.4], [1.5, -1, 0], 'floor'),
    shot('captain', [0, 4, 1.4], [0, 0, 1.2], 'body', { hit: 'entity', nx: 0, ny: 1 }),
  ]);
}
function cohete(): void {
  const p = { id: 7, kind: 'rocket', ownerId: 2, team: 'enemy', x: 0, y: 4, z: 1.4, vx: 0, vy: -24, vz: 0, fuse: 0, dead: false };
  (world.projectiles as unknown[]).push(p);
  const t = setInterval(() => {
    p.y += p.vy * 0.016;
    if (p.y <= -4.7) { clearInterval(t); p.dead = true; (world.projectiles as unknown[]).length = 0; explosion(3.2, 0, -4.4); }
  }, 16);
}

const barra = document.getElementById('barra')!;
const boton = (txt: string, f: () => void): void => { const b = document.createElement('button'); b.textContent = txt; b.onclick = f; barra.appendChild(b); };
boton('Explosión (granada, r=2,5)', () => explosion(2.5));
boton('Explosión grande (cohete, r=4)', () => explosion(4, 0, -3.5));
boton('Ráfaga (fusil)', () => rafaga('captain'));
boton('Ráfaga (subfusil)', () => rafaga('technic'));
boton('Pistola', () => rafaga('enemy1', 8));
boton('Ráfaga (secundaria)', () => rafaga('captain', 12, 'secondary'));
boton('Impactos (pared, mueble, puerta, suelo, cuerpo)', impactos);
boton('Cohete', cohete);
boton('Limpiar', () => { fx.clear(); });
const sel = (opts: string[], val: string, f: (v: string) => void): void => {
  const s = document.createElement('select');
  for (const o of opts) { const op = document.createElement('option'); op.value = o; op.textContent = o; if (o === val) op.selected = true; s.appendChild(op); }
  s.onchange = () => f(s.value); barra.appendChild(s);
};
sel(['realista', 'comic'], getStyleMode(), (v) => { setStyleMode(v as 'realista' | 'comic'); fx.clear(); });
sel(['high', 'medium', 'low'], quality, (v) => { quality = v as typeof quality; fx.setDecalQuality(quality); (fx as unknown as { setHighQuality(on: boolean): void }).setHighQuality(quality === 'high'); });

function resize(): void {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

let last = performance.now();
function loop(now: number): void {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  world.time += dt;
  // la cámara del mundo sigue a la de la vista (convención: x = x, y = z de three, z = altura)
  (world.cam as { x: number; y: number; z: number }).x = camera.position.x;
  (world.cam as { x: number; y: number; z: number }).y = camera.position.z;
  (world.cam as { x: number; y: number; z: number }).z = camera.position.y;
  controls.update();
  fx.update(dt, world, world.time, camera);
  // sacudida (si el juego la aplicara): pequeña vibración de la cámara para ver su intensidad
  const sh = fx.shake;
  const off = sh > 0 ? new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh) : null;
  if (off) camera.position.add(off);
  renderer.render(scene, camera);
  if (off) camera.position.sub(off);
}
void burstTimer;
requestAnimationFrame(loop);
