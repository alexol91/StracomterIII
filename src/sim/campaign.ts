// Campaña: estado entre plantas, recompensas, ajuste de dificultad y guardado (§4, §8, §12, §19).

import type { CampaignState, Difficulty, Grade, ICampaign, IWorld, KVStorage, MemberState, RecordEntry, ZoneInfo, ZoneSummary } from '../contracts';
import {
  AMMO_CAP, AMMO_START, CLASS_STATS, DIFFICULTY_MULT, ENEMY_COUNT, ENEMY_MIX, INVENTORY_SLOTS, ITEM_EFFECT, UPGRADES, ZONE_REWARD, ZONE_SIZE,
  computeMods, maxHpFor,
} from './data';
import type { DirectorConfig } from './director';
import { getMap } from './maps';
import { CLASS_IDS, type ClassId, type ItemType, type MapDef } from './types';
import { World, mulberry32 } from './world';

const SAVE_KEY = 'stracomter3.save';
const RECORDS_KEY = 'stracomter3.records';
const SIZE_IDX = { pequeno: 0, mediano: 1, grande: 2 } as const;

function freshMembers(): Record<ClassId, MemberState> {
  const m = {} as Record<ClassId, MemberState>;
  for (const c of CLASS_IDS) m[c] = { hp: CLASS_STATS[c].hp, ammo: AMMO_START, inv: [null, null, null, null, null] };
  return m;
}

function polyArea(p: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return Math.abs(a) / 2;
}

/** Enemigos básicos de una zona. La tabla del §8 es la de Normal; Fácil y Difícil escalan respecto a ella (1,0 / 1,3 / 1,5). */
export function enemyTotal(floor: number, size: 'pequeno' | 'mediano' | 'grande', difficulty: Difficulty, adapt: number): number {
  const base = floor >= 9 ? 6 : ENEMY_COUNT[floor][SIZE_IDX[size]];
  const diff = DIFFICULTY_MULT[difficulty] / DIFFICULTY_MULT.normal;
  return Math.max(3, Math.round(base * diff * (1 + 0.1 * Math.max(-3, Math.min(3, adapt)))));
}

export function directorConfig(state: CampaignState, floor: number, size: 'pequeno' | 'mediano' | 'grande'): DirectorConfig {
  const diff = DIFFICULTY_MULT[state.difficulty] / DIFFICULTY_MULT.normal;
  // Compensación por compañeros caídos (son permanentes): un 12 % menos de enemigos por cada uno.
  // Sin esto, perder a la escuadra a mitad de campaña la convierte en imposible.
  const dead = CLASS_IDS.filter(c => state.members[c].hp <= 0).length;
  // Piedad: tras tres derrotas seguidas en la misma planta, cada intento más quita otro 15 % (hasta la mitad).
  const mercy = Math.max(0.5, 1 - 0.15 * Math.max(0, (state.retries ?? 0) - 2));
  const solo = (1 - 0.12 * dead) * mercy;
  return {
    total: Math.max(3, Math.round(enemyTotal(floor, size, state.difficulty, state.adapt) * solo)),
    mix: ENEMY_MIX[floor],
    miniboss: floor >= 2 && floor <= 8,
    megaboss: floor === 9,
    reinforcements: Math.max(4, Math.round(12 * diff * (1 + 0.1 * state.adapt) * solo)),
    tactics: floor >= 2 ? 1 : 0,
  };
}

/**
 * Ajuste dinámico (§8): compara con una referencia FIJA (tiempo esperado según el tamaño del encuentro),
 * nunca con la media del propio jugador. Devuelve -1, 0 o +1: como mucho un escalón por zona.
 */
export function adaptStep(world: IWorld, enemies: number): number {
  const s = world.stats;
  const expected = 30 + 7 * enemies; // segundos
  let score = 0;
  const speed = expected / Math.max(1, s.time);
  if (speed > 1.25) score++; else if (speed < 0.7) score--;
  const acc = s.shotsFired > 0 ? s.shotsHit / s.shotsFired : 0;
  if (acc > 0.4) score++; else if (acc < 0.15) score--;
  const hurt = s.damageTaken / world.player.maxHp;
  if (hurt < 0.35) score++; else if (hurt > 1.0) score--;
  if (s.alliesLost === 0) score++; else score -= s.alliesLost;
  return score >= 2 ? 1 : score <= -2 ? -1 : 0;
}

/** Nota de la planta (v1.2): 0-100 y desglose [clave i18n, puntos, máximo]. Pura: solo mira las estadísticas de la zona. */
export function gradeZone(stats: IWorld['stats'], playerMaxHp: number): { score: number; grade: Grade; breakdown: [string, number, number][] } {
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const acc = stats.shotsFired > 0 ? stats.shotsHit / stats.shotsFired : 0;
  const pAcc = 25 * clamp01((acc - 0.10) / 0.35);
  const hurt = stats.damageTaken / Math.max(1, playerMaxHp);
  const pDmg = 25 * clamp01((1.5 - hurt) / 1.3);
  const ref = 30 + 7 * Math.max(1, stats.kills);       // referencia fija según el número de enemigos
  const tr = stats.time / ref;
  const pTime = 25 * clamp01((2.2 - tr) / 1.4);
  const pSquad = Math.max(0, 15 - 7 * stats.alliesLost);
  const hs = stats.shotsHit > 0 ? (stats.headshots ?? 0) / stats.shotsHit : 0;
  const pHead = 10 * clamp01(hs / 0.30);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const total = pAcc + pDmg + pTime + pSquad + pHead;
  const score = Math.round(total);
  const grade: Grade = score >= 90 ? 'S' : score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D';
  return {
    score, grade,
    breakdown: [['grade.accuracy', r1(pAcc), 25], ['grade.damage', r1(pDmg), 25], ['grade.time', r1(pTime), 25], ['grade.squad', r1(pSquad), 15], ['grade.headshots', r1(pHead), 10]],
  };
}

/** Tres mejoras distintas que aún no se tienen, elegidas de forma determinista (semilla: planta + puntuación). */
export function pickUpgradeChoices(have: readonly string[], floor: number, score: number): string[] {
  const pool = UPGRADES.map(u => u.id).filter(id => !have.includes(id));
  const rng = mulberry32(floor * 7919 + Math.round(score) * 31 + 17);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, 3);
}

export function createCampaign(storage: KVStorage, now: () => Date = () => new Date()): ICampaign {
  const readRecords = (): Record<string, RecordEntry> => {
    try {
      const raw = storage.getItem(RECORDS_KEY);
      if (!raw) return {};
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? o as Record<string, RecordEntry> : {};
    } catch { return {}; }
  };

  const zonesOf = (floor: number): ZoneInfo[] => {
    const out: ZoneInfo[] = [];
    const n = floor === 9 ? 1 : 6;
    for (let z = 1; z <= n; z++) {
      const size = floor === 9 ? 'grande' : ZONE_SIZE[z - 1];
      const map: MapDef = getMap(floor, size);
      out.push({
        floor, zone: z, map, size, reward: floor === 9 ? 'vida_100' : ZONE_REWARD[z - 1], diafano: !!map.diafano,
        hasMiniBoss: floor >= 2 && floor <= 8, hasMegaBoss: floor === 9, areaM2: Math.round(polyArea(map.perimetro)),
      });
    }
    return out;
  };

  const self: ICampaign = {
    newCampaign(difficulty, controlled) {
      return { version: 1, floor: 1, controlled, score: 0, members: freshMembers(), difficulty, adapt: 0, upgrades: [] };
    },
    newQuickPlay(difficulty, controlled, floor) {
      return { version: 1, floor: Math.max(1, Math.min(9, floor | 0)), controlled, score: 0, members: freshMembers(), difficulty, adapt: 0, quick: true, upgrades: [] };
    },
    zonesOf,
    startZone(state, zone) {
      const zs = zonesOf(state.floor);
      const zi = zs[Math.max(0, Math.min(zs.length - 1, zone - 1))];
      // no se puede controlar a un muerto: pasa al primer superviviente
      let controlled = state.controlled;
      if (state.members[controlled].hp <= 0) controlled = CLASS_IDS.find(c => state.members[c].hp > 0) ?? controlled;
      // Piedad (misma regla): a partir de la tercera derrota seguida se entra con la vida llena y al menos 120 balas.
      let members = state.members;
      if ((state.retries ?? 0) >= 3) {
        members = JSON.parse(JSON.stringify(state.members)) as typeof state.members;
        for (const c of CLASS_IDS) if (members[c].hp > 0) { members[c].hp = maxHpFor(c, state.upgrades); members[c].ammo = Math.max(members[c].ammo, 120); }
      }
      return new World({
        map: zi.map, floor: state.floor, zone: zi.zone, controlled,
        members, director: directorConfig(state, state.floor, zi.size),
        baseScore: state.score, upgrades: (state.upgrades ?? []).slice(),
        seed: state.floor * 1000 + zi.zone * 37 + (state.score % 97) + (state.adapt + 3) * 131 + (state.retries ?? 0) * 17,
      });
    },
    completeZone(state, world) {
      const w = world as World;
      const snap = w.memberSnapshot();
      const fallen: ClassId[] = [];
      for (const c of CLASS_IDS) {
        const before = state.members[c];
        const now = snap[c];
        if (before.hp > 0 && (!now || now.hp <= 0)) { fallen.push(c); state.members[c] = { hp: 0, ammo: 0, inv: [null, null, null, null, null] }; }
        else if (now && now.hp > 0) state.members[c] = { hp: now.hp, ammo: now.ammo, inv: now.inv.slice(0, INVENTORY_SLOTS) };
      }
      if (state.members[state.controlled].hp <= 0) state.controlled = w.player.cls ?? state.controlled;
      const zs = zonesOf(world.floor);
      const zi = zs[Math.max(0, Math.min(zs.length - 1, world.zone - 1))];
      const reward: ItemType = zi.reward;
      const rewarded: ClassId[] = [];
      // la recompensa la recibe cada superviviente y entra en su inventario (si no cabe, se aplica)
      for (const c of CLASS_IDS) {
        const m = state.members[c];
        if (m.hp <= 0) continue;
        rewarded.push(c);
        const free = m.inv.indexOf(null);
        if (free >= 0) m.inv[free] = reward;
        else {
          const e = ITEM_EFFECT[reward];
          const lm = computeMods(state.upgrades).lootMult;
          m.hp = Math.min(maxHpFor(c, state.upgrades), m.hp + Math.round(e.hp * lm));
          m.ammo = Math.min(AMMO_CAP, m.ammo + Math.round(e.ammo * lm));
        }
      }
      state.score += world.stats.scoreGained;
      state.adapt = Math.max(-3, Math.min(3, state.adapt + adaptStep(world, enemyTotal(world.floor, zi.size, state.difficulty, state.adapt))));
      state.retries = 0;
      const campaignWon = world.floor >= 9;
      // v1.2: nota y récord (no puntúa si se usaron trucos)
      const g = gradeZone(world.stats, w.player.maxHp);
      if (w.cheated) state.cheated = true;
      let newRecord = false;
      if (!w.cheated && !state.cheated && !state.quick) { // la partida rápida no escribe nada en el almacenamiento
        const recs = readRecords();
        const key = `${state.difficulty}:${world.floor}`;
        const old = recs[key];
        if (!old || g.score > old.score) {
          recs[key] = { grade: g.grade, score: g.score, time: Math.round(world.stats.time), date: now().toISOString().slice(0, 10) };
          try { storage.setItem(RECORDS_KEY, JSON.stringify(recs)); } catch { /* almacenamiento lleno o bloqueado */ }
          newRecord = true;
        }
      }
      const upgradeChoices = campaignWon || state.quick ? [] : pickUpgradeChoices(state.upgrades ?? [], world.floor, state.score);
      state.floor = world.floor + 1;
      if (!state.quick) { if (campaignWon) self.clearSave(); else self.save(state); }
      return {
        floor: world.floor, zone: world.zone, stats: { ...world.stats }, reward, rewarded, fallen, totalScore: state.score, campaignWon,
        grade: g.grade, gradeScore: g.score, gradeBreakdown: g.breakdown, newRecord, upgradeChoices,
      };
    },
    failZone(state) {
      // «si va ahogado, baja»: morir es la señal más clara. Un escalón por intento.
      state.adapt = Math.max(-3, state.adapt - 1);
      state.retries = (state.retries ?? 0) + 1;
      if (!state.quick) self.save(state);
    },
    chooseUpgrade(state, id) {
      const def = UPGRADES.find(u => u.id === id);
      if (!def) return;
      state.upgrades = state.upgrades ?? [];
      if (state.upgrades.includes(id)) return;
      state.upgrades.push(id);
      // vigor: la vida máxima sube 20 y los supervivientes curan 20 (sin pasar del nuevo máximo)
      if (id === 'vigor') for (const c of CLASS_IDS) { const m = state.members[c]; if (m.hp > 0) m.hp = Math.min(maxHpFor(c, state.upgrades), m.hp + 20); }
      if (!state.quick) self.save(state);
    },
    records() { return readRecords(); },
    save(state) {
      if (state.quick) return;
      try { storage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* almacenamiento lleno o bloqueado */ }
    },
    load() {
      try {
        const raw = storage.getItem(SAVE_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw) as CampaignState;
        if (!s || s.version !== 1 || !(s.floor >= 1 && s.floor <= 9) || !s.members) return null;
        for (const c of CLASS_IDS) {
          const m = s.members[c];
          if (!m || typeof m.hp !== 'number' || !Array.isArray(m.inv)) return null;
          while (m.inv.length < INVENTORY_SLOTS) m.inv.push(null);
        }
        if (!CLASS_IDS.some(c => s.members[c].hp > 0)) return null;
        if (!Array.isArray(s.upgrades)) s.upgrades = []; // partidas guardadas antiguas
        return s;
      } catch { return null; }
    },
    hasSave() { return self.load() !== null; },
    clearSave() { try { storage.removeItem(SAVE_KEY); } catch { /* nada */ } },
  };
  return self;
}
