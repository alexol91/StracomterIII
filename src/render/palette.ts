// Paleta y temas de planta.

import type { Theme } from '../sim/types';

export type FloorPattern = 'tiles' | 'carpet' | 'wood' | 'concrete' | 'grid';

export interface ThemeDef {
  bg: number;
  floorA: number; floorB: number; pattern: FloorPattern;
  /** metros que cubre una repetición de la textura */
  tileM: number;
  wall: number; cap: number; facade: number;
  door: number;
  hemiSky: number; hemiGround: number; hemiI: number;
  dirColor: number; dirI: number;
  /** colores de mobiliario */
  wood: number; fabric: number; metal: number; accent: number;
}

export const THEMES: Record<Theme, ThemeDef> = {
  recepcion: {
    bg: 0xaeb9c9, floorA: 0xf0ece3, floorB: 0xd9d3c8, pattern: 'tiles', tileM: 4,
    wall: 0xc4cbd6, cap: 0x2b3340, facade: 0x9fb0c8, door: 0x1d3a6b,
    hemiSky: 0xffffff, hemiGround: 0x9aa0ab, hemiI: 2.0, dirColor: 0xffffff, dirI: 2.5,
    wood: 0x9b6b3f, fabric: 0x3f6db3, metal: 0x8d96a3, accent: 0xd9a21b,
  },
  soporte: {
    bg: 0xa9b6c6, floorA: 0x8f9bab, floorB: 0x859199, pattern: 'carpet', tileM: 4,
    wall: 0xb4c2d6, cap: 0x26303f, facade: 0x8ea2bd, door: 0x1d3a6b,
    hemiSky: 0xffffff, hemiGround: 0x8e97a5, hemiI: 2.0, dirColor: 0xfff8ee, dirI: 2.5,
    wood: 0xa57445, fabric: 0x4a7fc0, metal: 0x8a94a1, accent: 0x38b6c9,
  },
  desarrollo: {
    bg: 0x9aa8bb, floorA: 0x67768c, floorB: 0x5d6b80, pattern: 'carpet', tileM: 4,
    wall: 0xa7b5ca, cap: 0x222b3a, facade: 0x7d92b0, door: 0x1a3462,
    hemiSky: 0xf2f6ff, hemiGround: 0x7d879a, hemiI: 2.0, dirColor: 0xffffff, dirI: 2.5,
    wood: 0x8a5e38, fabric: 0x2f9a8a, metal: 0x7f8998, accent: 0x66d17a,
  },
  calidad: {
    bg: 0xa8b8ae, floorA: 0xb4c4b6, floorB: 0xa3b5a6, pattern: 'tiles', tileM: 2,
    wall: 0xd0d9d0, cap: 0x2a3a30, facade: 0x8fae9d, door: 0x1d3a6b,
    hemiSky: 0xffffff, hemiGround: 0x93a198, hemiI: 2.0, dirColor: 0xf6fff6, dirI: 2.5,
    wood: 0xa9794a, fabric: 0x3c78b5, metal: 0x909aa0, accent: 0xe0b341,
  },
  datos: {
    bg: 0x060a14, floorA: 0x1f2a3d, floorB: 0x1a2435, pattern: 'grid', tileM: 4,
    wall: 0x34445f, cap: 0x0a0f1a, facade: 0x2a3a58, door: 0x16305c,
    hemiSky: 0x7f9dff, hemiGround: 0x1a2236, hemiI: 1.9, dirColor: 0x8fb0ff, dirI: 1.6,
    wood: 0x4a3a2c, fabric: 0x2c4b80, metal: 0x4b586d, accent: 0x35d0ff,
  },
  comercial: {
    bg: 0xc9d3de, floorA: 0xcfc1aa, floorB: 0xc4b59d, pattern: 'carpet', tileM: 4,
    wall: 0xe8e3da, cap: 0x3a3a44, facade: 0xb2bfd0, door: 0x24467c,
    hemiSky: 0xffffff, hemiGround: 0xaaa397, hemiI: 2.1, dirColor: 0xfffaf0, dirI: 2.5,
    wood: 0xb07c48, fabric: 0xd06a3a, metal: 0x9aa2ad, accent: 0x3f8f6a,
  },
  direccion: {
    bg: 0xb9aa96, floorA: 0x835a35, floorB: 0x734e2d, pattern: 'wood', tileM: 4,
    wall: 0xddd0ba, cap: 0x2f2014, facade: 0xb39b7a, door: 0x1d3a6b,
    hemiSky: 0xfff3e0, hemiGround: 0x8a7761, hemiI: 2.05, dirColor: 0xffe9c8, dirI: 2.4,
    wood: 0x5a3a20, fabric: 0x7a2e2e, metal: 0xb09a56, accent: 0xc9a227,
  },
  juntas: {
    bg: 0xa3adbd, floorA: 0x8a6240, floorB: 0x7a5535, pattern: 'wood', tileM: 4,
    wall: 0xd0d7e2, cap: 0x242c3a, facade: 0x8497b3, door: 0x1d3a6b,
    hemiSky: 0xffffff, hemiGround: 0x7c8596, hemiI: 2.05, dirColor: 0xffffff, dirI: 2.5,
    wood: 0x6b4a2b, fabric: 0x2e4e8a, metal: 0x8a93a2, accent: 0xd9a21b,
  },
  azotea: {
    bg: 0x050914, floorA: 0x555a63, floorB: 0x484d56, pattern: 'concrete', tileM: 6,
    wall: 0x59606c, cap: 0x15181e, facade: 0x4b525e, door: 0x16305c,
    hemiSky: 0x6f86c0, hemiGround: 0x22283a, hemiI: 1.9, dirColor: 0x9db4ff, dirI: 1.7,
    wood: 0x4a3a2c, fabric: 0x2c4b80, metal: 0x7d8695, accent: 0x35d0ff,
  },
};

// ───────────────────────── Unidades ─────────────────────────

export interface UnitPalette {
  main: number;   // color principal del cuerpo
  dark: number;   // sombras, botas, armas
  light: number;  // hombreras, detalles claros
  trim: number;   // detalles de color de contraste
  skin: number;
}

const SKIN = 0xe2b690;

/** Paleta de cada tipo. Con `cb` (daltonismo): hostiles amarillo/magenta, aliados azul oscuro. */
export function unitPalette(kind: string, cb: boolean): UnitPalette {
  if (!cb) {
    switch (kind) {
      case 'captain': return { main: 0x1f3a6e, dark: 0x0f1c3a, light: 0x6a9ae8, trim: 0xd8c27a, skin: SKIN };
      case 'technic': return { main: 0x2ec4d6, dark: 0x16525c, light: 0xaaf4ff, trim: 0xffe14a, skin: SKIN };
      case 'especialist': return { main: 0x1f8a7a, dark: 0x0e3f38, light: 0x6ad8c4, trim: 0xe0c050, skin: SKIN };
      case 'explosives': return { main: 0x2b4a9a, dark: 0x16224a, light: 0x7a9ae0, trim: 0xf2c200, skin: SKIN };
      case 'enemy1': return { main: 0xffa24a, dark: 0x6a3a14, light: 0xffd49a, trim: 0xfff0c0, skin: SKIN };
      case 'enemy2': return { main: 0xe8591f, dark: 0x4a2412, light: 0xf59a6a, trim: 0x3a3320, skin: SKIN };
      case 'enemy3': return { main: 0x8a1c1c, dark: 0x2e0c0c, light: 0xc84a3a, trim: 0x55302a, skin: SKIN };
      case 'miniboss': return { main: 0xd8451a, dark: 0x2a2220, light: 0xff8a4a, trim: 0x4a4a52, skin: SKIN };
      default: return { main: 0x7a0f1a, dark: 0x1a1014, light: 0xc02a3a, trim: 0xffc400, skin: 0xcfa07c };
    }
  }
  switch (kind) {
    case 'captain': case 'technic': case 'especialist': case 'explosives':
      return { main: 0x1a2b8c, dark: 0x0a1040, light: 0x5b78ff, trim: 0xffffff, skin: SKIN };
    case 'enemy1': return { main: 0xffe100, dark: 0x4a4200, light: 0xfff6a0, trim: 0x222222, skin: SKIN };
    case 'enemy2': return { main: 0xe020c8, dark: 0x40083a, light: 0xff8af0, trim: 0xffe100, skin: SKIN };
    case 'enemy3': return { main: 0xa010a0, dark: 0x2c0630, light: 0xe060e0, trim: 0xffe100, skin: SKIN };
    case 'miniboss': return { main: 0xffd400, dark: 0x2a2400, light: 0xfff088, trim: 0xe020c8, skin: SKIN };
    default: return { main: 0xd000b0, dark: 0x20041c, light: 0xff6af0, trim: 0xffee00, skin: SKIN };
  }
}
