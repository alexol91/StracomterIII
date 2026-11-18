// Tablas de datos del juego. Los números vienen de DEFINICION-DEL-JUEGO.md.
// Lo que el documento no fija (cargadores, tiempos de recarga, alturas…) está marcado con «(nuestro)»
// y apuntado en DECISIONES.md.

import type { BossVariant, ClassId, EnemyKind, EnemyVariant, FurnitureType, ItemType, Kind, Theme } from './types';

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

// ───────────────────────── v1.3 (jugador y escuadra): voltereta, granadas tácticas, variantes de arma, derribo ─────────────────────────

export const ROLL = { time: 0.5, dist: 3.5, cooldown: 1.5, halfBlast: 0.25 };
export const FLASH = { fuse: 1.0, radius: 9, enemyBlind: 3, allyBlind: 2, spreadMult: 4 };
export const SMOKE = { radius: 3.2, duration: 8 };
export const TACTICAL_START = { flash: 2, smoke: 1 };
export const DOWNED = { time: 25, reviveRange: 1.6, reviveTime: 3, reviveHp: 0.3 };
export const BARK_COOLDOWN = 3;
export const PING_DOOR_RANGE = 20;

/** Ráfaga del fusil del Capitán (variante 1): 3 balas a 12/s. La pausa se calcula para que el DPS sostenido quede dentro del ±10 % de la variante 0 con +20 % de daño por bala. */
export const BURST_RIFLE = { bullets: 3, rate: 12, damageMult: 1.2, pause: 0.23 };
/** Escopeta del Técnico (variante 1): 8 perdigones, cono 0,07 rad. Daño por perdigón tal que a 6 m (todos acertando) iguale el DPS de la variante 0 (7 × 12,5 = 87,5). */
export const SHOTGUN = { pellets: 8, cone: 0.07, rof: 1.1, magSize: 6, pelletDamage: 87.5 / (1.1 * 8) };
/** Fusil de tirador (Especialista 1): semiautomático; 5 × 5 = 25 de DPS → 25 / 1,6 por bala. */
export const SNIPER = { rof: 1.6, magSize: 8, damage: 25 / 1.6, hipSpreadMult: 2.0, aimSpreadMult: 0.35, kickMult: 4 };
/** Lanzador de rebote (Explosivo 1): granada con parábola que rebota una vez y estalla a 1,3 s. */
export const BOUNCER = { fuse: 1.3 };

export interface PrimaryVariant { nameKey: string; kickMult: number }
/** Variantes del arma principal por clase. Nombre i18n `weapon.<clase>.<0|1>`. */
export const PRIMARY_VARIANTS: Record<ClassId, [PrimaryVariant, PrimaryVariant]> = {
  captain:     [{ nameKey: 'weapon.captain.0', kickMult: 1 },     { nameKey: 'weapon.captain.1', kickMult: 1.3 }],
  technic:     [{ nameKey: 'weapon.technic.0', kickMult: 1 },     { nameKey: 'weapon.technic.1', kickMult: 4 }],
  especialist: [{ nameKey: 'weapon.especialist.0', kickMult: 1 }, { nameKey: 'weapon.especialist.1', kickMult: SNIPER.kickMult }],
  explosives:  [{ nameKey: 'weapon.explosives.0', kickMult: 1 },  { nameKey: 'weapon.explosives.1', kickMult: 0.6 }],
};

/** Estadísticas del arma principal según la variante (copia: la tabla CLASS_STATS no se toca). */
export function variantStats(cls: ClassId, v: 0 | 1, base: UnitStats): UnitStats {
  if (v !== 1) return base;
  switch (cls) {
    case 'captain': {
      // ritmo sostenido equivalente para la IA aliada (el jugador usa la ráfaga exacta)
      const cycle = (BURST_RIFLE.bullets - 1) / BURST_RIFLE.rate + BURST_RIFLE.pause;
      return { ...base, damage: base.damage * BURST_RIFLE.damageMult, rof: BURST_RIFLE.bullets / cycle };
    }
    case 'technic': return { ...base, damage: SHOTGUN.pelletDamage, rof: SHOTGUN.rof, magSize: SHOTGUN.magSize };
    case 'especialist': return { ...base, damage: SNIPER.damage, rof: SNIPER.rof, magSize: SNIPER.magSize };
    default: return base;
  }
}

// ───────────────────────── v1.3: oficios y jefes ─────────────────────────
// Los oficios SUSTITUYEN enemigos normales (ENEMY_COUNT no cambia). Números (nuestros) calibrados con el bot; ver DECISIONES.md.

/** Parte de los enemigos normales de la planta que lleva oficio. */
export const VARIANT_SHARE: Record<number, number> = { 1: 0, 2: 0.10, 3: 0.20, 4: 0.20, 5: 0.28, 6: 0.28, 7: 0.35, 8: 0.35, 9: 0.35 };
/** Planta a partir de la cual aparece cada oficio (el reparto es a partes iguales entre los desbloqueados, en este orden). */
export const VARIANT_UNLOCK: Record<EnemyVariant, number> = { asaltante: 2, granadero: 3, tirador: 4, blindado: 5 };
export const VARIANT_ORDER: EnemyVariant[] = ['asaltante', 'granadero', 'tirador', 'blindado'];
/** Máximo de cada oficio vivo a la vez; el resto espera turno en la cola del director. */
export const VARIANT_ALIVE_CAP: Record<EnemyVariant, number> = { asaltante: 4, granadero: 2, tirador: 1, blindado: 2 };
/** De qué tipo base sale cada oficio, por orden de preferencia. */
export const VARIANT_BASE: Record<EnemyVariant, EnemyKind[]> = {
  asaltante: ['enemy1', 'enemy2', 'enemy3'], granadero: ['enemy2', 'enemy3', 'enemy1'],
  tirador: ['enemy3', 'enemy2', 'enemy1'], blindado: ['enemy3', 'enemy2', 'enemy1'],
};

/**
 * Los ataques nuevos con aviso (láser, cuchillada del asaltante, embestida, barrido) están pensados para esquivarse.
 * Los compañeros con IA no esquivan (aún): contra ellos hacen esta fracción del daño. El jugador recibe el daño entero.
 * Si los compañeros aprenden a salirse de un aviso, súbase a 1.
 */
export const V13_ALLY_AI_DAMAGE = 0.4;
/** Asaltante: no dispara; corre (velocidad × speedMult, y × sprintMult mientras carga) por ruta de flanqueo y acuchilla. */
export const ASALTANTE = { hpMult: 0.7, speedMult: 1.35, sprintMult: 1.5, knifeDamage: 20, knifePeriod: 0.8, reach: 1.0, directDist: 6 };
/** Tirador: láser que sigue al blanco con retraso `lag` y una bala al punto apuntado al acabar `aimTime`. */
export const TIRADOR = {
  hpMult: 0.8, minDist: 14, maxDist: 24, maxRange: 25, aimTime: 1.4, aimTimeHard: 1.0, lag: 0.35, hitRadius: 0.45, damage: 30,
  losGrace: 0.3, cooldown: 3.5, shotsPerSpot: 2,
  /** entre dos disparos de tirador (de cualquiera) al MISMO blanco pasan al menos estos segundos */
  targetGap: 16,
};
/** Granadero: granada al blanco que no se mueve (o agachado tras cobertura). */
export const GRANADERO = {
  band: [8, 16] as [number, number], stillTime: 2.5, stillRadius: 2.5, cooldown: 7, friendRadius: 3.5, minDist: 6, maxDist: 17,
  /** separación mínima entre dos granadas enemigas cualesquiera (s) */
  squadGap: 3,
  /** tras tirársela a un compañero con IA (que no la esquiva) el enfriamiento se multiplica */
  allyCooldownMult: 3,
};
/** Blindado: escudo frontal (lo aplica World en el daño); giro limitado para que un flanqueo le gane la espalda. Al recargar baja el escudo. */
export const BLINDADO = { hpMult: 1.3, speedMult: 0.75, rofMult: 0.35, magMult: 0.34, reloadMult: 1.5, turnRate: Math.PI / 2, stopDist: 6 };

/** Jefe de cada planta (el MegaBoss de la 9 no cambia). */
export const FLOOR_BOSS: Record<number, BossVariant> = { 2: 'cohetes', 3: 'ametrallador', 4: 'embestida', 5: 'escoltas', 6: 'cohetes', 7: 'ametrallador', 8: 'embestida' };
/** Segunda vuelta (plantas 6-8): más vida y dos acompañantes de oficio que salen de la cuota normal. */
export const BOSS_LATE: { fromFloor: number; hpMult: number; companions: Record<number, EnemyVariant> } = {
  fromFloor: 6, hpMult: 1.15, companions: { 6: 'granadero', 7: 'asaltante', 8: 'blindado' },
};
/** Daño recibido mientras el jefe está expuesto (recargando o aturdido tras fallar la embestida). */
export const BOSS_EXPOSED_MULT = 1.5;
/** Ametrallador: aviso 'lane' → barrido (vacía el cargador: rof × sweep balas) → recarga expuesto. */
export const BOSS_GUNNER = { laneWidth: 1.6, laneLen: 26, telegraph: 1.2, sweep: 3, rof: 10, damage: 3, reload: 2.5, gap: 0.8, maxDist: 24 };
/** Embestida: aviso 'charge' → carrera recta; si no alcanza a nadie, aturdido y expuesto. */
export const BOSS_CHARGER = {
  laneWidth: 1.4, maxDist: 14, minDist: 3.5, telegraph: 1.0, speed: 9, damage: 45, push: 10, stun: 2.5, recover: 0.8, cooldown: 6,
  rof: 1, bulletDamage: 2,
};
/** Escoltas: dos enemy2 que curan al jefe mientras vivan y estén cerca; al morir los dos, se enfurece. */
export const BOSS_ESCORTED = { escorts: 2, healPerSec: 6, healRange: 6, enrageRof: 1.3, stayRadius: 5 };

// ───────────────────────── v1.3, oleada 2 (simulación): Armería, objetivos, modificadores y horda ─────────────────────────

/**
 * Armería. Calibración (nuestra): en Normal una planta media da ~350 puntos (puntos ganados = créditos), así que
 * un suministro cuesta ~medio ingreso de planta (~2 por planta) y la mejora extra ~dos plantas. Cada mejora extra ya
 * comprada encarece la siguiente ×1,5. Re-sortear las tres mejoras ofrecidas tras una planta cuesta un precio fijo.
 */
export const SHOP = {
  ammo: 150,        // +50 de munición a toda la escuadra viva
  medkit: 180,      // +50 de vida a un operador
  grenade: 120,     // +1 explosiva en la próxima zona
  flash: 100,       // +1 cegadora
  smoke: 100,       // +1 de humo
  upgrade: 700,     // mejora extra (×1,5 por cada compra previa)
  upgradeStep: 1.5,
  reroll: 150,
  maxBought: 3,     // máximo de cada granada comprada para la próxima zona
  ammoAmount: 50, medkitAmount: 50,
};

/** Objetivos de zona (nuestros): relojes y cifras. */
export const OBJECTIVE = {
  bonus: 1.5,                                     // multiplicador de los puntos de la zona
  defuseTime: { easy: 180, normal: 150, hard: 130 } as Record<'easy' | 'normal' | 'hard', number>,
  defuseExtraPer500m2: 20, defuseAreaBase: 800,   // +20 s por cada 500 m² por encima de 800
  defuseHold: 4, defuseRange: 1.5, defuseMinSep: 10,
  defendTime: 120, defendReach: 6, defendHp: 400, defendFireRange: 12, defendSpreadOver: 100, defendMinShare: 0.7,
  rescueHp: 80, rescueRange: 1.6, rescueSpeed: 4, rescueExtractRange: 3,
};

export interface MutatorDef { id: string; scoreMult: number }
/** Modificadores de campaña. Los multiplicadores se multiplican entre sí y se aplican a los puntos ganados. */
export const MUTATORS: MutatorDef[] = [
  { id: 'rapidos', scoreMult: 1.15 },        // enemigos +20 % de velocidad
  { id: 'sin-aura', scoreMult: 1.15 },      // sin aura de curación del Capitán
  { id: 'jefes-dobles', scoreMult: 1.3 },   // dos jefes de planta
  { id: 'solo-pistola', scoreMult: 1.4 },   // el jugador no usa el arma principal (los aliados sí)
  { id: 'escasez', scoreMult: 1.2 },        // cajas y botín de munición ×0,5
];
export const MUTATOR_SPEED = 1.2;
/** Segunda vuelta (nuestros): más enemigos y más vida, más puntos; empieza con dos mejoras a elegir. */
export const NG_PLUS = { enemies: 1.25, hp: 1.15, score: 1.5, startPicks: 2, startOptions: 6 };

/** Modo horda (nuestros). Oleada n: 6 + 2n enemigos (Normal); mezcla y oficios como la planta min(9, 1 + ⌊n/2⌋). */
export const HORDE = {
  base: 6, perWave: 2, rest: 12, bossEvery: 5, pickEvery: 2, aliveCap: 30, releaseEvery: 2, releaseGroup: 4,
  supplies: ['municion_50', 'vida_50'] as const,
};
export const BOSS_ROTATION: BossVariant[] = ['cohetes', 'ametrallador', 'embestida', 'escoltas'];
export function hordeFloorOf(wave: number): number { return Math.min(9, 1 + Math.floor(wave / 2)); }
export function hordeEnemies(wave: number, difficulty: 'easy' | 'normal' | 'hard'): number {
  return Math.max(3, Math.round((HORDE.base + HORDE.perWave * wave) * (DIFFICULTY_MULT[difficulty] / DIFFICULTY_MULT.normal)));
}
