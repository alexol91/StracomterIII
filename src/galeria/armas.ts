// Vista «Armas» (solo desarrollo): abre /armas.html con `npm run dev`.
//  - Armas: las 8 nuevas (TastyTony) arriba y las del pack anterior debajo, a tamaño real, con los materiales PBR del juego.
//  - Operador: un soldado en pose de apuntado con el arma elegida en la mano (selector) para revisar los agarres.
//    Con ?armas=1 se puede ajustar el agarre en vivo: __armas.set('M4A1', { pos: [x, y, z], rot: [gx, gy, gz], scale: 1 }).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GUN_LEN, TASTY, applyGrip, registerGun, sharedRbLibrary, type GunEntry } from '../render/rbchars';
import { loadEnvironment } from '../render/pbr';

const NEW = Object.keys(TASTY);
const OLD = ['AK', 'SMG', 'ShortCannon', 'Shotgun', 'Sniper', 'Sniper_2', 'RocketLauncher', 'GrenadeLauncher', 'Pistol', 'Knife_1', 'Grenade'];
const NAMES = [...NEW, ...OLD];

const canvas = document.getElementById('lienzo') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7a7f88);
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 60);
const controls = new OrbitControls(camera, canvas);
const sun = new THREE.DirectionalLight(0xfff0dc, 2.2); sun.position.set(-2, 3, 3); scene.add(sun);
void loadEnvironment(renderer, 'unfinished_office_1k').then((env) => { if (env) { scene.environment = env; scene.environmentIntensity = 1.0; } });

const labels: { el: HTMLDivElement; pos: THREE.Vector3; group: 'armas' }[] = [];
const lib = sharedRbLibrary;
for (const n of NAMES) lib.needGun(n);
// las plantillas de operador (con las armas ya calibradas a la pose de apuntado) se construyen al cargar todo
void lib.ensure(['captain', 'technic', 'especialist', 'explosives']).then(() => lib.build(false, true));
lib.onChange = () => { if (lib.loaded && lib.templates.size < 4) lib.build(false, true); };

const armasGroup = new THREE.Group(); scene.add(armasGroup);
const opGroup = new THREE.Group(); opGroup.visible = false; scene.add(opGroup);

function build(): void {
  const mats = lib.gunMaterial();
  // tres filas: nuevas arriba, antiguas largas en medio y antiguas cortas abajo (para comparar)
  const rows: { names: string[]; y: number }[] = [{ names: NEW, y: 1.15 }, { names: OLD.slice(0, 8), y: 0.05 }, { names: OLD.slice(8), y: -1.0 }];
  for (const row of rows) {
    let x = 0;
    for (const n of row.names) {
      const g = lib.gunGeo(n);
      if (!g) continue;
      const len = GUN_LEN[n] ?? 0.8;
      const mesh = new THREE.Mesh(g.geo, mats);
      mesh.scale.setScalar(len / g.maxDim);
      mesh.rotation.y = Math.PI;                         // el cañón apunta a -X: se gira para que mire a la derecha
      if (n === 'Knife_1') { mesh.rotation.y = 0; mesh.rotation.z = -Math.PI / 2; }   // el cuchillo es largo en Y
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
      mesh.position.set(x + sz.x / 2 - c.x, row.y - c.y, -c.z);
      armasGroup.add(mesh);
      const nuevo = NEW.includes(n);
      const el = document.createElement('div'); el.className = 'et'; el.textContent = `${n}${nuevo ? ' *' : ''} · ${sz.x.toFixed(2)} m`; document.body.appendChild(el);
      labels.push({ el, pos: new THREE.Vector3(x + sz.x / 2, row.y - Math.max(0.2, sz.y / 2 + 0.1), 0), group: 'armas' });
      x += sz.x + 0.28;
    }
  }
}

// ───────────── Vista del operador ─────────────
// Un soldado por arma, en la pose que usa el juego (apuntando con Pistol_Aim_Neutral; cuchillo y granada con el brazo bajado),
// congelada en un instante fijo: se aplica el clip y se actualiza el mezclador una sola vez, sin depender de que avance la animación.
// Cuatro bandas: lateral (desde la derecha del soldado) y tres cuartos frontal, cada una en dos filas.
interface Op { kind: 'captain' | 'technic' | 'especialist' | 'explosives'; weapon: string; aim: boolean }
const OPS: Op[] = [
  { kind: 'captain', weapon: 'M4A1', aim: true }, { kind: 'technic', weapon: 'MP5', aim: true }, { kind: 'especialist', weapon: 'M249', aim: true },
  { kind: 'explosives', weapon: 'MGL', aim: true }, { kind: 'technic', weapon: 'REM870', aim: true }, { kind: 'especialist', weapon: 'SVD', aim: true },
  { kind: 'captain', weapon: 'M1911', aim: true }, { kind: 'captain', weapon: 'M67', aim: false }, { kind: 'captain', weapon: 'Knife_1', aim: false },
];
const FREEZE_T = 0.3;                // segundo del clip en que se congela la pose
const SPACING = 8;                   // separación entre soldados (m): ninguno entra en el encuadre de otro
const unreg: (() => void)[] = [];
let opBuilt = false;
const opLabels: { el: HTMLDivElement; text: string }[] = [];

function buildOperators(): void {
  for (const u of unreg) u();
  unreg.length = 0;
  for (const c of [...opGroup.children]) opGroup.remove(c);
  OPS.forEach((op, i) => {
    const tpl = lib.templates.get(op.kind);
    const g = lib.gunGeo(op.weapon);
    if (!tpl || !g) return;
    const inner = SkeletonUtils.clone(tpl.holder);
    inner.traverse((o) => { if (o.name.startsWith('arma')) o.visible = false; if ((o as THREE.Mesh).isMesh) o.frustumCulled = false; });
    const hand = inner.getObjectByName('Bip01_R_Hand');
    if (hand) {
      const m = new THREE.Mesh(g.geo, lib.gunMaterial());
      m.frustumCulled = false; hand.add(m);
      const entry: GunEntry = { mesh: m, weapon: op.weapon, k: 1 / inner.scale.y, maxDim: g.maxDim, len: g.len };
      applyGrip(entry); unreg.push(registerGun(entry));
    }
    const root = new THREE.Group(); root.add(inner);
    root.rotation.y = Math.PI / 2;                       // mira hacia +X (yaw 0 del juego)
    root.position.set(i * SPACING, 0, 0);
    const mixer = new THREE.AnimationMixer(inner);
    const legs = tpl.layerClip('Pistol_Idle_Loop', 'legs'), torso = tpl.layerClip(op.aim ? 'Pistol_Aim_Neutral' : 'Pistol_Idle_Loop', 'torso');
    for (const c of [legs, torso]) if (c) { const a = mixer.clipAction(c); a.play(); a.time = FREEZE_T; }
    mixer.update(0);                                     // una sola actualización: pose congelada
    root.updateMatrixWorld(true);
    opGroup.add(root);
  });
  opBuilt = opGroup.children.length === OPS.length;
}

const COLS = 5;
const VIEWS = ['LATERAL (desde la derecha)', 'TRES CUARTOS frontal'];
function cells(): { x: number; y: number; w: number; h: number; op: number; view: number }[] {
  const rowsPerView = Math.ceil(OPS.length / COLS), rows = rowsPerView * VIEWS.length;
  const w = innerWidth / COLS, h = innerHeight / rows, out: { x: number; y: number; w: number; h: number; op: number; view: number }[] = [];
  for (let v = 0; v < VIEWS.length; v++) for (let i = 0; i < OPS.length; i++) {
    const r = v * rowsPerView + Math.floor(i / COLS), c = i % COLS;
    out.push({ x: c * w, y: r * h, w, h, op: i, view: v });
  }
  return out;
}
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
function renderOperators(): void {
  const cs = cells();
  if (!opLabels.length) for (const c of cs) { const el = document.createElement('div'); el.className = 'et'; document.body.appendChild(el); opLabels.push({ el, text: '' }); }
  renderer.setScissorTest(true);
  cs.forEach((c, k) => {
    const op = OPS[c.op], cx = c.op * SPACING;
    const hh = 1.2, ww = hh * (c.w / c.h);               // cuerpo entero: de -0,2 a 2,2 m
    ortho.left = -ww; ortho.right = ww; ortho.top = hh; ortho.bottom = -hh; ortho.updateProjectionMatrix();
    if (c.view === 0) { ortho.position.set(cx + 0.25, 1.0, 20); ortho.up.set(0, 1, 0); ortho.lookAt(cx + 0.25, 1.0, 0); }
    else { ortho.position.set(cx + 0.3 + 14, 1.0 + 6, 14); ortho.up.set(0, 1, 0); ortho.lookAt(cx + 0.3, 1.0, 0); }
    const yy = innerHeight - c.y - c.h;
    renderer.setViewport(c.x, yy, c.w, c.h); renderer.setScissor(c.x, yy, c.w, c.h);
    renderer.render(scene, ortho);
    const l = opLabels[k];
    const t = `${op.weapon} · ${VIEWS[c.view]}`;
    if (l.text !== t) { l.text = t; l.el.textContent = t; }
    l.el.style.left = `${c.x + c.w / 2}px`; l.el.style.top = `${c.y + 4}px`; l.el.style.display = 'block';
  });
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
}

function setMode(m: 'armas' | 'operador'): void {
  armasGroup.visible = m === 'armas'; opGroup.visible = m === 'operador';
  for (const l of labels) l.el.style.display = 'none';
  for (const l of opLabels) l.el.style.display = 'none';
  document.body.dataset.modo = m;
  mode = m;
  if (m === 'armas') { camera.position.set(3.4, 0.2, 9.5); controls.target.set(3.4, 0.1, 0); controls.enabled = true; controls.update(); }
  else controls.enabled = false;
}
let mode: 'armas' | 'operador' = 'armas';
(document.getElementById('modoArmas') as HTMLElement | null)?.addEventListener('click', () => setMode('armas'));
(document.getElementById('modoOp') as HTMLElement | null)?.addEventListener('click', () => setMode('operador'));
if (new URLSearchParams(location.search).get('vista') === 'operador') setMode('operador');
// ?armas=1: tras un set() de agarre hay que reponer la pose; se hace al pulsar «Reponer»
(document.getElementById('repon') as HTMLElement | null)?.addEventListener('click', () => { opBuilt = false; });

let built = false;
function resize(): void { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
setMode(mode);

function loop(): void {
  requestAnimationFrame(loop);
  if (!built && NAMES.every((n) => lib.gunGeo(n))) { built = true; build(); }
  if (mode === 'operador') {
    if (!opBuilt && lib.templates.size >= 4 && OPS.every((o) => lib.gunGeo(o.weapon)) && lib.ual) buildOperators();
    if (opBuilt) renderOperators();
    else renderer.render(new THREE.Scene(), camera);
    return;
  }
  controls.update();
  renderer.render(scene, camera);
  for (const l of labels) {
    const p = l.pos.clone().project(camera);
    l.el.style.left = `${(p.x * 0.5 + 0.5) * innerWidth}px`; l.el.style.top = `${(-p.y * 0.5 + 0.5) * innerHeight}px`;
    l.el.style.display = p.z < 1 ? 'block' : 'none';
  }
}
requestAnimationFrame(loop);
