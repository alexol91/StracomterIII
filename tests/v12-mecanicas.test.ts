// Pruebas v1.2: esprint, dispersión dinámica, retroceso, apuntado, impactos (superficie), aturdimiento,
// datos de baja y tutorial (`world.hold`).
//
// QUÉ MODOS DE FALLO NO CUBRE ESTE FICHERO:
//  - No se mira nada dibujado: ni la retícula leyendo p.spread, ni la cámara real (sólo world.cam/fov numéricos), ni
//    las marcas de impacto que se pintan a partir de `surface`. Sólo que el dato que reciben es el correcto.
//  - Los escenarios usan el director congelado y sin compañeros; no se prueba cómo se comportan estas mecánicas con una
//    escuadra viva a la vez, ni con el bot jugando (eso lo hace tools/partida.ts, que no esprinta ni apunta).
//  - El aturdimiento se comprueba con golpes aplicados con world.damage y un enemigo con línea de tiro: no se
//    ejercitan todas las ramas de la IA (cubierta, flanqueo…) mientras está aturdido.
//  - Las pruebas de tiros usan semillas fijas: miden magnitudes (dispersión, retroceso) con tolerancias, no resultados de una partida.
//  - La superficie `furniture` se prueba sólo si el mapa de la prueba tiene un mueble que pare balas y quede accesible.

import { describe, expect, it } from 'vitest';
import { GUN_FEEL, SPRINT_MULT } from '../src/sim/data';
import type { GameEvent } from '../src/sim/types';
import { DT, calmar, place, puertaConCruce, quickWorld, run, step } from './helpers';
import { enemigo, entrada, mundo } from './v12-util';

const velocidad = (u: { vx: number; vy: number }) => Math.hypot(u.vx, u.vy);

describe('v1.2 · esprint', () => {
  it('esprintando es ×1,45 más rápido y p.sprinting se activa; sin avanzar no esprinta', () => {
    const a = mundo(), b = mundo();
    run(a.world, 0.3, entrada({ moveF: 1 }));
    run(b.world, 0.3, entrada({ moveF: 1, sprint: true }));
    expect(b.p.sprinting).toBe(true);
    expect(a.p.sprinting).toBe(false);
    expect(velocidad(b.p) / velocidad(a.p)).toBeCloseTo(SPRINT_MULT, 1);
    const c = mundo();
    run(c.world, 0.2, entrada({ moveF: 0, sprint: true }));
    expect(c.p.sprinting).toBe(false);                       // sin moveF > 0,5 no hay esprint
    const d = mundo();
    run(d.world, 0.2, entrada({ moveF: 1, sprint: true, crouch: true }));
    expect(d.p.sprinting).toBe(true);                        // esprintar cancela agacharse
    expect(d.p.crouch).toBe(false);
  });

  it('esprintando no dispara, no apuñala y no lanza granada; recargar sí se puede', () => {
    const { world, p } = mundo();
    const mag = p.mag, gr = p.grenades;
    const eventos: GameEvent[] = [];
    for (let i = 0; i < 20; i++) { world.step(DT, entrada({ moveF: 1, sprint: true, knife: true, grenade: true })); eventos.push(...world.events); }
    expect(p.sprinting).toBe(true);
    expect(p.mag).toBe(mag);
    expect(p.grenades).toBe(gr);
    expect(eventos.some(e => e.type === 'knife' || e.type === 'shot' || e.type === 'throw')).toBe(false);
    p.mag = 5;
    world.step(DT, entrada({ moveF: 1, sprint: true, reload: true }));
    expect(p.reloading).toBeGreaterThan(0);                  // la recarga sigue siendo posible
  });

  it('al pulsar fuego sale del esprint y hay 0,35 s de levantar el arma antes del primer disparo', () => {
    const { world, p } = mundo();
    run(world, 0.3, entrada({ moveF: 1, sprint: true }));
    expect(p.sprinting).toBe(true);
    const mag0 = p.mag;
    let primero = -1;
    const t0 = world.time;
    for (let i = 0; i < 60 && primero < 0; i++) {
      world.step(DT, entrada({ moveF: 1, sprint: true, fire: true }));
      if (p.mag < mag0) primero = world.time - t0;
    }
    expect(p.sprinting).toBe(false);
    expect(primero).toBeGreaterThan(0.33);                   // ≥ 0,35 s de retardo (con un paso de margen)
    expect(primero).toBeLessThan(0.45);
    // sin esprintar antes, dispara al instante
    const m2 = mundo();
    m2.world.step(DT, entrada({ fire: true }));
    expect(m2.p.mag).toBeLessThan(m2.p.magSize);
  });

  it('esprintar hace más ruido de pasos (9 en vez de 6) y los pasos son más seguidos', () => {
    const medir = (sprint: boolean, upgrades: string[] = []) => {
      const m = mundo({ upgrades });
      const loud: number[] = []; let pasos = 0;
      for (let i = 0; i < 40; i++) {
        m.world.step(DT, entrada({ moveF: 1, sprint }));
        for (const n of m.world.noises) if (n.kind === 'step' && n.id === m.p.id) loud.push(n.loud);
        pasos += m.world.events.filter(e => e.type === 'step').length;
      }
      return { loud, pasos };
    };
    const andar = medir(false), correr = medir(true), sigilo = medir(true, ['sigilo']);
    expect(andar.loud.length).toBeGreaterThan(0);
    expect(correr.loud.length).toBeGreaterThan(0);
    expect(Math.max(...andar.loud)).toBe(6);
    expect(Math.min(...correr.loud)).toBe(9);
    expect(Math.max(...sigilo.loud)).toBe(6);                // la mejora «sigilo» lo iguala al andar
    expect(correr.pasos).toBeGreaterThan(andar.pasos);       // más pasos por segundo: más rápido y cada 1,3 m
  });
});

describe('v1.2 · dispersión dinámica (p.spread)', () => {
  it('quieto en pie vale la dispersión base de la clase; agachado ×0,75; apuntando ×0,45', () => {
    for (const cls of ['captain', 'technic', 'especialist', 'explosives'] as const) {
      const g = GUN_FEEL[cls];
      const a = mundo({ cls });
      step(a.world, entrada(), 3);
      expect(a.p.spread).toBeCloseTo(g.baseSpread, 6);
      const b = mundo({ cls });
      step(b.world, entrada({ crouch: true }), 3);
      expect(b.p.spread).toBeCloseTo(g.baseSpread * 0.75, 6);
      const c = mundo({ cls });
      step(c.world, entrada({ aim: true }), 3);
      expect(c.p.spread).toBeCloseTo(g.baseSpread * 0.45, 6);
      expect(c.p.aiming).toBe(true);
    }
  });

  it('moverse la aumenta (hasta moveSpread a velocidad máxima)', () => {
    const m = mundo();
    run(m.world, 0.3, entrada({ moveF: 1 }));
    expect(m.p.spread).toBeGreaterThan(GUN_FEEL.captain.baseSpread + GUN_FEEL.captain.moveSpread * 0.8);
    expect(m.p.spread).toBeLessThanOrEqual(GUN_FEEL.captain.baseSpread + GUN_FEEL.captain.moveSpread + 1e-9);
  });

  it('crece con una ráfaga (sin pasar del máximo), se recupera al soltar y apuntando es menor', () => {
    const g = GUN_FEEL.captain;
    const a = mundo(), b = mundo();
    run(a.world, 1.5, entrada({ fire: true }));
    expect(a.p.spread).toBeGreaterThan(g.baseSpread * 3);
    expect(a.p.spread).toBeLessThanOrEqual(g.maxSpread + 1e-9);
    const pico = a.p.spread;
    run(a.world, 0.3, entrada());
    expect(a.p.spread).toBeLessThan(pico);                   // empieza a recuperarse
    run(a.world, 1.5, entrada());
    expect(a.p.spread).toBeCloseTo(g.baseSpread, 6);         // recuperada del todo
    run(b.world, 1.5, entrada({ fire: true, aim: true }));
    expect(b.p.spread).toBeLessThan(pico * 0.6);             // la misma ráfaga apuntando dispersa menos
  });

  it('el explosivos no acumula calor (perShot 0)', () => {
    const m = mundo({ cls: 'explosives' });
    run(m.world, 0.1, entrada({ fire: true }));
    expect(m.p.spread).toBeCloseTo(GUN_FEEL.explosives.baseSpread, 6);
  });
});

describe('v1.2 · retroceso de cámara', () => {
  it('cada bala levanta la cámara, el desplazamiento está acotado y vuelve a cero; input no se modifica', () => {
    const { world, p } = mundo();
    const inp = entrada({ pitch: 0.1, yaw: 0.3, fire: true });
    run(world, 2, inp);                                      // ráfaga larga (el cargador se acaba y se recarga)
    expect(inp.pitch).toBe(0.1);
    expect(inp.yaw).toBe(0.3);
    expect(world.recoil.pitch).toBeGreaterThan(0);
    expect(world.recoil.pitch).toBeLessThanOrEqual(0.12 + 1e-9);
    expect(Math.abs(world.recoil.yaw)).toBeLessThanOrEqual(0.05 + 1e-9);
    // la cámara Y el rayo de la mira llevan el retroceso
    expect(world.cam.pitch).toBeCloseTo(inp.pitch + world.recoil.pitch, 9);
    expect(world.cam.yaw).toBeCloseTo(inp.yaw + world.recoil.yaw, 9);
    void p;
    run(world, 1, entrada({ pitch: 0.1, yaw: 0.3 }));
    expect(world.recoil.pitch).toBeLessThan(1e-3);
    expect(Math.abs(world.recoil.yaw)).toBeLessThan(1e-3);
    expect(world.cam.pitch).toBeCloseTo(0.1, 2);
  });

  it('una sola bala suma kickPitch de la clase; apuntando ×0,7, agachado ×0,85 y «pulso» ×0,7', () => {
    const una = (opts: { aim?: boolean; crouch?: boolean; up?: string[] }) => {
      const m = mundo({ upgrades: opts.up });
      step(m.world, entrada({ aim: opts.aim, crouch: opts.crouch }), 2);
      m.world.step(DT, entrada({ aim: opts.aim, crouch: opts.crouch, fire: true }));
      return m.world.recoil.pitch;
    };
    const k = GUN_FEEL.captain.kickPitch;
    expect(una({})).toBeCloseTo(k, 6);
    expect(una({ aim: true })).toBeCloseTo(k * 0.7, 6);
    expect(una({ crouch: true })).toBeCloseTo(k * 0.85, 6);
    expect(una({ up: ['pulso'] })).toBeCloseTo(k * 0.7, 6);
    // el explosivos pega un buen patadón
    const e = mundo({ cls: 'explosives' });
    e.world.step(DT, entrada());
    // sin blanco a más de 2,6 m el seguro del lanzador no deja disparar: se mira sólo que la tabla es la prevista
    expect(GUN_FEEL.explosives.kickPitch).toBe(0.035);
  });
});

describe('v1.2 · apuntar al hombro', () => {
  it('va a ×0,55 de velocidad y el fov pasa de 60 a 42; al soltar vuelve', () => {
    const a = mundo(), b = mundo();
    run(a.world, 0.3, entrada({ moveF: 1 }));
    run(b.world, 0.3, entrada({ moveF: 1, aim: true }));
    expect(velocidad(b.p) / velocidad(a.p)).toBeCloseTo(0.55, 1);
    expect(a.world.cam.fov).toBeCloseTo(60, 3);
    run(b.world, 1.5, entrada({ aim: true }));
    expect(b.world.cam.fov).toBeCloseTo(42, 0);
    run(b.world, 1.5, entrada());
    expect(b.world.cam.fov).toBeCloseTo(60, 0);
  });

  it('no se apunta esprintando ni recargando', () => {
    const m = mundo();
    run(m.world, 0.2, entrada({ moveF: 1, sprint: true, aim: true }));
    expect(m.p.aiming).toBe(true);                           // con las dos teclas manda apuntar: no esprinta
    expect(m.p.sprinting).toBe(false);
    m.p.mag = 3;
    m.world.step(DT, entrada({ aim: true, reload: true }));
    m.world.step(DT, entrada({ aim: true }));
    expect(m.p.reloading).toBeGreaterThan(0);
    expect(m.p.aiming).toBe(false);
  });

  it('la cámara se acerca (distancia objetivo 2 m) mientras apunta', () => {
    const m = mundo();
    const d = () => Math.hypot(m.world.cam.x - m.p.x, m.world.cam.y - m.p.y);
    run(m.world, 0.5, entrada({ camDist: 4.2 }));
    const lejos = d();
    run(m.world, 1.5, entrada({ camDist: 4.2, aim: true }));
    expect(d()).toBeLessThan(lejos);
  });
});

describe('v1.2 · impactos: superficie y normal', () => {
  it('level.rayInfo da la misma t que ray en 2000 rayos al azar', async () => {
    const { world } = quickWorld(2, 3);
    const L = world.level;
    let s = 12345;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 2000; i++) {
      const x0 = L.ox + rnd() * L.gw * 0.25, y0 = L.oy + rnd() * L.gh * 0.25;
      const x1 = x0 + (rnd() - 0.5) * 40, y1 = y0 + (rnd() - 0.5) * 40;
      const z0 = rnd() * 2, z1 = rnd() * 2 - 0.3;
      for (const mode of ['sight', 'bullet'] as const) {
        const r = L.rayInfo(x0, y0, z0, x1, y1, z1, mode);
        expect(r.t).toBe(L.ray(x0, y0, z0, x1, y1, z1, mode));
        expect(Math.hypot(r.nx, r.ny)).toBeCloseTo(1, 6);
      }
    }
  });

  it('un tiro a un muro da surface wall con la normal mirando al tirador; a un cuerpo, body; al aire, none', () => {
    const m = mundo();
    const { world, p } = m;
    // disparo hacia -x/+x/±y hasta encontrar muro dentro de alcance: el claro de 3,5 m garantiza ≥ 3,5 m libres
    let visto: Extract<GameEvent, { type: 'shot' }> | null = null;
    for (let k = 0; k < 8 && !visto; k++) {
      const a = k * Math.PI / 4;
      p.fireCd = 0;
      world.fire(p, p.x + Math.cos(a) * 25, p.y + Math.sin(a) * 25, 1.4, 0);
      const ev = world.events.filter((e): e is Extract<GameEvent, { type: 'shot' }> => e.type === 'shot').pop();
      if (ev && ev.hit === 'wall') visto = ev;
      world.events.length = 0;
    }
    expect(visto).not.toBeNull();
    expect(visto!.surface === 'wall' || visto!.surface === 'door' || visto!.surface === 'furniture').toBe(true);
    expect(Math.hypot(visto!.nx!, visto!.ny!)).toBeCloseTo(1, 6);
    const dx = visto!.tx - p.x, dy = visto!.ty - p.y;
    expect(visto!.nx! * dx + visto!.ny! * dy).toBeLessThan(0);   // la normal apunta de vuelta hacia el tirador
    // cuerpo
    const e = enemigo(world, 'enemy1', p.x + 3, p.y);
    world.fire(p, e.x, e.y, 1.0, 0);
    const sb = world.events.find((x): x is Extract<GameEvent, { type: 'shot' }> => x.type === 'shot')!;
    expect(sb.hit).toBe('entity');
    expect(sb.surface).toBe('body');
    expect(sb.nx).toBeCloseTo(-1, 6);
  });

  it('una puerta cerrada da surface door', () => {
    const { world } = quickWorld(1, 1);
    calmar(world);
    const c = puertaConCruce(world);
    const p = place(world, world.player, c.a[0], c.a[1], 0);
    world.fire(p, c.b[0], c.b[1], 1.4, 0);
    const ev = world.events.find((x): x is Extract<GameEvent, { type: 'shot' }> => x.type === 'shot')!;
    expect(ev.hit).toBe('wall');
    expect(ev.surface).toBe('door');
  });
});

describe('v1.2 · aturdimiento', () => {
  const golpe = (m: ReturnType<typeof mundo>, e: ReturnType<typeof enemigo>, dano: number, zona: 'head' | 'torso' | 'blast' = 'torso') =>
    m.world.damage(e, dano, m.p, zona, m.p.x, m.p.y);

  it('un golpe ≥ 18, un impacto en la cabeza o una explosión ≥ 20 aturden 0,35 s; golpes menores no', () => {
    const m = mundo();
    const n = (zona: 'head' | 'torso' | 'blast', d: number) => { const e = enemigo(m.world, 'enemy3', m.x + 3, m.y); golpe(m, e, d, zona); return e; };
    expect(n('torso', 17.9).staggerUntil).toBe(0);
    const a = n('torso', 18);
    expect(a.staggerUntil).toBeCloseTo(m.world.time + 0.35, 6);
    expect(n('head', 2).staggerUntil).toBeGreaterThan(m.world.time);      // la cabeza aturde aunque duela poco
    expect(n('blast', 19.9).staggerUntil).toBe(0);
    expect(n('blast', 20).staggerUntil).toBeGreaterThan(m.world.time);
    step(m.world, entrada());
    expect(a.aiState).toBe('aturdido');
  });

  it('como mucho una vez cada 1,2 s por enemigo y los jefes no se aturden', () => {
    const m = mundo();
    const e = enemigo(m.world, 'enemy3', m.x + 3, m.y);
    golpe(m, e, 20);
    const t1 = e.staggerUntil;
    run(m.world, 0.5, entrada());
    golpe(m, e, 20);
    expect(e.staggerUntil).toBe(t1);                         // aún en enfriamiento
    run(m.world, 0.8, entrada());
    golpe(m, e, 20);
    expect(e.staggerUntil).toBeGreaterThan(t1);
    for (const k of ['miniboss', 'megaboss'] as const) {
      const j = enemigo(m.world, k, m.x - 3, m.y);
      j.shielded = false;
      golpe(m, j, 60);
      expect(j.staggerUntil).toBe(0);
    }
  });

  it('aturdido no dispara y se mueve al 40 %', () => {
    // enemigo con línea de tiro a 6 m, ya alertado: dispara sin aturdir y no dispara mientras dura el aturdimiento
    const contar = (aturdir: boolean) => {
      const m = mundo();
      const e = enemigo(m.world, 'enemy3', m.x + 5, m.y);
      e.yaw = Math.PI;
      let disparos = 0, previos = 0, vmax = 0, tAt = -1;
      const orig = m.world.fire.bind(m.world);
      m.world.fire = (u, ...r: [number, number, number, number, boolean?]) => { if (u === e) { if (tAt < 0) previos++; else if (m.world.time < tAt + 0.35) disparos++; } return orig(u, ...r); };
      run(m.world, 2.5, entrada());                          // le da tiempo a verle y empezar a disparar
      tAt = m.world.time;
      m.p.hp = m.p.maxHp = 9999;
      if (aturdir) golpe(m, e, 20); else m.world.damage(e, 1, m.p, 'torso', m.p.x, m.p.y);
      for (let i = 0; i < 20; i++) { m.world.step(DT, entrada()); vmax = velocidad(e); }   // velocidad al final de la ventana (ya sin el impulso previo)
      return { disparos, previos, vmax, estado: e.aiState };
    };
    const quieto = contar(true);
    expect(quieto.previos).toBeGreaterThan(0);                   // el escenario es válido: sin aturdir sí dispara
    expect(quieto.disparos).toBe(0);
    expect(quieto.vmax).toBeLessThanOrEqual(1.7 * 0.4 + 0.1);   // enemy3 va a 1,7 m/s: con el 40 % no pasa de ~0,7
    expect(quieto.estado).toBe('aturdido');
  });
});

describe('v1.2 · datos de la baja y estadísticas', () => {
  it('death lleva killerId, headshot y de dónde vino el golpe', () => {
    const m = mundo();
    const e = enemigo(m.world, 'enemy1', m.x + 3, m.y);
    m.world.damage(e, 100, m.p, 'head', m.p.x, m.p.y);
    const d = m.world.events.find((x): x is Extract<GameEvent, { type: 'death' }> => x.type === 'death')!;
    expect(d.killerId).toBe(m.p.id);
    expect(d.headshot).toBe(true);
    expect(d.fromX).toBe(m.p.x); expect(d.fromY).toBe(m.p.y);
    const f = enemigo(m.world, 'enemy1', m.x + 3, m.y);
    m.world.damage(f, 100, m.p, 'torso', m.p.x, m.p.y);
    const d2 = m.world.events.filter((x): x is Extract<GameEvent, { type: 'death' }> => x.type === 'death').pop()!;
    expect(d2.headshot).toBe(false);
    const g = enemigo(m.world, 'enemy1', m.x + 3, m.y);
    m.world.events.length = 0;
    m.world.kill(g);                                         // p. ej. la consola: nadie lo mata
    const d3 = m.world.events.find((x): x is Extract<GameEvent, { type: 'death' }> => x.type === 'death')!;
    expect(d3.killerId).toBe(-1);
    expect(d3.headshot).toBe(false);
  });

  it('stats.headshots cuenta impactos en la cabeza del jugador y bestStreak la mejor racha (< 4 s entre bajas)', () => {
    const m = mundo();
    const e = enemigo(m.world, 'enemy3', m.x + 3, m.y);
    m.world.fire(m.p, e.x, e.y, m.world.height(e) * 0.95, 0);    // a la cabeza
    expect(m.world.stats.headshots).toBe(1);
    m.world.fire(m.p, e.x, e.y, m.world.height(e) * 0.6, 0);     // al pecho: no cuenta
    expect(m.world.stats.headshots).toBe(1);

    const k = mundo();
    const matar = () => { const v = enemigo(k.world, 'enemy1', k.x + 3, k.y); k.world.damage(v, 999, k.p, 'torso', k.p.x, k.p.y); };
    matar(); run(k.world, 1, entrada());
    matar(); run(k.world, 3, entrada());
    matar();                                                 // racha de 3
    expect(k.world.stats.bestStreak).toBe(3);
    run(k.world, 4.5, entrada());
    matar(); run(k.world, 1, entrada()); matar();            // otra racha, de 2: no mejora la anterior
    expect(k.world.stats.bestStreak).toBe(3);
  });
});

describe('v1.2 · tutorial: world.hold', () => {
  const cerca = () => {
    const f = quickWorld(1, 1);
    const w = f.world;
    const e = w.entities.filter(u => u.team === 'enemy' && u.alive)[0];
    const c = w.level.nearestFree(e.x + 2, e.y, true, 6);
    place(w, w.player, w.level.cellX(c), w.level.cellY(c));
    return { w, e };
  };

  it('con hold el director no suelta nada ni cambia de fase ni da la zona por limpia; al soltarlo todo sigue', () => {
    const { world } = quickWorld(1, 1);
    world.hold = true;
    const pend = world.director.pending(), fase = world.pacing;
    const vivos = () => world.entities.filter(u => u.team === 'enemy' && u.alive);
    for (const u of vivos()) { u.shielded = false; world.kill(u); }
    const eventos: GameEvent[] = [];
    for (let i = 0; i < 60 * 60; i++) { world.step(DT, entrada()); eventos.push(...world.events); }
    expect(world.director.pending()).toBe(pend);
    expect(world.pacing).toBe(fase);
    expect(world.status).toBe('playing');
    expect(vivos().length).toBe(0);                          // nadie nuevo
    expect(eventos.some(e => e.type === 'phase' || e.type === 'cleared' || e.type === 'spawn')).toBe(false);
    world.hold = false;
    run(world, 30, entrada());
    expect(world.director.pending() < pend || vivos().length > 0).toBe(true);   // el ritmo se reanuda
  });

  it('con hold los enemigos no ven ni oyen (siguen patrullando); sin hold, a 2 m te descubren', () => {
    const a = cerca();
    a.w.hold = true;
    const disparo = () => a.w.noises.push({ x: a.w.player.x, y: a.w.player.y, loud: 30, team: 'ally', id: a.w.player.id, kind: 'shot' });
    for (let i = 0; i < 180; i++) { if (i % 30 === 0) disparo(); a.w.step(DT, entrada()); }
    const todos = a.w.entities.filter(u => u.team === 'enemy' && u.alive);
    for (const u of todos) { expect(u.brain.belief).toBeNull(); expect(u.brain.aware).toBe(0); expect(u.aiState).not.toBe('dispara'); }
    expect(todos.some(u => u.aiState === 'patrulla' || u.aiState === '')).toBe(true);
    const b = cerca();
    run(b.w, 3, entrada());
    expect(b.e.brain.aware > 0 || b.e.brain.belief !== null).toBe(true);
  });
});
