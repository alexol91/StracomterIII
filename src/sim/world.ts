// El mundo: entidades, combate, movimiento, puertas, objetos, auras, órdenes y cámara.
// La IA enemiga está en ai_enemy.ts, la de los compañeros en ai_ally.ts y el ritmo de apariciones en director.ts.

import type { CampaignState, IWorld } from '../contracts';
import {
  ALLY_ITEM_THRESHOLDS, AMMO_CAP, AMMO_START, AURA_RADIUS, BLAST_RADIUS, CLASS_STATS, CROUCH_HEIGHT, ENEMY_AMMO,
  ENEMY_STATS, GRENADE_COOLDOWN, GRENADE_COUNT, GRENADE_DAMAGE, HEAD_MULT, INVENTORY_SLOTS, ITEM_EFFECT,
  KNIFE_DAMAGE, KNIFE_PERIOD, KNIFE_RANGE, LIMB_MULT, STAND_HEIGHT, UnitStats, VISION, WEAPON_RANGE, isClass, statsOf,
  BARK_COOLDOWN, BOUNCER, MUTATOR_SPEED, NG_PLUS, OBJECTIVE, UPGRADES, BURST_RIFLE, DOWNED, FLASH, PING_DOOR_RANGE, PRIMARY_VARIANTS, ROLL, SHOTGUN, SMOKE, SNIPER, TACTICAL_START, variantStats,
  AIM_SPEED_MULT, CAM_DIST_AIM, FOV_AIM, FOV_NORMAL, GUN_FEEL, RECOIL_MAX_PITCH, RECOIL_MAX_YAW, RECOIL_RECOVER, SHOULDER_AIM,
  SHOULDER_NORMAL, SPRINT_MULT, DRAW_TIME, PISTOL, PISTOL_FEEL, WEAPON_SPEED, SPRINT_RAISE, STAGGER_COOLDOWN, STAGGER_TIME, computeMods, type Mods,
} from './data';
import { allyThink } from './ai_ally';
import { EnemyAI, damageTakenMult } from './ai_enemy';
import { Director, DirectorConfig } from './director';
import { Level, NAV_RADIUS } from './level';
import { Nav } from './nav';
import type {
  AiDebugInfo, ClassId, EnemyKind, Entity, GameEvent, HitZone, ItemType, Kind, MapDef, OrderKind, Pickup,
  GrenadeType, HordeState, Objective, ObjectiveKind, PlayerInput, Projectile, SmokeCloud, Team, Threat, Vec2, WeaponSlot, WorldStatus, ZoneStats,
} from './types';
import { WEAPON_SLOTS } from './types';

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
  /** v1.2 — world.time del último aturdimiento (máx. uno cada STAGGER_COOLDOWN) */
  staggerAt: number;
  /** v1.3 — la recarga en curso conserva una bala en la recámara (había balas en el cargador al empezarla) */
  reloadChamber: boolean;
  /** v1.3 — instante del último intento de reanimación (para reiniciar el progreso si se interrumpe) */
  reviveAt: number;
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
  /** v1.2 — mejoras de campaña elegidas (ids de UPGRADES) */
  upgrades?: string[];
  /** v1.3 — variante del arma principal por clase (0 si falta) */
  loadout?: Partial<Record<ClassId, 0 | 1>>;
  /** v1.3 (oleada 2) — objetivo de la zona ('clear' o ausente = limpiar) */
  objective?: ObjectiveKind;
  /** modificadores activos (ids de MUTATORS) y vuelta (0/1) */
  mutators?: string[];
  ngPlus?: number;
  /** multiplicador de los puntos que dan los enemigos (modificadores × segunda vuelta) */
  scoreMult?: number;
  /** suministros comprados en la Armería para esta zona (los recibe el operador controlado) */
  bought?: { grenades: number; flashes: number; smokes: number };
  /** modo horda: el mundo lleva `horde` y el estado de campaña al que aplicar las mejoras elegidas */
  horde?: boolean;
  hordeState?: CampaignState;
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
  stats: ZoneStats = { time: 0, kills: 0, shotsFired: 0, shotsHit: 0, damageTaken: 0, alliesLost: 0, scoreGained: 0, headshots: 0, bestStreak: 0 };
  cam: { x: number; y: number; z: number; yaw: number; pitch: number; fov: number } = { x: 0, y: 0, z: 2, yaw: 0, pitch: 0, fov: FOV_NORMAL };
  aim = { x: 0, y: 0, z: 0, entityId: -1 };
  interactDoor = -1;
  assist: { yaw: number; pitch: number } | null = null;
  private assistId = -1;
  order: { kind: OrderKind; x: number; y: number; targetId: number } = { kind: 'follow', x: 0, y: 0, targetId: -1 };
  private prevOrder: { kind: OrderKind; x: number; y: number; targetId: number } | null = null;
  pacing: 'ascenso' | 'pico' | 'alivio' | 'descanso' = 'ascenso';
  cheats = { god: false, noclip: false, aiDebug: false, chutaos: false };
  cheated = false;
  hold = false;
  /** v1.3 — avisos de ataques inminentes, nubes de humo, luces apagadas y compañero reanimable */
  threats: Threat[] = [];
  smokes: SmokeCloud[] = [];
  lightsOffUntil = 0;
  interactRevive = -1;
  private loadout: Partial<Record<ClassId, 0 | 1>> = {};
  private threatId = 1;
  private projMeta = new Map<number, { threat?: number; dmg?: number; bounces?: number; radius?: number }>();
  private lastBark: Record<Team, number> = { ally: -99, enemy: -99 };
  private burstLeft = 0;
  private lastHackAt = -99;
  /** v1.3 (oleada 2) — objetivo de zona, modo horda y modificadores */
  objective: Objective = { kind: 'clear', timeLeft: -1, points: [], hp: 0, maxHp: 0, hostageId: -1, stage: 'clear', interact: -1 };
  horde: HordeState | null = null;
  private mut = { rapidos: false, sinAura: false, jefesDobles: false, soloPistola: false, escasez: false };
  private scoreMult = 1;
  private enemyHpMult = 1;
  private difficulty: 'easy' | 'normal' | 'hard' = 'normal';
  private heldInteract = false;
  private hordeState?: CampaignState;
  private tickSec = -1;
  private upgradeIds: string[] = [];
  private nextSendAt = 0;
  /** v1.2 — efectos de las mejoras de campaña, calculados al construir el mundo */
  mods: Mods;
  /** v1.2 — desplazamiento de la cámara por retroceso (radianes); se recupera solo */
  recoil = { pitch: 0, yaw: 0 };
  /** v1.2 — calor del arma del jugador: dispersión añadida por la ráfaga (0..max-base) */
  bloom = 0;
  /** v1.2 — hasta cuándo el jugador no puede disparar tras esprintar (levantar el arma) */
  raiseUntil = 0;
  private camDistEff = 4.2;
  private shoulderEff = SHOULDER_NORMAL;
  private lastPlayerKillAt = -99; private streak = 0;
  private lastBreathUsed = false;
  private invulnUntil = -1;

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
  private prevFire = false;
  private fireBufferUntil = 0;

  constructor(cfg: WorldConfig) {
    this.mods = computeMods(cfg.upgrades);
    this.loadout = cfg.loadout ?? {};
    const mu = cfg.mutators ?? [];
    this.mut = { rapidos: mu.includes('rapidos'), sinAura: mu.includes('sin-aura'), jefesDobles: mu.includes('jefes-dobles'), soloPistola: mu.includes('solo-pistola'), escasez: mu.includes('escasez') };
    this.scoreMult = cfg.scoreMult ?? 1;
    this.enemyHpMult = (cfg.ngPlus ?? 0) > 0 ? NG_PLUS.hp : 1;
    this.difficulty = cfg.director.difficulty ?? 'normal';
    this.hordeState = cfg.hordeState;
    this.upgradeIds = (cfg.upgrades ?? []).slice();
    if (cfg.horde) this.horde = { wave: 0, left: 0, rest: 0, bossWave: false, pickUpgrade: false };
    this.rng = mulberry32(cfg.seed ?? (cfg.floor * 1000 + cfg.zone * 37 + 7));
    this.floor = cfg.floor; this.zone = cfg.zone;
    this.score = cfg.baseScore ?? 0;
    this.level = new Level(cfg.map, cfg.floor);
    this.nav = new Nav(this.level);
    this.pField = new Float32Array(this.level.gw * this.level.gh);
    let ammoBoxes = 0;
    cfg.map.objetos.forEach(o => {
      // escasez: la mitad de las cajas de munición del mapa (alternas)
      if (this.mut.escasez && o.tipo.startsWith('municion') && ammoBoxes++ % 2 === 1) return;
      this.pickups.push({ id: this.nextId++, type: o.tipo, x: o.pos[0], y: o.pos[1], taken: false });
    });

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
    if (cfg.bought) { this.player.grenades += cfg.bought.grenades; this.player.flashes += cfg.bought.flashes; this.player.smokes += cfg.bought.smokes; }
    if (this.mut.soloPistola) { this.player.weapon = 'secondary'; this.player.lastWeapon = 'knife'; }
    this.order.x = this.player.x; this.order.y = this.player.y;
    this.cam.yaw = yaw0;
    this.updatePlayerField(true);
    this.enemyAI = new EnemyAI(this);
    this.director = new Director(this, cfg.director);
    this.computeCam(yaw0, -0.12, 4.2); // antes de colocar a nadie: el director mira qué ve la cámara
    this.director.begin();
    if (cfg.objective && cfg.objective !== 'clear') this.initObjective(cfg.objective);
  }

  // ───────────────────────── entidades ─────────────────────────

  spawnUnit(kind: Kind, x: number, y: number, emit = true): Unit {
    let stats = statsOf(kind);
    const cls = isClass(kind) ? kind : null;
    if (!cls && (this.mut.rapidos || this.enemyHpMult !== 1)) {
      // modificadores (copia de las estadísticas): rápidos = +20 % de velocidad; segunda vuelta = +15 % de vida
      stats = { ...stats, speed: stats.speed * (this.mut.rapidos ? MUTATOR_SPEED : 1), hp: Math.round(stats.hp * this.enemyHpMult) };
    }
    if (cls) {
      // v1.2: las mejoras de campaña modifican una COPIA de las estadísticas de los aliados (la tabla del documento no se toca)
      const m = this.mods;
      const vs = variantStats(cls, this.loadout[cls] ?? 0, stats);
      stats = { ...vs, hp: stats.hp + m.hpBonus, speed: stats.speed * m.speedMult, magSize: Math.max(1, Math.round(vs.magSize * m.magMult)), reloadTime: vs.reloadTime * m.reloadMult };
    }
    const u: Unit = {
      id: this.nextId++, kind, team: cls ? 'ally' : 'enemy', isPlayer: false,
      x, y, vx: 0, vy: 0, yaw: 0, pitch: 0, radius: stats.radius,
      hp: stats.hp, maxHp: stats.hp, alive: true, deadAt: -1, crouch: false,
      mag: stats.magSize, magSize: stats.magSize, ammo: cls ? AMMO_START - Math.min(stats.magSize, AMMO_START) : ENEMY_AMMO - stats.magSize,
      reloading: 0, grenades: cls ? GRENADE_COUNT + this.mods.extraGrenades : 0,
      flashes: cls ? TACTICAL_START.flash + this.mods.extraGrenades : 0, smokes: cls ? TACTICAL_START.smoke + this.mods.extraGrenades : 0, grenadeType: 'frag',
      rollUntil: 0, rollCd: 0, downed: false, downedUntil: 0, reviveProgress: 0, blindedUntil: 0,
      primaryVariant: cls ? (this.loadout[cls] ?? 0) : 0, variant: null, bossVariant: null, bossName: '', reloadChamber: false, reviveAt: -99,
      abilityCd: 0, abilityCdMax: (cls === 'captain' || cls === 'technic' ? 20 : 25) * (cls ? this.mods.abilityCdMult : 1), abilityActive: 0,
      inventory: [null, null, null, null, null], invSel: 0,
      lastShotAt: -9, lastKnifeAt: -9, lastHurtAt: -9, aiState: '', bossPhase: kind === 'megaboss' ? 1 : 0,
      shielded: false, marked: false, sprinting: false, aiming: false, spread: 0, staggerUntil: 0, staggerAt: -99,
      weapon: 'primary', lastWeapon: 'secondary', drawUntil: 0, magSize2: cls ? Math.max(1, Math.round(PISTOL.magSize * this.mods.magMult)) : 0, mag2: cls ? Math.max(1, Math.round(PISTOL.magSize * this.mods.magMult)) : 0,
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
    if (this.isBlinded(a)) return false;                      // cegado: no ve (restrictivo por defecto)
    if (this.smokeBlocks(a.x, a.y, b.x, b.y)) return false;  // el humo tapa la vista, no las balas
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

  // ───────────────────────── v1.3: ganchos públicos (avisos, humo, cegado, barks, granada enemiga) ─────────────────────────

  /** Anuncia un ataque inminente (se dibuja en el suelo). Se purga solo 0,1 s después de `at`. Emite `threat`. */
  addThreat(t: Omit<Threat, 'id' | 'from'>): Threat {
    const th: Threat = { ...t, id: this.threatId++, from: this.time };
    this.threats.push(th);
    this.events.push({ type: 'threat', threat: th });
    return th;
  }
  removeThreat(id: number): void {
    const i = this.threats.findIndex(t => t.id === id);
    if (i >= 0) this.threats.splice(i, 1);
  }
  isBlinded(e: Entity): boolean { return this.time < e.blindedUntil; }

  /** ¿El humo vivo corta el segmento a-b? (pasa a menos de r del centro de una nube) */
  smokeBlocks(ax: number, ay: number, bx: number, by: number): boolean {
    for (const c of this.smokes) {
      if (this.time >= c.until) continue;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const k = l2 > 1e-9 ? Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.y - ay) * dy) / l2)) : 0;
      if (Math.hypot(ax + dx * k - c.x, ay + dy * k - c.y) < c.r) return true;
    }
    return false;
  }
  /** Visión bloqueada entre dos puntos del plano: pared (rayo 'sight' a 1,5 m) O humo. Las balas NO las para el humo. */
  sightBlocked(ax: number, ay: number, bx: number, by: number): boolean {
    return !this.level.clear(ax, ay, 1.5, bx, by, 1.5, 'sight') || this.smokeBlocks(ax, ay, bx, by);
  }

  /** Granada enemiga en parábola (misma física que la del jugador). Sin inventario ni enfriamiento: lo gestiona quien la llama. */
  enemyThrow(owner: Unit, _kind: 'grenade', tx: number, ty: number): void {
    this.launch(owner, 'grenade', tx, ty, 18);
  }

  /** Frase corta de un personaje (clave i18n `bark.<key>`). Como mucho una cada 3 s por bando. */
  bark(e: Entity, key: string): boolean {
    if (this.time - this.lastBark[e.team] < BARK_COOLDOWN) return false;
    this.lastBark[e.team] = this.time;
    this.events.push({ type: 'bark', id: e.id, team: e.team, key });
    return true;
  }

  // ───────────────────────── paso ─────────────────────────

  step(dt: number, input: PlayerInput): void {
    this.events.length = 0;
    this.noises.length = 0;
    // horda: entre oleadas, con una mejora por elegir, el mundo está en pausa lógica (no avanza nada) hasta hordePick()
    if (this.horde?.pickUpgrade) {
      input.reload = input.grenade = input.ability = input.interact = input.useItem = input.cycleItem = false;
      input.order = null; input.weaponSlot = null; input.weaponLast = false; input.weaponCycle = 0; input.roll = false; input.ping = false;
      return;
    }
    this.heldInteract = input.interact || input.interactHold;
    this.time += dt;
    this.pathBudget = 4;
    this.soundBudget = 1;
    this.lastInput = input;
    if (this.status === 'playing') this.stats.time += dt;

    const p = this.player;
    if (p.alive) this.updatePlayer(dt, input);
    else { p.wishX = 0; p.wishY = 0; p.sprinting = false; p.aiming = false; this.interactRevive = -1; }
    this.smoothCamera(dt, input);
    // consumir flancos
    input.reload = input.grenade = input.ability = input.interact = input.useItem = input.cycleItem = false;
    input.order = null; input.weaponSlot = null; input.weaponLast = false; input.weaponCycle = 0; input.roll = false; input.ping = false;

    for (const u of this.entities) {
      if (!u.alive) continue;
      this.tickTimers(u, dt);
      if (u.downed) { u.wishX = u.wishY = 0; continue; }
      if (u.hostage) { this.hostageThink(u, dt); continue; }
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
    this.updateObjective(dt);
    this.updateV13(dt);
    this.updatePlayerField(false);
    this.computeCam(input.yaw, input.pitch, this.camDistEff);
    this.computeAim(input);
    this.interactDoor = p.alive ? this.level.nearestDoor(p.x, p.y, 1.5) : -1;
    const ft = this.order.targetId >= 0 ? this.entityById(this.order.targetId) : undefined;
    // al caer el blanco enfocado, vuelve la orden que había antes
    if (this.order.kind === 'focus' && (!ft || !ft.alive)) { this.order = this.prevOrder ? { ...this.prevOrder } : { kind: 'follow', x: p.x, y: p.y, targetId: -1 }; this.prevOrder = null; }
  }

  // ───────────────────────── v1.3, oleada 2: objetivos de zona ─────────────────────────

  private areaM2(): number {
    const pts = this.level.map.perimetro;
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const q = pts[(i + 1) % pts.length]; a += pts[i][0] * q[1] - q[0] * pts[i][1]; }
    return Math.abs(a) / 2;
  }

  /** Puntos transitables del suelo (rejilla de 2 m) con su distancia andando desde el inicio del jugador. */
  private objCandidates(): { x: number; y: number; d: number }[] {
    const L = this.level, [sx, sy] = L.map.inicio_jugador;
    const f = this.nav.field(sx, sy, true, 3, Infinity);
    const out: { x: number; y: number; d: number }[] = [];
    for (let y = L.oy + 1; y < L.oy + L.gh * 0.25; y += 2) for (let x = L.ox + 1; x < L.ox + L.gw * 0.25; x += 2) {
      const c = L.cellOf(x, y);
      if (c < 0 || !L.passable(c, true) || L.doorCell[c] || !(f[c] < Infinity)) continue;
      out.push({ x: L.cellX(c), y: L.cellY(c), d: f[c] });
    }
    return out;
  }

  /**
   * Pone el objetivo de la zona (también lo usa la consola para cambiarlo en caliente). Todo se deriva de la geometría del mapa:
   * ninguna coordenada a mano. 'clear' deja la zona como siempre.
   */
  initObjective(kind: ObjectiveKind): void {
    const old = this.objective;
    if (old.hostageId >= 0) { const h = this.entityById(old.hostageId); if (h) { h.alive = false; h.hostage = undefined; } }
    this.objective = { kind, timeLeft: -1, points: [], hp: 0, maxHp: 0, hostageId: -1, stage: kind === 'clear' ? 'clear' : '', interact: -1 };
    const o = this.objective;
    if (kind === 'clear') return;
    const L = this.level, [sx, sy] = L.map.inicio_jugador;
    const cands = this.objCandidates();
    const far = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    if (kind === 'defuse') {
      // dos cargas: la A lo más lejos (andando) del inicio, la B lo más lejos de A y del inicio, a ≥ 10 m entre sí
      let A = cands[0], B = cands[0];
      for (const c of cands) if (c.d > A.d) A = c;
      let bs = -1;
      for (const c of cands) {
        const sep = far(c, A);
        if (sep < Math.min(OBJECTIVE.defuseMinSep, far(A, { x: sx, y: sy }) * 0.5)) continue;
        const sc = Math.min(sep, far(c, { x: sx, y: sy }) * 1.2) + c.d * 0.05;
        if (sc > bs) { bs = sc; B = c; }
      }
      o.points = [A, B].map(c => ({ x: c.x, y: c.y, done: false, progress: 0 }));
      const extra = Math.max(0, Math.ceil((this.areaM2() - OBJECTIVE.defuseAreaBase) / 500)) * OBJECTIVE.defuseExtraPer500m2;
      o.timeLeft = OBJECTIVE.defuseTime[this.difficulty] + extra;
      o.stage = 'defuse1';
    } else if (kind === 'defend') {
      // el servidor, en la sala más central: el punto transitable más cercano al centro del mapa (a ≥ 6 m del inicio si se puede)
      const pts = L.map.perimetro;
      const cx = (Math.min(...pts.map(p => p[0])) + Math.max(...pts.map(p => p[0]))) / 2, cy = (Math.min(...pts.map(p => p[1])) + Math.max(...pts.map(p => p[1]))) / 2;
      let best = cands[0], bs = Infinity;
      for (const c of cands) {
        const sc = far(c, { x: cx, y: cy }) + (far(c, { x: sx, y: sy }) < 6 ? 50 : 0);
        if (sc < bs) { bs = sc; best = c; }
      }
      o.points = [{ x: best.x, y: best.y, done: false, progress: 0 }];
      o.hp = o.maxHp = OBJECTIVE.defendHp;
      o.timeLeft = OBJECTIVE.defendTime;
      o.stage = 'reach';
    } else {
      // rehén en la zona del punto del jefe; sale de ahí hasta el punto de inicio
      const c = L.nearestFree(L.map.punto_jefe[0], L.map.punto_jefe[1], true, 20);
      const hx = c >= 0 ? L.cellX(c) : L.map.punto_jefe[0], hy = c >= 0 ? L.cellY(c) : L.map.punto_jefe[1];
      const h = this.spawnUnit('enemy1', hx, hy, false);
      this.enemyAI.unregister(h);
      h.team = 'ally'; h.hostage = true; h.hp = h.maxHp = OBJECTIVE.rescueHp; h.mag = h.ammo = 0; h.crouch = true; h.aiState = 'rehén';
      o.hostageId = h.id; o.hp = o.maxHp = OBJECTIVE.rescueHp;
      o.points = [{ x: hx, y: hy, done: false, progress: 0 }, { x: sx, y: sy, done: false, progress: 0 }];
      o.stage = 'find';
    }
    this.tickSec = -1;
    this.events.push({ type: 'objective', what: 'start', kind, x: o.points[0].x, y: o.points[0].y });
  }

  private objDone(): void {
    const o = this.objective;
    this.events.push({ type: 'objective', what: 'done', kind: o.kind, x: o.points[0]?.x ?? 0, y: o.points[0]?.y ?? 0 });
    this.status = 'cleared'; this.pacing = 'descanso';
    this.morale = Math.min(100, this.morale + 10);
    this.events.push({ type: 'phase', phase: 'descanso' });
    this.events.push({ type: 'cleared' });
  }
  private objFail(): void {
    const o = this.objective;
    this.events.push({ type: 'objective', what: 'failed', kind: o.kind, x: o.points[0]?.x ?? 0, y: o.points[0]?.y ?? 0 });
    this.status = 'failed';
  }

  /** Quita a los enemigos que quedan sin puntos ni bajas (huyen): al acabar la defensa. */
  private despawnEnemies(): void {
    for (const e of this.entities) if (e.alive && e.team === 'enemy') { e.alive = false; e.deadAt = this.time; e.wishX = e.wishY = 0; e.vx = e.vy = 0; }
  }

  private updateObjective(dt: number): void {
    const o = this.objective;
    if (this.status !== 'playing' || o.kind === 'clear') return;
    const p = this.player;
    o.interact = -1;
    const held = this.heldInteract && p.alive && this.interactRevive < 0;
    if (o.kind === 'defuse') {
      if (p.alive) o.points.forEach((pt, i) => { if (o.interact < 0 && !pt.done && Math.hypot(pt.x - p.x, pt.y - p.y) <= OBJECTIVE.defuseRange) o.interact = i; });
      o.points.forEach((pt, i) => {
        if (pt.done) return;
        if (held && i === o.interact) {
          pt.progress += dt / OBJECTIVE.defuseHold;
          if (pt.progress >= 1) { pt.progress = 1; pt.done = true; this.events.push({ type: 'objective', what: 'progress', kind: 'defuse', x: pt.x, y: pt.y }); }
        } else pt.progress = 0;                       // soltar reinicia
      });
      const n = o.points.filter(q => q.done).length;
      o.stage = 'defuse' + Math.min(2, n + 1);
      if (n >= o.points.length) { this.objDone(); return; }
      o.timeLeft -= dt;
      if (o.timeLeft <= 10 && Math.ceil(o.timeLeft) !== this.tickSec && o.timeLeft > 0) { this.tickSec = Math.ceil(o.timeLeft); this.events.push({ type: 'objective', what: 'tick', kind: 'defuse', x: o.points[0].x, y: o.points[0].y }); }
      if (o.timeLeft <= 0) { o.timeLeft = 0; this.objFail(); }
    } else if (o.kind === 'defend') {
      const sv = o.points[0];
      if (o.stage === 'reach') {
        if (p.alive && Math.hypot(sv.x - p.x, sv.y - p.y) <= OBJECTIVE.defendReach) {
          o.stage = 'hold'; o.timeLeft = OBJECTIVE.defendTime;
          this.director.beginHold();
          this.events.push({ type: 'objective', what: 'progress', kind: 'defend', x: sv.x, y: sv.y });
        }
        return;
      }
      o.timeLeft -= dt;
      this.defendFire(dt);
      if (o.hp <= 0) { o.hp = 0; this.objFail(); return; }
      if (o.timeLeft <= 0) { o.timeLeft = 0; this.despawnEnemies(); this.objDone(); }
    } else {
      const h = this.entityById(o.hostageId);
      if (!h || !h.alive) { o.hp = 0; this.objFail(); return; }
      o.hp = h.hp;
      o.points[0].x = h.x; o.points[0].y = h.y;
      // los enemigos le disparan sólo si no ven a otro blanco (disparos reales: una pared siempre para la bala)
      for (const e of this.entities) {
        if (!e.alive || e.team !== 'enemy' || e.downed || !e.brain || e.brain.visId >= 0 || !e.brain.belief) continue; // sólo si ya hay combate (te buscan) y no ven a otro blanco
        const d = Math.hypot(e.x - h.x, e.y - h.y);
        if (d > OBJECTIVE.defendFireRange || e.reloading > 0 || e.mag <= 0 || e.fireCd > 0 || this.time < e.staggerUntil || this.isBlinded(e) || !this.canSee(e, h)) continue;
        e.brain.faceYaw = Math.atan2(h.y - e.y, h.x - e.x);
        const dyaw = angDiff(e.brain.faceYaw, e.yaw);
        if (Math.abs(dyaw) > 0.25) { e.yaw += Math.sign(dyaw) * Math.min(Math.abs(dyaw), 5.5 * dt); continue; }
        if (this.shotLine(e, h) < 0) continue;
        this.fire(e, h.x, h.y, this.height(h) * 0.6, 0.04);
        e.fireCd = 1 / e.stats.rof;
      }
      if (o.stage === 'find') {
        if (p.alive && Math.hypot(h.x - p.x, h.y - p.y) <= OBJECTIVE.rescueRange) {
          o.interact = 0;
          if (held) { o.stage = 'escort'; o.points[0].done = true; h.crouch = false; this.events.push({ type: 'objective', what: 'progress', kind: 'rescue', x: h.x, y: h.y }); }
        }
      } else {
        const [ex, ey] = [o.points[1].x, o.points[1].y];
        if (Math.hypot(p.x - ex, p.y - ey) <= OBJECTIVE.rescueExtractRange && Math.hypot(h.x - ex, h.y - ey) <= OBJECTIVE.rescueExtractRange) { o.points[1].done = true; this.objDone(); }
      }
    }
  }

  /** Defensa: los enemigos sin blanco visible acuden al servidor y, a ≤ 12 m con línea de visión, le disparan (daño normal). */
  private defendFire(dt: number): void {
    const o = this.objective, sv = o.points[0];
    const send = this.time >= this.nextSendAt;
    if (send) this.nextSendAt = this.time + 1.5;
    for (const e of this.entities) {
      if (!e.alive || e.team !== 'enemy' || e.downed || !e.brain) continue;
      const b = e.brain;
      if (b.visId >= 0) continue;                                    // con un blanco a la vista pelea con ese
      const d = Math.hypot(e.x - sv.x, e.y - sv.y);
      if (send && !b.belief && d > 4 && (b.state === 'patrol' || b.state === 'investigate')) this.enemyAI.goInvestigate(e, sv.x + (this.rng() - 0.5) * 3, sv.y + (this.rng() - 0.5) * 3);
      if (d > OBJECTIVE.defendFireRange || e.reloading > 0 || e.mag <= 0 || e.fireCd > 0 || this.time < e.staggerUntil || this.isBlinded(e)) continue;
      if (e.kind === 'megaboss' || e.bossVariant === 'embestida') continue;
      if (this.sightBlocked(e.x, e.y, sv.x, sv.y)) continue;
      b.faceYaw = Math.atan2(sv.y - e.y, sv.x - e.x);
      const dyaw = angDiff(b.faceYaw, e.yaw);
      if (Math.abs(dyaw) > 0.25) { e.yaw += Math.sign(dyaw) * Math.min(Math.abs(dyaw), 5.5 * dt); continue; }   // gira hacia el servidor antes de disparar
      e.mag--; e.lastShotAt = this.time; e.fireCd = 1 / e.stats.rof;
      const z = 1.0;
      this.events.push({ type: 'shot', id: e.id, kind: e.kind, team: e.team, fx: e.x, fy: e.y, fz: this.muzzleZ(e), tx: sv.x, ty: sv.y, tz: z, hit: 'wall', surface: 'furniture', nx: (e.x - sv.x) / (d || 1), ny: (e.y - sv.y) / (d || 1) });
      o.hp -= e.stats.damage;
    }
  }

  /** Rehén: quieto hasta que lo liberan; después sigue al jugador (navegación de aliado) y se agacha si hay enemigos a la vista. */
  private hostageThink(u: Unit, dt: number): void {
    void dt;
    u.wishX = u.wishY = 0;
    const o = this.objective;
    if (o.stage !== 'escort') { u.crouch = true; return; }
    const p = this.player;
    let danger = false;
    for (const e of this.entities) if (e.alive && e.team === 'enemy' && Math.hypot(e.x - u.x, e.y - u.y) < 18 && this.canSee(e, u)) { danger = true; break; }
    u.crouch = danger;
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    let tx = p.x - cy * 1.5, ty = p.y - sy * 1.5;
    if (!this.level.walkableAt(tx, ty, false) || !this.level.walkLine(p.x, p.y, tx, ty, false)) { tx = p.x; ty = p.y; }
    if (Math.hypot(tx - u.x, ty - u.y) > 0.8 || Math.hypot(p.x - u.x, p.y - u.y) > 2.2) this.navigate(u, tx, ty, OBJECTIVE.rescueSpeed * (danger ? 0.6 : 1), null, 0.8);
    u.aiState = 'sigue';
  }

  /** Deja un objeto en el suelo (suministros de la horda). */
  dropPickup(type: ItemType, x: number, y: number): void { this.pickups.push({ id: this.nextId++, type, x, y, taken: false }); }

  /** Modo horda: aplica la mejora elegida entre oleadas y reanuda. */
  hordePick(id: string): void {
    if (!this.horde || !this.horde.pickUpgrade) return;
    const def = UPGRADES.find(x => x.id === id);
    if (def) {
      if (!this.upgradeIds.includes(id)) this.upgradeIds.push(id);
      if (this.hordeState) { const ups = (this.hordeState.upgrades ??= []); if (!ups.includes(id)) ups.push(id); }
      const old = this.mods;
      this.mods = computeMods(this.upgradeIds);
      this.refreshAllyStats(old);
    }
    this.horde.pickUpgrade = false;
  }

  /** Recalcula las estadísticas de los aliados vivos tras cambiar `mods` (vida, velocidad, cargador, recarga, habilidad, granadas). */
  private refreshAllyStats(old: Mods): void {
    const m = this.mods;
    for (const u of this.entities) {
      if (!u.alive || !u.cls || u.hostage) continue;
      const base = CLASS_STATS[u.cls];
      const vs = variantStats(u.cls, u.primaryVariant, base);
      const hpOld = u.maxHp;
      const st = { ...vs, hp: base.hp + m.hpBonus, speed: base.speed * m.speedMult, magSize: Math.max(1, Math.round(vs.magSize * m.magMult)), reloadTime: vs.reloadTime * m.reloadMult };
      u.stats = st; u.maxHp = st.hp; u.hp = Math.min(u.maxHp, u.hp + Math.max(0, u.maxHp - hpOld));
      u.magSize = st.magSize; u.magSize2 = Math.max(1, Math.round(PISTOL.magSize * m.magMult));
      u.abilityCdMax = (u.cls === 'captain' || u.cls === 'technic' ? 20 : 25) * m.abilityCdMult;
      u.grenades += m.extraGrenades - old.extraGrenades; u.flashes += m.extraGrenades - old.extraGrenades; u.smokes += m.extraGrenades - old.extraGrenades;
    }
  }

  /** Mantenimiento v1.3 de cada paso: avisos y humo caducados, luces, derribados (reanimación, plazo, zona limpia). */
  private updateV13(dt: number): void {
    void dt;
    if (this.threats.length > 0) this.threats = this.threats.filter(t => this.time <= t.at + 0.1);
    if (this.smokes.length > 0) this.smokes = this.smokes.filter(c => this.time < c.until);
    if (this.lightsOffUntil > 0 && this.time >= this.lightsOffUntil) { this.lightsOffUntil = 0; this.events.push({ type: 'lights', on: true }); }
    for (const u of this.entities) {
      if (!u.alive || !u.downed) continue;
      if (this.status === 'cleared') { this.revive(u, null, 1); continue; }   // zona limpia: se levanta solo con 1 de vida
      if (this.time - u.reviveAt > 0.08) u.reviveProgress = 0;                // interrumpida: vuelve a empezar
      if (this.time >= u.downedUntil) this.kill(u, null);                      // venció el plazo: muere como siempre
    }
  }

  private tickTimers(u: Unit, dt: number): void {
    if (u.fireCd > 0) u.fireCd -= dt;
    if (u.knifeCd > 0) u.knifeCd -= dt;
    if (u.grenadeCd > 0) u.grenadeCd -= dt;
    if (u.abilityCd > 0) u.abilityCd = Math.max(0, u.abilityCd - dt);
    if (u.abilityActive > 0) u.abilityActive = Math.max(0, u.abilityActive - dt);
    if (u.rollCd > 0) u.rollCd = Math.max(0, u.rollCd - dt);
    if (u.reloading > 0 && !(this.time < u.rollUntil)) { // rodando, la recarga se pausa
      u.reloading -= dt;
      if (u.reloading <= 0) {
        u.reloading = 0;
        if (u.weapon === 'secondary') u.mag2 = u.magSize2 + (u.reloadChamber ? 1 : 0);
        else { const n = Math.min(u.magSize + (u.reloadChamber ? 1 : 0) - u.mag, u.ammo); u.mag += n; u.ammo -= n; }
      }
    }
  }

  startReload(u: Unit): boolean {
    if (u.weapon === 'knife' || u.weapon === 'grenade' || u.downed) return false;
    if (u.weapon === 'secondary') {
      if (u.reloading > 0 || u.mag2 >= u.magSize2) return false;   // reserva infinita
      u.reloading = PISTOL.reloadTime * this.mods.reloadMult;
      u.reloadChamber = u.mag2 > 0; // recarga con peso: una bala se queda en la recámara
      this.events.push({ type: 'reload', id: u.id });
      return true;
    }
    if (u.reloading > 0 || u.mag >= u.magSize || u.ammo <= 0) return false;
    // recarga con peso (v1.3): con balas en el cargador se conserva una en recámara (aliados, no explosivos)
    u.reloadChamber = u.team === 'ally' && !u.stats.explosive && u.mag > 0;
    u.reloading = u.stats.reloadTime; // las mejoras ya vienen aplicadas en stats (copia de los aliados)
    this.events.push({ type: 'reload', id: u.id });
    if (u.team === 'ally' && !u.isPlayer) this.bark(u, 'ally.reload');
    return true;
  }

  // ───────────────────────── jugador ─────────────────────────

  /** Distancia efectiva de cámara, hombro y campo de visión: se acercan suavemente (~10/s) a su valor objetivo. */
  private smoothCamera(dt: number, input: PlayerInput): void {
    const k = Math.min(1, dt * 10);
    const aim = this.player.aiming;
    const dTarget = aim ? CAM_DIST_AIM : (input.camDist || 4.2);
    this.camDistEff += (dTarget - this.camDistEff) * k;
    this.shoulderEff += ((aim ? SHOULDER_AIM : SHOULDER_NORMAL) - this.shoulderEff) * k;
    this.cam.fov += ((aim ? FOV_AIM : FOV_NORMAL) - this.cam.fov) * k;
  }

  /** Dispersión efectiva del jugador ahora mismo (sigma, rad). Es la que lee la retícula (p.spread). */
  private playerSpread(): number {
    const p = this.player;
    const g = p.weapon === 'secondary' ? PISTOL_FEEL : GUN_FEEL[p.cls ?? 'captain'];
    const vmax = Math.max(0.1, p.stats.speed);
    const mv = Math.min(1, Math.hypot(p.vx, p.vy) / vmax);
    let sp = g.baseSpread + this.bloom + g.moveSpread * mv;
    if (p.crouch) sp *= 0.75;
    if (p.aiming) sp *= 0.45;
    if (p.cls === 'especialist' && p.abilityActive > 0) sp *= 1.3;
    // fusil de tirador: muy preciso apuntando y malo desde la cadera
    if (p.cls === 'especialist' && p.primaryVariant === 1 && p.weapon === 'primary') sp *= p.aiming ? SNIPER.aimSpreadMult : SNIPER.hipSpreadMult;
    return sp;
  }

  /** Cambia el arma en la mano del jugador (v1.2). Devuelve false si no hace nada. */
  switchWeapon(u: Unit, slot: WeaponSlot): boolean {
    if (slot === u.weapon) return false;
    if (slot === 'primary' && u.isPlayer && this.mut.soloPistola) return false; // modificador «solo pistola»
    if (slot === 'grenade') {
      if (this.grenadeTotal(u) <= 0) return false;                    // vacía solo si no queda de ningún tipo
      if (this.grenadeStock(u, u.grenadeType) <= 0) this.cycleGrenadeType(u);
    }
    u.lastWeapon = u.weapon;
    u.weapon = slot;
    u.drawUntil = this.time + DRAW_TIME[slot];
    u.reloading = 0;            // la recarga en curso se cancela; la munición no se pierde (se reparte al terminar)
    this.burstLeft = 0;
    this.bloom = 0;
    this.events.push({ type: 'weaponSwitch', id: u.id, weapon: slot });
    return true;
  }

  /** Rueda: recorre primary → secondary → knife → grenade en círculo, saltando granada si no quedan. */
  cycleWeapon(u: Unit, dir: 1 | -1): boolean {
    const n = WEAPON_SLOTS.length;
    let i = WEAPON_SLOTS.indexOf(u.weapon);
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      const s = WEAPON_SLOTS[i];
      if (s === 'grenade' && this.grenadeTotal(u) <= 0) continue;
      if (s === 'primary' && u.isPlayer && this.mut.soloPistola) continue;
      return this.switchWeapon(u, s);
    }
    return false;
  }

  private rollDir: [number, number] = [1, 0];

  private updatePlayer(dt: number, input: PlayerInput): void {
    const p = this.player;
    p.yaw = input.yaw; p.pitch = input.pitch;
    // cambio de arma (flancos): antes de leer fire, para que el saque cuente en este mismo paso
    if (input.weaponSlot) {
      // volver a elegir la ranura de granada estando en ella pasa al siguiente tipo con existencias
      if (input.weaponSlot === 'grenade' && p.weapon === 'grenade') this.cycleGrenadeType(p);
      else this.switchWeapon(p, input.weaponSlot);
    }
    if (input.weaponLast) this.switchWeapon(p, p.lastWeapon);
    if (input.weaponCycle) this.cycleWeapon(p, input.weaponCycle > 0 ? 1 : -1);
    const g = p.weapon === 'secondary' ? PISTOL_FEEL : GUN_FEEL[p.cls ?? 'captain'];
    const firePressed = input.fire && !this.prevFire;
    this.prevFire = input.fire;
    if (firePressed) this.fireBufferUntil = this.time + 0.15;
    const slotAim = p.weapon === 'primary' || p.weapon === 'secondary';
    let f = input.moveF, r = input.moveR;
    const m = Math.hypot(f, r);
    if (m > 1) { f /= m; r /= m; }
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);

    // voltereta (v1.3): 0,5 s, 3,5 m en la dirección de movimiento (parado, hacia atrás); no dispara ni recarga
    let rolling = this.time < p.rollUntil;
    if (input.roll && !rolling && p.rollCd <= 0 && !p.sprinting) {
      let dx = cy * f - sy * r, dy = sy * f + cy * r;
      const dl = Math.hypot(dx, dy);
      if (dl < 0.1) { dx = -cy; dy = -sy; } else { dx /= dl; dy /= dl; }
      this.rollDir = [dx, dy];
      p.rollUntil = this.time + ROLL.time; p.rollCd = ROLL.cooldown;
      rolling = true;
      this.events.push({ type: 'roll', id: p.id });
    }

    // esprint (v1.2): hacia delante, sin apuntar; cancela agacharse y no deja disparar
    const wasSprinting = p.sprinting;
    const wantAim = input.aim && p.reloading <= 0 && slotAim && !rolling;
    let sprint = input.sprint && f > 0.5 && !wantAim && !rolling;
    if (sprint && input.fire) sprint = false;      // pulsar fuego saca del esprint
    p.crouch = input.crouch && !(input.sprint && f > 0.5) && !rolling;
    if (sprint) p.crouch = false;
    p.sprinting = sprint;
    p.aiming = wantAim && !sprint;
    if (sprint && p.reloading > 0) p.reloading = 0;   // v1.3: esprintar cancela la recarga
    if (wasSprinting && !sprint) this.raiseUntil = this.time + SPRINT_RAISE;

    const sp = p.stats.speed * WEAPON_SPEED[p.weapon] * (p.crouch ? 0.5 : 1) * (sprint ? SPRINT_MULT : 1) * (p.aiming ? AIM_SPEED_MULT : 1);
    p.wishX = (cy * f - sy * r) * sp;
    p.wishY = (sy * f + cy * r) * sp;
    if (rolling) {
      const rs = ROLL.dist / ROLL.time;
      p.wishX = this.rollDir[0] * rs; p.wishY = this.rollDir[1] * rs;
      p.vx = p.wishX; p.vy = p.wishY;
    }

    // retroceso: se recupera de forma exponencial; calor: baja tras 0,12 s sin disparar
    const decay = Math.exp(-RECOIL_RECOVER * dt);
    this.recoil.pitch *= decay; this.recoil.yaw *= decay;
    if (this.time - p.lastShotAt > 0.12) this.bloom = Math.max(0, this.bloom - g.recover * dt);

    this.computeCam(input.yaw, input.pitch, this.camDistEff);
    this.computeAim(input);

    // reanimación: con un derribado a ≤ 1,6 m, mantener `interact` 3 s (gana al aviso de puerta)
    const dn = this.downedNear(p.x, p.y, DOWNED.reviveRange);
    this.interactRevive = dn ? dn.id : -1;
    if (dn && (input.interact || input.interactHold) && !rolling) { this.reviveTick(dn, p, dt); this.bark(p, 'ally.reviving'); }

    // habilidad Supresión: fuego sostenido automático (con el arma principal)
    const suppressing = p.cls === 'especialist' && p.abilityActive > 0;
    const supFire = suppressing && p.weapon === 'primary';
    p.spread = this.playerSpread();
    const listo = !p.sprinting && !rolling && this.time >= this.raiseUntil && this.time >= p.drawUntil;
    const variant = p.weapon === 'primary' ? p.primaryVariant : 0;
    const disparaBala = (suppress: boolean) => {
      let tx = this.aim.x, ty = this.aim.y, tz = this.aim.z;
      if (input.aimAssist && this.assistId >= 0) {
        const t = this.entityById(this.assistId);
        if (t && t.alive) { tx = t.x; ty = t.y; tz = this.height(t) * 0.62; }
      }
      // dispersión de ESTA bala (la de la mejora «primera bala» es nula si llevaba > 1 s sin disparar)
      let sd = p.spread;
      if (this.mods.firstBullet && this.time - p.lastShotAt > 1) sd = 0;
      if (input.aimAssist) sd = Math.max(sd * 0.8, 0.010);
      this.fire(p, tx, ty, tz, sd, suppress, p.weapon);
      p.fireCd = 1 / ((p.weapon === 'secondary' ? PISTOL.rof : p.stats.rof) * (suppress ? 2 : 1));
      // fusil de ráfagas del Capitán (variante 1): 3 balas a 12/s y una pausa
      if (p.cls === 'captain' && variant === 1) {
        if (this.burstLeft <= 0) { this.burstLeft = BURST_RIFLE.bullets - 1; p.fireCd = 1 / BURST_RIFLE.rate; }
        else { this.burstLeft--; p.fireCd = this.burstLeft > 0 ? 1 / BURST_RIFLE.rate : BURST_RIFLE.pause; }
      }
      // calor y retroceso de la bala
      const rm = this.mods.recoilMult;
      this.bloom = Math.min(Math.max(0, g.maxSpread - g.baseSpread), this.bloom + g.perShot * rm);
      const km = rm * (p.aiming ? 0.7 : 1) * (p.crouch ? 0.85 : 1) * (p.cls && p.weapon === 'primary' ? PRIMARY_VARIANTS[p.cls][variant].kickMult : 1);
      this.recoil.pitch = Math.min(RECOIL_MAX_PITCH, this.recoil.pitch + g.kickPitch * km);
      this.recoil.yaw = Math.max(-RECOIL_MAX_YAW, Math.min(RECOIL_MAX_YAW, this.recoil.yaw + (this.rng() < 0.5 ? -1 : 1) * g.kickYaw * km * (0.5 + this.rng())));
      p.spread = this.playerSpread();
    };
    if (p.weapon === 'primary') {
      const semi = p.cls === 'especialist' && variant === 1 && !supFire;   // fusil de tirador: un disparo por pulsación
      const pulled = semi ? (firePressed || this.time < this.fireBufferUntil) : input.fire;
      const midBurst = p.cls === 'captain' && variant === 1 && this.burstLeft > 0 && p.mag > 0;
      if ((pulled || supFire || midBurst) && p.reloading <= 0 && listo) {
        if (p.mag > 0 || supFire) {
          if (p.fireCd <= 0 && p.stats.explosive && Math.hypot(this.aim.x - p.x, this.aim.y - p.y) < 2.6) {
            // Seguro del lanzador: no dispara contra algo que tiene a menos de 2,6 m (estallaría en la cara).
            if (this.time - this.dryAt > 0.4) { this.dryAt = this.time; this.events.push({ type: 'dryfire', id: p.id }); }
          } else if (p.fireCd <= 0) { disparaBala(supFire); this.fireBufferUntil = 0; }
        } else if (p.ammo > 0) this.startReload(p);
        else if (this.time - this.dryAt > 0.4) { this.dryAt = this.time; this.events.push({ type: 'dryfire', id: p.id }); }
      }
    } else if (p.weapon === 'secondary') {
      // pistola: reserva infinita; recarga sola al vaciar el cargador
      if (input.fire && p.reloading <= 0 && listo) {
        if (p.mag2 > 0) { if (p.fireCd <= 0) disparaBala(false); }
        else this.startReload(p);
      }
    } else if (p.weapon === 'knife') {
      if (input.fire && listo && p.knifeCd <= 0) this.knife(p);
    } else if (p.weapon === 'grenade') {
      if (firePressed && listo) {
        if (this.throwTyped(p, p.grenadeType, this.aim.x, this.aim.y) && this.grenadeStock(p, p.grenadeType) <= 0) this.cycleGrenadeType(p);
      }
    }
    if (suppressing) this.applySuppression(p);
    if (input.reload && !rolling && !p.sprinting) this.startReload(p);
    if (!p.sprinting && !rolling) {
      if (input.knife && p.knifeCd <= 0 && this.time >= p.drawUntil) this.knife(p);
      if (input.grenade) this.throwGrenade(p, this.aim.x, this.aim.y);
    }
    // sin granadas de ningún tipo en la mano de granada: vuelve sola a la anterior
    if (p.weapon === 'grenade' && this.grenadeTotal(p) <= 0) this.switchWeapon(p, p.lastWeapon === 'grenade' ? 'primary' : p.lastWeapon);
    if (input.ability) this.useAbility(p);
    // (si hay un derribado al alcance, `interact` es para reanimar y no abre la puerta)
    if (input.interact && !dn && this.objective.interact < 0 && this.interactDoor >= 0) this.toggleDoor(this.interactDoor, !this.level.doors[this.interactDoor].open, p);
    if (input.cycleItem) {
      for (let k = 1; k <= INVENTORY_SLOTS; k++) {
        const i = (p.invSel + k) % INVENTORY_SLOTS;
        if (p.inventory[i]) { p.invSel = i; break; }
      }
    }
    if (input.useItem) this.useItem(p, p.invSel);
    if (input.order) this.giveOrder(input.order);
    if (input.ping) this.ping(p);
  }

  /** Orden contextual (v1.3): según a qué apunte la mira. */
  ping(p: Unit): void {
    const L = this.level;
    const ally = (): Unit | null => {
      let best: Unit | null = null, bd = Infinity;
      for (const a of this.entities) if (a.alive && !a.downed && a.team === 'ally' && !a.isPlayer) { const d = Math.hypot(a.x - p.x, a.y - p.y); if (d < bd) { bd = d; best = a; } }
      return best;
    };
    const roger = () => { const a = ally(); if (a) this.bark(a, 'ally.roger'); };
    // 1) enemigo a la vista: enfocar
    if (this.aim.entityId >= 0) {
      const t = this.entityById(this.aim.entityId);
      if (t && t.alive && t.team === 'enemy' && this.canSee(p, t)) {
        this.giveOrder('focus');
        this.events.push({ type: 'ping', what: 'enemy', x: t.x, y: t.y, targetId: t.id });
        roger();
        return;
      }
    }
    // 2) puerta cerrada a ≤ 20 m: ir al otro lado y que el primer aliado la abra
    let door = -1, bd = 1.2;
    for (const d of L.doors) {
      if (d.open) continue;
      const k = Math.hypot(d.cx - this.aim.x, d.cy - this.aim.y);
      if (k < bd && Math.hypot(d.cx - p.x, d.cy - p.y) <= PING_DOOR_RANGE) { bd = k; door = d.id; }
    }
    if (door >= 0) {
      const d = L.doors[door];
      let nx = 0, ny = 0;
      if (d.vertical) nx = Math.sign(d.cx - p.x) || 1; else ny = Math.sign(d.cy - p.y) || 1;
      let gx = d.cx + nx * 1.8, gy = d.cy + ny * 1.8;
      const c = L.nearestFree(gx, gy, true, 4);
      if (c >= 0) { gx = L.cellX(c); gy = L.cellY(c); }
      this.order = { kind: 'goto', x: gx, y: gy, targetId: -1 };
      this.events.push({ type: 'order', order: 'goto', x: gx, y: gy });
      const a = ally();
      if (a && a.brain) a.brain.openDoor = { id: door, until: this.time + 8 };
      this.events.push({ type: 'ping', what: 'door', x: d.cx, y: d.cy, targetId: door });
      roger();
      return;
    }
    // 3) objeto: el aliado más cercano al que le sirva va a cogerlo y vuelve a seguir
    let item: Pickup | null = null; let ib = 1.5;
    for (const pk of this.pickups) { if (pk.taken) continue; const d = Math.hypot(pk.x - this.aim.x, pk.y - this.aim.y); if (d < ib) { ib = d; item = pk; } }
    if (item) {
      const e = ITEM_EFFECT[item.type];
      let who: Unit | null = null, wd = Infinity;
      for (const a of this.entities) {
        if (!a.alive || a.downed || a.team !== 'ally' || a.isPlayer || !a.brain) continue;
        const useful = (e.hp > 0 && a.hp < a.maxHp) || (e.ammo > 0 && a.ammo + a.mag < AMMO_CAP) || a.inventory.includes(null);
        const d = Math.hypot(a.x - item.x, a.y - item.y);
        if (useful && d < wd) { wd = d; who = a; }
      }
      if (who) {
        who.brain.fetch = { id: item.id, until: this.time + 8 };
        this.events.push({ type: 'ping', what: 'item', x: item.x, y: item.y, targetId: item.id });
        this.bark(who, 'ally.roger');
        return;
      }
    }
    // 4) suelo: ir allí
    this.giveOrder('goto');
    this.events.push({ type: 'ping', what: 'ground', x: this.order.x, y: this.order.y, targetId: -1 });
    roger();
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
    // el retroceso mueve la cámara y, con ella, el rayo de la mira (input no se toca)
    yaw += this.recoil.yaw; pitch += this.recoil.pitch;
    const sh = this.shoulderEff;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const headZ = this.height(p) - 0.2;
    // pivote sobre el hombro derecho
    let px = p.x - sy * sh, py = p.y + cy * sh;
    const ts = L.ray(p.x, p.y, headZ, px, py, headZ, 'bullet');
    if (ts < 1) { const k = Math.max(0, ts - 0.35); px = p.x - sy * sh * k; py = p.y + cy * sh * k; }
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
    const near = Math.min(2.2, d * 0.9);
    if (da < near) cz += (near - da) * 0.55;
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
      if (!u.alive || u.downed || u === ignore || (team !== 'any' && u.team !== team)) continue;
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
  fire(u: Unit, tx: number, ty: number, tz: number, spread: number, free = false, weapon: WeaponSlot = 'primary'): void {
    const pistol = weapon === 'secondary';
    const variant = weapon === 'primary' && u.cls ? u.primaryVariant : 0;
    if (!free) { if (pistol) u.mag2--; else u.mag--; }
    u.lastShotAt = this.time;
    if (u.isPlayer) this.stats.shotsFired++;
    if (this.isBlinded(u)) spread *= FLASH.spreadMult;       // cegado: puntería malísima
    if (this.time - u.noiseAt > 0.35) { u.noiseAt = this.time; this.noises.push({ x: u.x, y: u.y, loud: 30, team: u.team, id: u.id, kind: 'shot' }); }
    // lanzador de rebote (Explosivo, variante 1): una granada que rebota una vez y estalla a 1,3 s
    if (u.cls === 'explosives' && variant === 1) { this.launchBounce(u, tx, ty); return; }
    const pellets = u.cls === 'technic' && variant === 1 ? SHOTGUN.pellets : 1;
    const ctx = { hit: false, head: false };
    for (let i = 0; i < pellets; i++) this.shootRay(u, tx, ty, tz, spread, pistol, pellets > 1, weapon, ctx);
  }

  /** Factor de daño de una bala contra `t` disparada por `shooter`: 0 = la para el escudo del blindado; 0,3 = arco frontal de la Embestida. */
  private bulletFactor(t: Unit, shooter: Unit): number {
    if (t.variant !== 'blindado' && t.bossVariant !== 'embestida') return 1;
    const front = Math.abs(angDiff(Math.atan2(shooter.y - t.y, shooter.x - t.x), t.yaw)) <= Math.PI / 3;
    if (!front) return 1;
    if (t.variant === 'blindado') {
      if (this.time < t.staggerUntil || this.isBlinded(t)) return 1;       // escudo bajado por aturdimiento o cegadora
      this.events.push({ type: 'shieldHit', id: t.id, x: t.x, y: t.y, z: this.height(t) * 0.6 });
      return 0;
    }
    if (this.time < t.staggerUntil) return 1; // v1.3-jefes: la Embestida aturdida (tras fallar) no se cubre: es la ventana para pegarle
    return 0.3;
  }

  private shootRay(u: Unit, tx: number, ty: number, tz: number, spread: number, pistol: boolean, cone: boolean, weapon: WeaponSlot, ctx: { hit: boolean; head: boolean }): void {
    const oz = this.muzzleZ(u);
    let dx = tx - u.x, dy = ty - u.y, dz = tz - oz;
    const hd = Math.hypot(dx, dy) || 1e-6;
    let yaw = Math.atan2(dy, dx), pitch = Math.atan2(dz, hd);
    yaw += this.gauss() * spread; pitch += this.gauss() * spread * 0.6;
    if (cone) { const r = SHOTGUN.cone * Math.sqrt(this.rng()), a = this.rng() * Math.PI * 2; yaw += r * Math.cos(a); pitch += r * Math.sin(a); }
    dx = Math.cos(yaw) * Math.cos(pitch); dy = Math.sin(yaw) * Math.cos(pitch); dz = Math.sin(pitch);
    const R = WEAPON_RANGE;
    const ex = u.x + dx * R, ey = u.y + dy * R, ez = oz + dz * R;
    const ri = this.level.rayInfo(u.x, u.y, oz, ex, ey, ez, 'bullet');
    let t = ri.t;
    const tWall = t;
    const other: Team = u.team === 'ally' ? 'enemy' : 'ally';
    const hit = this.rayUnits(u.x, u.y, oz, ex, ey, ez, other, t);
    let kind: 'none' | 'wall' | 'entity' = t < 1 ? 'wall' : 'none';
    let surface: 'wall' | 'door' | 'furniture' | 'floor' | 'body' | 'none' = t < 1 ? ri.surface : 'none';
    let nx = ri.nx, ny = ri.ny;
    if (hit) { t = hit.t; kind = 'entity'; surface = 'body'; const hl = Math.hypot(dx, dy) || 1; nx = -dx / hl; ny = -dy / hl; }
    const ix = u.x + (ex - u.x) * t, iy = u.y + (ey - u.y) * t, iz = Math.max(0, oz + (ez - oz) * t);
    this.events.push({ type: 'shot', id: u.id, kind: u.kind, team: u.team, fx: u.x + dx * 0.5, fy: u.y + dy * 0.5, fz: oz, tx: ix, ty: iy, tz: iz, hit: kind, surface, nx, ny, weapon });
    if (u.stats.explosive && !pistol) {
      // retrocede un poco del muro para que la explosión no nazca dentro
      const bk = Math.min(0.2, t * R);
      this.explode(ix - dx * bk, iy - dy * bk, Math.max(0.2, iz - dz * bk), BLAST_RADIUS + (u.isPlayer ? this.mods.blastBonus : 0), u.stats.damage, u, hit ? hit.u : null);
      if (hit && u.isPlayer && !ctx.hit) { ctx.hit = true; this.stats.shotsHit++; }
      return;
    }
    if (hit) {
      // «Apuntar importa» (§13) premia a quien apunta: la escuadra. Los enemigos no multiplican por zona
      // (un ×2,5 fortuito de 40 tiradores a la vez mataba sin que el jugador pudiera hacer nada). Ver DECISIONES.
      const base = pistol ? PISTOL.damage : u.stats.damage;
      const headMult = HEAD_MULT + (u.team === 'ally' ? this.mods.headBonus : 0);
      const zmult = (z: HitZone) => u.team === 'enemy' ? 1 : z === 'head' ? headMult : z === 'limb' ? LIMB_MULT : 1;
      if (u.isPlayer && !ctx.hit) { ctx.hit = true; this.stats.shotsHit++; }
      if (u.isPlayer && hit.zone === 'head' && !ctx.head) { ctx.head = true; this.stats.headshots = (this.stats.headshots ?? 0) + 1; }
      const f = this.bulletFactor(hit.u, u);
      if (f <= 0) return;                                    // el escudo la para (tampoco hay perforante)
      // Daño directo de una bala: this.damage(objetivo, cantidad, zona, atacante, desdeX, desdeY) — ver damage().
      this.damage(hit.u, base * zmult(hit.zone) * f, u, hit.zone, u.x, u.y);
      // munición perforante: la bala del jugador atraviesa a un enemigo y sigue hasta el siguiente cuerpo (si no hay muro antes)
      if (u.isPlayer && this.mods.pierce) {
        const h2 = this.rayUnits(u.x, u.y, oz, ex, ey, ez, other, tWall, hit.t, hit.u);
        if (h2 && h2.u !== hit.u) {
          const f2 = this.bulletFactor(h2.u, u);
          if (f2 > 0) {
            if (h2.zone === 'head' && !ctx.head) { ctx.head = true; this.stats.headshots = (this.stats.headshots ?? 0) + 1; }
            this.damage(h2.u, base * zmult(h2.zone) * f2, u, h2.zone, u.x, u.y);
          }
        }
      }
    }
  }

  /** Explosión con daño a TODOS (también amigos y a uno mismo), caída lineal y línea de visión obligatoria. */
  explode(x: number, y: number, z: number, radius: number, maxDmg: number, owner: Unit | null, direct: Unit | null = null): void {
    this.events.push({ type: 'explosion', x, y, z, radius });
    this.noises.push({ x, y, loud: 42, team: owner ? owner.team : 'ally', id: owner ? owner.id : -1, kind: 'blast' });
    for (const e of this.entities) {
      if (!e.alive || e.downed) continue;
      const d = e === direct ? 0 : Math.max(0, Math.hypot(e.x - x, e.y - y) - e.radius * 0.5);
      if (d >= radius) continue;
      if (e !== direct) {
        const h = this.height(e);
        const zz = Math.max(0.3, z);
        if (!this.level.clear(x, y, zz, e.x, e.y, h * 0.5, 'bullet') && !this.level.clear(x, y, zz, e.x, e.y, h - 0.15, 'bullet')) continue;
      }
      // el escudo del blindado baja 2,5 s con una explosión (las explosiones no las para)
      if (e.variant === 'blindado') e.staggerUntil = Math.max(e.staggerUntil, this.time + 2.5);
      let dmg = maxDmg * (1 - d / radius);
      // voltereta: durante los primeros 0,25 s las explosiones le hacen la mitad al jugador
      if (e.isPlayer && this.time < e.rollUntil && this.time >= e.rollUntil - ROLL.time && this.time < e.rollUntil - ROLL.time + ROLL.halfBlast) dmg *= 0.5;
      this.damage(e, dmg, owner, 'blast', x, y);
    }
  }

  knife(u: Unit): void {
    u.knifeCd = KNIFE_PERIOD;
    u.lastKnifeAt = this.time;
    let best: Unit | null = null, bd = Infinity;
    for (const e of this.entities) {
      if (!e.alive || e.team === u.team) continue;
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      if (d > u.radius + KNIFE_RANGE + (u.team === 'ally' ? this.mods.knifeRange : 0) + e.radius * 0.5) continue;
      if (Math.abs(angDiff(Math.atan2(e.y - u.y, e.x - u.x), u.yaw)) > 1.1) continue;
      if (!this.level.clear(u.x, u.y, 1.1, e.x, e.y, Math.min(1.1, this.height(e) * 0.7), 'bullet')) continue;
      if (d < bd) { bd = d; best = e; }
    }
    this.events.push({ type: 'knife', id: u.id, hit: !!best });
    if (best) {
      const dmg = u.team === 'ally' ? KNIFE_DAMAGE * this.mods.knifeMult : (u.ekind === 'enemy1' ? 6 : u.ekind === 'enemy2' ? 8 : 10);
      this.damage(best, dmg, u, 'knife', u.x, u.y);
    }
  }

  /** Granada explosiva (la rápida, `input.grenade`). */
  throwGrenade(u: Unit, tx: number, ty: number): boolean { return this.throwTyped(u, 'frag', tx, ty); }

  /** Lanza una granada del tipo dado si quedan y no hay enfriamiento. */
  throwTyped(u: Unit, type: GrenadeType, tx: number, ty: number): boolean {
    if (u.grenadeCd > 0) return false;
    if (type === 'frag') { if (u.grenades <= 0) return false; u.grenades--; }
    else if (type === 'flash') { if (u.flashes <= 0) return false; u.flashes--; }
    else { if (u.smokes <= 0) return false; u.smokes--; }
    u.grenadeCd = GRENADE_COOLDOWN;
    this.launch(u, type === 'frag' ? 'grenade' : type, tx, ty, 18);
    return true;
  }
  grenadeStock(u: Unit, type: GrenadeType): number { return type === 'frag' ? u.grenades : type === 'flash' ? u.flashes : u.smokes; }
  grenadeTotal(u: Unit): number { return u.grenades + u.flashes + u.smokes; }
  /** Siguiente tipo con existencias (frag → flash → smoke); deja el actual si no hay otro. */
  cycleGrenadeType(u: Unit): void {
    const order: GrenadeType[] = ['frag', 'flash', 'smoke'];
    const i = order.indexOf(u.grenadeType);
    for (let k = 1; k <= 3; k++) { const t = order[(i + k) % 3]; if (this.grenadeStock(u, t) > 0) { u.grenadeType = t; return; } }
  }

  /** Lanza un proyectil en parábola hacia (tx,ty). Toda granada o cohete anuncia un Threat 'blast' en su punto de caída previsto. */
  launch(u: Unit, kind: 'grenade' | 'rocket' | 'flash' | 'smoke', tx: number, ty: number, maxDist: number, opts: { bounce?: boolean; fuse?: number; dmg?: number } = {}): void {
    let dx = tx - u.x, dy = ty - u.y;
    let d = Math.hypot(dx, dy);
    if (d > maxDist) { dx *= maxDist / d; dy *= maxDist / d; d = maxDist; }
    if (d < 0.5) { dx = Math.cos(u.yaw) * 0.5; dy = Math.sin(u.yaw) * 0.5; d = 0.5; }
    const z0 = this.muzzleZ(u);
    const T = kind === 'rocket' ? Math.max(0.6, d / 9) : Math.max(0.45, Math.min(1.2, d / 13));
    const g = kind === 'rocket' ? 2 : 9.8;
    let fuse = T + (kind === 'grenade' ? 0.3 : kind === 'rocket' ? 0.02 : kind === 'smoke' ? 0.05 : 0);
    if (kind === 'flash') fuse = FLASH.fuse;
    if (opts.fuse !== undefined) fuse = opts.fuse;
    const id = this.nextId++;
    this.projectiles.push({
      id, kind, ownerId: u.id, team: u.team, x: u.x, y: u.y, z: z0,
      vx: dx / T, vy: dy / T, vz: (0.1 - z0 + 0.5 * g * T * T) / T, fuse, dead: false,
    });
    const meta: { threat?: number; dmg?: number; bounces?: number; radius?: number } = {};
    if (opts.dmg !== undefined) meta.dmg = opts.dmg;
    if (opts.bounce) meta.bounces = 1;
    if (kind === 'grenade' || kind === 'rocket') {
      const r = BLAST_RADIUS + (u.isPlayer ? this.mods.blastBonus : 0);
      meta.radius = r;
      // punto de caída previsto: donde llega la parábola (con rebote, el sitio del primer impacto; es un aviso aproximado)
      meta.threat = this.addThreat({ kind: 'blast', fx: u.x, fy: u.y, x: u.x + dx, y: u.y + dy, r, at: this.time + fuse, ownerId: u.id }).id;
    }
    this.projMeta.set(id, meta);
    this.events.push({ type: 'throw', id: u.id, kind });
  }

  /** Lanzador de rebote del Explosivo (variante 1): la granada rebota una vez en pared o suelo y estalla a 1,3 s. */
  private launchBounce(u: Unit, tx: number, ty: number): void {
    this.launch(u, 'grenade', tx, ty, 30, { bounce: true, fuse: BOUNCER.fuse, dmg: u.stats.damage });
  }

  private flashBang(x: number, y: number, owner: Unit | null): void {
    let playerBlind = 0;
    for (const e of this.entities) {
      if (!e.alive || e.downed) continue;
      if (Math.hypot(e.x - x, e.y - y) > FLASH.radius) continue;
      if (!this.level.clear(x, y, 1.0, e.x, e.y, this.height(e) * 0.7, 'sight')) continue;
      const secs = e.team === 'ally' ? FLASH.allyBlind : FLASH.enemyBlind;
      e.blindedUntil = Math.max(e.blindedUntil, this.time + secs);
      if (e.variant === 'blindado') e.staggerUntil = Math.max(e.staggerUntil, this.time + 2.5);
      if (e.isPlayer) playerBlind = secs;
    }
    void owner;
    this.events.push({ type: 'flash', x, y, z: 1.0, radius: FLASH.radius, playerBlind });
    this.noises.push({ x, y, loud: 30, team: owner ? owner.team : 'ally', id: owner ? owner.id : -1, kind: 'blast' });
  }

  private updateProjectiles(dt: number): void {
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      const meta = this.projMeta.get(pr.id);
      const g = pr.kind === 'rocket' ? 2 : 9.8;
      const moving = pr.vx !== 0 || pr.vy !== 0 || pr.vz !== 0;
      let boom = false;
      if (moving) {
        const nx = pr.x + pr.vx * dt, ny = pr.y + pr.vy * dt;
        let nz = pr.z + pr.vz * dt;
        pr.vz -= g * dt;
        const ri = this.level.rayInfo(pr.x, pr.y, Math.max(0.05, pr.z), nx, ny, Math.max(0.05, nz), 'bullet');
        const t = ri.t;
        if (t < 1) {
          // choca: se queda ahí (la granada cae al suelo; el cohete estalla); el lanzador de rebote rebota una vez
          pr.x += (nx - pr.x) * Math.max(0, t - 0.1); pr.y += (ny - pr.y) * Math.max(0, t - 0.1);
          if (meta?.bounces && pr.kind === 'grenade') {
            const dot = pr.vx * ri.nx + pr.vy * ri.ny;
            pr.vx = (pr.vx - 2 * dot * ri.nx) * 0.5; pr.vy = (pr.vy - 2 * dot * ri.ny) * 0.5;
            meta.bounces--;
          } else pr.vx = pr.vy = 0;
          if (pr.kind === 'rocket') boom = true;
        } else { pr.x = nx; pr.y = ny; }
        if (nz <= 0.1) {
          nz = 0.1;
          if (meta?.bounces && pr.kind === 'grenade' && pr.vz < -1) { pr.vz = -pr.vz * 0.5; meta.bounces--; }
          else { pr.vx = pr.vy = pr.vz = 0; if (pr.kind === 'rocket') boom = true; }
        }
        pr.z = nz;
        if (pr.kind === 'rocket') {
          // el cohete estalla al tocar a alguien del otro bando
          for (const e of this.entities) {
            if (e.alive && !e.downed && e.team !== pr.team && Math.hypot(e.x - pr.x, e.y - pr.y) < e.radius + 0.15 && pr.z < this.height(e)) { boom = true; break; }
          }
        }
      }
      pr.fuse -= dt;
      if (pr.fuse <= 0 || boom) {
        pr.dead = true;
        const owner = this.entityById(pr.ownerId) ?? null;
        if (meta?.threat !== undefined) this.removeThreat(meta.threat);
        this.projMeta.delete(pr.id);
        if (pr.kind === 'flash') { this.flashBang(pr.x, pr.y, owner); continue; }
        if (pr.kind === 'smoke') {
          this.smokes.push({ id: this.threatId++, x: pr.x, y: pr.y, r: SMOKE.radius, from: this.time, until: this.time + SMOKE.duration });
          this.events.push({ type: 'smoke', x: pr.x, y: pr.y, z: Math.max(0.3, pr.z), radius: SMOKE.radius, duration: SMOKE.duration });
          continue;
        }
        const dmg = meta?.dmg ?? (pr.kind === 'grenade' ? GRENADE_DAMAGE : 30);
        this.explode(pr.x, pr.y, Math.max(0.3, pr.z), meta?.radius ?? BLAST_RADIUS, dmg, owner);
      }
    }
    if (this.projectiles.length > 0 && this.projectiles[0].dead) this.projectiles = this.projectiles.filter(p => !p.dead);
  }

  /**
   * Daño a una unidad: damage(objetivo, cantidad, atacante, zona, desdeX, desdeY). Los compañeros (no el jugador) que
   * llegan a 0 de vida no mueren: quedan derribados 25 s y se pueden reanimar (v1.3).
   */
  damage(t: Unit, amount: number, attacker: Unit | null, zone: HitZone | 'blast' | 'knife', fromX: number, fromY: number): void {
    if (!t.alive || t.downed || amount <= 0) return;
    if (t.isPlayer && this.cheats.god) return;
    if (t.team === 'ally' && this.status === 'cleared') return; // zona limpia: un cohete rezagado ya no te quita la victoria
    if (t.shielded) return;
    if (t.isPlayer && this.time < this.invulnUntil) return; // último aliento: 1,5 s de invulnerabilidad
    if (t.kind === 'megaboss') amount = this.director.bossDamageGate(t, amount);
    if (amount <= 0) return;
    amount *= damageTakenMult(t, this); // TODO(v1.3-jefes) YA CONECTADO por el agente de enemigos: jefe expuesto ×1,5 (no aplicarlo otra vez)
    if (t.team === 'ally') amount *= this.mods.damageTaken; // chaleco
    // Último aliento: una vez por zona, un golpe mortal al jugador lo deja a 1 de vida
    if (t.isPlayer && this.mods.lastBreath && !this.lastBreathUsed && t.hp - amount <= 0) {
      this.lastBreathUsed = true;
      this.invulnUntil = this.time + 1.5;
      amount = Math.max(0, t.hp - 1);
      if (amount <= 0) return;
    }
    t.hp -= amount;
    t.lastHurtAt = this.time;
    if (t.isPlayer) this.stats.damageTaken += amount;
    this.events.push({ type: 'hurt', id: t.id, amount, zone, fromX, fromY, attackerId: attacker ? attacker.id : -1 });
    if (t.team === 'enemy') {
      this.enemyAI.onHurt(t, attacker, fromX, fromY);
      // aturdimiento: golpe fuerte (≥ 18), cabeza de un aliado o explosión ≥ 20; no los jefes, y como mucho uno cada 1,2 s
      if (t.hp > 0 && t.kind !== 'miniboss' && t.kind !== 'megaboss' && this.time - t.staggerAt >= STAGGER_COOLDOWN) {
        const strong = (zone !== 'blast' && amount >= 18) || (zone === 'head' && !!attacker && attacker.team === 'ally') || (zone === 'blast' && amount >= 20);
        if (strong) { t.staggerAt = this.time; t.staggerUntil = this.time + STAGGER_TIME; t.aiState = 'aturdido'; }
      }
    }
    else if (t.brain) { t.brain.hurtAt = this.time; t.brain.hurtBy = attacker ? attacker.id : -1; }
    if (t.hp <= 0) {
      if (t.team === 'ally' && !t.isPlayer && t.cls) this.goDown(t);
      else this.kill(t, attacker, zone === 'head', fromX, fromY);
    }
  }

  /** Derriba a un compañero (v1.3): sigue `alive`, no actúa ni recibe daño, y los enemigos lo ignoran. */
  private goDown(t: Unit): void {
    t.hp = 0; t.downed = true; t.downedUntil = this.time + DOWNED.time; t.reviveProgress = 0; t.reviveAt = -99;
    t.wishX = t.wishY = 0; t.vx = t.vy = 0; t.marked = false; t.reloading = 0; t.aiState = 'derribado';
    if (this.order.targetId === t.id) this.order.targetId = -1;
    this.events.push({ type: 'downed', id: t.id, kind: t.kind, x: t.x, y: t.y });
    this.bark(t, 'ally.downed');
  }

  /** Levanta a un derribado con el 30 % de vida (o `hp` si se da). */
  revive(t: Unit, by: Unit | null, hp?: number): void {
    if (!t.downed) return;
    t.downed = false; t.reviveProgress = 0; t.downedUntil = 0;
    t.hp = Math.max(1, hp ?? Math.round(t.maxHp * DOWNED.reviveHp));
    t.aiState = '';
    this.events.push({ type: 'revived', id: t.id, byId: by ? by.id : -1 });
  }

  /** Un paso de reanimación de `t` por `by` (3 s seguidos). Si se interrumpe, el progreso vuelve a 0. */
  reviveTick(t: Unit, by: Unit, dt: number): void {
    if (!t.downed) return;
    t.reviveAt = this.time;
    t.reviveProgress += dt / DOWNED.reviveTime;
    if (t.reviveProgress >= 1) this.revive(t, by);
  }

  /** Derribado más cercano al punto (dentro de `range`), o null. */
  downedNear(x: number, y: number, range: number): Unit | null {
    let best: Unit | null = null, bd = range;
    for (const e of this.entities) {
      if (!e.alive || !e.downed) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d <= bd) { bd = d; best = e; }
    }
    return best;
  }

  kill(t: Unit, attacker: Unit | null = null, headshot = false, fromX?: number, fromY?: number): void {
    if (!t.alive) return;
    t.hp = 0; t.alive = false; t.downed = false; t.deadAt = this.time; t.wishX = t.wishY = 0; t.vx = t.vy = 0; t.marked = false; t.shielded = false;
    this.events.push({ type: 'death', id: t.id, kind: t.kind, team: t.team, x: t.x, y: t.y,
      killerId: attacker ? attacker.id : -1, headshot, fromX: fromX ?? t.x, fromY: fromY ?? t.y });
    if (t.team === 'enemy') {
      const pts = Math.round(t.stats.points * this.scoreMult);
      this.score += pts; this.stats.scoreGained += pts; this.stats.kills++;
      if (attacker && attacker.isPlayer) {
        this.streak = this.time - this.lastPlayerKillAt < 4 ? this.streak + 1 : 1;
        this.lastPlayerKillAt = this.time;
        this.stats.bestStreak = Math.max(this.stats.bestStreak ?? 0, this.streak);
      }
      this.enemyAI.onDeath(t);
      // botín ocasional (ver DECISIONES): evita quedarse sin munición si cae el Especialista
      const boss = t.kind === 'miniboss' || t.kind === 'megaboss';
      // Sin Especialista vivo no hay aura de munición: los caídos sueltan balas mucho más a menudo.
      const r = this.rng();
      let pAmmo = this.entities.some(e => e.alive && e.cls === 'especialist') ? 0.12 : 0.5;
      // Red de seguridad: si a la escuadra entera le quedan menos de 40 balas, el caído suelta munición seguro.
      let squadAmmo = 0;
      for (const e of this.entities) if (e.alive && e.team === 'ally') squadAmmo += e.mag + e.ammo;
      if (squadAmmo < 40) pAmmo = 1;
      if (this.mut.escasez) pAmmo *= 0.5; // escasez: la mitad de botín de munición
      if (boss || r < pAmmo + 0.1 + this.mods.dropBonus) {
        this.pickups.push({ id: this.nextId++, type: boss ? 'vida_50' : r < pAmmo ? 'municion_20' : 'vida_20', x: t.x, y: t.y, taken: false });
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
      // Combo «apagón» (v1.3): sin puerta a la vista, o un segundo uso seguido (< 8 s), apaga las luces 10 s
      if (best < 0 || this.time - this.lastHackAt < 8) {
        this.lightsOffUntil = this.time + 10; ok = true;
        this.events.push({ type: 'lights', on: false });
        this.events.push({ type: 'combo', key: 'apagon', x: u.x, y: u.y });
      } else if (best >= 0) { this.toggleDoor(best, true, u); ok = true; ax = this.level.doors[best].cx; ay = this.level.doors[best].cy; }
      if (ok) this.lastHackAt = this.time;
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
        // Combo «conmoción» (v1.3): los enemigos a ≤ 4 m del boquete por el otro lado quedan aturdidos 2 s
        let conm = false;
        for (const e of this.entities) {
          if (!e.alive || e.downed || e.team === u.team || e.kind === 'miniboss' || e.kind === 'megaboss') continue;
          if (Math.hypot(e.x - ax, e.y - ay) > 4) continue;
          if ((e.x - ax) * (ax - u.x) + (e.y - ay) * (ay - u.y) <= 0) continue;   // del lado del que demuele: no
          e.staggerAt = this.time; e.staggerUntil = Math.max(e.staggerUntil, this.time + 2); e.aiState = 'aturdido'; conm = true;
        }
        if (conm) this.events.push({ type: 'combo', key: 'conmocion', x: ax, y: ay });
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
      // Combo «clavado» (v1.3): la Supresión sobre un enemigo marcado lo deja clavado 3 s
      if (e.marked) {
        if (this.time >= e.pinnedUntil) this.events.push({ type: 'combo', key: 'clavado', x: e.x, y: e.y });
        e.pinnedUntil = Math.max(e.pinnedUntil, this.time + 3);
      } else e.pinnedUntil = this.time + 1.2;
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
    const lm = u.team === 'ally' ? this.mods.lootMult : 1; // carroñero
    if (e.hp > 0) {
      if (u.hp >= u.maxHp) return false;
      u.hp = Math.min(u.maxHp, u.hp + Math.round(e.hp * lm));
    } else {
      if (u.ammo + u.mag >= AMMO_CAP) return false;
      u.ammo = Math.min(AMMO_CAP - u.mag, u.ammo + Math.round(e.ammo * lm));
    }
    return true;
  }

  private updatePickups(): void {
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      for (const u of this.entities) {
        if (!u.alive || u.downed || u.hostage || u.team !== 'ally') continue;
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
    const allies = this.entities.filter(e => e.alive && !e.downed && e.team === 'ally');
    if (this.auraHpAcc >= 2) {
      this.auraHpAcc -= 2;
      const cap = this.mut.sinAura ? undefined : allies.find(a => a.cls === 'captain');
      if (cap) {
        // la moral sube con el aura del Capitán; con la moral hundida el aura no cura
        this.morale = Math.min(100, this.morale + 1);
        if (this.morale >= 20) {
          for (const a of allies) if (Math.hypot(a.x - cap.x, a.y - cap.y) <= AURA_RADIUS + this.mods.auraBonus) a.hp = Math.min(a.maxHp, a.hp + 1 + this.mods.medicAura);
        }
      }
    }
    if (this.auraAmmoAcc >= 4) {
      this.auraAmmoAcc -= 4;
      const sp = allies.find(a => a.cls === 'especialist');
      if (sp) for (const a of allies) {
        if (Math.hypot(a.x - sp.x, a.y - sp.y) <= AURA_RADIUS + this.mods.auraBonus) a.ammo = Math.min(AMMO_CAP - a.mag, a.ammo + 10 + this.mods.ammoAura);
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
      // aturdido: se mueve al 40 %
      const sl = u.team === 'enemy' && this.time < u.staggerUntil ? 0.4 : 1;
      u.vx += (u.wishX * sl - u.vx) * k; u.vy += (u.wishY * sl - u.vy) * k;
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
        const sprintLoud = u.sprinting && !this.mods.quietSprint; // esprintar: paso cada 1,3 m y más ruido (salvo «sigilo»)
        if (u.stepAcc > (u.sprinting ? 1.3 : 1.7)) {
          u.stepAcc = 0;
          this.events.push({ type: 'step', id: u.id, x: u.x, y: u.y });
          if (u.team === 'ally') this.noises.push({ x: u.x, y: u.y, loud: u.isPlayer ? (sprintLoud ? 9 : 6) : 4, team: 'ally', id: u.id, kind: 'step' });
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
