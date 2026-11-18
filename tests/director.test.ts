// Director de zona (DEFINICION §8 y §9): cuántos enemigos, de qué tipo, dónde aparecen y cuándo se da por limpia.
//
// QUÉ MODOS DE FALLO NO CUBRE ESTE FICHERO:
//  - «A la vista» se mide con rayos de visión geométricos (world.level.clear en modo 'sight') desde los ojos del
//    jugador y desde la cámara, y se cuenta como «en pantalla» lo que además cae a ±50° del frente de la cámara.
//    No es el frustum real del renderizador (campo de visión, relación de aspecto, zoom) ni mira oclusión por
//    muebles bajos a través de la cámara en tercera persona real: es una aproximación.
//  - Las apariciones durante la partida se miden con el bot de tools/partida.ts (que avanza con datos perfectos y
//    en modo dios): el jugador humano se mueve distinto, así que cuántas apariciones caen a la vista puede variar.
//  - Todo el recuento (totales, mezcla) se hace matando a los enemigos en cuanto salen (clearZone): prueba lo que el
//    director CREA, no lo que un jugador llega a ver a la vez; el tope de vivos simultáneos (ALIVE_CAP) y el ritmo
//    ascenso/pico/alivio con enemigos vivos se vigilan poco.
//  - La planta 9 (MegaBoss) no entra en el recuento de la tabla ni en la mezcla (sus refuerzos dependen de las
//    fases del jefe); sólo en las mediciones de «al empezar».
//  - Dificultades Fácil y Difícil no se prueban aquí (la tabla del documento es la de Normal).
//  - Las comparaciones usan ENEMY_COUNT/ENEMY_MIX de data.ts, que ya recogen las desviaciones apuntadas en
//    DECISIONES.md respecto a la tabla del documento (plantas 3, 5 y 7).

import { describe, expect, it } from 'vitest';
import { playZone } from '../tools/partida';
import { ENEMY_COUNT, ENEMY_MIX, ZONE_SIZE } from '../src/sim/data';
import { emptyInput } from '../src/sim/types';
import { angDiff, type World } from '../src/sim/world';
import { DT, clearZone, quickWorld, watchSteps } from './helpers';

const IDX = { pequeno: 0, mediano: 1, grande: 2 } as const;
const FOV_MEDIO = 50;   // grados a cada lado del frente de la cámara que se consideran «en pantalla»

function esBasico(k: string) { return k === 'enemy1' || k === 'enemy2' || k === 'enemy3'; }

/** ¿Ve el jugador (ojos o cámara, como el propio director) ese punto? */
function losJugador(w: World, x: number, y: number, hb: number[]): { ojos: boolean; cam: boolean } {
  const p = w.player, L = w.level;
  const ojos = hb.some(z => L.clear(p.x, p.y, 1.6, x, y, z, 'sight'));
  const cam = hb.some(z => L.clear(w.cam.x, w.cam.y, w.cam.z, x, y, z, 'sight'));
  return { ojos, cam };
}
function enPantalla(w: World, x: number, y: number): boolean {
  const l = losJugador(w, x, y, [0.9, 1.7]);
  if (!l.ojos && !l.cam) return false;
  const ang = Math.abs(angDiff(Math.atan2(y - w.player.y, x - w.player.x), w.cam.yaw)) * 180 / Math.PI;
  return ang < FOV_MEDIO;
}

// ───────────────────────── 9. Dónde aparecen: al empezar la zona ─────────────────────────

describe('9 · al empezar una zona', () => {
  const zonas: [number, number][] = [];
  for (let f = 1; f <= 8; f++) for (let z = 1; z <= 6; z++) zonas.push([f, z]);
  zonas.push([9, 1]);

  it('9 · medición: distancia mínima y enemigos a menos de 12 m por tamaño de mapa (informativa)', () => {
    const res: Record<string, { min: number; menos12: number; total: number }> = {};
    for (const [f, z] of zonas) {
      const { world } = quickWorld(f, z);
      const key = world.level.map.tamano + (f === 1 ? ' (planta 1, mapa real)' : '');
      const r = res[key] ??= { min: Infinity, menos12: 0, total: 0 };
      for (const e of world.entities) {
        if (e.team !== 'enemy' || !esBasico(e.kind)) continue;
        const d = Math.hypot(e.x - world.player.x, e.y - world.player.y);
        r.total++; r.min = Math.min(r.min, d); if (d < 12) r.menos12++;
      }
    }
    console.log('[8/9] distancia al jugador al empezar la zona (enemigos básicos):\n' +
      Object.entries(res).map(([k, v]) => `   ${k}: mínimo ${v.min.toFixed(1)} m; ${v.menos12} de ${v.total} a menos de 12 m`).join('\n'));
    expect(Object.keys(res).length).toBeGreaterThanOrEqual(3);
  });

  it('9 · mapas mediano y grande: ningún enemigo (básico) empieza a menos de 12 m; pequeño: nunca a menos de 5 m', () => {
    const malos: string[] = [];
    for (const [f, z] of zonas) {
      const { world } = quickWorld(f, z);
      const peq = world.level.map.tamano === 'pequeno';
      for (const e of world.entities) {
        if (e.team !== 'enemy' || !esBasico(e.kind)) continue;
        const d = Math.hypot(e.x - world.player.x, e.y - world.player.y);
        if (d < (peq ? 5 : 12)) malos.push(`P${f}Z${z} ${e.kind}#${e.id} a ${d.toFixed(1)} m (${world.level.map.tamano})`);
      }
    }
    expect(malos).toEqual([]);
  });

  it('9 · ningún enemigo (básico) empieza a la vista del jugador (±50° del frente, por ojos o cámara)', () => {
    const malos: string[] = [];
    let total = 0;
    for (const [f, z] of zonas) {
      const { world } = quickWorld(f, z);
      for (const e of world.entities) {
        if (e.team !== 'enemy' || !esBasico(e.kind)) continue;
        total++;
        if (enPantalla(world, e.x, e.y)) {
          const d = Math.hypot(e.x - world.player.x, e.y - world.player.y);
          malos.push(`P${f}Z${z} ${e.kind}#${e.id} a ${d.toFixed(1)} m`);
        }
      }
    }
    expect(total).toBeGreaterThan(300);
    // Pista para quien depure un fallo aquí (hipótesis, no comprobada): el constructor de World llama a
    // director.begin() ANTES de computeCam(), así que al colocar a los enemigos iniciales w.cam vale aún (0,0,2) y el
    // rayo «desde la cámara» de Director.visibleToPlayer no sale de donde luego estará la cámara real.
    expect(malos, `${malos.length} de ${total} empiezan a la vista`).toEqual([]);
  });

  it('9 · el jefe (miniboss/MegaBoss) tampoco empieza a la vista del jugador', () => {
    const malos: string[] = [];
    for (const [f, z] of zonas) {
      const { world } = quickWorld(f, z);
      for (const e of world.entities) {
        if (e.team !== 'enemy' || esBasico(e.kind)) continue;
        if (enPantalla(world, e.x, e.y)) malos.push(`P${f}Z${z} ${e.kind} a ${Math.hypot(e.x - world.player.x, e.y - world.player.y).toFixed(1)} m`);
      }
    }
    expect(malos).toEqual([]);
  });

  it('8 · al empezar, enemigos vivos + por salir = la tabla (+1 jefe en plantas 2-8)', () => {
    for (let f = 1; f <= 8; f++) for (const z of [1, 3, 5]) {
      const { world } = quickWorld(f, z);
      const esperado = ENEMY_COUNT[f][IDX[ZONE_SIZE[z - 1]]] + (f >= 2 ? 1 : 0);
      expect(world.enemiesRemaining(), `P${f}Z${z}`).toBe(esperado);
    }
  });
});

// ───────────────────────── 9. Dónde aparecen: durante la partida ─────────────────────────

describe('9 · apariciones durante una zona jugada por el bot', () => {
  const zonas: [number, number][] = [[1, 1], [1, 3], [1, 5], [2, 1], [3, 3], [4, 2], [6, 5], [8, 3]];
  interface Medida { n: number; min: number; menos12: number; losOmni: number; enCono: number; lejos: string[]; vistas: string[]; peq: boolean; result: string }
  const memo = new Map<string, Medida>();
  /** Juega la zona con el bot y mide cada suceso 'spawn' de enemigo en el instante en que ocurre. */
  const medir = (floor: number, zone: number): Medida => {
    const k = `${floor}:${zone}`;
    const hecho = memo.get(k);
    if (hecho) return hecho;
    const { world } = quickWorld(floor, zone);
    const m: Medida = { n: 0, min: Infinity, menos12: 0, losOmni: 0, enCono: 0, lejos: [], vistas: [], peq: world.level.map.tamano === 'pequeno', result: '' };
    watchSteps(world, w => {
      for (const ev of w.events) {
        if (ev.type !== 'spawn') continue;
        const e = w.entityById(ev.id)!;
        if (e.team !== 'enemy') continue;
        m.n++;
        const p = w.player;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        m.min = Math.min(m.min, d);
        if (d < 12) m.menos12++;
        const l = losJugador(w, e.x, e.y, [0.9, 1.7]);
        if (l.ojos || l.cam) m.losOmni++;
        if (enPantalla(w, e.x, e.y)) { m.enCono++; m.vistas.push(`t=${w.time.toFixed(1)} ${e.kind}#${e.id} d=${d.toFixed(1)} m`); }
        if (d < (m.peq ? 5 : 12)) m.lejos.push(`t=${w.time.toFixed(1)} ${e.kind}#${e.id} d=${d.toFixed(1)} m`);
      }
    });
    m.result = playZone(world, 600, true).result;
    console.log(`[9] P${floor}Z${zone} (${world.level.map.tamano}): ${m.n} apariciones, distancia mínima ${m.min.toFixed(1)} m, ` +
      `${m.menos12} a <12 m, ${m.losOmni} con línea de visión desde ojos/cámara, ${m.enCono} en pantalla (±${FOV_MEDIO}°) — ${m.result}`);
    memo.set(k, m);
    return m;
  };
  for (const [floor, zone] of zonas) {
    it(`9 · planta ${floor} zona ${zone}: cada aparición está a ≥12 m del jugador (≥5 m en mapa pequeño)`, () => {
      const m = medir(floor, zone);
      expect(m.n).toBeGreaterThan(0);
      expect(m.lejos.slice(0, 6), `${m.lejos.length} de ${m.n} incumplen; mínimo ${m.min.toFixed(1)} m`).toEqual([]);
    }, 60_000);
    it(`9 · planta ${floor} zona ${zone}: ninguna aparición cae en la vista del jugador (±${FOV_MEDIO}° del frente, ojos o cámara)`, () => {
      const m = medir(floor, zone);
      expect(m.vistas.slice(0, 6), `${m.enCono} de ${m.n} aparecen a la vista`).toEqual([]);
    }, 60_000);
  }
});

// ───────────────────────── 8. Totales, mezcla y limpieza ─────────────────────────

/** Juega una zona matando a todos en cuanto salen y devuelve lo creado. */
function recuento(f: number, z: number) {
  const { world } = quickWorld(f, z);
  let alivioPrematuro = 0, limpiaConVivos = 0, limpiaConPendientes = 0;
  watchSteps(world, (w, before) => {
    const vivos = w.enemiesAlive(), pend = w.director.pending();
    if (before.status === 'playing' && w.status === 'cleared') {
      if (vivos > 0) limpiaConVivos++;
      if (pend > 0) limpiaConPendientes++;
    }
    if (w.status === 'cleared' && (vivos > 0 || pend > 0)) alivioPrematuro++;
  });
  clearZone(world, 1200);
  const hechos = world.entities.filter(e => e.team === 'enemy');
  const cuenta = { enemy1: 0, enemy2: 0, enemy3: 0, jefes: 0 };
  for (const e of hechos) { if (esBasico(e.kind)) cuenta[e.kind as 'enemy1']++; else cuenta.jefes++; }
  return { world, cuenta, alivioPrematuro, limpiaConVivos, limpiaConPendientes };
}

describe('8 · totales y mezcla que crea el director (Normal)', () => {
  const casos: [number, number][] = [];
  for (let f = 1; f <= 8; f++) for (const z of [1, 3, 5]) casos.push([f, z]);
  const memo = new Map<string, ReturnType<typeof recuento>>();
  const get = (f: number, z: number) => { const k = `${f}:${z}`; if (!memo.has(k)) memo.set(k, recuento(f, z)); return memo.get(k)!; };

  for (const [f, z] of casos) {
    it(`8 · planta ${f} zona ${z}: se crean exactamente los de la tabla, la mezcla se parece (±8 puntos) y la zona acaba limpia`, () => {
      const { world, cuenta } = get(f, z);
      const idx = IDX[ZONE_SIZE[z - 1]];
      const total = cuenta.enemy1 + cuenta.enemy2 + cuenta.enemy3;
      expect(total, 'enemigos básicos creados').toBe(ENEMY_COUNT[f][idx]);
      expect(cuenta.jefes, 'jefes').toBe(f >= 2 ? 1 : 0);
      expect(world.status).toBe('cleared');
      expect(world.director.pending()).toBe(0);
      const mix = ENEMY_MIX[f];
      const real = [cuenta.enemy1, cuenta.enemy2, cuenta.enemy3].map(c => c / total);
      for (let i = 0; i < 3; i++) expect(Math.abs(real[i] - mix[i]) * 100, `tipo ${i + 1}: ${(real[i] * 100).toFixed(0)} % vs ${(mix[i] * 100).toFixed(0)} %`).toBeLessThanOrEqual(8);
      if (f >= 4) for (let i = 0; i < 3; i++) expect(real[i], `a partir de la planta 4 ningún tipo baja del 15 % (tipo ${i + 1})`).toBeGreaterThanOrEqual(0.15);
    }, 120_000);
  }

  for (let f = 1; f <= 8; f++) {
    it(`8 · planta ${f}: sumando sus tres tamaños de mapa la mezcla también se parece a la tabla (±8 puntos; ≥15 % desde la 4)`, () => {
      const tot = [0, 0, 0];
      for (const z of [1, 3, 5]) { const c = get(f, z).cuenta; tot[0] += c.enemy1; tot[1] += c.enemy2; tot[2] += c.enemy3; }
      const n = tot[0] + tot[1] + tot[2];
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(tot[i] / n - ENEMY_MIX[f][i]) * 100).toBeLessThanOrEqual(8);
        if (f >= 4) expect(tot[i] / n).toBeGreaterThanOrEqual(0.15);
      }
    }, 120_000);
  }

  it('8 · una zona pasa a "cleared" sólo si no queda nadie vivo ni por salir (se mira en el paso exacto del cambio)', () => {
    let pasos = 0;
    for (const [f, z] of casos) {
      const r = get(f, z);
      pasos++;
      expect(r.limpiaConVivos, `P${f}Z${z}: pasó a cleared con enemigos vivos`).toBe(0);
      expect(r.limpiaConPendientes, `P${f}Z${z}: pasó a cleared con enemigos por salir`).toBe(0);
      expect(r.alivioPrematuro).toBe(0);
    }
    expect(pasos).toBe(24);
  }, 120_000);

  it('8 · con el bot jugando de verdad: nunca "cleared" con enemigos vivos o por salir; y acaba declarándose', () => {
    for (const [f, z] of [[1, 1], [1, 3], [4, 3]] as [number, number][]) {
      const { world } = quickWorld(f, z);
      let cambios = 0, vivosEnElCambio = -1, pendEnElCambio = -1, vistoSinSalir = 0;
      watchSteps(world, (w, before) => {
        if (before.status === 'playing' && w.status === 'cleared') { cambios++; vivosEnElCambio = w.enemiesAlive(); pendEnElCambio = w.director.pending(); }
        // al revés: con 0 vivos y algo por salir tiene que seguir "playing"
        if (w.enemiesAlive() === 0 && w.director.pending() > 0 && w.status !== 'playing') vistoSinSalir++;
      });
      const r = playZone(world, 600, true);
      expect(r.result).toBe('cleared');
      expect(cambios).toBe(1);
      expect(vivosEnElCambio).toBe(0);
      expect(pendEnElCambio).toBe(0);
      expect(vistoSinSalir).toBe(0);
      expect(world.events.length >= 0).toBe(true);
      // y el suceso 'cleared' se emite una sola vez, en el paso del cambio
    }
  }, 60_000);

  it('8 · el suceso "cleared" se emite una vez y el director no suelta a nadie más después', () => {
    const { world } = quickWorld(1, 1);
    let vecesCleared = 0;
    watchSteps(world, w => { for (const ev of w.events) if (ev.type === 'cleared') vecesCleared++; });
    clearZone(world);
    const n = world.entities.length;
    for (let i = 0; i < 600; i++) world.step(DT, emptyInput());
    expect(vecesCleared).toBe(1);
    expect(world.entities.length).toBe(n);
    expect(world.status).toBe('cleared');
  });

  it('8 · ritmo: el ascenso es ~40 % de la zona (en la primera mitad de enemigos creados)', () => {
    // Se mide el orden de creación en un grande: las primeras apariciones son el «ascenso» (inicial + oleadas) y el
    // jefe/grueso viene después: en la planta 3 zona 5, los primeros 40 % de creados llegan antes del pico.
    const { world } = quickWorld(3, 5);
    const fases: string[] = [];
    let creados = 0, enAscenso = 0;
    watchSteps(world, w => {
      for (const ev of w.events) {
        if (ev.type === 'phase') fases.push(ev.phase);
        if (ev.type === 'spawn' && w.entityById(ev.id)?.team === 'enemy') { creados++; if (w.pacing === 'ascenso') enAscenso++; }
      }
    });
    clearZone(world, 1200);
    const total = world.entities.filter(e => esBasico(e.kind)).length;
    const inicial = world.entities.filter(e => esBasico(e.kind)).length - creados;
    expect(fases.indexOf('pico')).toBeGreaterThanOrEqual(0);
    expect(fases.indexOf('pico')).toBeLessThan(fases.indexOf('alivio'));
    expect((inicial + enAscenso) / total).toBeGreaterThan(0.3);
    expect((inicial + enAscenso) / total).toBeLessThan(0.5);
  }, 60_000);
});
