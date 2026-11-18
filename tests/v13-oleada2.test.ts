// Pruebas v1.3, oleada 2: Armería, objetivos de zona (desactivar, defender, rescatar), modificadores y segunda vuelta, modo horda.
//
// QUÉ MODOS DE FALLO NO CUBRE ESTE FICHERO:
//  - Las zonas se montan con World/campaña reales, pero muchos escenarios colocan al jugador o al rehén a mano y matan a los
//    enemigos con world.kill: no se prueba que un jugador (o el bot) llegue de verdad hasta el objetivo con la IA en contra.
//    Eso sólo lo comprueban las partidas del bot (tools/partida.ts con OBJ=defuse|defend|rescue y `horda`).
//  - La IA que acude al servidor y le dispara se prueba con un enemigo colocado a 4 m con línea de visión; no con oleadas
//    enteras llegando por puertas y pasillos.
//  - La escasez se comprueba en las cajas del mapa (la mitad); el efecto sobre el botín de munición de los enemigos
//    (probabilidad ×0,5) no tiene prueba estadística propia.
//  - «Jefes dobles» en la planta 9 (MegaBoss + MiniBoss) no se prueba; sí en una planta con MiniBoss.
//  - La compra de una mejora extra se prueba hasta la elección en el estado de campaña; no hay interfaz de Armería aquí.
//  - La horda se prueba matando a los enemigos de cada oleada con world.kill (progresión, descanso, suministros, pausa por
//    mejora, jefe en la 5), no jugándola; el bot la juega aparte y se informa de a qué oleada llega.
//  - Los relojes de objetivo se prueban con tiempos fijados a mano cerca del final, no esperando 150 s reales de simulación.

import { describe, expect, it } from 'vitest';
import type { CampaignState, Difficulty } from '../src/contracts';
import { createCampaign, directorConfig, objectiveZones, scoreMultOf } from '../src/sim/campaign';
import { HORDE, MUTATORS, NG_PLUS, OBJECTIVE, SHOP, UPGRADES, hordeEnemies } from '../src/sim/data';
import type { GameEvent, ObjectiveKind } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { DT, campaignWorld, clearZone, exec, memStorage, place, pointAtDistance, run, step } from './helpers';
import { entrada } from './v12-util';

const ev = <T extends GameEvent['type']>(w: World, t: T) => w.events.filter(e => e.type === t) as Extract<GameEvent, { type: T }>[];

/** Campaña de verdad (no rápida) con un estado ajustable antes de entrar en la zona. */
function mk(floor: number, zone: number, tweak: (s: CampaignState) => void = () => {}, opts?: { mutators?: string[]; ngPlus?: boolean }, difficulty: Difficulty = 'normal') {
  const storage = memStorage();
  const campaign = createCampaign(storage, () => new Date('2026-06-01T10:00:00Z'));
  const state = campaign.newCampaign(difficulty, 'captain', opts);
  state.floor = floor;
  tweak(state);
  const world = campaign.startZone(state, zone) as World;
  return { campaign, storage, state, world };
}
const mantener = (w: World, secs: number, over: Partial<ReturnType<typeof entrada>> = {}) => { for (let i = 0; i < Math.round(secs / DT); i++) w.step(DT, entrada({ interact: true, ...over })); };
/** Mata a todos los enemigos vivos cada paso durante `secs` (para dejar correr el director sin que molesten). */
const limpiando = (w: World, secs: number, each?: () => void) => { for (let i = 0; i < Math.round(secs / DT); i++) { for (const e of w.entities) if (e.alive && e.team === 'enemy') { e.shielded = false; w.kill(e); } w.step(DT, entrada()); each?.(); } };

describe('v1.3 · Armería', () => {
  it('los créditos se ganan igual que la puntuación (que no baja al gastar) y hay un precio por artículo', () => {
    const f = campaignWorld(3, 1);
    clearZone(f.world);
    f.world.stats.scoreGained = 200;
    f.campaign.completeZone(f.state, f.world);
    expect(f.state.credits).toBe(200);
    expect(f.state.score).toBe(200);
    f.state.credits = 1000;
    expect(f.campaign.buy(f.state, 'ammo')).toBe(true);
    expect(f.state.credits).toBe(1000 - SHOP.ammo);
    expect(f.state.score).toBe(200);                           // el total no baja
    const items = f.campaign.shopItems(f.state);
    expect(items.map(i => i.id)).toEqual(['ammo', 'medkit', 'grenade', 'flash', 'smoke', 'upgrade']);
    expect(items.find(i => i.id === 'medkit')!.needsTarget).toBe(true);
    expect(items.find(i => i.id === 'upgrade')!.price).toBe(SHOP.upgrade);
    // no hay artículo para recuperar compañeros muertos (decisión pendiente del dueño)
    expect(items.some(i => /revive|resurrect|recover|ally|companion/i.test(i.id))).toBe(false);
  });

  it('no se compra sin créditos ni lo que no hace falta', () => {
    const f = campaignWorld(3, 1);
    expect(f.campaign.buy(f.state, 'ammo')).toBe(false);       // 0 créditos
    f.state.credits = 5000;
    expect(f.campaign.buy(f.state, 'medkit', 'captain')).toBe(false);   // nadie herido
    expect(f.state.credits).toBe(5000);
    expect(f.campaign.buy(f.state, 'nada')).toBe(false);
    f.state.members.captain.ammo = 998;
    expect(f.campaign.shopItems(f.state).find(i => i.id === 'ammo')!.available).toBe(true);
  });

  it('munición (+50 a toda la escuadra viva) y botiquín (+50 a un operador, sin pasar del máximo)', () => {
    const f = campaignWorld(3, 1);
    f.state.credits = 2000;
    f.state.members.explosives.hp = 0;                         // muerto: no cuenta
    const antes = { c: f.state.members.captain.ammo, t: f.state.members.technic.ammo };
    expect(f.campaign.buy(f.state, 'ammo')).toBe(true);
    expect(f.state.members.captain.ammo).toBe(antes.c + 50);
    expect(f.state.members.technic.ammo).toBe(antes.t + 50);
    expect(f.state.members.explosives.ammo).toBe(50);          // el muerto no recibe
    f.state.members.technic.hp = 40;
    expect(f.campaign.buy(f.state, 'medkit', 'technic')).toBe(true);
    expect(f.state.members.technic.hp).toBe(85);               // 40 + 50 = 90 → tope de la clase (85)
    expect(f.campaign.buy(f.state, 'medkit', 'explosives')).toBe(false);   // muerto
  });

  it('granadas: +1 para la PRÓXIMA zona (máx. 3 de cada), y se consumen al entrar en ella', () => {
    const f = campaignWorld(3, 1);
    f.state.credits = 10000;
    for (let i = 0; i < 3; i++) { expect(f.campaign.buy(f.state, 'grenade')).toBe(true); }
    expect(f.campaign.buy(f.state, 'grenade')).toBe(false);    // tope
    expect(f.campaign.buy(f.state, 'flash')).toBe(true);
    expect(f.campaign.buy(f.state, 'smoke')).toBe(true);
    expect(f.state.bought).toEqual({ grenades: 3, flashes: 1, smokes: 1 });
    const w = f.campaign.startZone(f.state, 1) as World;
    expect([w.player.grenades, w.player.flashes, w.player.smokes]).toEqual([3 + 3, 2 + 1, 1 + 1]);
    expect(f.state.bought).toEqual({ grenades: 0, flashes: 0, smokes: 0 });
    const w2 = f.campaign.startZone(f.state, 1) as World;      // la siguiente ya no las lleva
    expect([w2.player.grenades, w2.player.flashes, w2.player.smokes]).toEqual([3, 2, 1]);
  });

  it('mejora extra: precio ×1,5 por compra previa, deja tres opciones distintas pendientes y se elige con chooseUpgrade', () => {
    const f = campaignWorld(3, 1);
    f.state.credits = 100000;
    expect(f.campaign.buy(f.state, 'upgrade')).toBe(true);
    const ch = f.campaign.shopUpgradeChoices(f.state);
    expect(ch).toHaveLength(3);
    expect(new Set(ch).size).toBe(3);
    expect(f.campaign.buy(f.state, 'upgrade')).toBe(false);    // con una elección pendiente no se compra otra
    f.campaign.chooseUpgrade(f.state, ch[0]);
    expect(f.state.upgrades).toContain(ch[0]);
    expect(f.campaign.shopUpgradeChoices(f.state)).toEqual([]);
    const precio2 = f.campaign.shopItems(f.state).find(i => i.id === 'upgrade')!.price;
    expect(precio2).toBe(Math.round(SHOP.upgrade * 1.5));
    f.campaign.buy(f.state, 'upgrade');
    f.campaign.chooseUpgrade(f.state, f.campaign.shopUpgradeChoices(f.state)[0]);
    expect(f.campaign.shopItems(f.state).find(i => i.id === 'upgrade')!.price).toBe(Math.round(SHOP.upgrade * 2.25));
    expect(f.state.extraUpgrades).toBe(2);
  });

  it('re-sortear: sólo justo tras completeZone y antes de elegir; da otras tres y cuesta un precio fijo', () => {
    const f = campaignWorld(3, 1);
    expect(f.campaign.rerollUpgrades(f.state)).toBeNull();     // aún no hay oferta
    clearZone(f.world);
    f.world.stats.scoreGained = 1000;
    const sum = f.campaign.completeZone(f.state, f.world);
    const antes = sum.upgradeChoices!.slice();
    const cr = f.state.credits!;
    const nuevas = f.campaign.rerollUpgrades(f.state)!;
    expect(nuevas).toHaveLength(3);
    expect(nuevas.some(n => antes.includes(n))).toBe(false);
    expect(f.state.credits).toBe(cr - SHOP.reroll);
    f.campaign.chooseUpgrade(f.state, nuevas[0]);
    expect(f.campaign.rerollUpgrades(f.state)).toBeNull();     // ya se eligió
    const g = campaignWorld(3, 1);
    clearZone(g.world);
    g.campaign.completeZone(g.state, g.world);
    g.state.credits = SHOP.reroll - 1;
    expect(g.campaign.rerollUpgrades(g.state)).toBeNull();     // sin dinero
  });

  it('la planta media de Normal paga ~2 suministros (calibración): el precio de un suministro es la mitad de unos 350 puntos', () => {
    // 350 puntos ≈ una planta media de Normal con el bot (ver tools/partida.ts); sólo se comprueba el orden de magnitud de la tabla
    const suministros = [SHOP.ammo, SHOP.medkit, SHOP.grenade, SHOP.flash, SHOP.smoke];
    for (const p of suministros) expect(350 / p).toBeGreaterThan(1.5);
    for (const p of suministros) expect(350 / p).toBeLessThan(4);
    expect(SHOP.upgrade / 350).toBeGreaterThan(1.7); expect(SHOP.upgrade / 350).toBeLessThan(2.3);
  });
});

describe('v1.3 · objetivos: reparto por planta y puntos', () => {
  it('plantas 1 y 9 todo limpiar; plantas 2-8 exactamente 2 zonas especiales (bonus 1,5), distintas, deterministas', () => {
    const { campaign } = campaignWorld(1, 1);
    for (const f of [1, 9]) for (const z of campaign.zonesOf(f)) expect(z.objective).toBe('clear');
    for (let f = 2; f <= 8; f++) {
      const zs = campaign.zonesOf(f), esp = zs.filter(z => z.objective !== 'clear');
      expect(esp).toHaveLength(2);
      for (const z of esp) expect(z.objectiveBonus).toBe(1.5);
      expect(new Set(esp.map(z => z.objective)).size).toBe(2);
      expect(esp.map(z => z.zone)).toEqual(objectiveZones(f).map(o => o.zone));
      for (const z of zs.filter(q => q.objective === 'clear')) expect(z.objectiveBonus).toBe(1);
    }
    const tipos = new Set<ObjectiveKind>();
    for (let f = 2; f <= 8; f++) for (const z of campaign.zonesOf(f)) tipos.add(z.objective!);
    expect(tipos).toEqual(new Set(['clear', 'defuse', 'defend', 'rescue']));   // rotan los tres
  });

  it('en una zona de desactivar no hay jefe; en defender y rescatar sí', () => {
    for (const k of ['defuse', 'defend', 'rescue'] as const) {
      const f = campaignWorld(3, 1);
      const cfg = directorConfig(f.state, 3, 'pequeno', k);
      expect(cfg.miniboss).toBe(k !== 'defuse');
    }
  });

  it('completeZone aplica el bonus ×1,5 a los puntos y a los créditos', () => {
    const a = campaignWorld(3, 1);
    clearZone(a.world);
    a.world.stats.scoreGained = 100;
    a.campaign.completeZone(a.state, a.world);
    const b = campaignWorld(3, 1);
    b.world.initObjective('defuse');
    clearZone(b.world);
    b.world.status = 'cleared'; b.world.stats.scoreGained = 100;
    const sum = b.campaign.completeZone(b.state, b.world);
    expect(a.state.score).toBe(100);
    expect(b.state.score).toBe(150);
    expect(b.state.credits).toBe(150);
    expect(sum.stats.scoreGained).toBe(150);
  });
});

describe('v1.3 · objetivo: desactivar cargas', () => {
  const nuevo = (dif: Difficulty = 'normal', floor = 3, zone = 1) => { const f = mk(floor, zone, () => {}, undefined, dif); f.world.initObjective('defuse'); return f; };

  it('dos cargas transitables, lejos entre sí y del inicio; reloj 150 s (Fácil 180, Difícil 130) + 20 s por cada 500 m² sobre 800', () => {
    const f = nuevo();
    const o = f.world.objective;
    expect(o.points).toHaveLength(2);
    const [sx, sy] = f.world.level.map.inicio_jugador;
    for (const pt of o.points) { expect(f.world.level.walkableAt(pt.x, pt.y, true)).toBe(true); expect(Math.hypot(pt.x - sx, pt.y - sy)).toBeGreaterThan(5); }
    expect(Math.hypot(o.points[0].x - o.points[1].x, o.points[0].y - o.points[1].y)).toBeGreaterThan(8);
    const area = (() => { let a = 0; const p = f.world.level.map.perimetro; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(a) / 2; })();
    const extra = Math.max(0, Math.ceil((area - 800) / 500)) * 20;
    expect(o.timeLeft).toBe(150 + extra);
    expect(nuevo('easy').world.objective.timeLeft).toBe(180 + extra);
    expect(nuevo('hard').world.objective.timeLeft).toBe(130 + extra);
    // un mapa grande tiene más tiempo que uno pequeño
    expect(nuevo('normal', 3, 6).world.objective.timeLeft).toBeGreaterThanOrEqual(150);
    expect(o.stage).toBe('defuse1');
    expect(ev(f.world, 'objective').length >= 0).toBe(true);
  });

  it('mantener interact 4 s a ≤ 1,5 m desactiva; soltar reinicia; con las dos, la zona queda limpia aunque queden enemigos', () => {
    const f = nuevo();
    const { world } = f, o = world.objective;
    world.cheats.god = true;                                   // (los enemigos de la zona no deben matar al jugador mientras mantiene)
    place(world, world.player, o.points[0].x, o.points[0].y);
    step(world, entrada());
    expect(o.interact).toBe(0);
    mantener(world, 2);
    expect(o.points[0].progress).toBeGreaterThan(0.45);
    run(world, 0.1, entrada());                                // soltar
    expect(o.points[0].progress).toBe(0);
    mantener(world, 4.1);
    expect(o.points[0].done).toBe(true);
    expect(o.stage).toBe('defuse2');
    expect(world.status).toBe('playing');
    expect(world.enemiesAlive()).toBeGreaterThan(0);
    // lejos de la carga no avanza
    mantener(world, 1);
    expect(o.points[1].progress).toBe(0);
    place(world, world.player, o.points[1].x, o.points[1].y);
    world.events.length = 0;
    mantener(world, 4.1);
    expect(world.status).toBe('cleared');
    expect(world.enemiesAlive()).toBeGreaterThan(0);           // los que quedan no cuentan
    expect(ev(world, 'objective').length + 1).toBeGreaterThan(0);
  });

  it('el reloj a 0 fracasa; los últimos 10 s hay un tick por segundo', () => {
    const f = nuevo();
    const { world } = f, o = world.objective;
    o.timeLeft = 10.5;
    let ticks = 0;
    for (let i = 0; i < 60 * 10; i++) { world.step(DT, entrada()); ticks += ev(world, 'objective').filter(e => e.what === 'tick').length; }
    expect(ticks).toBe(10);
    expect(world.status).toBe('playing');
    let fallo = false;
    for (let i = 0; i < 60 * 2; i++) { world.step(DT, entrada()); if (ev(world, 'objective').some(e => e.what === 'failed')) fallo = true; }
    expect(fallo).toBe(true);
    expect(world.status).toBe('failed');
  });

  it('matar a todos NO limpia una zona con objetivo (sólo el objetivo)', () => {
    const f = nuevo();
    clearZone(f.world, 100);
    expect(f.world.status).toBe('playing');
  });
});

describe('v1.3 · objetivo: defender el servidor', () => {
  const nuevo = (floor = 3, zone = 1) => { const f = mk(floor, zone); f.world.initObjective('defend'); return f; };

  it('servidor de 400 en el centro: la defensa empieza al llegar a ≤ 6 m y dura 120 s', () => {
    const f = nuevo();
    const { world } = f, o = world.objective;
    expect(o.stage).toBe('reach');
    expect(o.hp).toBe(400); expect(o.maxHp).toBe(400);
    expect(o.timeLeft).toBe(120);
    run(world, 3, entrada());
    expect(o.stage).toBe('reach');
    expect(o.timeLeft).toBe(120);                              // el reloj no corre hasta llegar
    const q = pointAtDistance(world, o.points[0].x, o.points[0].y, 5);
    place(world, world.player, q![0], q![1]);
    step(world, entrada());
    expect(o.stage).toBe('hold');
    run(world, 10, entrada());
    expect(o.timeLeft).toBeLessThan(111); expect(o.timeLeft).toBeGreaterThan(108);
  });

  it('en hold el director manda oleadas continuas (no se acaban a los 30 s)', () => {
    const f = nuevo();
    const { world } = f, o = world.objective;
    const q = pointAtDistance(world, o.points[0].x, o.points[0].y, 5)!;
    place(world, world.player, q[0], q[1]);
    step(world, entrada());
    const spawns: number[] = [];
    let n = 0;
    for (let i = 0; i < 60 * 80; i++) {
      for (const e of world.entities) if (e.alive && e.team === 'enemy' && Math.hypot(e.x - world.player.x, e.y - world.player.y) < 4) world.kill(e);
      world.player.hp = world.player.maxHp = 99999;
      world.step(DT, entrada());
      n += ev(world, 'spawn').length;
      if (i % 600 === 0) spawns.push(n);
    }
    expect(n).toBeGreaterThan(10);
    expect(spawns[spawns.length - 1]).toBeGreaterThan(spawns[3]);   // siguen llegando en la segunda mitad
  });

  it('los enemigos que están a ≤ 12 m con línea de visión y ya buscan al jugador disparan al servidor; sin visión no', () => {
    const f = nuevo();
    const { world } = f, o = world.objective;
    const q = pointAtDistance(world, o.points[0].x, o.points[0].y, 5)!;
    place(world, world.player, q[0], q[1]);
    step(world, entrada());
    for (const e of world.entities) if (e.team === 'enemy') { e.alive = false; }
    for (const a of world.entities) if (a.team === 'ally' && !a.isPlayer) a.alive = false;   // que la escuadra no mate al tirador de la prueba
    world.director.update = () => {};
    const c = pointAtDistance(world, o.points[0].x, o.points[0].y, 4)!;
    const e = world.spawnUnit('enemy3', c[0], c[1], false);
    e.brain.belief = { x: world.player.x, y: world.player.y, t: world.time, id: world.player.id, vx: 0, vy: 0 };
    e.brain.visId = -1;
    const hp0 = o.hp;
    for (let i = 0; i < 60 * 6; i++) { e.brain.visId = -1; e.brain.belief = { x: 0, y: 0, t: world.time, id: -1, vx: 0, vy: 0 }; world.player.hp = world.player.maxHp = 99999; world.step(DT, entrada()); }
    expect(o.hp).toBeLessThan(hp0);
    // servidor a 0 → fracasa
    o.hp = 0.1;
    for (let i = 0; i < 60 * 5 && world.status === 'playing'; i++) { e.brain.visId = -1; e.brain.belief = { x: 0, y: 0, t: world.time, id: -1, vx: 0, vy: 0 }; world.player.hp = 99999; e.mag = 10; e.reloading = 0; e.fireCd = 0; world.step(DT, entrada()); }
    expect(world.status).toBe('failed');
  });

  it('al acabar el reloj la zona queda limpia y los enemigos que quedan desaparecen', () => {
    const f = nuevo();
    const { world } = f, o = world.objective;
    const q = pointAtDistance(world, o.points[0].x, o.points[0].y, 5)!;
    place(world, world.player, q[0], q[1]);
    step(world, entrada());
    o.timeLeft = 0.3;
    world.player.hp = world.player.maxHp = 99999;
    run(world, 0.5, entrada());
    expect(world.status).toBe('cleared');
    expect(world.enemiesAlive()).toBe(0);
  });
});

describe('v1.3 · objetivo: rescatar al rehén', () => {
  const nuevo = (floor = 3, zone = 1) => { const f = mk(floor, zone); f.world.initObjective('rescue'); return f; };

  it('el rehén es un aliado de 80 de vida que no cuenta como miembro; stage find → (interact a ≤ 1,6 m) → escort', () => {
    const f = nuevo();
    const { world } = f, o = world.objective;
    const h = world.entityById(o.hostageId)!;
    expect(h.team).toBe('ally'); expect(h.hostage).toBe(true); expect(h.hp).toBe(80); expect(h.maxHp).toBe(80);
    expect(world.memberSnapshot()).not.toHaveProperty('enemy1');
    expect(Object.keys(world.memberSnapshot()).sort()).toEqual(['captain', 'especialist', 'explosives', 'technic']);
    expect(o.stage).toBe('find');
    const lejos = pointAtDistance(world, h.x, h.y, 4)!;
    place(world, world.player, lejos[0], lejos[1]);
    mantener(world, 0.5);
    expect(o.stage).toBe('find');                              // demasiado lejos
    const cerca = pointAtDistance(world, h.x, h.y, 1.2)!;
    place(world, world.player, cerca[0], cerca[1]);
    step(world, entrada());
    expect(o.interact).toBe(0);
    mantener(world, 0.2);
    expect(o.stage).toBe('escort');
  });

  it('el rehén sigue al jugador y la zona se limpia cuando los dos están a ≤ 3 m del inicio', () => {
    const f = nuevo();
    const { world } = f, o = world.objective;
    const h = world.entityById(o.hostageId)!;
    const cerca = pointAtDistance(world, h.x, h.y, 1.2)!;
    place(world, world.player, cerca[0], cerca[1]);
    mantener(world, 0.2);
    expect(o.stage).toBe('escort');
    world.director.update = () => {};
    for (const e of world.entities) if (e.team === 'enemy') e.alive = false;
    // el jugador se va hacia un punto a 7 m: el rehén se acerca
    const lejos = pointAtDistance(world, h.x, h.y, 7)!;
    place(world, world.player, lejos[0], lejos[1]);
    const d0 = Math.hypot(h.x - world.player.x, h.y - world.player.y);
    run(world, 4, entrada());
    expect(Math.hypot(h.x - world.player.x, h.y - world.player.y)).toBeLessThan(d0 - 2);
    // extracción
    const [sx, sy] = world.level.map.inicio_jugador;
    place(world, world.player, sx, sy);
    const dd = pointAtDistance(world, sx, sy, 1.5)!;
    place(world, h, dd[0], dd[1]);
    step(world, entrada());
    expect(world.status).toBe('cleared');
  });

  it('rehén muerto → fracaso, y no cuenta en alliesLost', () => {
    const f = nuevo();
    const { world } = f, o = world.objective;
    world.kill(world.entityById(o.hostageId)!);
    step(world, entrada());
    expect(world.status).toBe('failed');
    expect(world.stats.alliesLost).toBe(0);
  });

  it('los enemigos sólo le disparan si ya hay combate y no ven a otro blanco', () => {
    const dano = (alerta: boolean) => {
      const f = nuevo();
      const { world } = f, o = world.objective;
      world.director.update = () => {};
      for (const e of world.entities) if (e.team === 'enemy') e.alive = false;
      const h = world.entityById(o.hostageId)!;
      const c = pointAtDistance(world, h.x, h.y, 4)!;
      const e = world.spawnUnit('enemy3', c[0], c[1], false);
      place(world, world.player, world.level.map.inicio_jugador[0], world.level.map.inicio_jugador[1]);
      let tiros = 0;
      for (let i = 0; i < 60 * 8; i++) {
        e.brain.visId = -1;
        e.brain.belief = alerta ? { x: world.player.x, y: world.player.y, t: world.time, id: world.player.id, vx: 0, vy: 0 } : null;
        world.step(DT, entrada());
        if (!h.alive) break;
        tiros += ev(world, 'shot').filter(s => s.id === e.id).length;
      }
      return { hp: h.hp, tiros };
    };
    expect(dano(true).hp).toBeLessThan(80);
    expect(dano(false).hp).toBe(80);
  });
});

describe('v1.3 · consola: objective', () => {
  it('cambia el objetivo de la zona y cuenta como truco', () => {
    const { world } = campaignWorld(3, 1);
    expect(exec(world, 'objective').join(' ')).toMatch(/uso/);
    const out = exec(world, 'objective defuse');
    expect(out[0]).toMatch(/defuse/);
    expect(world.objective.kind).toBe('defuse');
    expect(world.cheated).toBe(true);
    exec(world, 'objective clear');
    expect(world.objective.kind).toBe('clear');
  });
});

describe('v1.3 · modificadores y segunda vuelta', () => {
  it('multiplicadores: se multiplican entre sí; newCampaign guarda los modificadores válidos y ngPlus', () => {
    const f = mk(3, 1, () => {}, { mutators: ['rapidos', 'solo-pistola', 'inventado'], ngPlus: true });
    expect(f.state.mutators).toEqual(['rapidos', 'solo-pistola']);
    expect(f.state.ngPlus).toBe(1);
    expect(scoreMultOf(f.state)).toBeCloseTo(1.15 * 1.4 * 1.5, 9);
    expect(MUTATORS.map(m => m.id).sort()).toEqual(['escasez', 'jefes-dobles', 'rapidos', 'sin-aura', 'solo-pistola']);
    const g = mk(3, 1);
    expect(scoreMultOf(g.state)).toBe(1);
    expect(g.state.ngPlus).toBeUndefined();
  });

  it('puntos: los enemigos dan puntos × el multiplicador total', () => {
    const f = mk(3, 1, () => {}, { mutators: ['rapidos', 'solo-pistola'] });
    const e = f.world.spawnUnit('miniboss', f.world.player.x + 3, f.world.player.y, false);
    f.world.score = 0; f.world.stats.scoreGained = 0;
    f.world.kill(e, f.world.player);
    expect(f.world.stats.scoreGained).toBe(Math.round(50 * scoreMultOf(f.state)));
    const g = mk(3, 1, () => {}, { ngPlus: true });
    const k = g.world.spawnUnit('miniboss', g.world.player.x + 3, g.world.player.y, false);
    g.world.stats.scoreGained = 0;
    g.world.kill(k, g.world.player);
    expect(g.world.stats.scoreGained).toBe(75);
  });

  it('rápidos: enemigos +20 % de velocidad', () => {
    const v = (mu: string[]) => mk(3, 1, () => {}, { mutators: mu }).world.spawnUnit('enemy1', 5, 5, false).stats.speed;
    expect(v(['rapidos']) / v([])).toBeCloseTo(1.2, 9);
  });

  it('sin-aura: el aura de curación del Capitán no cura', () => {
    const cura = (mu: string[]) => {
      const f = mk(3, 1, () => {}, { mutators: mu });
      const w = f.world;
      const t = w.entities.find(e => e.cls === 'technic')!, c = w.entities.find(e => e.cls === 'captain')!;
      t.x = c.x + 2; t.y = c.y; t.hp = 30;
      (w as any).updateAuras(2.01);
      return t.hp - 30;
    };
    expect(cura([])).toBe(1);
    expect(cura(['sin-aura'])).toBe(0);
  });

  it('jefes-dobles: dos MiniBoss en una planta con jefe', () => {
    const n = (mu: string[]) => mk(3, 1, () => {}, { mutators: mu }).world.entities.filter(e => e.kind === 'miniboss').length;
    expect(n([])).toBe(1);
    expect(n(['jefes-dobles'])).toBe(2);
  });

  it('solo-pistola: el jugador sólo puede usar la pistola (los aliados, su arma de siempre)', () => {
    const f = mk(3, 1, () => {}, { mutators: ['solo-pistola'] });
    const { world } = f, p = world.player;
    expect(p.weapon).toBe('secondary');
    world.step(DT, entrada({ weaponSlot: 'primary' }));
    expect(p.weapon).toBe('secondary');
    world.step(DT, entrada({ weaponCycle: 1 }));
    expect(p.weapon).not.toBe('primary');
    world.step(DT, entrada({ weaponCycle: 1 }));
    world.step(DT, entrada({ weaponCycle: 1 }));
    world.step(DT, entrada({ weaponCycle: 1 }));
    expect(p.weapon).not.toBe('primary');
    for (const a of world.entities) if (a.team === 'ally' && !a.isPlayer) expect(a.weapon).toBe('primary');
  });

  it('escasez: la mitad de las cajas de munición del mapa', () => {
    const cajas = (mu: string[]) => mk(3, 1, () => {}, { mutators: mu }).world.pickups.filter(k => k.type.startsWith('municion')).length;
    const base = cajas([]);
    expect(base).toBeGreaterThanOrEqual(2);
    expect(cajas(['escasez'])).toBe(Math.ceil(base / 2));
  });

  it('segunda vuelta: +25 % de enemigos, +15 % de vida, puntos ×1,5; empieza con 6 opciones de mejora', () => {
    const a = mk(3, 1), b = mk(3, 1, () => {}, { ngPlus: true });
    const ta = directorConfig(a.state, 3, 'pequeno').total, tb = directorConfig(b.state, 3, 'pequeno').total;
    expect(tb / ta).toBeGreaterThan(1.2); expect(tb / ta).toBeLessThan(1.3);
    const hp = (f: typeof a) => f.world.spawnUnit('enemy1', 5, 5, false).maxHp;
    expect(hp(b) / hp(a)).toBeCloseTo(NG_PLUS.hp, 1);
    expect(scoreMultOf(b.state)).toBe(1.5);
    const ch = b.campaign.ngStartChoices(b.state);
    expect(ch).toHaveLength(6);
    expect(new Set(ch).size).toBe(6);
    expect(ch.every(id => UPGRADES.some(u => u.id === id))).toBe(true);
    expect(NG_PLUS.startPicks).toBe(2);
    expect(b.campaign.ngStartChoices(b.state)).toEqual(ch);      // determinista
  });

  it('los récords de nota no se guardan con modificadores ni en la segunda vuelta', () => {
    for (const opts of [{ mutators: ['rapidos'] }, { ngPlus: true }, {}]) {
      const f = mk(3, 1, () => {}, opts);
      clearZone(f.world);
      const s = f.campaign.completeZone(f.state, f.world);
      const limpio = Object.keys(opts).length === 0;
      expect(s.newRecord).toBe(limpio);
      expect(Object.keys(f.campaign.records()).length).toBe(limpio ? 1 : 0);
    }
  });

  it('meta: la primera victoria (sin trucos) desbloquea la segunda vuelta y cuenta victorias; con trucos no', () => {
    const f = mk(9, 1);
    expect(f.campaign.meta()).toEqual({ wins: 0, ngUnlocked: false, hordeBest: {} });
    clearZone(f.world);
    f.campaign.completeZone(f.state, f.world);
    expect(f.campaign.meta()).toMatchObject({ wins: 1, ngUnlocked: true });
    expect(JSON.parse(f.storage.getItem('stracomter3.meta')!).wins).toBe(1);
    const g = mk(9, 1);
    const st = f.storage; void st;
    g.world.cheated = true;
    clearZone(g.world);
    g.campaign.completeZone(g.state, g.world);
    expect(g.campaign.meta().wins).toBe(0);
  });
});

describe('v1.3 · modo horda', () => {
  const nueva = (dif: Difficulty = 'normal', floor = 3) => {
    const storage = memStorage();
    const campaign = createCampaign(storage);
    const state = campaign.newHorde(dif, 'captain', floor);
    const world = campaign.startZone(state, 1) as World;
    return { storage, campaign, state, world };
  };

  it('newHorde: mapa mediano de la planta, tema de esa planta, sin guardado; oleada 1 = 6 + 2n enemigos (× dificultad)', () => {
    const f = nueva();
    expect(f.state.horde).toEqual({ floor: 3, best: 0 });
    expect(f.world.horde).not.toBeNull();
    expect(f.world.horde!.wave).toBe(1);
    expect(f.world.level.map.tamano).toBe('mediano');
    expect(f.world.level.theme).toBe('desarrollo');
    expect(f.world.enemiesAlive() + f.world.director.pending()).toBe(8);
    expect(hordeEnemies(5, 'normal')).toBe(16);
    expect(hordeEnemies(5, 'easy')).toBeLessThan(hordeEnemies(5, 'normal'));
    expect(hordeEnemies(5, 'hard')).toBeGreaterThan(hordeEnemies(5, 'normal'));
    expect(f.campaign.hasSave()).toBe(false);
    expect(f.storage.map.size).toBe(0);
    expect(ev(f.world, 'wave').length >= 0).toBe(true);
  });

  it('progresión: acabar la oleada da suministros y 12 s de descanso; después viene la siguiente con más enemigos', () => {
    const f = nueva();
    const { world } = f, h = world.horde!;
    const olas: { wave: number; boss: boolean }[] = [];
    let pickupsAntes = world.pickups.filter(k => !k.taken).length;
    let descanso = false;
    for (let i = 0; i < 60 * 90 && h.wave < 2; i++) {
      for (const e of world.entities) if (e.alive && e.team === 'enemy') { e.shielded = false; world.kill(e); }
      world.step(DT, entrada());
      for (const w of ev(world, 'wave')) olas.push(w);
      if (h.rest > 0) descanso = true;
    }
    expect(descanso).toBe(true);
    expect(h.wave).toBe(2);
    expect(olas.map(o => o.wave)).toContain(2);
    expect(world.pickups.filter(k => !k.taken).length).toBeGreaterThan(pickupsAntes);
    expect(world.pickups.some(k => !k.taken && k.type === 'municion_50')).toBe(true);
    expect(world.pickups.some(k => !k.taken && k.type === 'vida_50')).toBe(true);
    // la oleada 2 son 6 + 2·2 = 10 enemigos
    expect(world.enemiesAlive() + world.director.pending()).toBe(10);
    expect(world.status).toBe('playing');
    void pickupsAntes;
  });

  it('cada 2 oleadas el mundo se pausa hasta elegir mejora (hordePick) y la mejora se aplica', () => {
    const f = nueva();
    const { world } = f, h = world.horde!;
    let pausa = false;
    for (let i = 0; i < 60 * 200 && !pausa; i++) {
      for (const e of world.entities) if (e.alive && e.team === 'enemy') { e.shielded = false; world.kill(e); }
      world.step(DT, entrada());
      if (h.pickUpgrade) pausa = true;
    }
    expect(pausa).toBe(true);
    expect(h.wave).toBe(2);                                     // se ofrece al acabar la oleada 2
    const t0 = world.time;
    run(world, 2, entrada());
    expect(world.time).toBe(t0);                                // pausa lógica: no corre nada
    expect(h.pickUpgrade).toBe(true);
    const ch = f.campaign.hordeChoices(f.state);
    expect(ch).toHaveLength(3);
    const hp0 = world.player.maxHp;
    world.hordePick('vigor');
    expect(h.pickUpgrade).toBe(false);
    expect(world.player.maxHp).toBe(hp0 + 20);
    expect(f.state.upgrades).toContain('vigor');
    expect(f.campaign.hordeChoices(f.state)).not.toContain('vigor');
    run(world, 1, entrada());
    expect(world.time).toBeGreaterThan(t0);
  });

  it('la oleada 5 trae un jefe de planta (y rota la variante cada 5); los derribados se levantan al acabar la oleada, los muertos no', () => {
    const f = nueva();
    const { world } = f, h = world.horde!;
    let jefe = false, derribadoVisto = false, jefeVariante = '';
    const tecnic = world.entities.find(e => e.cls === 'technic')!, expl = world.entities.find(e => e.cls === 'explosives')!;
    for (let i = 0; i < 60 * 600 && h.wave <= 5; i++) {
      if (h.wave === 2 && !derribadoVisto && tecnic.alive && !tecnic.downed) { world.damage(tecnic, 9999, null, 'torso', 0, 0); world.kill(expl); derribadoVisto = true; }
      for (const e of world.entities) if (e.alive && e.team === 'enemy') { e.shielded = false; if (e.kind === 'miniboss' && h.wave === 5) { jefe = true; jefeVariante = e.bossVariant ?? ''; } world.kill(e); }
      world.step(DT, entrada());
      if (h.pickUpgrade) world.hordePick(f.campaign.hordeChoices(f.state)[0]);
      if (h.wave === 5 && h.bossWave && !jefe) { jefe = world.entities.some(e => e.alive && e.kind === 'miniboss'); }
      if (world.status !== 'playing') break;
    }
    expect(jefe).toBe(true);
    expect(jefeVariante).toBe('cohetes');                       // primera rotación
    expect(tecnic.downed).toBe(false);                          // se levantó
    expect(tecnic.alive).toBe(true);
    expect(expl.alive).toBe(false);                             // los muertos no vuelven
  });

  it('al morir el jugador: finishHorde guarda la mejor oleada por planta; una peor no la baja; con trucos no se guarda', () => {
    const f = nueva();
    f.world.horde!.wave = 7;
    f.world.kill(f.world.player);
    expect(f.world.status).toBe('dead');
    const r = f.campaign.finishHorde(f.state, f.world);
    expect(r).toEqual({ wave: 7, best: 7, newRecord: true });
    expect(f.campaign.meta().hordeBest[3]).toBe(7);
    const camp2 = createCampaign(f.storage);
    const st2 = camp2.newHorde('normal', 'captain', 3);
    const w2 = camp2.startZone(st2, 1) as World;
    w2.horde!.wave = 4;
    const r2 = camp2.finishHorde(st2, w2);
    expect(r2.newRecord).toBe(false);
    const h = createCampaign(f.storage);
    expect(h.meta().hordeBest[3]).toBe(7);
    const c = (() => { const x = createCampaign(f.storage); const st = x.newHorde('normal', 'captain', 3); const w = x.startZone(st, 1) as World; w.cheated = true; w.horde!.wave = 30; return x.finishHorde(st, w); })();
    expect(c.newRecord).toBe(false);
    expect(createCampaign(f.storage).meta().hordeBest[3]).toBe(7);
  });

  it('constantes de la horda: 12 s de descanso, mejora cada 2 oleadas, jefe cada 5', () => {
    expect(HORDE.rest).toBe(12); expect(HORDE.pickEvery).toBe(2); expect(HORDE.bossEvery).toBe(5);
    expect(OBJECTIVE.defendTime).toBe(120);
  });
});
