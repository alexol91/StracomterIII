// Avisos en el suelo y marcadores 3D de la v1.3: amenazas de la simulación (world.threats), marcadores de
// «ping» y el haz de curación de los escoltas. Todo sin escribir profundidad, visible pero sobrio.

import * as THREE from 'three';
import type { Entity } from '../sim/types';
import type { IWorld } from '../contracts';

const RED = new THREE.Color(1.0, 0.16, 0.12);

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

interface Flat { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }
interface Beam { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }

export class ThreatLayer {
  group = new THREE.Group();
  private discTex: THREE.CanvasTexture;
  private ringTex: THREE.CanvasTexture;
  private glowTex: THREE.CanvasTexture;
  private stripTex: THREE.CanvasTexture;
  private beamTex: THREE.CanvasTexture;
  private plane = new THREE.PlaneGeometry(1, 1);
  private flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private discs: Flat[] = [];
  private rings: Flat[] = [];
  private strips: Flat[] = [];
  private beams: Beam[] = [];
  private dots: Beam[] = [];
  private heal: Beam[] = [];
  private pingPool: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; x: number; y: number; z: number }[] = [];
  private pingGeo = new THREE.OctahedronGeometry(0.16, 0);
  private _up = new THREE.Vector3();
  private _m = new THREE.Matrix4();
  private _a = new THREE.Vector3();
  private _b = new THREE.Vector3();
  private _d = new THREE.Vector3();

  constructor() {
    this.discTex = canvasTex(128, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0.12)'); gr.addColorStop(0.85, 'rgba(255,255,255,0.28)'); gr.addColorStop(0.95, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    });
    this.ringTex = canvasTex(128, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.9, 'rgba(255,255,255,0)'); gr.addColorStop(0.95, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    });
    this.glowTex = canvasTex(64, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    });
    this.stripTex = canvasTex(64, (g, s) => {
      const gx = g.createLinearGradient(0, 0, s, 0);
      gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(0.12, 'rgba(255,255,255,0.8)'); gx.addColorStop(0.5, 'rgba(255,255,255,0.28)'); gx.addColorStop(0.88, 'rgba(255,255,255,0.8)'); gx.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gx; g.fillRect(0, 0, s, s);
    });
    this.beamTex = canvasTex(32, (g, s) => {
      const gy = g.createLinearGradient(0, 0, 0, s);
      gy.addColorStop(0, 'rgba(255,255,255,0)'); gy.addColorStop(0.5, 'rgba(255,255,255,1)'); gy.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gy; g.fillRect(0, 0, s, s);
    });
    const mkMat = (map: THREE.Texture, col: THREE.Color, additive: boolean): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ map, color: col.clone(), transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    for (let i = 0; i < 6; i++) {
      const dm = mkMat(this.discTex, RED, false); const d = new THREE.Mesh(this.flat, dm); d.visible = false; d.frustumCulled = false; d.renderOrder = 6; this.group.add(d); this.discs.push({ mesh: d, mat: dm });
      const rm = mkMat(this.ringTex, RED, true); const r = new THREE.Mesh(this.flat, rm); r.visible = false; r.frustumCulled = false; r.renderOrder = 6; this.group.add(r); this.rings.push({ mesh: r, mat: rm });
      const sm = mkMat(this.stripTex, RED, false); const s = new THREE.Mesh(this.flat, sm); s.visible = false; s.frustumCulled = false; s.renderOrder = 6; this.group.add(s); this.strips.push({ mesh: s, mat: sm });
      const bm = mkMat(this.beamTex, RED, true); const b = new THREE.Mesh(this.plane, bm); b.visible = false; b.frustumCulled = false; b.renderOrder = 7; this.group.add(b); this.beams.push({ mesh: b, mat: bm });
      const gm = mkMat(this.glowTex, RED, true); const gdot = new THREE.Mesh(this.plane, gm); gdot.visible = false; gdot.frustumCulled = false; gdot.renderOrder = 7; this.group.add(gdot); this.dots.push({ mesh: gdot, mat: gm });
    }
    const GREEN = new THREE.Color(0.35, 1.0, 0.45);
    for (let i = 0; i < 6; i++) {
      const hm = mkMat(this.beamTex, GREEN, true); const h = new THREE.Mesh(this.plane, hm); h.visible = false; h.frustumCulled = false; h.renderOrder = 7; this.group.add(h); this.heal.push({ mesh: h, mat: hm });
    }
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, opacity: 0.9 });
      const mesh = new THREE.Mesh(this.pingGeo, mat); mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 8;
      this.group.add(mesh);
      this.pingPool.push({ mesh, mat, t: 0, x: 0, y: 0, z: 0 });
    }
  }

  /** Marcador 3D breve: rombo que cae y pulsa 2 s. Rojo sobre enemigo, ámbar en puerta/objeto, azul en el suelo. */
  ping(what: 'enemy' | 'door' | 'item' | 'ground', x: number, y: number, entity?: Entity): void {
    const p = this.pingPool.find((q) => q.t <= 0) ?? this.pingPool[0];
    p.t = 2;
    p.x = x; p.y = y;
    p.z = what === 'enemy' ? (entity ? statureOf(entity) : 1.9) : what === 'ground' ? 0.5 : 1.5;
    p.mat.color.setHex(what === 'enemy' ? 0xff3b30 : what === 'ground' ? 0x4aa8ff : 0xffb020);
    p.mesh.visible = true;
  }

  update(world: IWorld, time: number, camera: THREE.Camera, dt: number): void {
    // ── amenazas
    let nd = 0, nr = 0, ns = 0, nb = 0;
    for (const th of world.threats ?? []) {
      const total = Math.max(0.05, th.at - th.from);
      const prog = Math.min(1, Math.max(0, (time - th.from) / total));       // 0 al anunciarse, 1 al ejecutarse
      if (time > th.at + 0.2) continue;
      if (th.kind === 'blast' && nd < this.discs.length) {
        const d = this.discs[nd++], r = this.rings[nr++];
        const pulse = 0.75 + 0.25 * Math.sin(time * 14);
        d.mesh.visible = true; d.mesh.position.set(th.x, 0.03, th.y); d.mesh.scale.set(th.r * 2, 1, th.r * 2);
        d.mat.opacity = (0.35 + 0.35 * prog) * pulse;
        // el anillo se cierra desde 1,7·r hasta r hasta el instante de la explosión
        const rs = th.r * (1.7 - 0.7 * prog) * 2;
        r.mesh.visible = true; r.mesh.position.set(th.x, 0.035, th.y); r.mesh.scale.set(rs, 1, rs);
        r.mat.opacity = 0.9;
      } else if ((th.kind === 'charge' || th.kind === 'lane') && ns < this.strips.length) {
        const s = this.strips[ns++];
        const dx = th.x - th.fx, dz = th.y - th.fy, len = Math.hypot(dx, dz);
        if (len < 0.05) { ns--; continue; }
        s.mesh.visible = true;
        s.mesh.position.set((th.fx + th.x) / 2, 0.03, (th.fy + th.y) / 2);
        s.mesh.rotation.set(0, -Math.atan2(dz, dx), 0);
        s.mesh.scale.set(len, 1, th.r);
        s.mat.opacity = (0.3 + 0.25 * prog) * (0.6 + 0.4 * Math.sin(time * 16));        // parpadea
      } else if (th.kind === 'laser' && nb < this.beams.length) {
        const b = this.beams[nb], dot = this.dots[nb]; nb++;
        this._a.set(th.fx, 1.4, th.fy); this._b.set(th.x, 1.4, th.y);
        this.line(b.mesh, this._a, this._b, 0.012 + 0.012 * prog, camera);
        b.mat.opacity = 0.25 + 0.75 * prog;                 // se intensifica al acercarse el instante del disparo
        dot.mesh.visible = true; dot.mesh.position.copy(this._b); dot.mesh.quaternion.copy(camera.quaternion);
        const sz = 0.16 + 0.2 * prog; dot.mesh.scale.set(sz, sz, 1);
        dot.mat.opacity = 0.5 + 0.5 * prog;
      }
    }
    for (let i = nd; i < this.discs.length; i++) { this.discs[i].mesh.visible = false; this.rings[i].mesh.visible = false; }
    for (let i = ns; i < this.strips.length; i++) this.strips[i].mesh.visible = false;
    for (let i = nb; i < this.beams.length; i++) { this.beams[i].mesh.visible = false; this.dots[i].mesh.visible = false; }

    // ── haz de curación: escoltas (enemy2 a ≤ 6 m de un jefe «escoltas» vivo) -> línea tenue verde pulsante
    let nh = 0;
    // si la simulación da healTargetId, el haz solo existe mientras la escolta cura a un jefe vivo; si el campo no existe, reserva por proximidad
    const hasField = world.entities.some((e) => e.healTargetId !== undefined);
    const bosses: Entity[] = [];
    for (const e of world.entities) if (e.alive && (e.kind === 'miniboss' || e.kind === 'megaboss') && (hasField || e.bossVariant === 'escoltas')) bosses.push(e);
    for (const e of world.entities) {
      if (!e.alive || e.kind !== 'enemy2' || nh >= this.heal.length) continue;
      let target: Entity | undefined;
      if (hasField) { const id = e.healTargetId ?? -1; if (id >= 0) target = bosses.find((b) => b.id === id); }
      else target = bosses.find((b) => b.bossVariant === 'escoltas' && Math.hypot(e.x - b.x, e.y - b.y) <= 6);
      if (!target) continue;
      this._a.set(e.x, 1.2, e.y); this._b.set(target.x, 1.4, target.y);
      const h = this.heal[nh++];
      this.line(h.mesh, this._a, this._b, 0.05, camera);
      h.mat.opacity = 0.16 + 0.12 * Math.sin(time * 6 + e.id);
    }
    for (let i = nh; i < this.heal.length; i++) this.heal[i].mesh.visible = false;

    // ── pings
    for (const p of this.pingPool) {
      if (p.t <= 0) continue;
      p.t -= dt;
      if (p.t <= 0) { p.mesh.visible = false; continue; }
      const age = 2 - p.t;
      const fall = Math.max(0, 1 - age / 0.35);                  // cae durante los primeros 0,35 s
      p.mesh.position.set(p.x, p.z + 0.9 * fall * fall + Math.sin(age * 5) * 0.04, p.y);
      p.mesh.rotation.y = age * 2.4;
      const pulse = 1 + 0.18 * Math.sin(age * 9);
      p.mesh.scale.set(pulse, pulse * 1.5, pulse);
      p.mat.opacity = Math.min(1, p.t / 0.4) * 0.95;
    }
  }

  /** Cuadrilátero fino orientado a la cámara entre dos puntos. */
  private line(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, width: number, camera: THREE.Camera): void {
    const len = this._d.subVectors(b, a).length();
    if (len < 1e-3) { mesh.visible = false; return; }
    this._d.divideScalar(len);
    const mid = a.clone().addScaledVector(this._d, len / 2);
    const toCam = camera.position.clone().sub(mid);
    toCam.addScaledVector(this._d, -toCam.dot(this._d));
    if (toCam.lengthSq() < 1e-6) toCam.set(0, 1, 0);
    toCam.normalize();
    this._up.crossVectors(toCam, this._d);
    this._m.makeBasis(this._d, this._up, toCam);
    mesh.quaternion.setFromRotationMatrix(this._m);
    mesh.position.copy(mid);
    // el cuadrilátero es PlaneGeometry (X a lo largo, Y a lo ancho)
    mesh.scale.set(len, width, 1);
    mesh.visible = true;
  }

  clear(): void {
    for (const l of [this.discs, this.rings, this.strips, this.beams, this.dots, this.heal]) for (const i of l) i.mesh.visible = false;
    for (const p of this.pingPool) { p.t = 0; p.mesh.visible = false; }
  }

  dispose(): void {
    for (const t of [this.discTex, this.ringTex, this.glowTex, this.stripTex, this.beamTex]) t.dispose();
    for (const l of [this.discs, this.rings, this.strips, this.beams, this.dots, this.heal]) for (const i of l) i.mat.dispose();
    for (const p of this.pingPool) p.mat.dispose();
    this.plane.dispose(); this.flat.dispose(); this.pingGeo.dispose();
  }
}

function statureOf(e: Entity): number { return e.kind === 'megaboss' ? 3.0 : e.kind === 'miniboss' ? 2.6 : 2.15; }
