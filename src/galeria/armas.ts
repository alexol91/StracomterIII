// Vista «Armas» (solo desarrollo): abre /armas.html con `npm run dev`. Todas las armas en uso en fila, a tamaño real,
// con los materiales PBR del juego y el HDRI de la oficina sobre fondo neutro.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUN_LEN, sharedRbLibrary } from '../render/rbchars';
import { loadEnvironment } from '../render/pbr';

const NAMES = ['AK', 'SMG', 'ShortCannon', 'Shotgun', 'Sniper', 'Sniper_2', 'RocketLauncher', 'GrenadeLauncher', 'Pistol', 'Knife_1', 'Grenade'];

const canvas = document.getElementById('lienzo') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7a7f88);
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
camera.position.set(0.6, 0.55, 4.2);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0.6, -0.1, 0);
controls.update();
const sun = new THREE.DirectionalLight(0xfff0dc, 2.2); sun.position.set(-2, 3, 3); scene.add(sun);
void loadEnvironment(renderer, 'unfinished_office_1k').then((env) => { if (env) { scene.environment = env; scene.environmentIntensity = 1.0; } });

const labels: { el: HTMLDivElement; pos: THREE.Vector3 }[] = [];
const lib = sharedRbLibrary;
for (const n of NAMES) lib.needGun(n);

function build(): void {
  const mats = lib.gunMaterial();
  // dos filas: armas largas arriba, cortas abajo
  const rows: string[][] = [NAMES.slice(0, 8), NAMES.slice(8)];
  rows.forEach((row, ri) => {
    let x = 0;
    for (const n of row) {
      const g = lib.gunGeo(n);
      if (!g) continue;
      const len = GUN_LEN[n] ?? 0.8;
      const mesh = new THREE.Mesh(g.geo, mats);
      mesh.scale.setScalar(len / g.maxDim);
      mesh.rotation.y = Math.PI;                         // el cañón del pack apunta a -X: se gira para que mire a la derecha
      if (n === 'Knife_1') { mesh.rotation.y = 0; mesh.rotation.z = -Math.PI / 2; }   // el cuchillo es largo en Y
      mesh.position.set(x + len / 2, ri === 0 ? 0.5 : -0.5, 0);
      scene.add(mesh);
      const el = document.createElement('div'); el.className = 'et'; el.textContent = `${n} · ${len.toFixed(2)} m`; document.body.appendChild(el);
      labels.push({ el, pos: new THREE.Vector3(x + len / 2, (ri === 0 ? 0.5 : -0.5) - 0.28, 0) });
      x += len + 0.25;
    }
  });
}
let built = false;
function resize(): void { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

function loop(): void {
  requestAnimationFrame(loop);
  if (!built && NAMES.every((n) => lib.gunGeo(n))) { built = true; build(); }
  controls.update();
  renderer.render(scene, camera);
  for (const l of labels) {
    const p = l.pos.clone().project(camera);
    l.el.style.left = `${(p.x * 0.5 + 0.5) * innerWidth}px`; l.el.style.top = `${(-p.y * 0.5 + 0.5) * innerHeight}px`;
    l.el.style.display = p.z < 1 ? 'block' : 'none';
  }
}
requestAnimationFrame(loop);
