// Objetivos de zona (v1.3, oleada 2): cargas explosivas a desactivar, servidor a defender y punto de extracción del
// rehén. Todo por código: bloques, luces que parpadean, columnas de luz y aros en el suelo.

import * as THREE from 'three';
import type { IWorld } from '../contracts';

function tex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Lo que el objetivo necesita pedir al sistema de efectos. */
export interface ObjectiveFx {
  spark(x: number, y: number, z: number): void;
  smoke(x: number, y: number, z: number): void;
  flash(x: number, y: number, z: number): void;
  bigExplosion(x: number, y: number): void;
}

interface Charge { root: THREE.Group; led: THREE.Mesh; ledMat: THREE.MeshBasicMaterial; column: THREE.Mesh; colMat: THREE.MeshBasicMaterial; wasDone: boolean }

export class ObjectiveLayer {
  group = new THREE.Group();
  private charges: Charge[] = [];
  private server: THREE.Group | null = null;
  private serverLeds: THREE.MeshBasicMaterial[] = [];
  private zoneRing: THREE.Mesh;
  private zoneMat: THREE.MeshBasicMaterial;
  private extractRing: THREE.Mesh;
  private extractMat: THREE.MeshBasicMaterial;
  private extractColumn: THREE.Mesh;
  private extractColMat: THREE.MeshBasicMaterial;
  private colTex: THREE.CanvasTexture;
  private ringTex: THREE.CanvasTexture;
  private colGeo = new THREE.CylinderGeometry(0.28, 0.28, 6, 14, 1, true);
  private ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private dark = new THREE.MeshStandardMaterial({ color: 0x1d2126, roughness: 0.55, metalness: 0.5 });
  private wire = new THREE.MeshStandardMaterial({ color: 0x8a1a14, roughness: 0.7 });
  private wireB = new THREE.MeshStandardMaterial({ color: 0x1f3d8a, roughness: 0.7 });
  private lastStage = '';
  private acc = 0;
  private doneSeen = new Set<string>();

  constructor(private fx: ObjectiveFx) {
    this.colTex = tex(32, (g, s) => {
      const gy = g.createLinearGradient(0, 0, 0, s);
      gy.addColorStop(0, 'rgba(255,255,255,0)'); gy.addColorStop(0.15, 'rgba(255,255,255,0.55)'); gy.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gy; g.fillRect(0, 0, s, s);
    });
    this.ringTex = tex(128, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.9, 'rgba(255,255,255,0.12)'); gr.addColorStop(0.95, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    });
    const add = (c: THREE.Color): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ map: this.ringTex, color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.zoneMat = add(new THREE.Color(0.2, 0.55, 1.4));
    this.zoneRing = new THREE.Mesh(this.ringGeo, this.zoneMat); this.zoneRing.visible = false; this.zoneRing.renderOrder = 5; this.zoneRing.frustumCulled = false; this.group.add(this.zoneRing);
    this.extractMat = add(new THREE.Color(0.3, 1.3, 0.45));
    this.extractRing = new THREE.Mesh(this.ringGeo, this.extractMat); this.extractRing.visible = false; this.extractRing.renderOrder = 5; this.extractRing.frustumCulled = false; this.extractRing.scale.set(3.2, 1, 3.2); this.group.add(this.extractRing);
    this.extractColMat = this.columnMat(new THREE.Color(0.3, 1.2, 0.4));
    this.extractColumn = new THREE.Mesh(this.colGeo, this.extractColMat); this.extractColumn.visible = false; this.extractColumn.renderOrder = 6; this.extractColumn.frustumCulled = false; this.group.add(this.extractColumn);
  }

  private columnMat(c: THREE.Color): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ map: this.colTex, color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0.55 });
  }

  /** Carga explosiva: bloque oscuro con cables y luz roja. */
  private makeCharge(): Charge {
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.2, 0.3), this.dark); body.position.y = 0.1; root.add(body);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.22), this.dark); pack.position.set(0.02, 0.25, 0); root.add(pack);
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 6), i === 1 ? this.wireB : this.wire);
      w.rotation.z = Math.PI / 2; w.position.set(0, 0.3 + i * 0.012, -0.07 + i * 0.07); root.add(w);
    }
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xff2010 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), ledMat); led.position.set(0.15, 0.31, 0.08); root.add(led);
    const colMat = this.columnMat(new THREE.Color(1.5, 0.9, 0.25));
    const column = new THREE.Mesh(this.colGeo, colMat); column.position.y = 3; column.renderOrder = 6;
    root.add(column);
    root.traverse((o) => { o.frustumCulled = false; });
    this.group.add(root);
    return { root, led, ledMat, column, colMat, wasDone: false };
  }

  /** Servidor destacado: rack alto con luces azules. */
  private makeServer(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 2.5, 0.95), this.dark); body.position.y = 1.25; g.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 1.0), this.dark); top.position.y = 2.53; g.add(top);
    for (let r = 0; r < 14; r++) {
      const m = new THREE.MeshBasicMaterial({ color: 0x3aa0ff });
      this.serverLeds.push(m);
      for (let k = 0; k < 3; k++) {
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.01), m);
        led.position.set(-0.2 + k * 0.08, 0.2 + r * 0.16, 0.478);
        g.add(led);
      }
    }
    g.traverse((o) => { o.frustumCulled = false; });
    this.group.add(g);
    return g;
  }

  update(world: IWorld, time: number, dt: number): void {
    const obj = world.objective;
    this.zoneRing.visible = false; this.extractRing.visible = false; this.extractColumn.visible = false;
    if (this.server) this.server.visible = false;
    for (const c of this.charges) c.root.visible = false;
    if (!obj || obj.kind === 'clear' || !obj.points) return;

    if (obj.kind === 'defuse') {
      while (this.charges.length < obj.points.length) this.charges.push(this.makeCharge());
      // parpadeo cada vez más rápido al agotarse el tiempo (de 2 a 12 Hz)
      const urgency = obj.timeLeft >= 0 ? 1 - Math.min(1, Math.max(0, obj.timeLeft / 60)) : 0.2;
      const hz = 2 + urgency * 10;
      obj.points.forEach((p, i) => {
        const c = this.charges[i];
        c.root.visible = true; c.root.position.set(p.x, 0, p.y);
        if (p.done) { c.ledMat.color.setHex(0x30ff60); c.column.visible = false; }       // verde fija y sin columna
        else { c.ledMat.color.setHex(Math.sin(time * hz * Math.PI * 2) > 0 ? 0xff2010 : 0x300604); c.column.visible = true; c.colMat.opacity = 0.35 + 0.15 * Math.sin(time * 3); }
      });
    } else if (obj.kind === 'defend' && obj.points[0]) {
      const p = obj.points[0];
      if (!this.server) this.server = this.makeServer();
      this.server.visible = true; this.server.position.set(p.x, 0, p.y);
      const ratio = obj.maxHp > 0 ? Math.max(0, obj.hp / obj.maxHp) : 1;
      const off = obj.maxHp > 0 && obj.hp <= 0;
      for (const m of this.serverLeds) m.color.setHex(off ? 0x080a10 : ratio < 0.3 ? (Math.sin(time * 20) > 0 ? 0xff5030 : 0x3aa0ff) : 0x3aa0ff);
      // chispas y humo según el daño
      this.acc += dt;
      if (!off && this.acc > 0.12) {
        this.acc = 0;
        if (ratio < 0.65 && Math.random() < (0.65 - ratio) * 1.4) this.fx.spark(p.x + (Math.random() - 0.5) * 0.5, 0.6 + Math.random() * 1.8, p.y + 0.5);
        if (ratio < 0.35 && Math.random() < 0.5) this.fx.smoke(p.x, 2.5, p.y);
      } else if (off && this.acc > 0.3) { this.acc = 0; this.fx.smoke(p.x, 2.5, p.y); }
      // aro de zona de 6 m en el suelo
      this.zoneRing.visible = true; this.zoneRing.position.set(p.x, 0.04, p.y); this.zoneRing.scale.set(12, 1, 12);
      this.zoneMat.opacity = 0.55 + 0.25 * Math.sin(time * 2.5);
    } else if (obj.kind === 'rescue' && obj.points[1]) {
      const e = obj.points[1];
      this.extractRing.visible = true; this.extractRing.position.set(e.x, 0.04, e.y);
      this.extractMat.opacity = 0.7 + 0.25 * Math.sin(time * 3);
      this.extractColumn.visible = true; this.extractColumn.position.set(e.x, 3, e.y);
      this.extractColMat.opacity = 0.4 + 0.15 * Math.sin(time * 2);
    }
    this.lastStage = obj.stage;
  }

  /** Sucesos del objetivo: destello breve al completar o fallar un punto; fallo en «defuse»: gran explosión en cada carga. */
  onEvents(events: { type: string; what?: string; kind?: string; x?: number; y?: number }[], world: IWorld): void {
    for (const ev of events) {
      if (ev.type !== 'objective' || ev.x === undefined || ev.y === undefined) continue;
      if (ev.what === 'done' || ev.what === 'failed') this.fx.flash(ev.x, 1.0, ev.y);
      if (ev.what === 'failed' && ev.kind === 'defuse') for (const p of world.objective?.points ?? []) this.fx.bigExplosion(p.x, p.y);
    }
  }

  clear(): void { this.doneSeen.clear(); this.acc = 0; }

  dispose(): void {
    this.colTex.dispose(); this.ringTex.dispose(); this.colGeo.dispose(); this.ringGeo.dispose();
    this.dark.dispose(); this.wire.dispose(); this.wireB.dispose();
    this.zoneMat.dispose(); this.extractMat.dispose(); this.extractColMat.dispose();
  }
}
