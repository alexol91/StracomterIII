// v1.3 — oficios de enemigo (asaltante, tirador, granadero, blindado) y jefes de planta (ametrallador, embestida, escoltas).
//
// QUÉ CUBREN: el reparto por planta y los topes de vivos; que el láser del tirador acierta a quien no se mueve y falla a
// quien rueda o le corta la visión con humo; que el granadero no lanza con los suyos junto al blanco; el giro limitado
// del blindado; que la embestida aturde y expone al jefe cuando falla y pega cuando acierta; que las escoltas curan y su
// muerte enfurece; que el ametrallador avisa antes de barrer y queda expuesto (×1,5) al recargar.
//
// QUÉ NO CUBREN (modos de fallo que este doble NO reproduce):
//  - Nada de lo que se VE u OYE: que el láser, los pasillos y los círculos se dibujen donde la simulación dice, que el
//    aviso se lea desde la cámara en tercera persona, que los barks suenen. Aquí solo se comprueban sucesos y números.
//  - Los escenarios son un pasillo despejado con el director congelado y sin compañeros: no prueban los oficios dentro de
//    una pelea real (40 enemigos, puertas, muebles, humo a medias), ni que no se atasquen en mapas concretos. De eso solo
//    hay la medida indirecta de la partida del bot (prueba de topes y tools/partida.ts: «atascoMáx», «desatascos»).
//  - El «jugador» es una entrada escrita a mano: quieto, o una voltereta en el momento justo. No mide si una persona
//    tiene tiempo de reaccionar al aviso; eso hay que jugarlo.
//  - Asaltante: no se prueba su ruta de flanqueo (depende del mapa) ni que se le oiga venir.
//  - Equilibrio: no hay ninguna prueba de dificultad; se mide aparte con las campañas del bot.

import { describe, expect, it } from 'vitest';
import { applyBossVariant, applyVariant, damageTakenMult } from '../src/sim/ai_enemy';
import { directorConfig } from '../src/sim/campaign';
import {
  ASALTANTE, BLINDADO, BOSS_CHARGER, BOSS_ESCORTED, BOSS_EXPOSED_MULT, BOSS_GUNNER, BOSS_LATE, ENEMY_STATS, FLOOR_BOSS, GRANADERO, TIRADOR,
  VARIANT_ALIVE_CAP, VARIANT_SHARE,
} from '../src/sim/data';
import { assignVariants, variantCounts } from '../src/sim/director';
import { emptyInput, type EnemyKind, type EnemyVariant, type GameEvent, type PlayerInput, type Threat } from '../src/sim/types';
import { mulberry32, type Unit, type World } from '../src/sim/world';
import { playZone } from '../tools/partida';
import { DT, calmar, killAllies, place, quickWorld } from './helpers';

// ───────────── escenario: un pasillo despejado sacado del propio mapa ─────────────

interface Pasillo { world: World; a: [number, number]; b: [number, number]; yawAB: number; perp: [number, number]; inp: PlayerInput }

/**
 * Mundo quieto (director congelado, sin compañeros) con el jugador en `b` mirando a `a`, a `len` m en línea recta y
 * transitable, y con `side` m libres a un lado de `b` (hacia `perp`). Sale de la geometría del mapa, no de coordenadas a mano.
 */
function pasillo(len: number, side = 0, floor = 4): Pasillo {
  for (const zone of [5, 6, 3, 4, 1, 2]) {
    const { world } = quickWorld(floor, zone);
    const L = world.level;
    for (let y = L.oy + 1; y < L.oy + L.gh * 0.25 - 1; y += 1) for (let x = L.ox + 1; x < L.ox + L.gw * 0.25 - 1; x += 1) {
      if (!L.inside(x, y) || !L.walkableAt(x, y, false)) continue;
      for (let k = 0; k < 8; k++) {
        const ang = (k * Math.PI) / 4, dx = Math.cos(ang), dy = Math.sin(ang);
        const bx = x + dx * len, by = y + dy * len;
        if (!L.inside(bx, by) || !L.walkLine(x, y, bx, by, false)) continue;
        if (!L.clear(x, y, 1.5, bx, by, 1.5, 'sight') || !L.clear(x, y, 1.0, bx, by, 1.0, 'bullet') || !L.clear(x, y, 2.0, bx, by, 2.0, 'bullet')) continue;
        let perp: [number, number] | null = null;
        for (const s of [1, -1]) {
          const px = -dy * s, py = dx * s;
          if (side <= 0 || (L.walkLine(bx, by, bx + px * side, by + py * side, false) && L.clear(bx, by, 1.0, bx + px * side, by + py * side, 1.0, 'bullet'))) { perp = [px, py]; break; }
        }
        if (!perp) continue;
        calmar(world); killAllies(world);
        const yawBA = Math.atan2(y - by, x - bx);
        place(world, world.player, bx, by, yawBA);
        world.events.length = 0;
        return { world, a: [x, y], b: [bx, by], yawAB: Math.atan2(dy, dx), perp, inp: { ...emptyInput(), yaw: yawBA } };
      }
    }
  }
  throw new Error(`ningún pasillo despejado de ${len} m en la planta ${floor}`);
}

function poner(world: World, kind: EnemyKind | 'miniboss', x: number, y: number, yaw: number): Unit {
  const u = world.spawnUnit(kind, x, y, false);
  place(world, u, x, y, yaw);
  u.brain.faceYaw = yaw;
  return u;
}

/** Avanza hasta `seconds` o hasta que `stop` devuelva true; `each` ve los sucesos de cada paso. */
function correr(world: World, inp: PlayerInput, seconds: number, each: (evs: GameEvent[]) => boolean | void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { world.step(DT, inp); if (each(world.events)) return; }
}

function aviso(evs: GameEvent[], kind: Threat['kind'], ownerId: number): Threat | null {
  for (const e of evs) if (e.type === 'threat' && e.threat.kind === kind && e.threat.ownerId === ownerId) return e.threat;
  return null;
}

// ───────────── reparto ─────────────

describe('v1.3 · reparto de oficios', () => {
  const kindsFor = (n: number): EnemyKind[] => Array.from({ length: n }, (_, i) => (['enemy1', 'enemy2', 'enemy3'] as EnemyKind[])[i % 3]);

  it('porcentaje por planta, a partes iguales entre los desbloqueados', () => {
    expect(variantCounts(30, 1)).toEqual({ asaltante: 0, granadero: 0, tirador: 0, blindado: 0 });
    expect(variantCounts(30, 2)).toEqual({ asaltante: 3, granadero: 0, tirador: 0, blindado: 0 });
    expect(variantCounts(30, 3)).toEqual({ asaltante: 3, granadero: 3, tirador: 0, blindado: 0 });
    expect(variantCounts(30, 4)).toEqual({ asaltante: 2, granadero: 2, tirador: 2, blindado: 0 });
    expect(variantCounts(50, 5)).toEqual({ asaltante: 4, granadero: 4, tirador: 3, blindado: 3 }); // 28 % de 50 = 14
    expect(variantCounts(40, 8)).toEqual({ asaltante: 4, granadero: 4, tirador: 3, blindado: 3 }); // 35 % de 40 = 14
    for (let f = 1; f <= 9; f++) {
      const c = variantCounts(40, f);
      expect(c.asaltante + c.granadero + c.tirador + c.blindado, `planta ${f}`).toBe(Math.round(40 * VARIANT_SHARE[f]));
    }
  });

  it('sustituyen, no se añaden; es determinista con la semilla', () => {
    for (let f = 1; f <= 9; f++) {
      const kinds = kindsFor(45);
      const a = assignVariants(kinds, f, mulberry32(f * 1000 + 7)), b = assignVariants(kinds, f, mulberry32(f * 1000 + 7));
      expect(a.length).toBe(kinds.length);
      expect(a.map(s => s.kind)).toEqual(kinds);          // el tipo base no cambia
      expect(a).toEqual(b);
      const cnt = variantCounts(kinds.length, f);
      for (const v of Object.keys(cnt) as EnemyVariant[]) expect(a.filter(s => s.variant === v).length, `planta ${f} ${v}`).toBe(cnt[v]);
    }
  });

  it('el mundo real: mismo total de enemigos que sin oficios, y las estadísticas de cada oficio', () => {
    for (const floor of [2, 5, 8]) {
      const { world, state } = quickWorld(floor, 3);
      const cfg = directorConfig(state, floor, 'mediano');
      // juega el bot (invulnerable) hasta limpiar: se cuentan todos los que han existido
      const maxAlive: Record<string, number> = {};
      const orig = world.step.bind(world);
      world.step = (dt, input) => {
        orig(dt, input);
        const cnt: Record<string, number> = {};
        for (const e of world.entities) if (e.alive && e.team === 'enemy' && e.variant) cnt[e.variant] = (cnt[e.variant] || 0) + 1;
        for (const k in cnt) maxAlive[k] = Math.max(maxAlive[k] || 0, cnt[k]);
      };
      const r = playZone(world, 900, true);
      expect(r.result, `planta ${floor}`).toBe('cleared');
      const basics = world.entities.filter(e => e.team === 'enemy' && e.kind !== 'miniboss');
      expect(basics.length, `planta ${floor}: total`).toBe(cfg.total);
      for (const v of Object.keys(VARIANT_ALIVE_CAP) as EnemyVariant[]) expect(maxAlive[v] ?? 0, `planta ${floor}: ${v} vivos a la vez`).toBeLessThanOrEqual(VARIANT_ALIVE_CAP[v]);
      const withV = basics.filter(e => e.variant);
      if (floor === 2) expect(withV.every(e => e.variant === 'asaltante')).toBe(true);
      expect(withV.length, `planta ${floor}: oficios`).toBeGreaterThan(0);
      expect(withV.length).toBeLessThanOrEqual(Math.round(cfg.total * VARIANT_SHARE[floor]) + 2); // +2: acompañantes del jefe convertidos
      for (const e of withV) {
        const base = ENEMY_STATS[e.kind as EnemyKind];
        const mult = e.variant === 'asaltante' ? ASALTANTE.hpMult : e.variant === 'tirador' ? TIRADOR.hpMult : e.variant === 'blindado' ? BLINDADO.hpMult : 1;
        expect(e.maxHp).toBe(Math.round(base.hp * mult));
      }
      expect(r.maxStuck, `planta ${floor}: nadie atascado más de 2 s`).toBeLessThan(2);
    }
  }, 60000);

  it('jefes de planta: variante, nombre, vida de la segunda vuelta y acompañantes', () => {
    for (let floor = 2; floor <= 8; floor++) {
      const { world } = quickWorld(floor, 3);
      const boss = world.entities.find(e => e.kind === 'miniboss')!;
      expect(boss.bossVariant, `planta ${floor}`).toBe(FLOOR_BOSS[floor]);
      expect(boss.bossName).toBe('boss.' + FLOOR_BOSS[floor]);
      expect(boss.maxHp).toBe(Math.round(ENEMY_STATS.miniboss.hp * (floor >= BOSS_LATE.fromFloor ? BOSS_LATE.hpMult : 1)));
      const squad = boss.brain.squad.members as Unit[];
      if (floor === 5) {
        const esc = squad.filter(m => m.brain.escortOf === boss.id);
        expect(esc.length).toBe(BOSS_ESCORTED.escorts);
        expect(esc.every(m => m.kind === 'enemy2')).toBe(true);
      } else if (floor >= 6) {
        expect(squad.filter(m => m.variant === BOSS_LATE.companions[floor]).length, `planta ${floor}: acompañantes`).toBe(2);
      } else expect(squad.length).toBe(1);
    }
  });
});

// ───────────── tirador ─────────────

describe('v1.3 · tirador', () => {
  function montar(): Pasillo & { s: Unit } {
    const e = pasillo(16, 4);
    const s = poner(e.world, 'enemy3', e.a[0], e.a[1], e.yawAB);
    applyVariant(s, 'tirador');
    return { ...e, s };
  }

  it('avisa con un láser de 1,4 s y acierta a quien se queda quieto', () => {
    const { world, s, inp } = montar();
    const p = world.player;
    let th: Threat | null = null, hurt = 0, hurtAt = -1, shots = 0;
    correr(world, inp, 10, evs => {
      th = th ?? aviso(evs, 'laser', s.id);
      for (const ev of evs) {
        if (ev.type === 'shot' && ev.id === s.id) shots++;
        if (ev.type === 'hurt' && ev.id === p.id && ev.attackerId === s.id) { hurt += ev.amount; hurtAt = world.time; }
      }
      return hurt > 0;
    });
    expect(th, 'no ha habido aviso de láser').not.toBeNull();
    expect(th!.at - th!.from).toBeCloseTo(TIRADOR.aimTime, 2);
    expect(hurt).toBeCloseTo(TIRADOR.damage, 5);
    expect(hurtAt).toBeGreaterThanOrEqual(th!.at - DT);        // nunca antes de lo anunciado
    expect(shots).toBe(1);                                      // una sola bala
    expect(Math.hypot(th!.x - p.x, th!.y - p.y)).toBeLessThan(TIRADOR.hitRadius); // el aviso estaba donde pegó
    expect(world.threats.includes(th!)).toBe(false);
  });

  it('en difícil apunta 1,0 s', () => {
    const { world, s, inp } = montar();
    world.enemyAI.hard = true;
    let th: Threat | null = null;
    correr(world, inp, 10, evs => { th = aviso(evs, 'laser', s.id); return !!th; });
    expect(th!.at - th!.from).toBeCloseTo(TIRADOR.aimTimeHard, 2);
  });

  it('falla a quien rueda de lado justo antes del disparo', () => {
    const { world, s, inp } = montar();
    const p = world.player;
    let th: Threat | null = null, hurt = 0, shots = 0, rolled = false;
    correr(world, inp, 10, evs => {
      th = th ?? aviso(evs, 'laser', s.id);
      for (const ev of evs) {
        if (ev.type === 'shot' && ev.id === s.id) shots++;
        if (ev.type === 'roll') rolled = true;
        if (ev.type === 'hurt' && ev.id === p.id && ev.attackerId === s.id) hurt += ev.amount;
      }
      if (th && th.at - world.time < 0.4 && shots === 0) { inp.moveR = 1; inp.roll = !rolled; }
      return shots > 0;
    });
    expect(rolled, 'la voltereta no ha salido').toBe(true);
    expect(shots).toBe(1);   // disparó…
    expect(hurt).toBe(0);    // …al sitio donde ya no estaba
  });

  it('si el humo le corta la visión más de 0,3 s, cancela: ni aviso ni disparo', () => {
    const { world, s, inp, a, b } = montar();
    const p = world.player;
    let th: Threat | null = null, shots = 0, hurt = 0, goneAt = -1, smokeAt = -1;
    correr(world, inp, 10, evs => {
      const t = aviso(evs, 'laser', s.id);
      if (t && !th) {
        th = t; smokeAt = world.time;
        world.smokes.push({ id: 9001, x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, r: 3, from: world.time, until: world.time + 6 });
      }
      for (const ev of evs) {
        if (ev.type === 'shot' && ev.id === s.id) shots++;
        if (ev.type === 'hurt' && ev.id === p.id && ev.attackerId === s.id) hurt += ev.amount;
      }
      if (th && goneAt < 0 && !world.threats.includes(th)) goneAt = world.time;
      return !!th && world.time > smokeAt + 4;
    });
    expect(th).not.toBeNull();
    expect(goneAt).toBeGreaterThan(0);
    expect(goneAt - smokeAt).toBeLessThan(TIRADOR.losGrace + 0.15);
    expect(goneAt).toBeLessThan(th!.at);
    expect(shots).toBe(0);
    expect(hurt).toBe(0);
    expect(world.threats.some(t => t.kind === 'laser')).toBe(false); // y con el humo puesto no vuelve a apuntar
  });

  it('no dispara balas normales ni se acerca', () => {
    const { world, s, inp, b } = montar();
    world.cheats.god = true;
    const d0 = Math.hypot(s.x - b[0], s.y - b[1]);
    let dMin = d0;
    correr(world, inp, 6, () => { dMin = Math.min(dMin, Math.hypot(s.x - b[0], s.y - b[1])); });
    expect(dMin).toBeGreaterThan(d0 - 1);
    expect(s.mag).toBe(s.magSize);
  });
});

// ───────────── granadero ─────────────

describe('v1.3 · granadero', () => {
  function montar(): Pasillo & { g: Unit } {
    const e = pasillo(11, 0);
    e.world.cheats.god = true; // el jugador no se mueve ni muere: solo interesa si lanza
    const g = poner(e.world, 'enemy2', e.a[0], e.a[1], e.yawAB);
    applyVariant(g, 'granadero');
    g.pinnedUntil = 1e9;   // clavado no lanza… (se le suelta abajo) pero tampoco se va a buscar cobertura
    return { ...e, g };
  }
  const lanza = (world: World, g: Unit, inp: PlayerInput, seconds: number): boolean => {
    let thrown = false;
    correr(world, inp, seconds, evs => { for (const ev of evs) if (ev.type === 'throw' && ev.id === g.id) thrown = true; return thrown; });
    return thrown;
  };

  it('lanza una granada al blanco que lleva más de 2,5 s sin moverse', () => {
    const { world, g, inp } = montar();
    g.pinnedUntil = 0;
    world.hold = false;
    const t0 = world.time;
    expect(lanza(world, g, inp, 12)).toBe(true);
    expect(world.time - t0).toBeGreaterThan(GRANADERO.stillTime);
    expect(world.projectiles.some(pr => pr.kind === 'grenade' && pr.ownerId === g.id)).toBe(true);
  });

  it('clavado por Supresión no lanza', () => {
    const { world, g, inp } = montar();
    expect(lanza(world, g, inp, 9)).toBe(false);
  });

  it('no lanza si hay un compañero suyo a menos de 3,5 m del punto', () => {
    const { world, g, inp, b, yawAB } = montar();
    g.pinnedUntil = 0;
    // un compañero suyo pegado al jugador (clavado en el sitio para que no se aparte)
    const c = world.level.nearestFree(b[0] - Math.cos(yawAB) * 2, b[1] - Math.sin(yawAB) * 2, false, 3);
    const amigo = poner(world, 'enemy1', world.level.cellX(c), world.level.cellY(c), yawAB);
    amigo.pinnedUntil = 1e9;
    let dMax = 0;
    const thrown = (() => { let t = false; correr(world, inp, 12, evs => { dMax = Math.max(dMax, Math.hypot(amigo.x - b[0], amigo.y - b[1])); for (const ev of evs) if (ev.type === 'throw' && ev.id === g.id) t = true; return t; }); return t; })();
    expect(dMax, 'el escenario no vale: el compañero se ha alejado').toBeLessThan(GRANADERO.friendRadius);
    expect(thrown).toBe(false);
  });
});

// ───────────── blindado ─────────────

describe('v1.3 · blindado', () => {
  it('gira como mucho a 90°/s (un enemigo normal, a más del triple)', () => {
    const { world, a, yawAB, inp } = pasillo(8, 0);
    world.hold = true; // nadie ve ni oye: solo se mide el giro
    const giro = (u: Unit): number => {
      u.brain.waitUntil = 1e9;           // parado en su sitio
      u.brain.faceYaw = yawAB + 3.0;     // quiere mirar casi a su espalda
      const y0 = u.yaw;
      let turned = 0, prev = y0;
      correr(world, inp, 1, () => { let d = u.yaw - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; turned += Math.abs(d); prev = u.yaw; u.brain.faceYaw = yawAB + 3.0; });
      return turned;
    };
    const bl = poner(world, 'enemy3', a[0], a[1], yawAB);
    applyVariant(bl, 'blindado');
    const t1 = giro(bl);
    expect(t1).toBeLessThanOrEqual(BLINDADO.turnRate * 1 + 0.03);
    expect(t1).toBeGreaterThan(BLINDADO.turnRate * 0.9);
    world.kill(bl);
    const normal = poner(world, 'enemy3', a[0], a[1], yawAB);
    expect(giro(normal)).toBeGreaterThan(2.9);
  });

  it('avanza de frente sin buscar cobertura y se planta a su distancia', () => {
    const { world, a, b, yawAB, inp } = pasillo(12, 0);
    world.cheats.god = true;
    const bl = poner(world, 'enemy3', a[0], a[1], yawAB);
    applyVariant(bl, 'blindado');
    expect(bl.stats.speed).toBeCloseTo(ENEMY_STATS.enemy3.speed * BLINDADO.speedMult, 5);
    expect(bl.stats.rof).toBeCloseTo(ENEMY_STATS.enemy3.rof * BLINDADO.rofMult, 5);
    const states = new Set<string>();
    correr(world, inp, 9, () => { states.add(bl.aiState); });
    const d = Math.hypot(bl.x - b[0], bl.y - b[1]);
    expect(d).toBeLessThan(BLINDADO.stopDist + 1.2);
    expect(d).toBeGreaterThan(BLINDADO.stopDist - 1.5);
    expect(states.has('a cubierto') || states.has('cubierto') || states.has('rodea') || states.has('se repliega')).toBe(false);
    // encarado al jugador
    let da = Math.atan2(b[1] - bl.y, b[0] - bl.x) - bl.yaw; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    expect(Math.abs(da)).toBeLessThan(0.2);
  });

  it('con el escudo caído (aturdido) se queda quieto', () => {
    const { world, a, yawAB, inp } = pasillo(12, 0);
    world.cheats.god = true;
    const bl = poner(world, 'enemy3', a[0], a[1], yawAB);
    applyVariant(bl, 'blindado');
    correr(world, inp, 2, () => {});
    bl.staggerUntil = world.time + 2.5;
    correr(world, inp, 0.3, () => {}); // lo que tarda en frenar
    const x0 = bl.x, y0 = bl.y;
    correr(world, inp, 2, () => {});
    expect(Math.hypot(bl.x - x0, bl.y - y0)).toBeLessThan(0.1);
  });
});

// ───────────── jefe: embestida ─────────────

describe('v1.3 · jefe de embestida', () => {
  function montar(): Pasillo & { boss: Unit } {
    const e = pasillo(9, 3);
    const boss = poner(e.world, 'miniboss', e.a[0], e.a[1], e.yawAB);
    applyBossVariant(boss, 'embestida', 4);
    return { ...e, boss };
  }

  it('avisa 1 s con un pasillo y, si el blanco se aparta, falla: aturdido 2,5 s y expuesto (×1,5)', () => {
    const { world, boss, inp, b, perp } = montar();
    const p = world.player;
    let th: Threat | null = null, melee = 0, stunnedAt = -1, x0 = 0, y0 = 0;
    correr(world, inp, 12, evs => {
      const t = aviso(evs, 'charge', boss.id);
      if (t && !th) { th = t; x0 = boss.x; y0 = boss.y; place(world, p, b[0] + perp[0] * 3, b[1] + perp[1] * 3); }
      for (const ev of evs) if (ev.type === 'hurt' && ev.id === p.id && ev.attackerId === boss.id && ev.zone === 'knife') melee += ev.amount;
      if (th && stunnedAt < 0 && boss.brain.bs.phase === 'stun') stunnedAt = world.time;
      return stunnedAt > 0;
    });
    expect(th, 'no ha habido aviso de embestida').not.toBeNull();
    expect(th!.at - th!.from).toBeCloseTo(BOSS_CHARGER.telegraph, 2);
    expect(th!.r).toBe(BOSS_CHARGER.laneWidth);
    expect(Math.hypot(th!.x - th!.fx, th!.y - th!.fy)).toBeLessThanOrEqual(BOSS_CHARGER.maxDist + 0.01);
    expect(stunnedAt, 'no ha quedado aturdido').toBeGreaterThan(th!.at);
    expect(melee).toBe(0);
    expect(Math.hypot(boss.x - x0, boss.y - y0)).toBeGreaterThan(4);       // ha corrido de verdad
    expect(boss.staggerUntil - world.time).toBeGreaterThan(BOSS_CHARGER.stun - 0.1);
    expect(damageTakenMult(boss, world)).toBe(BOSS_EXPOSED_MULT);
    // el daño entra ×1,5 de verdad (daño directo: sin el arco frontal, que va en las balas)
    const hp = boss.hp;
    world.damage(boss, 10, p, 'torso', p.x, p.y);
    expect(hp - boss.hp).toBeCloseTo(10 * BOSS_EXPOSED_MULT, 5);
    // aturdido no se mueve; y al pasar la ventana deja de estar expuesto
    const sx = boss.x, sy = boss.y;
    correr(world, inp, BOSS_CHARGER.stun - 0.3, () => {});
    expect(Math.hypot(boss.x - sx, boss.y - sy)).toBeLessThan(0.15);
    correr(world, inp, 0.5, () => {});
    expect(damageTakenMult(boss, world)).toBe(1);
  });

  it('si el blanco no se aparta: 45 de daño, empujón, y el jefe NO queda aturdido', () => {
    const { world, boss, inp, b } = montar();
    const p = world.player;
    let th: Threat | null = null, melee = 0, hitAt = -1, stunned = false, maxPush = 0;
    correr(world, inp, 12, evs => {
      th = th ?? aviso(evs, 'charge', boss.id);
      for (const ev of evs) if (ev.type === 'hurt' && ev.id === p.id && ev.attackerId === boss.id && ev.zone === 'knife') { melee += ev.amount; hitAt = world.time; }
      if (th && boss.brain.bs.phase === 'stun') stunned = true;
      if (hitAt > 0) maxPush = Math.max(maxPush, Math.hypot(p.x - b[0], p.y - b[1]));
      return hitAt > 0 && world.time > hitAt + 0.5;
    });
    expect(melee).toBeCloseTo(BOSS_CHARGER.damage, 5);
    expect(hitAt).toBeGreaterThanOrEqual(th!.at - DT);
    expect(stunned).toBe(false);
    expect(damageTakenMult(boss, world)).toBe(1);
    expect(maxPush).toBeGreaterThan(0.2);
  });
});

// ───────────── jefe: escoltas ─────────────

describe('v1.3 · jefe de escoltas', () => {
  it('cada escolta viva y cerca cura 6/s; al morir las dos, se enfurece (cadencia ×1,3)', () => {
    const { world, a, b, yawAB, inp } = pasillo(8, 0);
    world.hold = true; // nadie pelea: solo curación y enfado
    const boss = poner(world, 'miniboss', a[0], a[1], yawAB);
    applyBossVariant(boss, 'escoltas', 5);
    const rof0 = boss.stats.rof;
    const dx = Math.cos(yawAB), dy = Math.sin(yawAB);
    const e1 = poner(world, 'enemy2', a[0] + dx * 1.5, a[1] + dy * 1.5, yawAB);
    const e2 = poner(world, 'enemy2', a[0] + dx * 3, a[1] + dy * 3, yawAB);
    for (const e of [e1, e2]) { e.brain.waitUntil = 1e9; world.enemyAI.makeEscort(e, boss); }
    boss.brain.waitUntil = 1e9;
    boss.hp = boss.maxHp - 100;
    let hp = boss.hp;
    correr(world, inp, 2, () => {});
    expect(boss.hp - hp).toBeCloseTo(2 * BOSS_ESCORTED.healPerSec * 2, 0);
    expect(e1.healTargetId).toBe(boss.id);
    expect(boss.enraged ?? false).toBe(false);
    // una escolta lejos (> 6 m) no cura
    place(world, e2, b[0], b[1]);
    hp = boss.hp;
    correr(world, inp, 2, () => {});
    expect(boss.hp - hp).toBeCloseTo(BOSS_ESCORTED.healPerSec * 2, 0);
    expect(e2.healTargetId).toBe(-1);
    // cae una: sigue sin enfurecerse
    world.kill(e2);
    correr(world, inp, 0.2, () => {});
    expect(boss.enraged ?? false).toBe(false);
    // caen las dos
    world.kill(e1);
    let bark = false;
    correr(world, inp, 0.2, evs => { for (const ev of evs) if (ev.type === 'bark' && ev.key === 'enemy.enraged' && ev.id === boss.id) bark = true; });
    expect(boss.enraged).toBe(true);
    expect(bark).toBe(true);
    expect(boss.stats.rof).toBeCloseTo(rof0 * BOSS_ESCORTED.enrageRof, 5);
    hp = boss.hp;
    correr(world, inp, 1, () => {});
    expect(boss.hp).toBe(hp); // ya no le cura nadie
  });

  it('un jefe de escoltas sin escoltas (consola) no se enfurece solo', () => {
    const { world, a, yawAB, inp } = pasillo(8, 0);
    world.hold = true;
    const boss = poner(world, 'miniboss', a[0], a[1], yawAB);
    applyBossVariant(boss, 'escoltas', 5);
    correr(world, inp, 1, () => {});
    expect(boss.enraged ?? false).toBe(false);
  });
});

// ───────────── jefe: ametrallador ─────────────

describe('v1.3 · jefe ametrallador', () => {
  it('avisa el pasillo 1,2 s antes de barrer, y al recargar queda quieto y expuesto (×1,5)', () => {
    const { world, a, b, yawAB, perp, inp } = pasillo(10, 3, 3);
    const p = world.player;
    const boss = poner(world, 'miniboss', a[0], a[1], yawAB);
    applyBossVariant(boss, 'ametrallador', 3);
    expect(boss.stats.explosive).toBe(false);
    let th: Threat | null = null, firstShot = -1, shots = 0, reloadAt = -1, hurtOut = 0, barkReload = false;
    correr(world, inp, 14, evs => {
      const t = aviso(evs, 'lane', boss.id);
      if (t && !th) { th = t; place(world, p, b[0] + perp[0] * 3, b[1] + perp[1] * 3); } // fuera del pasillo
      for (const ev of evs) {
        if (ev.type === 'shot' && ev.id === boss.id) { shots++; if (firstShot < 0) firstShot = world.time; }
        if (ev.type === 'hurt' && ev.id === p.id && ev.attackerId === boss.id && th) hurtOut += ev.amount;
        if (ev.type === 'bark' && ev.key === 'enemy.reloading' && ev.id === boss.id) barkReload = true;
      }
      if (th && reloadAt < 0 && boss.brain.bs.phase === 'reload') reloadAt = world.time;
      return reloadAt > 0;
    });
    expect(th, 'no ha habido aviso de pasillo').not.toBeNull();
    expect(th!.at - th!.from).toBeCloseTo(BOSS_GUNNER.telegraph, 2);
    expect(th!.r).toBe(BOSS_GUNNER.laneWidth);
    expect(firstShot).toBeGreaterThanOrEqual(th!.at - DT);                 // ni una bala antes del aviso
    expect(shots).toBe(Math.round(BOSS_GUNNER.rof * BOSS_GUNNER.sweep));   // vacía el cargador
    expect(hurtOut, 'fuera del pasillo no debe caer nada').toBe(0);
    expect(reloadAt - th!.at).toBeGreaterThan(BOSS_GUNNER.sweep - 0.3);
    expect(barkReload).toBe(true);
    expect(damageTakenMult(boss, world)).toBe(BOSS_EXPOSED_MULT);
    expect((boss.exposedUntil ?? 0) - world.time).toBeGreaterThan(BOSS_GUNNER.reload - 0.1);
    const hp = boss.hp;
    world.damage(boss, 10, p, 'torso', p.x, p.y);
    expect(hp - boss.hp).toBeCloseTo(10 * BOSS_EXPOSED_MULT, 5);
    // recargando no se mueve ni dispara
    const sx = boss.x, sy = boss.y; let during = 0;
    correr(world, inp, BOSS_GUNNER.reload - 0.2, evs => { for (const ev of evs) if (ev.type === 'shot' && ev.id === boss.id) during++; });
    expect(during).toBe(0);
    expect(Math.hypot(boss.x - sx, boss.y - sy)).toBeLessThan(0.15);
    correr(world, inp, 0.4, () => {});
    expect(damageTakenMult(boss, world)).toBe(1);
  });

  it('quien se queda en el pasillo recibe el barrido', () => {
    const { world, a, yawAB, inp } = pasillo(10, 0, 3);
    const p = world.player;
    const boss = poner(world, 'miniboss', a[0], a[1], yawAB);
    applyBossVariant(boss, 'ametrallador', 3);
    let hurt = 0, done = false;
    correr(world, inp, 14, evs => {
      for (const ev of evs) if (ev.type === 'hurt' && ev.id === p.id && ev.attackerId === boss.id) hurt += ev.amount;
      if (boss.brain.bs && boss.brain.bs.phase === 'reload') done = true;
      return done;
    });
    expect(done).toBe(true);
    expect(hurt).toBeGreaterThanOrEqual(BOSS_GUNNER.damage * 5);
    expect(hurt).toBeLessThanOrEqual(BOSS_GUNNER.damage * BOSS_GUNNER.rof * BOSS_GUNNER.sweep);
  });
});

// ───────────── multiplicador de daño ─────────────

describe('v1.3 · damageTakenMult', () => {
  it('por defecto 1: sin ventana anunciada (o sin dato) no hay daño extra; nunca aplica a los aliados', () => {
    const { world, a, yawAB } = pasillo(8, 0);
    const boss = poner(world, 'miniboss', a[0], a[1], yawAB);
    expect(damageTakenMult(boss, world)).toBe(1);
    boss.exposedUntil = world.time - 0.01;
    expect(damageTakenMult(boss, world)).toBe(1);
    boss.exposedUntil = world.time + 1;
    expect(damageTakenMult(boss, world)).toBe(BOSS_EXPOSED_MULT);
    world.player.exposedUntil = world.time + 1;
    expect(damageTakenMult(world.player, world)).toBe(1);
  });
});
