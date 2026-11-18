// Utilidades de las pruebas de la v1.2. No es un fichero de pruebas (no acaba en .test.ts).
//
// QUÉ NO CUBRE: igual que helpers.ts, todo es la simulación real sin dibujo, audio ni controles. Los escenarios se
// montan con el director congelado (calmar) y los compañeros muertos salvo que se pida lo contrario, así que no
// prueban la interacción de las mecánicas nuevas con el ritmo de oleadas ni con la IA aliada.

import type { CampaignState, Difficulty } from '../src/contracts';
import { createCampaign } from '../src/sim/campaign';
import { emptyInput, type ClassId, type PlayerInput } from '../src/sim/types';
import type { Unit, World } from '../src/sim/world';
import { calmar, killAllies, memStorage, place, puntoLibre } from './helpers';

export interface Mundo { world: World; p: Unit; state: CampaignState; campaign: ReturnType<typeof createCampaign>; storage: ReturnType<typeof memStorage>; x: number; y: number }

/** Mundo quieto de planta 1 zona 1: director congelado, jugador en un claro de ≥3,5 m, sin compañeros (salvo `aliados`). */
export function mundo(opts: { upgrades?: string[]; cls?: ClassId; aliados?: boolean; difficulty?: Difficulty } = {}): Mundo {
  const storage = memStorage();
  const campaign = createCampaign(storage);
  const state = campaign.newQuickPlay(opts.difficulty ?? 'normal', opts.cls ?? 'captain', 1);
  state.upgrades = (opts.upgrades ?? []).slice();
  const world = campaign.startZone(state, 1) as World;
  calmar(world);
  if (!opts.aliados) killAllies(world);
  const [x, y] = puntoLibre(world, 3.5, 0);
  const p = place(world, world.player, x, y, 0);
  world.events.length = 0; // los sucesos de matar a los compañeros no interesan
  return { world, p, state, campaign, storage, x, y };
}

/** Entrada con el yaw/pitch dados (la cámara mira hacia +x). */
export function entrada(over: Partial<PlayerInput> = {}): PlayerInput {
  return { ...emptyInput(), yaw: 0, pitch: 0, ...over };
}

/** Un enemigo quieto en (x,y) (el director está congelado); se le quita la IA de la ecuación dejándolo sin ver al jugador. */
export function enemigo(world: World, kind: 'enemy1' | 'enemy2' | 'enemy3' | 'miniboss' | 'megaboss', x: number, y: number): Unit {
  const u = world.spawnUnit(kind, x, y, false);
  if (world.level.walkableAt(x, y, true)) place(world, u, x, y);
  else { const c = world.level.nearestFree(x, y, true, 6); place(world, u, world.level.cellX(c), world.level.cellY(c)); }
  return u;
}
