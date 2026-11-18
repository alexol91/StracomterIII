// Director: cuántos enemigos, de qué tipo, dónde y cuándo aparecen (§8 y §9), el jefe y las fases del MegaBoss.

import type { Squad } from './ai_enemy';
import { CELL } from './level';
import type { EnemyKind, Vec2 } from './types';
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
}

interface SpawnCand { x: number; y: number; access: boolean }

/** máximo de enemigos vivos a la vez; el resto espera turno */
const ALIVE_CAP = 44;

export class Director {
  private qAsc: EnemyKind[] = [];
  private qPeak: EnemyKind[] = [];
  private qRelief: EnemyKind[] = [];
  private qBoss: EnemyKind[] = []; // refuerzos del MegaBoss ya liberados
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

  constructor(private w: World, private cfg: DirectorConfig) {}

  pending(): number {
    return this.qAsc.length + this.qPeak.length + this.qRelief.length + this.qBoss.length + this.bossReserve;
  }

  private kinds(n: number): EnemyKind[] {
    const mix = this.cfg.mix;
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

  begin(): void {
    const w = this.w, cfg = this.cfg;
    w.enemyAI.tactics = cfg.tactics;
    this.buildCandidates();
    const all = this.kinds(cfg.total);
    const [bx, by] = w.level.map.punto_jefe;

    if (cfg.megaboss) {
      const c = w.level.nearestFree(bx, by, true, 20);
      const boss = w.spawnUnit('megaboss', w.level.cellX(c), w.level.cellY(c), false);
      this.boss = boss;
      const s = w.enemyAI.newSquad([boss.x, boss.y], false);
      s.route = this.routeAround([boss.x, boss.y], 3, 7);
      w.enemyAI.join(boss, s);
      this.bossReserve = cfg.reinforcements * 2;
      // escolta inicial
      this.qAsc = [];
      this.placeInitial(all, 3);
      w.pacing = 'pico';
      return;
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
        const s = w.enemyAI.newSquad([boss.x, boss.y], false);
        s.route = this.routeAround([boss.x, boss.y], 2, 5);
        w.enemyAI.join(boss, s);
      }
    }
    this.nextWaveAt = 10;
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

  private spawnGroup(kinds: EnemyKind[], at: Vec2, hunt: boolean, routeRadius: number): Squad {
    const w = this.w, L = w.level;
    const s = w.enemyAI.newSquad(at, hunt);
    if (!hunt) s.route = this.routeAround(at, 3, routeRadius);
    let k = 0;
    for (const kind of kinds) {
      let cell = -1;
      for (let t = 0; t < 12 && cell < 0; t++) {
        const a = (k * 2.4) + t, r = 0.6 + 0.45 * Math.sqrt(k + t);
        const c = L.cellOf(at[0] + Math.cos(a) * r, at[1] + Math.sin(a) * r);
        if (c >= 0 && L.passable(c, true) && !L.doorCell[c]) cell = c;
      }
      if (cell < 0) cell = L.nearestFree(at[0], at[1], true);
      const u = w.spawnUnit(kind, L.cellX(cell), L.cellY(cell), w.time > 0);
      w.enemyAI.join(u, s);
      k++;
    }
    s.initial = s.members.length;
    this.recent.push(at);
    if (this.recent.length > 4) this.recent.shift();
    return s;
  }

  private placeInitial(kinds: EnemyKind[], groupSize: number): void {
    let i = 0;
    while (i < kinds.length) {
      const n = Math.min(kinds.length - i, groupSize + (this.w.rng() < 0.4 ? 1 : 0));
      let at: Vec2 | null = null;
      for (let relax = 0; relax <= 6 && !at; relax++) at = this.pickSpawn(relax);
      if (!at) at = this.w.level.map.punto_jefe;
      this.spawnGroup(kinds.slice(i, i + n), at, false, 12);
      i += n;
    }
  }

  /** Intenta soltar un grupo por un acceso. Devuelve false si ahora mismo no hay sitio justo. */
  private release(q: EnemyKind[], n: number, hunt: boolean): boolean {
    const w = this.w;
    const room = ALIVE_CAP - w.enemiesAlive();
    n = Math.min(n, q.length, room);
    if (n <= 0) return false;
    if (this.failSince < 0) this.failSince = w.time;
    const relax = Math.floor((w.time - this.failSince) / 3);
    const at = this.pickSpawn(relax);
    if (!at) return false;
    this.failSince = -1;
    const s = this.spawnGroup(q.splice(0, n), at, hunt, 10);
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
    const alive = w.enemiesAlive();

    // MegaBoss: el escudo cae cuando la oleada de refuerzos está casi liquidada (o a los 45 s)
    if (this.boss && this.boss.kind === 'megaboss' && this.boss.alive && this.boss.shielded) {
      const others = alive - 1;
      if ((this.qBoss.length === 0 && others <= 3) || w.time - this.shieldAt > 45) this.boss.shielded = false;
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
    if (this.pending() === 0 && w.enemiesAlive() === 0) {
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
    this.qBoss.push(...this.kinds(n));
    this.tryAt = 0; this.failSince = -1;
    w.events.push({ type: 'bossPhase', id: boss.id, phase: boss.bossPhase });
    if (real > 0) { boss.hp = thr + real; } // el daño que cabía hasta el umbral se aplica fuera
    return real;
  }
}
