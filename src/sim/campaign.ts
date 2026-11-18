// Campaña: estado entre plantas, recompensas, ajuste de dificultad y guardado (§4, §8, §12, §19).

import type { CampaignState, Difficulty, ICampaign, IWorld, KVStorage, MemberState, ZoneInfo, ZoneSummary } from '../contracts';
import {
  AMMO_CAP, AMMO_START, CLASS_STATS, DIFFICULTY_MULT, ENEMY_COUNT, ENEMY_MIX, INVENTORY_SLOTS, ITEM_EFFECT, ZONE_REWARD, ZONE_SIZE,
} from './data';
import type { DirectorConfig } from './director';
import { getMap } from './maps';
import { CLASS_IDS, type ClassId, type ItemType, type MapDef } from './types';
import { World } from './world';

const SAVE_KEY = 'stracomter3.save';
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
  return {
    total: enemyTotal(floor, size, state.difficulty, state.adapt),
    mix: ENEMY_MIX[floor],
    miniboss: floor >= 2 && floor <= 8,
    megaboss: floor === 9,
    reinforcements: Math.round(12 * diff * (1 + 0.1 * state.adapt)),
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

export function createCampaign(storage: KVStorage): ICampaign {
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
      return { version: 1, floor: 1, controlled, score: 0, members: freshMembers(), difficulty, adapt: 0 };
    },
    newQuickPlay(difficulty, controlled, floor) {
      return { version: 1, floor: Math.max(1, Math.min(9, floor | 0)), controlled, score: 0, members: freshMembers(), difficulty, adapt: 0, quick: true };
    },
    zonesOf,
    startZone(state, zone) {
      const zs = zonesOf(state.floor);
      const zi = zs[Math.max(0, Math.min(zs.length - 1, zone - 1))];
      // no se puede controlar a un muerto: pasa al primer superviviente
      let controlled = state.controlled;
      if (state.members[controlled].hp <= 0) controlled = CLASS_IDS.find(c => state.members[c].hp > 0) ?? controlled;
      return new World({
        map: zi.map, floor: state.floor, zone: zi.zone, controlled,
        members: state.members, director: directorConfig(state, state.floor, zi.size),
        seed: state.floor * 1000 + zi.zone * 37 + (state.score % 97),
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
          m.hp = Math.min(CLASS_STATS[c].hp, m.hp + e.hp);
          m.ammo = Math.min(AMMO_CAP, m.ammo + e.ammo);
        }
      }
      state.score += world.stats.scoreGained;
      state.adapt = Math.max(-3, Math.min(3, state.adapt + adaptStep(world, enemyTotal(world.floor, zi.size, state.difficulty, state.adapt))));
      const campaignWon = world.floor >= 9;
      state.floor = world.floor + 1;
      if (!state.quick) { if (campaignWon) self.clearSave(); else self.save(state); }
      return { floor: world.floor, zone: world.zone, stats: { ...world.stats }, reward, rewarded, fallen, totalScore: state.score, campaignWon };
    },
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
        return s;
      } catch { return null; }
    },
    hasSave() { return self.load() !== null; },
    clearSave() { try { storage.removeItem(SAVE_KEY); } catch { /* nada */ } },
  };
  return self;
}
