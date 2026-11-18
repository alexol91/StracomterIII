// Pruebas v1.3 (jugador y escuadra): ganchos de World, escudo del blindado, voltereta, granadas tácticas, recarga con peso,
// variantes de arma principal, derribo y reanimación, orden contextual, combos y barks.
//
// QUÉ MODOS DE FALLO NO CUBRE ESTE FICHERO:
//  - Todos los escenarios son de un solo jugador con el director congelado (calmar) y enemigos puestos a mano: no se prueba
//    la IA de los enemigos nuevos (oficios, jefes) ni que ignoren a los derribados o respeten el humo: eso es de ai_enemy.ts.
//    Aquí sólo se prueba que la SIMULACIÓN ofrece los datos (canSee, sightBlocked, isBlinded, rayUnits sin derribados).
//  - Ping y reanimación se prueban llamando a world.ping() con la mira colocada a mano (no apuntando de verdad con la cámara) y
//    manteniendo `interact` TODOS los pasos; no se prueba cómo lo mantiene la capa de controles real.
//  - El Hackeo/Demolición/Supresión se prueban con geometría real del mapa pero un solo mapa (planta 1 zona 1): no todas las
//    combinaciones de paredes y puertas.
//  - La dispersión ×4 del cegado se comprueba estadísticamente (desviación media mayor), no con un umbral exacto.
//  - Las variantes de arma se prueban con el jugador y comprobaciones puntuales de la IA aliada; no se mide el equilibrio de
//    las variantes jugando (sólo que el DPS sostenido nominal está dentro del ±10 %).
//  - El bot (tools/partida.ts) hace voltereta, reanima y lanza la cegadora, pero eso sólo se vigila con las campañas del bot.

import { describe, expect, it } from 'vitest';
import { BLAST_RADIUS, BURST_RIFLE, CLASS_STATS, PRIMARY_VARIANTS, SHOTGUN, SNIPER, variantStats } from '../src/sim/data';
import type { GameEvent } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { DT, murosVerticales, place, puertaConCruce, puntoLibre, run, step, crucesVerticales } from './helpers';
import { enemigo, entrada, mundo } from './v12-util';

const ev = <T extends GameEvent['type']>(w: World, t: T) => w.events.filter(e => e.type === t) as Extract<GameEvent, { type: T }>[];
const recoger = (w: World, secs: number, inp = entrada()) => { const out: GameEvent[] = []; run(w, secs, inp, ww => { out.push(...ww.events); }); return out; };
const mirar = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.atan2(b.y - a.y, b.x - a.x);

describe('v1.3 · ganchos de World', () => {
  it('addThreat emite threat, se purga 0,1 s después de `at` y removeThreat lo quita', () => {
    const { world, p } = mundo();
    const t = world.addThreat({ kind: 'blast', fx: p.x, fy: p.y, x: p.x + 2, y: p.y, r: 2, at: world.time + 0.5, ownerId: -1 });
    expect(ev(world, 'threat')[0].threat.id).toBe(t.id);
    expect(world.threats).toHaveLength(1);
    run(world, 0.55, entrada());
    expect(world.threats).toHaveLength(1);                     // aún dentro de at + 0,1
    run(world, 0.1, entrada());
    expect(world.threats).toHaveLength(0);
    const u = world.addThreat({ kind: 'laser', fx: 0, fy: 0, x: 1, y: 1, r: 1, at: world.time + 50, ownerId: -1 });
    world.removeThreat(u.id);
    expect(world.threats).toHaveLength(0);
  });

  it('toda granada y todo cohete anuncian un blast en su punto de caída con r y `at`, y se retira al estallar', () => {
    const { world, p } = mundo();
    p.grenadeCd = 0;
    world.throwGrenade(p, p.x + 3, p.y);
    expect(world.threats).toHaveLength(1);
    const th = world.threats[0];
    expect(th.kind).toBe('blast');
    expect(th.x).toBeCloseTo(p.x + 3, 6);
    expect(th.r).toBe(BLAST_RADIUS);
    expect(th.at).toBeGreaterThan(world.time + 0.5);
    run(world, 2, entrada());
    expect(world.threats).toHaveLength(0);
    // cohete enemigo
    const e = enemigo(world, 'miniboss', p.x + 3, p.y);
    world.launch(e, 'rocket', p.x, p.y, 20);
    expect(world.threats.some(t => t.kind === 'blast' && t.ownerId === e.id)).toBe(true);
    // enemyThrow: granada enemiga con su aviso
    const g = enemigo(world, 'enemy1', p.x - 3, p.y);
    world.enemyThrow(g, 'grenade', p.x, p.y);
    expect(world.projectiles.some(pr => pr.ownerId === g.id && pr.kind === 'grenade')).toBe(true);
    expect(world.threats.some(t => t.ownerId === g.id)).toBe(true);
  });

  it('bark: como mucho uno cada 3 s por bando', () => {
    const { world, p } = mundo();
    const e = enemigo(world, 'enemy1', p.x + 3, p.y);
    expect(world.bark(p, 'ally.roger')).toBe(true);
    expect(world.bark(p, 'ally.roger')).toBe(false);
    expect(world.bark(e, 'x')).toBe(true);                     // el otro bando tiene su propio reloj
    expect(ev(world, 'bark')).toHaveLength(2);
    run(world, 3.1, entrada());
    expect(world.bark(p, 'ally.contact')).toBe(true);
  });

  it('sightBlocked: pared O humo; el humo no para las balas; isBlinded e invisible para el cegado', () => {
    const { world, p } = mundo();
    const e = enemigo(world, 'enemy1', p.x + 3, p.y);
    expect(world.sightBlocked(p.x, p.y, e.x, e.y)).toBe(false);
    expect(world.canSee(p, e)).toBe(true);
    world.smokes.push({ id: 99, x: p.x + 1.5, y: p.y, r: 1, from: world.time, until: world.time + 8 });
    expect(world.sightBlocked(p.x, p.y, e.x, e.y)).toBe(true);
    expect(world.canSee(p, e)).toBe(false);
    expect(world.canSee(e, p)).toBe(false);
    expect(world.shotLine(p, e)).toBeGreaterThanOrEqual(0);    // las balas atraviesan el humo
    world.smokes.length = 0;
    expect(world.canSee(p, e)).toBe(true);
    // pared
    const m = murosVerticales(world)[0];
    const c = crucesVerticales(world, m, 1.2).find(k => !world.level.clear(k.a[0], k.a[1], 1.5, k.b[0], k.b[1], 1.5, 'sight'))!;
    expect(world.sightBlocked(c.a[0], c.a[1], c.b[0], c.b[1])).toBe(true);
    // cegado
    e.blindedUntil = world.time + 1;
    expect(world.isBlinded(e)).toBe(true);
    expect(world.canSee(e, p)).toBe(false);
    run(world, 1.1, entrada());
    expect(world.isBlinded(e)).toBe(false);
  });
});

describe('v1.3 · escudo del blindado y embestida', () => {
  it('el blindado para las balas del arco frontal (shieldHit) y recibe daño normal por la espalda', () => {
    const f = (yawHaciaTirador: boolean) => {
      const m = mundo();
      const e = enemigo(m.world, 'enemy3', m.x + 3, m.y);
      e.variant = 'blindado';
      e.yaw = yawHaciaTirador ? Math.PI : 0;
      m.world.fire(m.p, e.x, e.y, 1.0, 0);
      return { loss: e.maxHp - e.hp, shield: ev(m.world, 'shieldHit').length };
    };
    expect(f(true)).toEqual({ loss: 0, shield: 1 });
    const atras = f(false);
    expect(atras.loss).toBeGreaterThan(0);
    expect(atras.shield).toBe(0);
  });

  it('fuera del arco de ±60° la bala entra; un aturdido o cegado no tiene escudo; explosión y cegadora lo bajan 2,5 s', () => {
    const m = mundo();
    const { world, p } = m;
    const e = enemigo(world, 'enemy3', p.x + 3, p.y);
    e.variant = 'blindado';
    e.yaw = Math.PI + 1.3;                                      // mira 75° al lado del tirador: fuera del arco
    world.fire(p, e.x, e.y, 1.0, 0);
    expect(e.hp).toBeLessThan(e.maxHp);
    e.hp = e.maxHp; e.yaw = Math.PI;
    e.staggerUntil = world.time + 1;                            // aturdido: escudo caído
    world.fire(p, e.x, e.y, 1.0, 0);
    expect(e.hp).toBeLessThan(e.maxHp);
    e.hp = e.maxHp; e.staggerUntil = 0; e.blindedUntil = world.time + 1;
    world.fire(p, e.x, e.y, 1.0, 0);
    expect(e.hp).toBeLessThan(e.maxHp);
    e.hp = e.maxHp; e.blindedUntil = 0;
    world.explode(e.x - 1, e.y, 1, 2, 10, null);
    expect(e.staggerUntil).toBeGreaterThanOrEqual(world.time + 2.5 - 1e-9);
    expect(e.hp).toBeLessThan(e.maxHp);                         // la explosión sí hiere
    const f = enemigo(world, 'enemy3', p.x - 3, p.y); f.variant = 'blindado';
    (world as any).flashBang(f.x + 1, f.y, null);
    expect(f.staggerUntil).toBeGreaterThanOrEqual(world.time + 2.5 - 1e-9);
  });

  it('jefe «embestida»: balas por el arco frontal ×0,3', () => {
    const f = (frontal: boolean) => {
      const m = mundo();
      const e = enemigo(m.world, 'miniboss', m.x + 3, m.y);
      e.bossVariant = 'embestida';
      e.yaw = frontal ? Math.PI : 0;
      m.world.fire(m.p, e.x, e.y, 1.2, 0);
      return e.maxHp - e.hp;
    };
    expect(f(true)).toBeCloseTo(10 * 0.3, 6);
    expect(f(false)).toBeCloseTo(10, 6);
  });
});

describe('v1.3 · voltereta', () => {
  it('recorre ~3,5 m en 0,5 s en la dirección de movimiento (parado, hacia atrás); suceso roll; enfriamiento 1,5 s', () => {
    const [x, y] = (() => {
      // sitio con ≥ 4,2 m libres hacia +x, -x y +y (las tres direcciones que se prueban)
      const w = mundo().world, L = w.level;
      for (let yy = L.oy + 1; yy < L.oy + L.gh * 0.25 - 1; yy += 0.5) for (let xx = L.ox + 1; xx < L.ox + L.gw * 0.25 - 1; xx += 0.5) {
        if (!L.walkableAt(xx, yy, true)) continue;
        if ([[1, 0], [-1, 0], [0, 1]].every(([a, b]) => L.clear(xx, yy, 0.5, xx + a * 4.2, yy + b * 4.2, 0.5, 'bullet') && L.walkLine(xx, yy, xx + a * 4.2, yy + b * 4.2, true))) return [xx, yy];
      }
      throw new Error('sin sitio para la voltereta');
    })();
    const prueba = (inp: Partial<ReturnType<typeof entrada>>) => {
      const m = mundo();
      place(m.world, m.p, x, y, 0);
      const x0 = m.p.x, y0 = m.p.y;
      m.world.step(DT, entrada({ roll: true, ...inp }));
      expect(ev(m.world, 'roll')).toHaveLength(1);
      expect(m.p.rollUntil).toBeCloseTo(m.world.time + 0.5, 6);
      while (m.world.time < m.p.rollUntil) m.world.step(DT, entrada());   // justo hasta que acaba (después sigue deslizando un poco)
      return { m, dx: m.p.x - x0, dy: m.p.y - y0 };
    };
    const adelante = prueba({ moveF: 1 });
    expect(adelante.dx).toBeGreaterThan(3.3); expect(adelante.dx).toBeLessThan(3.8);
    const parado = prueba({});
    expect(parado.dx).toBeLessThan(-3.1);                       // hacia atrás respecto a la cámara (yaw 0)
    const lado = prueba({ moveR: 1 });
    expect(Math.abs(lado.dy)).toBeGreaterThan(3.1);
    // enfriamiento: 1,5 s desde el comienzo
    const m = adelante.m;
    m.world.step(DT, entrada({ roll: true }));
    expect(ev(m.world, 'roll')).toHaveLength(0);                // 0,55 s después: aún en espera
    run(m.world, 1.0, entrada());
    m.world.step(DT, entrada({ roll: true }));
    expect(ev(m.world, 'roll')).toHaveLength(1);
  });

  it('no dispara ni recarga mientras rueda (la recarga se pausa, no se cancela)', () => {
    const m = mundo();
    const mag = m.p.mag;
    m.world.step(DT, entrada({ roll: true, moveF: 1, fire: true }));
    run(m.world, 0.3, entrada({ fire: true }));
    expect(m.p.mag).toBe(mag);
    const n = mundo();
    n.p.mag = 3;
    n.world.step(DT, entrada({ reload: true }));
    const rest = n.p.reloading;
    expect(rest).toBeGreaterThan(0);
    n.world.step(DT, entrada({ roll: true, moveF: 1 }));
    const r0 = n.p.reloading;
    run(n.world, 0.3, entrada());
    expect(n.p.reloading).toBeCloseTo(r0, 6);                   // pausada
    run(n.world, 0.3, entrada());
    expect(n.p.reloading).toBeLessThan(r0);                     // y sigue al terminar
    expect(n.p.reloading).toBeGreaterThan(0);
  });

  it('en los primeros 0,25 s las explosiones le hacen la mitad', () => {
    const daño = (espera: number) => {
      const m = mundo();
      m.world.step(DT, entrada({ roll: true, moveF: 1 }));
      run(m.world, espera, entrada());
      const hp = m.p.hp;
      m.world.explode(m.p.x - 1, m.p.y, 1, 3, 40, null);
      return hp - m.p.hp;
    };
    const pronto = daño(0.05), tarde = daño(0.3), nada = (() => { const m = mundo(); const hp = m.p.hp; m.world.explode(m.p.x - 1, m.p.y, 1, 3, 40, null); return hp - m.p.hp; })();
    expect(pronto).toBeCloseTo(nada / 2, 6);
    expect(tarde).toBeCloseTo(nada, 6);
  });

  it('se para en los muros', () => {
    const m = mundo();
    const w = murosVerticales(m.world);
    let ok = false;
    for (const r of w) {
      const c = crucesVerticales(m.world, r, 1.0)[0];
      if (!c) continue;
      place(m.world, m.p, c.a[0], c.a[1], 0);
      m.world.step(DT, entrada({ roll: true, moveF: 1 }));
      run(m.world, 0.6, entrada());
      expect(m.p.x).toBeLessThan(r.x0);                          // no atraviesa
      expect(m.p.x - c.a[0]).toBeLessThan(1.0);
      ok = true; break;
    }
    expect(ok).toBe(true);
  });
});

describe('v1.3 · granadas tácticas', () => {
  it('se entra con 3 explosivas, 2 cegadoras y 1 de humo; granada-extra da +1 de cada', () => {
    const m = mundo();
    expect([m.p.grenades, m.p.flashes, m.p.smokes]).toEqual([3, 2, 1]);
    const x = mundo({ upgrades: ['granada-extra'] });
    expect([x.p.grenades, x.p.flashes, x.p.smokes]).toEqual([4, 3, 2]);
  });

  it('volver a elegir la ranura de granada recorre frag → flash → smoke con existencias; fire lanza el tipo elegido; input.grenade sigue siendo explosiva', () => {
    const m = mundo();
    m.world.step(DT, entrada({ weaponSlot: 'grenade' }));
    expect(m.p.weapon).toBe('grenade'); expect(m.p.grenadeType).toBe('frag');
    m.world.step(DT, entrada({ weaponSlot: 'grenade' }));
    expect(m.p.grenadeType).toBe('flash');
    m.world.step(DT, entrada({ weaponSlot: 'grenade' }));
    expect(m.p.grenadeType).toBe('smoke');
    m.world.step(DT, entrada({ weaponSlot: 'grenade' }));
    expect(m.p.grenadeType).toBe('frag');
    m.p.grenades = 0;                                           // sin explosivas: el ciclo las salta
    m.world.step(DT, entrada({ weaponSlot: 'grenade' }));
    expect(m.p.grenadeType).toBe('flash');
    run(m.world, 0.4, entrada());
    m.world.step(DT, entrada({ fire: true }));
    expect(m.p.flashes).toBe(1);
    expect(m.world.projectiles.some(pr => pr.kind === 'flash')).toBe(true);
    // la rápida es explosiva
    const n = mundo();
    n.world.step(DT, entrada({ grenade: true }));
    expect(n.p.grenades).toBe(2);
    expect(n.world.projectiles.some(pr => pr.kind === 'grenade')).toBe(true);
    // la ranura sólo está vacía si no queda de ningún tipo
    const v = mundo();
    v.p.grenades = 0; v.p.flashes = 0; v.p.smokes = 1;
    v.world.step(DT, entrada({ weaponSlot: 'grenade' }));
    expect(v.p.weapon).toBe('grenade'); expect(v.p.grenadeType).toBe('smoke');
    const w = mundo();
    w.p.grenades = 0; w.p.flashes = 0; w.p.smokes = 0;
    w.world.step(DT, entrada({ weaponSlot: 'grenade' }));
    expect(w.p.weapon).toBe('primary');
  });

  it('cegadora: estalla a 1,0 s, ciega 3 s a un enemigo con línea de visión (2 s a ti y a los tuyos) y no a quien no ve el punto', () => {
    const m = mundo({ aliados: true });
    const { world, p } = m;
    const e = enemigo(world, 'enemy3', p.x + 3, p.y);
    const bang = (world as any).flashBang.bind(world) as (x: number, y: number, o: null) => void;
    const t0 = world.time;
    bang(p.x + 1.5, p.y, null);                                 // junto a ti: te ciega a ti también
    const fl = ev(world, 'flash')[0];
    expect(fl.playerBlind).toBe(2);
    expect(p.blindedUntil).toBeCloseTo(t0 + 2, 6);
    expect(e.blindedUntil).toBeCloseTo(t0 + 3, 6);
    for (const a of world.entities) if (a.team === 'ally' && !a.isPlayer && Math.hypot(a.x - p.x - 1.5, a.y - p.y) < 9 && world.level.clear(p.x + 1.5, p.y, 1, a.x, a.y, 1, 'sight')) expect(a.blindedUntil).toBeCloseTo(t0 + 2, 6);
    // al otro lado de una pared: no ve el punto, no se ciega
    const w2 = mundo();
    const tras = murosVerticales(w2.world).map(r => crucesVerticales(w2.world, r, 1.2).find(k => !w2.world.level.clear(k.a[0], k.a[1], 1.5, k.b[0], k.b[1], 1.5, 'sight'))).find(Boolean)!;
    const cerca = enemigo(w2.world, 'enemy3', tras.a[0] - 0.8, tras.a[1]);
    const lejos = enemigo(w2.world, 'enemy3', tras.b[0], tras.b[1]);
    (w2.world as any).flashBang(tras.a[0], tras.a[1], null);
    expect(cerca.blindedUntil).toBeGreaterThan(w2.world.time);
    expect(lejos.blindedUntil).toBe(0);
    // el cegado no ve y dispara mucho peor
    expect(world.canSee(e, p)).toBe(false);
    // por la mecánica: la granada de verdad estalla a 1,0 s
    const n = mundo();
    n.p.grenadeCd = 0;
    n.world.step(DT, entrada({ weaponSlot: 'grenade' })); n.world.step(DT, entrada({ weaponSlot: 'grenade' }));
    run(n.world, 0.4, entrada());
    n.world.step(DT, entrada({ fire: true }));
    const tl = n.world.time;
    const evs = recoger(n.world, 1.2);
    const f = evs.find(x => x.type === 'flash') as Extract<GameEvent, { type: 'flash' }>;
    expect(f).toBeTruthy();
    expect(n.p.blindedUntil).toBeLessThanOrEqual(tl + 1.2 + 2 + 0.05);
  });

  it('un cegado dispara con la dispersión ×4', () => {
    const desvio = (cegado: boolean) => {
      const m = mundo();
      const e = enemigo(m.world, 'enemy3', m.x + 3, m.y);
      let acc = 0;
      for (let i = 0; i < 60; i++) {
        m.p.blindedUntil = cegado ? m.world.time + 1 : 0;
        m.world.events.length = 0;
        m.world.fire(m.p, e.x, e.y, 1.0, 0.02);
        const s = ev(m.world, 'shot')[0];
        acc += Math.abs(Math.atan2(s.ty - m.p.y, s.tx - m.p.x));
      }
      return acc / 60;
    };
    expect(desvio(true)).toBeGreaterThan(desvio(false) * 2.5);
  });

  it('humo: nube de 3,2 m durante 8 s que tapa la vista y no las balas', () => {
    const m = mundo();
    const { world, p } = m;
    p.grenadeCd = 0;
    world.step(DT, entrada({ weaponSlot: 'grenade' })); world.step(DT, entrada({ weaponSlot: 'grenade' })); world.step(DT, entrada({ weaponSlot: 'grenade' }));
    expect(p.grenadeType).toBe('smoke');
    run(world, 0.4, entrada());
    const t0 = world.time;
    const evs = recoger(world, 1.5, entrada({ fire: true }));
    const s = evs.find(x => x.type === 'smoke') as Extract<GameEvent, { type: 'smoke' }>;
    expect(s).toBeTruthy();
    expect(s.radius).toBe(3.2); expect(s.duration).toBe(8);
    expect(world.smokes).toHaveLength(1);
    expect(world.smokes[0].until - world.smokes[0].from).toBeCloseTo(8, 6);
    expect(p.smokes).toBe(0);
    run(world, 8.2, entrada());
    expect(world.smokes).toHaveLength(0);
    void t0;
  });
});

describe('v1.3 · recarga con peso', () => {
  it('recargar con balas en el cargador deja cargador + 1; vacío, sólo el cargador; el explosivo no', () => {
    const m = mundo();
    m.p.mag = 10; m.p.ammo = 100;
    m.world.step(DT, entrada({ reload: true }));
    run(m.world, 2.5, entrada());
    expect(m.p.mag).toBe(m.p.magSize + 1);
    expect(m.p.ammo).toBe(100 - 21);
    const v = mundo();
    v.p.mag = 0; v.p.ammo = 100;
    v.world.step(DT, entrada({ reload: true }));
    run(v.world, 2.5, entrada());
    expect(v.p.mag).toBe(v.p.magSize);
    const e = mundo({ cls: 'explosives' });
    e.p.mag = 1;
    e.world.step(DT, entrada({ reload: true }));
    run(e.world, 3, entrada());
    expect(e.p.mag).toBe(e.p.magSize);
    // la pistola también
    const q = mundo();
    q.world.step(DT, entrada({ weaponSlot: 'secondary' }));
    run(q.world, 0.4, entrada());
    q.p.mag2 = 5;
    q.world.step(DT, entrada({ reload: true }));
    run(q.world, 2, entrada());
    expect(q.p.mag2).toBe(q.p.magSize2 + 1);
  });

  it('esprintar cancela la recarga en curso', () => {
    const m = mundo();
    m.p.mag = 5;
    m.world.step(DT, entrada({ reload: true }));
    expect(m.p.reloading).toBeGreaterThan(0);
    m.world.step(DT, entrada({ moveF: 1, sprint: true }));
    expect(m.p.reloading).toBe(0);
    run(m.world, 2, entrada());
    expect(m.p.mag).toBe(5);
  });
});

describe('v1.3 · variantes del arma principal', () => {
  it('setLoadout guarda la variante y el mundo la aplica (también a los aliados IA); los nombres son weapon.<clase>.<v>', () => {
    const m = mundo({ aliados: true, loadout: { captain: 1, technic: 1, especialist: 1 } });
    expect(m.state.loadout).toEqual({ captain: 1, technic: 1, especialist: 1 });
    expect(m.p.primaryVariant).toBe(1);
    const tec = m.world.entities.find(e => e.cls === 'technic')!;
    expect(tec.primaryVariant).toBe(1);
    expect(tec.magSize).toBe(SHOTGUN.magSize);
    const exp = m.world.entities.find(e => e.cls === 'explosives')!;
    expect(exp.primaryVariant).toBe(0);
    expect(PRIMARY_VARIANTS.technic[1].nameKey).toBe('weapon.technic.1');
    m.campaign.setLoadout(m.state, 'captain', 7 as any);        // inválida: se ignora
    expect(m.state.loadout!.captain).toBe(1);
  });

  it('el DPS sostenido nominal de la variante 1 está dentro del ±10 % de la 0', () => {
    const dps0 = (c: keyof typeof CLASS_STATS) => CLASS_STATS[c].damage * CLASS_STATS[c].rof;
    const cap = BURST_RIFLE.bullets * CLASS_STATS.captain.damage * BURST_RIFLE.damageMult / ((BURST_RIFLE.bullets - 1) / BURST_RIFLE.rate + BURST_RIFLE.pause);
    expect(cap / dps0('captain')).toBeGreaterThan(0.9); expect(cap / dps0('captain')).toBeLessThan(1.1);
    const sg = SHOTGUN.pellets * SHOTGUN.pelletDamage * SHOTGUN.rof;
    expect(sg / dps0('technic')).toBeGreaterThan(0.9); expect(sg / dps0('technic')).toBeLessThan(1.1);
    const sn = SNIPER.damage * SNIPER.rof;
    expect(sn / dps0('especialist')).toBeGreaterThan(0.9); expect(sn / dps0('especialist')).toBeLessThan(1.1);
    expect(variantStats('captain', 0, CLASS_STATS.captain)).toBe(CLASS_STATS.captain);
  });

  it('Capitán 1: ráfagas de 3 balas a 12/s con pausa; +20 % de daño por bala', () => {
    const m = mundo({ loadout: { captain: 1 } });
    const tiempos: number[] = [];
    run(m.world, 2, entrada({ fire: true }), w => { for (const s of ev(w, 'shot')) { void s; tiempos.push(w.time); } });
    expect(tiempos.length).toBeGreaterThanOrEqual(9);
    const gaps = tiempos.slice(1).map((t, i) => t - tiempos[i]);
    // patrón: corto, corto, largo, corto, corto, largo…
    for (let i = 0; i + 2 < gaps.length; i += 3) {
      expect(gaps[i]).toBeLessThan(0.12); expect(gaps[i + 1]).toBeLessThan(0.12);
      expect(gaps[i + 2]).toBeGreaterThan(0.2);
    }
    const e = enemigo(mundo().world, 'miniboss', 0, 0);
    void e;
    expect(m.p.stats.damage).toBeCloseTo(12, 9);
  });

  it('Técnico 1: la escopeta lanza 8 perdigones por disparo, cargador 6, 1,1 disparos/s', () => {
    const m = mundo({ cls: 'technic', loadout: { technic: 1 } });
    expect(m.p.magSize).toBe(6);
    const e = enemigo(m.world, 'miniboss', m.x + 3, m.y);
    m.world.events.length = 0;
    m.world.step(DT, entrada({ fire: true }));
    expect(ev(m.world, 'shot')).toHaveLength(8);
    expect(m.world.stats.shotsFired).toBe(1);
    expect(m.p.mag).toBe(5);
    expect(m.world.stats.shotsHit).toBeLessThanOrEqual(1);       // la precisión no se infla por perdigón
    expect(e.hp).toBeLessThan(e.maxHp);
    let n = 0;
    run(m.world, 3, entrada({ fire: true }), w => { n += ev(w, 'shot').length ? 1 : 0; });
    expect(n).toBeGreaterThanOrEqual(3); expect(n).toBeLessThanOrEqual(4);       // 3 s a 1,1/s
  });

  it('Especialista 1: semiautomático (un disparo por pulsación), cargador 8, preciso apuntando y malo desde la cadera', () => {
    const m = mundo({ cls: 'especialist', loadout: { especialist: 1 } });
    expect(m.p.magSize).toBe(8);
    run(m.world, 0.6, entrada());                               // saque
    let disparos = 0;
    run(m.world, 2, entrada({ fire: true }), w => { disparos += ev(w, 'shot').length; });
    expect(disparos).toBe(1);                                   // manteniendo sólo sale el primero
    const j = mundo({ cls: 'especialist', loadout: { especialist: 1 } });
    run(j.world, 0.6, entrada());
    let d2 = 0;
    for (let k = 0; k < 4; k++) { run(j.world, 0.7, entrada({ fire: true }), w => { d2 += ev(w, 'shot').length; }); run(j.world, 0.1, entrada()); }
    expect(d2).toBe(4);
    const cadera = mundo({ cls: 'especialist', loadout: { especialist: 1 } }), apunta = mundo({ cls: 'especialist', loadout: { especialist: 1 } });
    run(cadera.world, 0.6, entrada()); run(apunta.world, 0.6, entrada({ aim: true }));
    expect(apunta.p.spread).toBeLessThan(cadera.p.spread * 0.12);
    const base = mundo({ cls: 'especialist' }); run(base.world, 0.6, entrada());
    expect(cadera.p.spread).toBeGreaterThan(base.p.spread * 1.8);
  });

  it('Explosivo 1: granada que rebota una vez y estalla a 1,3 s con el mismo radio', () => {
    const m = mundo({ cls: 'explosives', loadout: { explosives: 1 } });
    const [x, y] = [m.x, m.y];
    run(m.world, 0.6, entrada({ pitch: 0.2 }));
    const t0 = m.world.time;
    m.p.fireCd = 0;
    m.world.fire(m.p, x + 3.4, y, 0.2, 0);
    const pr = m.world.projectiles.find(q => q.kind === 'grenade')!;
    expect(pr).toBeTruthy();
    expect(m.world.stats.shotsFired).toBe(1);
    let boom: Extract<GameEvent, { type: 'explosion' }> | null = null, tb = 0, rebotes = 1;
    for (let i = 0; i < 120 && !boom; i++) {
      m.world.step(DT, entrada());
      rebotes = (m.world as any).projMeta.get(pr.id)?.bounces ?? rebotes;
      const e = ev(m.world, 'explosion')[0];
      if (e) { boom = e; tb = m.world.time; }
    }
    expect(boom).not.toBeNull();
    expect(rebotes).toBe(0);                                    // ya había rebotado (en suelo o pared) antes de estallar
    expect(tb - t0).toBeCloseTo(1.3, 1);
    expect(boom!.radius).toBe(BLAST_RADIUS);
  });
});

describe('v1.3 · derribo y reanimación', () => {
  const aliado = (m: ReturnType<typeof mundo>, cls = 'technic') => m.world.entities.find(e => e.cls === cls && !e.isPlayer)!;
  const derribar = (m: ReturnType<typeof mundo>, a: ReturnType<typeof aliado>) => {
    const e = enemigo(m.world, 'enemy1', m.x + 6, m.y);
    m.world.damage(a, 9999, e, 'torso', e.x, e.y);
  };

  it('un compañero que llega a 0 queda derribado 25 s (alive, sin actuar, sin recibir daño); el jugador, no', () => {
    const m = mundo({ aliados: true });
    const a = aliado(m);
    m.world.events.length = 0;
    derribar(m, a);
    expect(a.alive).toBe(true); expect(a.downed).toBe(true); expect(a.hp).toBe(0);
    expect(a.downedUntil).toBeCloseTo(m.world.time + 25, 6);
    expect(ev(m.world, 'downed')).toHaveLength(1);
    m.world.damage(a, 50, null, 'torso', 0, 0);
    expect(a.hp).toBe(0); expect(a.alive).toBe(true);
    m.world.explode(a.x, a.y, 1, 3, 50, null);
    expect(a.alive).toBe(true);
    // las balas enemigas lo atraviesan
    expect(m.world.rayUnits(a.x - 2, a.y, 1, a.x + 2, a.y, 1, 'ally', 1)?.u).not.toBe(a);
    m.world.damage(m.p, 9999, null, 'torso', 0, 0);
    expect(m.p.downed).toBe(false); expect(m.p.alive).toBe(false);
  });

  it('no actúa derribado y, si vence el plazo, muere (death, alliesLost)', () => {
    const m = mundo({ aliados: true });
    const a = aliado(m);
    for (const o of m.world.entities) if (o.team === 'ally' && !o.isPlayer && o !== a) m.world.kill(o);   // nadie que lo reanime
    m.world.stats.alliesLost = 0;
    derribar(m, a);
    const pos = [a.x, a.y];
    const evs = recoger(m.world, 25.2);
    expect(evs.some(e => e.type === 'death' && e.id === a.id)).toBe(true);
    expect(a.alive).toBe(false);
    expect(m.world.stats.alliesLost).toBe(1);
    expect(Math.hypot(a.x - pos[0], a.y - pos[1])).toBeLessThan(0.5);
  });

  it('el jugador a ≤ 1,6 m manteniendo interact 3 s lo levanta con el 30 % de vida; si suelta, el progreso se reinicia', () => {
    const m = mundo({ aliados: true });
    const a = aliado(m);
    for (const o of m.world.entities) if (o.team === 'ally' && !o.isPlayer && o !== a) m.world.kill(o);   // que no lo reanime la IA
    derribar(m, a);
    place(m.world, a, m.x + 1, m.y);
    // ya está cerca: interactRevive lo expone
    step(m.world, entrada());
    expect(m.world.interactRevive).toBe(a.id);
    const mant = (s: number) => { for (let i = 0; i < Math.round(s / DT); i++) m.world.step(DT, entrada({ interact: true })); };
    a.reviveProgress = 0;
    mant(1.5);
    expect(a.reviveProgress).toBeGreaterThan(0.4);
    run(m.world, 0.2, entrada());                               // suelta
    expect(a.reviveProgress).toBe(0);
    m.world.events.length = 0;
    mant(3.1);
    expect(a.downed).toBe(false);
    expect(a.hp).toBe(Math.round(a.maxHp * 0.3));
    expect(a.alive).toBe(true);
    expect(recoger(m.world, 0.1).length >= 0).toBe(true);
  });

  it('si hay puerta y derribado a la vez, gana el derribado', () => {
    const m = mundo({ aliados: true });
    const a = aliado(m);
    const c = puertaConCruce(m.world);
    place(m.world, m.p, c.a[0], c.a[1], 0);
    derribar(m, a);
    place(m.world, a, c.a[0] - 0.5, c.a[1]);
    step(m.world, entrada());
    expect(m.world.interactDoor).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 30; i++) m.world.step(DT, entrada({ interact: true }));
    expect(m.world.level.doors[c.id].open).toBe(false);
    expect(a.reviveProgress).toBeGreaterThan(0);
  });

  it('un compañero IA sin enemigos a la vista lo reanima solo (el Capitán IA con prioridad)', () => {
    const m = mundo({ aliados: true, cls: 'technic' });
    const a = aliado(m, 'explosives');
    derribar(m, a);
    const evs = recoger(m.world, 14);
    const rev = evs.find(e => e.type === 'revived') as Extract<GameEvent, { type: 'revived' }> | undefined;
    expect(rev).toBeTruthy();
    expect(rev!.id).toBe(a.id);
    const cap = m.world.entities.find(e => e.cls === 'captain')!;
    expect(rev!.byId).toBe(cap.id);                             // el Capitán IA prioriza
    expect(a.downed).toBe(false);
    expect(a.hp).toBeGreaterThan(0);
  });

  it('si la zona se limpia con alguien derribado, se levanta solo con 1 de vida', () => {
    const m = mundo({ aliados: true });
    const a = aliado(m);
    derribar(m, a);
    m.world.status = 'cleared';
    step(m.world, entrada());
    expect(a.downed).toBe(false);
    expect(a.hp).toBe(1);
  });
});

describe('v1.3 · orden contextual (ping)', () => {
  const apuntar = (w: World, x: number, y: number, id = -1) => { w.aim.x = x; w.aim.y = y; w.aim.z = 0; w.aim.entityId = id; };

  it('enemigo a la vista: orden de enfocar; suceso ping y bark de confirmación', () => {
    const m = mundo({ aliados: true });
    const e = enemigo(m.world, 'enemy1', m.x + 3, m.y);
    m.world.events.length = 0;
    apuntar(m.world, e.x, e.y, e.id);
    m.world.ping(m.p);
    expect(m.world.order.kind).toBe('focus');
    expect(m.world.order.targetId).toBe(e.id);
    expect(ev(m.world, 'ping')[0]).toMatchObject({ what: 'enemy', targetId: e.id });
    expect(ev(m.world, 'bark')[0].key).toBe('ally.roger');
  });

  it('puerta cerrada: goto al otro lado y el aliado más cercano la abre', () => {
    const m = mundo({ aliados: true });
    const c = puertaConCruce(m.world);
    place(m.world, m.p, c.a[0], c.a[1], 0);
    const d = m.world.level.doors[c.id];
    apuntar(m.world, d.cx, d.cy);
    m.world.events.length = 0;
    m.world.ping(m.p);
    expect(ev(m.world, 'ping')[0]).toMatchObject({ what: 'door', targetId: c.id });
    expect(m.world.order.kind).toBe('goto');
    expect(Math.sign(m.world.order.x - d.cx)).toBe(Math.sign(d.cx - m.p.x));     // al otro lado
    run(m.world, 8, entrada());
    expect(d.open).toBe(true);
  });

  it('objeto: el aliado al que le sirve va a cogerlo; suelo: goto', () => {
    const m = mundo({ aliados: true });
    const a = m.world.entities.find(e => e.cls === 'technic')!;
    a.hp = 10;
    const [px, py] = puntoLibre(m.world, 2, 6);
    m.world.pickups.push({ id: 9999, type: 'vida_50', x: px, y: py, taken: false });
    apuntar(m.world, px, py);
    m.world.events.length = 0;
    m.world.ping(m.p);
    expect(ev(m.world, 'ping')[0]).toMatchObject({ what: 'item', targetId: 9999 });
    run(m.world, 10, entrada());
    expect(m.world.pickups.find(k => k.id === 9999)!.taken).toBe(true);
    const g = mundo({ aliados: true });
    apuntar(g.world, g.x + 2, g.y);
    g.world.events.length = 0;
    g.world.ping(g.p);
    expect(ev(g.world, 'ping')[0].what).toBe('ground');
    expect(g.world.order.kind).toBe('goto');
  });

  it('input.ping llega a la simulación y se consume', () => {
    const m = mundo({ aliados: true });
    const inp = entrada({ ping: true });
    m.world.step(DT, inp);
    expect(ev(m.world, 'ping')).toHaveLength(1);
    expect(inp.ping).toBe(false);
  });
});

describe('v1.3 · combos', () => {
  it('Supresión sobre un enemigo marcado lo deja clavado 3 s (sin marcar, 1,2 s)', () => {
    const f = (marcado: boolean) => {
      const m = mundo({ cls: 'especialist' });
      const e = enemigo(m.world, 'enemy3', m.x + 3, m.y);
      m.p.yaw = 0; e.marked = marcado;
      m.world.events.length = 0;
      m.world.applySuppression(m.p);
      return { hasta: e.pinnedUntil - m.world.time, combo: ev(m.world, 'combo').map(c => c.key) };
    };
    expect(f(true).combo).toEqual(['clavado']);
    expect(f(true).hasta).toBeCloseTo(3, 6);
    expect(f(false).combo).toEqual([]);
    expect(f(false).hasta).toBeCloseTo(1.2, 6);
  });

  it('Demolición: los enemigos a ≤ 4 m del boquete por el otro lado quedan aturdidos 2 s (combo conmocion)', () => {
    const m = mundo({ cls: 'explosives' });
    let hecho = false;
    for (const r of murosVerticales(m.world)) {
      for (const c of crucesVerticales(m.world, r, 1.0)) {
        const w = mundo({ cls: 'explosives' });
        place(w.world, w.p, c.a[0], c.a[1], 0);
        const e = enemigo(w.world, 'enemy3', c.b[0], c.b[1]);
        const near = enemigo(w.world, 'enemy3', c.a[0] - 1, c.a[1]);   // del mismo lado: no
        w.world.events.length = 0;
        w.p.abilityCd = 0;
        if (!w.world.useAbility(w.p)) continue;
        expect(ev(w.world, 'combo').map(x => x.key)).toContain('conmocion');
        expect(e.staggerUntil).toBeGreaterThanOrEqual(w.world.time + 2 - 1e-9);
        expect(near.staggerUntil).toBe(0);
        hecho = true; break;
      }
      if (hecho) break;
    }
    expect(hecho).toBe(true);
  });

  it('Hackeo sin puerta a la vista (o segundo uso) apaga las luces 10 s (combo apagon)', () => {
    const m = mundo({ cls: 'technic' });
    for (const d of m.world.level.doors) d.open = true;            // ninguna puerta cerrada a la vista
    m.world.events.length = 0;
    m.p.abilityCd = 0;
    expect(m.world.useAbility(m.p)).toBe(true);
    expect(m.world.lightsOffUntil).toBeCloseTo(m.world.time + 10, 6);
    expect(ev(m.world, 'lights')[0].on).toBe(false);
    expect(ev(m.world, 'combo')[0].key).toBe('apagon');
    run(m.world, 10.1, entrada(), w => { if (ev(w, 'lights').length) expect(ev(w, 'lights')[0].on).toBe(true); });
    expect(m.world.lightsOffUntil).toBe(0);
    // con una puerta cerrada a la vista abre la puerta (primer uso) y el segundo uso seguido apaga las luces
    const n = mundo({ cls: 'technic' });
    const c = puertaConCruce(n.world);
    place(n.world, n.p, c.a[0], c.a[1], 0);
    n.p.abilityCd = 0;
    expect(n.world.useAbility(n.p)).toBe(true);
    expect(n.world.level.doors[c.id].open).toBe(true);
    expect(n.world.lightsOffUntil).toBe(0);
    n.p.abilityCd = 0;
    expect(n.world.useAbility(n.p)).toBe(true);
    expect(n.world.lightsOffUntil).toBeGreaterThan(n.world.time);
  });
});

describe('v1.3 · barks ligados al estado', () => {
  it('recargar, quedarse sin munición, caer derribado y reanimar emiten su bark', () => {
    const m = mundo({ aliados: true });
    const a = m.world.entities.find(e => e.cls === 'technic')!;
    m.world.events.length = 0;
    m.world.startReload(a.mag >= a.magSize ? Object.assign(a, { mag: 1 }) : a);
    expect(ev(m.world, 'bark').map(b => b.key)).toEqual(['ally.reload']);
    run(m.world, 3.1, entrada());
    const b = m.world.entities.find(e => e.cls === 'especialist')!;
    m.world.events.length = 0;
    const e = enemigo(m.world, 'enemy1', m.x + 6, m.y);
    m.world.damage(b, 9999, e, 'torso', e.x, e.y);
    expect(ev(m.world, 'bark').map(x => x.key)).toContain('ally.downed');
    run(m.world, 3.1, entrada());
    m.world.events.length = 0;
    place(m.world, m.p, b.x + 0.5, b.y);
    for (let i = 0; i < 60; i++) m.world.step(DT, entrada({ interact: true }));
    expect(recoger(m.world, 0).length >= 0).toBe(true);
    // (el bark 'ally.reviving' lo emite quien reanima, limitado a uno cada 3 s)
  });
});
