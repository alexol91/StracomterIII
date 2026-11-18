// Director: cuántos enemigos, de qué tipo, dónde y cuándo aparecen (§8 y §9), el jefe y las fases del MegaBoss.

import { applyBossVariant, applyVariant, type Squad } from './ai_enemy';
import { BOSS_ESCORTED, BOSS_LATE, BOSS_ROTATION, ENEMY_MIX, HORDE, OBJECTIVE, hordeEnemies, hordeFloorOf, FLOOR_BOSS, VARIANT_ALIVE_CAP, VARIANT_BASE, VARIANT_ORDER, VARIANT_SHARE, VARIANT_UNLOCK } from './data';
import { CELL } from './level';
import type { BossVariant, EnemyKind, EnemyVariant, Vec2 } from './types';
import type { Unit, World } from './world';

export interface DirectorConfig {
  /** total de enemigos básicos de la zona (ya con dificultad y ajuste dinámico aplicados) */
  total: number;
  /** proporción [Sicario, Miliciano, Veterano] */
  mix: [number, number, number];
  miniboss: boolean;
  megaboss: boolean;
  /** refuerzos por cada cambio de fase del MegaBoss */
  reinforcements: number;
  /** 0 = sin flanqueo ni repliegue (planta 1) */
  tactics: number;
  /** v1.3 — dificultad (el láser del tirador apunta menos tiempo en difícil). Si falta se toma 'normal'. */
  difficulty?: 'easy' | 'normal' | 'hard';
  /** v1.3 — fuerza la variante del jefe de planta (pruebas); por defecto FLOOR_BOSS[planta] */
  bossVariant?: BossVariant;
  /** v1.3 (oleada 2) — modo horda: oleadas sin fin (ignora total/mix) */
  horde?: boolean;
  /** modificador «jefes dobles» */
  doubleBoss?: boolean;
}

/** v1.3 — un puesto en la cola de apariciones: tipo base y, si lo lleva, oficio. */
export interface Slot { kind: EnemyKind; variant: EnemyVariant | null }

/** v1.3 — cuántos enemigos de cada oficio tocan en una planta con `n` enemigos normales (reparto a partes iguales entre los desbloqueados). */
export function variantCounts(n: number, floor: number): Record<EnemyVariant, number> {
  const out: Record<EnemyVariant, number> = { asaltante: 0, granadero: 0, tirador: 0, blindado: 0 };
  const share = VARIANT_SHARE[floor] ?? 0;
  const un = VARIANT_ORDER.filter(v => floor >= VARIANT_UNLOCK[v]);
  if (share <= 0 || un.length === 0) return out;
  const total = Math.round(n * share);
  for (let i = 0; i < total; i++) out[un[i % un.length]]++;
  return out;
}

/**
 * v1.3 — reparte los oficios sobre una lista de enemigos normales. Sustituye, no añade: devuelve una lista igual de larga.
 * Cada oficio sale de su tipo base preferido (VARIANT_BASE). Determinista con `rng`.
 */
export function assignVariants(kinds: EnemyKind[], floor: number, rng: () => number): Slot[] {
  const out: Slot[] = kinds.map(kind => ({ kind, variant: null }));
  const cnt = variantCounts(kinds.length, floor);
  // primero los más exigentes con su tipo base (blindado y tirador quieren Veteranos)
  for (const v of VARIANT_ORDER.slice().reverse()) {
    for (let k = 0; k < cnt[v]; k++) {
      let free: number[] = [];
      for (const base of VARIANT_BASE[v]) {
        free = [];
        for (let i = 0; i < out.length; i++) if (!out[i].variant && out[i].kind === base) free.push(i);
        if (free.length) break;
      }
      if (!free.length) break;
      out[free[Math.floor(rng() * free.length)]].variant = v;
    }
  }
  return out;
}

interface SpawnCand { x: number; y: number; access: boolean }

/** máximo de enemigos vivos a la vez; el resto espera turno */
const ALIVE_CAP = 44;

export class Director {
  private qAsc: Slot[] = [];
  private qPeak: Slot[] = [];
  private qRelief: Slot[] = [];
  private qBoss: Slot[] = []; // refuerzos del MegaBoss ya liberados
  private bossReserve = 0;         // refuerzos de fases aún no alcanzadas
  private cands: SpawnCand[] = [];
  private recent: Vec2[] = [];
  private nextWaveAt = 0;
  private ascSpawned = 0; private ascEmptyAt = -1;
  private peakTotal = 0;
  private reliefEvery = 3; private nextReliefAt = 0;
  private failSince = -1;
  private boss: Unit | null = null;
  private shieldAt = 0;
  private shieldWave = 0;
  private tryAt = 0;
  // v1.3 (oleada 2): defensa del servidor y modo horda
  private holdQ: Slot[] = [];
  private holding = false; private holdN0 = 0; private holdAt = 0;
  private qWave: Slot[] = [];
  private mixNow: [number, number, number] | null = null;
  private vfloor: number | null = null;
  private restUntil = 0; private nextRelAt = 0;

  constructor(private w: World, private cfg: DirectorConfig) {}

  pending(): number {
    return this.qAsc.length + this.qPeak.length + this.qRelief.length + this.qBoss.length + this.bossReserve + this.holdQ.length + this.qWave.length;
  }

  private kinds(n: number): EnemyKind[] {
    const mix = this.mixNow ?? this.cfg.mix;
    const sum = mix[0] + mix[1] + mix[2] || 1;
    const exact = mix.map(m => (m / sum) * n);
    const cnt = exact.map(Math.floor);
    let rest = n - cnt[0] - cnt[1] - cnt[2];
    const order = [0, 1, 2].sort((a, b) => (exact[b] - cnt[b]) - (exact[a] - cnt[a]));
    for (let i = 0; rest > 0; i = (i + 1) % 3, rest--) cnt[order[i]]++;
    const out: EnemyKind[] = [];
    (['enemy1', 'enemy2', 'enemy3'] as EnemyKind[]).forEach((k, i) => { for (let j = 0; j < cnt[i]; j++) out.push(k); });
    // barajar
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(this.w.rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }

  /** v1.3 — n enemigos normales con su parte de oficios ya repartida. */
  private slots(n: number): Slot[] { return assignVariants(this.kinds(n), this.vfloor ?? this.w.floor, this.w.rng); }

  /**
   * v1.3 — saca `n` puestos de la cola respetando el máximo de cada oficio vivo a la vez: el que no cabe cede el turno
   * al siguiente; si en la cola ya solo quedan oficios al tope, sale como enemigo normal (nunca se bloquea la cola).
   */
  private take(q: Slot[], n: number): Slot[] {
    const cnt: Record<EnemyVariant, number> = { asaltante: 0, granadero: 0, tirador: 0, blindado: 0 };
    for (const e of this.w.entities) if (e.alive && e.team === 'enemy' && e.variant) cnt[e.variant]++;
    const out: Slot[] = [];
    while (out.length < n && q.length > 0) {
      const j = q.findIndex(s => !s.variant || cnt[s.variant] < VARIANT_ALIVE_CAP[s.variant]);
      if (j < 0) { out.push({ kind: q.shift()!.kind, variant: null }); continue; }
      const s = q.splice(j, 1)[0];
      if (s.variant) cnt[s.variant]++;
      out.push(s);
    }
    return out;
  }

  /** v1.3 — saca de la lista `n` puestos para acompañar al jefe: con ese oficio (o, si `variant` es null, enemy2 sin oficio). */
  private pull(all: Slot[], n: number, variant: EnemyVariant | null): Slot[] {
    const out: Slot[] = [];
    for (let k = 0; k < n && all.length > 0; k++) {
      let i = all.findIndex(s => s.variant === variant && (variant !== null || s.kind === 'enemy2'));
      if (i < 0) i = all.findIndex(s => s.variant === null && (variant === null || s.kind === VARIANT_BASE[variant][0]));
      if (i < 0) i = all.findIndex(s => s.variant === null);
      if (i < 0) break;
      const s = all.splice(i, 1)[0];
      out.push(variant ? { kind: s.kind, variant } : { kind: 'enemy2', variant: null });
    }
    return out;
  }

  begin(): void {
    const w = this.w, cfg = this.cfg;
    w.enemyAI.tactics = cfg.tactics;
    w.enemyAI.hard = cfg.difficulty === 'hard';
    this.buildCandidates();
    if (cfg.horde) { this.startWave(1); return; }
    const all = this.slots(cfg.total);
    const [bx, by] = w.level.map.punto_jefe;

    if (cfg.megaboss) {
      const c = w.level.nearestFree(bx, by, true, 20);
      const boss = w.spawnUnit('megaboss', w.level.cellX(c), w.level.cellY(c), false);
      this.boss = boss;
      const s = w.enemyAI.newSquad([boss.x, boss.y], false);
      s.route = this.routeAround([boss.x, boss.y], 3, 7);
      w.enemyAI.join(boss, s);
      this.bossReserve = cfg.reinforcements * 2;
      if (cfg.doubleBoss) this.spawnSecondBoss(boss, 'cohetes', w.floor, true);
      // escolta inicial
      this.qAsc = [];
      this.placeInitial(all, 3);
      w.pacing = 'pico';
      return;
    }
    // v1.3 — jefe de planta: su variante y, si toca, los acompañantes (salen de la cuota normal, no se añaden)
    const bv: BossVariant = cfg.bossVariant ?? FLOOR_BOSS[w.floor] ?? 'cohetes';
    let escorts: Slot[] = [], escortsHeal = false;
    if (cfg.miniboss) {
      if (bv === 'escoltas') { escorts = this.pull(all, BOSS_ESCORTED.escorts, null); escortsHeal = true; }
      else if (w.floor >= BOSS_LATE.fromFloor && BOSS_LATE.companions[w.floor]) escorts = this.pull(all, 2, BOSS_LATE.companions[w.floor]);
    }
    const nAsc = Math.round(all.length * 0.4), nPeak = Math.round(all.length * 0.5);
    const asc = all.slice(0, nAsc);
    this.qPeak = all.slice(nAsc, nAsc + nPeak);
    this.qRelief = all.slice(nAsc + nPeak);
    this.peakTotal = this.qPeak.length;
    // ~60 % del ascenso ya está en la planta, patrullando; el resto llega en oleadas pequeñas
    const nInit = Math.max(Math.min(asc.length, 2), Math.ceil(asc.length * 0.6));
    this.qAsc = asc.slice(nInit);
    this.placeInitial(asc.slice(0, nInit), asc.length <= 6 ? 2 : 4);
    this.ascSpawned = nInit;
    if (cfg.miniboss) {
      const c = w.level.nearestFree(bx, by, true, 20);
      if (c >= 0) {
        const boss = w.spawnUnit('miniboss', w.level.cellX(c), w.level.cellY(c), false);
        this.boss = boss;
        applyBossVariant(boss, bv, w.floor);
        const s = w.enemyAI.newSquad([boss.x, boss.y], false);
        s.route = this.routeAround([boss.x, boss.y], 2, 5);
        w.enemyAI.join(boss, s);
        // acompañantes: junto al jefe y en su grupo
        let k = 0;
        for (const sl of escorts) {
          let cell = -1;
          for (let t = 0; t < 16 && cell < 0; t++) {
            const a = k * 2.4 + t * 0.9, r = 1.4 + 0.3 * t;
            const cc = w.level.cellOf(boss.x + Math.cos(a) * r, boss.y + Math.sin(a) * r);
            if (cc < 0 || !w.level.passable(cc, true) || w.level.doorCell[cc] || !(w.pField[cc] < Infinity)) continue;
            if (!w.level.walkLine(boss.x, boss.y, w.level.cellX(cc), w.level.cellY(cc), true)) continue;
            cell = cc;
          }
          if (cell < 0) cell = c;
          const u = w.spawnUnit(sl.kind, w.level.cellX(cell), w.level.cellY(cell), false);
          if (sl.variant) applyVariant(u, sl.variant);
          w.enemyAI.join(u, s);
          if (escortsHeal) w.enemyAI.makeEscort(u, boss);
          k++;
        }
        s.initial = s.members.length;
        if (cfg.doubleBoss) this.spawnSecondBoss(boss, bv, w.floor);
      } else this.qAsc.push(...escorts); // sin sitio para el jefe: los acompañantes vuelven a la cola
    }
    this.nextWaveAt = 10;
  }

  /** Modificador «jefes dobles»: un segundo jefe de planta (en la 9, un MiniBoss junto al MegaBoss) al lado del primero. */
  private spawnSecondBoss(first: Unit, bv: BossVariant, floor: number, mini = false): void {
    const w = this.w, L = w.level;
    const c = L.nearestFree(first.x + 2.5, first.y + 1, true, 10);
    if (c < 0) return;
    const b2 = w.spawnUnit('miniboss', L.cellX(c), L.cellY(c), false);
    applyBossVariant(b2, bv, floor);
    void mini;
    const s = w.enemyAI.newSquad([b2.x, b2.y], false);
    s.route = this.routeAround([b2.x, b2.y], 2, 5);
    w.enemyAI.join(b2, s);
    s.initial = s.members.length;
  }

  // ───────────────────────── v1.3 (oleada 2): defensa del servidor ─────────────────────────

  /** La defensa empieza (el jugador llegó al servidor): lo que falta por salir se reparte en `defendSpreadOver` s, con un mínimo. */
  beginHold(): void {
    if (this.holding) return;
    const rest = [...this.qAsc, ...this.qPeak, ...this.qRelief];
    this.qAsc = []; this.qPeak = []; this.qRelief = [];
    const min = Math.round(this.cfg.total * OBJECTIVE.defendMinShare);
    if (rest.length < min) rest.push(...this.slots(min - rest.length));
    this.holdQ = rest; this.holdN0 = rest.length; this.holdAt = this.w.time; this.holding = true;
    this.w.pacing = 'pico';
  }

  // ───────────────────────── v1.3 (oleada 2): modo horda ─────────────────────────

  private startWave(n: number): void {
    const w = this.w, h = w.horde!;
    const fl = hordeFloorOf(n);
    this.vfloor = fl;
    this.mixNow = ENEMY_MIX[fl];
    w.enemyAI.tactics = fl >= 2 ? 1 : 0;
    const boss = n % HORDE.bossEvery === 0;
    h.wave = n; h.bossWave = boss; h.rest = 0; h.pickUpgrade = false;
    this.qWave = this.slots(hordeEnemies(n, this.cfg.difficulty ?? 'normal'));
    if (boss) this.spawnWaveBoss(BOSS_ROTATION[(n / HORDE.bossEvery - 1) % BOSS_ROTATION.length], fl);
    h.left = this.qWave.length + w.enemiesAlive();
    this.nextRelAt = w.time;
    w.events.push({ type: 'wave', wave: n, boss });
  }

  /** Jefe de planta de una oleada de jefe: lejos del jugador y fuera de su vista; los escoltas, con sus dos acompañantes. */
  private spawnWaveBoss(bv: BossVariant, floor: number): void {
    const w = this.w;
    let at: Vec2 | null = null;
    for (let relax = 0; relax <= 6 && !at; relax++) at = this.pickSpawn(relax);
    if (!at) return;
    const c = w.level.nearestFree(at[0], at[1], true, 10);
    if (c < 0) return;
    const boss = w.spawnUnit('miniboss', w.level.cellX(c), w.level.cellY(c), w.time > 0);
    applyBossVariant(boss, bv, floor);
    this.boss = boss;
    const s = w.enemyAI.newSquad([boss.x, boss.y], true);
    s.route = this.routeAround([boss.x, boss.y], 2, 5);
    w.enemyAI.join(boss, s);
    if (bv === 'escoltas') {
      for (let k = 0; k < BOSS_ESCORTED.escorts; k++) {
        const cc = w.level.nearestFree(boss.x + 1.6 + k * 0.8, boss.y + 1, true, 6);
        if (cc < 0) continue;
        const u = w.spawnUnit('enemy2', w.level.cellX(cc), w.level.cellY(cc), w.time > 0);
        w.enemyAI.join(u, s);
        w.enemyAI.makeEscort(u, boss);
      }
    }
    s.initial = s.members.length;
  }

  private hordeUpdate(): void {
    const w = this.w, h = w.horde!;
    const alive = w.enemiesAlive();
    if (h.rest > 0 || (this.restUntil > 0 && this.qWave.length === 0 && alive === 0 && !h.pickUpgrade)) {
      h.rest = Math.max(0, this.restUntil - w.time);
      if (h.rest <= 0) { this.restUntil = 0; this.startWave(h.wave + 1); }
      return;
    }
    if (this.qWave.length > 0) {
      if (w.time >= this.nextRelAt && alive < HORDE.aliveCap) {
        if (this.release(this.qWave, HORDE.releaseGroup, true)) this.nextRelAt = w.time + HORDE.releaseEvery;
      }
    } else if (alive === 0) {
      // oleada acabada: suministros, los derribados se levantan, descanso (y mejora cada 2 oleadas)
      for (const e of w.entities) if (e.alive && e.downed) w.revive(e, null);
      const p = w.player;
      HORDE.supplies.forEach((t, i) => {
        const c = w.level.nearestFree(p.x + Math.cos(i * 3) * 1.8, p.y + Math.sin(i * 3) * 1.8, true, 6);
        if (c >= 0) w.dropPickup(t, w.level.cellX(c), w.level.cellY(c));
      });
      this.restUntil = w.time + HORDE.rest;
      h.rest = HORDE.rest;
      if (h.wave % HORDE.pickEvery === 0) h.pickUpgrade = true;
    }
    h.left = this.qWave.length + alive;
  }

  // ───────────────────────── puntos de aparición ─────────────────────────

  private buildCandidates(): void {
    const L = this.w.level;
    const out: SpawnCand[] = [];
    const add = (x: number, y: number, access: boolean) => {
      const c = L.cellOf(x, y);
      if (c < 0 || !L.passable(c, true) || L.doorCell[c]) return;
      out.push({ x, y, access });
    };
    // accesos reales: los dos lados de cada puerta
    for (const d of L.doors) {
      if (d.vertical) { add(d.x0 - 1.2, d.cy, true); add(d.x1 + 1.2, d.cy, true); }
      else { add(d.cx, d.y0 - 1.2, true); add(d.cx, d.y1 + 1.2, true); }
    }
    // resto: muestreo del suelo cada 2 m; junto a la fachada cuenta como acceso (escaleras, ascensores)
    for (let y = L.oy + 1; y < L.oy + L.gh * CELL; y += 2) for (let x = L.ox + 1; x < L.ox + L.gw * CELL; x += 2) {
      const c = L.cellOf(x, y);
      if (c < 0 || !L.passable(c, true)) continue;
      let nearEdge = false;
      for (const s of L.perimeterSegs) {
        const ex = s[2] - s[0], ey = s[3] - s[1];
        const l2 = ex * ex + ey * ey || 1;
        const t = Math.max(0, Math.min(1, ((x - s[0]) * ex + (y - s[1]) * ey) / l2));
        if (Math.hypot(x - s[0] - ex * t, y - s[1] - ey * t) < 1.6) { nearEdge = true; break; }
      }
      add(x, y, nearEdge);
    }
    this.cands = out;
  }

  /** ¿El jugador puede ver ese punto (desde sus ojos o desde la cámara)? */
  private visibleToPlayer(x: number, y: number): boolean {
    const w = this.w, p = w.player, L = w.level;
    for (const z of [0.9, 1.7]) {
      if (L.clear(p.x, p.y, 1.6, x, y, z, 'sight')) return true;
      if (L.clear(w.cam.x, w.cam.y, w.cam.z, x, y, z, 'sight')) return true;
    }
    return false;
  }

  /**
   * Elige un punto de aparición justo (§9): lejos, fuera de la vista, alcanzable, mejor por un acceso y
   * repartido. `relax` 0..: cuánto se han tenido que aflojar las reglas porque no había sitio.
   */
  private pickSpawn(relax: number): Vec2 | null {
    const w = this.w;
    const minD = Math.max(5, 12 - relax * 2);
    let best: SpawnCand | null = null, bs = -Infinity;
    for (const c of this.cands) {
      const wd = w.walkDistToPlayer(c.x, c.y);
      if (!(wd < Infinity)) continue; // inalcanzable: ahí no aparece nadie
      const d = Math.hypot(c.x - w.player.x, c.y - w.player.y);
      if (d < minD) continue;
      let sc = (c.access ? 6 : 0) + w.rng() * 4 + Math.min(d, 25) * 0.15;
      for (const r of this.recent) { const dr = Math.hypot(c.x - r[0], c.y - r[1]); if (dr < 8) sc -= (8 - dr) * 1.2; }
      if (sc <= bs) continue;
      if (this.visibleToPlayer(c.x, c.y)) {
        if (relax < 5) continue;
        // último recurso (mapa sin escondites): al menos a la espalda del jugador y lo más lejos posible
        const a = Math.atan2(c.y - w.player.y, c.x - w.player.x) - w.cam.yaw;
        if (Math.cos(a) > -0.2) continue;
        sc -= 20 - d * 0.5;
        if (sc <= bs) continue;
      }
      bs = sc; best = c;
    }
    return best ? [best.x, best.y] : null;
  }

  private routeAround(home: Vec2, n: number, radius: number): Vec2[] {
    const w = this.w, L = w.level;
    const f = w.nav.field(home[0], home[1], true, 2, radius + 4);
    const pts: Vec2[] = [home];
    for (let tries = 0; tries < 40 && pts.length < n + 1; tries++) {
      const c = this.cands[Math.floor(w.rng() * this.cands.length)];
      if (!c) break;
      const i = L.cellOf(c.x, c.y);
      const d = i >= 0 ? f[i] : Infinity;
      if (!(d < radius + 3) || d < 2.5) continue;
      if (pts.some(p => Math.hypot(p[0] - c.x, p[1] - c.y) < 3)) continue;
      // las patrullas no se meten en la entrada del jugador
      const st = L.map.inicio_jugador;
      if (Math.hypot(c.x - st[0], c.y - st[1]) < 8) continue;
      pts.push([c.x, c.y]);
    }
    return pts;
  }

  private spawnGroup(kinds: Slot[], at: Vec2, hunt: boolean, routeRadius: number, minDist = 0, hidden = true): Squad {
    const w = this.w, L = w.level;
    const s = w.enemyAI.newSquad(at, hunt);
    s.route = this.routeAround(at, 3, routeRadius); // también los de caza: si te pierden, patrullan
    let k = 0;
    for (const { kind, variant } of kinds) {
      let cell = -1;
      for (let t = 0; t < 12 && cell < 0; t++) {
        const a = (k * 2.4) + t, r = 0.6 + 0.45 * Math.sqrt(k + t);
        const c = L.cellOf(at[0] + Math.cos(a) * r, at[1] + Math.sin(a) * r);
        if (c < 0 || !L.passable(c, true) || L.doorCell[c] || !(w.pField[c] < Infinity)) continue;
        const mx = L.cellX(c), my = L.cellY(c);
        if (!L.walkLine(at[0], at[1], mx, my, true)) continue;
        // cada miembro cumple las reglas por sí mismo, no solo el punto del grupo
        if (Math.hypot(mx - w.player.x, my - w.player.y) < minDist) continue;
        if (hidden && this.visibleToPlayer(mx, my)) continue;
        cell = c;
      }
      if (cell < 0) cell = L.nearestFree(at[0], at[1], true); // el propio punto elegido, que sí las cumple
      const u = w.spawnUnit(kind, L.cellX(cell), L.cellY(cell), w.time > 0);
      if (variant) applyVariant(u, variant);
      w.enemyAI.join(u, s);
      k++;
    }
    s.initial = s.members.length;
    this.recent.push(at);
    if (this.recent.length > 4) this.recent.shift();
    return s;
  }

  private placeInitial(kinds: Slot[], groupSize: number): void {
    const q = kinds.slice();
    while (q.length > 0) {
      const n = Math.min(q.length, groupSize + (this.w.rng() < 0.4 ? 1 : 0));
      let at: Vec2 | null = null;
      // al empezar se afloja la distancia si el mapa no da para más, pero NUNCA la regla de no estar a la vista
      let relax = 0;
      for (; relax <= 4 && !at; relax++) at = this.pickSpawn(relax);
      if (!at) { this.qAsc.push(...q.splice(0, n)); continue; } // no hay sitio justo: llegarán como oleada
      this.spawnGroup(this.take(q, n), at, false, 12, Math.max(5, 12 - (relax - 1) * 2));
    }
  }

  /** Intenta soltar un grupo por un acceso. Devuelve false si ahora mismo no hay sitio justo. */
  private release(q: Slot[], n: number, hunt: boolean): boolean {
    const w = this.w;
    const room = ALIVE_CAP - w.enemiesAlive();
    n = Math.min(n, q.length, room);
    if (n <= 0) return false;
    if (this.failSince < 0) this.failSince = w.time;
    const relax = Math.floor((w.time - this.failSince) / 3);
    const at = this.pickSpawn(relax);
    if (!at) return false;
    this.failSince = -1;
    const s = this.spawnGroup(this.take(q, n), at, hunt, 10, Math.max(5, 12 - relax * 2), relax < 5);
    if (!hunt) {
      // oleada del ascenso: viene hacia la zona donde anda el jugador, sin saber exactamente dónde está
      const p = w.player;
      const bx = p.x + (w.rng() - 0.5) * 10, by = p.y + (w.rng() - 0.5) * 10;
      const c = w.level.nearestFree(bx, by, true, 20);
      if (c >= 0) s.route = [[w.level.cellX(c), w.level.cellY(c)], at, ...s.route.slice(1)];
      for (const m of s.members) m.brain.patrolI = 0;
    }
    return true;
  }

  // ───────────────────────── ritmo ─────────────────────────

  update(dt: number): void {
    const w = this.w;
    void dt;
    if (w.status !== 'playing') return;
    if (w.hold) return; // v1.2 tutorial: ni oleadas, ni fases, ni zona limpia
    if (this.cfg.horde) { this.hordeUpdate(); return; }
    const alive = w.enemiesAlive();

    // Si el MegaBoss ha muerto, los refuerzos de las fases que no llegó a pedir ya no vienen.
    if (this.boss && this.boss.kind === 'megaboss' && !this.boss.alive) this.bossReserve = 0;
    // MegaBoss: el escudo cae cuando la oleada de refuerzos está casi liquidada (o a los 45 s)
    if (this.boss && this.boss.kind === 'megaboss' && this.boss.alive && this.boss.shielded) {
      const others = alive - 1;
      if ((this.qBoss.length === 0 && others <= 3) || w.time - this.shieldAt > 45) this.boss.shielded = false;
    }
    // Un MegaBoss creado con la consola no tiene refuerzos que esperar: su escudo dura 6 s.
    for (const e of w.entities) {
      if (e !== this.boss && e.kind === 'megaboss' && e.alive && e.shielded && w.time - this.shieldAt > 6) e.shielded = false;
    }

    // defensa del servidor (fase 'hold'): oleadas continuas repartidas en el tiempo; no hay fases del ritmo normal
    if (this.holding) {
      if (w.time >= this.tryAt) {
        this.tryAt = w.time + 0.5;
        const due = Math.ceil(this.holdN0 * Math.min(1, (w.time - this.holdAt) / OBJECTIVE.defendSpreadOver));
        const k = due - (this.holdN0 - this.holdQ.length);
        if (k > 0 && alive < ALIVE_CAP) this.release(this.holdQ, Math.min(3, k), true);
      }
      return;
    }
    if (w.time >= this.tryAt) {
      this.tryAt = w.time + 0.5;
      if (this.qBoss.length > 0) this.release(this.qBoss, 4, true);
      else if (this.qAsc.length > 0) {
        if (w.time >= this.nextWaveAt || alive <= 2) {
          if (this.release(this.qAsc, 2 + Math.floor(w.rng() * 3), false)) { this.nextWaveAt = w.time + 9 + w.rng() * 6; this.ascSpawned += 3; }
        }
      } else if (w.pacing === 'ascenso' && !this.cfg.megaboss) {
        if (this.ascEmptyAt < 0) this.ascEmptyAt = w.time;
        const basics = this.boss && this.boss.alive ? alive - 1 : alive;
        if (basics <= Math.max(2, Math.round(this.ascSpawned * 0.3)) || w.time - this.ascEmptyAt > 30) {
          w.pacing = 'pico'; w.events.push({ type: 'phase', phase: 'pico' });
        }
      } else if (w.pacing === 'pico' && this.qPeak.length > 0) {
        // el grueso, de golpe y por varios sitios
        this.release(this.qPeak, 4 + Math.floor(w.rng() * 3), true);
        this.tryAt = w.time + 0.25;
      } else if (w.pacing === 'pico' && !this.cfg.megaboss) {
        const basics = this.boss && this.boss.alive ? alive - 1 : alive;
        if (basics <= Math.max(1, Math.round(this.peakTotal * 0.2))) {
          w.pacing = 'alivio'; w.events.push({ type: 'phase', phase: 'alivio' });
          this.reliefEvery = Math.max(2, 15 / Math.max(1, this.qRelief.length));
          this.nextReliefAt = w.time + 2;
        }
      } else if (w.pacing === 'alivio' && this.qRelief.length > 0 && w.time >= this.nextReliefAt) {
        if (this.release(this.qRelief, 1, true)) this.nextReliefAt = w.time + this.reliefEvery;
      }
    }

    // Una zona está limpia cuando no queda nada por soltar y no queda nadie vivo (§8).
    // (se vuelve a contar: en este mismo paso puede haberse soltado una oleada)
    // (con un objetivo especial —desactivar, defender, rescatar— no basta con eliminar a todos: lo decide el objetivo)
    if (w.objective.kind === 'clear' && this.pending() === 0 && w.enemiesAlive() === 0) {
      w.status = 'cleared';
      w.pacing = 'descanso';
      w.morale = Math.min(100, w.morale + 10);
      w.events.push({ type: 'phase', phase: 'descanso' });
      w.events.push({ type: 'cleared' });
    }
  }

  /**
   * El MegaBoss pelea por fases (§7): al cruzar 2/3 y 1/3 de vida se cubre con un escudo y pide refuerzos.
   * Devuelve el daño que realmente entra.
   */
  bossDamageGate(boss: Unit, amount: number): number {
    const w = this.w;
    if (boss.bossPhase >= 3) return amount;
    const thr = boss.maxHp * (boss.bossPhase === 1 ? 2 / 3 : 1 / 3);
    if (boss.hp - amount > thr) return amount;
    const real = Math.max(0, boss.hp - thr);
    boss.bossPhase++;
    boss.shielded = true;
    this.shieldAt = w.time;
    this.shieldWave++;
    const n = Math.min(this.bossReserve, this.cfg.reinforcements);
    this.bossReserve -= n;
    this.qBoss.push(...this.slots(n));
    this.tryAt = 0; this.failSince = -1;
    w.events.push({ type: 'bossPhase', id: boss.id, phase: boss.bossPhase });
    if (real > 0) { boss.hp = thr + real; } // el daño que cabía hasta el umbral se aplica fuera
    return real;
  }
}
