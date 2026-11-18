// Pruebas de línea de visión y de fuego (DEFINICION §14, §11.1; punto 21.5 «no disparan a través de paredes ni
// te ven a través de una puerta cerrada»).
//
// QUÉ MODOS DE FALLO NO CUBRE ESTE FICHERO:
//  - Los escenarios de pared y puerta usan UNA geometría concreta (el mapa pequeño de la planta 1) y un solo
//    enemigo inmóvil (se le devuelve a su sitio tras cada paso para que no rodee el tabique): demuestran que
//    no ve ni dispara por donde NO debe, no que la IA «se porte bien» al moverse.
//  - La prueba de propiedad comprueba cada disparo con world.level.ray, el MISMO trazador que usa la simulación
//    para decidir el impacto: si ese trazador tuviera un hueco (p. ej. una esquina por la que se cuela el rayo)
//    esta prueba no lo vería. Lo único independiente es que la comprobación se hace desde el suceso emitido
//    (origen/impacto que se mandarían al dibujo) y no desde dentro de la IA.
//  - Sólo mira las zonas que juega el bot de tools/partida.ts (con datos perfectos y modo dios): no cubre
//    situaciones que un humano provoque (granadas por una puerta, boquetes de Demolición, agacharse tras mesas).
//  - Las pruebas de Level usan un MapDef mínimo (rectángulo con un solo mueble): no verifican las dimensiones de
//    los muebles reales de los mapas, sólo la tabla FURNITURE de data.ts.
//  - No se prueba la visión a través de un boquete abierto por Demolición ni con la puerta a medio abrir (anim).

import { describe, expect, it } from 'vitest';
import { playZone } from '../tools/partida';
import { FURNITURE } from '../src/sim/data';
import { Level } from '../src/sim/level';
import { emptyInput, type FurnitureType, type MapDef } from '../src/sim/types';
import { DT, clearZone, killAllies, place, quickWorld } from './helpers';

// ───────────────────────── 1. Paredes y puertas (21.5) ─────────────────────────

/** Tabique de la planta 1 (mapa pequeño): muro vertical x∈[4.24,4.57], y∈[2.85,4.52]; puerta en y∈[1.52,2.85]. */
const TABIQUE_X = 4.4;

function escenario() {
  const fx = quickWorld(1, 1);
  const { world } = fx;
  clearZone(world);                       // sin enemigos del director, y director parado (zona 'cleared')
  expect(world.status).toBe('cleared');
  killAllies(world);                      // sólo cuentan el enemigo y el jugador
  world.cheats.god = true;                // el jugador no puede morir a media prueba
  const enemy = world.spawnUnit("enemy1", 3.2, 3.2, false);
  return { ...fx, enemy, player: world.player };
}

describe('21.5 · no ven ni disparan a través de paredes', () => {
  for (const y of [3.0, 3.2, 3.4]) {
    it(`21.5 · tabique cerrado, enemigo a un lado y jugador a 2,4 m al otro (y=${y}): 10 s sin disparos y sin visión`, () => {
      const { world, enemy, player } = escenario();
      const [ex, py] = [3.2, y];
      const hold = () => { place(world, enemy, ex, py, 0); };       // el enemigo no puede rodear el tabique
      hold();
      place(world, player, 5.6, py, Math.PI);
      const inp = emptyInput();
      inp.yaw = Math.PI;
      // el jugador DISPARA contra el muro: hace ruido, el enemigo sabe que hay alguien y quiere ir a mirar
      inp.fire = true;
      let shots = 0, sawIt = 0, lookedAt = 0;
      for (let i = 0; i < 600; i++) {
        hold();
        if (!(world.canSee(enemy, player) === false)) sawIt++;
        world.step(DT, inp);
        for (const ev of world.events) if (ev.type === 'shot' && ev.id === enemy.id) shots++;
        if (enemy.aiState === 'va a mirar') lookedAt++;
        player.mag = player.magSize; // munición ilimitada para seguir haciendo ruido
      }
      expect(enemy.alive, 'el enemigo tiene que seguir vivo para que la prueba signifique algo').toBe(true);
      expect(shots).toBe(0);
      expect(sawIt).toBe(0);
      // control: el ruido sí lo ha oído (si no, la prueba sería trivial: un enemigo que ni se entera no dispara)
      expect(lookedAt, 'el enemigo debería haber oído los disparos y ido a mirar').toBeGreaterThan(0);
    });
  }

  it('21.5 · puerta cerrada: enemigo y jugador enfrentados a 2,4 m, 10 s sin disparos ni visión', () => {
    const { world, enemy, player } = escenario();
    const door = world.level.doors.find(d => d.vertical && Math.abs(d.cy - 2.18) < 0.1)!;
    expect(door).toBeTruthy();
    const hold = () => { place(world, enemy, 3.2, door.cy, 0); };
    hold();
    place(world, player, 5.6, door.cy, Math.PI);
    const inp = emptyInput();
    inp.yaw = Math.PI;
    inp.fire = true;                      // ruido contra la puerta
    let shots = 0, sawIt = 0, closedChecks = 0;
    for (let i = 0; i < 600; i++) {
      hold();
      world.toggleDoor(door.id, false, null);          // el enemigo puede intentar abrirla: se vuelve a cerrar
      if (door.open) continue;                          // (no se pudo cerrar: alguien en el hueco; no cuenta)
      closedChecks++;
      if (world.canSee(enemy, player)) sawIt++;
      world.step(DT, inp);
      for (const ev of world.events) if (ev.type === 'shot' && ev.id === enemy.id) shots++;
      player.mag = player.magSize;
    }
    expect(closedChecks).toBeGreaterThan(500);
    expect(enemy.alive).toBe(true);
    expect(sawIt).toBe(0);
    expect(shots).toBe(0);
  });

  it('21.5 · control: la misma puerta ABIERTA y los dos enfrentados → el enemigo acaba disparando', () => {
    const { world, enemy, player } = escenario();
    const door = world.level.doors.find(d => d.vertical && Math.abs(d.cy - 2.18) < 0.1)!;
    place(world, enemy, 3.2, door.cy, 0);
    place(world, player, 5.6, door.cy, Math.PI);
    expect(world.canSee(enemy, player)).toBe(false);      // cerrada
    expect(world.toggleDoor(door.id, true, null)).toBe(true);
    expect(world.canSee(enemy, player)).toBe(true);       // abierta: geometría despejada
    const inp = emptyInput(); inp.yaw = Math.PI;
    let shots = 0;
    for (let i = 0; i < 600 && shots === 0; i++) {
      world.step(DT, inp);
      for (const ev of world.events) if (ev.type === 'shot' && ev.id === enemy.id) shots++;
    }
    expect(shots, 'con la puerta abierta y el jugador delante, el enemigo debe disparar en < 10 s').toBeGreaterThan(0);
  });
});

describe('21.5 · propiedad: en partidas enteras, cada disparo enemigo tiene línea de bala real', () => {
  const zonas: [number, number][] = [[1, 1], [1, 3], [1, 5], [3, 3], [6, 5]];
  for (const [floor, zone] of zonas) {
    it(`21.5 · planta ${floor} zona ${zone}: todo suceso shot (hit entity) y todo hurt no-explosivo de un enemigo cruza sólo aire`, () => {
      const { world } = quickWorld(floor, zone);
      let nShots = 0, nHurts = 0, nKnife = 0;
      const bad: string[] = [];
      // Se comprueba EN EL MOMENTO del disparo (posiciones exactas), no al final del paso: tras mover a los
      // cuerpos, una esquina puede cambiar el resultado en 3 cm y dar falsos avisos.
      const origFire = world.fire.bind(world);
      world.fire = (u, tx, ty, tz, spread, free) => {
        const n0 = world.events.length;
        const ox = u.x, oy = u.y, oz = world.muzzleZ(u);
        origFire(u, tx, ty, tz, spread, free);
        for (const ev of world.events.slice(n0)) {
          if (ev.type !== 'shot' || ev.team !== 'enemy' || ev.hit !== 'entity') continue;
          nShots++;
          const len = Math.hypot(ev.tx - ox, ev.ty - oy, ev.tz - oz);
          const t = world.level.ray(ox, oy, oz, ev.tx, ev.ty, ev.tz, 'bullet');
          // margen del 2 % más 5 cm absolutos
          if (t * len < len * 0.98 - 0.05) bad.push(`t=${world.time.toFixed(2)} shot de #${ev.id} ${ev.kind}: el rayo se corta en t=${t.toFixed(3)} de ${len.toFixed(1)} m`);
          const len2 = Math.hypot(ev.tx - ev.fx, ev.ty - ev.fy, ev.tz - ev.fz);
          const t2 = world.level.ray(ev.fx, ev.fy, ev.fz, ev.tx, ev.ty, ev.tz, 'bullet');
          if (t2 * len2 < len2 * 0.98 - 0.05) bad.push(`t=${world.time.toFixed(2)} shot de #${ev.id}: el segmento publicado se corta en t=${t2.toFixed(3)}`);
        }
      };
      const origDamage = world.damage.bind(world);
      world.damage = (t, amount, attacker, zone, fx, fy) => {
        if (attacker && attacker.team === 'enemy' && t.alive && amount > 0) {
          if (zone === 'knife') {
            nKnife++;
            if (!world.level.clear(attacker.x, attacker.y, 1.1, t.x, t.y, Math.min(1.1, world.height(t) * 0.7), 'bullet')) bad.push(`t=${world.time.toFixed(2)} cuchillada de #${attacker.id} a través de un obstáculo`);
          } else if (zone !== 'blast') {
            nHurts++;
            // todo daño de bala de un enemigo tiene que venir de un disparo con impacto en entidad en este mismo paso
            const shot = world.events.some(ev => ev.type === 'shot' && ev.id === attacker.id && ev.hit === 'entity');
            if (!shot) bad.push(`t=${world.time.toFixed(2)} daño (${zone}) de #${attacker.id} a #${t.id} sin suceso shot`);
          }
        }
        origDamage(t, amount, attacker, zone, fx, fy);
      };
      playZone(world, 600, true);
      expect(nShots, 'el bot tiene que haber recibido disparos para que la prueba signifique algo').toBeGreaterThan(5);
      expect(nHurts).toBeGreaterThan(0);
      void nKnife;
      expect(bad.slice(0, 5)).toEqual([]);
    }, 60_000);
  }
});

// ───────────────────────── 2. Muebles: maceta, estantería, mesa (11.1) ─────────────────────────

/** Rectángulo de 20×10 con un único mueble en el centro (10,5). */
function mapaConMueble(tipo: FurnitureType, angulo = 0): MapDef {
  return {
    nombre: 'prueba', tamano: 'pequeno', ancho_m: 20, alto_m: 10,
    perimetro: [[0, 0], [20, 0], [20, 10], [0, 10]],
    muros: [], puertas: [], objetos: [],
    mobiliario: [{ tipo, pos: [10, 5], angulo }],
    inicio_jugador: [2, 5], punto_jefe: [18, 5],
  };
}

describe('11.1 · muebles y línea de visión / de bala', () => {
  const lvl = (t: FurnitureType, ang = 0) => new Level(mapaConMueble(t, ang), 1);
  const EYE = 1.6, CHEST = 1.2;

  it('11.1 · maceta: tapa la vista pero NO para las balas', () => {
    const L = lvl('maceta');
    expect(FURNITURE.maceta.sightH).toBeGreaterThan(0);
    expect(FURNITURE.maceta.bulletH).toBe(0);
    expect(L.clear(2, 5, EYE, 18, 5, CHEST, 'sight')).toBe(false);
    expect(L.clear(2, 5, 1.4, 18, 5, 1.4, 'bullet')).toBe(true);
    expect(L.clear(2, 5, 0.5, 18, 5, 0.5, 'bullet')).toBe(true);
    // fuera del mueble, la vista pasa (control de que el rayo no choca con otra cosa)
    expect(L.clear(2, 7, EYE, 18, 7, CHEST, 'sight')).toBe(true);
  });

  it('11.1 · estantería: para la vista y las balas, de pie y agachado', () => {
    const L = lvl('estanteria');
    expect(L.clear(2, 5, EYE, 18, 5, CHEST, 'sight')).toBe(false);
    expect(L.clear(2, 5, 1.4, 18, 5, 1.4, 'bullet')).toBe(false);
    expect(L.clear(2, 5, 0.5, 18, 5, 0.5, 'bullet')).toBe(false);
    expect(L.clear(2, 5, 0.5, 18, 5, 0.5, 'sight')).toBe(false);
    // por encima de 2,1 m sí se pasa (la altura importa)
    expect(L.clear(2, 5, 2.6, 18, 5, 2.6, 'bullet')).toBe(true);
    expect(L.clear(2, 7, 1.4, 18, 7, 1.4, 'bullet')).toBe(true);
  });

  it('11.1 · mesa: para las balas bajas (agachado) y NO la vista de alguien de pie', () => {
    const L = lvl('mesa');
    const h = FURNITURE.mesa.bulletH;
    expect(h).toBeLessThan(1.0);
    expect(L.clear(2, 5, 0.5, 18, 5, 0.5, 'bullet')).toBe(false);   // bala baja: tapada
    expect(L.clear(2, 5, 1.4, 18, 5, 1.4, 'bullet')).toBe(true);    // bala a la altura del pecho: pasa por encima
    expect(L.clear(2, 5, EYE, 18, 5, CHEST, 'sight')).toBe(true);   // de pie se ve por encima
    expect(L.clear(2, 5, 0.5, 18, 5, 0.5, 'sight')).toBe(false);    // agachado no
    // girada 90° sigue igual (la tabla no depende del ángulo)
    const L2 = lvl('mesa', 90);
    expect(L2.clear(2, 5, 0.5, 18, 5, 0.5, 'bullet')).toBe(false);
    expect(L2.clear(2, 5, 1.4, 18, 5, 1.4, 'bullet')).toBe(true);
  });

  it('11.1 · silla: no tapa nada; butaca: para balas bajas y tapa la vista baja', () => {
    expect(lvl('silla').clear(2, 5, 0.5, 18, 5, 0.5, 'sight')).toBe(true);
    expect(lvl('silla').clear(2, 5, 0.5, 18, 5, 0.5, 'bullet')).toBe(true);
    expect(lvl('butaca').clear(2, 5, 0.4, 18, 5, 0.4, 'bullet')).toBe(false);
  });

  it('11.1 · valor por defecto restrictivo: un rayo con NaN cuenta como bloqueado', () => {
    const L = lvl('silla');
    expect(L.clear(2, 5, NaN, 18, 5, 1, 'sight')).toBe(false);
    expect(L.clear(2, 5, 1, NaN, 5, 1, 'bullet')).toBe(false);
  });
});
