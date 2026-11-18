// Efectos: trazadoras, fogonazos, partículas (un solo InstancedMesh), explosiones, proyectiles,
// marcadores de orden y sacudida de cámara. Todo sale de pools: no se crean geometrías por disparo.
//
// Las funciones que reciben coordenadas «three» lo dicen; los sucesos traen coordenadas de la
// simulación (x, y, z) que aquí se convierten a (x, z, y).

import * as THREE from 'three';
import type { GameEvent, OrderKind, Projectile } from '../sim/types';
import type { IWorld } from '../contracts';
import { GeoBuilder, Owned, makeOutlineMat, makeToonVC } from './geo';

const MAX_PART = 640;
const MAX_TRACER = 48;
const MAX_FLASH = 24;
const MAX_EXPL = 8;
const MAX_MARK = 4;

const X_AXIS = new THREE.Vector3(1, 0, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const IDQ = new THREE.Quaternion();

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const rr = (a: number, b: number): number => a + Math.random() * (b - a);

interface Tracer { mesh: THREE.Mesh; t: number; life: number }
interface Flash { mesh: THREE.Mesh; t: number; base: number }
interface Expl { sphere: THREE.Mesh; core: THREE.Mesh; ring: THREE.Mesh; t: number; life: number; r: number }
interface Marker { root: THREE.Group; ring: THREE.Mesh; cone: THREE.Mesh; ringMat: THREE.MeshBasicMaterial; coneMat: THREE.MeshBasicMaterial; t: number; life: number; kind: OrderKind }

const ORDER_COLOR: Record<OrderKind, number> = { follow: 0x9ec5ff, goto: 0x35d0ff, focus: 0xff4040, hold: 0xffc72c };

export class Fx {
  group = new THREE.Group();
  /** amplitud de sacudida de cámara en metros; decae sola */
  shake = 0;
  private owned = new Owned();

  // trazadoras y fogonazos
  private tracers: Tracer[] = [];
  private flashes: Flash[] = [];
  private tracerMatAlly: THREE.MeshBasicMaterial;
  private tracerMatEnemy: THREE.MeshBasicMaterial;

  // partículas
  private pm: THREE.InstancedMesh;
  private ppos = new Float32Array(MAX_PART * 3);
  private pvel = new Float32Array(MAX_PART * 3);
  private plife = new Float32Array(MAX_PART);
  private pmax = new Float32Array(MAX_PART);
  private psize = new Float32Array(MAX_PART);
  private pgrav = new Float32Array(MAX_PART);
  private pdrag = new Float32Array(MAX_PART);
  private pnext = 0;

  // explosiones
  private expls: Expl[] = [];

  // marcadores de orden
  private markers: Marker[] = [];
  private persistent: Marker;
  private ringRound: THREE.RingGeometry;
  private ringSquare: THREE.RingGeometry;
  private coneGeo: THREE.ConeGeometry;

  // proyectiles
  private projViews = new Map<number, THREE.Group>();
  private grenadeGeo!: { geo: THREE.BufferGeometry; hull: THREE.BufferGeometry | null };
  private rocketGeo!: { geo: THREE.BufferGeometry; hull: THREE.BufferGeometry | null };
  private projMat: THREE.MeshToonMaterial;
  private projHullMat: THREE.MeshBasicMaterial;
  private trailAcc = 0;

  constructor() {
    const o = this.owned;
    // — trazadoras
    const box = o.add(new THREE.BoxGeometry(1, 1, 1));
    this.tracerMatAlly = o.add(new THREE.MeshBasicMaterial({ color: 0xffe14a }));
    this.tracerMatEnemy = o.add(new THREE.MeshBasicMaterial({ color: 0xff5a2a }));
    for (let i = 0; i < MAX_TRACER; i++) {
      const mesh = new THREE.Mesh(box, this.tracerMatAlly);
      mesh.visible = false; mesh.frustumCulled = false;
      this.group.add(mesh);
      this.tracers.push({ mesh, t: 0, life: 0.06 });
    }
    // — fogonazos
    const flashGeo = o.add(new THREE.IcosahedronGeometry(0.16, 0));
    const flashMat = o.add(new THREE.MeshBasicMaterial({ color: 0xfff1b0 }));
    for (let i = 0; i < MAX_FLASH; i++) {
      const mesh = new THREE.Mesh(flashGeo, flashMat);
      mesh.visible = false; mesh.frustumCulled = false;
      this.group.add(mesh);
      this.flashes.push({ mesh, t: 0, base: 1 });
    }
    // — partículas
    const pg = o.add(new THREE.BoxGeometry(1, 1, 1));
    const pmat = o.add(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.pm = new THREE.InstancedMesh(pg, pmat, MAX_PART);
    this.pm.frustumCulled = false;
    this.pm.setColorAt(0, _c.set(0xffffff));
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_PART; i++) this.pm.setMatrixAt(i, zero);
    this.group.add(this.pm);
    // — explosiones
    const sph = o.add(new THREE.SphereGeometry(1, 16, 12));
    const ringG = o.add(new THREE.RingGeometry(0.8, 1, 36).rotateX(-Math.PI / 2));
    for (let i = 0; i < MAX_EXPL; i++) {
      const sphere = new THREE.Mesh(sph, o.add(new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, depthWrite: false })));
      const core = new THREE.Mesh(sph, o.add(new THREE.MeshBasicMaterial({ color: 0xfff4d0, transparent: true, depthWrite: false })));
      const ring = new THREE.Mesh(ringG, o.add(new THREE.MeshBasicMaterial({ color: 0xffb050, transparent: true, depthWrite: false, side: THREE.DoubleSide })));
      for (const m of [sphere, core, ring]) { m.visible = false; m.frustumCulled = false; this.group.add(m); }
      this.expls.push({ sphere, core, ring, t: 0, life: 0.6, r: 1 });
    }
    // — marcadores
    this.ringRound = o.add(new THREE.RingGeometry(0.5, 0.64, 32).rotateX(-Math.PI / 2));
    this.ringSquare = o.add(new THREE.RingGeometry(0.5, 0.66, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2));
    this.coneGeo = o.add(new THREE.ConeGeometry(0.2, 0.42, 10).rotateX(Math.PI)); // punta hacia abajo
    for (let i = 0; i < MAX_MARK; i++) { const mk = this.makeMarker(); this.markers.push(mk); }
    this.persistent = this.makeMarker();
    // — proyectiles
    this.projMat = o.add(makeToonVC());
    this.projHullMat = o.add(makeOutlineMat());
    const gb = new GeoBuilder(0.02);
    gb.sph(0, 0, 0, 0.11, 0x2f3a30);
    gb.box(0, 0.1, 0, 0.05, 0.06, 0.05, 0xd9b84a, { outline: false });
    this.grenadeGeo = gb.build();
    const rb = new GeoBuilder(0.02);
    rb.tube(-0.3, 0, 0, 0.22, 0, 0, 0.065, 0x6b717b);
    rb.cyl(0.32, 0, 0, 0, 0.065, 0.2, 0xff5a1a, { rot: [0, 0, -Math.PI / 2] });
    for (const s of [-1, 1]) {
      rb.box(-0.26, 0, s * 0.08, 0.1, 0.012, 0.08, 0x30343a, { outline: false });
      rb.box(-0.26, s * 0.08, 0, 0.1, 0.08, 0.012, 0x30343a, { outline: false });
    }
    this.rocketGeo = rb.build();
    o.add(this.grenadeGeo.geo); if (this.grenadeGeo.hull) o.add(this.grenadeGeo.hull);
    o.add(this.rocketGeo.geo); if (this.rocketGeo.hull) o.add(this.rocketGeo.hull);
  }

  /** Colores de trazadora para daltonismo: aliados azul claro, hostiles amarillo vivo. */
  setColorblind(cb: boolean): void {
    this.tracerMatAlly.color.setHex(cb ? 0x7aa8ff : 0xffe14a);
    this.tracerMatEnemy.color.setHex(cb ? 0xffee00 : 0xff5a2a);
  }

  private makeMarker(): Marker {
    const ringMat = this.owned.add(new THREE.MeshBasicMaterial({ color: 0x35d0ff, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.9 }));
    const coneMat = this.owned.add(new THREE.MeshBasicMaterial({ color: 0x35d0ff, transparent: true, depthWrite: false, opacity: 0.9 }));
    const ring = new THREE.Mesh(this.ringRound, ringMat);
    const cone = new THREE.Mesh(this.coneGeo, coneMat);
    ring.position.y = 0.05;
    const root = new THREE.Group();
    root.add(ring, cone);
    root.visible = false;
    this.group.add(root);
    return { root, ring, cone, ringMat, coneMat, t: 0, life: 0, kind: 'goto' };
  }

  private styleMarker(mk: Marker, kind: OrderKind): void {
    mk.kind = kind;
    const col = ORDER_COLOR[kind];
    mk.ringMat.color.setHex(col); mk.coneMat.color.setHex(col);
    mk.ring.geometry = kind === 'hold' ? this.ringSquare : this.ringRound;
  }

  clear(): void {
    for (const t of this.tracers) { t.t = 0; t.mesh.visible = false; }
    for (const f of this.flashes) { f.t = 0; f.mesh.visible = false; }
    for (const e of this.expls) { e.t = 0; e.sphere.visible = e.core.visible = e.ring.visible = false; }
    for (const m of this.markers) { m.t = 0; m.root.visible = false; }
    this.persistent.root.visible = false;
    this.plife.fill(0);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_PART; i++) this.pm.setMatrixAt(i, zero);
    this.pm.instanceMatrix.needsUpdate = true;
    for (const v of this.projViews.values()) this.group.remove(v);
    this.projViews.clear();
    this.shake = 0;
  }

  // ───────────────────────── Partículas ─────────────────────────

  private part(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: number, grav = 9, drag = 0.5): void {
    const i = this.pnext;
    this.pnext = (this.pnext + 1) % MAX_PART;
    this.ppos[i * 3] = x; this.ppos[i * 3 + 1] = y; this.ppos[i * 3 + 2] = z;
    this.pvel[i * 3] = vx; this.pvel[i * 3 + 1] = vy; this.pvel[i * 3 + 2] = vz;
    this.plife[i] = life; this.pmax[i] = life; this.psize[i] = size; this.pgrav[i] = grav; this.pdrag[i] = drag;
    this.pm.setColorAt(i, _c.set(color));
    if (this.pm.instanceColor) this.pm.instanceColor.needsUpdate = true;
  }

  private burst(x: number, y: number, z: number, n: number, speed: number, life: number, size: number, color: number, grav = 9, upBias = 0.4, dx = 0, dy = 0, dz = 0): void {
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, el = Math.random() * 1.2 - 0.3 + upBias;
      const sp = speed * rr(0.4, 1);
      this.part(x, y, z, Math.cos(th) * Math.cos(el) * sp + dx, Math.sin(el) * sp + dy, Math.sin(th) * Math.cos(el) * sp + dz,
        life * rr(0.6, 1.2), size * rr(0.6, 1.3), color, grav);
    }
  }

  // ───────────────────────── Sucesos ─────────────────────────

  handle(events: GameEvent[], world: IWorld): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'shot': this.onShot(ev); break;
        case 'explosion': this.onExplosion(ev, world); break;
        case 'hurt': {
          const e = world.entityById(ev.id);
          if (e) {
            this.burst(e.x, 1.2, e.y, 4, 3, 0.3, 0.06, e.team === 'enemy' ? 0xff8a3a : 0x7ac8ff, 8);
            if (e.id === world.player.id) this.shake = Math.min(0.35, Math.max(this.shake, 0.05 + ev.amount * 0.004));
          }
          break;
        }
        case 'death': {
          this.burst(ev.x, 0.9, ev.y, 12, 3.5, 0.6, 0.1, ev.team === 'enemy' ? 0xd0501a : 0x4a78c8, 7);
          this.burst(ev.x, 0.5, ev.y, 5, 1.2, 1.0, 0.3, 0x6b6f78, -0.5, 0.8);
          break;
        }
        case 'breach': {
          for (let i = 0; i < 44; i++) {
            const a = Math.random() * Math.PI * 2, sp = rr(0.8, 4);
            this.part(ev.x + rr(-0.4, 0.4), rr(0.2, 2.6), ev.y + rr(-0.4, 0.4), Math.cos(a) * sp, rr(0, 2.5), Math.sin(a) * sp,
              rr(1.1, 2.2), rr(0.25, 0.7), Math.random() > 0.5 ? 0xb9b2a2 : 0x8c8678, 0.6, 1.6);
          }
          break;
        }
        case 'order': this.showOrder(ev.order, ev.x, ev.y); break;
        case 'pickup': this.burst(ev.x, 0.7, ev.y, 10, 2.5, 0.5, 0.06, ev.item.startsWith('vida') ? 0x4cff8a : 0xffe14a, 3, 0.8); break;
        default: break;
      }
    }
  }

  private onShot(ev: Extract<GameEvent, { type: 'shot' }>): void {
    _a.set(ev.fx, ev.fz, ev.fy);
    _b.set(ev.tx, ev.tz, ev.ty);
    _d.subVectors(_b, _a);
    const len = _d.length();
    if (len < 1e-3) return;
    _d.divideScalar(len);
    // trazadora
    const t = this.tracers.find((x) => x.t <= 0);
    if (t) {
      t.t = t.life = 0.06;
      t.mesh.material = ev.team === 'ally' ? this.tracerMatAlly : this.tracerMatEnemy;
      t.mesh.position.copy(_a).addScaledVector(_d, len / 2);
      t.mesh.quaternion.setFromUnitVectors(X_AXIS, _d);
      t.mesh.scale.set(len, 0.05, 0.05);
      t.mesh.visible = true;
    }
    // fogonazo en el origen
    const f = this.flashes.find((x) => x.t <= 0);
    if (f) {
      f.t = 0.05; f.base = rr(0.9, 1.5);
      f.mesh.position.copy(_a).addScaledVector(_d, 0.2);
      f.mesh.quaternion.setFromUnitVectors(X_AXIS, _d);
      f.mesh.scale.set(f.base * 1.6, f.base, f.base);
      f.mesh.visible = true;
    }
    // impacto
    if (ev.hit === 'wall') {
      this.burst(ev.tx, ev.tz, ev.ty, 6, 4, 0.3, 0.05, 0xffe28a, 9, 0.2, -_d.x * 2, -_d.y * 2 + 1, -_d.z * 2);
      this.burst(ev.tx, ev.tz, ev.ty, 2, 1, 0.5, 0.13, 0x9aa0a8, -0.4, 0.5);
    } else if (ev.hit === 'entity') {
      const col = ev.team === 'ally' ? 0xff7a2a : 0x6ab8ff;
      this.burst(ev.tx, ev.tz, ev.ty, 7, 3.5, 0.35, 0.07, col, 8, 0.3, -_d.x, -_d.y + 0.5, -_d.z);
      this.burst(ev.tx, ev.tz, ev.ty, 3, 2, 0.25, 0.05, 0xffffff, 8, 0.3);
    }
  }

  private onExplosion(ev: Extract<GameEvent, { type: 'explosion' }>, world: IWorld): void {
    const e = this.expls.find((x) => x.t <= 0) ?? this.expls[0];
    e.t = e.life = 0.6; e.r = Math.max(0.5, ev.radius);
    for (const m of [e.sphere, e.core]) m.position.set(ev.x, Math.max(0.3, ev.z), ev.y);
    e.ring.position.set(ev.x, 0.06, ev.y);
    e.sphere.visible = e.core.visible = e.ring.visible = true;
    const x = ev.x, y = Math.max(0.3, ev.z), z = ev.y;
    this.burst(x, y, z, 30, 11, 0.7, 0.16, 0xff9a2a, 6, 0.5);
    this.burst(x, y, z, 12, 7, 0.5, 0.12, 0xffe28a, 6, 0.4);
    this.burst(x, y, z, 14, 3, 1.5, 0.7, 0x3d4048, -1.2, 0.6);
    this.burst(x, 0.15, z, 8, 5, 0.9, 0.25, 0x8a8a90, 5, 0.2);
    // sacudida si está cerca de la cámara
    const cam = world.cam;
    const d = Math.hypot(ev.x - cam.x, ev.y - cam.y, ev.z - cam.z);
    const amp = Math.max(0, 1 - d / 16) * 0.4;
    if (amp > this.shake) this.shake = amp;
  }

  private showOrder(kind: OrderKind, x: number, y: number): void {
    const mk = this.markers.find((m) => m.t <= 0) ?? this.markers[0];
    this.styleMarker(mk, kind);
    mk.t = mk.life = 2.2;
    mk.root.position.set(x, 0, y);
    mk.root.visible = true;
  }

  // ───────────────────────── Actualización ─────────────────────────

  update(dt: number, world: IWorld | null, time: number): void {
    // trazadoras
    for (const t of this.tracers) {
      if (t.t <= 0) continue;
      t.t -= dt;
      if (t.t <= 0) { t.mesh.visible = false; continue; }
      const k = t.t / t.life;
      t.mesh.scale.y = t.mesh.scale.z = 0.02 + 0.045 * k;
    }
    for (const f of this.flashes) {
      if (f.t <= 0) continue;
      f.t -= dt;
      if (f.t <= 0) { f.mesh.visible = false; continue; }
      const k = f.t / 0.05;
      f.mesh.scale.set(f.base * 1.6 * k + 0.2, f.base * k + 0.1, f.base * k + 0.1);
    }

    // partículas
    for (let i = 0; i < MAX_PART; i++) {
      const life = this.plife[i];
      if (life <= 0) continue;
      const nl = life - dt;
      if (nl <= 0) {
        this.plife[i] = 0;
        this.pm.setMatrixAt(i, ZERO_M);
        continue;
      }
      this.plife[i] = nl;
      const i3 = i * 3;
      const drag = Math.max(0, 1 - this.pdrag[i] * dt);
      this.pvel[i3] *= drag; this.pvel[i3 + 2] *= drag;
      this.pvel[i3 + 1] -= this.pgrav[i] * dt;
      this.ppos[i3] += this.pvel[i3] * dt;
      this.ppos[i3 + 1] += this.pvel[i3 + 1] * dt;
      this.ppos[i3 + 2] += this.pvel[i3 + 2] * dt;
      if (this.ppos[i3 + 1] < 0.03) { this.ppos[i3 + 1] = 0.03; this.pvel[i3 + 1] *= -0.3; this.pvel[i3] *= 0.6; this.pvel[i3 + 2] *= 0.6; }
      const f = nl / this.pmax[i];
      const sz = this.psize[i] * (f < 0.5 ? f * 2 : 1);
      _s.set(sz, sz, sz);
      _m.compose(_p.set(this.ppos[i3], this.ppos[i3 + 1], this.ppos[i3 + 2]), IDQ, _s);
      this.pm.setMatrixAt(i, _m);
    }
    this.pm.instanceMatrix.needsUpdate = true;

    // explosiones
    for (const e of this.expls) {
      if (e.t <= 0) continue;
      e.t -= dt;
      if (e.t <= 0) { e.sphere.visible = e.core.visible = e.ring.visible = false; continue; }
      const t = 1 - e.t / e.life;
      const sMat = e.sphere.material as THREE.MeshBasicMaterial;
      const cMat = e.core.material as THREE.MeshBasicMaterial;
      const rMat = e.ring.material as THREE.MeshBasicMaterial;
      e.sphere.scale.setScalar(e.r * (0.2 + 0.8 * easeOut(t)));
      sMat.opacity = (1 - t) * 0.7;
      const tc = Math.min(1, t * 2.5);
      e.core.scale.setScalar(e.r * 0.55 * (0.4 + 0.6 * easeOut(tc)));
      cMat.opacity = 1 - tc;
      e.ring.scale.set(e.r * 1.2 * easeOut(t) + 0.1, 1, e.r * 1.2 * easeOut(t) + 0.1);
      rMat.opacity = (1 - t) * 0.85;
    }

    // marcadores temporales
    for (const m of this.markers) {
      if (m.t <= 0) continue;
      m.t -= dt;
      if (m.t <= 0) { m.root.visible = false; continue; }
      this.animMarker(m, time, Math.min(1, m.t / 0.5), Math.min(1, (m.life - m.t) / 0.2));
    }

    // marcador de la orden vigente
    if (world && (world.order.kind === 'goto' || world.order.kind === 'hold')) {
      const m = this.persistent;
      if (m.kind !== world.order.kind || !m.root.visible) this.styleMarker(m, world.order.kind);
      m.root.visible = true;
      m.root.position.set(world.order.x, 0, world.order.y);
      this.animMarker(m, time, 0.8, 1);
    } else this.persistent.root.visible = false;

    // sacudida
    this.shake *= Math.exp(-dt * 7);
    if (this.shake < 0.002) this.shake = 0;

    // proyectiles
    if (world) this.updateProjectiles(world, dt, time);
  }

  private animMarker(m: Marker, time: number, alpha: number, grow: number): void {
    const pulse = 1 + Math.sin(time * 5) * 0.08;
    const s = (0.6 + 0.4 * grow) * pulse * 1.3;
    m.ring.scale.set(s, 1, s);
    m.cone.position.y = 1.0 + Math.sin(time * 4) * 0.12;
    m.cone.rotation.y = time * 2;
    m.ringMat.opacity = 0.9 * alpha;
    m.coneMat.opacity = 0.9 * alpha;
  }

  private updateProjectiles(world: IWorld, dt: number, time: number): void {
    const seen = new Set<number>();
    this.trailAcc += dt;
    const doTrail = this.trailAcc >= 1 / 60;
    if (doTrail) this.trailAcc = 0;
    for (const p of world.projectiles) {
      if (p.dead) continue;
      seen.add(p.id);
      let g = this.projViews.get(p.id);
      if (!g) { g = this.makeProjView(p); this.projViews.set(p.id, g); this.group.add(g); }
      g.position.set(p.x, p.z, p.y);
      if (p.kind === 'rocket') {
        _d.set(p.vx, p.vz, p.vy);
        if (_d.lengthSq() > 1e-6) g.quaternion.setFromUnitVectors(X_AXIS, _d.normalize());
        if (doTrail) {
          const bx = p.x - _d.x * 0.35, by = p.z - _d.y * 0.35, bz = p.y - _d.z * 0.35;
          this.part(bx, by, bz, rr(-0.3, 0.3), rr(-0.2, 0.4), rr(-0.3, 0.3), 0.7, 0.2, 0x8f949c, -0.3, 1);
          this.part(bx, by, bz, rr(-0.2, 0.2), rr(-0.2, 0.2), rr(-0.2, 0.2), 0.16, 0.14, 0xffa030, 0, 2);
        }
      } else {
        g.rotation.set(time * 7 + p.id, time * 5, time * 3);
      }
    }
    if (this.projViews.size !== seen.size) {
      for (const [id, v] of this.projViews) if (!seen.has(id)) { this.group.remove(v); this.projViews.delete(id); }
    }
  }

  private makeProjView(p: Projectile): THREE.Group {
    const g = new THREE.Group();
    const m = p.kind === 'rocket' ? this.rocketGeo : this.grenadeGeo;
    g.add(new THREE.Mesh(m.geo, this.projMat));
    if (m.hull) g.add(new THREE.Mesh(m.hull, this.projHullMat));
    return g;
  }

  dispose(): void {
    this.clear();
    this.pm.dispose();
    this.owned.disposeAll();
  }
}

const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
