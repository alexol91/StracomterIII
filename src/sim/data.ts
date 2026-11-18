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
  miniboss: { hp: 200, speed: 1.1, rof: 2,    damage: 30, explosive: true,  magSize: 2,  reloadTime: 2.6, points: 50,  radius: 0.55, height: 2.2 },
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
  // sightH por encima de los ojos (1,6 m): si no, el rayo ojo→cabeza pasaba rozando por arriba y no tapaba nunca.
  maceta:          { w: 0.27, d: 0.27, height: 1.60, bulletH: 0,    sightH: 2.20, cover: 'none' },
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

// ───────────────────────── v1.2: tacto del arma ─────────────────────────

/** Dispersión dinámica y retroceso del jugador (radianes). Ver World.updatePlayer. Valores calibrados con el bot (ver DECISIONES.md). */
export interface GunFeel {
  baseSpread: number; perShot: number; maxSpread: number; recover: number; moveSpread: number; kickPitch: number; kickYaw: number;
}
export const GUN_FEEL: Record<ClassId, GunFeel> = {
  captain:     { baseSpread: 0.006, perShot: 0.0035, maxSpread: 0.045, recover: 0.09, moveSpread: 0.012, kickPitch: 0.006,  kickYaw: 0.003 },
  technic:     { baseSpread: 0.008, perShot: 0.0030, maxSpread: 0.050, recover: 0.10, moveSpread: 0.008, kickPitch: 0.004,  kickYaw: 0.0035 },
  especialist: { baseSpread: 0.012, perShot: 0.0020, maxSpread: 0.060, recover: 0.07, moveSpread: 0.014, kickPitch: 0.0035, kickYaw: 0.004 },
  explosives:  { baseSpread: 0.004, perShot: 0,      maxSpread: 0.004, recover: 0.2,  moveSpread: 0.010, kickPitch: 0.035,  kickYaw: 0.010 },
};

export const SPRINT_MULT = 1.45;
export const AIM_SPEED_MULT = 0.55;
export const SPRINT_RAISE = 0.35;      // s de «levantar el arma» tras esprintar
export const FOV_NORMAL = 60;
export const FOV_AIM = 42;
export const CAM_DIST_AIM = 2.0;
export const SHOULDER_NORMAL = 0.55;
export const SHOULDER_AIM = 0.62;
export const RECOIL_MAX_PITCH = 0.12;
export const RECOIL_MAX_YAW = 0.05;
export const RECOIL_RECOVER = 9;       // 1/s, recuperación exponencial
export const STAGGER_TIME = 0.35;
export const STAGGER_COOLDOWN = 1.2;

// ───────────────────────── v1.2: mejoras de campaña ─────────────────────────

/** Efectos acumulados de las mejoras elegidas. Los calcula `computeMods`; el mundo los lee. Valores neutros = sin mejoras. */
export interface Mods {
  magMult: number; reloadMult: number; extraGrenades: number; auraBonus: number; abilityCdMult: number;
  pierce: boolean; hpBonus: number; speedMult: number; headBonus: number; recoilMult: number;
  knifeMult: number; knifeRange: number; blastBonus: number; lootMult: number; damageTaken: number;
  ammoAura: number; medicAura: number; quietSprint: boolean; firstBullet: boolean; lastBreath: boolean; dropBonus: number;
}
export function neutralMods(): Mods {
  return {
    magMult: 1, reloadMult: 1, extraGrenades: 0, auraBonus: 0, abilityCdMult: 1, pierce: false, hpBonus: 0, speedMult: 1,
    headBonus: 0, recoilMult: 1, knifeMult: 1, knifeRange: 0, blastBonus: 0, lootMult: 1, damageTaken: 1, ammoAura: 0,
    medicAura: 0, quietSprint: false, firstBullet: false, lastBreath: false, dropBonus: 0,
  };
}

export interface UpgradeDef {
  id: string;
  es: { name: string; desc: string };
  en: { name: string; desc: string };
  icon: 'mag' | 'reload' | 'grenade' | 'aura' | 'ability' | 'pierce' | 'hp' | 'speed' | 'head' | 'recoil' | 'knife' | 'blast' | 'loot' | 'armor' | 'ammo' | 'medic' | 'ghost' | 'focus' | 'second' | 'scav';
  /** modifica el objeto de efectos (se aplica una vez por mejora elegida) */
  apply(m: Mods): void;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'mag+', icon: 'mag', es: { name: 'Cargadores ampliados', desc: 'Cargador ×1,3 para toda la escuadra.' }, en: { name: 'Extended mags', desc: 'Magazine size ×1.3 for the whole squad.' }, apply: m => { m.magMult *= 1.3; } },
  { id: 'recarga-rapida', icon: 'reload', es: { name: 'Recarga rápida', desc: 'El tiempo de recarga baja un 25 %.' }, en: { name: 'Fast reload', desc: 'Reload time reduced by 25%.' }, apply: m => { m.reloadMult *= 0.75; } },
  { id: 'granada-extra', icon: 'grenade', es: { name: 'Granada extra', desc: '+1 granada por zona.' }, en: { name: 'Extra grenade', desc: '+1 grenade per zone.' }, apply: m => { m.extraGrenades += 1; } },
  { id: 'aura-amplia', icon: 'aura', es: { name: 'Aura amplia', desc: 'El radio de las auras aumenta 3 m.' }, en: { name: 'Wide aura', desc: 'Aura radius +3 m.' }, apply: m => { m.auraBonus += 3; } },
  { id: 'habilidad-agil', icon: 'ability', es: { name: 'Habilidad ágil', desc: 'Las habilidades se recargan un 25 % antes.' }, en: { name: 'Quick ability', desc: 'Abilities recharge 25% faster.' }, apply: m => { m.abilityCdMult *= 0.75; } },
  { id: 'perforante', icon: 'pierce', es: { name: 'Munición perforante', desc: 'Tus balas atraviesan a un enemigo y siguen.' }, en: { name: 'Piercing rounds', desc: 'Your bullets pass through one enemy.' }, apply: m => { m.pierce = true; } },
  { id: 'vigor', icon: 'hp', es: { name: 'Vigor', desc: '+20 de vida máxima y curas 20 al cogerla.' }, en: { name: 'Vigor', desc: '+20 max health and heal 20 on pickup.' }, apply: m => { m.hpBonus += 20; } },
  { id: 'piernas', icon: 'speed', es: { name: 'Piernas', desc: 'Velocidad de movimiento +6 %.' }, en: { name: 'Fast legs', desc: 'Movement speed +6%.' }, apply: m => { m.speedMult *= 1.06; } },
  { id: 'tirador', icon: 'head', es: { name: 'Tirador', desc: 'El multiplicador de cabeza sube 0,5.' }, en: { name: 'Marksman', desc: 'Headshot multiplier +0.5.' }, apply: m => { m.headBonus += 0.5; } },
  { id: 'pulso', icon: 'recoil', es: { name: 'Pulso firme', desc: 'Retroceso y calor del arma ×0,7.' }, en: { name: 'Steady hands', desc: 'Weapon recoil and heat ×0.7.' }, apply: m => { m.recoilMult *= 0.7; } },
  { id: 'filo', icon: 'knife', es: { name: 'Filo', desc: 'Cuchillo: el doble de daño y +0,3 m de alcance.' }, en: { name: 'Sharp edge', desc: 'Knife: double damage and +0.3 m reach.' }, apply: m => { m.knifeMult *= 2; m.knifeRange += 0.3; } },
  { id: 'onda', icon: 'blast', es: { name: 'Onda expansiva', desc: 'Radio de tus granadas y explosivos +0,6 m.' }, en: { name: 'Shockwave', desc: 'Your grenade and explosive radius +0.6 m.' }, apply: m => { m.blastBonus += 0.6; } },
  { id: 'carroñero', icon: 'loot', es: { name: 'Carroñero', desc: 'Botiquines y cajas dan un 50 % más.' }, en: { name: 'Scavenger', desc: 'Medkits and ammo crates give 50% more.' }, apply: m => { m.lootMult *= 1.5; } },
  { id: 'chaleco', icon: 'armor', es: { name: 'Chaleco', desc: 'Daño recibido −12 %.' }, en: { name: 'Vest', desc: 'Damage taken −12%.' }, apply: m => { m.damageTaken *= 0.88; } },
  { id: 'intendencia', icon: 'ammo', es: { name: 'Intendencia', desc: 'El aura de munición da +5 balas por tic.' }, en: { name: 'Quartermaster', desc: 'Ammo aura gives +5 rounds per tick.' }, apply: m => { m.ammoAura += 5; } },
  { id: 'sanitario', icon: 'medic', es: { name: 'Sanitario', desc: 'El aura del Capitán cura +1 extra por tic.' }, en: { name: 'Medic', desc: 'Captain aura heals +1 extra per tick.' }, apply: m => { m.medicAura += 1; } },
  { id: 'sigilo', icon: 'ghost', es: { name: 'Sigilo', desc: 'Esprintar no hace más ruido que andar.' }, en: { name: 'Stealth', desc: 'Sprinting is no louder than walking.' }, apply: m => { m.quietSprint = true; } },
  { id: 'primera-bala', icon: 'focus', es: { name: 'Primera bala', desc: 'El primer disparo tras 1 s sin disparar no se desvía.' }, en: { name: 'First shot', desc: 'The first shot after 1 s of rest has no spread.' }, apply: m => { m.firstBullet = true; } },
  { id: 'ultimo-aliento', icon: 'second', es: { name: 'Último aliento', desc: 'Una vez por zona, un golpe mortal te deja a 1 de vida y 1,5 s invulnerable.' }, en: { name: 'Last breath', desc: 'Once per zone, a lethal hit leaves you at 1 HP and 1.5 s invulnerable.' }, apply: m => { m.lastBreath = true; } },
  { id: 'botin', icon: 'scav', es: { name: 'Botín', desc: 'Los enemigos sueltan objetos un 10 % más de veces.' }, en: { name: 'Loot', desc: 'Enemies drop items 10% more often.' }, apply: m => { m.dropBonus += 0.1; } },
];

export function computeMods(ids: readonly string[] | undefined): Mods {
  const m = neutralMods();
  const seen = new Set<string>();
  for (const id of ids ?? []) {
    if (seen.has(id)) continue; // una mejora no se acumula dos veces
    seen.add(id);
    UPGRADES.find(u => u.id === id)?.apply(m);
  }
  return m;
}

/** Vida máxima de una clase con las mejoras elegidas. */
export function maxHpFor(c: ClassId, upgrades: readonly string[] | undefined): number {
  return CLASS_STATS[c].hp + computeMods(upgrades).hpBonus;
}

// ───────────────────────── v1.2: ranuras de arma (pistola secundaria) ─────────────────────────

export const PISTOL = { damage: 14, rof: 5, magSize: 12, reloadTime: 1.3 };
export const PISTOL_FEEL: GunFeel = { baseSpread: 0.007, perShot: 0.006, maxSpread: 0.05, recover: 0.12, moveSpread: 0.008, kickPitch: 0.009, kickYaw: 0.004 };
/** tiempo de sacar cada arma al cambiar (s) */
export const DRAW_TIME = { primary: 0.45, secondary: 0.30, knife: 0.25, grenade: 0.30 } as const;
/** velocidad de movimiento según el arma en la mano (como en CS: con el cuchillo se corre más) */
export const WEAPON_SPEED = { primary: 1, secondary: 1.05, knife: 1.12, grenade: 1 } as const;
