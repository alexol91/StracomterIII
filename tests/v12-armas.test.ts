// Pruebas v1.2: ranuras de arma (principal, pistola, cuchillo, granada) del jugador.
//
// QUÉ MODOS DE FALLO NO CUBRE ESTE FICHERO:
//  - No se prueba la interfaz (teclas 1-4, Q, rueda, HUD del arma) ni los modelos/animaciones de sacar el arma: sólo
//    el estado de la simulación (weapon, lastWeapon, drawUntil, mag2) y los sucesos weaponSwitch/shot.weapon.
//  - Los escenarios son de un solo jugador con el director congelado y sin compañeros: aliados y enemigos siempre
//    llevan 'primary' y eso sólo se comprueba por inspección del estado inicial, no durante una partida.
//  - La pistola se prueba con blancos quietos y semillas fijas; no se mide su equilibrio frente al arma principal
//    (daño por segundo, TTK) más allá de comprobar sus números nominales.
//  - La recarga cancelada se comprueba con el cargador y la reserva del principal; no con la animación.
//  - El cambio automático a pistola del bot (tools/partida.ts) no tiene prueba propia: se vigila con las campañas del bot.

import { describe, expect, it } from 'vitest';
import { PISTOL, PISTOL_FEEL } from '../src/sim/data';
import type { GameEvent, WeaponSlot } from '../src/sim/types';
import { DT, run, step } from './helpers';
import { enemigo, entrada, mundo } from './v12-util';

const eventos = (w: { events: GameEvent[] }, t: GameEvent['type']) => w.events.filter(e => e.type === t);

describe('v1.2 · ranuras de arma: cambio', () => {
  it('empieza en primary con lastWeapon secondary; aliados y enemigos llevan siempre primary', () => {
    const m = mundo({ aliados: true });
    expect(m.p.weapon).toBe('primary');
    expect(m.p.lastWeapon).toBe('secondary');
    for (const e of m.world.entities) if (!e.isPlayer) expect(e.weapon).toBe('primary');
  });

  it('weaponSlot elige ranura: guarda lastWeapon, pone el tiempo de saque y emite weaponSwitch; la activa no hace nada', () => {
    const m = mundo();
    const t0 = m.world.time + DT;
    m.world.step(DT, entrada({ weaponSlot: 'secondary' }));
    expect(m.p.weapon).toBe('secondary');
    expect(m.p.lastWeapon).toBe('primary');
    expect(m.p.drawUntil).toBeCloseTo(t0 + 0.30, 6);
    expect(eventos(m.world, 'weaponSwitch')).toEqual([{ type: 'weaponSwitch', id: m.p.id, weapon: 'secondary' }]);
    const inp = entrada({ weaponSlot: 'secondary' });
    m.world.step(DT, inp);
    expect(eventos(m.world, 'weaponSwitch')).toHaveLength(0);
    expect(inp.weaponSlot).toBeNull();                         // el flanco se consume
    const tiempos: [WeaponSlot, number][] = [['knife', 0.25], ['grenade', 0.30], ['primary', 0.45]];
    for (const [s, T] of tiempos) {
      const t = m.world.time + DT;
      m.world.step(DT, entrada({ weaponSlot: s }));
      expect(m.p.drawUntil).toBeCloseTo(t + T, 6);
    }
  });

  it('weaponLast (la Q) alterna entre las dos últimas armas', () => {
    const m = mundo();
    m.world.step(DT, entrada({ weaponSlot: 'knife' }));
    m.world.step(DT, entrada({ weaponLast: true }));
    expect(m.p.weapon).toBe('primary');
    m.world.step(DT, entrada({ weaponLast: true }));
    expect(m.p.weapon).toBe('knife');
    m.world.step(DT, entrada({ weaponSlot: 'secondary' }));
    m.world.step(DT, entrada({ weaponLast: true }));
    expect(m.p.weapon).toBe('knife');
  });

  it('la rueda recorre primary → secondary → knife → grenade en círculo (y al revés), saltando granada sin granadas', () => {
    const m = mundo();
    const orden: WeaponSlot[] = ['secondary', 'knife', 'grenade', 'primary', 'secondary'];
    for (const s of orden) { m.world.step(DT, entrada({ weaponCycle: 1 })); expect(m.p.weapon).toBe(s); }
    for (const s of ['primary', 'grenade', 'knife'] as WeaponSlot[]) { m.world.step(DT, entrada({ weaponCycle: -1 })); expect(m.p.weapon).toBe(s); }
    m.p.grenades = 0;
    m.world.step(DT, entrada({ weaponCycle: 1 }));
    expect(m.p.weapon).toBe('primary');                        // salta la granada
    m.world.step(DT, entrada({ weaponCycle: -1 }));
    expect(m.p.weapon).toBe('knife');
    m.world.step(DT, entrada({ weaponSlot: 'grenade' }));
    expect(m.p.weapon).toBe('knife');                          // elegir granada sin granadas se rechaza
  });

  it('no se dispara ni se acuchilla mientras dura el saque; esprintar no impide cambiar', () => {
    const m = mundo();
    const mag = m.p.mag;
    m.world.step(DT, entrada({ weaponSlot: 'secondary', fire: true }));
    expect(m.p.mag2).toBe(PISTOL.magSize);
    const t0 = m.world.time;
    let primero = -1;
    for (let i = 0; i < 60 && primero < 0; i++) { m.world.step(DT, entrada({ fire: true })); if (m.p.mag2 < PISTOL.magSize) primero = m.world.time - t0; }
    expect(primero).toBeGreaterThan(0.25);
    expect(primero).toBeLessThan(0.35);
    // cuchillo rápido bloqueado durante el saque del principal
    const k = mundo();
    const e = enemigo(k.world, 'miniboss', k.x + 1.2, k.y);
    k.world.step(DT, entrada({ weaponSlot: 'secondary' }));
    k.world.step(DT, entrada({ weaponSlot: 'primary', knife: true }));
    expect(e.hp).toBe(e.maxHp);
    run(k.world, 0.5, entrada({ knife: true }));
    expect(e.hp).toBeLessThan(e.maxHp);
    expect(mag).toBe(m.p.mag);
    const s = mundo();
    run(s.world, 0.2, entrada({ moveF: 1, sprint: true }));
    expect(s.p.sprinting).toBe(true);
    s.world.step(DT, entrada({ moveF: 1, sprint: true, weaponSlot: 'knife' }));
    expect(s.p.weapon).toBe('knife');
  });

  it('cambiar cancela la recarga en curso sin perder munición, y la dispersión vuelve a la base', () => {
    const m = mundo();
    m.p.mag = 5;
    const reserva = m.p.ammo;
    m.world.step(DT, entrada({ reload: true }));
    expect(m.p.reloading).toBeGreaterThan(0);
    m.world.step(DT, entrada({ weaponSlot: 'secondary' }));
    expect(m.p.reloading).toBe(0);
    run(m.world, 2, entrada());
    expect(m.p.mag).toBe(5);
    expect(m.p.ammo).toBe(reserva);
    // calor
    const h = mundo();
    run(h.world, 0.6, entrada({ fire: true }));
    expect(h.world.bloom).toBeGreaterThan(0);
    h.world.step(DT, entrada({ weaponSlot: 'secondary' }));
    expect(h.world.bloom).toBe(0);
  });
});

describe('v1.2 · pistola secundaria', () => {
  it('daño 14, cadencia 5/s, cargador 12 y suceso shot con weapon secondary; la dispersión usa su tabla', () => {
    const m = mundo();
    m.world.step(DT, entrada({ weaponSlot: 'secondary' }));
    run(m.world, 0.4, entrada());
    expect(m.p.spread).toBeCloseTo(PISTOL_FEEL.baseSpread, 6);
    const e = enemigo(m.world, 'miniboss', m.x + 3, m.y);
    m.world.fire(m.p, e.x, e.y, 1.0, 0, false, 'secondary');
    expect(e.maxHp - e.hp).toBe(14);
    expect(m.p.mag2).toBe(11);
    expect((m.world.events.find(x => x.type === 'shot') as any).weapon).toBe('secondary');
    // cadencia: 5/s manteniendo
    const c = mundo();
    c.world.step(DT, entrada({ weaponSlot: 'secondary' }));
    run(c.world, 0.4, entrada());
    const mag0 = c.p.mag2;
    run(c.world, 1, entrada({ fire: true }));
    const disparos = mag0 - c.p.mag2;
    expect(disparos).toBeGreaterThanOrEqual(5);
    expect(disparos).toBeLessThanOrEqual(6);
    // calor propio: con los números del encargo (perShot 0,006, recover 0,12/s tras 0,12 s sin disparar) y 5 disparos/s el
    // calor NO se acumula manteniendo el gatillo (entre disparos se recupera más de lo que suma). Se comprueba sólo la primera bala.
    const h = mundo();
    h.world.step(DT, entrada({ weaponSlot: 'secondary' }));
    run(h.world, 0.4, entrada());
    h.world.step(DT, entrada({ fire: true }));
    expect(h.world.bloom).toBeCloseTo(PISTOL_FEEL.perShot, 6);
  });

  it('reserva infinita: recarga sola al vaciar, tarda 1,3 s y no gasta la reserva del principal', () => {
    const m = mundo();
    const reserva = m.p.ammo, mag = m.p.mag;
    m.world.step(DT, entrada({ weaponSlot: 'secondary' }));
    run(m.world, 0.4, entrada());
    let recargaDesde = -1;
    for (let i = 0; i < 60 * 6; i++) {
      m.world.step(DT, entrada({ fire: true }));
      if (recargaDesde < 0 && m.p.reloading > 0) recargaDesde = m.world.time;
      if (recargaDesde > 0 && m.p.reloading === 0) break;
    }
    expect(recargaDesde).toBeGreaterThan(0);
    expect(m.world.time - recargaDesde).toBeGreaterThan(1.25);
    expect(m.world.time - recargaDesde).toBeLessThan(1.4);
    expect(m.p.mag2).toBe(12);
    expect(m.p.ammo).toBe(reserva);
    expect(m.p.mag).toBe(mag);
    // y se puede seguir recargando indefinidamente
    for (let k = 0; k < 3; k++) { run(m.world, 3, entrada({ fire: true })); }
    expect(m.p.ammo).toBe(reserva);
    // recarga manual y mejoras
    const r = mundo({ upgrades: ['recarga-rapida', 'mag+'] });
    r.world.step(DT, entrada({ weaponSlot: 'secondary' }));
    expect(r.p.magSize2).toBe(16);                              // 12 × 1,3
    r.p.mag2 = 3;
    r.world.step(DT, entrada({ reload: true }));
    expect(r.p.reloading).toBeCloseTo(1.3 * 0.75, 1);       // (menos el paso en que empieza)
  });

  it('va un 5 % más rápido que con el principal; con cuchillo, un 12 %; y se puede apuntar con ella pero no con cuchillo ni granada', () => {
    const v = (s: WeaponSlot, aim = false) => { const m = mundo(); m.world.step(DT, entrada({ weaponSlot: s })); run(m.world, 0.3, entrada({ moveF: 1, aim })); return { v: Math.hypot(m.p.vx, m.p.vy), aiming: m.p.aiming }; };
    const base = v('primary').v;
    expect(v('secondary').v / base).toBeCloseTo(1.05, 2);
    expect(v('knife').v / base).toBeCloseTo(1.12, 2);
    expect(v('secondary', true).aiming).toBe(true);
    expect(v('knife', true).aiming).toBe(false);
    expect(v('grenade', true).aiming).toBe(false);
  });

  it('r recarga el arma activa; con cuchillo o granada no hace nada', () => {
    const m = mundo();
    m.p.mag = 3;
    m.world.step(DT, entrada({ weaponSlot: 'knife' }));
    m.world.step(DT, entrada({ reload: true }));
    expect(m.p.reloading).toBe(0);
    m.world.step(DT, entrada({ weaponSlot: 'secondary' }));
    m.p.mag2 = 4;
    m.world.step(DT, entrada({ reload: true }));
    expect(m.p.reloading).toBeGreaterThan(0);
  });
});

describe('v1.2 · cuchillo y granada como ranuras', () => {
  it('con el cuchillo en la mano, fire acuchilla (manteniendo) y no gasta balas', () => {
    const m = mundo();
    const e = enemigo(m.world, 'miniboss', m.x + 1.2, m.y);
    m.world.step(DT, entrada({ weaponSlot: 'knife' }));
    const mag = m.p.mag;
    let cuchilladas = 0;
    run(m.world, 1.3, entrada({ fire: true }), w => { cuchilladas += eventos(w, 'knife').length; });
    expect(m.p.mag).toBe(mag);
    expect(m.p.mag2).toBe(12);
    expect(cuchilladas).toBeGreaterThanOrEqual(2);              // una cada 0,5 s tras los 0,25 s de saque
    expect(e.hp).toBeLessThan(e.maxHp);
  });

  it('con la granada en la mano, fire lanza una por pulsación (no repite manteniendo) y al acabarse vuelve a la anterior', () => {
    const m = mundo();
    m.world.step(DT, entrada({ weaponSlot: 'secondary' }));
    m.world.step(DT, entrada({ weaponSlot: 'grenade' }));
    expect(m.p.lastWeapon).toBe('secondary');
    run(m.world, 0.4, entrada());
    const g0 = m.p.grenades;
    run(m.world, 4, entrada({ fire: true }));                   // manteniendo: una sola
    expect(m.p.grenades).toBe(g0 - 1);
    m.p.grenades = 1;
    m.p.grenadeCd = 0;
    m.world.step(DT, entrada());
    m.world.step(DT, entrada({ fire: true }));
    expect(m.p.grenades).toBe(0);
    expect(m.p.weapon).toBe('secondary');                       // vuelve sola a lastWeapon
  });

  it('los accesos rápidos input.knife e input.grenade siguen funcionando con cualquier arma, sin cambiar de ranura', () => {
    for (const s of ['primary', 'secondary'] as WeaponSlot[]) {
      const m = mundo();
      if (s !== 'primary') m.world.step(DT, entrada({ weaponSlot: s }));
      run(m.world, 0.6, entrada());
      const e = enemigo(m.world, 'miniboss', m.x + 1.2, m.y);
      m.world.step(DT, entrada({ knife: true }));
      expect(e.hp).toBeLessThan(e.maxHp);
      const g = m.p.grenades;
      m.world.step(DT, entrada({ grenade: true }));
      expect(m.p.grenades).toBe(g - 1);
      expect(m.p.weapon).toBe(s);
    }
  });

  it('el principal sigue como antes (el explosivo mantiene su lanzador y no usa la pistola por error)', () => {
    const m = mundo({ cls: 'explosives' });
    expect(m.p.weapon).toBe('primary');
    expect(m.p.stats.explosive).toBe(true);
    m.world.step(DT, entrada({ weaponSlot: 'secondary' }));
    run(m.world, 0.4, entrada());
    const e = enemigo(m.world, 'miniboss', m.x + 3, m.y);
    m.world.fire(m.p, e.x, e.y, 1.0, 0, false, 'secondary');
    expect(e.maxHp - e.hp).toBe(14);                           // una bala, no una explosión de 60
    step(m.world, entrada(), 1);
  });
});
