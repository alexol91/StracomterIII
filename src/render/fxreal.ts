// Efectos del estilo realista: sprites suaves con textura generada por canvas (degradados radiales y ruido),
// sin geometría facetada. Dos sistemas de partículas instanciadas orientadas a la cámara:
//  · aditivo (llamas, destellos, chispas, resplandor) — colores HDR moderados para no quemar a blanco plano;
//  · con alfa (humo, polvo, sangre) — sin escribir profundidad y ordenado de atrás hacia delante.
// Más trazadoras finas que viajan, y un anillo de onda a ras de suelo.
// El cómic no usa nada de esto (sigue con fx.ts).

import * as THREE from 'three';

type RGB = [number, number, number];

export interface SpriteSpec {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  life: number;
  s0: number; s1: number;
  rot?: number; rotV?: number;
  /** celda del atlas: 0 resplandor, 1-2 humo, 3-5 llama, 6 trazadora */
  cell: number;
  c0: RGB; c1?: RGB;
  a0?: number; a1?: number;
  grav?: number; drag?: number;
  /** chispa: deja un rastro corto de resplandores */
  trail?: boolean;
  /** fracción inicial de la vida en que el alfa sube desde 0 (entrada suave) */
  aIn?: number;
  /** fracción de la vida con alfa constante antes de desvanecerse (0 = lineal a1) */
  aHold?: number;
}

const CELLS = 8;

/** Atlas de 8 celdas de 128 px: resplandor, 2 humos, 3 llamas irregulares, trazadora, anillo. */
function makeAtlas(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas'); c.width = S * CELLS; c.height = S;
  const g = c.getContext('2d')!;
  let seed = 4242;
  const r = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const cell = (i: number, f: () => void): void => { g.save(); g.translate(i * S + S / 2, S / 2); f(); g.restore(); };
  const radial = (rad: number, stops: [number, string][]): CanvasGradient => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rad);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    return gr;
  };
  // 0: resplandor suave
  cell(0, () => {
    g.fillStyle = radial(S / 2, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.65)'], [0.6, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(-S / 2, -S / 2, S, S);
  });
  // 1, 2: humo (manchas superpuestas, borde difuminado)
  for (const i of [1, 2]) cell(i, () => {
    for (let k = 0; k < 16; k++) {
      const a = r() * 6.28, d = r() * S * 0.22, rad = S * (0.12 + r() * 0.16);
      g.save(); g.translate(Math.cos(a) * d, Math.sin(a) * d);
      g.fillStyle = radial(rad, [[0, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
      g.fillRect(-rad, -rad, rad * 2, rad * 2); g.restore();
    }
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = radial(S / 2, [[0, 'rgba(0,0,0,1)'], [0.6, 'rgba(0,0,0,0.85)'], [1, 'rgba(0,0,0,0)']]);
    g.fillRect(-S / 2, -S / 2, S, S);
    g.globalCompositeOperation = 'source-over';
  });
  // 3-5: llamas estrelladas irregulares
  for (const i of [3, 4, 5]) cell(i, () => {
    const n = 6 + Math.floor(r() * 4);
    g.beginPath();
    for (let k = 0; k < n * 2; k++) {
      const a = (k / (n * 2)) * Math.PI * 2 + r() * 0.25;
      const rad = (k % 2 ? 0.13 + r() * 0.08 : 0.28 + r() * 0.2) * S;
      g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    g.closePath();
    g.fillStyle = radial(S * 0.5, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0.05)']]);
    g.filter = 'blur(2.5px)';
    g.fill();
    g.filter = 'none';
    g.fillStyle = radial(S * 0.22, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(-S / 2, -S / 2, S, S);
  });
  // 6: trazadora (degradado a lo largo; cola a la izquierda, cabeza a la derecha)
  cell(6, () => {
    const gx = g.createLinearGradient(-S / 2, 0, S / 2, 0);
    gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(0.75, 'rgba(255,255,255,0.7)'); gx.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gx; g.fillRect(-S / 2, -8, S, 16);
  });
  // 7: anillo suave
  cell(7, () => {
    g.fillStyle = radial(S / 2, [[0, 'rgba(255,255,255,0)'], [0.7, 'rgba(255,255,255,0)'], [0.86, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(-S / 2, -S / 2, S, S);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const VERT = /* glsl */ `
attribute vec3 iPos; attribute float iSize; attribute float iRot; attribute vec4 iColor; attribute float iCell;
varying vec2 vUv; varying vec4 vColor;
void main() {
  float depth = -(viewMatrix * vec4(iPos, 1.0)).z;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(iRot), s = sin(iRot);
  vec2 p = position.xy;
  vec2 q = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  vec3 w = iPos + (right * q.x + up * q.y) * iSize;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  vUv = vec2((uv.x + iCell) / ${CELLS}.0, uv.y);
  vColor = vec4(iColor.rgb, iColor.a * smoothstep(0.12, 0.45, depth));   // los sprites pegados a la cámara se desvanecen
}`;
const FRAG = /* glsl */ `
uniform sampler2D uMap; varying vec2 vUv; varying vec4 vColor;
void main() {
  float a = texture2D(uMap, vUv).a * vColor.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Partículas instanciadas con billboard en el sombreador. */
class Sprites {
  mesh: THREE.InstancedMesh;
  private geo: THREE.PlaneGeometry;
  private mat: THREE.ShaderMaterial;
  private cap: number;
  private pos: Float32Array; private vel: Float32Array;
  private life: Float32Array; private maxLife: Float32Array;
  private s0: Float32Array; private s1: Float32Array; private rot: Float32Array; private rotV: Float32Array;
  private cell: Float32Array; private c0: Float32Array; private c1: Float32Array; private a0: Float32Array; private a1: Float32Array;
  private grav: Float32Array; private drag: Float32Array; private trail: Uint8Array; private aIn: Float32Array; private aHold: Float32Array;
  private aPos: THREE.InstancedBufferAttribute; private aSize: THREE.InstancedBufferAttribute; private aRot: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute; private aCell: THREE.InstancedBufferAttribute;
  private next = 0;
  private order: number[] = [];
  private dist: Float32Array;
  /** chispas que piden un rastro este frame */
  pendingTrail: number[] = [];

  constructor(cap: number, atlas: THREE.Texture, private additive: boolean) {
    this.cap = cap;
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.pos = new Float32Array(cap * 3); this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap); this.maxLife = new Float32Array(cap).fill(1);
    this.s0 = new Float32Array(cap); this.s1 = new Float32Array(cap); this.rot = new Float32Array(cap); this.rotV = new Float32Array(cap);
    this.cell = new Float32Array(cap); this.c0 = new Float32Array(cap * 3); this.c1 = new Float32Array(cap * 3);
    this.a0 = new Float32Array(cap); this.a1 = new Float32Array(cap);
    this.grav = new Float32Array(cap); this.drag = new Float32Array(cap); this.trail = new Uint8Array(cap); this.aIn = new Float32Array(cap); this.aHold = new Float32Array(cap);
    this.dist = new Float32Array(cap);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aCell = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.aPos); this.geo.setAttribute('iSize', this.aSize); this.geo.setAttribute('iRot', this.aRot);
    this.geo.setAttribute('iColor', this.aColor); this.geo.setAttribute('iCell', this.aCell);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { uMap: { value: atlas } },
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, cap);
    // el InstancedMesh solo se usa para dibujar con instancias; la posición va en iPos
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.renderOrder = additive ? 9 : 8;
  }

  spawn(o: SpriteSpec): number {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.pos[i * 3] = o.x; this.pos[i * 3 + 1] = o.y; this.pos[i * 3 + 2] = o.z;
    this.vel[i * 3] = o.vx ?? 0; this.vel[i * 3 + 1] = o.vy ?? 0; this.vel[i * 3 + 2] = o.vz ?? 0;
    this.life[i] = o.life; this.maxLife[i] = o.life;
    this.s0[i] = o.s0; this.s1[i] = o.s1; this.rot[i] = o.rot ?? Math.random() * 6.28; this.rotV[i] = o.rotV ?? 0;
    this.cell[i] = o.cell;
    const c1 = o.c1 ?? o.c0;
    this.c0[i * 3] = o.c0[0]; this.c0[i * 3 + 1] = o.c0[1]; this.c0[i * 3 + 2] = o.c0[2];
    this.c1[i * 3] = c1[0]; this.c1[i * 3 + 1] = c1[1]; this.c1[i * 3 + 2] = c1[2];
    this.a0[i] = o.a0 ?? 1; this.a1[i] = o.a1 ?? 0;
    this.grav[i] = o.grav ?? 0; this.drag[i] = o.drag ?? 0; this.trail[i] = o.trail ? 1 : 0; this.aIn[i] = o.aIn ?? 0; this.aHold[i] = o.aHold ?? 0;
    return i;
  }

  clear(): void { this.life.fill(0); this.mesh.count = 0; }

  update(dt: number, cam: THREE.Vector3): void {
    let m = 0;
    this.pendingTrail.length = 0;
    const idx = this.order; idx.length = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      const i3 = i * 3;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= dr; this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.grav[i] * dt; this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.02 && this.grav[i] > 0) { this.pos[i3 + 1] = 0.02; this.vel[i3 + 1] *= -0.3; this.vel[i3] *= 0.6; this.vel[i3 + 2] *= 0.6; }
      this.rot[i] += this.rotV[i] * dt;
      if (this.trail[i] && Math.random() < 0.6) this.pendingTrail.push(i);
      if (!this.additive) {
        const dx = this.pos[i3] - cam.x, dy = this.pos[i3 + 1] - cam.y, dz = this.pos[i3 + 2] - cam.z;
        this.dist[i] = dx * dx + dy * dy + dz * dz;
      }
      idx.push(i);
    }
    if (!this.additive) idx.sort((a, b) => this.dist[b] - this.dist[a]);     // de atrás hacia delante
    for (const i of idx) {
      const t = 1 - this.life[i] / this.maxLife[i];
      const e = 1 - (1 - t) * (1 - t);                 // los tamaños se expanden rápido y luego se frenan
      const i3 = i * 3, k4 = m * 4;
      this.aPos.array[m * 3] = this.pos[i3]; this.aPos.array[m * 3 + 1] = this.pos[i3 + 1]; this.aPos.array[m * 3 + 2] = this.pos[i3 + 2];
      this.aSize.array[m] = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
      this.aRot.array[m] = this.rot[i];
      this.aCell.array[m] = this.cell[i];
      this.aColor.array[k4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      this.aColor.array[k4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      this.aColor.array[k4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      const tt = this.aHold[i] > 0 ? Math.max(0, (t - this.aHold[i]) / (1 - this.aHold[i])) : t;
      this.aColor.array[k4 + 3] = (this.a0[i] + (this.a1[i] - this.a0[i]) * tt) * (this.aIn[i] > 0 ? Math.min(1, t / this.aIn[i]) : 1);
      m++;
    }
    this.mesh.count = m;
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aRot.needsUpdate = this.aColor.needsUpdate = this.aCell.needsUpdate = true;
  }

  trailPos(i: number, out: THREE.Vector3): void { out.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]); }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); this.mesh.dispose(); }
}

const rr = (a: number, b: number): number => a + Math.random() * (b - a);
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3();

/** Tamaño relativo del fogonazo según el arma (quien dispara y la ranura). */
export function muzzleSizeFor(kind: string, weapon?: string): number {
  if (weapon === 'secondary' || kind === 'enemy1') return 0.22;          // pistola
  if (kind === 'explosives' || kind === 'miniboss') return 0.8;           // lanzador
  if (kind === 'especialist' || kind === 'enemy3' || kind === 'megaboss') return 0.5;
  if (kind === 'technic' || kind === 'enemy2') return 0.33;               // subfusil
  return 0.4;                                                             // fusil
}

interface Tracer { mesh: THREE.Mesh; age: number; ax: number; ay: number; az: number; dx: number; dy: number; dz: number; len: number; active: boolean }
interface Ring { mesh: THREE.Mesh; t: number; r: number }

export class RealFx {
  group = new THREE.Group();
  private atlas: THREE.CanvasTexture;
  private add: Sprites;
  private alpha: Sprites;
  /** pool propio del humo táctico: una explosión no se lo quita */
  private smoke: Sprites;
  private smokeLives = new Map<number, number[]>();
  private tracers: Tracer[] = [];
  private tracerMat: THREE.MeshBasicMaterial;
  private tracerTex: THREE.CanvasTexture;
  private tracerGeo = new THREE.PlaneGeometry(1, 1);
  private rings: Ring[] = [];
  private ringTex: THREE.CanvasTexture;
  private ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private factor = 1;
  /** escala de los destellos (reducir destellos: ~0,35) */
  flashK = 1;
  private autoCount = new Map<number, number>();
  private shotCount = 0;

  constructor() {
    this.atlas = makeAtlas();
    this.add = new Sprites(700, this.atlas, true);
    this.alpha = new Sprites(420, this.atlas, false);
    this.smoke = new Sprites(240, this.atlas, false);
    this.group.add(this.add.mesh, this.alpha.mesh, this.smoke.mesh);
    // trazadoras finas: segmento corto que viaja
    const c = document.createElement('canvas'); c.width = 64; c.height = 16;
    const g = c.getContext('2d')!;
    const gx = g.createLinearGradient(0, 0, 64, 0);
    gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(0.7, 'rgba(255,255,255,0.6)'); gx.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gx; g.fillRect(0, 0, 64, 16);
    g.globalCompositeOperation = 'destination-in';
    const gy = g.createLinearGradient(0, 0, 0, 16);
    gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(0.5, 'rgba(0,0,0,1)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gy; g.fillRect(0, 0, 64, 16);
    this.tracerTex = new THREE.CanvasTexture(c);
    this.tracerMat = new THREE.MeshBasicMaterial({ map: this.tracerTex, color: new THREE.Color(1.5, 1.3, 0.85), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat);
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 10;
      this.group.add(mesh);
      this.tracers.push({ mesh, age: 0, ax: 0, ay: 0, az: 0, dx: 0, dy: 0, dz: 0, len: 0, active: false });
    }
    // anillo de onda (suelo)
    const rc = document.createElement('canvas'); rc.width = rc.height = 128;
    const rg = rc.getContext('2d')!;
    const grad = rg.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.72, 'rgba(255,255,255,0)'); grad.addColorStop(0.88, 'rgba(255,255,255,0.7)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    rg.fillStyle = grad; rg.fillRect(0, 0, 128, 128);
    this.ringTex = new THREE.CanvasTexture(rc);
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ map: this.ringTex, color: new THREE.Color(0.8, 0.65, 0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 7;
      this.group.add(mesh);
      this.rings.push({ mesh, t: 0, r: 1 });
    }
  }

  /** Cantidad de sprites según la calidad: 1 en alta, la mitad en media, lo mínimo en baja. */
  setQuality(q: 'low' | 'medium' | 'high'): void { this.factor = q === 'high' ? 1 : q === 'medium' ? 0.5 : 0.25; }

  clear(): void {
    this.add.clear(); this.alpha.clear(); this.smoke.clear();
    for (const t of this.tracers) { t.active = false; t.mesh.visible = false; }
    for (const r of this.rings) { r.t = 0; r.mesh.visible = false; }
    this.autoCount.clear();
    this.smokeAcc.clear(); this.smokeLives.clear();
  }

  private n(base: number, min = 2): number { return Math.max(min, Math.round(base * this.factor)); }

  // ───────────────────────── Disparo ─────────────────────────

  /** Fogonazo, trazadora y volutas. (ax,ay,az) = boca del arma, d = dirección unitaria, len = distancia al impacto (coordenadas three). */
  muzzle(ax: number, ay: number, az: number, dx: number, dy: number, dz: number, len: number, size: number, isPlayer: boolean, alwaysTrace: boolean, shooterId: number): void {
    // fogonazo: 2-3 llamas irregulares con giro aleatorio, 30-50 ms; en el arma del jugador, pequeño y adelantado para no tapar la mira
    const s = size * (isPlayer ? 0.45 : 1);
    const off = isPlayer ? 0.35 : 0.12;
    const px = ax + dx * off, py = ay + dy * off, pz = az + dz * off;
    const nflames = size > 0.6 ? 3 : 2;
    for (let i = 0; i < nflames; i++) {
      this.add.spawn({ x: px, y: py, z: pz, life: rr(0.03, 0.05), s0: s * rr(0.8, 1.2), s1: s * rr(1.0, 1.5), cell: 3 + Math.floor(Math.random() * 3), c0: [2.0, 1.45, 0.7], c1: [1.2, 0.6, 0.2], a0: this.flashK, a1: 0.2 * this.flashK });
    }
    this.add.spawn({ x: px, y: py, z: pz, life: 0.03, s0: s * 1.1, s1: s * 1.4, cell: 0, c0: [1.6, 1.3, 0.8], a0: 0.8 * this.flashK, a1: 0 });
    // voluta de humo tenue cada 2-3 disparos en automático
    this.shotCount++;
    if (this.shotCount % 3 === 0 && !isPlayer) {
      this.alpha.spawn({ x: px, y: py, z: pz, vx: dx * 0.3, vy: 0.55, vz: dz * 0.3, life: 0.4, s0: s * 0.35, s1: s * 1.1, cell: 1 + (this.shotCount & 1), c0: [0.5, 0.5, 0.52], a0: 0.12, a1: 0, drag: 1 });
    }
    // trazadora: siempre en pistola, 1 de cada 3 en automático
    let draw = alwaysTrace;
    if (!draw) { const c = (this.autoCount.get(shooterId) ?? 0) + 1; this.autoCount.set(shooterId, c); draw = c % 3 === 1; }
    if (draw) {
      const t = this.tracers.find((x) => !x.active);
      if (t) {
        t.active = true; t.age = 0; t.ax = ax; t.ay = ay; t.az = az; t.dx = dx; t.dy = dy; t.dz = dz; t.len = len;
        t.mesh.visible = true;
      }
    }
  }

  /** Impacto de bala: chispas breves y polvo difuso según la superficie; n = normal hacia fuera (three). */
  impact(surface: string, x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
    const spark = (count: number, col: RGB): void => {
      for (let i = 0; i < this.n(count, 1); i++) {
        const sp = rr(1.5, 3.8);
        this.add.spawn({ x, y, z, vx: nx * sp + rr(-1.2, 1.2), vy: ny * sp + rr(0.2, 1.6), vz: nz * sp + rr(-1.2, 1.2), life: rr(0.18, 0.32), s0: 0.04, s1: 0.012, cell: 0, c0: col, c1: [col[0] * 0.5, col[1] * 0.3, col[2] * 0.15], grav: 6 });
      }
    };
    const dust = (col: RGB, a: number, size: number, life: number): void => {
      this.alpha.spawn({ x, y, z, vx: nx * 0.6, vy: ny * 0.6 + 0.25, vz: nz * 0.6, life, s0: size * 0.25, s1: size, cell: 1 + Math.floor(Math.random() * 2), c0: col, c1: col, a0: a, a1: 0, drag: 2.5 });
    };
    switch (surface) {
      case 'wall': spark(3, [2.0, 1.5, 0.7]); dust([0.72, 0.71, 0.68], 0.3, 0.42, 0.6); break;
      case 'furniture': spark(2, [1.8, 1.3, 0.6]); dust([0.5, 0.38, 0.25], 0.3, 0.34, 0.55); break;
      case 'door': spark(4, [1.6, 1.8, 2.0]); dust([0.6, 0.62, 0.64], 0.15, 0.25, 0.4); break;
      case 'floor': dust([0.5, 0.47, 0.42], 0.3, 0.4, 0.6); spark(2, [1.8, 1.3, 0.6]); break;
      case 'body': dust([0.3, 0.03, 0.03], 0.5, 0.36, 0.35); break;
      default: break;
    }
  }

  // ───────────────────────── Explosión ─────────────────────────

  explosion(x: number, y: number, z: number, radius: number): number {
    const R = Math.max(0.8, radius);
    // (a) destello blanco-amarillo de 2 frames
    this.add.spawn({ x, y, z, life: 0.033, s0: R * 2.0, s1: R * 2.8, cell: 0, c0: [2.0, 1.6, 1.0], a0: 1, a1: 0.6 });
    this.add.spawn({ x, y, z, life: 0.05, s0: R * 1.6, s1: R * 2.4, cell: 3, c0: [1.9, 1.4, 0.7], a0: 1, a1: 0 });
    // (b) bola de fuego: sprites suaves naranja → rojo oscuro que se expanden y se apagan
    for (let i = 0, n = this.n(rr(8, 14), 3); i < n; i++) {
      const dir = _v.set(rr(-1, 1), rr(-0.2, 1), rr(-1, 1)).normalize();
      const off = R * rr(0.05, 0.35);
      this.add.spawn({ x: x + dir.x * off, y: y + Math.max(0, dir.y * off), z: z + dir.z * off, vx: dir.x * R * rr(1.2, 3), vy: dir.y * R * rr(1.2, 3), vz: dir.z * R * rr(1.2, 3),
        life: rr(0.22, 0.36), s0: R * rr(0.5, 0.8), s1: R * rr(1.3, 1.9), cell: i % 3 === 0 ? 0 : 3 + (i % 3), c0: [1.9, 1.2, 0.45], c1: [0.55, 0.1, 0.03], a0: 1, a1: 0, rotV: rr(-2, 2), drag: 2 });
    }
    // (c) humo gris oscuro con alfa (no aditivo): sube, crece y se disipa en 2-2,5 s
    for (let i = 0, n = this.n(rr(10, 16), 3); i < n; i++) {
      const a = rr(0, 6.28), o = R * rr(0.1, 0.5);
      this.alpha.spawn({ x: x + Math.cos(a) * o, y: y + rr(0, R * 0.5), z: z + Math.sin(a) * o, vx: Math.cos(a) * rr(0.2, 0.9), vy: rr(1.0, 2.0), vz: Math.sin(a) * rr(0.2, 0.9),
        life: rr(2.0, 2.5), s0: R * rr(0.55, 0.8), s1: R * rr(1.8, 2.6), cell: 1 + (i & 1), c0: [0.09, 0.085, 0.08], c1: [0.26, 0.26, 0.27], a0: 0.85, a1: 0, rotV: rr(-0.4, 0.4), drag: 0.7 });
    }
    // (d) chispas incandescentes con gravedad y estela corta
    for (let i = 0, n = this.n(rr(15, 25), 4); i < n; i++) {
      const a = rr(0, 6.28), sp = rr(6, 14);
      this.add.spawn({ x, y: y + 0.2, z, vx: Math.cos(a) * sp, vy: rr(2, 9), vz: Math.sin(a) * sp, life: rr(0.5, 0.9), s0: 0.09, s1: 0.025, cell: 0, c0: [2.2, 1.5, 0.6], c1: [0.9, 0.25, 0.05], grav: 9, drag: 0.4, trail: true });
    }
    // (e) anillo de onda a ras de suelo, muy tenue, hasta el radio real en 0,2 s
    const ring = this.rings.find((r) => r.t <= 0) ?? this.rings[0];
    ring.t = 0.35; ring.r = R; ring.mesh.position.set(x, 0.05, z); ring.mesh.visible = true;
    // (f) polvo levantado en corona
    for (let i = 0, n = this.n(11, 3); i < n; i++) {
      const a = (i / n) * 6.28 + rr(-0.2, 0.2);
      this.alpha.spawn({ x: x + Math.cos(a) * R * 0.5, y: 0.15, z: z + Math.sin(a) * R * 0.5, vx: Math.cos(a) * rr(2, 4) * (R / 2.5 + 0.4), vy: rr(0.3, 0.9), vz: Math.sin(a) * rr(2, 4) * (R / 2.5 + 0.4),
        life: rr(0.8, 1.2), s0: R * 0.3, s1: R * rr(0.8, 1.0), cell: 1 + (i & 1), c0: [0.45, 0.4, 0.34], c1: [0.5, 0.46, 0.4], a0: 0.35, a1: 0, drag: 2.2 });
    }
    return R;
  }

  private smokeAcc = new Map<number, number>();

  /**
   * Nubes de humo activas. La densidad depende del TIEMPO del mundo (no de los frames dibujados): 80 % a los 0,4 s
   * de `from` y 100 % al segundo; si en un frame faltan sprites para la densidad objetivo, se crean todos de golpe
   * repartidos por el volumen (cilindro de radio r × 2,2 m). Núcleo casi opaco (alfa 0,9) con el borde exterior difuso.
   */
  updateSmokes(smokes: { id: number; x: number; y: number; r: number; from: number; until: number }[] | undefined, time: number, _dt: number): void {
    if (!smokes) return;
    const alive = new Set<number>();
    for (const c of smokes) {
      if (time < c.from || time >= c.until) continue;
      alive.add(c.id);
      const age = time - c.from, rem = c.until - time;
      const dens = age < 0.4 ? 0.8 * (age / 0.4) : Math.min(1, 0.8 + 0.2 * (age - 0.4) / 0.6);
      const low = this.factor < 0.5;
      const N = low ? 16 : this.factor < 1 ? 30 : 40;                 // en baja, menos sprites pero más grandes
      const sizeK = low ? 1.5 : 1;
      let lives = this.smokeLives.get(c.id);
      if (!lives) { lives = []; this.smokeLives.set(c.id, lives); }
      for (let i = lives.length - 1; i >= 0; i--) if (lives[i] <= time) lives.splice(i, 1);
      const target = rem < 1 ? 0 : Math.round(N * dens);                 // en el último segundo no se repone: se disipa
      let missing = target - lives.length;
      while (missing-- > 0) {
        const core = Math.random() < 0.7;                                 // núcleo opaco y capa exterior difusa
        const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * c.r * (core ? 0.62 : 0.98);
        const life = Math.min(rr(2.2, 3.4), rem + rr(0, 0.9));
        lives.push(time + life);
        this.smoke.spawn({ x: c.x + Math.cos(a) * d, y: 0.2 + Math.random() * 2.0, z: c.y + Math.sin(a) * d,
          vx: rr(-0.1, 0.1), vy: rr(0, 0.08), vz: rr(-0.1, 0.1), life,
          s0: c.r * (core ? 0.95 : 0.8) * sizeK, s1: c.r * (core ? 1.05 : 0.95) * sizeK, cell: 1 + (Math.random() < 0.5 ? 1 : 0),
          c0: core ? [0.5, 0.5, 0.52] : [0.56, 0.56, 0.58], c1: [0.5, 0.5, 0.52], a0: core ? 0.92 : 0.55, a1: 0, aIn: 0.08, aHold: 0.7, rotV: rr(-0.15, 0.15) });
      }
    }
    for (const id of [...this.smokeLives.keys()]) if (!alive.has(id)) this.smokeLives.delete(id);
  }

  /** Cegadora: destello blanco muy breve y chispas, sin fuego ni quemado. */
  flashBang(x: number, y: number, z: number, radius: number): void {
    const R = Math.max(1.5, radius);
    this.add.spawn({ x, y, z, life: 0.05, s0: R * 2.2, s1: R * 3.0, cell: 0, c0: [2.6, 2.6, 2.9], a0: this.flashK, a1: 0.4 * this.flashK });
    this.add.spawn({ x, y, z, life: 0.09, s0: R * 1.2, s1: R * 2.0, cell: 3, c0: [2.2, 2.3, 2.6], a0: this.flashK, a1: 0 });
    for (let i = 0, n = this.n(14, 4); i < n; i++) {
      const a = rr(0, 6.28), sp = rr(4, 10);
      this.add.spawn({ x, y, z, vx: Math.cos(a) * sp, vy: rr(1, 6), vz: Math.sin(a) * sp, life: rr(0.3, 0.6), s0: 0.07, s1: 0.02, cell: 0, c0: [2.0, 2.0, 2.3], c1: [0.7, 0.8, 1.0], grav: 8, drag: 0.5 });
    }
  }

  /** Chispas y destello de un escudo antidisturbios que para una bala. */
  shieldSpark(x: number, y: number, z: number): void {
    this.add.spawn({ x, y, z, life: 0.06, s0: 0.5, s1: 0.8, cell: 3, c0: [2.0, 1.8, 1.2], a0: this.flashK, a1: 0 });
    for (let i = 0; i < this.n(8, 3); i++) {
      this.add.spawn({ x, y, z, vx: rr(-3, 3), vy: rr(0.5, 3.5), vz: rr(-3, 3), life: rr(0.2, 0.4), s0: 0.04, s1: 0.012, cell: 0, c0: [2.0, 1.6, 0.8], c1: [0.7, 0.3, 0.1], grav: 8 });
    }
  }

  /** Estela de humo y resplandor de la tobera de un cohete (en la posición de la cola, dir = dirección de vuelo). */
  rocketTrail(x: number, y: number, z: number): void {
    this.alpha.spawn({ x, y, z, vx: rr(-0.2, 0.2), vy: rr(0.1, 0.4), vz: rr(-0.2, 0.2), life: 0.9, s0: 0.14, s1: 0.6, cell: 1 + (Math.random() < 0.5 ? 1 : 0), c0: [0.42, 0.42, 0.44], a0: 0.3, a1: 0, drag: 1.2 });
    this.add.spawn({ x, y, z, life: 0.06, s0: 0.38, s1: 0.2, cell: 0, c0: [2.0, 1.2, 0.5], a0: 1, a1: 0 });
  }

  /** Efecto heredado (partículas sueltas que otros sucesos piden): se dibuja como sprite suave en vez de cubo. */
  legacy(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: number, grav: number, drag: number): void {
    const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    if (lum > 0.5) {
      this.add.spawn({ x, y, z, vx, vy, vz, life, s0: size * 2.6, s1: size * 0.8, cell: 0, c0: [r * 1.5, g * 1.5, b * 1.5], c1: [r * 0.6, g * 0.4, b * 0.3], grav, drag });
    } else {
      this.alpha.spawn({ x, y, z, vx, vy, vz, life, s0: size * 2.0, s1: size * 3.4, cell: 1 + Math.floor(Math.random() * 2), c0: [r + 0.06, g + 0.06, b + 0.06], a0: 0.45, a1: 0, grav, drag });
    }
  }

  // ───────────────────────── Actualización ─────────────────────────

  update(dt: number, camera: THREE.Camera): void {
    this.add.update(dt, camera.position);
    this.alpha.update(dt, camera.position);
    this.smoke.update(dt, camera.position);
    // rastro corto de las chispas
    for (const i of this.add.pendingTrail) {
      this.add.trailPos(i, _v);
      this.add.spawn({ x: _v.x, y: _v.y, z: _v.z, life: 0.12, s0: 0.05, s1: 0.01, cell: 0, c0: [1.6, 0.9, 0.3], c1: [0.6, 0.15, 0.04] });
    }
    // trazadoras: segmento de ~2,5 m que viaja a 250 m/s de la boca al impacto
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.age += dt;
      const head = Math.min(t.len, 250 * t.age);
      const tail = Math.max(0, head - 2.5);
      if (tail >= t.len - 0.01 || t.age > 1) { t.active = false; t.mesh.visible = false; continue; }
      const seg = head - tail;
      _a.set(t.ax + t.dx * (tail + seg / 2), t.ay + t.dy * (tail + seg / 2), t.az + t.dz * (tail + seg / 2));
      _b.subVectors(camera.position, _a);
      _v.set(t.dx, t.dy, t.dz);
      _b.addScaledVector(_v, -_b.dot(_v));
      if (_b.lengthSq() < 1e-6) _b.set(0, 1, 0);
      _b.normalize();
      _up.crossVectors(_b, _v);
      _m.makeBasis(_v, _up, _b);
      t.mesh.quaternion.setFromRotationMatrix(_m);
      t.mesh.position.copy(_a);
      t.mesh.scale.set(Math.max(0.05, seg), 0.018, 1);
    }
    // anillo de onda
    for (const r of this.rings) {
      if (r.t <= 0) continue;
      r.t -= dt;
      if (r.t <= 0) { r.mesh.visible = false; continue; }
      const age = 0.35 - r.t;
      const k = Math.min(1, age / 0.2);
      const s = (r.r * 2.2) * (1 - (1 - k) * (1 - k)) + 0.2;
      r.mesh.scale.set(s, 1, s);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - age / 0.35) * 0.4;
    }
  }

  dispose(): void {
    this.add.dispose(); this.alpha.dispose(); this.smoke.dispose();
    this.atlas.dispose(); this.tracerTex.dispose(); this.tracerMat.dispose(); this.tracerGeo.dispose();
    this.ringTex.dispose(); this.ringGeo.dispose();
    for (const r of this.rings) (r.mesh.material as THREE.Material).dispose();
  }
}
