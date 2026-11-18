// El mundo: entidades, combate, movimiento, puertas, objetos, auras, órdenes y cámara.
// La IA enemiga está en ai_enemy.ts, la de los compañeros en ai_ally.ts y el ritmo de apariciones en director.ts.

import type { IWorld } from '../contracts';
import {
  ALLY_ITEM_THRESHOLDS, AMMO_CAP, AMMO_START, AURA_RADIUS, BLAST_RADIUS, CLASS_STATS, CROUCH_HEIGHT, ENEMY_AMMO,
  ENEMY_STATS, GRENADE_COOLDOWN, GRENADE_COUNT, GRENADE_DAMAGE, HEAD_MULT, INVENTORY_SLOTS, ITEM_EFFECT,
  KNIFE_DAMAGE, KNIFE_PERIOD, KNIFE_RANGE, LIMB_MULT, STAND_HEIGHT, UnitStats, VISION, WEAPON_RANGE, isClass, statsOf,
} from './data';
import { allyThink } from './ai_ally';
import { EnemyAI } from './ai_enemy';
import { Director, DirectorConfig } from './director';
import { Level, NAV_RADIUS } from './level';
import { Nav } from './nav';
import type {
  AiDebugInfo, ClassId, EnemyKind, Entity, GameEvent, HitZone, ItemType, Kind, MapDef, OrderKind, Pickup,
  PlayerInput, Projectile, Team, Vec2, WorldStatus, ZoneStats,
} from './types';

export interface Unit extends Entity {
  stats: UnitStats;
  cls: ClassId | null;
  ekind: EnemyKind | null;
  /** velocidad deseada (la fija la IA o la entrada del jugador) */
  wishX: number; wishY: number;
  fireCd: number; knifeCd: number; grenadeCd: number;
  stepAcc: number;
  // seguimiento de caminos
  path: Vec2[] | null; pathI: number; goalX: number; goalY: number; repathAt: number; navVer: number;
  doorWait: number;
  // detección de atasco
  refX: number; refY: number; refT: number;
  /** máximo tiempo seguido queriendo moverse sin conseguirlo (diagnóstico para pruebas) */
  stuckMax: number;
  /** clavado por Supresión hasta este instante */
  pinnedUntil: number;
  noiseAt: number;
  /** estado propio de la IA */
  brain: any;
  /** multiplicador de velocidad de giro, etc. */
  spawnAt: number;
}

export interface Noise { x: number; y: number; loud: number; team: Team; id: number; kind: 'shot' | 'blast' | 'door' | 'step' }

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function angDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface WorldConfig {
  map: MapDef;
  floor: number;
  zone: number;
  controlled: ClassId;
  /** estado inicial de cada miembro; hp<=0 = no aparece (muerto en la campaña) */
  members: Record<ClassId, { hp: number; ammo: number; inv: (ItemType | null)[] }>;
  director: DirectorConfig;
  seed?: number;
  /** puntuación acumulada de la campaña (para que el HUD la enseñe sumada) */
  baseScore?: number;
}

const _v: Vec2 = [0, 0];

export class World implements IWorld {
  level: Level;
  nav: Nav;
  entities: Unit[] = [];
  player!: Unit;
  projectiles: Projectile[] = [];
  pickups: Pickup[] = [];
  events: GameEvent[] = [];
  noises: Noise[] = [];
  time = 0;
  status: WorldStatus = 'playing';
  floor: number;
  zone: number;
  score = 0;
  morale = 60;
  stats: ZoneStats = { time: 0, kills: 0, shotsFired: 0, shotsHit: 0, damageTaken: 0, alliesLost: 0, scoreGained: 0 };
  cam = { x: 0, y: 0, z: 2, yaw: 0, pitch: 0 };
  aim = { x: 0, y: 0, z: 0, entityId: -1 };
  interactDoor = -1;
  assist: { yaw: number; pitch: number } | null = null;
  private assistId = -1;
  order: { kind: OrderKind; x: number; y: number; targetId: number } = { kind: 'follow', x: 0, y: 0, targetId: -1 };
  private prevOrder: { kind: OrderKind; x: number; y: number; targetId: number } | null = null;
  pacing: 'ascenso' | 'pico' | 'alivio' | 'descanso' = 'ascenso';
  cheats = { god: false, noclip: false, aiDebug: false };

  rng: () => number;
  director: Director;
  enemyAI: EnemyAI;
  /** distancia andando hasta el jugador (puertas cerradas con coste) */
  pField: Float32Array;
  private pFieldDirty = false;
  private pFieldAt = -1; private pFieldX = 0; private pFieldY = 0; private pFieldVer = -1;
  /** contador de cambios de puertas (para invalidar cachés) */
  doorVer = 0;
  pathBudget = 0;
  private nextId = 1;
  private auraHpAcc = 0; private auraAmmoAcc = 0;
  private soundFields = new Map<number, { f: Float32Array; t: number; ver: number }>();
  private soundBudget = 0;
  private lastInput: PlayerInput | null = null;
  /** diagnóstico (pruebas): se llama cuando hay que sacar a alguien de un atasco */
  onUnstuck: ((u: Unit) => void) | null = null;
  private dryAt = -1;

  constructor(cfg: WorldConfig) {
    this.rng = mulberry32(cfg.seed ?? (cfg.floor * 1000 + cfg.zone * 37 + 7));
    this.floor = cfg.floor; this.zone = cfg.zone;
    this.score = cfg.baseScore ?? 0;
    this.level = new Level(cfg.map, cfg.floor);
    this.nav = new Nav(this.level);
    this.pField = new Float32Array(this.level.gw * this.level.gh);
    cfg.map.objetos.forEach(o => this.pickups.push({ id: this.nextId++, type: o.tipo, x: o.pos[0], y: o.pos[1], taken: false }));

    // la escuadra: el jugador en el inicio y los compañeros en formación detrás
    const [sx, sy] = cfg.map.inicio_jugador;
    const bx = cfg.map.punto_jefe[0] - sx, by = cfg.map.punto_jefe[1] - sy;
    let yaw0 = Math.atan2(by, bx);
    // mirar hacia donde haya más sitio libre delante
    let bestOpen = -1;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const t = this.level.ray(sx, sy, 1.5, sx + Math.cos(a) * 12, sy + Math.sin(a) * 12, 1.5, 'sight');
      const sc = t * 12 + Math.cos(angDiff(a, Math.atan2(by, bx))) * 2;
      if (sc > bestOpen) { bestOpen = sc; yaw0 = a; }
    }
    const order: ClassId[] = [cfg.controlled, ...(['captain', 'technic', 'especialist', 'explosives'] as ClassId[]).filter(c => c !== cfg.controlled)];
    let n = 0;
    for (const c of order) {
      const m = cfg.members[c];
      if (!m || m.hp <= 0) continue;
      let px = sx, py = sy;
      if (c !== cfg.controlled) {
        n++;
        const a = yaw0 + Math.PI + (n - 2) * 0.7;
        const cell = this.level.nearestFree(sx + Math.cos(a) * 1.3, sy + Math.sin(a) * 1.3, false);
        if (cell >= 0) { px = this.level.cellX(cell); py = this.level.cellY(cell); }
      }
      const u = this.spawnUnit(c, px, py, false);
      u.yaw = yaw0;
      u.hp = Math.min(u.maxHp, m.hp);
      const total = Math.max(0, Math.min(AMMO_CAP, m.ammo));
      u.mag = Math.min(u.magSize, total); u.ammo = total - u.mag;
      u.inventory = m.inv.slice(0, INVENTORY_SLOTS);
      while (u.inventory.length < INVENTORY_SLOTS) u.inventory.push(null);
      if (c === cfg.controlled) { u.isPlayer = true; this.player = u; }
    }
    if (!this.player) throw new Error('El personaje controlado está muerto');
    this.order.x = this.player.x; this.order.y = this.player.y;
    this.cam.yaw = yaw0;
    this.updatePlayerField(true);
    this.enemyAI = new EnemyAI(this);
    this.director = new Director(this, cfg.director);
    this.director.begin();
    this.computeCam(yaw0, 0, 4.2);
  }

  // ───────────────────────── entidades ─────────────────────────

  spawnUnit(kind: Kind, x: number, y: number, emit = true): Unit {
    const stats = statsOf(kind);
    const cls = isClass(kind) ? kind : null;
    const u: Unit = {
      id: this.nextId++, kind, team: cls ? 'ally' : 'enemy', isPlayer: false,
      x, y, vx: 0, vy: 0, yaw: 0, pitch: 0, radius: stats.radius,
      hp: stats.hp, maxHp: stats.hp, alive: true, deadAt: -1, crouch: false,
      mag: stats.magSize, magSize: stats.magSize, ammo: cls ? AMMO_START - Math.min(stats.magSize, AMMO_START) : ENEMY_AMMO - stats.magSize,
      reloading: 0, grenades: cls ? GRENADE_COUNT : 0,
      abilityCd: 0, abilityCdMax: cls === 'captain' || cls === 'technic' ? 20 : 25, abilityActive: 0,
      inventory: [null, null, null, null, null], invSel: 0,
      lastShotAt: -9, lastKnifeAt: -9, lastHurtAt: -9, aiState: '', bossPhase: kind === 'megaboss' ? 1 : 0,
      shielded: false, marked: false,
      stats, cls, ekind: cls ? null : (kind as EnemyKind),
      wishX: 0, wishY: 0, fireCd: 0, knifeCd: 0, grenadeCd: 0, stepAcc: 0,
      path: null, pathI: 0, goalX: x, goalY: y, repathAt: 0, navVer: -1, doorWait: 0,
      refX: x, refY: y, refT: this.time, stuckMax: 0, pinnedUntil: 0, noiseAt: -9, brain: null, spawnAt: this.time,
    };
    if (kind === 'miniboss' || kind === 'megaboss') u.ammo = 99999; // los jefes no se quedan sin munición (ver DECISIONES)
    this.entities.push(u);
    if (!cls) this.enemyAI?.register(u);
    if (emit) this.events.push({ type: 'spawn', id: u.id, kind });
    return u;
  }

  entityById(id: number): Unit | undefined {
    for (const e of this.entities) if (e.id === id) return e;
    return undefined;
  }
  enemiesAlive(): number {
    let n = 0;
    for (const e of this.entities) if (e.alive && e.team === 'enemy') n++;
    return n;
  }
  enemiesRemaining(): number { return this.enemiesAlive() + this.director.pending(); }
  allies(): Unit[] { return this.entities.filter(e => e.team === 'ally' && e.alive); }

  height(u: Entity): number {
    const h = statsOf(u.kind).height;
    return u.crouch ? (CROUCH_HEIGHT * h) / STAND_HEIGHT : h;
  }
  eyeZ(u: Entity): number { return this.height(u) - 0.2; }
  muzzleZ(u: Entity): number { return this.height(u) * 0.78; }

  /** ¿`a` tiene línea de visión con `b`? (cabeza o pecho). Sin cono: solo geometría. */
  canSee(a: Entity, b: Entity): boolean {
    const ez = this.eyeZ(a), h = this.height(b);
    return this.level.clear(a.x, a.y, ez, b.x, b.y, h - 0.15, 'sight') || this.level.clear(a.x, a.y, ez, b.x, b.y, h * 0.55, 'sight');
  }
  /** ¿Una bala de `a` puede llegar al cuerpo de `b`? Devuelve la altura a la que apuntar, o -1. */
  shotLine(a: Entity, b: Entity): number {
    const mz = this.muzzleZ(a), h = this.height(b);
    if (this.level.clear(a.x, a.y, mz, b.x, b.y, h * 0.6, 'bullet')) return h * 0.6;
    if (this.level.clear(a.x, a.y, mz, b.x, b.y, h - 0.15, 'bullet')) return h - 0.15;
    return -1;
  }

  // ───────────────────────── paso ─────────────────────────

  step(dt: number, input: PlayerInput): void {
    this.events.length = 0;
    this.noises.length = 0;
    this.time += dt;
    this.pathBudget = 4;
    this.soundBudget = 1;
    this.lastInput = input;
    if (this.status === 'playing') this.stats.time += dt;

    const p = this.player;
    if (p.alive) this.updatePlayer(dt, input);
    else { p.wishX = 0; p.wishY = 0; }
    // consumir flancos
    input.reload = input.grenade = input.ability = input.interact = input.useItem = input.cycleItem = false;
    input.order = null;

    for (const u of this.entities) {
      if (!u.alive) continue;
      this.tickTimers(u, dt);
      if (u.team === 'ally' && !u.isPlayer) allyThink(this, u, dt);
    }
    this.enemyAI.update(dt);
    this.moveUnits(dt);
    this.updateProjectiles(dt);
    this.updateAuras(dt);
    this.updatePickups();
    for (const d of this.level.doors) {
      const target = d.open ? 1 : 0;
      if (d.anim !== target) d.anim += Math.sign(target - d.anim) * Math.min(Math.abs(target - d.anim), dt * 5);
    }
    this.director.update(dt);
    this.updatePlayerField(false);
    this.computeCam(input.yaw, input.pitch, input.camDist);
    this.computeAim(input);
    this.interactDoor = p.alive ? this.level.nearestDoor(p.x, p.y, 1.5) : -1;
    const ft = this.order.targetId >= 0 ? this.entityById(this.order.targetId) : undefined;
    // al caer el blanco enfocado, vuelve la orden que había antes
    if (this.order.kind === 'focus' && (!ft || !ft.alive)) { this.order = this.prevOrder ? { ...this.prevOrder } : { kind: 'follow', x: p.x, y: p.y, targetId: -1 }; this.prevOrder = null; }
  }

  private tickTimers(u: Unit, dt: number): void {
    if (u.fireCd > 0) u.fireCd -= dt;
    if (u.knifeCd > 0) u.knifeCd -= dt;
    if (u.grenadeCd > 0) u.grenadeCd -= dt;
    if (u.abilityCd > 0) u.abilityCd = Math.max(0, u.abilityCd - dt);
    if (u.abilityActive > 0) u.abilityActive = Math.max(0, u.abilityActive - dt);
    if (u.reloading > 0) {
      u.reloading -= dt;
      if (u.reloading <= 0) {
        u.reloading = 0;
        const n = Math.min(u.magSize - u.mag, u.ammo);
        u.mag += n; u.ammo -= n;
      }
    }
  }

  startReload(u: Unit): boolean {
    if (u.reloading > 0 || u.mag >= u.magSize || u.ammo <= 0) return false;
    u.reloading = u.stats.reloadTime;
    this.events.push({ type: 'reload', id: u.id });
    return true;
  }

  // ───────────────────────── jugador ─────────────────────────

  private updatePlayer(dt: number, input: PlayerInput): void {
    const p = this.player;
    p.yaw = input.yaw; p.pitch = input.pitch;
    p.crouch = input.crouch;
    let f = input.moveF, r = input.moveR;
    const m = Math.hypot(f, r);
    if (m > 1) { f /= m; r /= m; }
    const sp = p.stats.speed * (p.crouch ? 0.5 : 1);
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    p.wishX = (cy * f - sy * r) * sp;
    p.wishY = (sy * f + cy * r) * sp;

    this.computeCam(input.yaw, input.pitch, input.camDist);
    this.computeAim(input);

    // habilidad Supresión: fuego sostenido automático
    const suppressing = p.cls === 'especialist' && p.abilityActive > 0;
    if ((input.fire || suppressing) && p.reloading <= 0) {
      if (p.mag > 0 || suppressing) {
        if (p.fireCd <= 0 && p.stats.explosive && Math.hypot(this.aim.x - p.x, this.aim.y - p.y) < 2.6) {
          // Seguro del lanzador: no dispara contra algo que tiene a menos de 2,6 m (estallaría en la cara).
          if (this.time - this.dryAt > 0.4) { this.dryAt = this.time; this.events.push({ type: 'dryfire', id: p.id }); }
        } else if (p.fireCd <= 0) {
          let tx = this.aim.x, ty = this.aim.y, tz = this.aim.z;
          if (input.aimAssist && this.assistId >= 0) {
            const t = this.entityById(this.assistId);
            if (t && t.alive) { tx = t.x; ty = t.y; tz = this.height(t) * 0.62; }
          }
          this.fire(p, tx, ty, tz, input.aimAssist ? 0.012 : 0.004, suppressing);
          p.fireCd = 1 / (p.stats.rof * (suppressing ? 2 : 1));
        }
      } else if (p.ammo > 0) this.startReload(p);
      else if (this.time - this.dryAt > 0.4) { this.dryAt = this.time; this.events.push({ type: 'dryfire', id: p.id }); }
    }
    if (suppressing) this.applySuppression(p);
    if (input.reload) this.startReload(p);
    if (input.knife && p.knifeCd <= 0) this.knife(p);
    if (input.grenade) this.throwGrenade(p, this.aim.x, this.aim.y);
    if (input.ability) this.useAbility(p);
    if (input.interact && this.interactDoor >= 0) this.toggleDoor(this.interactDoor, !this.level.doors[this.interactDoor].open, p);
    if (input.cycleItem) {
      for (let k = 1; k <= INVENTORY_SLOTS; k++) {
        const i = (p.invSel + k) % INVENTORY_SLOTS;
        if (p.inventory[i]) { p.invSel = i; break; }
      }
    }
    if (input.useItem) this.useItem(p, p.invSel);
    if (input.order) this.giveOrder(input.order);
  }

  giveOrder(kind: OrderKind): void {
    const p = this.player;
    if (kind === 'follow') this.order = { kind, x: p.x, y: p.y, targetId: -1 };
    else if (kind === 'hold') this.order = { kind, x: p.x, y: p.y, targetId: -1 };
    else if (kind === 'goto') {
      // el punto del suelo al que mira la mira; si es un muro, justo delante
      let x = this.aim.x, y = this.aim.y;
      const c = this.level.nearestFree(x, y, true, 8);
      if (c >= 0) { x = this.level.cellX(c); y = this.level.cellY(c); }
      this.order = { kind, x, y, targetId: -1 };
    } else {
      let id = this.aim.entityId;
      if (id < 0) id = this.assistId;
      if (id < 0) id = this.nearestEnemyInFront(p, 0.6, 40);
      if (id < 0) { this.events.push({ type: 'order', order: 'follow', x: p.x, y: p.y }); this.order = { kind: 'follow', x: p.x, y: p.y, targetId: -1 }; return; }
      const t = this.entityById(id)!;
      for (const e of this.entities) e.marked = false;
      t.marked = true;
      if (this.order.kind !== 'focus') this.prevOrder = { ...this.order };
      this.order = { kind, x: t.x, y: t.y, targetId: id };
    }
    this.events.push({ type: 'order', order: this.order.kind, x: this.order.x, y: this.order.y });
  }

  private nearestEnemyInFront(u: Unit, halfAngle: number, range: number): number {
    let best = -1, bs = Infinity;
    for (const e of this.entities) {
      if (!e.alive || e.team === u.team) continue;
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      if (d > range) continue;
      const a = Math.abs(angDiff(Math.atan2(e.y - u.y, e.x - u.x), u.yaw));
      if (a > halfAngle || !this.canSee(u, e)) continue;
      const s = a * 20 + d;
      if (s < bs) { bs = s; best = e.id; }
    }
    return best;
  }

  // ───────────────────────── cámara y mira ─────────────────────────

  private computeCam(yaw: number, pitch: number, dist: number): void {
    const p = this.player, L = this.level;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const headZ = this.height(p) - 0.2;
    // pivote sobre el hombro derecho
    let px = p.x - sy * 0.55, py = p.y + cy * 0.55;
    const ts = L.ray(p.x, p.y, headZ, px, py, headZ, 'bullet');
    if (ts < 1) { const k = Math.max(0, ts - 0.35); px = p.x - sy * 0.55 * k; py = p.y + cy * 0.55 * k; }
    const pz = headZ + 0.5; // por encima de las cabezas de la escuadra, que va detrás
    const d = Math.max(1, Math.min(9, dist || 4.2));
    let cx = px - cy * cp * d, cyy = py - sy * cp * d, cz = pz - sp * d;
    if (cz < 0.35) cz = 0.35;
    if (!this.cheats.noclip) {
      const t = L.ray(px, py, pz, cx, cyy, cz, 'sight');
      if (t < 1) {
        const k = Math.max(0.05, t - 0.25 / d);
        cx = px + (cx - px) * k; cyy = py + (cyy - py) * k; cz = pz + (cz - pz) * k;
      }
    }
    // Arrinconada contra una pared: en vez de meterse en la nuca del personaje, sube y mira por encima.
    const da = Math.hypot(cx - px, cyy - py, cz - pz);
    if (da < 2.2) cz += (2.2 - da) * 0.55;
    this.cam.x = cx; this.cam.y = cyy; this.cam.z = cz; this.cam.yaw = yaw; this.cam.pitch = pitch;
  }

  private computeAim(input: PlayerInput): void {
    const c = this.cam, p = this.player;
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const R = 60;
    const ex = c.x + cy * cp * R, ey = c.y + sy * cp * R, ez = c.z + sp * R;
    let t = this.level.ray(c.x, c.y, c.z, ex, ey, ez, 'bullet');
    let id = -1;
    // la mira no debe engancharse en lo que hay entre la cámara y el personaje
    const back = Math.hypot(p.x - c.x, p.y - c.y) / R;
    const hit = this.rayUnits(c.x, c.y, c.z, ex, ey, ez, 'enemy', t, back);
    if (hit) { t = hit.t; id = hit.u.id; }
    if (t < back) t = Math.max(t, back + 2 / R);
    this.aim.x = c.x + (ex - c.x) * t; this.aim.y = c.y + (ey - c.y) * t; this.aim.z = Math.max(0, c.z + (ez - c.z) * t);
    this.aim.entityId = id;

    // apuntado asistido: mejor blanco cerca de la mira
    this.assist = null; this.assistId = -1;
    let best = 0.26;
    for (const e of this.entities) {
      if (!e.alive || e.team !== 'enemy') continue;
      const dx = e.x - c.x, dy = e.y - c.y, dz = this.height(e) * 0.62 - c.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > WEAPON_RANGE + 6 || d < 0.5) continue;
      const dot = (dx * cy * cp + dy * sy * cp + dz * sp) / d;
      const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
      // más permisivo de cerca
      const lim = Math.min(0.5, 0.2 + 1.2 / d);
      if (ang > lim || ang >= best) continue;
      if (this.shotLine(p, e) < 0) continue;
      best = ang; this.assistId = e.id;
      this.assist = { yaw: Math.atan2(dy, dx), pitch: Math.atan2(dz, Math.hypot(dx, dy)) };
    }
    void input;
  }

  // ───────────────────────── disparos ─────────────────────────

  /** Rayo contra los cuerpos de un equipo. tMax: fracción hasta donde mirar. */
  rayUnits(ox: number, oy: number, oz: number, ex: number, ey: number, ez: number, team: Team | 'any', tMax: number, tMin = 0, ignore: Unit | null = null):
    { u: Unit; t: number; zone: HitZone } | null {
    const dx = ex - ox, dy = ey - oy, dz = ez - oz;
    const a = dx * dx + dy * dy;
    if (a < 1e-9) return null;
    let best: { u: Unit; t: number; zone: HitZone } | null = null;
    for (const u of this.entities) {
      if (!u.alive || u === ignore || (team !== 'any' && u.team !== team)) continue;
      const r = u.radius * 0.9;
      const fx = ox - u.x, fy = oy - u.y;
      const b = 2 * (dx * fx + dy * fy);
      const c = fx * fx + fy * fy - r * r;
      const disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      let t0 = (-b - sq) / (2 * a);
      const t1 = (-b + sq) / (2 * a);
      if (t1 < tMin) continue;
      if (t0 < tMin) t0 = tMin;
      if (t0 > tMax || (best && t0 >= best.t)) continue;
      const h = this.height(u);
      const tm = Math.max(t0, Math.min(t1, -b / (2 * a)));
      const z = oz + dz * tm;
      if (z < 0 || z > h) continue;
      const lat = Math.sqrt(Math.max(0, fx * fx + fy * fy - (b * b) / (4 * a)));
      let zone: HitZone = 'torso';
      if (z > h * 0.82) zone = 'head';
      else if (z < h * 0.42 || lat > r * 0.62) zone = 'limb';
      best = { u, t: t0, zone };
    }
    return best;
  }

  /**
   * Dispara desde `u` hacia el punto (tx,ty,tz) con dispersión angular `spread` (rad, sigma).
   * Las balas normales no hieren a los del propio equipo; las explosiones sí.
   */
  fire(u: Unit, tx: number, ty: number, tz: number, spread: number, free = false): void {
    if (!free) u.mag--;
    u.lastShotAt = this.time;
    if (u.isPlayer) this.stats.shotsFired++;
    const oz = this.muzzleZ(u);
    let dx = tx - u.x, dy = ty - u.y, dz = tz - oz;
    const hd = Math.hypot(dx, dy) || 1e-6;
    let yaw = Math.atan2(dy, dx), pitch = Math.atan2(dz, hd);
    yaw += this.gauss() * spread; pitch += this.gauss() * spread * 0.6;
    dx = Math.cos(yaw) * Math.cos(pitch); dy = Math.sin(yaw) * Math.cos(pitch); dz = Math.sin(pitch);
    const R = WEAPON_RANGE;
    const ex = u.x + dx * R, ey = u.y + dy * R, ez = oz + dz * R;
    let t = this.level.ray(u.x, u.y, oz, ex, ey, ez, 'bullet');
    const other: Team = u.team === 'ally' ? 'enemy' : 'ally';
    const hit = this.rayUnits(u.x, u.y, oz, ex, ey, ez, other, t);
    let kind: 'none' | 'wall' | 'entity' = t < 1 ? 'wall' : 'none';
    if (hit) { t = hit.t; kind = 'entity'; }
    const ix = u.x + (ex - u.x) * t, iy = u.y + (ey - u.y) * t, iz = Math.max(0, oz + (ez - oz) * t);
    this.events.push({ type: 'shot', id: u.id, kind: u.kind, team: u.team, fx: u.x + dx * 0.5, fy: u.y + dy * 0.5, fz: oz, tx: ix, ty: iy, tz: iz, hit: kind });
    if (this.time - u.noiseAt > 0.35) { u.noiseAt = this.time; this.noises.push({ x: u.x, y: u.y, loud: 30, team: u.team, id: u.id, kind: 'shot' }); }
    if (u.stats.explosive) {
      // retrocede un poco del muro para que la explosión no nazca dentro
      const bk = Math.min(0.2, t * R);
      this.explode(ix - dx * bk, iy - dy * bk, Math.max(0.2, iz - dz * bk), BLAST_RADIUS, u.stats.damage, u, hit ? hit.u : null);
      if (hit && u.isPlayer) this.stats.shotsHit++;
      return;
    }
    if (hit) {
      // «Apuntar importa» (§13) premia a quien apunta: la escuadra. Los enemigos no multiplican por zona
      // (un ×2,5 fortuito de 40 tiradores a la vez mataba sin que el jugador pudiera hacer nada). Ver DECISIONES.
      const mult = u.team === 'enemy' ? 1 : hit.zone === 'head' ? HEAD_MULT : hit.zone === 'limb' ? LIMB_MULT : 1;
      if (u.isPlayer) this.stats.shotsHit++;
      this.damage(hit.u, u.stats.damage * mult, u, hit.zone, u.x, u.y);
    }
  }

  /** Explosión con daño a TODOS (también amigos y a uno mismo), caída lineal y línea de visión obligatoria. */
  explode(x: number, y: number, z: number, radius: number, maxDmg: number, owner: Unit | null, direct: Unit | null = null): void {
    this.events.push({ type: 'explosion', x, y, z, radius });
    this.noises.push({ x, y, loud: 42, team: owner ? owner.team : 'ally', id: owner ? owner.id : -1, kind: 'blast' });
    for (const e of this.entities) {
      if (!e.alive) continue;
      const d = e === direct ? 0 : Math.max(0, Math.hypot(e.x - x, e.y - y) - e.radius * 0.5);
      if (d >= radius) continue;
      if (e !== direct) {
        const h = this.height(e);
        const zz = Math.max(0.3, z);
        if (!this.level.clear(x, y, zz, e.x, e.y, h * 0.5, 'bullet') && !this.level.clear(x, y, zz, e.x, e.y, h - 0.15, 'bullet')) continue;
      }
      this.damage(e, maxDmg * (1 - d / radius), owner, 'blast', x, y);
    }
  }

  knife(u: Unit): void {
    u.knifeCd = KNIFE_PERIOD;
    u.lastKnifeAt = this.time;
    let best: Unit | null = null, bd = Infinity;
    for (const e of this.entities) {
      if (!e.alive || e.team === u.team) continue;
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      if (d > u.radius + KNIFE_RANGE + e.radius * 0.5) continue;
      if (Math.abs(angDiff(Math.atan2(e.y - u.y, e.x - u.x), u.yaw)) > 1.1) continue;
      if (!this.level.clear(u.x, u.y, 1.1, e.x, e.y, Math.min(1.1, this.height(e) * 0.7), 'bullet')) continue;
      if (d < bd) { bd = d; best = e; }
    }
    this.events.push({ type: 'knife', id: u.id, hit: !!best });
    if (best) {
      const dmg = u.team === 'ally' ? KNIFE_DAMAGE : (u.ekind === 'enemy1' ? 6 : u.ekind === 'enemy2' ? 8 : 10);
      this.damage(best, dmg, u, 'knife', u.x, u.y);
    }
  }

  throwGrenade(u: Unit, tx: number, ty: number): boolean {
    if (u.grenades <= 0 || u.grenadeCd > 0) return false;
    u.grenades--; u.grenadeCd = GRENADE_COOLDOWN;
    this.launch(u, 'grenade', tx, ty, 18);
    return true;
  }

  /** Lanza un proyectil en parábola hacia (tx,ty). */
  launch(u: Unit, kind: 'grenade' | 'rocket', tx: number, ty: number, maxDist: number): void {
    let dx = tx - u.x, dy = ty - u.y;
    let d = Math.hypot(dx, dy);
    if (d > maxDist) { dx *= maxDist / d; dy *= maxDist / d; d = maxDist; }
    if (d < 0.5) { dx = Math.cos(u.yaw) * 0.5; dy = Math.sin(u.yaw) * 0.5; d = 0.5; }
    const z0 = this.muzzleZ(u);
    const T = kind === 'rocket' ? Math.max(0.6, d / 9) : Math.max(0.45, Math.min(1.2, d / 13));
    const g = kind === 'rocket' ? 2 : 9.8;
    this.projectiles.push({
      id: this.nextId++, kind, ownerId: u.id, team: u.team, x: u.x, y: u.y, z: z0,
      vx: dx / T, vy: dy / T, vz: (0.1 - z0 + 0.5 * g * T * T) / T, fuse: T + (kind === 'grenade' ? 0.3 : 0.02), dead: false,
    });
    this.events.push({ type: 'throw', id: u.id, kind });
  }

  private updateProjectiles(dt: number): void {
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      const g = pr.kind === 'rocket' ? 2 : 9.8;
      const moving = pr.vx !== 0 || pr.vy !== 0 || pr.vz !== 0;
      let boom = false;
      if (moving) {
        const nx = pr.x + pr.vx * dt, ny = pr.y + pr.vy * dt;
        let nz = pr.z + pr.vz * dt;
        pr.vz -= g * dt;
        const t = this.level.ray(pr.x, pr.y, Math.max(0.05, pr.z), nx, ny, Math.max(0.05, nz), 'bullet');
        if (t < 1) {
          // choca: se queda ahí (la granada cae al suelo; el cohete estalla)
          pr.x += (nx - pr.x) * Math.max(0, t - 0.1); pr.y += (ny - pr.y) * Math.max(0, t - 0.1);
          pr.vx = pr.vy = 0;
          if (pr.kind === 'rocket') boom = true;
        } else { pr.x = nx; pr.y = ny; }
        if (nz <= 0.1) { nz = 0.1; pr.vx = pr.vy = pr.vz = 0; if (pr.kind === 'rocket') boom = true; }
        pr.z = nz;
        if (pr.kind === 'rocket') {
          // el cohete estalla al tocar a alguien del otro bando
          for (const e of this.entities) {
            if (e.alive && e.team !== pr.team && Math.hypot(e.x - pr.x, e.y - pr.y) < e.radius + 0.15 && pr.z < this.height(e)) { boom = true; break; }
          }
        }
      }
      pr.fuse -= dt;
      if (pr.fuse <= 0 || boom) {
        pr.dead = true;
        const owner = this.entityById(pr.ownerId) ?? null;
        const dmg = pr.kind === 'grenade' ? GRENADE_DAMAGE : 30;
        this.explode(pr.x, pr.y, Math.max(0.3, pr.z), BLAST_RADIUS, dmg, owner);
      }
    }
    if (this.projectiles.length > 0 && this.projectiles[0].dead) this.projectiles = this.projectiles.filter(p => !p.dead);
  }

  damage(t: Unit, amount: number, attacker: Unit | null, zone: HitZone | 'blast' | 'knife', fromX: number, fromY: number): void {
    if (!t.alive || amount <= 0) return;
    if (t.isPlayer && this.cheats.god) return;
    if (t.team === 'ally' && this.status === 'cleared') return; // zona limpia: un cohete rezagado ya no te quita la victoria
    if (t.shielded) return;
    if (t.kind === 'megaboss') amount = this.director.bossDamageGate(t, amount);
    if (amount <= 0) return;
    t.hp -= amount;
    t.lastHurtAt = this.time;
    if (t.isPlayer) this.stats.damageTaken += amount;
    this.events.push({ type: 'hurt', id: t.id, amount, zone, fromX, fromY, attackerId: attacker ? attacker.id : -1 });
    if (t.team === 'enemy') this.enemyAI.onHurt(t, attacker, fromX, fromY);
    else if (t.brain) { t.brain.hurtAt = this.time; t.brain.hurtBy = attacker ? attacker.id : -1; }
    if (t.hp <= 0) this.kill(t, attacker);
  }

  kill(t: Unit, attacker: Unit | null = null): void {
    if (!t.alive) return;
    t.hp = 0; t.alive = false; t.deadAt = this.time; t.wishX = t.wishY = 0; t.vx = t.vy = 0; t.marked = false; t.shielded = false;
    this.events.push({ type: 'death', id: t.id, kind: t.kind, team: t.team, x: t.x, y: t.y });
    if (t.team === 'enemy') {
      this.score += t.stats.points; this.stats.scoreGained += t.stats.points; this.stats.kills++;
      this.enemyAI.onDeath(t);
      // botín ocasional (ver DECISIONES): evita quedarse sin munición si cae el Especialista
      const boss = t.kind === 'miniboss' || t.kind === 'megaboss';
      const r = this.rng();
      if (boss || r < 0.22) {
        this.pickups.push({ id: this.nextId++, type: boss ? 'vida_50' : r < 0.12 ? 'municion_20' : 'vida_20', x: t.x, y: t.y, taken: false });
      }
    } else if (t.isPlayer) {
      this.status = 'dead';
      this.events.push({ type: 'playerDead' });
    } else if (t.cls) {
      this.stats.alliesLost++;
      this.morale = Math.max(0, this.morale - 30);
    }
    void attacker;
  }

  gauss(): number {
    // suma de tres uniformes: barato y suficientemente acampanado
    return (this.rng() + this.rng() + this.rng() - 1.5) * 1.15;
  }

  // ───────────────────────── habilidades ─────────────────────────

  useAbility(u: Unit): boolean {
    if (u.abilityCd > 0 || !u.cls) return false;
    let ok = false;
    let ax = u.x, ay = u.y;
    if (u.cls === 'captain') {
      let id = u.isPlayer ? this.aim.entityId : -1;
      if (id < 0 && u.isPlayer) id = this.assistId;
      if (id < 0) id = this.nearestEnemyInFront(u, u.isPlayer ? 0.7 : Math.PI, 40);
      const t = id >= 0 ? this.entityById(id) : undefined;
      if (t && t.alive) {
        for (const e of this.entities) e.marked = false;
        t.marked = true; // los compañeros priorizan al marcado
        // Solo el jugador cambia la orden de escuadra; el Capitán IA marca el blanco sin pisar «mantener» o «ir ahí».
        if (u.isPlayer) { if (this.order.kind !== 'focus') this.prevOrder = { ...this.order }; this.order = { kind: 'focus', x: t.x, y: t.y, targetId: t.id }; }
        ax = t.x; ay = t.y; ok = true;
        this.morale = Math.min(100, this.morale + 5);
      }
      this.events.push({ type: 'ability', id: u.id, ability: 'orders', ok, x: ax, y: ay });
    } else if (u.cls === 'technic') {
      // puerta cerrada a la que se apunta (o la más cercana delante y a la vista), hasta 30 m
      let best = -1, bs = Infinity;
      for (const d of this.level.doors) {
        if (d.open) continue;
        const dist = Math.hypot(d.cx - u.x, d.cy - u.y);
        if (dist > 30) continue;
        const a = Math.abs(angDiff(Math.atan2(d.cy - u.y, d.cx - u.x), u.yaw));
        if (a > 0.9) continue;
        // hay que verla: el rayo debe llegar hasta la propia puerta
        const t = this.level.ray(u.x, u.y, 1.5, d.cx, d.cy, 1.5, 'sight');
        if (t * dist < dist - 0.6) continue;
        const s = a * 15 + dist;
        if (s < bs) { bs = s; best = d.id; }
      }
      if (best >= 0) { this.toggleDoor(best, true, u); ok = true; ax = this.level.doors[best].cx; ay = this.level.doors[best].cy; }
      this.events.push({ type: 'ability', id: u.id, ability: 'hack', ok, x: ax, y: ay });
    } else if (u.cls === 'especialist') {
      u.abilityActive = 6; ok = true;
      this.events.push({ type: 'ability', id: u.id, ability: 'suppress', ok, x: ax, y: ay });
    } else {
      const R = 6;
      const ex = u.x + Math.cos(u.yaw) * R, ey = u.y + Math.sin(u.yaw) * R;
      // no vale si antes hay fachada u otra cosa sólida que no sea un muro interior: lo decide breach()
      const pt = this.level.breach(u.x, u.y, ex, ey, 1.9);
      if (pt) {
        ok = true; ax = pt[0]; ay = pt[1];
        this.events.push({ type: 'breach', x: ax, y: ay });
        this.events.push({ type: 'explosion', x: ax, y: ay, z: 1.2, radius: 2.2 });
        this.noises.push({ x: ax, y: ay, loud: 45, team: u.team, id: u.id, kind: 'blast' });
        // daño de la voladura al otro lado (y a quien esté pegado)
        for (const e of this.entities) {
          if (!e.alive || e === u) continue;
          const d = Math.hypot(e.x - ax, e.y - ay);
          if (d < 2.2 && e.team !== u.team) this.damage(e, 40 * (1 - d / 2.2), u, 'blast', ax, ay);
        }
        this.doorVer++;
        this.updatePlayerField(true);
      }
      this.events.push({ type: 'ability', id: u.id, ability: 'demolition', ok, x: ax, y: ay });
    }
    if (ok) u.abilityCd = u.abilityCdMax;
    return ok;
  }

  /** Supresión: clava a los enemigos a la vista dentro de un cono de 35° y 28 m. */
  applySuppression(u: Unit): void {
    for (const e of this.entities) {
      if (!e.alive || e.team === u.team) continue;
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      if (d > 28) continue;
      if (Math.abs(angDiff(Math.atan2(e.y - u.y, e.x - u.x), u.yaw)) > 0.6) continue;
      if (!this.level.clear(u.x, u.y, 1.4, e.x, e.y, 1.5, 'sight')) continue;
      e.pinnedUntil = this.time + 1.2;
    }
  }

  // ───────────────────────── puertas, objetos, auras ─────────────────────────

  toggleDoor(id: number, open: boolean, by: Unit | null): boolean {
    const d = this.level.doors[id];
    if (!d || d.open === open) return false;
    if (!open) {
      // no se cierra con alguien en el hueco
      for (const e of this.entities) {
        if (e.alive && e.x > d.x0 - 0.45 && e.x < d.x1 + 0.45 && e.y > d.y0 - 0.45 && e.y < d.y1 + 0.45) return false;
      }
    }
    this.level.setDoor(id, open);
    this.doorVer++;
    this.events.push({ type: 'door', doorId: id, open, x: d.cx, y: d.cy });
    this.noises.push({ x: d.cx, y: d.cy, loud: 11, team: by ? by.team : 'ally', id: by ? by.id : -1, kind: 'door' });
    this.pFieldDirty = true;
    return true;
  }

  useItem(u: Unit, slot: number): boolean {
    const it = u.inventory[slot];
    if (!it) return false;
    if (!this.applyItem(u, it)) return false;
    u.inventory[slot] = null;
    this.events.push({ type: 'itemUsed', id: u.id, item: it });
    if (u.isPlayer) {
      for (let k = 0; k < INVENTORY_SLOTS; k++) { const i = (slot + k) % INVENTORY_SLOTS; if (u.inventory[i]) { u.invSel = i; break; } }
    }
    return true;
  }

  /** Aplica el efecto. La vida no pasa del máximo de la clase. Devuelve false si no serviría de nada. */
  applyItem(u: Unit, it: ItemType): boolean {
    const e = ITEM_EFFECT[it];
    if (e.hp > 0) {
      if (u.hp >= u.maxHp) return false;
      u.hp = Math.min(u.maxHp, u.hp + e.hp);
    } else {
      if (u.ammo + u.mag >= AMMO_CAP) return false;
      u.ammo = Math.min(AMMO_CAP - u.mag, u.ammo + e.ammo);
    }
    return true;
  }

  private updatePickups(): void {
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      for (const u of this.entities) {
        if (!u.alive || u.team !== 'ally') continue;
        if (Math.abs(u.x - pk.x) > 0.85 || Math.abs(u.y - pk.y) > 0.85 || Math.hypot(u.x - pk.x, u.y - pk.y) > 0.85) continue;
        const free = u.inventory.indexOf(null);
        if (free >= 0) { u.inventory[free] = pk.type; if (!u.inventory[u.invSel]) u.invSel = free; }
        else if (!this.applyItem(u, pk.type)) continue; // inventario lleno y no hace falta: se queda en el suelo
        pk.taken = true;
        this.events.push({ type: 'pickup', id: u.id, item: pk.type, x: pk.x, y: pk.y });
        break;
      }
    }
  }

  private updateAuras(dt: number): void {
    this.auraHpAcc += dt; this.auraAmmoAcc += dt;
    const allies = this.entities.filter(e => e.alive && e.team === 'ally');
    if (this.auraHpAcc >= 2) {
      this.auraHpAcc -= 2;
      const cap = allies.find(a => a.cls === 'captain');
      if (cap) {
        // la moral sube con el aura del Capitán; con la moral hundida el aura no cura
        this.morale = Math.min(100, this.morale + 1);
        if (this.morale >= 20) {
          for (const a of allies) if (Math.hypot(a.x - cap.x, a.y - cap.y) <= AURA_RADIUS) a.hp = Math.min(a.maxHp, a.hp + 1);
        }
      }
    }
    if (this.auraAmmoAcc >= 4) {
      this.auraAmmoAcc -= 4;
      const sp = allies.find(a => a.cls === 'especialist');
      if (sp) for (const a of allies) {
        if (Math.hypot(a.x - sp.x, a.y - sp.y) <= AURA_RADIUS) a.ammo = Math.min(AMMO_CAP - a.mag, a.ammo + 10);
      }
    }
    // los compañeros usan su inventario solos (§5.2)
    for (const a of allies) {
      if (a.isPlayer || !a.cls) continue;
      const th = ALLY_ITEM_THRESHOLDS[a.cls];
      if (a.hp < th.hp) { const i = a.inventory.findIndex(it => !!it && ITEM_EFFECT[it].hp > 0); if (i >= 0) this.useItem(a, i); }
      if (a.ammo + a.mag < th.ammo) { const i = a.inventory.findIndex(it => !!it && ITEM_EFFECT[it].ammo > 0); if (i >= 0) this.useItem(a, i); }
    }
  }

  // ───────────────────────── movimiento ─────────────────────────

  /**
   * Lleva a `u` andando hacia (tx,ty) a `speed` m/s siguiendo un camino. Devuelve true al llegar.
   * Abre las puertas cerradas que encuentre. `penalty`: mapa de exposición para rutas de flanqueo.
   */
  navigate(u: Unit, tx: number, ty: number, speed: number, penalty: Float32Array | null = null, arrive = 0.35): boolean {
    const d = Math.hypot(tx - u.x, ty - u.y);
    if (d < arrive) { u.wishX = u.wishY = 0; u.path = null; return true; }
    // Casi ha llegado pero no puede acercarse más (otro cuerpo en el sitio, un mueble pegado): vale como llegar.
    if (d < arrive + 0.9 && this.time - u.refT > 0.5 && this.time - u.spawnAt > 1) { u.wishX = u.wishY = 0; u.path = null; u.refT = this.time; return true; }
    const L = this.level;
    const moved = Math.hypot(tx - u.goalX, ty - u.goalY) > 1.0;
    if (!u.path || moved || this.time >= u.repathAt || u.navVer !== L.version) {
      if (this.pathBudget > 0) {
        this.pathBudget--;
        u.path = this.nav.path(u.x, u.y, tx, ty, { doors: true, penalty });
        u.pathI = 0; u.goalX = tx; u.goalY = ty; u.navVer = L.version;
        u.repathAt = this.time + (u.path ? 2.5 + this.rng() * 2 : 0.8 + this.rng() * 0.5);
      } else if (moved) u.path = null;
    }
    if (!u.path || u.path.length === 0) {
      // sin camino (o sin presupuesto este paso): solo avanza en recta si es transitable
      if (d < 3 && L.walkLine(u.x, u.y, tx, ty, false)) { u.wishX = ((tx - u.x) / d) * speed; u.wishY = ((ty - u.y) / d) * speed; }
      else { u.wishX = u.wishY = 0; }
      return false;
    }
    const p = u.path;
    while (u.pathI < p.length - 1 && Math.hypot(p[u.pathI][0] - u.x, p[u.pathI][1] - u.y) < 0.3) u.pathI++;
    if (!penalty && u.pathI < p.length - 1 && L.walkLine(u.x, u.y, p[u.pathI + 1][0], p[u.pathI + 1][1], false)) u.pathI++;
    const w = p[u.pathI];
    let dx = w[0] - u.x, dy = w[1] - u.y;
    const l = Math.hypot(dx, dy);
    if (l < 0.3 && u.pathI >= p.length - 1) { u.wishX = u.wishY = 0; u.path = null; return d < arrive + 0.4; }
    dx /= l || 1; dy /= l || 1;
    // ¿puerta cerrada justo delante?
    for (let s = 0.3; s <= 1.2; s += 0.3) {
      if (s > l + 0.3) break;
      const c = L.cellOf(u.x + dx * s, u.y + dy * s);
      const dc = c >= 0 ? L.doorCell[c] : 0;
      if (dc && !L.doors[dc - 1].open) {
        u.wishX = u.wishY = 0;
        u.doorWait += 1 / 60;
        u.refT = this.time; // esperar a una puerta no es estar atascado
        if (u.doorWait > 0.45) { this.toggleDoor(dc - 1, true, u); u.doorWait = 0; }
        return false;
      }
    }
    u.doorWait = 0;
    u.wishX = dx * speed; u.wishY = dy * speed;
    return false;
  }

  private moveUnits(dt: number): void {
    const ents = this.entities;
    for (const u of ents) {
      if (!u.alive) continue;
      const k = Math.min(1, dt * 14);
      u.vx += (u.wishX - u.vx) * k; u.vy += (u.wishY - u.vy) * k;
      u.x += u.vx * dt; u.y += u.vy * dt;
    }
    // separación entre cuerpos
    for (let i = 0; i < ents.length; i++) {
      const a = ents[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < ents.length; j++) {
        const b = ents[j];
        if (!b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        // entre IAs del mismo bando se dejan apretar (si no, dos grupos se taponan en una puerta de 1,33 m)
        const rr = (a.radius + b.radius) * (a.team === b.team && !a.isPlayer && !b.isPlayer ? 0.55 : 1);
        if (Math.abs(dx) >= rr || Math.abs(dy) >= rr) continue;
        const d = Math.hypot(dx, dy);
        if (d >= rr) continue;
        const ov = (rr - d) * 0.5;
        let nx = dx / (d || 1), ny = dy / (d || 1);
        if (d < 1e-4) { nx = 1; ny = 0; }
        // el jugador empuja más de lo que le empujan; los jefes casi no se mueven
        const wa = a.isPlayer ? 0.25 : a.radius > 0.5 ? 0.1 : 0.5, wb = b.isPlayer ? 0.25 : b.radius > 0.5 ? 0.1 : 0.5;
        const s = wa + wb;
        a.x -= nx * ov * 2 * (wa / s); a.y -= ny * ov * 2 * (wa / s);
        b.x += nx * ov * 2 * (wb / s); b.y += ny * ov * 2 * (wb / s);
      }
    }
    for (const u of ents) {
      if (!u.alive) continue;
      if (!(u.isPlayer && this.cheats.noclip)) {
        // algo menos que el inflado de la rejilla: así un hueco de una celda nunca encaja el cuerpo contra dos esquinas
        this.level.resolve(u.x, u.y, NAV_RADIUS - 0.06, _v);
        u.x = _v[0]; u.y = _v[1];
      }
      // atascos: si quiere moverse y no avanza
      const wish = Math.hypot(u.wishX, u.wishY);
      if (wish < 0.3 || Math.hypot(u.x - u.refX, u.y - u.refY) > 0.35) { u.refX = u.x; u.refY = u.y; u.refT = this.time; }
      else if (!u.isPlayer) {
        const st = this.time - u.refT;
        if (st > u.stuckMax) u.stuckMax = st;
        if (st > 0.9) u.repathAt = 0; // pide otro camino
        if (st > 1.8) {
          if (this.onUnstuck) this.onUnstuck(u);
          // sácalo a la celda libre más cercana y oblígale a replantearse el destino
          const c = this.level.nearestFree(u.x, u.y, true); // desde donde está: nunca al otro lado de un tabique
          if (c >= 0) { u.x = this.level.cellX(c); u.y = this.level.cellY(c); }
          u.path = null; u.repathAt = 0; u.refT = this.time; u.refX = u.x; u.refY = u.y;
          if (u.brain) u.brain.unstuck = (u.brain.unstuck || 0) + 1;
        }
      }
      // pasos
      const sp = Math.hypot(u.vx, u.vy);
      if (sp > 0.5 && !u.crouch) {
        u.stepAcc += sp * dt;
        if (u.stepAcc > 1.7) {
          u.stepAcc = 0;
          this.events.push({ type: 'step', id: u.id, x: u.x, y: u.y });
          if (u.team === 'ally') this.noises.push({ x: u.x, y: u.y, loud: u.isPlayer ? 6 : 4, team: 'ally', id: u.id, kind: 'step' });
        }
      }
    }
  }

  // ───────────────────────── campos de distancia y sonido ─────────────────────────

  private updatePlayerField(force: boolean): void {
    const p = this.player;
    if (!force && this.pFieldVer === this.level.version && this.pFieldAt >= 0 &&
      (this.time - this.pFieldAt < 0.4 || (!this.pFieldDirty && Math.hypot(p.x - this.pFieldX, p.y - this.pFieldY) < 0.4))) return;
    this.pFieldDirty = false;
    if (this.pField.length !== this.level.gw * this.level.gh) this.pField = new Float32Array(this.level.gw * this.level.gh);
    this.nav.field(p.x, p.y, true, 3, Infinity, this.pField);
    this.pFieldAt = this.time; this.pFieldX = p.x; this.pFieldY = p.y; this.pFieldVer = this.level.version;
  }

  /** Distancia andando desde (x,y) hasta el jugador. Infinity si no se puede llegar. */
  walkDistToPlayer(x: number, y: number): number {
    const c = this.level.cellOf(x, y);
    return c >= 0 ? this.pField[c] : Infinity;
  }

  /**
   * Distancia que recorre un sonido de (sx,sy) a (lx,ly) «por donde se puede andar».
   * Una puerta cerrada amortigua (cuenta como 6 m). Devuelve Infinity si no llega o si no hay presupuesto.
   */
  soundDist(sx: number, sy: number, lx: number, ly: number, maxDist: number): number {
    const L = this.level;
    const key = Math.floor(sx / 1.5) * 4096 + Math.floor(sy / 1.5);
    let e = this.soundFields.get(key);
    if (!e || this.time - e.t > 0.8 || e.ver !== L.version * 100000 + this.doorVer) {
      if (this.soundBudget <= 0) return Infinity; // restrictivo: si no se puede calcular, no se oye
      this.soundBudget--;
      const f = this.nav.field(sx, sy, true, 6, 48, e ? e.f : undefined);
      e = { f, t: this.time, ver: L.version * 100000 + this.doorVer };
      this.soundFields.set(key, e);
      if (this.soundFields.size > 24) { const first = this.soundFields.keys().next().value; if (first !== undefined && first !== key) this.soundFields.delete(first); }
    }
    const c = L.cellOf(lx, ly);
    if (c < 0) return Infinity;
    const d = e.f[c];
    return d <= maxDist ? d : Infinity;
  }

  aiDebug(): AiDebugInfo[] {
    if (!this.cheats.aiDebug) return [];
    const out: AiDebugInfo[] = [];
    for (const u of this.entities) {
      if (!u.alive || u.team !== 'enemy') continue;
      const b = u.brain;
      out.push({
        id: u.id, state: u.aiState,
        cones: [VISION.primaryHalfAngle, VISION.primaryRange, VISION.peripheralHalfAngle, VISION.peripheralRange],
        path: u.path ? u.path.slice(u.pathI) : [],
        belief: b && b.belief ? [b.belief.x, b.belief.y] : null,
        awareness: b ? b.aware : 0,
      });
    }
    return out;
  }

  /** Estado de los cuatro para guardar al terminar la zona. */
  memberSnapshot(): Partial<Record<ClassId, { hp: number; ammo: number; inv: (ItemType | null)[] }>> {
    const out: Partial<Record<ClassId, { hp: number; ammo: number; inv: (ItemType | null)[] }>> = {};
    for (const u of this.entities) {
      if (!u.cls || u.brain?.extra) continue;
      out[u.cls] = { hp: u.alive ? Math.max(1, Math.round(u.hp)) : 0, ammo: u.mag + u.ammo, inv: u.inventory.slice() };
    }
    return out;
  }
}

export { CLASS_STATS, ENEMY_STATS };
