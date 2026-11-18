// Tablas de datos del juego. Los números vienen de DEFINICION-DEL-JUEGO.md.
// Lo que el documento no fija (cargadores, tiempos de recarga, alturas…) está marcado con «(nuestro)»
// y apuntado en DECISIONES.md.

import type { ClassId, EnemyKind, FurnitureType, ItemType, Kind, Theme } from './types';

export const WALL_HEIGHT = 3.0;
export const DOOR_HEIGHT = 2.1;
export const WALL_THICK = 0.33;
export const BODY_RADIUS = 0.4;
export const STAND_HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.0;   // (nuestro)
export const EYE_STAND = 1.6;
export const EYE_CROUCH = 0.9;
export const MUZZLE_STAND = 1.4;
export const MUZZLE_CROUCH = 0.85;
export const WEAPON_RANGE = 30;     // §13: 26-34 m
export const AURA_RADIUS = 8;       // §5
export const AMMO_START = 50;
export const AMMO_CAP = 999;
export const KNIFE_DAMAGE = 30;
export const KNIFE_PERIOD = 0.5;
export const KNIFE_RANGE = 1.0;     // desde el borde del cuerpo
export const GRENADE_DAMAGE = 50;
export const BLAST_RADIUS = 2;
export const GRENADE_COUNT = 3;     // por zona (nuestro)
export const GRENADE_COOLDOWN = 3;  // s (nuestro)
export const HEAD_MULT = 2.5;
export const LIMB_MULT = 0.7;
export const INVENTORY_SLOTS = 5;

export interface UnitStats {
  hp: number;
  speed: number;      // m/s
  rof: number;        // disparos/s
  damage: number;     // por bala (o en el centro de la explosión)
  explosive: boolean;
  magSize: number;    // (nuestro)
  reloadTime: number; // s (nuestro)
  points: number;     // puntos que da al morir
  radius: number;
  height: number;
}

export const CLASS_STATS: Record<ClassId, UnitStats> = {
  captain:     { hp: 160, speed: 5.3, rof: 10,   damage: 10, explosive: false, magSize: 30, reloadTime: 1.6, points: 0, radius: BODY_RADIUS, height: STAND_HEIGHT },
  technic:     { hp: 85,  speed: 6.7, rof: 12.5, damage: 7,  explosive: false, magSize: 25, reloadTime: 1.2, points: 0, radius: BODY_RADIUS, height: STAND_HEIGHT },
  especialist: { hp: 125, speed: 5.3, rof: 5,    damage: 5,  explosive: false, magSize: 50, reloadTime: 2.2, points: 0, radius: BODY_RADIUS, height: STAND_HEIGHT },
  explosives:  { hp: 110, speed: 6.0, rof: 2,    damage: 60, explosive: true,  magSize: 4,  reloadTime: 2.0, points: 0, radius: BODY_RADIUS, height: STAND_HEIGHT },
};

export const ENEMY_STATS: Record<EnemyKind, UnitStats> = {
  enemy1:   { hp: 45,  speed: 2.0, rof: 2,    damage: 1,  explosive: false, magSize: 10, reloadTime: 1.8, points: 3,   radius: BODY_RADIUS, height: STAND_HEIGHT },
  enemy2:   { hp: 50,  speed: 1.9, rof: 1.25, damage: 3,  explosive: false, magSize: 10, reloadTime: 2.0, points: 5,   radius: BODY_RADIUS, height: STAND_HEIGHT },
  enemy3:   { hp: 65,  speed: 1.7, rof: 1.66, damage: 2,  explosive: false, magSize: 12, reloadTime: 2.0, points: 7,   radius: BODY_RADIUS, height: STAND_HEIGHT },
  miniboss: { hp: 200, speed: 1.1, rof: 2,    damage: 30, explosive: true,  magSize: 4,  reloadTime: 2.5, points: 50,  radius: 0.55, height: 2.2 },
  megaboss: { hp: 500, speed: 0.8, rof: 5,    damage: 10, explosive: false, magSize: 40, reloadTime: 2.0, points: 500, radius: 0.65, height: 2.6 },
};

export const ENEMY_AMMO = 50; // §7: después recargan… y al agotarla se lanzan al cuerpo a cuerpo

export function isClass(k: Kind): k is ClassId {
  return k === 'captain' || k === 'technic' || k === 'especialist' || k === 'explosives';
}
export function statsOf(k: Kind): UnitStats {
  return isClass(k) ? CLASS_STATS[k] : ENEMY_STATS[k as EnemyKind];
}

/** Umbrales con los que los compañeros usan su inventario (§5.2). */
export const ALLY_ITEM_THRESHOLDS: Record<ClassId, { hp: number; ammo: number }> = {
  captain: { hp: 30, ammo: 5 },
  technic: { hp: 10, ammo: 1 },
  especialist: { hp: 15, ammo: 10 },
  explosives: { hp: 50, ammo: 1 },
};

/** Formación en V (§6): [derecha(+)/izquierda(-), detrás] en metros respecto a la espalda del jugador. */
export const FORMATION_SLOTS = { left: [-1.6, 0.8], right: [1.6, 0.8], center: [0, 1.6] } as const;
export const FORMATION_BY_CONTROLLED: Record<ClassId, { left: ClassId; right: ClassId; center: ClassId }> = {
  captain:     { left: 'explosives', right: 'technic',     center: 'especialist' },
  technic:     { left: 'explosives', right: 'especialist', center: 'captain' },
  especialist: { left: 'explosives', right: 'technic',     center: 'captain' },
  explosives:  { left: 'captain',    right: 'technic',     center: 'especialist' },
};

export interface FurnitureSpec {
  /** tamaño en x y en y con ángulo 0 */
  w: number; d: number;
  /** altura del modelo */
  height: number;
  /** altura hasta la que para balas (0 = no para ninguna) */
  bulletH: number;
  /** altura hasta la que tapa la vista (0 = no tapa) */
  sightH: number;
  cover: 'none' | 'low' | 'high';
}

export const FURNITURE: Record<FurnitureType, FurnitureSpec> = {
  mesa:            { w: 0.56, d: 1.20, height: 0.78, bulletH: 0.78, sightH: 0.78, cover: 'low' },
  escritorio:      { w: 1.73, d: 1.47, height: 1.05, bulletH: 1.05, sightH: 1.05, cover: 'low' },
  mesa_con_sillas: { w: 1.33, d: 1.33, height: 0.90, bulletH: 0.90, sightH: 0.90, cover: 'low' },
  estanteria:      { w: 1.33, d: 0.57, height: 2.10, bulletH: 2.10, sightH: 2.10, cover: 'high' },
  sofa:            { w: 0.59, d: 1.60, height: 0.90, bulletH: 0.90, sightH: 0.90, cover: 'low' },
  butaca:          { w: 0.59, d: 0.53, height: 0.85, bulletH: 0.70, sightH: 0.85, cover: 'low' },
  silla:           { w: 0.53, d: 0.53, height: 0.90, bulletH: 0,    sightH: 0,    cover: 'none' },
  // La maceta no para balas pero sí rompe la línea de visión (§11.1).
  maceta:          { w: 0.27, d: 0.27, height: 1.60, bulletH: 0,    sightH: 1.60, cover: 'none' },
};

export const ITEM_EFFECT: Record<ItemType, { hp: number; ammo: number }> = {
  vida_20: { hp: 20, ammo: 0 }, vida_50: { hp: 50, ammo: 0 }, vida_100: { hp: 100, ammo: 0 },
  municion_20: { hp: 0, ammo: 20 }, municion_50: { hp: 0, ammo: 50 }, municion_100: { hp: 0, ammo: 100 },
};
export const ITEM_TYPES: ItemType[] = ['vida_20', 'vida_50', 'vida_100', 'municion_20', 'municion_50', 'municion_100'];

/** Recompensa por zona (§12). */
export const ZONE_REWARD: ItemType[] = ['municion_20', 'vida_20', 'municion_50', 'vida_50', 'municion_100', 'vida_100'];
export const ZONE_SIZE: ('pequeno' | 'mediano' | 'grande')[] = ['pequeno', 'pequeno', 'mediano', 'mediano', 'grande', 'grande'];

/** Enemigos por planta y tamaño de mapa, dificultad Normal (§8). Las bajadas de las plantas 5 y 7 están suavizadas (ver DECISIONES.md). */
export const ENEMY_COUNT: Record<number, [number, number, number]> = {
  1: [9, 19, 31],
  2: [21, 26, 37],
  3: [26, 34, 38],
  4: [34, 44, 46],
  5: [34, 47, 47],
  6: [36, 48, 48],
  7: [38, 48, 49],
  8: [49, 49, 49],
};

/** Mezcla [Sicario, Miliciano, Veterano] por planta (§8). */
export const ENEMY_MIX: Record<number, [number, number, number]> = {
  1: [0.80, 0.20, 0],
  2: [0.65, 0.30, 0.05],
  3: [0.50, 0.40, 0.10],
  4: [0.40, 0.40, 0.20],
  5: [0.30, 0.35, 0.35],
  6: [0.30, 0.40, 0.30],
  7: [0.25, 0.35, 0.40],
  8: [0.20, 0.35, 0.45],
  9: [0.25, 0.35, 0.40],
};

export const DIFFICULTY_MULT = { easy: 1.0, normal: 1.3, hard: 1.5 } as const;

export const FLOOR_THEME: Record<number, Theme> = {
  1: 'recepcion', 2: 'soporte', 3: 'desarrollo', 4: 'calidad', 5: 'datos',
  6: 'comercial', 7: 'direccion', 8: 'juntas', 9: 'azotea',
};

/** Percepción enemiga (§14). */
export const VISION = {
  primaryHalfAngle: (35 * Math.PI) / 180, primaryRange: 20,
  peripheralHalfAngle: (70 * Math.PI) / 180, peripheralRange: 10,
};
/** Retardo con el que cada tipo recibe el aviso de un compañero (§14: 0,3-0,8 s). */
export const ALERT_DELAY: Record<EnemyKind, number> = { enemy1: 0.8, enemy2: 0.55, enemy3: 0.3, miniboss: 0.5, megaboss: 0.3 };
