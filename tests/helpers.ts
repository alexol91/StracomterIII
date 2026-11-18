// Utilidades comunes de las pruebas de simulación. No es un fichero de pruebas (no acaba en .test.ts).
//
// QUÉ NO CUBRE ESTE MÓDULO: todo se ejecuta con la simulación real (World, Director, EnemyAI), pero sin
// dibujo, audio, controles ni interfaz. El «jugador» es o bien un PlayerInput escrito a mano o bien el bot de
// tools/partida.ts, que apunta con datos perfectos del mundo.

import type { CampaignState, Difficulty, KVStorage } from '../src/contracts';
import { createCampaign } from '../src/sim/campaign';
import { createConsole } from '../src/sim/console';
import { emptyInput, type ClassId, type PlayerInput } from '../src/sim/types';
import type { Unit, World } from '../src/sim/world';

export const DT = 1 / 60;

/** Almacenamiento en memoria (como localStorage). */
export function memStorage(): KVStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: k => void map.delete(k) };
}

export interface Fixture {
  campaign: ReturnType<typeof createCampaign>;
  storage: ReturnType<typeof memStorage>;
  state: CampaignState;
  world: World;
}

/** Mundo de partida rápida (no guarda). */
export function quickWorld(floor: number, zone: number, opts: { difficulty?: Difficulty; cls?: ClassId; adapt?: number } = {}): Fixture {
  const storage = memStorage();
  const campaign = createCampaign(storage);
  const state = campaign.newQuickPlay(opts.difficulty ?? 'normal', opts.cls ?? 'captain', floor);
  if (opts.adapt !== undefined) state.adapt = opts.adapt;
  const world = campaign.startZone(state, zone) as World;
  return { campaign, storage, state, world };
}

/** Mundo de campaña (sí guarda). */
export function campaignWorld(floor: number, zone: number, opts: { difficulty?: Difficulty; cls?: ClassId } = {}): Fixture {
  const storage = memStorage();
  const campaign = createCampaign(storage);
  const state = campaign.newCampaign(opts.difficulty ?? 'normal', opts.cls ?? 'captain');
  state.floor = floor;
  const world = campaign.startZone(state, zone) as World;
  return { campaign, storage, state, world };
}

export function step(world: World, input: PlayerInput = emptyInput(), n = 1): void {
  for (let i = 0; i < n; i++) world.step(DT, input);
}

/** Avanza `seconds` segundos; `each` se llama tras cada paso (con los sucesos del paso en world.events). */
export function run(world: World, seconds: number, input: PlayerInput = emptyInput(), each?: (w: World) => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { world.step(DT, input); if (each) each(world); }
}

export function exec(world: World, line: string, host?: { gotoFloorZone(f: number | null, z: number | null): string }): string[] {
  const con = createConsole(host ?? { gotoFloorZone: () => 'ok' });
  return con.exec(line, world);
}

/**
 * Deja la zona sin enemigos y sin nadie por salir: mata a los vivos y deja correr el director hasta que
 * declara la zona limpia. Tras esto el director ya no suelta a nadie (status !== 'playing').
 */
export function clearZone(world: World, maxSeconds = 300): void {
  const inp = emptyInput();
  const t0 = world.time;
  while (world.status === 'playing' && world.time - t0 < maxSeconds) {
    for (const e of world.entities.slice()) if (e.alive && e.team === 'enemy') { e.shielded = false; world.kill(e); }
    world.step(DT, inp);
  }
}

/** Mata a los tres compañeros (para escenarios donde sólo importa el jugador). */
export function killAllies(world: World): void {
  for (const e of world.entities) if (e.team === 'ally' && !e.isPlayer && e.alive) world.kill(e);
}

/** Coloca una unidad en (x,y) comprobando que ahí se puede estar (si no, falla la prueba: el escenario está mal). */
export function place(world: World, u: Unit, x: number, y: number, yaw?: number): Unit {
  if (!world.level.walkableAt(x, y, true)) throw new Error(`(${x},${y}) no es transitable en este mapa`);
  u.x = x; u.y = y; u.vx = u.vy = 0; u.wishX = u.wishY = 0;
  if (yaw !== undefined) u.yaw = yaw;
  return u;
}

export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number { return Math.hypot(a.x - b.x, a.y - b.y); }

/** Engancha una función que se ejecuta tras cada world.step (también el que hace el bot de tools/partida.ts). */
export function watchSteps(world: World, after: (w: World, before: { status: string }) => void): void {
  const orig = world.step.bind(world);
  world.step = (dt: number, input: PlayerInput) => {
    const before = { status: world.status };
    orig(dt, input);
    after(world, before);
  };
}

/** Busca un punto transitable a distancia `d` (±0,3) de (cx,cy), probando ángulos; null si no hay. */
export function pointAtDistance(world: World, cx: number, cy: number, d: number, avoid: { x: number; y: number }[] = []): [number, number] | null {
  for (let k = 0; k < 72; k++) {
    const a = (k * Math.PI * 2) / 72;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    if (!world.level.inside(x, y) || !world.level.walkableAt(x, y, false)) continue;
    if (avoid.some(o => Math.hypot(o.x - x, o.y - y) < 1.2)) continue;
    return [x, y];
  }
  return null;
}
