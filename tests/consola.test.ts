// Consola de trucos (DEFINICION §18; punto 21.15 «cada truco hace de verdad lo que dice»).
//
// QUÉ MODOS DE FALLO NO CUBRE ESTE FICHERO:
//  - Se ejecuta la consola real contra un World real, pero NO la interfaz de la consola (abrir con una tecla,
//    historial, foco del teclado, mostrar las líneas de respuesta): eso es de src/ui y sólo se ve jugando.
//  - `floor` y `zone` sólo se comprueba que llaman al host con los argumentos correctos; que el host (src/main.ts)
//    recargue el mundo de verdad no se prueba aquí.
//  - `ai.debug` se comprueba contra world.aiDebug() (los datos), no contra el dibujo de conos y caminos en pantalla.
//  - `god` se comprueba con disparos reales y con una explosión; no con TODAS las fuentes de daño (caídas, jefe con
//    cohetes, etc.). Cualquier ruta de daño nueva que no pase por World.damage escaparía a esta prueba.
//  - Se prueban los nueve tipos de `spawn` en un punto libre del mapa pequeño; no en puntos sin suelo, dentro de
//    muros o fuera del mapa más allá de «no lanza excepción».

import { describe, expect, it } from 'vitest';
import { AMMO_CAP, GRENADE_COUNT } from '../src/sim/data';
import { emptyInput, type Kind } from '../src/sim/types';
import { DT, calmar, exec, killAllies, place, quickWorld, run } from './helpers';

const TIPOS: Kind[] = ['captain', 'technic', 'especialist', 'explosives', 'enemy1', 'enemy2', 'enemy3', 'miniboss', 'megaboss'];
const EQUIPO: Record<Kind, 'ally' | 'enemy'> = {
  captain: 'ally', technic: 'ally', especialist: 'ally', explosives: 'ally',
  enemy1: 'enemy', enemy2: 'enemy', enemy3: 'enemy', miniboss: 'enemy', megaboss: 'enemy',
};

describe('21.15 · consola: cada truco hace lo que dice', () => {
  it('21.15 · god: con un enemigo disparando al jugador su vida no baja; sin god, sí', () => {
    const escenario = (god: boolean) => {
      const { world } = quickWorld(1, 1);
      calmar(world);
      killAllies(world);
      const p = world.player;
      place(world, p, 5.6, 2.2, Math.PI);
      const e = world.spawnUnit('enemy3', 2.8, 2.2, false);
      place(world, e, 2.8, 2.2, 0);
      world.toggleDoor(world.level.doors.find(d => d.vertical && Math.abs(d.cy - 2.18) < 0.1)!.id, true, null);
      if (god) expect(exec(world, 'god').join(' ')).toMatch(/ACTIVADO/);
      expect(world.cheats.god).toBe(god);
      const inp = emptyInput(); inp.yaw = Math.PI;
      let golpes = 0;
      run(world, 6, inp, w => { for (const ev of w.events) if (ev.type === 'shot' && ev.id === e.id && ev.hit === 'entity') golpes++; });
      return { world, p, golpes };
    };
    const conGod = escenario(true);
    expect(conGod.golpes, 'el enemigo sí acierta al jugador (balas con impacto)').toBeGreaterThan(3);
    expect(conGod.p.hp).toBe(conGod.p.maxHp);
    expect(conGod.world.stats.damageTaken).toBe(0);
    expect(conGod.world.status).not.toBe('dead');
    const sinGod = escenario(false);
    expect(sinGod.p.hp, 'control: sin god, el mismo escenario sí quita vida').toBeLessThan(sinGod.p.maxHp);
  });

  it('21.15 · god: también contra explosiones; al desactivarlo (segundo `god`) vuelve a recibir daño', () => {
    const { world } = quickWorld(1, 1);
    calmar(world);
    const p = world.player;
    place(world, p, 3, 2.2);
    exec(world, 'god');
    world.explode(p.x + 0.3, p.y, 1.0, 2, 60, null, null);
    expect(p.hp).toBe(p.maxHp);
    const out = exec(world, 'god');
    expect(out.join(' ')).toMatch(/desactivado/);
    world.explode(p.x + 0.3, p.y, 1.0, 2, 60, null, null);
    expect(p.hp).toBeLessThan(p.maxHp);
  });

  it('21.15 · god: una bala letal de 500 puntos no mata al jugador', () => {
    const { world } = quickWorld(1, 1);
    exec(world, 'god');
    world.damage(world.player, 500, null, 'torso', 0, 0);
    expect(world.player.alive).toBe(true);
    expect(world.status).toBe('playing');
  });

  it('21.15 · noclip: andando contra un muro lo atraviesa; sin noclip se queda parado', () => {
    const intentar = (noclip: boolean) => {
      const { world } = quickWorld(1, 1);
      calmar(world);
      killAllies(world);
      const p = world.player;
      place(world, p, 3.0, 3.4, 0);               // el tabique x∈[4.24,4.57] queda justo delante
      if (noclip) expect(exec(world, 'noclip').join(' ')).toMatch(/ACTIVADO/);
      const inp = emptyInput(); inp.yaw = 0; inp.moveF = 1;
      run(world, 1.6, inp);
      return p.x;
    };
    expect(intentar(false), 'sin noclip: el muro frena').toBeLessThan(4.24);
    expect(intentar(true), 'con noclip: lo atraviesa').toBeGreaterThan(4.9);
  });

  it('21.15 · ammo: deja el cargador lleno, la reserva al tope (999 en total) y las granadas', () => {
    const { world } = quickWorld(1, 1);
    const p = world.player;
    p.mag = 0; p.ammo = 0; p.grenades = 0; p.reloading = 1;
    const out = exec(world, 'ammo');
    expect(out.join(' ')).toMatch(/munici/i);
    expect(p.mag).toBe(p.magSize);
    expect(p.mag + p.ammo).toBe(AMMO_CAP);
    expect(p.grenades).toBe(GRENADE_COUNT);
    expect(p.reloading).toBe(0);
  });

  it('21.15 · health: vida al máximo; no pasa del máximo; muerto no se revive', () => {
    const { world } = quickWorld(1, 1);
    const p = world.player;
    p.hp = 7;
    exec(world, 'health');
    expect(p.hp).toBe(p.maxHp);
    exec(world, 'health');
    expect(p.hp).toBe(p.maxHp);
    world.kill(p);
    const out = exec(world, 'health');
    expect(p.hp).toBe(0);
    expect(out.join(' ')).toMatch(/muerto/);
  });

  it('21.15 · kill bad: mata a todos los enemigos y a nadie más', () => {
    const { world } = quickWorld(1, 1);
    const aliadosAntes = world.entities.filter(e => e.team === 'ally' && e.alive).length;
    expect(world.enemiesAlive()).toBeGreaterThan(0);
    exec(world, 'kill bad');
    expect(world.enemiesAlive()).toBe(0);
    expect(world.entities.filter(e => e.team === 'ally' && e.alive).length).toBe(aliadosAntes);
    expect(world.player.alive).toBe(true);
  });

  it('21.15 · kill bad: quita también el escudo del MegaBoss (planta 9)', () => {
    const { world } = quickWorld(9, 1);
    const boss = world.entities.find(e => e.kind === 'megaboss')!;
    expect(boss).toBeTruthy();
    exec(world, 'kill bad');
    expect(boss.alive).toBe(false);
  });

  it('21.15 · kill me: el jugador muere y el mundo pasa a status "dead"', () => {
    const { world } = quickWorld(1, 1);
    exec(world, 'kill me');
    expect(world.player.alive).toBe(false);
    expect(world.status).toBe('dead');
    expect(world.events.some(ev => ev.type === 'playerDead')).toBe(true);
    // y sigue sin lanzar excepciones al avanzar el mundo
    expect(() => run(world, 1)).not.toThrow();
  });

  it('21.15 · kill all: no queda nadie vivo', () => {
    const { world } = quickWorld(1, 1);
    exec(world, 'kill all');
    expect(world.entities.filter(e => e.alive).length).toBe(0);
    expect(world.status).toBe('dead');
  });

  it('21.15 · tp x y: el jugador aparece en ese punto (o el suelo libre más cercano)', () => {
    const { world } = quickWorld(1, 1);
    exec(world, 'tp 12 2');
    expect(Math.hypot(world.player.x - 12, world.player.y - 2)).toBeLessThan(0.6);
    // un punto dentro de un muro: se recoloca en suelo libre, no queda dentro
    exec(world, 'tp 4.4 3.6');
    expect(world.level.walkableAt(world.player.x, world.player.y, true)).toBe(true);
    // argumentos basura: no se mueve y contesta
    const x0 = world.player.x;
    const out = exec(world, 'tp abc');
    expect(out.join(' ')).toMatch(/uso/);
    expect(world.player.x).toBe(x0);
  });

  describe('spawn y team', () => {
    for (const kind of TIPOS) {
      it(`21.15 · spawn ${kind} 10 2: crea una entidad de ese tipo, en su equipo y cerca del punto`, () => {
        const { world } = quickWorld(1, 1);
        const antes = new Set(world.entities.map(e => e.id));
        const out = exec(world, `spawn ${kind} 10 2`);
        expect(out.join(' ')).toMatch(/creado/);
        const nuevos = world.entities.filter(e => !antes.has(e.id));
        expect(nuevos.length).toBe(1);
        const u = nuevos[0];
        expect(u.kind).toBe(kind);
        expect(u.team).toBe(EQUIPO[kind]);
        expect(u.alive).toBe(true);
        expect(Math.hypot(u.x - 10, u.y - 2)).toBeLessThan(2.5);
        expect(world.level.walkableAt(u.x, u.y, true)).toBe(true);
        // y hace algo al avanzar: tiene estado de IA (los enemigos) o es un refuerzo que sigue al jugador
        run(world, 0.5);
        expect(Number.isFinite(u.x) && Number.isFinite(u.y)).toBe(true);
      });
    }

    it('21.15 · team <tipo> x y crea diez de golpe, todos del tipo y con ids distintos', () => {
      for (const kind of ['enemy2', 'technic'] as Kind[]) {
        const { world } = quickWorld(1, 5);
        const antes = new Set(world.entities.map(e => e.id));
        const out = exec(world, `team ${kind} 20 10`);
        expect(out.join(' ')).toMatch(/×10/);
        const nuevos = world.entities.filter(e => !antes.has(e.id));
        expect(nuevos.length).toBe(10);
        expect(nuevos.every(u => u.kind === kind && u.team === EQUIPO[kind])).toBe(true);
        expect(new Set(nuevos.map(u => u.id)).size).toBe(10);
        run(world, 1);   // los diez conviven un segundo sin romper nada
      }
    });

    it('21.15 · spawn con tipo desconocido o sin coordenadas válidas no crea nada ni lanza', () => {
      const { world } = quickWorld(1, 1);
      const n = world.entities.length;
      expect(() => exec(world, 'spawn dragon 3 3')).not.toThrow();
      expect(() => exec(world, 'spawn enemy1 a b')).not.toThrow();
      expect(world.entities.length).toBe(n);
    });
  });

  it('21.15 · info <id>: devuelve vida, munición y estado de esa entidad', () => {
    const { world } = quickWorld(1, 1);
    run(world, 0.5);
    const e = world.entities.find(u => u.team === 'enemy' && u.alive)!;
    e.hp = 30;
    const out = exec(world, `info ${e.id}`).join(' ');
    expect(out).toContain(`#${e.id}`);
    expect(out).toContain(e.kind);
    expect(out).toMatch(/vida 30\/45|vida 30\/50|vida 30\/65|vida 30\/200/);
    expect(out).toContain(`munición ${e.mag}+${e.ammo}`);
    expect(out).toContain(e.aiState);
    world.kill(e);
    expect(exec(world, `info ${e.id}`).join(' ')).toMatch(/MUERTO/);
    expect(exec(world, 'info 99999').join(' ')).toMatch(/no existe/);
    const todos = exec(world, 'info');
    expect(todos.length).toBeGreaterThan(1);
  });

  it('21.15 · ai.debug: world.aiDebug() devuelve datos de los enemigos al activarlo y nada al desactivarlo', () => {
    const { world } = quickWorld(1, 3);
    run(world, 1);
    expect(world.aiDebug()).toEqual([]);
    exec(world, 'ai.debug');
    run(world, 0.2);
    const d = world.aiDebug();
    expect(d.length).toBeGreaterThan(0);
    const vivos = world.entities.filter(e => e.alive && e.team === 'enemy').map(e => e.id);
    expect(d.every(x => vivos.includes(x.id))).toBe(true);
    for (const x of d) { expect(x.cones).toHaveLength(4); expect(x.cones.every(Number.isFinite)).toBe(true); expect(typeof x.state).toBe('string'); }
    exec(world, 'ai.debug');
    expect(world.aiDebug()).toEqual([]);
  });

  it('21.15 · floor n / zone n llaman al host con (n, null) y (null, n)', () => {
    const { world } = quickWorld(1, 1);
    const llamadas: [number | null, number | null][] = [];
    const host = { gotoFloorZone: (f: number | null, z: number | null) => { llamadas.push([f, z]); return `ok ${f} ${z}`; } };
    expect(exec(world, 'floor 4', host)).toEqual(['ok 4 null']);
    expect(exec(world, 'zone 3', host)).toEqual(['ok null 3']);
    expect(llamadas).toEqual([[4, null], [null, 3]]);
    expect(exec(world, 'floor x', host).join(' ')).toMatch(/uso/);
    expect(llamadas.length).toBe(2);
  });

  it('21.15 · un comando desconocido, vacío o sin partida no lanza excepción', () => {
    const { world } = quickWorld(1, 1);
    expect(() => exec(world, 'xyzzy')).not.toThrow();
    expect(exec(world, 'xyzzy').join(' ')).toMatch(/desconocido/);
    expect(exec(world, '   ')).toEqual([]);
    expect(exec(world, 'help').length).toBeGreaterThan(0);
    const sinMundo = (cmd: string) => import('../src/sim/console').then(m => m.createConsole({ gotoFloorZone: () => 'x' }).exec(cmd, null));
    return Promise.all([sinMundo('god'), sinMundo('kill all'), sinMundo('tp 1 1')]).then(r => {
      for (const o of r) expect(o.join(' ')).toMatch(/No hay partida/);
    });
  });

  it('21.15 · los trucos no rompen la simulación: una ráfaga de todos seguidos y 5 s de juego', () => {
    const { world } = quickWorld(1, 5);
    for (const c of ['god', 'noclip', 'ai.debug', 'ammo', 'health', 'spawn enemy3 20 12', 'team enemy1 25 8', 'tp 20 10', 'kill bad', 'god', 'noclip', 'ai.debug']) exec(world, c);
    expect(() => { for (let i = 0; i < 300; i++) world.step(DT, emptyInput()); }).not.toThrow();
    expect(Number.isFinite(world.player.x)).toBe(true);
  });
});
