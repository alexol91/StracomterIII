// Pruebas de combate: explosiones (§13), tope de vida y auras (§5, §13) y recarga (§13).
//
// QUÉ MODOS DE FALLO NO CUBRE ESTE FICHERO:
//  - Las explosiones se disparan llamando a world.explode / world.fire directamente con unidades colocadas a mano:
//    no se prueba que la IA (enemiga o aliada) elija bien cuándo lanzar granadas o cohetes, ni la parábola de los
//    proyectiles, ni que el jugador pueda lanzar una granada con la tecla (sólo el efecto de la explosión).
//  - Las auras se miden con los aliados clavados en una posición (se les devuelve a su sitio tras cada paso) y sin
//    enemigos: no se prueba qué pasa cuando se mueven, ni la interacción con la moral (la moral inicial es 60 ≥ 20),
//    ni con los botiquines que los compañeros usan solos.
//  - La recarga se prueba con el jugador y su PlayerInput; la recarga de los compañeros y de los enemigos usa la
//    misma función (world.startReload/tickTimers) pero no se ejercita aquí su decisión de recargar.
//  - El tope de vida se prueba con applyItem/useItem/aura; no con todas las rutas posibles (p. ej. recompensa de
//    fin de zona sin hueco en el inventario: eso está en guardado.test.ts).

import { describe, expect, it } from 'vitest';
import { AMMO_CAP, CLASS_STATS, GRENADE_COUNT } from '../src/sim/data';
import { CLASS_IDS, emptyInput, type ClassId } from '../src/sim/types';
import { DT, calmar, killAllies, place, pointAtDistance, quickWorld, run, step } from './helpers';

/** Mundo de planta 1 zona 1 ya limpio (director parado) y sin compañeros: sólo el jugador y lo que se añada. */
function limpio(cls: ClassId = 'captain', conAliados = false) {
  const fx = quickWorld(1, 1, { cls });
  calmar(fx.world);
  if (!conAliados) killAllies(fx.world);
  return fx;
}

// ───────────────────────── 3. Explosiones (13) ─────────────────────────

describe('13 · explosiones', () => {
  it('13 · el daño cae linealmente con la distancia y vale 0 a partir de ~2 m', () => {
    const { world } = limpio();
    const victims = [0.6, 1.1, 1.6, 2.1].map((d, i) => {
      // una víctima por prueba (todas a la misma distancia del centro, en direcciones distintas no hace falta)
      void i; return d;
    });
    const out: number[] = [];
    for (const d of victims) {
      const e = world.spawnUnit('miniboss', 8, 2, false);       // 200 de vida: sobrevive a todo
      place(world, e, 8, 2);
      const hp0 = e.hp;
      world.explode(8 - d, 2, 1.0, 2, 40, null, null);
      out.push(hp0 - e.hp);
      e.alive = false;                                        // se retira para no estorbar a la siguiente medida
    }
    // d_efectiva = distancia al centro − radio·0,5 del cuerpo; daño = 40·(1 − d_ef/2)
    // miniboss: radio 0,55 → 0,275 m de ajuste (todas las distancias de arriba quedan por encima de él, sin saturar
    // a daño máximo). Se comprueba la FORMA: lineal y monótona, 10 puntos por cada 0,5 m con 40 de daño máximo.
    expect(out[0]).toBeGreaterThan(out[1]);
    expect(out[1]).toBeGreaterThan(out[2]);
    expect(out[2]).toBeGreaterThan(out[3]);
    expect(out[3]).toBeGreaterThan(0);
    const diffs = [out[0] - out[1], out[1] - out[2], out[2] - out[3]];
    for (const df of diffs) expect(df).toBeCloseTo(diffs[0], 3);             // pendiente constante
    expect(diffs[0]).toBeCloseTo(40 * 0.5 / 2, 3);                          // 0,5 m ↔ 10 puntos con 40 de daño máx. y radio 2
    expect(out[0]).toBeLessThanOrEqual(40);
  });

  it('13 · a 2 m o más de la superficie del cuerpo no hace daño (y a 2,2 m del centro, nada)', () => {
    const { world } = limpio();
    const a = world.spawnUnit('enemy3', 8, 2, false); place(world, a, 8, 2);
    world.explode(8 - 2.2, 2, 1.0, 2, 60, null, null);
    expect(a.hp).toBe(a.maxHp);
    // en el borde: a 2,0 m del centro el cuerpo (radio 0,4) aún roza el radio: el daño es residual (< 10 % del máximo)
    const b = world.spawnUnit('enemy3', 8, 2, false); place(world, b, 8, 2);
    world.explode(8 - 2.0, 2, 1.0, 2, 60, null, null);
    expect(b.maxHp - b.hp).toBeLessThan(6.01);
  });

  it('13 · hiere a los amigos (aliado con granada de un aliado) y al propio lanzador, y a los enemigos', () => {
    const { world } = limpio('explosives', true);
    const p = world.player;
    const amigo = world.entities.find(e => e.team === 'ally' && !e.isPlayer && e.alive)!;
    const enemigo = world.spawnUnit('enemy3', 3, 2, false);
    place(world, p, 3.0, 3.1); place(world, amigo, 3.9, 3.1); place(world, enemigo, 3.0, 2.2);
    for (const e of [p, amigo, enemigo]) e.hp = e.maxHp;
    // el jugador (Explosivo) es el dueño de la explosión, a 0,5 m de cada uno
    world.explode(3.45, 2.65, 1.0, 2, 60, p, null);
    expect(p.hp, 'el propio lanzador sale herido').toBeLessThan(p.maxHp);
    expect(amigo.hp, 'el compañero sale herido (fuego amigo de explosión)').toBeLessThan(amigo.maxHp);
    expect(enemigo.hp, 'el enemigo también').toBeLessThan(enemigo.maxHp);
  });

  it('13 · un disparo normal NO hiere a los del propio bando (contraste con la explosión)', () => {
    const { world } = limpio('captain', true);
    const p = world.player;
    const amigo = world.entities.find(e => e.team === 'ally' && !e.isPlayer && e.alive)!;
    place(world, p, 2.8, 3.1, 0); place(world, amigo, 3.5, 3.1);
    amigo.hp = amigo.maxHp;
    world.fire(p, 3.5, 3.1, 1.0, 0.0);
    expect(amigo.hp).toBe(amigo.maxHp);
  });

  it('13 · el disparo del Explosivo estalla contra un muro cercano y le hiere a él mismo', () => {
    const { world } = limpio('explosives');
    const p = world.player;
    // muro vertical del mapa pequeño en x∈[4.24,4.57]; el jugador a 1,2 m de él mirando hacia allí
    place(world, p, 3.0, 3.6, 0);
    p.hp = p.maxHp;
    world.fire(p, 4.3, 3.6, 1.2, 0);
    expect(world.events.some(ev => ev.type === 'explosion')).toBe(true);
    expect(p.hp).toBeLessThan(p.maxHp);
  });

  it('13 · NO atraviesa paredes: una unidad al otro lado de un tabique, a 1 m, no recibe daño', () => {
    const { world } = limpio();
    // tabique x∈[4.24,4.57]. Explosión en x=3,95; víctima en x=5,1 (a 1,15 m del centro, al otro lado) y control a 1,15 m al oeste
    const lejos = world.spawnUnit('enemy3', 5.1, 3.2, false); place(world, lejos, 5.1, 3.2);
    // control: misma distancia SIN pared de por medio (hacia el oeste), hay hueco libre
    const cerca = world.spawnUnit('enemy3', 2.8, 3.2, false); place(world, cerca, 2.8, 3.2);
    world.explode(3.95, 3.2, 1.0, 2, 60, null, null);
    expect(cerca.hp, 'control: sin pared sí hay daño').toBeLessThan(cerca.maxHp);
    expect(lejos.hp, 'con el tabique en medio no debe haber daño').toBe(lejos.maxHp);
  });

  it('13 · la puerta cerrada también frena la explosión; abierta, no', () => {
    const { world } = limpio();
    const door = world.level.doors.find(d => d.vertical && Math.abs(d.cy - 2.18) < 0.1)!;
    const v = world.spawnUnit('enemy3', 5.1, door.cy, false); place(world, v, 5.1, door.cy);
    world.explode(3.95, door.cy, 1.0, 2, 60, null, null);
    expect(v.hp).toBe(v.maxHp);
    world.toggleDoor(door.id, true, null);
    world.explode(3.95, door.cy, 1.0, 2, 60, null, null);
    expect(v.hp).toBeLessThan(v.maxHp);
  });
});

// ───────────────────────── 4. Vida y auras (5, 13) ─────────────────────────

describe('5/13 · tope de vida y auras', () => {
  it('13 · la vida no pasa del máximo: botiquín en jugador sano, botiquín grande y aura', () => {
    const { world } = limpio();
    const p = world.player;
    p.hp = p.maxHp - 5;
    p.inventory[0] = 'vida_100'; p.invSel = 0;
    const inp = emptyInput(); inp.useItem = true;
    world.step(DT, inp);
    expect(p.hp).toBe(p.maxHp);                         // 155 + 100 → 160, no 255
    // con la vida llena, usar otro botiquín no se gasta
    p.inventory[1] = 'vida_50'; p.invSel = 1;
    const inp2 = emptyInput(); inp2.useItem = true;
    world.step(DT, inp2);
    expect(p.hp).toBe(p.maxHp);
    expect(p.inventory[1]).toBe('vida_50');
    // el aura del Capitán (cada 2 s) tampoco pasa del máximo
    run(world, 6);
    expect(p.hp).toBeLessThanOrEqual(p.maxHp);
  });

  it('13 · la vida no pasa del máximo para cada clase (applyItem)', () => {
    for (const c of CLASS_IDS) {
      const { world } = limpio(c);
      const p = world.player;
      p.hp = p.maxHp - 1;
      world.applyItem(p, 'vida_100');
      expect(p.hp).toBe(CLASS_STATS[c].hp);
    }
  });

  it('5 · el aura del Capitán cura +1 cada 2 s a ≤ 8 m y no a 12 m', () => {
    const { world } = limpio('captain', true);
    const cap = world.player;
    place(world, cap, 3, 2.2);
    const [tec, esp, exp] = ['technic', 'especialist', 'explosives'].map(k => world.entities.find(e => e.kind === k)!);
    const pNear = pointAtDistance(world, cap.x, cap.y, 7.0, [cap])!;
    const pFar = pointAtDistance(world, cap.x, cap.y, 12.0, [cap, { x: pNear[0], y: pNear[1] }])!;
    expect(pNear && pFar).toBeTruthy();
    const pMid = pointAtDistance(world, cap.x, cap.y, 4, [cap, { x: pNear[0], y: pNear[1] }, { x: pFar[0], y: pFar[1] }])!;
    const slots: [typeof tec, [number, number]][] = [[tec, pNear], [esp, pFar], [exp, pMid]];
    for (const [u] of slots) u.hp = u.maxHp - 30;
    const hp0 = slots.map(([u]) => u.hp);
    const capHp0 = cap.hp = cap.maxHp - 30;
    const T = 20;
    run(world, T, emptyInput(), () => { for (const [u, pos] of slots) place(world, u, pos[0], pos[1]); place(world, cap, 3, 2.2); });
    const gained = slots.map(([u], i) => u.hp - hp0[i]);
    // 20 s → 10 ticks (±1 por la fase del acumulador)
    expect(gained[0], 'a 7 m: dentro del aura').toBeGreaterThanOrEqual(9);
    expect(gained[0]).toBeLessThanOrEqual(11);
    expect(gained[1], 'a 12 m: fuera del aura').toBe(0);
    expect(gained[2], 'a 4 m: dentro del aura').toBeGreaterThanOrEqual(9);
    expect(cap.hp - capHp0, 'el propio Capitán también se cura').toBeGreaterThanOrEqual(9);
  });

  it('5 · el aura del Especialista da +10 balas cada 4 s a ≤ 8 m y no a 12 m', () => {
    const { world } = limpio('captain', true);
    const cap = world.player;
    place(world, cap, 3, 2.2);
    const esp = world.entities.find(e => e.kind === 'especialist')!;
    const tec = world.entities.find(e => e.kind === 'technic')!;
    const exp = world.entities.find(e => e.kind === 'explosives')!;
    const pNear = pointAtDistance(world, cap.x, cap.y, 6, [cap])!;
    const pFar = pointAtDistance(world, cap.x, cap.y, 12, [cap, { x: pNear[0], y: pNear[1] }])!;
    // el Especialista junto al Capitán, el Técnico cerca y el Explosivo a 12 m del Especialista
    const espPos: [number, number] = [3.0, 2.9];
    const slots: [typeof tec, [number, number]][] = [[esp, espPos], [tec, pNear], [exp, pFar]];
    for (const [u] of slots) { u.ammo = 100; }
    const d = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const nearDist = d(espPos, pNear), farDist = d(espPos, pFar);
    expect(nearDist).toBeLessThanOrEqual(8);
    expect(farDist).toBeGreaterThan(8);
    run(world, 20, emptyInput(), () => { for (const [u, pos] of slots) place(world, u, pos[0], pos[1]); place(world, cap, 3, 2.2); });
    // 20 s → 5 ticks de +10 (±1 tick)
    expect(tec.ammo - 100, 'cerca del Especialista').toBeGreaterThanOrEqual(40);
    expect(tec.ammo - 100).toBeLessThanOrEqual(60);
    expect(exp.ammo - 100, 'lejos del Especialista').toBe(0);
  });

  it('5 · el aura de munición respeta el tope de 999 balas', () => {
    const { world } = limpio('captain', true);
    const tec = world.entities.find(e => e.kind === 'technic')!;
    tec.ammo = AMMO_CAP - tec.mag - 3;
    run(world, 12, emptyInput(), () => { place(world, tec, 3, 2.2); });
    expect(tec.ammo + tec.mag).toBeLessThanOrEqual(AMMO_CAP);
  });
});

// ───────────────────────── 5. Recarga (13) ─────────────────────────

describe('13 · recarga y cargador', () => {
  for (const cls of CLASS_IDS) {
    it(`13 · ${cls}: el cargador se rellena tras reloadTime y durante la recarga no dispara`, () => {
      const { world } = limpio(cls);
      const p = world.player;
      place(world, p, 3.0, 2.2, 0);
      p.mag = 1; p.ammo = 200;
      const st = CLASS_STATS[cls];
      const inp = emptyInput(); inp.yaw = 0; inp.reload = true; inp.fire = true;      // pide recargar y sigue apretando el gatillo
      let shotsReloading = 0, t0 = world.time, filledAt = -1;
      for (let i = 0; i < Math.round((st.reloadTime + 0.5) / DT); i++) {
        const recargabaAntes = p.reloading > 0.02;     // (margen de un paso: en el que termina sí puede disparar de nuevo)
        world.step(DT, inp);
        inp.fire = true;
        for (const ev of world.events) if (ev.type === 'shot' && ev.id === p.id && recargabaAntes && p.reloading > 0) shotsReloading++;
        if (filledAt < 0 && p.mag === st.magSize) filledAt = world.time - t0;
        if (p.reloading > 0) expect(p.mag, 'mientras recarga, el cargador no cambia').toBeLessThanOrEqual(1);
      }
      expect(shotsReloading, 'ningún disparo mientras dura la recarga').toBe(0);
      expect(filledAt).toBeGreaterThan(st.reloadTime - 0.05);
      expect(filledAt).toBeLessThan(st.reloadTime + 0.1);
      expect(p.mag + p.ammo, 'la recarga mueve balas, no las crea').toBeLessThanOrEqual(201);
    });
  }

  it('13 · recargar con poca reserva sólo rellena lo que hay', () => {
    const { world } = limpio();
    const p = world.player;
    p.mag = 2; p.ammo = 5;
    const inp = emptyInput(); inp.reload = true;
    run(world, 2.0, inp);
    expect(p.mag).toBe(7);
    expect(p.ammo).toBe(0);
  });

  it('13 · fallar cuesta: disparar al muro gasta bala igual (y no hay impactos)', () => {
    const { world } = limpio();
    const p = world.player;
    place(world, p, 3.0, 3.6, 0);
    const inp = emptyInput(); inp.yaw = 0; inp.fire = true;
    const mag0 = p.mag;
    const fired0 = world.stats.shotsFired;
    run(world, 0.5, inp);
    const gastadas = mag0 - p.mag;
    expect(gastadas).toBeGreaterThanOrEqual(4);                 // capitán: 10 disp/s → ~5 en 0,5 s
    expect(world.stats.shotsFired - fired0).toBe(gastadas);
    expect(world.stats.shotsHit).toBe(0);
  });

  it('13 · con el cargador vacío y reserva, recarga sola y vuelve a disparar; sin reserva, «dryfire»', () => {
    const { world } = limpio();
    const p = world.player;
    place(world, p, 3.0, 3.6, 0);
    p.mag = 0; p.ammo = 30;
    const inp = emptyInput(); inp.yaw = 0; inp.fire = true;
    let shots = 0, reloads = 0;
    run(world, 3, inp, w => { for (const ev of w.events) { if (ev.type === 'shot' && ev.id === p.id) shots++; if (ev.type === 'reload') reloads++; } });
    expect(reloads).toBeGreaterThanOrEqual(1);
    expect(shots).toBeGreaterThan(0);
    // sin balas en absoluto
    p.mag = 0; p.ammo = 0; p.reloading = 0;
    let dry = 0, shots2 = 0;
    run(world, 1, inp, w => { for (const ev of w.events) { if (ev.type === 'dryfire') dry++; if (ev.type === 'shot' && ev.id === p.id) shots2++; } });
    expect(shots2).toBe(0);
    expect(dry).toBeGreaterThan(0);
    void step; void GRENADE_COUNT;
  });
});
