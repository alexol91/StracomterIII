// Pruebas v1.2: las 20 mejoras de campaña. Cada una tiene un efecto medible en el mundo (comparando con una partida
// idéntica sin la mejora) y además se comprueba que `mods` cambia.
//
// QUÉ MODOS DE FALLO NO CUBRE ESTE FICHERO:
//  - Cada efecto se prueba aislado, con una sola mejora, en un escenario montado a mano (director congelado, sin
//    compañeros salvo donde hace falta). No se prueban combinaciones ni el equilibrio resultante de llevar varias.
//  - Las auras (aura-amplia, intendencia, sanitario) se prueban llamando a la función interna updateAuras con las
//    posiciones fijadas, no dejando correr la escuadra: no se ve cómo se mueven los compañeros respecto al aura.
//  - «botin» es estadístico (muchas bajas con la misma semilla): mide la tasa, no cada botín concreto.
//  - Que el jugador pueda ELEGIR la mejora en la interfaz no se prueba aquí (eso es de src/ui).

import { describe, expect, it } from 'vitest';
import { BLAST_RADIUS, CLASS_STATS, UPGRADES, computeMods, neutralMods } from '../src/sim/data';
import type { GameEvent } from '../src/sim/types';
import { DT, run, step } from './helpers';
import { enemigo, entrada, mundo } from './v12-util';

/** Ejecuta la misma medida con y sin la mejora. */
function conSin<T>(id: string, medir: (up: string[]) => T): { con: T; sin: T } {
  return { con: medir([id]), sin: medir([]) };
}
// el aura de vida da un tic cada 2 s y la de munición cada 4 s
const aura = (m: ReturnType<typeof mundo>, dt = 2.01) => (m.world as any).updateAuras(dt) as void;

describe('v1.2 · mejoras: la tabla', () => {
  it('hay 20 mejoras con textos es/en, icono y un efecto que cambia mods', () => {
    expect(UPGRADES).toHaveLength(20);
    const ids = new Set(UPGRADES.map(u => u.id));
    expect(ids.size).toBe(20);
    for (const u of UPGRADES) {
      expect(u.es.name && u.es.desc && u.en.name && u.en.desc).toBeTruthy();
      expect(u.icon).toBeTruthy();
      expect(computeMods([u.id])).not.toEqual(neutralMods());
    }
    expect(computeMods(['no-existe'])).toEqual(neutralMods());
    expect(computeMods(['mag+', 'mag+']).magMult).toBeCloseTo(1.3, 9);   // la misma mejora no se acumula dos veces
  });
});

describe('v1.2 · mejoras: efectos medibles', () => {
  it('mag+: cargador ×1,3 en toda la escuadra', () => {
    const { con, sin } = conSin('mag+', up => { const m = mundo({ upgrades: up, aliados: true }); return m.world.entities.filter(e => e.team === 'ally').map(e => e.magSize); });
    expect(con.length).toBeGreaterThan(1);
    con.forEach((v, i) => expect(v).toBe(Math.round(sin[i] * 1.3)));
  });

  it('recarga-rapida: el tiempo de recarga ×0,75', () => {
    const t = (up: string[]) => { const m = mundo({ upgrades: up }); m.p.mag = 1; m.world.startReload(m.p); return m.p.reloading; };
    const { con, sin } = conSin('recarga-rapida', t);
    expect(sin).toBeCloseTo(CLASS_STATS.captain.reloadTime, 9);
    expect(con).toBeCloseTo(sin * 0.75, 9);
  });

  it('granada-extra: +1 granada por zona', () => {
    const { con, sin } = conSin('granada-extra', up => mundo({ upgrades: up }).p.grenades);
    expect(con).toBe(sin + 1);
  });

  it('aura-amplia: +3 m de radio de las auras', () => {
    // un compañero herido a 9,5 m del Capitán: sin la mejora (radio 8) no cura, con ella (11) sí
    const curado = (up: string[]) => {
      const m = mundo({ upgrades: up, aliados: true, cls: 'captain' });
      const otro = m.world.entities.find(e => e.team === 'ally' && !e.isPlayer)!;
      otro.x = m.p.x + 9.5; otro.y = m.p.y; otro.hp = otro.maxHp - 30;
      const h0 = otro.hp; aura(m); return otro.hp - h0;
    };
    const { con, sin } = conSin('aura-amplia', curado);
    expect(sin).toBe(0);
    expect(con).toBe(1);
  });

  it('habilidad-agil: la espera de las habilidades ×0,75', () => {
    const { con, sin } = conSin('habilidad-agil', up => mundo({ upgrades: up }).p.abilityCdMax);
    expect(con).toBeCloseTo(sin * 0.75, 9);
  });

  it('perforante: la bala del jugador atraviesa a un enemigo y daña al de detrás', () => {
    const golpeados = (up: string[]) => {
      const m = mundo({ upgrades: up });
      const a = enemigo(m.world, 'enemy3', m.x + 1.5, m.y), b = enemigo(m.world, 'enemy3', m.x + 3, m.y);
      m.world.fire(m.p, a.x, a.y, 1.0, 0);
      return [a.hp < a.maxHp, b.hp < b.maxHp];
    };
    const { con, sin } = conSin('perforante', golpeados);
    expect(sin).toEqual([true, false]);
    expect(con).toEqual([true, true]);
  });

  it('vigor: +20 de vida máxima (y la campaña cura 20 al cogerla)', () => {
    const { con, sin } = conSin('vigor', up => mundo({ upgrades: up }).p.maxHp);
    expect(con).toBe(sin + 20);
    const m = mundo();
    m.state.members.captain.hp = 100;
    m.campaign.chooseUpgrade(m.state, 'vigor');
    expect(m.state.members.captain.hp).toBe(120);
    m.state.members.captain.hp = 160;
    m.campaign.chooseUpgrade(m.state, 'piernas');
    expect(m.state.members.captain.hp).toBe(160);
  });

  it('piernas: velocidad +6 %', () => {
    const v = (up: string[]) => { const m = mundo({ upgrades: up }); run(m.world, 0.3, entrada({ moveF: 1 })); return Math.hypot(m.p.vx, m.p.vy); };
    const { con, sin } = conSin('piernas', v);
    expect(con / sin).toBeCloseTo(1.06, 2);
  });

  it('tirador: multiplicador de cabeza +0,5 (de 25 a 30 con el Capitán)', () => {
    const dano = (up: string[]) => {
      const m = mundo({ upgrades: up });
      const e = enemigo(m.world, 'miniboss', m.x + 3, m.y);
      m.world.fire(m.p, e.x, e.y, m.world.height(e) * 0.95, 0);
      return e.maxHp - e.hp;
    };
    const { con, sin } = conSin('tirador', dano);
    expect(sin).toBeCloseTo(10 * 2.5, 6);
    expect(con).toBeCloseTo(10 * 3.0, 6);
  });

  it('pulso: retroceso y calor ×0,7', () => {
    const r = (up: string[]) => { const m = mundo({ upgrades: up }); m.world.step(DT, entrada({ fire: true })); return [m.world.recoil.pitch, m.world.bloom]; };
    const { con, sin } = conSin('pulso', r);
    expect(con[0]).toBeCloseTo(sin[0] * 0.7, 9);
    expect(con[1]).toBeCloseTo(sin[1] * 0.7, 9);
  });

  it('filo: cuchillo ×2 de daño y +0,3 m de alcance', () => {
    const cuchi = (up: string[], d: number) => {
      const m = mundo({ upgrades: up });
      const e = enemigo(m.world, 'miniboss', m.x + d, m.y);
      m.world.knife(m.p);
      return e.maxHp - e.hp;
    };
    expect(cuchi([], 1.2)).toBe(30);
    expect(cuchi(['filo'], 1.2)).toBe(60);
    // alcance: borde del cuerpo + 1,0 (+0,3): a 2,15 m del centro (miniboss, radio 0,55) sólo llega con «filo»
    const lejos = 0.4 + 1.0 + 0.275 + 0.15;
    expect(cuchi([], lejos)).toBe(0);
    expect(cuchi(['filo'], lejos)).toBe(60);
  });

  it('onda: el radio de las granadas del jugador +0,6 m', () => {
    const radio = (up: string[]) => {
      const m = mundo({ upgrades: up });
      m.p.fireCd = 0;
      m.world.throwGrenade(m.p, m.x + 3, m.y);
      let r = -1;
      for (let i = 0; i < 240 && r < 0; i++) { m.world.step(DT, entrada()); const ev = m.world.events.find((e): e is Extract<GameEvent, { type: 'explosion' }> => e.type === 'explosion'); if (ev) r = ev.radius; }
      return r;
    };
    const { con, sin } = conSin('onda', radio);
    expect(sin).toBe(BLAST_RADIUS);
    expect(con).toBeCloseTo(BLAST_RADIUS + 0.6, 9);
  });

  it('carroñero: botiquines y cajas dan +50 %', () => {
    const cura = (up: string[]) => { const m = mundo({ upgrades: up }); m.p.hp = 50; m.world.applyItem(m.p, 'vida_20'); const h = m.p.hp - 50; m.p.ammo = 0; m.world.applyItem(m.p, 'municion_20'); return [h, m.p.ammo]; };
    const { con, sin } = conSin('carroñero', cura);
    expect(sin).toEqual([20, 20]);
    expect(con).toEqual([30, 30]);
  });

  it('chaleco: daño recibido −12 %', () => {
    const d = (up: string[]) => { const m = mundo({ upgrades: up }); const e = enemigo(m.world, 'enemy1', m.x + 5, m.y); m.world.damage(m.p, 50, e, 'torso', e.x, e.y); return m.p.maxHp - m.p.hp; };
    const { con, sin } = conSin('chaleco', d);
    expect(sin).toBe(50);
    expect(con).toBeCloseTo(44, 9);
  });

  it('intendencia: el aura de munición da +5 balas por tic', () => {
    const balas = (up: string[]) => {
      const m = mundo({ upgrades: up, aliados: true, cls: 'especialist' });
      const o = m.world.entities.find(e => e.team === 'ally' && !e.isPlayer)!;
      o.x = m.p.x + 2; o.y = m.p.y; o.ammo = 10;
      aura(m, 4.01); return o.ammo - 10;
    };
    const { con, sin } = conSin('intendencia', balas);
    expect(sin).toBe(10);
    expect(con).toBe(15);
  });

  it('sanitario: el aura del Capitán cura +1 extra por tic', () => {
    const cura = (up: string[]) => {
      const m = mundo({ upgrades: up, aliados: true, cls: 'captain' });
      const o = m.world.entities.find(e => e.team === 'ally' && !e.isPlayer)!;
      o.x = m.p.x + 2; o.y = m.p.y; o.hp = 30;
      aura(m); return o.hp - 30;
    };
    const { con, sin } = conSin('sanitario', cura);
    expect(sin).toBe(1);
    expect(con).toBe(2);
  });

  it('sigilo: esprintar no hace más ruido que andar', () => {
    const ruido = (up: string[]) => {
      const m = mundo({ upgrades: up });
      let max = 0;
      for (let i = 0; i < 40; i++) { m.world.step(DT, entrada({ moveF: 1, sprint: true })); for (const n of m.world.noises) if (n.kind === 'step') max = Math.max(max, n.loud); }
      return max;
    };
    const { con, sin } = conSin('sigilo', ruido);
    expect(sin).toBe(9);
    expect(con).toBe(6);
  });

  it('primera-bala: el primer disparo tras 1 s sin disparar no tiene dispersión', () => {
    const desvio = (up: string[]) => {
      const m = mundo({ upgrades: up });
      run(m.world, 1.2, entrada());
      const quiere = Math.atan2(m.world.aim.y - m.p.y, m.world.aim.x - m.p.x);   // la mira ANTES de disparar (el disparo mueve la cámara)
      m.world.step(DT, entrada({ fire: true }));
      const ev = m.world.events.find((e): e is Extract<GameEvent, { type: 'shot' }> => e.type === 'shot')!;
      return Math.abs(Math.atan2(ev.ty - m.p.y, ev.tx - m.p.x) - quiere);
    };
    const { con, sin } = conSin('primera-bala', desvio);
    expect(con).toBeLessThan(1e-9);
    expect(sin).toBeGreaterThan(1e-5);
    // la segunda bala seguida ya se dispersa
    const m = mundo({ upgrades: ['primera-bala'] });
    run(m.world, 1.2, entrada());
    m.world.step(DT, entrada({ fire: true }));
    let max = 0;
    for (let i = 0; i < 30; i++) {
      m.world.step(DT, entrada({ fire: true }));
      const ev = m.world.events.find((e): e is Extract<GameEvent, { type: 'shot' }> => e.type === 'shot');
      if (ev) max = Math.max(max, Math.abs(Math.atan2(ev.ty - m.p.y, ev.tx - m.p.x) - Math.atan2(m.world.aim.y - m.p.y, m.world.aim.x - m.p.x)));
    }
    expect(max).toBeGreaterThan(1e-5);
  });

  it('ultimo-aliento: una vez por zona un golpe mortal te deja a 1 de vida y 1,5 s invulnerable', () => {
    const m = mundo({ upgrades: ['ultimo-aliento'] });
    const e = enemigo(m.world, 'enemy1', m.x + 5, m.y);
    m.world.damage(m.p, 9999, e, 'torso', e.x, e.y);
    expect(m.p.alive).toBe(true);
    expect(m.p.hp).toBe(1);
    m.world.damage(m.p, 9999, e, 'torso', e.x, e.y);        // dentro de la invulnerabilidad
    expect(m.p.hp).toBe(1);
    run(m.world, 1.6, entrada());
    m.world.damage(m.p, 9999, e, 'torso', e.x, e.y);        // ya gastado: esta vez sí muere
    expect(m.p.alive).toBe(false);
    // sin la mejora el primer golpe mortal mata
    const s = mundo();
    s.world.damage(s.p, 9999, e, 'torso', e.x, e.y);
    expect(s.p.alive).toBe(false);
  });

  it('botin: los enemigos sueltan objetos un 10 % más de veces', () => {
    const tasa = (up: string[]) => {
      const m = mundo({ upgrades: up, aliados: true });
      m.world.pickups.length = 0;
      const N = 800;
      for (let i = 0; i < N; i++) { const e = enemigo(m.world, 'enemy1', m.x + 3, m.y); m.world.kill(e, m.p); }
      return m.world.pickups.length / N;
    };
    const { con, sin } = conSin('botin', tasa);
    expect(con - sin).toBeGreaterThan(0.05);
    expect(con - sin).toBeLessThan(0.15);
  });

  it('mods por defecto no cambian nada (sin mejoras todo es neutro)', () => {
    const m = mundo();
    expect(m.world.mods).toEqual(neutralMods());
    step(m.world, entrada(), 1);
  });
});
