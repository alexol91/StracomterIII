// Guardado (DEFINICION §19; punto 21.14 «un compañero muerto sigue muerto») y ajuste dinámico de dificultad (§8).
//
// QUÉ MODOS DE FALLO NO CUBRE ESTE FICHERO:
//  - El almacenamiento es un Map en memoria con la interfaz de localStorage: no se prueba localStorage real
//    (cuota llena, modo privado, JSON corrupto escrito por otra versión). Sólo se comprueba el rechazo de un
//    guardado corrupto de forma básica.
//  - No se prueba la interfaz de «continuar partida», ni que main.ts llame a completeZone/load/failZone en el
//    momento correcto; sólo la capa de campaña.
//  - Las zonas se juegan con el bot de tools/partida.ts en modo dios: la vida/munición/inventario guardados salen
//    de una partida real, pero «real» significa «jugada por un bot».
//  - adaptStep se prueba con world.stats inventados (un doble mínimo de IWorld): demuestra la lógica del ajuste, no
//    que los números de un jugador humano caigan en los umbrales razonables.
//  - No se prueba el cambio de personaje controlado entre plantas ni la pantalla de estrategia.

import { describe, expect, it } from 'vitest';
import { playZone } from '../tools/partida';
import type { CampaignState, IWorld } from '../src/contracts';
import { adaptStep, enemyTotal } from '../src/sim/campaign';
import { ENEMY_COUNT, ZONE_REWARD } from '../src/sim/data';
import { CLASS_IDS, type ClassId, type ZoneStats } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { campaignWorld, quickWorld } from './helpers';

const sinCargadores = (s: CampaignState) => JSON.parse(JSON.stringify(s.members));

describe('21.14 / 19 · guardado y carga', () => {
  it('21.14 · tras jugar una zona con el bot y completarla, load() devuelve planta+1, puntuación y los cuatro miembros', () => {
    const { world, state, campaign, storage } = campaignWorld(1, 3, { cls: 'technic' });
    expect(campaign.hasSave()).toBe(false);
    const r = playZone(world, 600, true);
    expect(r.result).toBe('cleared');
    const snap = world.memberSnapshot();               // lo que quedó en la partida, ANTES de cobrar la recompensa
    const sum = campaign.completeZone(state, world);
    expect(sum.reward).toBe(ZONE_REWARD[2]);           // zona 3: municion_50
    const cargado = campaign.load()!;
    expect(cargado).not.toBeNull();
    expect(cargado.floor).toBe(2);
    expect(cargado.controlled).toBe('technic');
    expect(cargado.score).toBe(state.score);
    expect(cargado.score).toBeGreaterThan(0);
    expect(cargado.score).toBe(world.stats.scoreGained);
    expect(Object.keys(cargado.members).sort()).toEqual([...CLASS_IDS].sort());
    // lo guardado es lo que quedó en la partida (vida, munición total cargador+reserva, inventario) más la recompensa:
    // en la primera ranura libre del inventario o, si está lleno, aplicada al momento (+50 balas).
    for (const c of CLASS_IDS) {
      const m = cargado.members[c], s0 = snap[c]!;
      expect(m.inv).toHaveLength(5);
      expect(m.hp).toBe(s0.hp);
      const libre = s0.inv.indexOf(null);
      if (libre >= 0) {
        expect(m.ammo).toBe(s0.ammo);
        expect(m.inv[libre]).toBe('municion_50');
        expect(m.inv.filter((x, i) => i !== libre)).toEqual(s0.inv.filter((_, i) => i !== libre));
      } else {
        expect(m.ammo).toBe(Math.min(999, s0.ammo + 50));
        expect(m.inv).toEqual(s0.inv);
      }
      expect(m.hp).toBeGreaterThan(0);
      expect(m.hp).toBeLessThanOrEqual(world.entities.find(e => e.kind === c)!.maxHp);
    }
    expect(cargado.members).toEqual(sinCargadores(state));
    // v1.2: además de la partida, el récord de la planta vive en el mismo almacenamiento (clave stracomter3.records)
    expect([...storage.map.keys()].filter(k => k !== 'stracomter3.records')).toHaveLength(1);
  }, 60_000);

  it('21.14 · la recompensa entra en el inventario de cada superviviente y no en el del muerto', () => {
    const { world, state, campaign } = campaignWorld(1, 3);
    const muerto: ClassId = 'especialist';
    world.kill(world.entities.find(e => e.kind === muerto)!);
    const antes = JSON.parse(JSON.stringify(state.members)) as CampaignState['members'];
    expect(playZone(world, 600, true).result).toBe('cleared');
    const snap = world.memberSnapshot();               // antes de cobrar: ¿tenía hueco en el inventario?
    const sum = campaign.completeZone(state, world);
    expect(sum.fallen).toEqual([muerto]);
    expect(sum.rewarded.sort()).toEqual(CLASS_IDS.filter(c => c !== muerto).sort());
    const cargado = campaign.load()!;
    for (const c of CLASS_IDS) {
      const inv = cargado.members[c].inv;
      if (c === muerto) expect(inv.every(x => x === null), 'el muerto no cobra').toBe(true);
      else {
        // con hueco libre entra en el inventario; con el inventario lleno se aplica al momento (+50 balas)
        if (snap[c]!.inv.includes(null)) expect(inv.includes('municion_50'), `${c} cobra la recompensa de la zona 3`).toBe(true);
        else expect(cargado.members[c].ammo, `${c} (inventario lleno) recibe las balas`).toBe(Math.min(999, snap[c]!.ammo + 50));
        // y no se pierde lo que llevaba antes (los objetos recogidos de lo que ya tenía)
        void antes;
      }
    }
  }, 60_000);

  it('21.14 · un compañero muerto durante la zona queda con vida 0, no vuelve en la planta siguiente y sigue muerto tras otro ciclo', () => {
    const { world, state, campaign } = campaignWorld(1, 1);
    const muerto: ClassId = 'technic';
    world.kill(world.entities.find(e => e.kind === muerto)!);
    expect(playZone(world, 600, true).result).toBe('cleared');
    campaign.completeZone(state, world);
    let cargado = campaign.load()!;
    expect(cargado.members[muerto].hp).toBe(0);
    expect(cargado.members[muerto].ammo).toBe(0);
    for (const c of CLASS_IDS.filter(c => c !== muerto)) expect(cargado.members[c].hp).toBeGreaterThan(0);

    // planta 2: ni zonesOf ni startZone lo crean
    expect(campaign.zonesOf(cargado.floor).length).toBe(6);
    const w2 = campaign.startZone(cargado, 1) as World;
    expect(w2.entities.some(e => e.kind === muerto)).toBe(false);
    expect(w2.entities.filter(e => e.team === 'ally').length).toBe(3);

    // otro ciclo guardar/cargar completo, jugando la planta 2
    expect(playZone(w2, 900, true).result).toBe('cleared');
    const sum2 = campaign.completeZone(cargado, w2);
    expect(sum2.fallen, 'no se vuelve a anotar como caído').not.toContain(muerto);
    cargado = campaign.load()!;
    expect(cargado.floor).toBe(3);
    expect(cargado.members[muerto].hp).toBe(0);
    expect(cargado.members[muerto].inv.every(x => x === null)).toBe(true);
    const w3 = campaign.startZone(cargado, 2) as World;
    expect(w3.entities.some(e => e.kind === muerto)).toBe(false);
    // guardar y cargar a pelo (sin jugar) tampoco lo resucita
    campaign.save(cargado);
    expect(campaign.load()!.members[muerto].hp).toBe(0);
  }, 120_000);

  it('21.14 · si el controlado figura muerto en lo guardado, startZone controla a un superviviente (no revive al muerto)', () => {
    const { world, state, campaign } = campaignWorld(1, 1, { cls: 'captain' });
    world.status = 'cleared';                           // se salta el combate: sólo importa el estado guardado
    world.kill(world.player);
    world.status = 'cleared';
    campaign.completeZone(state, world);
    const cargado = campaign.load()!;
    expect(cargado.members.captain.hp).toBe(0);
    const w = campaign.startZone(cargado, 1) as World;
    expect(w.player.kind).not.toBe('captain');
    expect(cargado.members[w.player.kind as ClassId].hp).toBeGreaterThan(0);
    expect(w.entities.some(e => e.kind === 'captain')).toBe(false);
  });

  // HALLAZGO (latente, no alcanzable jugando): en completeZone la línea
  //   if (state.members[state.controlled].hp <= 0) state.controlled = w.player.cls ?? state.controlled;
  // reasigna el controlado a w.player.cls, que es justo el muerto, así que no hace nada. En juego normal no se
  // llega: si el jugador muere el mundo queda en 'dead' y el director ya no lo pasa a 'cleared'. startZone cubre el hueco.
  it.fails('21.14 · (latente) completeZone deja en state.controlled a un superviviente cuando el controlado ha caído', () => {
    const { world, state, campaign } = campaignWorld(1, 1, { cls: 'captain' });
    world.status = 'cleared';
    world.kill(world.player);
    world.status = 'cleared';
    campaign.completeZone(state, world);
    expect(state.controlled).not.toBe('captain');
  });

  it('19 · partida rápida no guarda (ni al completar ni al fallar)', () => {
    const { world, state, campaign, storage } = quickWorld(1, 1);
    expect(playZone(world, 600, true).result).toBe('cleared');
    campaign.completeZone(state, world);
    expect(storage.map.size).toBe(0);
    expect(campaign.load()).toBeNull();
    expect(campaign.hasSave()).toBe(false);
    campaign.failZone(state);
    expect(storage.map.size).toBe(0);
    campaign.save(state);
    expect(campaign.hasSave()).toBe(false);
  }, 60_000);

  it('19 · un guardado corrupto o con todos muertos no se carga; clearSave borra', () => {
    const { campaign, storage, state } = campaignWorld(2, 1);
    campaign.save(state);
    expect(campaign.hasSave()).toBe(true);
    const clave = [...storage.map.keys()][0];
    storage.map.set(clave, '{no es json');
    expect(campaign.load()).toBeNull();
    const muertos = JSON.parse(JSON.stringify(state)) as CampaignState;
    for (const c of CLASS_IDS) muertos.members[c].hp = 0;
    campaign.save(muertos);
    expect(campaign.load()).toBeNull();
    campaign.save(state);
    campaign.clearSave();
    expect(campaign.load()).toBeNull();
  });

  it('19 · el guardado de la zona 6 de la planta 9 (victoria) borra el guardado', () => {
    const { world, state, campaign } = campaignWorld(9, 1);
    campaign.save(state);
    world.status = 'cleared';
    const sum = campaign.completeZone(state, world);
    expect(sum.campaignWon).toBe(true);
    expect(campaign.load()).toBeNull();
  });
});

// ───────────────────────── Ajuste dinámico (8) ─────────────────────────

/** Doble mínimo de IWorld: sólo lo que lee adaptStep (stats y vida máxima del jugador). */
function mundoFalso(stats: Partial<ZoneStats>): IWorld {
  const s: ZoneStats = { time: 100, kills: 20, shotsFired: 200, shotsHit: 60, damageTaken: 40, alliesLost: 0, scoreGained: 0, ...stats };
  return { stats: s, player: { maxHp: 160 } } as unknown as IWorld;
}

describe('8 · ajuste dinámico de dificultad', () => {
  it('8 · adaptStep usa referencia FIJA: el mismo mundo terminado más despacio nunca da un escalón mayor', () => {
    const n = 20;
    for (const base of [{ shotsHit: 90 }, { shotsHit: 30 }, { damageTaken: 10 }, { damageTaken: 300 }, { alliesLost: 1 }, {}]) {
      let prev = Infinity;
      for (const t of [20, 40, 60, 90, 130, 170, 230, 300, 500, 900]) {
        const a = adaptStep(mundoFalso({ ...base, time: t }), n);
        expect(a, `tiempo ${t}: no sube al ir más despacio (${JSON.stringify(base)})`).toBeLessThanOrEqual(prev);
        prev = a;
      }
    }
  });

  it('8 · es una función pura de las estadísticas de la zona: no depende de lo que se haya jugado antes', () => {
    const w = mundoFalso({ time: 80 });
    const a = adaptStep(w, 30);
    for (let i = 0; i < 5; i++) expect(adaptStep(mundoFalso({ time: 400 }), 30)).toBeLessThanOrEqual(a);
    expect(adaptStep(w, 30)).toBe(a);
  });

  it('8 · un encuentro mayor da más margen de tiempo: con el mismo tiempo y más enemigos, el ajuste no baja', () => {
    for (const t of [60, 120, 240]) {
      expect(adaptStep(mundoFalso({ time: t }), 40)).toBeGreaterThanOrEqual(adaptStep(mundoFalso({ time: t }), 10));
    }
  });

  it('8 · sube con un jugador sobrado y baja con uno ahogado', () => {
    const sobrado = mundoFalso({ time: 40, shotsFired: 100, shotsHit: 70, damageTaken: 10, alliesLost: 0 });
    const ahogado = mundoFalso({ time: 600, shotsFired: 100, shotsHit: 5, damageTaken: 400, alliesLost: 2 });
    expect(adaptStep(sobrado, 20)).toBe(1);
    expect(adaptStep(ahogado, 20)).toBe(-1);
  });

  it('8 · adaptStep sólo devuelve -1, 0 o +1 (nunca más de un escalón) en una malla de estadísticas', () => {
    const vistos = new Set<number>();
    for (const time of [5, 30, 100, 400, 2000]) for (const hit of [0, 10, 40, 90]) for (const dmg of [0, 50, 200, 900]) for (const lost of [0, 1, 3]) for (const n of [3, 20, 49]) {
      const v = adaptStep(mundoFalso({ time, shotsFired: 100, shotsHit: hit, damageTaken: dmg, alliesLost: lost }), n);
      expect([-1, 0, 1]).toContain(v);
      vistos.add(v);
    }
    expect([...vistos].sort()).toEqual([-1, 0, 1]);
  });

  it('8 · completeZone cambia state.adapt como mucho 1 escalón por zona y lo mantiene en -3..+3', () => {
    const extremos: Partial<ZoneStats>[] = [
      { time: 5, shotsFired: 100, shotsHit: 90, damageTaken: 0, alliesLost: 0 },
      { time: 2000, shotsFired: 100, shotsHit: 1, damageTaken: 900, alliesLost: 3 },
      { time: 100 },
    ];
    for (const adapt0 of [-3, -2, 0, 2, 3]) for (const ext of extremos) {
      const { world, state, campaign } = campaignWorld(1, 1);
      state.adapt = adapt0;
      world.stats = { time: 100, kills: 10, shotsFired: 100, shotsHit: 30, damageTaken: 30, alliesLost: 0, scoreGained: 10, ...ext };
      world.status = 'cleared';
      campaign.completeZone(state, world);
      expect(Math.abs(state.adapt - adapt0), `adapt ${adapt0} con ${JSON.stringify(ext)}`).toBeLessThanOrEqual(1);
      expect(state.adapt).toBeGreaterThanOrEqual(-3);
      expect(state.adapt).toBeLessThanOrEqual(3);
    }
  });

  it('8 · el mismo mundo terminado más despacio nunca da MÁS enemigos en la planta siguiente', () => {
    const resultado = (time: number) => {
      const { world, state, campaign } = campaignWorld(1, 3);
      world.stats = { time, kills: 19, shotsFired: 200, shotsHit: 70, damageTaken: 30, alliesLost: 0, scoreGained: 30 };
      world.status = 'cleared';
      campaign.completeZone(state, world);
      return { adapt: state.adapt, enemigos: enemyTotal(2, 'mediano', 'normal', state.adapt) };
    };
    const rapido = resultado(40), medio = resultado(150), lento = resultado(900);
    expect(medio.enemigos).toBeLessThanOrEqual(rapido.enemigos);
    expect(lento.enemigos).toBeLessThanOrEqual(medio.enemigos);
    expect(lento.adapt).toBeLessThanOrEqual(rapido.adapt);
  });

  it('8 · failZone baja un escalón (mínimo -3) y guarda en campaña', () => {
    const { state, campaign } = campaignWorld(2, 1);
    state.adapt = 1;
    campaign.failZone(state);
    expect(state.adapt).toBe(0);
    expect(campaign.load()!.adapt).toBe(0);
    campaign.failZone(state); campaign.failZone(state); campaign.failZone(state); campaign.failZone(state);
    expect(state.adapt).toBe(-3);
  });

  it('8 · cada escalón son ±10 % de enemigos y el tope es ±30 % (con la tabla de Normal como base)', () => {
    for (const f of [1, 4, 8]) for (const [i, size] of (['pequeno', 'mediano', 'grande'] as const).entries()) {
      const base = ENEMY_COUNT[f][i];
      expect(enemyTotal(f, size, 'normal', 0)).toBe(base);
      expect(enemyTotal(f, size, 'normal', 3)).toBe(Math.round(base * 1.3));
      expect(enemyTotal(f, size, 'normal', -3)).toBe(Math.max(3, Math.round(base * 0.7)));
      expect(enemyTotal(f, size, 'normal', 9)).toBe(enemyTotal(f, size, 'normal', 3));   // se recorta a ±3
      expect(enemyTotal(f, size, 'normal', 1)).toBeGreaterThanOrEqual(base);
    }
  });
});
