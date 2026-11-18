// Catálogo de mapas: la planta 1 son los tres mapas reales de muestra; el resto los produce el generador.

import muestra from '../maps/muestra.json';
import { FLOOR_THEME } from './data';
import { generateMap } from './mapgen';
import type { MapDef } from './types';

export type MapSize = 'pequeno' | 'mediano' | 'grande';
const cache = new Map<string, MapDef>();

/**
 * V2: los mapas reales de la planta 1 se amplían en planta (decisión del dueño: se sentían pequeños para una
 * cámara en tercera persona y una escuadra de cuatro). Se escalan las POSICIONES; los muebles y el grosor
 * de los muros conservan su tamaño real. La distribución sigue siendo la del original.
 */
export const SAMPLE_MAP_SCALE = 1.6;

function scaleRect(r: [number, number][], k: number, grow: number): [number, number][] {
  const xs = r.map(p => p[0]), ys = r.map(p => p[1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const horiz = x1 - x0 >= y1 - y0;
  if (horiz) {
    const c = ((y0 + y1) / 2) * k, t = (y1 - y0) / 2;
    x0 = x0 * k - grow; x1 = x1 * k + grow; y0 = c - t; y1 = c + t;
  } else {
    const c = ((x0 + x1) / 2) * k, t = (x1 - x0) / 2;
    y0 = y0 * k - grow; y1 = y1 * k + grow; x0 = c - t; x1 = c + t;
  }
  return [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];
}

export function scaleMap(m: MapDef, k: number): MapDef {
  // los muros se alargan un poco por cada extremo para que las esquinas sigan cerrando sin rendijas
  const grow = (k - 1) * 0.2;
  return {
    ...m,
    ancho_m: +(m.ancho_m * k).toFixed(2), alto_m: +(m.alto_m * k).toFixed(2),
    perimetro: m.perimetro.map(p => [p[0] * k, p[1] * k] as [number, number]),
    muros: m.muros.map(r => scaleRect(r, k, grow)),
    puertas: m.puertas.map(r => scaleRect(r, k, 0)),
    mobiliario: m.mobiliario.map(f => ({ ...f, pos: [f.pos[0] * k, f.pos[1] * k] as [number, number] })),
    objetos: m.objetos.map(o => ({ ...o, pos: [o.pos[0] * k, o.pos[1] * k] as [number, number] })),
    inicio_jugador: [m.inicio_jugador[0] * k, m.inicio_jugador[1] * k],
    punto_jefe: [m.punto_jefe[0] * k, m.punto_jefe[1] * k],
  };
}

export function getMap(floor: number, size: MapSize): MapDef {
  const key = floor + ':' + size;
  let m = cache.get(key);
  if (!m) {
    if (floor === 1) {
      m = scaleMap(JSON.parse(JSON.stringify((muestra as unknown as Record<MapSize, MapDef>)[size])) as MapDef, SAMPLE_MAP_SCALE);
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
