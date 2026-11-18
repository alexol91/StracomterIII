// IA de los enemigos: no se atascan, patrullan y oyen (DEFINICION §14; puntos 21.6 y 21.4).
//
// QUÉ MODOS DE FALLO NO CUBRE ESTE FICHERO:
//  - «No se atascan» se mide con world.stuckMax de la propia simulación (tiempo seguido queriendo moverse sin
//    conseguirlo), en cinco zonas jugadas por el bot en modo dios. Si el detector de atasco de la simulación no
//    contara un tipo de bloqueo (p. ej. dos enemigos empujándose en un hueco mientras uno «espera»), esta prueba no
//    lo vería; tampoco se ven los atascos que sólo ocurren con un jugador que se mueva como una persona.
//  - Sólo se juegan las zonas pedidas (planta 1 zonas 1, 3 y 5; planta 4 zona 3; planta 7 zona 5). Los mapas
//    generados de otras plantas/zonas pueden tener rincones donde sí se atasquen.
//  - «Patrullan» se mide en los 8 primeros segundos de UNA zona (planta 1 zona 5) con el jugador quieto y sin ser
//    visto: no cubre patrullas largas, rutas que cruzan puertas ni el regreso a patrullar tras perder al jugador.
//  - «Oyen» se prueba con enemigos sueltos (cada uno en su propia escuadra, sin ruta) colocados sin visión sobre el
//    jugador: no prueba la propagación del aviso entre miembros de una misma escuadra, ni el oído de pasos/puertas,
//    ni explosiones; y el disparo es el del jugador (ruido 30), no el de un compañero.
//  - Los enemigos puestos a mano se crean con spawnUnit y se les deja la IA por defecto: la forma en que el director
//    reparte los papeles (fijar, rodear, presionar) no entra en estas pruebas.

import { describe, expect, it } from 'vitest';
import { playZone } from '../tools/partida';
import { emptyInput } from '../src/sim/types';
import type { Unit, World } from '../src/sim/world';
import { DT, calmar, dist, killAllies, quickWorld, run } from './helpers';

describe('21.6 · no se atascan', () => {
  const zonas: [number, number][] = [[1, 1], [1, 3], [1, 5], [4, 3], [7, 5]];
  for (const [floor, zone] of zonas) {
    it(`21.6 · planta ${floor} zona ${zone} jugada por el bot (modo dios): ningún enemigo pasa de 3 s atascado`, () => {
      const { world } = quickWorld(floor, zone);
      const r = playZone(world, 900, true);
      const enemigos = world.entities.filter(e => e.team === 'enemy');
      expect(enemigos.length).toBeGreaterThan(5);
      const peor = enemigos.reduce((a, b) => (b.stuckMax > a.stuckMax ? b : a));
      console.log(`[21.6] P${floor}Z${zone}: ${enemigos.length} enemigos, stuckMax peor = ${peor.stuckMax.toFixed(2)} s (${peor.kind}#${peor.id}), ${r.unstuck} desatascos, resultado ${r.result} en ${r.time} s`);
      expect(r.maxStuck).toBeLessThan(3);
      for (const e of enemigos) expect(e.stuckMax, `${e.kind}#${e.id}`).toBeLessThan(3);
      // y la zona se pudo limpiar: un enemigo atascado donde no se le ve haría que nunca terminara
      expect(r.result).toBe('cleared');
    }, 120_000);
  }
});

describe('21.6 · patrullan', () => {
  it('21.6 · planta 1 zona 5, 8 s con el jugador quieto y sin disparar: al menos la mitad se desplaza > 1,5 m y patrulla', () => {
    const { world } = quickWorld(1, 5);
    const ini = world.entities.filter(e => e.team === 'enemy' && e.alive);
    expect(ini.length).toBeGreaterThanOrEqual(4);
    const origen = new Map(ini.map(e => [e.id, [e.x, e.y] as [number, number]]));
    const maxDesp = new Map(ini.map(e => [e.id, 0]));
    const estados = new Map<number, Set<string>>(ini.map(e => [e.id, new Set()]));
    const inp = emptyInput();
    run(world, 8, inp, () => {
      for (const e of ini) {
        const o = origen.get(e.id)!;
        maxDesp.set(e.id, Math.max(maxDesp.get(e.id)!, Math.hypot(e.x - o[0], e.y - o[1])));
        estados.get(e.id)!.add(e.aiState);
      }
    });
    const movidos = ini.filter(e => maxDesp.get(e.id)! > 1.5);
    const patrullando = ini.filter(e => e.aiState === 'patrulla');
    const movidosYPatrullando = movidos.filter(e => e.aiState === 'patrulla');
    console.log(`[21.6] patrulla P1Z5: ${ini.length} enemigos iniciales; ${movidos.length} se desplazan >1,5 m; ${patrullando.length} en estado 'patrulla' al final; ` +
      `estados vistos: ${[...new Set([...estados.values()].flatMap(s => [...s]))].join(', ')}`);
    expect(world.status).toBe('playing');
    expect(movidos.length, 'los que se han movido más de 1,5 m').toBeGreaterThanOrEqual(Math.ceil(ini.length / 2));
    expect(patrullando.length, 'los que están en estado «patrulla»').toBeGreaterThanOrEqual(Math.ceil(ini.length / 2));
    expect(movidosYPatrullando.length, 'movidos Y en «patrulla»').toBeGreaterThanOrEqual(Math.ceil(ini.length / 2));
  });

  it('21.6 · control: el desplazamiento se debe a la patrulla (sin ruta no se mueven): enemigo suelto sin escuadra no sale de su sitio', () => {
    const { world } = quickWorld(1, 5);
    calmar(world);
    killAllies(world);
    const e = world.spawnUnit('enemy1', world.player.x + 20, world.player.y, false);
    const x0 = e.x, y0 = e.y;
    run(world, 8);
    expect(dist(e, { x: x0, y: y0 })).toBeLessThan(0.5);
    expect(e.aiState).toBe('patrulla');
  });
});

// ───────────────────────── Oído (14) ─────────────────────────

/** Coloca `n` enemigos sueltos a 8-18 m andando del jugador y SIN línea de visión con él (en ningún sentido). */
function enemigosEscondidos(world: World, n: number): Unit[] {
  const p = world.player, L = world.level;
  const out: Unit[] = [];
  for (let gy = L.oy + 1; gy < L.oy + L.gh * 0.25 - 1 && out.length < n; gy += 1.5) {
    for (let gx = L.ox + 1; gx < L.ox + L.gw * 0.25 - 1 && out.length < n; gx += 1.5) {
      if (!L.inside(gx, gy) || !L.walkableAt(gx, gy, false)) continue;
      const wd = world.walkDistToPlayer(gx, gy);
      const d = Math.hypot(gx - p.x, gy - p.y);
      if (!(wd >= 8 && wd <= 18 && d >= 4 && d <= 16)) continue;
      if (out.some(o => Math.hypot(o.x - gx, o.y - gy) < 3)) continue;
      // sin visión en ninguno de los dos sentidos: sólo puede enterarse por el oído
      const hide = [0.9, 1.7].some(z => L.clear(p.x, p.y, 1.6, gx, gy, z, 'sight') || L.clear(gx, gy, 1.6, p.x, p.y, z, 'sight'));
      if (hide) continue;
      const u = world.spawnUnit('enemy1', gx, gy, false);
      u.yaw = Math.atan2(p.y - gy, p.x - gx) + Math.PI;     // mirando hacia otro lado
      out.push(u);
    }
  }
  return out;
}

describe('14 · oído', () => {
  const montar = (floor: number, zone: number) => {
    const { world } = quickWorld(floor, zone);
    calmar(world);
    killAllies(world);
    world.cheats.god = true;
    const p = world.player;
    const hits = enemigosEscondidos(world, 5);
    return { world, p, hits };
  };
  const mapas: [number, number][] = [[1, 1], [2, 1], [4, 2], [6, 1]];

  for (const [floor, zone] of mapas) {
    it(`14 · planta ${floor} zona ${zone}: control — sin disparar, ninguno pasa a «va a mirar» (el jugador quieto no hace ruido)`, () => {
      const { world, hits } = montar(floor, zone);
      expect(hits.length, 'enemigos ocultos que se han podido colocar').toBeGreaterThanOrEqual(2);
      let miraron = 0;
      run(world, 6, emptyInput(), () => { for (const e of hits) if (e.aiState === 'va a mirar') miraron++; });
      expect(miraron).toBe(0);
    });

    it(`14 · planta ${floor} zona ${zone}: el jugador dispara sin ser visto → varios pasan a «va a mirar» en < 3 s y se acercan al disparo`, () => {
      const { world, p, hits } = montar(floor, zone);
      expect(hits.length, 'enemigos ocultos que se han podido colocar').toBeGreaterThanOrEqual(2);
      run(world, 0.5);                                           // asentarse
      const d0 = new Map(hits.map(e => [e.id, dist(e, p)]));
      const inp = emptyInput();
      // dispara hacia delante: lo único relevante es el ruido del disparo (a 30 m por donde se anda)
      inp.fire = true;
      inp.yaw = p.yaw;
      const reaccion = new Map<number, number>();
      const t0 = world.time;
      while (world.time - t0 < 3) {
        world.step(DT, inp);
        p.mag = p.magSize;
        for (const e of hits) if (e.aiState === 'va a mirar' && !reaccion.has(e.id)) reaccion.set(e.id, world.time - t0);
      }
      const oyentes = hits.filter(e => reaccion.has(e.id));
      // seguir unos segundos más, ya sin disparar, para comprobar que de verdad se acercan
      inp.fire = false;
      run(world, 4, inp);
      const seAcercan = oyentes.filter(e => e.alive && dist(e, p) < d0.get(e.id)! - 1.0);
      console.log(`[14] P${floor}Z${zone}: ${hits.length} enemigos ocultos (a ${hits.map(e => d0.get(e.id)!.toFixed(0)).join(', ')} m); ` +
        `${oyentes.length} pasan a 'va a mirar' (en ${[...reaccion.values()].map(v => v.toFixed(2)).join(', ')} s); ${seAcercan.length} se acercan > 1 m`);
      expect(oyentes.length, 'enemigos que reaccionan al disparo en < 3 s').toBeGreaterThanOrEqual(2);
      for (const e of oyentes) expect(reaccion.get(e.id)!).toBeLessThan(3);
      expect(seAcercan.length, 'enemigos que además se acercan a la posición del disparo').toBeGreaterThanOrEqual(2);
      expect(world.status).not.toBe('dead');
    });
  }

  it('14 · el sonido se propaga por donde se anda: la puerta cerrada amortigua y el tabique obliga a rodear', () => {
    const { world } = quickWorld(1, 1);
    const door = world.level.doors.find(d => d.vertical && Math.abs(d.cy - 2.18) < 0.1)!;
    // soundDist tiene un presupuesto de cálculos por paso (restrictivo: sin presupuesto devuelve Infinity): un paso antes de cada consulta
    const consulta = (sx: number, sy: number, lx: number, ly: number) => { run(world, 1 / 60 * 2); return world.soundDist(sx, sy, lx, ly, 60); };
    const cerrada = consulta(5.6, door.cy, 3.2, door.cy);
    world.toggleDoor(door.id, true, null);
    const abierta = consulta(5.6, door.cy, 3.2, door.cy);
    expect(abierta).toBeLessThan(Infinity);
    expect(cerrada).toBeGreaterThan(abierta);                         // la puerta cerrada cuenta como un tramo largo
    world.toggleDoor(door.id, false, null);
    // el tabique macizo (sin pasar por la puerta) obliga a rodear: más largo que la recta
    const recta = Math.hypot(5.6 - 3.2, 0);
    const tabique = consulta(5.6, 3.2, 3.2, 3.2);
    expect(tabique).toBeGreaterThan(recta + 0.5);
  });
});
