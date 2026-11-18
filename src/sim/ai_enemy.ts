// IA de los enemigos (§14). Percepción con dos conos + pared, oído por donde se anda, memoria que se
// desdibuja, avisos con retardo, cobertura, reparto de papeles (fijar / rodear / presionar), repliegue,
// patrulla y compromiso mínimo con cada decisión.
//
// Lo que NUNCA puede pasar, por construcción:
//  - Ver a través de una pared o una puerta cerrada: toda detección pasa por world.canSee (rayo 'sight').
//  - Disparar a través de un tabique: world.fire traza la bala con un rayo real; además no se aprieta el
//    gatillo sin world.shotLine() válida en ese mismo instante.

import { ALERT_DELAY, VISION } from './data';
import type { CoverPoint } from './level';
import type { EnemyKind, Vec2 } from './types';
import { angDiff, type Unit, type World } from './world';

type State = 'patrol' | 'investigate' | 'cover' | 'advance' | 'flank' | 'search' | 'retreat' | 'melee' | 'boss';
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
    };
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
    this.hearNoises();
    for (const s of this.squads) this.squadTactics(s);
    for (const u of w.entities) {
      if (!u.alive || u.team !== 'enemy') continue;
      const b = u.brain as Brain;
      if (w.time >= b.senseAt) { this.sense(u, b, w.time - (b.senseAt - 0.1)); b.senseAt = w.time + 0.1; }
      if (b.pending && w.time >= b.pending.at) {
        const p = b.pending; b.pending = null;
        if (!b.belief || b.belief.t < p.b.t) this.setBelief(u, b, { ...p.b }, false);
      }
      this.think(u, b, dt);
      // giro hacia donde quiere mirar
      const rate = (u.kind === 'megaboss' || u.kind === 'miniboss' ? 2.6 : 5.5) * dt;
      const d = angDiff(b.faceYaw, u.yaw);
      u.yaw += Math.abs(d) < rate ? d : Math.sign(d) * rate;
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
    const pa = engaged ? 1.05 : VISION.primaryHalfAngle, pr = engaged ? 30 : VISION.primaryRange;
    const sa = engaged ? 1.75 : VISION.peripheralHalfAngle, sr = engaged ? 14 : VISION.peripheralRange;
    let best: Unit | null = null, bestRate = 0;
    for (const t of w.entities) {
      if (!t.alive || t.team !== 'ally') continue;
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
      if (!w.canSee(u, t)) continue; // la pared manda
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
      if (own && w.time - s.alertEvtAt > 6 && nb.t >= w.time - 0.2) { s.alertEvtAt = w.time; w.events.push({ type: 'alert', id: u.id, x: u.x, y: u.y }); }
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
          if (d < 6 || (d < 13 && w.canSee(u, m))) tell(m, 0.4);
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
        for (const m of s.members) { const mb = m.brain as Brain; this.releaseCover(m, mb); this.setState(m, mb, 'retreat', 2); }
      } else s.retreated = true;
    }
    if (s.mode === 'retreat') {
      const arrived = s.members.every(m => Math.hypot(m.x - s.rally[0], m.y - s.rally[1]) < 3);
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
        for (const m of s.members) { const mb = m.brain as Brain; mb.commitUntil = 0; this.setState(m, mb, mb.belief ? 'advance' : 'patrol', 0.5); }
      }
      return;
    }

    // reparto de papeles: se revisa cada 5 s o cuando cae alguien
    if (s.mode === 'combat' && w.time - s.rolesAt > 5) {
      s.rolesAt = w.time;
      const ms = s.members.filter(m => m.kind !== 'miniboss' && m.kind !== 'megaboss');
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
    const band = BAND[u.ekind!];
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
  private startCover(u: Unit, b: Brain, tx: number, ty: number, rmin: number, rmax: number): boolean {
    const w = this.w, L = w.level;
    let best: CoverPoint | null = null, bs = -Infinity, bestPeek: Vec2 | null = null;
    const tz = 1.4;
    for (const c of L.cover) {
      if (c.taken >= 0 && c.taken !== u.id) { const o = w.entityById(c.taken); if (o && o.alive) continue; c.taken = -1; }
      const ds = Math.hypot(c.x - u.x, c.y - u.y);
      if (ds > 15) continue;
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
      if (!peek && b.role === 'suppress') continue; // quien fija necesita poder asomarse
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
    const sees = !!tgt && tgt.alive;
    if (!sees) b.visId = -1;
    u.wishX = 0; u.wishY = 0;

    // los grupos de caza van a por la última posición que sepa cualquiera
    if (b.hunt && !b.belief && this.global && w.time - this.global.t < 40) {
      b.belief = { ...this.global, t: Math.max(this.global.t, w.time - 3) }; b.aware = 1; b.alerted = true;
    }
    // recarga cuando toca
    if (u.mag <= 0 && u.ammo > 0 && u.reloading <= 0) w.startReload(u);

    if (u.kind === 'miniboss' || u.kind === 'megaboss') { this.bossThink(u, b, tgt && sees ? tgt : null, dt); return; }

    const pinned = w.time < u.pinnedUntil;
    if (pinned) {
      // Supresión: clavado. Agachado, sin avanzar; como mucho devuelve algún tiro.
      u.crouch = true; u.aiState = 'clavado';
      if (sees) { b.faceYaw = Math.atan2(tgt!.y - u.y, tgt!.x - u.x); if (w.rng() < 0.25 * dt * 4) { u.crouch = false; this.tryShoot(u, b, tgt!, 2.2); } }
      return;
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
      case 'melee': {
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
    if (w.time < b.reactAt || u.reloading > 0 || u.mag <= 0 || u.fireCd > 0) return false;
    if (w.time < b.restUntil) return false;
    if (w.time > b.burstUntil) {
      // El MegaBoss dispara en ráfagas largas con pausas claras: la pausa es la ventana para asomarse.
      const mega = u.kind === 'megaboss';
      if (b.burstUntil > 0 && w.time - b.burstUntil < 0.05) { b.restUntil = w.time + (mega ? 2.6 + w.rng() * 1.2 : 0.35 + w.rng() * 0.6); b.burstUntil = 0; return false; }
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
    if (w.time - b.lastSawAt > 5 && w.time - b.stateAt > 5 && w.time >= b.commitUntil) {
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
        if (u.mag < u.magSize * 0.4 && u.ammo > 0) w.startReload(u);
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
    if (u.shielded) u.aiState = 'escudo';
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
}

function rank(k: EnemyKind, first: EnemyKind, second: EnemyKind): number { return k === first ? 2 : k === second ? 1 : 0; }
