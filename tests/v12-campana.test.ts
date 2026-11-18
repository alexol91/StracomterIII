// Pruebas v1.2: elección de mejoras, nota de planta, récords y trucos que invalidan la partida.
//
// QUÉ MODOS DE FALLO NO CUBRE ESTE FICHERO:
//  - La nota se prueba con estadísticas fabricadas (casos extremos y umbrales) y con una zona real limpiada «a golpe de
//    kill» (clearZone), no con una partida jugada: no valida que las notas sean razonables para una persona (eso se
//    mira con el bot en tools/partida.ts, que NO es una persona).
//  - Los récords usan un KVStorage en memoria y un reloj inyectado; no se prueba localStorage real (cuota llena, modo
//    privado…) más allá de que un fallo al escribir no rompe completeZone.
//  - El flujo «elegir mejora → siguiente planta» se prueba con el estado de la campaña, no con las pantallas.
//  - No se prueba que la interfaz ponga world.cheated/state.cheated a la vista: sólo que la simulación los marca.

import { describe, expect, it } from 'vitest';
import { createCampaign, gradeZone, pickUpgradeChoices } from '../src/sim/campaign';
import { UPGRADES } from '../src/sim/data';
import type { ZoneStats } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { campaignWorld, clearZone, exec, memStorage, quickWorld } from './helpers';

const stats = (o: Partial<ZoneStats> = {}): ZoneStats => ({
  time: 100, kills: 20, shotsFired: 100, shotsHit: 30, damageTaken: 100, alliesLost: 0, scoreGained: 0, headshots: 0, bestStreak: 0, ...o,
});

describe('v1.2 · elección de mejoras', () => {
  it('completeZone devuelve 3 mejoras distintas y deterministas que aún no se tienen', () => {
    const a = campaignWorld(1, 1);
    clearZone(a.world);
    a.state.upgrades = ['mag+', 'vigor'];
    const sum = a.campaign.completeZone(a.state, a.world);
    const ch = sum.upgradeChoices!;
    expect(ch).toHaveLength(3);
    expect(new Set(ch).size).toBe(3);
    for (const id of ch) { expect(UPGRADES.some(u => u.id === id)).toBe(true); expect(['mag+', 'vigor']).not.toContain(id); }
    // misma planta y misma puntuación → mismas opciones (determinista)
    expect(pickUpgradeChoices(['mag+', 'vigor'], 1, a.state.score)).toEqual(ch);
    // otra puntuación → (casi seguro) otras
    expect(pickUpgradeChoices(['mag+', 'vigor'], 1, a.state.score + 1).join()).not.toBe(ch.join());
    // y otra campaña idéntica da lo mismo
    const b = campaignWorld(1, 1);
    clearZone(b.world);
    b.state.upgrades = ['mag+', 'vigor'];
    expect(b.campaign.completeZone(b.state, b.world).upgradeChoices).toEqual(ch);
  });

  it('chooseUpgrade añade la mejora válida, ignora las inválidas y repetidas, y guarda; la siguiente oferta no la repite', () => {
    const f = campaignWorld(1, 1);
    clearZone(f.world);
    const ch = f.campaign.completeZone(f.state, f.world).upgradeChoices!;
    f.campaign.chooseUpgrade(f.state, 'no-existe');
    expect(f.state.upgrades).toEqual([]);
    f.campaign.chooseUpgrade(f.state, ch[0]);
    f.campaign.chooseUpgrade(f.state, ch[0]);
    expect(f.state.upgrades).toEqual([ch[0]]);
    expect(f.campaign.load()!.upgrades).toEqual([ch[0]]);
    // el mundo de la siguiente zona nace con la mejora aplicada
    const w = f.campaign.startZone(f.state, 1) as World;
    expect(w.mods).not.toEqual((quickWorld(1, 1).world as World).mods);
    // y no vuelve a salir
    expect(pickUpgradeChoices(f.state.upgrades!, 2, 500)).not.toContain(ch[0]);
    // ofertas sucesivas hasta agotarlas: nunca repiten
    const tengo: string[] = [];
    for (let i = 0; i < 6; i++) { const o = pickUpgradeChoices(tengo, 1 + i, i * 100); expect(o).toHaveLength(3); for (const id of o) expect(tengo).not.toContain(id); tengo.push(o[0]); }
  });

  it('no hay mejoras en la planta 9 ni en partida rápida; una partida guardada antigua sin campo se carga con []', () => {
    const f = campaignWorld(9, 1);
    clearZone(f.world);
    expect(f.campaign.completeZone(f.state, f.world).upgradeChoices).toEqual([]);
    const q = quickWorld(1, 1);
    clearZone(q.world);
    expect(q.campaign.completeZone(q.state, q.world).upgradeChoices).toEqual([]);
    // guardado sin upgrades
    const st = memStorage();
    const c = createCampaign(st);
    const s = c.newCampaign('normal', 'captain');
    delete (s as any).upgrades;
    st.setItem('stracomter3.save', JSON.stringify(s));
    expect(c.load()!.upgrades).toEqual([]);
  });
});

describe('v1.2 · nota de la planta', () => {
  it('una zona perfecta es S (100) y una desastrosa es D (0), con el desglose de claves esperado', () => {
    const top = gradeZone(stats({ shotsFired: 100, shotsHit: 60, headshots: 30, damageTaken: 0, time: 20, kills: 20, alliesLost: 0 }), 160);
    expect(top.score).toBe(100);
    expect(top.grade).toBe('S');
    expect(top.breakdown.map(b => b[0])).toEqual(['grade.accuracy', 'grade.damage', 'grade.time', 'grade.squad', 'grade.headshots']);
    expect(top.breakdown.map(b => b[2])).toEqual([25, 25, 25, 15, 10]);
    expect(top.breakdown.reduce((a, b) => a + b[1], 0)).toBeCloseTo(100, 6);
    const mala = gradeZone(stats({ shotsFired: 100, shotsHit: 5, headshots: 0, damageTaken: 400, time: 2000, kills: 20, alliesLost: 3 }), 160);
    expect(mala.score).toBe(0);
    expect(mala.grade).toBe('D');
    expect(mala.breakdown.every(b => b[1] === 0)).toBe(true);
  });

  it('cada componente respeta sus umbrales (precisión 10-45 %, daño 20-150 %, tiempo 0,8-2,2×, compañeros −7, cabezas 30 %)', () => {
    const b = (o: Partial<ZoneStats>) => Object.fromEntries(gradeZone(stats(o), 160).breakdown.map(([k, v]) => [k, v]));
    expect(b({ shotsFired: 100, shotsHit: 10 })['grade.accuracy']).toBe(0);
    expect(b({ shotsFired: 100, shotsHit: 45 })['grade.accuracy']).toBe(25);
    expect(b({ shotsFired: 100, shotsHit: 27.5 })['grade.accuracy']).toBeCloseTo(12.5, 1);
    expect(b({ shotsFired: 0, shotsHit: 0 })['grade.accuracy']).toBe(0);
    expect(b({ damageTaken: 32 })['grade.damage']).toBe(25);          // 20 % de 160
    expect(b({ damageTaken: 240 })['grade.damage']).toBe(0);          // 150 %
    const ref = 30 + 7 * 20;
    expect(b({ time: ref * 0.8 })['grade.time']).toBe(25);
    expect(b({ time: ref * 2.2 })['grade.time']).toBe(0);
    expect(b({ alliesLost: 0 })['grade.squad']).toBe(15);
    expect(b({ alliesLost: 1 })['grade.squad']).toBe(8);
    expect(b({ alliesLost: 3 })['grade.squad']).toBe(0);
    expect(b({ shotsHit: 30, headshots: 9 })['grade.headshots']).toBe(10);
    expect(b({ shotsHit: 30, headshots: 4.5 })['grade.headshots']).toBeCloseTo(5, 1);
  });

  it('los umbrales de letra son S ≥ 90, A ≥ 75, B ≥ 60, C ≥ 40, D (a ambos lados de cada umbral)', () => {
    // base sin precisión: daño 25 + tiempo 25 + escuadra 15 = 65; la precisión (25 puntos lineales entre 10 % y 45 %) afina.
    const buena = { damageTaken: 0, time: 20, kills: 20, alliesLost: 0, shotsFired: 100, headshots: 0 };
    const g = (o: Partial<ZoneStats>) => gradeZone(stats({ ...buena, ...o }), 160);
    expect(g({ shotsHit: 45 })).toMatchObject({ score: 90, grade: 'S' });
    expect(g({ shotsHit: 44 })).toMatchObject({ score: 89, grade: 'A' });
    expect(g({ shotsHit: 24 })).toMatchObject({ score: 75, grade: 'A' });
    expect(g({ shotsHit: 23 })).toMatchObject({ score: 74, grade: 'B' });
    expect(g({ shotsHit: 10 })).toMatchObject({ score: 65, grade: 'B' });
    // sin compañeros vivos (squad 0) y con la vida a cero (damage 0) la base baja a 25
    const floja = { ...buena, alliesLost: 3, damageTaken: 400 };
    expect(g({ ...floja, shotsHit: 31 })).toMatchObject({ score: 40, grade: 'C' });
    expect(g({ ...floja, shotsHit: 30 })).toMatchObject({ score: 39, grade: 'D' });
    expect(g({ ...floja, alliesLost: 1, shotsHit: 10 })).toMatchObject({ score: 33, grade: 'D' });
    const medio = { ...buena, alliesLost: 3 };            // base 50
    expect(g({ ...medio, shotsHit: 10 })).toMatchObject({ score: 50, grade: 'C' });
    expect(g({ ...medio, shotsHit: 10, headshots: 0 }).grade).toBe('C');
    // 59 / 60
    expect(g({ ...medio, shotsHit: 24, headshots: 0 }).score).toBe(60);
    expect(g({ ...medio, shotsHit: 24 }).grade).toBe('B');
    expect(g({ ...medio, shotsHit: 23 }).grade).toBe('C');
  });

  it('completeZone trae gradeScore, grade y desglose coherentes', () => {
    const f = campaignWorld(1, 1);
    clearZone(f.world);
    f.world.stats.shotsFired = 100; f.world.stats.shotsHit = 50; f.world.stats.damageTaken = 0; f.world.stats.alliesLost = 0;
    const s = f.campaign.completeZone(f.state, f.world);
    expect(s.gradeScore).toBeGreaterThan(40);
    expect(['S', 'A', 'B', 'C', 'D']).toContain(s.grade);
    expect(s.gradeBreakdown).toHaveLength(5);
    expect(Math.round(s.gradeBreakdown!.reduce((a, b) => a + b[1], 0))).toBe(s.gradeScore);
  });
});

describe('v1.2 · récords', () => {
  const nueva = () => {
    const storage = memStorage();
    const campaign = createCampaign(storage, () => new Date('2026-05-04T22:00:00Z'));
    const state = campaign.newCampaign('normal', 'captain');
    return { storage, campaign, state };
  };
  const jugar = (f: ReturnType<typeof nueva>, ajuste: Partial<ZoneStats>) => {
    const w = f.campaign.startZone(f.state, 1) as World;
    clearZone(w);
    Object.assign(w.stats, ajuste);
    return { w, sum: f.campaign.completeZone(f.state, w) };
  };

  it('se guarda el primero, no empeora con una nota peor y mejora con una mejor', () => {
    const f = nueva();
    const buena = { shotsFired: 100, shotsHit: 25, damageTaken: 100, time: 150, kills: 20, headshots: 2 };
    const a = jugar(f, buena);
    expect(a.sum.newRecord).toBe(true);
    const r1 = f.campaign.records()['normal:1'];
    expect(r1).toEqual({ grade: a.sum.grade, score: a.sum.gradeScore, time: 150, date: '2026-05-04' });
    expect(JSON.parse(f.storage.getItem('stracomter3.records')!)['normal:1'].score).toBe(r1.score);
    // peor
    f.state.floor = 1;
    const b = jugar(f, { shotsHit: 11, damageTaken: 240, time: 400, headshots: 0 });
    expect(b.sum.gradeScore!).toBeLessThan(r1.score);
    expect(b.sum.newRecord).toBe(false);
    expect(f.campaign.records()['normal:1']).toEqual(r1);
    // mejor
    f.state.floor = 1;
    const c = jugar(f, { shotsHit: 60, damageTaken: 0, headshots: 30, time: 30 });
    expect(c.sum.gradeScore!).toBeGreaterThan(r1.score);
    expect(c.sum.newRecord).toBe(true);
    expect(f.campaign.records()['normal:1'].score).toBe(c.sum.gradeScore);
    // otra dificultad u otra planta son claves distintas
    expect(Object.keys(f.campaign.records())).toEqual(['normal:1']);
  });

  it('con trucos no se guarda récord, y la campaña queda marcada (state.cheated) para las plantas siguientes', () => {
    const f = nueva();
    const w = f.campaign.startZone(f.state, 1) as World;
    exec(w, 'god');
    expect(w.cheated).toBe(true);
    clearZone(w);
    const s = f.campaign.completeZone(f.state, w);
    expect(s.newRecord).toBe(false);
    expect(f.campaign.records()).toEqual({});
    expect(f.storage.getItem('stracomter3.records')).toBeNull();
    expect(f.state.cheated).toBe(true);
    // la siguiente planta, jugada limpia, tampoco puntúa
    const w2 = f.campaign.startZone(f.state, 1) as World;
    expect(w2.cheated).toBe(false);
    clearZone(w2);
    expect(f.campaign.completeZone(f.state, w2).newRecord).toBe(false);
    expect(f.campaign.records()).toEqual({});
  });

  it('todos los comandos que alteran la partida activan world.cheated; help, info y ai.debug no', () => {
    for (const cmd of ['help', 'info', 'ai.debug']) {
      const { world } = quickWorld(1, 1);
      exec(world, cmd);
      expect(world.cheated, cmd).toBe(false);
    }
    for (const cmd of ['god', 'noclip', 'ammo', 'health', 'spawn enemy1', 'team enemy1', 'kill bad', 'kill all', 'tp 5 5', 'chutaos on', 'floor 2', 'zone 2']) {
      const { world } = quickWorld(1, 1);
      exec(world, cmd);
      expect(world.cheated, cmd).toBe(true);
    }
  });

  it('un almacenamiento que falla no rompe completeZone', () => {
    const storage = memStorage();
    storage.setItem = () => { throw new Error('lleno'); };
    const campaign = createCampaign(storage);
    const state = campaign.newCampaign('normal', 'captain');
    const w = campaign.startZone(state, 1) as World;
    clearZone(w);
    expect(() => campaign.completeZone(state, w)).not.toThrow();
  });
});
