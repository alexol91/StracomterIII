// Catálogo de mapas: la planta 1 son los tres mapas reales de muestra; el resto los produce el generador.

import muestra from '../maps/muestra.json';
import { FLOOR_THEME } from './data';
import { generateMap } from './mapgen';
import type { MapDef } from './types';

export type MapSize = 'pequeno' | 'mediano' | 'grande';
const cache = new Map<string, MapDef>();

export function getMap(floor: number, size: MapSize): MapDef {
  const key = floor + ':' + size;
  let m = cache.get(key);
  if (!m) {
    if (floor === 1) {
      m = JSON.parse(JSON.stringify((muestra as unknown as Record<MapSize, MapDef>)[size])) as MapDef;
      m.tema = FLOOR_THEME[1];
      m.diafano = false;
    } else {
      m = generateMap(floor, floor === 9 ? 'grande' : size);
    }
    cache.set(key, m);
  }
  // copia: el mundo puede modificar el mapa (boquetes) y no debe ensuciar el catálogo
  return JSON.parse(JSON.stringify(m)) as MapDef;
}
