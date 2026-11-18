// IA de los enemigos (§14). Percepción con dos conos + pared, oído por donde se anda, memoria que se
// desdibuja, avisos con retardo, cobertura, reparto de papeles (fijar / rodear / presionar), repliegue,
// patrulla y compromiso mínimo con cada decisión.
//
// Lo que NUNCA puede pasar, por construcción:
//  - Ver a través de una pared o una puerta cerrada: toda detección pasa por world.canSee (rayo 'sight').
//  - Disparar a través de un tabique: world.fire traza la bala con un rayo real; además no se aprieta el
//    gatillo sin world.shotLine() válida en ese mismo instante.
//
// v1.3 — oficios (asaltante, tirador, granadero, blindado) y jefes de planta (ametrallador, embestida, escoltas).
//  - Toda la visión pasa por this.visible(): world.canSee (pared, humo, cegado) y nunca un compañero derribado.
//  - Todo ataque nuevo que quita mucha vida se anuncia antes con un Threat (laser / lane / charge) y lo que se
//    anuncia es EXACTAMENTE lo que luego se ejecuta: la dirección se fija al empezar el aviso (pasillos) o el aviso
//    se mueve con el punto apuntado (láser). Lo que pega son rayos reales: una pared siempre para la bala.

import {
  ALERT_DELAY, ASALTANTE, BLINDADO, BOSS_CHARGER, BOSS_ESCORTED, BOSS_EXPOSED_MULT, BOSS_GUNNER, BOSS_LATE, ENEMY_STATS, FLASH,
  GRANADERO, TIRADOR, V13_ALLY_AI_DAMAGE, VISION,
} from './data';
import type { CoverPoint } from './level';
import type { BossVariant, EnemyKind, EnemyVariant, Entity, Threat, Vec2 } from './types';
import { angDiff, type Unit, type World } from './world';

type State = 'patrol' | 'investigate' | 'cover' | 'advance' | 'flank' | 'search' | 'retreat' | 'melee' | 'boss' | 'special';
type Role = 'suppress' | 'flank' | 'assault';

interface Belief { x: number; y: number; t: number; id: number; vx: number; vy: number }

interface Brain {
  squad: Squad;
  state: State;
  stateAt: number;
  /** hasta cuándo se compromete con la decisión actual */
  commitUntil: number;
  aware: number;
  belief: Belief | null;
  pending: { at: number; b: Belief } | null;
  /** objetivo que VE ahora mismo (según el último muestreo), -1 si ninguno */
  visId: number;
  senseAt: number;
  role: Role;
  cover: CoverPoint | null;
  hide: Vec2 | null;
  peek: Vec2 | null;
  peeking: boolean;
  phaseUntil: number;
  coverCheckAt: number;
  cycles: number;
  band: number;
  dest: Vec2 | null;
  patrolI: number;
  waitUntil: number;
  searchPts: Vec2[];
  inv: Vec2 | null;
  reactAt: number;
  burstUntil: number;
  restUntil: number;
  faceYaw: number;
  alerted: boolean;
  hunt: boolean;
  home: Vec2;
  lastSawAt: number;
  specialAt: number;
  unstuck: number;
  /** ya está en su puesto de cobertura (aunque no clave el punto exacto) */
  atHide: boolean;
  peekDone: boolean;
  /** a quién dispara en la ráfaga en curso */
  fireTarget: number;
  hideDone: boolean;
  // ── v1.3 ──
  /** asaltante: ya ha gritado la carga de este combate */
  chargeBarked: boolean;
  /** tirador */
  sn: Sniper | null;
  /** granadero: ancla de «el blanco no se mueve» y enfriamiento */
  gr: { ax: number; ay: number; since: number; nextAt: number } | null;
  /** escolta del jefe (id del jefe) o -1 */
  escortOf: number;
  /** jefe de escoltas: ha llegado a tener escoltas (si no, nunca se enfurece) */
  hadEscorts: boolean;
  /** jefes ametrallador / embestida */
  bs: BossAttack | null;
  wasBlind: boolean;
}

interface Sniper {
  spot: Vec2 | null; settled: boolean; pickAt: number; moveAt: number; seenAt: number; mustMove: boolean;
  threat: Threat | null; targetId: number; ax: number; ay: number; az: number; losLostAt: number; shots: number; nextAt: number;
}
interface BossAttack {
  phase: 'idle' | 'tele' | 'sweep' | 'reload' | 'dash' | 'stun' | 'recover';
  until: number; nextAt: number; yaw: number; dx: number; dy: number; dist: number; len: number;
  x0: number; y0: number; px: number; py: number; t0: number; stall: number; threat: Threat | null;
}

/**
 * v1.3 — multiplicador del daño que recibe `e` por estar expuesto (jefe recargando o aturdido tras fallar la embestida).
 * Lo llama World.damage. 1 si no aplica (y si falta el dato: sin ventana anunciada no hay daño extra).
 */
export function damageTakenMult(e: Entity, world: { time: number }): number {
  return e.team === 'enemy' && (e.exposedUntil ?? 0) > world.time ? BOSS_EXPOSED_MULT : 1;
}

/** v1.3 — convierte a un enemigo normal en un oficio: copia sus estadísticas (la tabla ENEMY_STATS no se toca). */
export function applyVariant(u: Unit, v: EnemyVariant): void {
  if (u.kind !== 'enemy1' && u.kind !== 'enemy2' && u.kind !== 'enemy3') return;
  const st = { ...u.stats };
  if (v === 'asaltante') { st.hp *= ASALTANTE.hpMult; st.speed *= ASALTANTE.speedMult; }
  else if (v === 'tirador') { st.hp *= TIRADOR.hpMult; }
  else if (v === 'blindado') { st.hp *= BLINDADO.hpMult; st.speed *= BLINDADO.speedMult; st.rof *= BLINDADO.rofMult; st.magSize = Math.max(1, Math.round(st.magSize * BLINDADO.magMult)); st.reloadTime *= BLINDADO.reloadMult; }
  st.hp = Math.round(st.hp);
  u.stats = st; u.variant = v; u.hp = u.maxHp = st.hp;
  if (st.magSize !== u.magSize) { u.ammo += u.mag - st.magSize; u.mag = u.magSize = st.magSize; } // cargador corto: mismas balas en total
}

/** v1.3 — da a un MiniBoss su variante de planta (nombre, arma y vida). 'cohetes' es el de siempre. */
export function applyBossVariant(u: Unit, v: BossVariant, floor: number): void {
  if (u.kind !== 'miniboss') return;
  const st = { ...u.stats };
  if (v === 'ametrallador') { st.explosive = false; st.damage = BOSS_GUNNER.damage; st.rof = BOSS_GUNNER.rof; st.magSize = Math.round(BOSS_GUNNER.rof * BOSS_GUNNER.sweep); st.reloadTime = BOSS_GUNNER.reload; }
  else if (v === 'embestida') { st.explosive = false; st.damage = BOSS_CHARGER.bulletDamage; st.rof = BOSS_CHARGER.rof; st.magSize = 10; st.reloadTime = 2; }
  else if (v === 'escoltas') { const vet = ENEMY_STATS.enemy3; st.explosive = false; st.damage = vet.damage; st.rof = vet.rof; st.magSize = vet.magSize; st.reloadTime = vet.reloadTime; }
  if (floor >= BOSS_LATE.fromFloor) st.hp = Math.round(st.hp * BOSS_LATE.hpMult);
  u.stats = st; u.bossVariant = v; u.bossName = 'boss.' + v;
  u.hp = u.maxHp = st.hp; u.mag = u.magSize = st.magSize;
}

export class Squad {
  members: Unit[] = [];
  initial = 0;
  belief: Belief | null = null;
  mode: 'calm' | 'combat' | 'retreat' = 'calm';
  route: Vec2[] = [];
  rally: Vec2;
  rolesAt = -99;
  retreated = false;
  retreatAt = 0;
  pen: Float32Array | null = null;
  penAt = -99; penX = 0; penY = 0;
  shareAt = -99;
  alertEvtAt = -99;
  constructor(public id: number, public home: Vec2, public hunt: boolean) { this.rally = home; }
}

// Dispersión (sigma, rad). Además, un blanco que corre es mucho más difícil: la velocidad del jugador es su defensa.
const SPREAD: Record<EnemyKind, number> = { enemy1: 0.085, enemy2: 0.07, enemy3: 0.055, miniboss: 0.03, megaboss: 0.12 };
/** distancia a la que le gusta pelear a cada tipo [mín, máx] */
const BAND: Record<EnemyKind, [number, number]> = { enemy1: [5, 11], enemy2: [8, 16], enemy3: [11, 21], miniboss: [6, 14], megaboss: [5, 14] };

export class EnemyAI {
  squads: Squad[] = [];
  private nextSquad = 1;
  /** última posición conocida por CUALQUIER enemigo (la «radio») */
  global: Belief | null = null;
  /** 0 = sin flanqueo ni repliegue (planta 1, tutorial); 1 = todo */
  tactics = 1;
  /** v1.3 — dificultad difícil: el láser del tirador apunta menos tiempo */
  hard = false;
  private lastLowBarkAt = -99;
  private lastGrenadeAt = -99;
  /** cuándo disparó por última vez un tirador a cada blanco (id → world.time) */
  private sniped = new Map<number, number>();
  /** mapa de exposición compartido por los asaltantes (ruta que evita el pasillo de fuego) */
  private pen: Float32Array | null = null;
  private penAt = -99; private penX = 0; private penY = 0;

  constructor(private w: World) {}

  newSquad(home: Vec2, hunt: boolean): Squad {
    const s = new Squad(this.nextSquad++, home, hunt);
    this.squads.push(s);
    return s;
  }

  register(u: Unit): void {
    const s = this.newSquad([u.x, u.y], false);
    u.brain = this.mkBrain(u, s);
    s.members.push(u); s.initial = 1;
    u.yaw = this.w.rng() * Math.PI * 2;
  }

  /** Mueve la unidad a otra escuadra (lo usa el director al crear grupos). */
  join(u: Unit, s: Squad): void {
    const b = u.brain as Brain;
    const old = b.squad;
    if (old !== s) {
      old.members = old.members.filter(m => m !== u);
      if (old.members.length === 0) this.squads = this.squads.filter(q => q !== old);
      s.members.push(u);
      s.initial = Math.max(s.initial, s.members.length);
    }
    b.squad = s; b.hunt = s.hunt; b.home = s.home;
    b.patrolI = Math.floor(this.w.rng() * Math.max(1, s.route.length));
  }

  private mkBrain(u: Unit, s: Squad): Brain {
    const boss = u.kind === 'miniboss' || u.kind === 'megaboss';
    return {
      squad: s, state: boss ? 'boss' : 'patrol', stateAt: this.w.time, commitUntil: 0, aware: 0, belief: null, pending: null,
      visId: -1, senseAt: this.w.time + this.w.rng() * 0.1, role: 'assault', cover: null, hide: null, peek: null, peeking: false,
      phaseUntil: 0, coverCheckAt: 0, cycles: 0, band: 0, dest: null, patrolI: 0, waitUntil: 0, searchPts: [], inv: null,
      reactAt: 0, burstUntil: 0, restUntil: 0, faceYaw: u.yaw, alerted: false, hunt: s.hunt, home: s.home, lastSawAt: -99,
      specialAt: this.w.time + 3, unstuck: 0, atHide: false, peekDone: false, hideDone: false, fireTarget: -1,
      chargeBarked: false, sn: null, gr: null, escortOf: -1, hadEscorts: false, bs: null, wasBlind: false,
    };
  }

  /** v1.3 — marca a `u` como escolta del jefe `boss`: se queda cerca y lo cura mientras viva. */
  makeEscort(u: Unit, boss: Unit): void {
    (u.brain as Brain).escortOf = boss.id;
    (boss.brain as Brain).hadEscorts = true;
  }

  /** v1.3 — ¿`u` ve a `t`? Pared, humo y cegado van dentro de canSee; a un derribado no se le mira. Sin dato → no. */
  private visible(u: Unit, t: Unit): boolean {
    if (!t.alive || t.downed) return false;
    return this.w.canSee(u, t);
  }

  /** v1.3 — frase ligada a un estado real. Las de relleno (`low`) dejan hueco a las que avisan de un peligro. */
  private say(u: Unit, key: string, low = false): void {
    const w = this.w;
    if (low) { if (w.time - this.lastLowBarkAt < 6) return; if (w.bark(u, key)) this.lastLowBarkAt = w.time; }
    else w.bark(u, key);
  }

  private cancelLaser(b: Brain): void {
    if (b.sn && b.sn.threat) { this.w.removeThreat(b.sn.threat.id); b.sn.threat = null; }
  }
  private dropThreat(b: Brain): void {
    if (b.bs && b.bs.threat) { this.w.removeThreat(b.bs.threat.id); b.bs.threat = null; }
  }

  // ───────────────────────── sucesos ─────────────────────────

  onHurt(u: Unit, attacker: Unit | null, fx: number, fy: number): void {
    const b = u.brain as Brain; const w = this.w;
    if (!b) return;
    // Le han dado: sabe de dónde viene (más o menos) y se gira hacia quien dispara.
    const src = attacker && attacker.alive && attacker.team !== u.team ? attacker : null;
    if (!b.belief || w.time - b.belief.t > 1.5) {
      const blur = 1.5;
      const bx = (src ? src.x : fx) + (w.rng() - 0.5) * blur, by = (src ? src.y : fy) + (w.rng() - 0.5) * blur;
      const nb: Belief = { x: bx, y: by, t: w.time - 1.0, id: src ? src.id : -1, vx: 0, vy: 0 };
      this.setBelief(u, b, nb, true);
    }
    b.faceYaw = Math.atan2(fy - u.y, fx - u.x);
    // si está al descubierto, puede romper su compromiso para cubrirse
    if (b.state !== 'cover' && b.state !== 'melee' && b.state !== 'boss' && b.state !== 'retreat') b.commitUntil = Math.min(b.commitUntil, w.time + 0.3);
  }

  onDeath(u: Unit): void {
    const b = u.brain as Brain; const w = this.w;
    if (!b) return;
    this.releaseCover(u, b);
    this.cancelLaser(b); this.dropThreat(b); // un muerto no deja avisos colgando
    u.healTargetId = -1;
    const s = b.squad;
    s.members = s.members.filter(m => m !== u);
    s.rolesAt = -99;
    // quien lo vea caer se entera de que pasa algo ahí
    for (const m of w.entities) {
      if (!m.alive || m.team !== 'enemy' || m === u) continue;
      const mb = m.brain as Brain;
      if (mb.belief || Math.hypot(m.x - u.x, m.y - u.y) > 14) continue;
      if (w.canSee(m, u) || mb.squad === s) { mb.inv = [u.x, u.y]; if (mb.state === 'patrol') this.setState(m, mb, 'investigate', 0.5); }
    }
    if (s.members.length === 0) {
      this.squads = this.squads.filter(q => q !== s);
      w.morale = Math.min(100, w.morale + 6); // encuentro ganado
    }
  }

  // ───────────────────────── bucle ─────────────────────────

  update(dt: number): void {
    const w = this.w;
    // v1.2 tutorial: con `hold` nadie oye (los enemigos presentes siguen patrullando)
    if (!w.hold) this.hearNoises();
    for (const s of this.squads) this.squadTactics(s);
    for (const u of w.entities) {
      if (!u.alive || u.team !== 'enemy') continue;
      const b = u.brain as Brain;
      if (w.time >= b.senseAt) { if (!w.hold) this.sense(u, b, w.time - (b.senseAt - 0.1)); b.senseAt = w.time + 0.1; } // hold: tampoco ven
      if (b.pending && w.time >= b.pending.at) {
        const p = b.pending; b.pending = null;
        if (!b.belief || b.belief.t < p.b.t) this.setBelief(u, b, { ...p.b }, false);
      }
      // v1.3 — cegado: lo dice una vez
      const blind = w.isBlinded(u);
      if (blind && !b.wasBlind) this.say(u, 'enemy.blind', true);
      b.wasBlind = blind;
      this.think(u, b, dt);
      if (w.time < u.staggerUntil && u.kind !== 'miniboss' && u.kind !== 'megaboss' && u.aiState !== 'recarga') u.aiState = 'aturdido';
      // giro hacia donde quiere mirar (el blindado gira despacio: un flanqueo le gana la espalda)
      const rate = (u.kind === 'megaboss' || u.kind === 'miniboss' ? 2.6 : u.variant === 'blindado' ? BLINDADO.turnRate : 5.5) * dt;
      const d = angDiff(b.faceYaw, u.yaw);
      u.yaw += Math.abs(d) < rate ? d : Math.sign(d) * rate;
    }
    this.escortsUpdate(dt);
  }

  /** v1.3 — escoltas: curan al jefe mientras vivan y estén cerca; cuando caen las dos, el jefe se enfurece. */
  private escortsUpdate(dt: number): void {
    const w = this.w, E = BOSS_ESCORTED;
    for (const u of w.entities) {
      if (!u.alive || u.team !== 'enemy') continue;
      const b = u.brain as Brain;
      if (b.escortOf >= 0) {
        const boss = w.entityById(b.escortOf);
        u.healTargetId = -1;
        if (!boss || !boss.alive) { b.escortOf = -1; continue; }
        if (Math.hypot(boss.x - u.x, boss.y - u.y) <= E.healRange && boss.hp < boss.maxHp) {
          boss.hp = Math.min(boss.maxHp, boss.hp + E.healPerSec * dt);
          u.healTargetId = boss.id;
        }
      } else if (u.bossVariant === 'escoltas' && b.hadEscorts && !u.enraged) {
        let left = 0;
        for (const o of w.entities) if (o.alive && o.team === 'enemy' && (o.brain as Brain).escortOf === u.id) left++;
        if (left === 0) {
          u.enraged = true;
          u.stats = { ...u.stats, rof: u.stats.rof * E.enrageRof };
          this.say(u, 'enemy.enraged');
        }
      }
    }
  }

  // ───────────────────────── oído ─────────────────────────

  private hearNoises(): void {
    const w = this.w;
    if (w.noises.length === 0) return;
    for (const n of w.noises) {
      if (n.team !== 'ally') continue;
      for (const u of w.entities) {
        if (!u.alive || u.team !== 'enemy') continue;
        const b = u.brain as Brain;
        if (b.belief && w.time - b.belief.t < 3) continue; // ya sabe dónde estás
        if (Math.hypot(u.x - n.x, u.y - n.y) > n.loud) continue; // en línea recta ya no llega
        const d = w.soundDist(n.x, n.y, u.x, u.y, n.loud);
        if (d === Infinity) continue;
        // cuanto más lejos (andando) suena, peor sabe de dónde viene
        const blur = Math.min(6, 0.5 + d * 0.18);
        const px = n.x + (w.rng() - 0.5) * 2 * blur, py = n.y + (w.rng() - 0.5) * 2 * blur;
        if (n.kind === 'step' || n.kind === 'door') {
          b.aware = Math.max(b.aware, 0.4);
          if (b.state === 'patrol' && w.time >= b.commitUntil) { b.inv = [px, py]; this.setState(u, b, 'investigate', 1.2); }
          else b.faceYaw = Math.atan2(n.y - u.y, n.x - u.x);
        } else {
          b.inv = [px, py];
          b.aware = Math.max(b.aware, 0.6);
          // Si ya te andaba buscando por otro sitio, el disparo le corrige la idea de dónde estás
          // (antes iba y volvía entre el sitio viejo y el ruido).
          if (b.belief) { b.belief = { x: px, y: py, t: w.time - 2.6, id: b.belief.id, vx: 0, vy: 0 }; if (b.state === 'search') b.commitUntil = Math.min(b.commitUntil, w.time + 0.5); continue; }
          if (b.state === 'patrol' || b.state === 'search' || (b.state === 'investigate' && w.time >= b.commitUntil)) {
            this.setState(u, b, 'investigate', 1.5);
          }
          // el grupo reacciona como grupo, con retardo
          for (const m of b.squad.members) {
            const mb = m.brain as Brain;
            if (m === u || mb.belief || mb.state !== 'patrol') continue;
            mb.inv = [px + (w.rng() - 0.5) * 3, py + (w.rng() - 0.5) * 3];
            mb.waitUntil = w.time + ALERT_DELAY[m.ekind!] * (0.8 + w.rng() * 0.6);
            this.setState(m, mb, 'investigate', 1.5);
          }
        }
      }
    }
  }

  // ───────────────────────── vista ─────────────────────────

  private sense(u: Unit, b: Brain, dts: number): void {
    const w = this.w;
    const engaged = !!b.belief && w.time - b.belief.t < 4;
    // en combate mira hacia donde sabe que estás: cono más abierto y hasta el alcance del arma
    // v1.3 — con las luces apagadas (Hackeo) ven a la mitad de distancia; un cegado no ve nada
    const dim = w.lightsOffUntil > w.time ? 0.5 : 1;
    const pa = engaged ? 1.05 : VISION.primaryHalfAngle, pr = (engaged ? 30 : VISION.primaryRange) * dim;
    const sa = engaged ? 1.75 : VISION.peripheralHalfAngle, sr = (engaged ? 14 : VISION.peripheralRange) * dim;
    let best: Unit | null = null, bestRate = 0;
    if (!w.isBlinded(u)) for (const t of w.entities) {
      if (!t.alive || t.team !== 'ally' || t.downed) continue;
      const dx = t.x - u.x, dy = t.y - u.y;
      const d = Math.hypot(dx, dy);
      if (d > pr) continue;
      const ang = Math.abs(angDiff(Math.atan2(dy, dx), u.yaw));
      let rate = 0;
      if (d < 1.6) rate = 12;
      else if (ang <= pa && d <= pr) rate = 1 / (0.12 + 0.45 * (d / pr));
      else if (ang <= sa && d <= sr) rate = 1 / (0.5 + 0.8 * (d / sr));
      if (rate <= 0) continue;
      if (t.crouch) rate *= 0.6;
      if (rate <= bestRate * (t.isPlayer ? 0.8 : 1)) continue;
      if (!this.visible(u, t)) continue; // la pared manda (y el humo)
      best = t; bestRate = rate;
    }
    if (best) {
      b.aware = Math.min(1, b.aware + bestRate * dts);
      if (b.aware >= 1 || engaged) {
        b.visId = best.id; b.lastSawAt = w.time;
        this.setBelief(u, b, { x: best.x, y: best.y, t: w.time, id: best.id, vx: best.vx, vy: best.vy }, true);
      } else {
        b.visId = -1;
        b.faceYaw = Math.atan2(best.y - u.y, best.x - u.x); // algo se mueve por ahí: mira
        if (b.aware > 0.6 && b.state === 'patrol') { b.inv = [best.x, best.y]; this.setState(u, b, 'investigate', 1.0); }
      }
    } else {
      b.visId = -1;
      b.aware = Math.max(0, b.aware - 0.35 * dts);
    }
  }

  /** Adopta una creencia. `own`: la ha visto/sentido él (la comparte con el grupo); si no, se la han contado. */
  private setBelief(u: Unit, b: Brain, nb: Belief, own: boolean): void {
    const w = this.w;
    const wasCalm = !b.belief;
    b.belief = nb; b.aware = 1;
    const s = b.squad;
    if (!this.global || this.global.t < nb.t) this.global = nb;
    if (wasCalm) {
      if (!b.alerted) { b.alerted = true; b.reactAt = w.time + 0.25 + w.rng() * 0.35; }
      if (own && w.time - s.alertEvtAt > 6 && nb.t >= w.time - 0.2) { s.alertEvtAt = w.time; w.events.push({ type: 'alert', id: u.id, x: u.x, y: u.y }); this.say(u, 'enemy.contact', true); }
      if (b.state === 'patrol' || b.state === 'investigate' || b.state === 'search') b.commitUntil = 0;
    }
    if (own && w.time - s.shareAt > 0.4) {
      s.shareAt = w.time;
      if (!s.belief || s.belief.t < nb.t) s.belief = nb;
      if (s.mode === 'calm') s.mode = 'combat';
      const tell = (m: Unit, extra: number) => {
        const mb = m.brain as Brain;
        if (m === u || !m.alive) return;
        if (mb.belief && mb.belief.t >= nb.t - 0.5) return;
        if (mb.pending && mb.pending.b.t >= nb.t - 0.5) return;
        mb.pending = { at: w.time + extra + ALERT_DELAY[m.ekind!] * (0.85 + w.rng() * 0.3), b: nb };
      };
      for (const m of s.members) tell(m, 0);
      // los de otros grupos que estén a voz
      for (const q of this.squads) {
        if (q === s) continue;
        for (const m of q.members) {
          const d = Math.hypot(m.x - u.x, m.y - u.y);
          if (d < 6 || (d < 13 && this.visible(u, m))) tell(m, 0.4);
        }
      }
    }
  }

  // ───────────────────────── táctica de grupo ─────────────────────────

  private squadTactics(s: Squad): void {
    const w = this.w;
    if (s.members.length === 0) return;
    // creencia del grupo = la más fresca de sus miembros
    for (const m of s.members) { const mb = m.brain as Brain; if (mb.belief && (!s.belief || mb.belief.t > s.belief.t)) s.belief = mb.belief; }
    if (s.belief && s.mode === 'calm') s.mode = 'combat';
    if (s.mode === 'combat' && s.members.every(m => !(m.brain as Brain).belief)) { s.mode = 'calm'; s.belief = null; }

    // repliegue: el grupo ha perdido más de la mitad
    if (this.tactics > 0 && s.mode === 'combat' && !s.retreated && s.initial >= 4 && s.members.length < s.initial / 2 &&
      !s.members.some(m => m.kind === 'miniboss' || m.kind === 'megaboss')) {
      const rally = this.pickRally(s);
      if (rally) {
        s.retreated = true; s.mode = 'retreat'; s.retreatAt = w.time; s.rally = rally;
        // v1.3 — asaltantes, tiradores y blindados no se repliegan: siguen a lo suyo
        for (const m of s.members) { if (soloist(m)) continue; const mb = m.brain as Brain; this.releaseCover(m, mb); this.setState(m, mb, 'retreat', 2); }
        this.say(s.members[0], 'enemy.retreat', true);
      } else s.retreated = true;
    }
    if (s.mode === 'retreat') {
      const arrived = s.members.every(m => soloist(m) || Math.hypot(m.x - s.rally[0], m.y - s.rally[1]) < 3);
      if (arrived || w.time - s.retreatAt > 11) {
        // reagrupar: se funden con el grupo más cercano y vuelven
        let near: Squad | null = null, nd = 12;
        for (const q of this.squads) {
          if (q === s || q.members.length === 0 || q.mode === 'retreat') continue;
          const c = q.members[0];
          const d = Math.hypot(c.x - s.rally[0], c.y - s.rally[1]);
          if (d < nd) { nd = d; near = q; }
        }
        s.mode = s.belief ? 'combat' : 'calm';
        s.initial = s.members.length;
        if (near) {
          const into = near;
          for (const m of s.members.slice()) { this.join(m, into); }
          into.initial = into.members.length; into.rolesAt = -99;
          for (const m of into.members) { const mb = m.brain as Brain; if (mb.state === 'retreat') { mb.commitUntil = 0; this.setState(m, mb, mb.belief ? 'advance' : 'patrol', 0.5); } }
          return;
        }
        for (const m of s.members) { if (soloist(m)) continue; const mb = m.brain as Brain; mb.commitUntil = 0; this.setState(m, mb, mb.belief ? 'advance' : 'patrol', 0.5); }
      }
      return;
    }

    // reparto de papeles: se revisa cada 5 s o cuando cae alguien
    if (s.mode === 'combat' && w.time - s.rolesAt > 5) {
      s.rolesAt = w.time;
      const ms = s.members.filter(m => m.kind !== 'miniboss' && m.kind !== 'megaboss' && !soloist(m) && (m.brain as Brain).escortOf < 0);
      const n = ms.length;
      const nSup = n >= 2 ? Math.max(1, Math.round(n * 0.35)) : 0;
      const nFl = this.tactics > 0 && n >= 3 ? Math.max(1, Math.round(n * 0.3)) : 0;
      // los Veteranos fijan, los Milicianos rodean, los Sicarios presionan
      const sup = ms.slice().sort((a, c) => rank(c.ekind!, 'enemy3', 'enemy2') - rank(a.ekind!, 'enemy3', 'enemy2')).slice(0, nSup);
      const rest = ms.filter(m => !sup.includes(m));
      const fl = rest.slice().sort((a, c) => rank(c.ekind!, 'enemy2', 'enemy1') - rank(a.ekind!, 'enemy2', 'enemy1')).slice(0, nFl);
      for (const m of ms) {
        const mb = m.brain as Brain;
        const role: Role = sup.includes(m) ? 'suppress' : fl.includes(m) ? 'flank' : 'assault';
        if (mb.role !== role) { mb.role = role; if (mb.state === 'cover' || mb.state === 'advance') mb.commitUntil = Math.min(mb.commitUntil, w.time + 1); }
      }
    }
  }

  private pickRally(s: Squad): Vec2 | null {
    const w = this.w;
    const cands: Vec2[] = [s.home, w.level.map.punto_jefe];
    for (const q of this.squads) if (q !== s && q.members.length > 0) cands.push([q.members[0].x, q.members[0].y]);
    for (const q of this.squads) cands.push(q.home);
    const me = s.members[0];
    let best: Vec2 | null = null, bs = -Infinity;
    for (const c of cands) {
      const dp = w.walkDistToPlayer(c[0], c[1]);
      if (!(dp < Infinity) || dp < 9) continue;
      if (w.level.clear(w.player.x, w.player.y, 1.6, c[0], c[1], 1.4, 'sight')) continue; // a cubierto del jugador
      const dm = Math.hypot(c[0] - me.x, c[1] - me.y);
      const sc = Math.min(dp, 25) - dm * 0.6;
      if (sc > bs) { bs = sc; best = c; }
    }
    return best;
  }

  /** ¿Hay alguien del grupo cubriendo ahora mismo (viendo al objetivo desde su puesto)? */
  private someoneCovering(s: Squad, except: Unit): boolean {
    const w = this.w;
    for (const m of s.members) {
      if (m === except) continue;
      const mb = m.brain as Brain;
      if (mb.role === 'suppress' && w.time - mb.lastSawAt < 2.5 && m.reloading <= 0) return true;
    }
    return false;
  }

  // ───────────────────────── decisión individual ─────────────────────────

  private setState(u: Unit, b: Brain, st: State, commit: number): void {
    const w = this.w;
    if (b.state === 'cover' && st !== 'cover') this.releaseCover(u, b);
    b.state = st; b.stateAt = w.time;
    b.commitUntil = w.time + commit * (0.85 + w.rng() * 0.3);
    u.path = null; u.repathAt = 0; b.atHide = false;
    if (st !== 'cover') { u.crouch = false; b.peeking = false; }
    if (st !== 'melee') u.sprinting = false;
    if (st !== 'special') this.cancelLaser(b);
    if (st === 'patrol') b.chargeBarked = false;
    if (st === 'patrol' || st === 'investigate' || st === 'search') b.waitUntil = Math.max(b.waitUntil, 0);
  }

  private releaseCover(u: Unit, b: Brain): void {
    if (b.cover && b.cover.taken === u.id) b.cover.taken = -1;
    b.cover = null; b.hide = null; b.peek = null;
  }

  /** Elige qué hacer en combate. Solo se llama cuando ha vencido el compromiso anterior. */
  private decide(u: Unit, b: Brain): void {
    const w = this.w, s = b.squad;
    const bl = b.belief!;
    const age = w.time - bl.t;
    // v1.3 — oficios con conducta propia
    if (u.variant === 'asaltante') { this.setState(u, b, 'melee', 1); return; }
    if (u.variant === 'tirador' || u.variant === 'blindado') { this.setState(u, b, 'special', 1); return; }
    if (b.escortOf >= 0 && this.escortDecide(u, b)) return;
    if (s.mode === 'retreat') { this.setState(u, b, 'retreat', 2); return; }
    if (u.mag <= 0 && u.ammo <= 0) { this.setState(u, b, 'melee', 1.5); return; }
    if (age > 6) { this.startSearch(u, b); return; }
    if (age > 2.5 && b.visId < 0) {
      // lo ha perdido de vista hace poco: va a donde CREE que está (posición + inercia)
      const k = Math.min(1.2, age * 0.5);
      b.dest = this.freeNear(bl.x + bl.vx * k, bl.y + bl.vy * k) ?? [bl.x, bl.y];
      this.setState(u, b, 'advance', 1.5);
      return;
    }
    if (b.role === 'flank' && this.tactics > 0 && this.someoneCovering(s, u) && this.startFlank(u, b)) return;
    // presionar: solo se acorta distancia si alguien cubre; si no, se aguanta en cobertura
    const band = u.variant === 'granadero' ? GRANADERO.band : BAND[u.ekind!];
    let rmin = band[0], rmax = band[1];
    if (b.role === 'assault' && this.someoneCovering(s, u)) { rmax = Math.max(rmin + 2, rmax - 3 * Math.min(3, b.cycles)); }
    if (b.role === 'suppress') { rmin += 2; rmax += 4; }
    if (this.startCover(u, b, bl.x, bl.y, rmin, rmax)) return;
    // sin cobertura posible: romper la línea de visión o pelear donde está
    const d = Math.hypot(bl.x - u.x, bl.y - u.y);
    if (d > rmax + 2) { b.dest = this.freeNear(bl.x, bl.y) ?? [bl.x, bl.y]; this.setState(u, b, 'advance', 1.5); return; }
    this.releaseCover(u, b);
    this.setState(u, b, 'cover', 1.5);
    b.hide = [u.x, u.y]; b.peek = null; b.peeking = true; b.phaseUntil = w.time + 2;
  }

  private freeNear(x: number, y: number): Vec2 | null {
    const L = this.w.level;
    const c = L.nearestFree(x, y, true, 10);
    return c >= 0 ? [L.cellX(c), L.cellY(c)] : null;
  }

  /** Busca un punto de cobertura contra la amenaza en (tx,ty) y lo reserva. */
  private startCover(u: Unit, b: Brain, tx: number, ty: number, rmin: number, rmax: number, near: { x: number; y: number; r: number } | null = null): boolean {
    const w = this.w, L = w.level;
    let best: CoverPoint | null = null, bs = -Infinity, bestPeek: Vec2 | null = null;
    const tz = 1.4;
    for (const c of L.cover) {
      if (c.taken >= 0 && c.taken !== u.id) { const o = w.entityById(c.taken); if (o && o.alive) continue; c.taken = -1; }
      const ds = Math.hypot(c.x - u.x, c.y - u.y);
      if (ds > 15) continue;
      if (near && Math.hypot(c.x - near.x, c.y - near.y) > near.r) continue;
      const dt = Math.hypot(c.x - tx, c.y - ty);
      if (dt < 3.5) continue;
      // ¿protege? agachado para cobertura baja, de pie para alta
      const hz = c.high ? 1.25 : 0.5;
      if (L.clear(tx, ty, tz, c.x, c.y, hz, 'bullet')) continue;
      if (c.high && L.clear(tx, ty, tz, c.x, c.y, 0.5, 'bullet')) continue;
      let sc = -ds * 1.0 + w.rng() * 2;
      if (dt < rmin) sc -= (rmin - dt) * 2.0; else if (dt > rmax) sc -= (dt - rmax) * 1.5;
      // que no obligue a cruzar por delante del objetivo: mejor si queda de mi lado
      const dme = Math.hypot(u.x - tx, u.y - ty);
      if (dt > dme + 4) sc -= 3;
      if (sc <= bs) continue;
      // ¿desde dónde se dispara? cobertura baja: de pie en el sitio; alta: asomándose
      let peek: Vec2 | null = null;
      if (!c.high && L.clear(c.x, c.y, 1.5, tx, ty, 1.2, 'bullet') && L.clear(c.x, c.y, 1.6, tx, ty, 1.5, 'sight')) peek = [c.x, c.y];
      else peek = this.findPeek(c.x, c.y, tx, ty);
      if (!peek && b.role === 'suppress' && !near) continue; // quien fija necesita poder asomarse
      if (!peek) sc -= 6; // sirve para esconderse pero no para pelear
      if (sc <= bs) continue;
      bs = sc; best = c; bestPeek = peek;
    }
    if (!best) return false;
    this.releaseCover(u, b);
    best.taken = u.id;
    b.cover = best; b.hide = [best.x, best.y]; b.peek = bestPeek;
    b.peeking = false; b.phaseUntil = 0; b.coverCheckAt = w.time + 1.5;
    b.cycles++;
    this.setState(u, b, 'cover', 1.8);
    b.cover = best; b.hide = [best.x, best.y]; b.peek = bestPeek; // setState no los toca, pero por claridad
    return true;
  }

  private findPeek(cx: number, cy: number, tx: number, ty: number): Vec2 | null {
    const L = this.w.level;
    let best: Vec2 | null = null, bd = Infinity;
    for (const r of [0.75, 1.3]) for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (!L.walkableAt(x, y, false) || !L.walkLine(cx, cy, x, y, false)) continue;
      if (!L.clear(x, y, 1.5, tx, ty, 1.2, 'bullet') || !L.clear(x, y, 1.6, tx, ty, 1.5, 'sight')) continue;
      if (r < bd) { bd = r; best = [x, y]; }
    }
    return best;
  }

  /** Ruta de flanqueo: camino distinto, que evita lo que el objetivo tiene a la vista. */
  private startFlank(u: Unit, b: Brain): boolean {
    const w = this.w, s = b.squad, L = w.level;
    const bl = b.belief!;
    if (!s.pen || w.time - s.penAt > 2.5 || Math.hypot(bl.x - s.penX, bl.y - s.penY) > 3) {
      s.pen = w.nav.exposure(bl.x, bl.y, 26, 1.1);
      s.penAt = w.time; s.penX = bl.x; s.penY = bl.y;
    }
    // centro del grupo: hay que llegar por el otro lado
    let cx = 0, cy = 0;
    for (const m of s.members) { cx += m.x; cy += m.y; }
    cx /= s.members.length; cy /= s.members.length;
    const base = Math.atan2(cy - bl.y, cx - bl.x);
    let best: Vec2 | null = null, bs = -Infinity;
    for (let k = 0; k < 10; k++) {
      const a = base + (0.5 + w.rng() * 0.5) * Math.PI * (k % 2 ? 1 : -1);
      const r = 5 + w.rng() * 4;
      const x = bl.x + Math.cos(a) * r, y = bl.y + Math.sin(a) * r;
      if (!L.walkableAt(x, y, true)) continue;
      const dp = w.walkDistToPlayer(x, y);
      if (!(dp < 30)) continue;
      let sc = Math.abs(angDiff(a, base)) * 3 - Math.hypot(x - u.x, y - u.y) * 0.15;
      if (!L.clear(bl.x, bl.y, 1.5, x, y, 1.2, 'sight')) sc += 3; // llegar sin ser visto
      if (sc > bs) { bs = sc; best = [x, y]; }
    }
    if (!best || w.pathBudget <= 0) return false;
    w.pathBudget--;
    const p = w.nav.path(u.x, u.y, best[0], best[1], { doors: true, penalty: s.pen });
    if (!p) return false;
    b.dest = best;
    this.say(u, 'enemy.flank', true);
    this.setState(u, b, 'flank', 2.0);
    u.path = p; u.pathI = 0; u.goalX = best[0]; u.goalY = best[1]; u.navVer = L.version; u.repathAt = w.time + 4;
    return true;
  }

  private startSearch(u: Unit, b: Brain): void {
    const w = this.w, L = w.level;
    const bl = b.belief!;
    const age = w.time - bl.t;
    const r = Math.min(12, 3 + age * 0.8); // la creencia se desdibuja con el tiempo
    b.searchPts = [];
    for (let k = 0; k < 12 && b.searchPts.length < 3; k++) {
      const a = w.rng() * Math.PI * 2, rr = r * (0.4 + 0.6 * w.rng());
      const x = bl.x + bl.vx * 1.5 + Math.cos(a) * rr, y = bl.y + bl.vy * 1.5 + Math.sin(a) * rr;
      if (L.walkableAt(x, y, true) && w.walkDistToPlayer(x, y) < Infinity) b.searchPts.push([x, y]);
    }
    b.waitUntil = 0;
    this.setState(u, b, 'search', 1.5);
  }

  // ───────────────────────── ejecución ─────────────────────────

  private think(u: Unit, b: Brain, dt: number): void {
    const w = this.w;
    const sp = u.stats.speed;
    const tgt = b.visId >= 0 ? w.entityById(b.visId) : undefined;
    const sees = !!tgt && tgt.alive && !tgt.downed;
    if (!sees) b.visId = -1;
    u.wishX = 0; u.wishY = 0;

    // los grupos de caza van a por la última posición que sepa cualquiera
    if (b.hunt && !b.belief && this.global && w.time - this.global.t < 40) {
      b.belief = { ...this.global, t: Math.max(this.global.t, w.time - 3) }; b.aware = 1; b.alerted = true;
    }
    // recarga cuando toca
    if (u.mag <= 0 && u.ammo > 0 && u.reloading <= 0 && w.startReload(u) && b.belief && u.kind !== 'miniboss' && u.kind !== 'megaboss') this.say(u, 'enemy.reloading', true);

    if (u.kind === 'miniboss' || u.kind === 'megaboss') { this.bossThink(u, b, tgt && sees ? tgt : null, dt); return; }

    // v1.3 — cegado: no ve, no se mueve y, si acaba de tener a alguien delante, dispara a bulto (dispersión ×4)
    if (w.isBlinded(u)) {
      u.aiState = 'cegado'; u.sprinting = false;
      this.cancelLaser(b);
      const bl = b.belief;
      if (bl && w.time - bl.t < 2.5 && u.variant !== 'asaltante' && u.variant !== 'tirador' && w.time >= u.staggerUntil && w.time >= b.reactAt &&
        u.reloading <= 0 && u.mag > 0 && u.fireCd <= 0) {
        b.faceYaw = Math.atan2(bl.y - u.y, bl.x - u.x);
        if (Math.abs(angDiff(b.faceYaw, u.yaw)) < 0.3 && w.level.clear(u.x, u.y, w.muzzleZ(u), bl.x, bl.y, 1.1, 'bullet')) {
          w.fire(u, bl.x, bl.y, 1.1, SPREAD[u.ekind!] * FLASH.spreadMult);
          u.fireCd = 2 / u.stats.rof;
        }
      }
      return;
    }

    const pinned = w.time < u.pinnedUntil;
    if (pinned) {
      // Supresión: clavado. Agachado, sin avanzar; como mucho devuelve algún tiro.
      u.crouch = u.variant !== 'blindado'; u.aiState = 'clavado'; u.sprinting = false;
      this.cancelLaser(b);
      if (sees) { b.faceYaw = Math.atan2(tgt!.y - u.y, tgt!.x - u.x); if (w.rng() < 0.25 * dt * 4) { u.crouch = false; this.tryShoot(u, b, tgt!, 2.2); } }
      return;
    }

    // v1.3 — el blindado con el escudo caído (aturdido, o recargando: para recargar lo baja) se queda clavado en el sitio
    if (u.variant === 'blindado') {
      if (u.reloading > 0) u.staggerUntil = Math.max(u.staggerUntil, w.time + u.reloading);
      if (w.time < u.staggerUntil) { u.aiState = u.reloading > 0 ? 'recarga' : 'aturdido'; return; }
    }
    if (u.variant === 'granadero') this.grenadierCheck(u, b);
    // un oficio con conducta propia no se queda en un estado de enemigo normal (p. ej. al reagruparse su escuadra)
    if (soloist(u) && (b.state === 'cover' || b.state === 'advance' || b.state === 'flank' || b.state === 'retreat')) {
      if (b.belief) this.decide(u, b); else this.setState(u, b, 'patrol', 1);
    }

    const engaged = !!b.belief;
    if (engaged && (b.state === 'patrol' || b.state === 'investigate' || (b.state === 'search' && (sees || w.time - b.belief!.t < 4))) && w.time >= b.commitUntil) this.decide(u, b);

    switch (b.state) {
      case 'patrol': this.doPatrol(u, b, sp); break;
      case 'investigate': this.doInvestigate(u, b, sp); break;
      case 'cover': this.doCover(u, b, tgt && sees ? tgt : null, sp); break;
      case 'advance': {
        u.aiState = 'avanza';
        const d = b.dest ?? [b.belief!.x, b.belief!.y];
        const arrived = w.navigate(u, d[0], d[1], sp, null, 0.8);
        if (sees) { this.face(u, b, tgt!); this.tryShoot(u, b, tgt!, 1.6); if (w.time >= b.commitUntil) this.decide(u, b); }
        else { this.faceMove(u, b); if (arrived || w.time - b.stateAt > 12) { if (b.belief) this.startSearch(u, b); else this.setState(u, b, 'patrol', 1); } }
        break;
      }
      case 'flank': {
        u.aiState = 'rodea';
        const d = b.dest!;
        const pen = b.squad.pen;
        const arrived = w.navigate(u, d[0], d[1], sp, pen, 0.9);
        if (sees && Math.hypot(tgt!.x - u.x, tgt!.y - u.y) < 13) {
          this.face(u, b, tgt!); this.tryShoot(u, b, tgt!, 1.5);
          if (w.time >= b.commitUntil) { b.role = 'assault'; this.decide(u, b); }
        } else {
          this.faceMove(u, b);
          if (arrived || w.time - b.stateAt > 25 || !u.path && w.time - b.stateAt > 2) { b.role = 'assault'; if (b.belief) this.decide(u, b); else this.setState(u, b, 'patrol', 1); }
        }
        break;
      }
      case 'search': this.doSearch(u, b, sp); break;
      case 'retreat': {
        u.aiState = 'se repliega';
        const r = b.squad.rally;
        const arrived = w.navigate(u, r[0], r[1], sp, null, 1.5);
        this.faceMove(u, b);
        if (arrived && b.belief) b.faceYaw = Math.atan2(b.belief.y - u.y, b.belief.x - u.x);
        if (b.squad.mode !== 'retreat' && w.time >= b.commitUntil) this.setState(u, b, b.belief ? 'advance' : 'patrol', 0.5);
        break;
      }
      case 'special':
        if (u.variant === 'tirador') this.doTirador(u, b, tgt && sees ? tgt : null, sp, dt);
        else if (u.variant === 'blindado') this.doBlindado(u, b, tgt && sees ? tgt : null, sp);
        else this.setState(u, b, 'patrol', 1);
        break;
      case 'melee': {
        if (u.variant === 'asaltante') { this.doAsalto(u, b, tgt && sees ? tgt : null, sp); break; }
        u.aiState = 'carga';
        if (u.mag > 0 || u.ammo > 0) { if (b.belief) this.decide(u, b); else this.setState(u, b, 'patrol', 1); break; }
        const tx = sees ? tgt!.x : b.belief ? b.belief.x : u.x, ty = sees ? tgt!.y : b.belief ? b.belief.y : u.y;
        const d = Math.hypot(tx - u.x, ty - u.y);
        if (sees && d < u.radius + 1.0 + tgt!.radius * 0.5) { this.face(u, b, tgt!); if (u.knifeCd <= 0 && Math.abs(angDiff(b.faceYaw, u.yaw)) < 0.6) { w.knife(u); u.knifeCd = 0.8; } }
        else { w.navigate(u, tx, ty, sp * 1.5, null, 0.6); this.faceMove(u, b); if (!sees && d < 2 && b.belief && w.time - b.belief.t > 4) this.startSearch(u, b); }
        break;
      }
    }
  }

  private face(u: Unit, b: Brain, t: Unit): void { b.faceYaw = Math.atan2(t.y - u.y, t.x - u.x); }
  private faceMove(u: Unit, b: Brain): void { if (Math.hypot(u.wishX, u.wishY) > 0.2) b.faceYaw = Math.atan2(u.wishY, u.wishX); }

  /** Aprieta el gatillo solo si hay línea de tiro real ahora mismo. */
  private tryShoot(u: Unit, b: Brain, t: Unit, spreadMul: number): boolean {
    const w = this.w;
    if (u.variant === 'asaltante' || u.variant === 'tirador') return false; // v1.3: uno solo acuchilla, el otro solo usa el láser
    if (w.time < u.staggerUntil) return false; // aturdido: no dispara
    if (t.downed) return false;
    if (w.isBlinded(u)) spreadMul *= FLASH.spreadMult;
    if (w.time < b.reactAt || u.reloading > 0 || u.mag <= 0 || u.fireCd > 0) return false;
    if (w.time < b.restUntil) return false;
    if (w.time > b.burstUntil) {
      // El MegaBoss dispara en ráfagas largas con pausas claras: la pausa es la ventana para asomarse.
      const mega = u.kind === 'megaboss';
      // contra una escuadra mermada el jefe da más aire entre ráfagas (1,2 s más por cada compañero que falte)
      let megaExtra = 0;
      if (mega) { let al = 0; for (const o of w.entities) if (o.alive && o.team === 'ally') al++; megaExtra = Math.max(0, 4 - al) * 1.2; }
      if (b.burstUntil > 0) { b.restUntil = w.time + (mega ? 2.6 + w.rng() * 1.2 + megaExtra : 0.35 + w.rng() * 0.6); b.burstUntil = 0; return false; }
      // Turnos de fuego: contra un mismo blanco solo dispara a la vez un número limitado de enemigos
      // (más cuanto más alta la planta). El resto espera su turno cubierto o maniobrando. Sin esto, 40
      // enemigos en una planta diáfana son un pelotón de fusilamiento y no hay táctica que valga.
      if (!mega && u.kind !== 'miniboss') {
        const limit = t.isPlayer ? 2 + Math.floor(w.floor / 3) : 2;
        let n = 0;
        for (const o of w.entities) {
          if (o === u || !o.alive || o.team !== 'enemy') continue;
          const ob = o.brain as Brain;
          if (ob.fireTarget === t.id && ob.burstUntil > w.time) n++;
        }
        if (n >= limit) { b.restUntil = w.time + 0.3 + w.rng() * 0.4; return false; }
      }
      b.fireTarget = t.id;
      b.burstUntil = w.time + (mega ? 0.8 : 0.7 + w.rng() * 0.9);
    }
    if (Math.abs(angDiff(Math.atan2(t.y - u.y, t.x - u.x), u.yaw)) > 0.22) return false;
    const az = w.shotLine(u, t);
    if (az < 0) return false;
    const tv = Math.hypot(t.vx, t.vy);
    const moving = Math.hypot(u.vx, u.vy) > 0.4 ? 0.02 : 0;
    w.fire(u, t.x, t.y, az * 0.85, (SPREAD[u.ekind!] + tv * (u.kind === 'megaboss' ? 0.065 : 0.013) + (t.crouch ? 0.015 : 0) + moving) * spreadMul);
    u.fireCd = 1 / u.stats.rof;
    return true;
  }

  private doPatrol(u: Unit, b: Brain, sp: number): void {
    const w = this.w;
    u.aiState = 'patrulla';
    const route = b.squad.route;
    if (route.length === 0) { // sin ruta: vigila girando
      if (w.time > b.waitUntil) { b.waitUntil = w.time + 2 + w.rng() * 2; b.faceYaw = u.yaw + (w.rng() - 0.5) * 2.5; }
      return;
    }
    if (w.time < b.waitUntil) {
      // parado en un punto: echa un vistazo alrededor
      if (w.rng() < 0.012) b.faceYaw = u.yaw + (w.rng() - 0.5) * 2.2;
      return;
    }
    const p = route[b.patrolI % route.length];
    const arrived = w.navigate(u, p[0], p[1], sp * 0.6, null, 0.9);
    this.faceMove(u, b);
    if (arrived || (!u.path && w.time - b.stateAt > 3 && w.rng() < 0.02)) {
      b.patrolI = (b.patrolI + 1) % route.length;
      b.waitUntil = w.time + 0.8 + w.rng() * 2.2;
    }
  }

  private doInvestigate(u: Unit, b: Brain, sp: number): void {
    const w = this.w;
    u.aiState = 'va a mirar';
    if (!b.inv) { this.setState(u, b, 'patrol', 1); return; }
    if (w.time < b.waitUntil && w.time - b.stateAt < 1.2) { b.faceYaw = Math.atan2(b.inv[1] - u.y, b.inv[0] - u.x); return; } // se gira antes de arrancar
    const arrived = w.navigate(u, b.inv[0], b.inv[1], sp * 0.9, null, 1.2);
    if (!arrived) { this.faceMove(u, b); if (w.time - b.stateAt > 20 || (!u.path && w.time - b.stateAt > 3)) { b.inv = null; this.setState(u, b, 'patrol', 1); } return; }
    // ha llegado: mira alrededor un rato antes de darlo por bueno
    if (b.phaseUntil < b.stateAt) { b.phaseUntil = w.time + 3.5 + w.rng() * 1.5; }
    u.aiState = 'busca';
    if (w.rng() < 0.03) b.faceYaw = u.yaw + (w.rng() - 0.5) * 3;
    if (w.time > b.phaseUntil) { b.inv = null; b.phaseUntil = 0; this.setState(u, b, 'patrol', 1); }
  }

  private doSearch(u: Unit, b: Brain, sp: number): void {
    const w = this.w;
    u.aiState = 'busca';
    if (b.searchPts.length === 0) {
      // se rinde: olvida y vuelve a patrullar
      b.belief = null; b.aware = 0; b.alerted = false; b.cycles = 0;
      if (b.hunt && this.global && w.time - this.global.t > 12) this.global = null;
      this.setState(u, b, 'patrol', 1.5);
      return;
    }
    if (w.time < b.waitUntil) { if (w.rng() < 0.04) b.faceYaw = u.yaw + (w.rng() - 0.5) * 3; return; }
    const p = b.searchPts[0];
    const arrived = w.navigate(u, p[0], p[1], sp * 0.85, null, 1.0);
    this.faceMove(u, b);
    if (arrived || (!u.path && w.rng() < 0.03) || w.time - b.stateAt > 30) { b.searchPts.shift(); b.waitUntil = w.time + 1.2 + w.rng(); }
  }

  private doCover(u: Unit, b: Brain, tgt: Unit | null, sp: number): void {
    const w = this.w, L = w.level;
    const bl = b.belief;
    if (!bl) { this.setState(u, b, 'patrol', 1); return; }
    const hide = b.hide ?? [u.x, u.y];
    const dHide = Math.hypot(hide[0] - u.x, hide[1] - u.y);
    if (dHide > 1.6) b.atHide = false;
    const atHide = dHide < 0.45 || b.atHide;
    const lowCover = !!b.cover && !b.cover.high;

    // de camino a la cobertura
    if (b.phaseUntil === 0 && !atHide) {
      u.aiState = 'a cubierto';
      u.crouch = false;
      if (w.navigate(u, hide[0], hide[1], sp, null, 0.35)) b.atHide = true;
      if (tgt) { this.face(u, b, tgt); this.tryShoot(u, b, tgt, 1.7); } else this.faceMove(u, b);
      if (w.time - b.stateAt > 9) { this.releaseCover(u, b); this.decide(u, b); }
      return;
    }
    if (b.phaseUntil === 0) { b.peeking = false; b.phaseUntil = w.time + 0.4 + w.rng() * 0.6; }

    // ¿sigue sirviendo la cobertura? (el objetivo se mueve)
    if (b.cover && w.time > b.coverCheckAt) {
      b.coverCheckAt = w.time + 1.2;
      const hz = b.cover.high ? 1.25 : 0.5;
      const exposed = L.clear(bl.x, bl.y, 1.4, hide[0], hide[1], hz, 'bullet');
      const d = Math.hypot(bl.x - u.x, bl.y - u.y);
      if ((exposed || d < 3) && w.time >= b.commitUntil) { this.releaseCover(u, b); this.decide(u, b); return; }
    }

    // Lleva un rato en su puesto sin ver a nadie con sus propios ojos: el puesto no sirve. Avanza hacia donde cree que estás.
    if (b.escortOf < 0 && w.time - b.lastSawAt > 5 && w.time - b.stateAt > 5 && w.time >= b.commitUntil) {
      this.releaseCover(u, b);
      b.dest = this.freeNear(bl.x, bl.y) ?? [bl.x, bl.y];
      this.setState(u, b, 'advance', 1.5);
      return;
    }
    if (w.time > b.phaseUntil) {
      b.peeking = !b.peeking;
      const supp = b.role === 'suppress';
      if (b.peeking) b.phaseUntil = w.time + (supp ? 2.0 + w.rng() * 1.6 : 1.2 + w.rng() * 1.0);
      else {
        b.phaseUntil = w.time + (supp ? 0.5 + w.rng() * 0.6 : 0.9 + w.rng() * 1.3);
        if (u.mag < u.magSize * 0.4 && u.ammo > 0 && w.startReload(u)) this.say(u, 'enemy.reloading', true);
        // tras un ciclo completo, replantearse la jugada (con el compromiso ya vencido)
        if (w.time >= b.commitUntil) {
          const age = w.time - bl.t;
          if (age > 3.5 || (b.role !== 'suppress' && w.time - b.stateAt > 6 + w.rng() * 4)) { this.decide(u, b); return; }
        }
      }
    }
    if (u.reloading > 0) b.peeking = false; // recargar, siempre escondido

    if (b.peeking) {
      b.hideDone = false;
      u.aiState = b.role === 'suppress' ? 'fija' : 'dispara';
      u.crouch = false;
      const pk = b.peek ?? hide;
      if (Math.hypot(pk[0] - u.x, pk[1] - u.y) > 0.3 && w.time - b.phaseUntil < -0.0 && !b.peekDone) { if (w.navigate(u, pk[0], pk[1], sp, null, 0.25)) b.peekDone = true; }
      if (tgt) { this.face(u, b, tgt); this.tryShoot(u, b, tgt, 1); }
      else b.faceYaw = Math.atan2(bl.y - u.y, bl.x - u.x);
    } else {
      u.aiState = u.reloading > 0 ? 'recarga' : 'cubierto';
      b.peekDone = false;
      if (dHide > 0.45 && !b.hideDone) { if (w.navigate(u, hide[0], hide[1], sp, null, 0.3)) b.hideDone = true; }
      u.crouch = lowCover && atHide;
      b.faceYaw = Math.atan2(bl.y - u.y, bl.x - u.x);
    }
  }

  // ───────────────────────── jefes ─────────────────────────

  private bossThink(u: Unit, b: Brain, tgt: Unit | null, dt: number): void {
    const w = this.w;
    const mega = u.kind === 'megaboss';
    const phase = mega ? u.bossPhase : 1;
    const sp = u.stats.speed * (mega && phase >= 3 ? 1.6 : 1);
    void dt;
    if (!b.belief) {
      // guarda su sitio dando vueltas cortas
      u.aiState = 'guardia';
      const route = b.squad.route;
      if (route.length && w.time > b.waitUntil) {
        const p = route[b.patrolI % route.length];
        if (w.navigate(u, p[0], p[1], sp * 0.7, null, 1)) { b.patrolI++; b.waitUntil = w.time + 2 + w.rng() * 2; }
        this.faceMove(u, b);
      } else if (w.rng() < 0.01) b.faceYaw = u.yaw + (w.rng() - 0.5) * 2;
      return;
    }
    const bl = b.belief;
    const age = w.time - bl.t;
    if (age > 14 && !b.hunt && !mega) { b.belief = null; b.aware = 0; return; }
    if (u.shielded) {
      // Con el escudo puesto no dispara: la fase de refuerzos es contra los refuerzos (y un respiro del jefe).
      u.aiState = 'escudo';
      if (tgt) this.face(u, b, tgt); else b.faceYaw = Math.atan2(bl.y - u.y, bl.x - u.x);
      return;
    }
    // v1.3 — jefes de planta con ataque propio
    if (u.bossVariant === 'ametrallador') { this.gunnerThink(u, b, tgt, sp); return; }
    if (u.bossVariant === 'embestida') { this.chargerThink(u, b, tgt, sp, dt); return; }
    if (u.bossVariant === 'escoltas') { this.escortedThink(u, b, tgt, sp); return; }
    if (w.isBlinded(u)) { u.aiState = 'cegado'; return; }
    if (tgt) {
      const d = Math.hypot(tgt.x - u.x, tgt.y - u.y);
      this.face(u, b, tgt);
      const band = BAND[u.ekind!];
      if (d > band[1]) w.navigate(u, tgt.x, tgt.y, sp, null, band[0]);
      else if (d < 3.2 && !mega) { // demasiado cerca para el lanzacohetes: se aparta
        u.wishX = (-(tgt.x - u.x) / d) * sp; u.wishY = (-(tgt.y - u.y) / d) * sp;
      }
      const facing = Math.abs(angDiff(b.faceYaw, u.yaw)) < 0.25;
      if (u.kind === 'miniboss') {
        u.aiState = 'cohetes';
        // Ataque explosivo en área: cohete visible que viaja (se puede esquivar corriendo). Ver DECISIONES.
        if (facing && w.time >= b.reactAt && u.reloading <= 0 && u.mag > 0 && u.fireCd <= 0 && d > 3 && w.shotLine(u, tgt) >= 0) {
          const lead = Math.min(0.5, d / 22);
          w.launch(u, 'rocket', tgt.x + tgt.vx * lead + (w.rng() - 0.5) * 1.2, tgt.y + tgt.vy * lead + (w.rng() - 0.5) * 1.2, 30);
          u.mag--; u.lastShotAt = w.time; u.fireCd = 1 / u.stats.rof;
          w.noises.push({ x: u.x, y: u.y, loud: 30, team: 'enemy', id: u.id, kind: 'shot' });
        } else if (d <= 3 && u.knifeCd <= 0 && facing) { w.knife(u); u.knifeCd = 1.0; }
      } else {
        u.aiState = 'fase ' + phase;
        if (this.tryShoot(u, b, tgt, phase >= 3 ? 0.9 : 1.1) && phase >= 3) u.fireCd /= 1.5;
        if (phase >= 2 && w.time > b.specialAt && d > 4 && facing) {
          b.specialAt = w.time + (phase >= 3 ? 6 : 8);
          w.launch(u, phase >= 3 ? 'rocket' : 'grenade', tgt.x + tgt.vx * 0.4, tgt.y + tgt.vy * 0.4, 26);
        }
      }
    } else {
      u.aiState = mega ? 'fase ' + phase : 'acecha';
      b.faceYaw = Math.atan2(bl.y - u.y, bl.x - u.x);
      if (age > 1.2) { w.navigate(u, bl.x, bl.y, sp, null, 2); this.faceMove(u, b); }
      if (mega && this.global && this.global.t > bl.t) b.belief = this.global;
    }
  }

  // ───────────────────────── v1.3: oficios ─────────────────────────

  /**
   * Asaltante: corre hasta el cuerpo a cuerpo y acuchilla. Lejos va por una ruta que evita lo que el blanco tiene a
   * la vista (no entra por el pasillo de fuego); a menos de `directDist` ya va recto. No dispara ni se retira.
   * Se le oye venir (grito al lanzarse, pasos de carrera) y cae con poca cosa.
   */
  private doAsalto(u: Unit, b: Brain, tgt: Unit | null, sp: number): void {
    const w = this.w, A = ASALTANTE;
    const bl = b.belief;
    if (!bl) { this.setState(u, b, 'patrol', 1); return; }
    u.aiState = 'asalta';
    if (!b.chargeBarked) { b.chargeBarked = true; this.say(u, 'enemy.charge'); }
    const tx = tgt ? tgt.x : bl.x, ty = tgt ? tgt.y : bl.y;
    const d = Math.hypot(tx - u.x, ty - u.y);
    const age = w.time - bl.t;
    if (tgt && d < u.radius + A.reach + tgt.radius * 0.5) {
      u.sprinting = false;
      this.face(u, b, tgt);
      if (u.knifeCd <= 0 && w.time >= u.staggerUntil && Math.abs(angDiff(b.faceYaw, u.yaw)) < 0.6) this.stab(u, tgt);
      return;
    }
    if (!tgt && (age > 8 || (d < 1.5 && age > 3))) { this.startSearch(u, b); return; }
    u.sprinting = true;
    let pen: Float32Array | null = null;
    if (d > A.directDist && this.tactics > 0) {
      if (!this.pen || w.time - this.penAt > 3 || Math.hypot(bl.x - this.penX, bl.y - this.penY) > 3) {
        this.pen = w.nav.exposure(bl.x, bl.y, 26, 1.1);
        this.penAt = w.time; this.penX = bl.x; this.penY = bl.y;
      }
      pen = this.pen;
    }
    w.navigate(u, tx, ty, sp * A.sprintMult, pen, 0.6);
    this.faceMove(u, b);
  }

  /** Cuchillada del asaltante: mismo alcance y comprobaciones que World.knife (ángulo y nada sólido en medio), con su daño. */
  private stab(u: Unit, t: Unit): void {
    const w = this.w, A = ASALTANTE;
    u.knifeCd = A.knifePeriod; u.lastKnifeAt = w.time;
    const d = Math.hypot(t.x - u.x, t.y - u.y);
    const hit = t.alive && !t.downed && d <= u.radius + A.reach + t.radius * 0.5 &&
      Math.abs(angDiff(Math.atan2(t.y - u.y, t.x - u.x), u.yaw)) <= 1.1 &&
      w.level.clear(u.x, u.y, 1.1, t.x, t.y, Math.min(1.1, w.height(t) * 0.7), 'bullet');
    w.events.push({ type: 'knife', id: u.id, hit });
    if (hit) w.damage(t, A.knifeDamage * allyMult(t), u, 'knife', u.x, u.y);
  }

  /**
   * Blindado: avanza de frente hacia el blanco, siempre encarándolo (el giro limitado va en update()). No usa
   * cobertura; a `stopDist` se planta y dispara despacio. Con el escudo caído no llega aquí (se queda quieto).
   */
  private doBlindado(u: Unit, b: Brain, tgt: Unit | null, sp: number): void {
    const w = this.w;
    const bl = b.belief;
    if (!bl) { this.setState(u, b, 'patrol', 1); return; }
    u.aiState = 'avanza con escudo';
    const age = w.time - bl.t;
    const tx = tgt ? tgt.x : bl.x, ty = tgt ? tgt.y : bl.y;
    const d = Math.hypot(tx - u.x, ty - u.y);
    if (!tgt && (age > 8 || (d < 1.5 && age > 3))) { this.startSearch(u, b); return; }
    // sin munición no se queda plantado tras el escudo: se echa encima a golpes
    const dry = u.mag <= 0 && u.ammo <= 0;
    const reach = u.radius + 1.0 + (tgt ? tgt.radius * 0.5 : 0);
    if (!tgt || d > (dry ? reach : BLINDADO.stopDist)) w.navigate(u, tx, ty, sp, null, dry ? 0.6 : 1.0);
    b.faceYaw = Math.atan2(ty - u.y, tx - u.x); // el escudo, hacia donde sabe que estás
    if (tgt && dry) { if (d <= reach && u.knifeCd <= 0 && Math.abs(angDiff(b.faceYaw, u.yaw)) < 0.6) { w.knife(u); u.knifeCd = 1.0; } }
    else if (tgt) this.tryShoot(u, b, tgt, 1.2);
  }

  /**
   * Tirador: se coloca lejos con línea larga y no avanza. Su único ataque es el láser: aviso 'laser' cuyo punto
   * apuntado SIGUE al blanco con retraso; al acabar, una bala real hacia ese punto. Cortarle la visión (pared o
   * humo) más de `losGrace`, aturdirle, cegarle o clavarle cancela el disparo.
   */
  private doTirador(u: Unit, b: Brain, tgt: Unit | null, sp: number, dt: number): void {
    const w = this.w, T = TIRADOR;
    const sn = b.sn ?? (b.sn = {
      spot: null, settled: false, pickAt: 0, moveAt: w.time, seenAt: w.time, mustMove: false,
      threat: null, targetId: -1, ax: 0, ay: 0, az: 1, losLostAt: -1, shots: 0, nextAt: w.time + 0.8,
    });
    const bl = b.belief;
    if (!bl) { this.setState(u, b, 'patrol', 1); return; }
    if (w.time < u.staggerUntil) { this.cancelLaser(b); sn.nextAt = Math.max(sn.nextAt, w.time + 1); u.aiState = 'aturdido'; return; }

    if (sn.threat) {
      const th = sn.threat;
      u.aiState = 'apunta';
      const t = w.entityById(sn.targetId);
      const los = !!t && this.visible(u, t);
      if (los) {
        sn.losLostAt = -1;
        const k = 1 - Math.exp(-dt / T.lag);
        sn.ax += (t!.x - sn.ax) * k; sn.ay += (t!.y - sn.ay) * k; sn.az = w.height(t!) * 0.6;
      } else {
        if (sn.losLostAt < 0) sn.losLostAt = w.time;
        if (!t || !t.alive || t.downed || w.time - sn.losLostAt > T.losGrace) { this.cancelLaser(b); sn.nextAt = w.time + 1.2; return; }
      }
      th.fx = u.x; th.fy = u.y; th.x = sn.ax; th.y = sn.ay;
      b.faceYaw = Math.atan2(sn.ay - u.y, sn.ax - u.x);
      if (w.time >= th.at) {
        this.sniperShot(u, sn);
        this.sniped.set(sn.targetId, w.time);
        this.cancelLaser(b);
        sn.shots++; sn.nextAt = w.time + T.cooldown;
        if (sn.shots >= T.shotsPerSpot) { sn.shots = 0; sn.spot = null; sn.settled = false; sn.mustMove = true; sn.pickAt = w.time + 0.6; }
      }
      return;
    }

    const age = w.time - bl.t;
    if (!tgt && age > 12) { this.startSearch(u, b); return; }
    if (tgt) sn.seenAt = w.time;
    const d = tgt ? Math.hypot(tgt.x - u.x, tgt.y - u.y) : Math.hypot(bl.x - u.x, bl.y - u.y);
    // fijar blanco: desde su puesto, o desde donde esté si ya lo tiene lejos. Solo un láser a la vez sobre cada blanco.
    if (tgt && w.time >= sn.nextAt && w.time >= b.reactAt && (sn.settled || d >= T.minDist - 2) && d > 3 && d <= T.maxRange && !this.laserOn(tgt.id) &&
      w.time + (this.hard ? T.aimTimeHard : T.aimTime) - (this.sniped.get(tgt.id) ?? -99) >= T.targetGap) {
      sn.targetId = tgt.id; sn.ax = tgt.x; sn.ay = tgt.y; sn.az = w.height(tgt) * 0.6; sn.losLostAt = -1;
      sn.threat = w.addThreat({ kind: 'laser', fx: u.x, fy: u.y, x: tgt.x, y: tgt.y, r: T.hitRadius, at: w.time + (this.hard ? T.aimTimeHard : T.aimTime), ownerId: u.id });
      u.path = null;
      return;
    }
    if (!sn.spot && !sn.settled && w.time >= sn.pickAt) {
      sn.pickAt = w.time + 2;
      const r = this.pickSniperSpot(u, bl, sn.mustMove);
      if (r === 'here') { sn.settled = true; sn.seenAt = w.time; }
      else if (r) { sn.spot = r; sn.moveAt = w.time; sn.mustMove = false; }
    }
    if (sn.spot) {
      u.aiState = 'se coloca';
      const arrived = w.navigate(u, sn.spot[0], sn.spot[1], sp, null, 0.6);
      this.faceMove(u, b);
      if (arrived || w.time - sn.moveAt > 14 || (!u.path && w.time - sn.moveAt > 3)) { sn.spot = null; sn.settled = true; sn.seenAt = w.time; }
    } else if (sn.settled) {
      u.aiState = 'acecha';
      b.faceYaw = Math.atan2(bl.y - u.y, bl.x - u.x);
      if (w.time - sn.seenAt > 5) { sn.settled = false; sn.pickAt = w.time; } // desde aquí no ve a nadie: otro puesto
    } else {
      // sin puesto posible: se acerca a donde cree que estás solo hasta tenerte a la vista, y apunta desde ahí
      u.aiState = 'acecha';
      if (tgt) sn.settled = true;
      else if (d > T.minDist * 0.6) { w.navigate(u, bl.x, bl.y, sp, null, 2); this.faceMove(u, b); }
      else b.faceYaw = Math.atan2(bl.y - u.y, bl.x - u.x);
    }
  }

  private laserOn(targetId: number): boolean {
    for (const o of this.w.entities) {
      if (!o.alive || o.variant !== 'tirador') continue;
      const sn = (o.brain as Brain).sn;
      if (sn && sn.threat && sn.targetId === targetId) return true;
    }
    return false;
  }

  /** Puesto de tirador: lejos del blanco (≥ minDist), con línea de visión hasta donde cree que está y alcanzable. */
  private pickSniperSpot(u: Unit, bl: Belief, mustMove: boolean): Vec2 | 'here' | null {
    const w = this.w, L = w.level, T = TIRADOR;
    const dMe = Math.hypot(bl.x - u.x, bl.y - u.y);
    if (!mustMove && dMe >= T.minDist && dMe <= T.maxRange && !w.sightBlocked(u.x, u.y, bl.x, bl.y)) return 'here';
    let best: Vec2 | null = null, bs = -Infinity;
    for (let k = 0; k < 30; k++) {
      const far = k < 18;
      const a = w.rng() * Math.PI * 2;
      const r = far ? T.minDist + w.rng() * (T.maxDist - T.minDist) : 9 + w.rng() * (T.minDist - 9);
      const x = bl.x + Math.cos(a) * r, y = bl.y + Math.sin(a) * r;
      if (!L.walkableAt(x, y, true) || !(w.walkDistToPlayer(x, y) < Infinity)) continue;
      const du = Math.hypot(x - u.x, y - u.y);
      if (du > 22 || (mustMove && du < 4)) continue;
      if (w.sightBlocked(x, y, bl.x, bl.y)) continue; // sin línea (o sin poder comprobarla) no vale
      let sc = -du + (far ? 5 : 0) + w.rng() * 2;
      for (const o of w.entities) {
        if (o === u || !o.alive || o.variant !== 'tirador') continue;
        const os = (o.brain as Brain).sn;
        const ox = os && os.spot ? os.spot[0] : o.x, oy = os && os.spot ? os.spot[1] : o.y;
        if (Math.hypot(ox - x, oy - y) < 4) sc -= 6;
      }
      if (sc > bs) { bs = sc; best = [x, y]; }
    }
    return best;
  }

  /**
   * La bala del tirador: un rayo real desde el arma hasta el punto apuntado (y 0,6 m más). Le da al primer cuerpo
   * aliado que cruce: quien esté a menos de ~0,45 m del punto (o pisando la línea dibujada). Una pared la para.
   */
  private sniperShot(u: Unit, sn: Sniper): void {
    const w = this.w;
    const oz = w.muzzleZ(u);
    const dx = sn.ax - u.x, dy = sn.ay - u.y;
    const d = Math.hypot(dx, dy) || 1e-6;
    const k = (d + 0.6) / d;
    const ex = u.x + dx * k, ey = u.y + dy * k, ez = Math.max(0.1, oz + (sn.az - oz) * k);
    const ri = w.level.rayInfo(u.x, u.y, oz, ex, ey, ez, 'bullet');
    let t = ri.t;
    const hit = w.rayUnits(u.x, u.y, oz, ex, ey, ez, 'ally', t);
    let kind: 'none' | 'wall' | 'entity' = t < 1 ? 'wall' : 'none';
    let surface: 'wall' | 'door' | 'furniture' | 'floor' | 'body' | 'none' = t < 1 ? ri.surface : 'none';
    if (hit) { t = hit.t; kind = 'entity'; surface = 'body'; }
    u.lastShotAt = w.time;
    w.events.push({
      type: 'shot', id: u.id, kind: u.kind, team: u.team, fx: u.x + (dx / d) * 0.5, fy: u.y + (dy / d) * 0.5, fz: oz,
      tx: u.x + (ex - u.x) * t, ty: u.y + (ey - u.y) * t, tz: Math.max(0, oz + (ez - oz) * t), hit: kind, surface, nx: hit ? -dx / d : ri.nx, ny: hit ? -dy / d : ri.ny,
    });
    w.noises.push({ x: u.x, y: u.y, loud: 30, team: u.team, id: u.id, kind: 'shot' });
    if (hit) w.damage(hit.u, TIRADOR.damage * allyMult(hit.u), u, hit.zone, u.x, u.y);
  }

  /**
   * Granadero: si el blanco lleva un rato sin moverse del sitio, o está agachado donde no le llegan las balas, le
   * tira una granada. Nunca cerca de los suyos ni de sí mismo, ni si un tabique corta la parábola. El resto del
   * tiempo pelea como un enemigo normal (a 8-16 m).
   */
  private grenadierCheck(u: Unit, b: Brain): void {
    const w = this.w, G = GRANADERO;
    const g = b.gr ?? (b.gr = { ax: 0, ay: 0, since: -1, nextAt: w.time + 2 + w.rng() * 2 });
    const bl = b.belief;
    if (!bl || w.time - bl.t > 1.5) { g.since = -1; return; } // solo con noticias frescas de dónde está
    if (g.since < 0 || Math.hypot(bl.x - g.ax, bl.y - g.ay) > G.stillRadius) { g.ax = bl.x; g.ay = bl.y; g.since = bl.t; }
    if (w.time < g.nextAt || w.time < b.reactAt || w.time < u.staggerUntil || w.time < u.pinnedUntil) return;
    if (w.time - this.lastGrenadeAt < G.squadGap) return;
    const t = bl.id >= 0 ? w.entityById(bl.id) : undefined;
    if (!t || !t.alive || t.downed) return;
    const still = w.time - g.since > G.stillTime;
    const hiding = t.crouch && w.shotLine(u, t) < 0;
    if (!still && !hiding) return;
    const tx = bl.x, ty = bl.y;
    const d = Math.hypot(tx - u.x, ty - u.y);
    if (d < G.minDist || d > G.maxDist) return;
    for (const o of w.entities) {
      if (o.alive && o.team === 'enemy' && Math.hypot(o.x - tx, o.y - ty) < G.friendRadius) return;
    }
    // la parábola pasa por encima de los muebles, no de los tabiques
    if (!w.level.clear(u.x, u.y, 2.0, tx, ty, 2.0, 'bullet')) return;
    const yaw = Math.atan2(ty - u.y, tx - u.x);
    if (Math.abs(angDiff(yaw, u.yaw)) > 0.5) { b.faceYaw = yaw; return; }
    w.enemyThrow(u, 'grenade', tx, ty);
    this.say(u, 'enemy.grenade');
    g.nextAt = w.time + G.cooldown * (t.isPlayer ? 1 : G.allyCooldownMult); g.since = w.time; g.ax = tx; g.ay = ty;
    this.lastGrenadeAt = w.time;
  }

  /** Escolta del jefe: cobertura cerca de él (o, si no hay, un sitio a su lado). No flanquea, no avanza, no se va. */
  private escortDecide(u: Unit, b: Brain): boolean {
    const w = this.w, E = BOSS_ESCORTED;
    const boss = w.entityById(b.escortOf);
    if (!boss || !boss.alive) { b.escortOf = -1; return false; }
    const bl = b.belief!;
    if (this.startCover(u, b, bl.x, bl.y, 0, 99, { x: boss.x, y: boss.y, r: E.stayRadius })) return true;
    const away = Math.atan2(boss.y - bl.y, boss.x - bl.x) + (u.id % 2 ? 0.9 : -0.9);
    const hide = this.freeNear(boss.x + Math.cos(away) * 2.2, boss.y + Math.sin(away) * 2.2) ?? [u.x, u.y];
    this.releaseCover(u, b);
    this.setState(u, b, 'cover', 2.5);
    b.hide = Math.hypot(hide[0] - boss.x, hide[1] - boss.y) <= E.stayRadius ? hide : [u.x, u.y];
    b.peek = null; b.peeking = false; b.phaseUntil = 0;
    return true;
  }

  // ───────────────────────── v1.3: jefes de planta ─────────────────────────

  private bossAttack(b: Brain): BossAttack {
    return b.bs ?? (b.bs = {
      phase: 'idle', until: 0, nextAt: this.w.time + 1.5, yaw: 0, dx: 1, dy: 0, dist: 0, len: 0, x0: 0, y0: 0, px: 0, py: 0, t0: 0, stall: 0, threat: null,
    });
  }

  /** Lo común de los jefes nuevos entre ataques: acercarse hasta tener al blanco a tiro, o acechar donde cree que está. */
  private bossApproach(u: Unit, b: Brain, tgt: Unit | null, sp: number, far: number): void {
    const w = this.w, bl = b.belief!;
    if (tgt) {
      this.face(u, b, tgt);
      if (Math.hypot(tgt.x - u.x, tgt.y - u.y) > far) w.navigate(u, tgt.x, tgt.y, sp, null, far * 0.6);
    } else {
      b.faceYaw = Math.atan2(bl.y - u.y, bl.x - u.x);
      if (w.time - bl.t > 1.2 && !w.isBlinded(u)) { w.navigate(u, bl.x, bl.y, sp, null, 2); this.faceMove(u, b); }
    }
  }

  /**
   * Ametrallador: aviso 'lane' (pasillo fijo hacia donde estaba el blanco) → barre ESE pasillo hasta vaciar el cargador
   * → recarga quieto y expuesto (×1,5). Salirse del pasillo es toda la esquiva; la recarga es la ventana para pegarle.
   */
  private gunnerThink(u: Unit, b: Brain, tgt: Unit | null, sp: number): void {
    const w = this.w, G = BOSS_GUNNER;
    const bs = this.bossAttack(b);
    if (bs.phase === 'tele') {
      u.aiState = 'apunta el pasillo'; b.faceYaw = bs.yaw;
      if (w.time >= bs.until) { bs.phase = 'sweep'; bs.until = w.time + G.sweep + 1; bs.threat = null; } // dura lo que el cargador (el +1 es solo un seguro)
      return;
    }
    if (bs.phase === 'sweep') {
      u.aiState = 'barre'; b.faceYaw = bs.yaw;
      const px = -bs.dy, py = bs.dx;
      if (u.fireCd <= 0 && u.mag > 0 && u.reloading <= 0) {
        const off = (w.rng() * 2 - 1) * G.laneWidth * 0.5;
        w.fire(u, u.x + bs.dx * bs.dist + px * off, u.y + bs.dy * bs.dist + py * off, 1.0, w.isBlinded(u) ? 0.01 * FLASH.spreadMult : 0.01);
        u.fireCd = 1 / u.stats.rof;
      }
      // quien se queda en el pasillo queda clavado (los compañeros con IA; al jugador lo clava el propio fuego)
      for (const e of w.entities) {
        if (!e.alive || e.team !== 'ally' || e.isPlayer || e.downed) continue;
        const rx = e.x - u.x, ry = e.y - u.y;
        const along = rx * bs.dx + ry * bs.dy;
        if (along > 0 && along < bs.len && Math.abs(rx * px + ry * py) < G.laneWidth * 0.5 + e.radius) e.pinnedUntil = w.time + 0.5;
      }
      if (u.mag <= 0 || u.reloading > 0 || w.time >= bs.until) {
        bs.phase = 'reload'; bs.until = w.time + G.reload;
        if (u.reloading <= 0) w.startReload(u);
        u.exposedUntil = bs.until;
        this.say(u, 'enemy.reloading');
      }
      return;
    }
    if (bs.phase === 'reload') {
      u.aiState = 'recarga';
      if (b.belief) b.faceYaw = Math.atan2(b.belief.y - u.y, b.belief.x - u.x);
      if (w.time >= bs.until) { bs.phase = 'idle'; bs.nextAt = w.time + G.gap; }
      return;
    }
    u.aiState = tgt ? 'ametrallador' : 'acecha';
    if (w.isBlinded(u)) { u.aiState = 'cegado'; return; }
    this.bossApproach(u, b, tgt, sp, 16);
    if (!tgt || w.time < bs.nextAt || w.time < b.reactAt || u.reloading > 0 || u.mag < u.magSize) return;
    const d = Math.hypot(tgt.x - u.x, tgt.y - u.y);
    if (d < 2.5 || d > G.maxDist || w.shotLine(u, tgt) < 0) return;
    if (Math.abs(angDiff(Math.atan2(tgt.y - u.y, tgt.x - u.x), u.yaw)) > 0.35) return; // primero lo encara
    bs.yaw = Math.atan2(tgt.y - u.y, tgt.x - u.x); bs.dx = Math.cos(bs.yaw); bs.dy = Math.sin(bs.yaw);
    bs.dist = Math.max(6, d);
    bs.len = Math.max(2, G.laneLen * w.level.ray(u.x, u.y, 1.0, u.x + bs.dx * G.laneLen, u.y + bs.dy * G.laneLen, 1.0, 'bullet'));
    bs.phase = 'tele'; bs.until = w.time + G.telegraph;
    bs.threat = w.addThreat({ kind: 'lane', fx: u.x, fy: u.y, x: u.x + bs.dx * bs.len, y: u.y + bs.dy * bs.len, r: G.laneWidth, at: bs.until, ownerId: u.id });
    u.wishX = u.wishY = 0; u.path = null;
  }

  /**
   * Embestida: aviso 'charge' (pasillo recto, fijado al empezar) → carrera a 9 m/s por ESE pasillo. Si alcanza a
   * alguien: daño y empujón, y frena. Si no (se acaba el pasillo, choca): aturdido y expuesto. Entre embestidas dispara poco.
   */
  private chargerThink(u: Unit, b: Brain, tgt: Unit | null, sp: number, dt: number): void {
    const w = this.w, C = BOSS_CHARGER, L = w.level;
    const bs = this.bossAttack(b);
    if (bs.phase === 'tele') {
      u.aiState = 'toma carrerilla'; b.faceYaw = bs.yaw;
      if (w.time >= bs.until) { bs.phase = 'dash'; bs.t0 = w.time; bs.x0 = bs.px = u.x; bs.y0 = bs.py = u.y; bs.stall = 0; bs.threat = null; u.path = null; }
      return;
    }
    if (bs.phase === 'dash') {
      u.aiState = 'embiste'; b.faceYaw = bs.yaw; u.yaw = bs.yaw;
      const run = (u.x - bs.x0) * bs.dx + (u.y - bs.y0) * bs.dy;
      const step = (u.x - bs.px) * bs.dx + (u.y - bs.py) * bs.dy;
      bs.px = u.x; bs.py = u.y;
      if (w.time - bs.t0 > 0.2 && step < C.speed * dt * 0.3) bs.stall++; else bs.stall = 0;
      let hit: Unit | null = null;
      for (const e of w.entities) {
        if (!e.alive || e.team !== 'ally' || e.downed) continue;
        if (Math.hypot(e.x - u.x, e.y - u.y) < u.radius + e.radius + 0.25) { hit = e; break; }
      }
      if (hit) {
        w.damage(hit, C.damage * allyMult(hit), u, 'knife', u.x, u.y);
        hit.vx += bs.dx * C.push; hit.vy += bs.dy * C.push;
        w.events.push({ type: 'knife', id: u.id, hit: true });
        bs.phase = 'recover'; bs.until = w.time + C.recover;
        u.vx *= 0.2; u.vy *= 0.2;
      } else if (run >= bs.len - 0.2 || bs.stall >= 3 || w.time - bs.t0 > bs.len / C.speed + 0.6) {
        // ha fallado (o se ha estampado): la ventana para castigarle
        bs.phase = 'stun'; bs.until = w.time + C.stun;
        u.staggerUntil = bs.until; u.exposedUntil = bs.until;
        u.vx = u.vy = 0;
      } else { u.wishX = bs.dx * C.speed; u.wishY = bs.dy * C.speed; }
      return;
    }
    if (bs.phase === 'stun' || bs.phase === 'recover') {
      u.aiState = bs.phase === 'stun' ? 'aturdido' : 'se rehace';
      if (w.time >= bs.until) bs.phase = 'idle';
      return;
    }
    u.aiState = tgt ? 'embestida' : 'acecha';
    if (w.isBlinded(u)) { u.aiState = 'cegado'; return; }
    this.bossApproach(u, b, tgt, sp, 11);
    if (!tgt) return;
    const d = Math.hypot(tgt.x - u.x, tgt.y - u.y);
    const facing = Math.abs(angDiff(Math.atan2(tgt.y - u.y, tgt.x - u.x), u.yaw)) < 0.3;
    if (w.time >= bs.nextAt && w.time >= b.reactAt && facing && d >= C.minDist && d <= C.maxDist - 1 && w.shotLine(u, tgt) >= 0) {
      const yaw = Math.atan2(tgt.y - u.y, tgt.x - u.x), dx = Math.cos(yaw), dy = Math.sin(yaw);
      // hasta dónde hay suelo libre en línea recta (una puerta cerrada cuenta como pared)
      let len = 0;
      while (len < C.maxDist && L.walkLine(u.x + dx * len, u.y + dy * len, u.x + dx * (len + 0.5), u.y + dy * (len + 0.5), false)) len += 0.5;
      if (len >= Math.min(d, 5)) {
        bs.yaw = yaw; bs.dx = dx; bs.dy = dy; bs.len = len;
        bs.phase = 'tele'; bs.until = w.time + C.telegraph; bs.nextAt = bs.until + C.cooldown;
        bs.threat = w.addThreat({ kind: 'charge', fx: u.x, fy: u.y, x: u.x + dx * len, y: u.y + dy * len, r: C.laneWidth, at: bs.until, ownerId: u.id });
        this.say(u, 'enemy.charge');
        u.wishX = u.wishY = 0; u.path = null;
        return;
      }
    }
    this.tryShoot(u, b, tgt, 1.5);
  }

  /** Jefe de escoltas: dispara como un Veterano con vida de jefe. La curación y el enfado van en escortsUpdate(). */
  private escortedThink(u: Unit, b: Brain, tgt: Unit | null, sp: number): void {
    const w = this.w;
    u.aiState = u.enraged ? 'enfurecido' : tgt ? 'jefe' : 'acecha';
    if (w.isBlinded(u)) { u.aiState = 'cegado'; return; }
    // con escoltas vivas no se aleja de ellas; enfurecido, va a por ti
    let guarded = false;
    for (const o of w.entities) if (o.alive && o.team === 'enemy' && (o.brain as Brain).escortOf === u.id) { guarded = true; break; }
    if (guarded && !tgt) b.faceYaw = Math.atan2(b.belief!.y - u.y, b.belief!.x - u.x);
    else this.bossApproach(u, b, tgt, sp, guarded ? 22 : 12);
    if (tgt) this.tryShoot(u, b, tgt, 1.8);
  }
}

function rank(k: EnemyKind, first: EnemyKind, second: EnemyKind): number { return k === first ? 2 : k === second ? 1 : 0; }
/** v1.3 — oficios con conducta propia: no entran en el reparto de papeles ni en el repliegue de la escuadra. */
/** v1.3 — los compañeros con IA no esquivan los ataques con aviso: reciben una fracción (ver V13_ALLY_AI_DAMAGE). */
function allyMult(t: Unit): number { return t.isPlayer ? 1 : V13_ALLY_AI_DAMAGE; }
function soloist(u: Unit): boolean { return u.variant === 'asaltante' || u.variant === 'tirador' || u.variant === 'blindado'; }
