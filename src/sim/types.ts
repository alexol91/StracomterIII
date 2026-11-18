// Contrato de la simulación. Todo lo que dibuja, suena o pinta interfaz lee de aquí.
// La simulación NO depende del DOM ni de three.js: se ejecuta igual en Node (partidas de prueba).
//
// Convenios:
//  - Plano del juego: (x, y) en metros, los mismos del JSON de mapas. Altura: z, suelo en 0.
//  - En three.js: X = x, Z = y, Y = z (altura).
//  - yaw en radianes; dirección horizontal = (cos yaw, sin yaw). pitch > 0 mira hacia arriba.

export type ClassId = 'captain' | 'technic' | 'especialist' | 'explosives';
export type EnemyKind = 'enemy1' | 'enemy2' | 'enemy3' | 'miniboss' | 'megaboss';
export type Kind = ClassId | EnemyKind;
export type Team = 'ally' | 'enemy';

export const CLASS_IDS: ClassId[] = ['captain', 'technic', 'especialist', 'explosives'];
export const ENEMY_KINDS: EnemyKind[] = ['enemy1', 'enemy2', 'enemy3', 'miniboss', 'megaboss'];

export type FurnitureType =
  | 'mesa' | 'escritorio' | 'mesa_con_sillas' | 'estanteria' | 'sofa' | 'butaca' | 'silla' | 'maceta';

/** Objetos: botiquines y cajas de munición. Mismos nombres que el JSON. */
export type ItemType = 'vida_20' | 'vida_50' | 'vida_100' | 'municion_20' | 'municion_50' | 'municion_100';

export type Vec2 = [number, number];

/** Ambiente visual de la planta (colores, suelo, luz). */
export type Theme =
  | 'recepcion' | 'soporte' | 'desarrollo' | 'calidad' | 'datos' | 'comercial' | 'direccion' | 'juntas' | 'azotea';

/** Formato de mapa: idéntico al de MAPAS-DE-MUESTRA.json, más campos opcionales. */
export interface MapDef {
  nombre: string;
  tamano: 'pequeno' | 'mediano' | 'grande';
  ancho_m: number;
  alto_m: number;
  /** Polígono exterior (puede ser cóncavo). El interior es lo jugable. */
  perimetro: Vec2[];
  /** Muros interiores: rectángulos alineados con los ejes, 4 vértices. */
  muros: Vec2[][];
  /** Puertas: rectángulos alineados con los ejes, 4 vértices. Empiezan cerradas. */
  puertas: Vec2[][];
  mobiliario: { tipo: FurnitureType; pos: Vec2; angulo: number }[]; // ángulo en grados
  objetos: { tipo: ItemType; pos: Vec2 }[];
  inicio_jugador: Vec2;
  punto_jefe: Vec2;
  tema?: Theme;
  /** true = diáfano, false = pasillos/despachos. Para la lectura de amenaza. */
  diafano?: boolean;
}

export interface Door {
  id: number;
  x0: number; y0: number; x1: number; y1: number; // rectángulo
  cx: number; cy: number;
  /** true si la puerta está en un muro vertical (se cruza andando en x). */
  vertical: boolean;
  open: boolean;
  /** 0 cerrada … 1 abierta, para animar. */
  anim: number;
}

export interface WallRect { x0: number; y0: number; x1: number; y1: number; perimeter: boolean }

export interface FurnitureInst {
  type: FurnitureType;
  x: number; y: number;
  angle: number; // radianes
  /** medio ancho y medio fondo en el sistema local del mueble */
  hw: number; hd: number;
  height: number;
}

export interface Pickup { id: number; type: ItemType; x: number; y: number; taken: boolean }

export type ProjectileKind = 'grenade' | 'rocket';
export interface Projectile {
  id: number;
  kind: ProjectileKind;
  ownerId: number;
  team: Team;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** segundos hasta estallar (granada) */
  fuse: number;
  dead: boolean;
}

/** v1.2 — ranuras de arma al estilo Counter-Strike: 1 principal, 2 pistola, 3 cuchillo, 4 granada. */
export type WeaponSlot = 'primary' | 'secondary' | 'knife' | 'grenade';
export const WEAPON_SLOTS: WeaponSlot[] = ['primary', 'secondary', 'knife', 'grenade'];

export type OrderKind = 'follow' | 'goto' | 'focus' | 'hold';

export interface Entity {
  id: number;
  kind: Kind;
  team: Team;
  isPlayer: boolean;
  x: number; y: number;
  vx: number; vy: number;
  yaw: number;
  /** inclinación del apuntado (solo relevante en el jugador) */
  pitch: number;
  radius: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** world.time en que murió (para animar la caída), -1 si vivo */
  deadAt: number;
  crouch: boolean;
  /** balas en el cargador */
  mag: number;
  magSize: number;
  /** balas de reserva (fuera del cargador) */
  ammo: number;
  /** segundos que faltan de recarga; 0 = no recarga */
  reloading: number;
  grenades: number;
  /** segundos que faltan para poder usar la habilidad de clase */
  abilityCd: number;
  abilityCdMax: number;
  /** >0 mientras dura la habilidad (p. ej. Supresión) */
  abilityActive: number;
  inventory: (ItemType | null)[]; // 5 ranuras
  invSel: number;
  /** world.time del último disparo / cuchillada / daño recibido: para animaciones */
  lastShotAt: number;
  lastKnifeAt: number;
  lastHurtAt: number;
  /** etiqueta legible de lo que hace la IA (ai.debug e `info`) */
  aiState: string;
  /** fase del MegaBoss (1..3), 0 en el resto */
  bossPhase: number;
  /** escudo activo (MegaBoss entre fases) */
  shielded: boolean;
  /** marcado por la habilidad Órdenes / orden de enfocar */
  marked: boolean;
  // ── v1.2 ──
  /** esprintando (no puede disparar) */
  sprinting: boolean;
  /** apuntando al hombro (solo el jugador) */
  aiming: boolean;
  /** dispersión actual del arma en radianes (sigma): la retícula la dibuja */
  spread: number;
  /** world.time hasta el que está aturdido por un impacto fuerte (no dispara, va lento); 0 si no */
  staggerUntil: number;
  /** arma en la mano (los que no son el jugador llevan siempre 'primary') y la anterior (para Q) */
  weapon: WeaponSlot;
  lastWeapon: WeaponSlot;
  /** world.time hasta el que está sacando el arma tras cambiar (no puede disparar); 0 si no */
  drawUntil: number;
  /** pistola: balas en el cargador y tamaño; su reserva es infinita */
  mag2: number;
  magSize2: number;
}

/** Entrada del jugador para un paso de simulación. La genera la capa de controles. */
export interface PlayerInput {
  /** avance (+1 adelante) y lateral (+1 derecha) relativos a la cámara, magnitud ≤ 1 */
  moveF: number;
  moveR: number;
  /** orientación absoluta de la cámara/apuntado */
  yaw: number;
  pitch: number;
  /** distancia de cámara deseada (zoom), metros */
  camDist: number;
  fire: boolean;          // mantenido
  /** v1.2 — esprint (mantenido): más rápido, sin disparar */
  sprint: boolean;
  /** v1.2 — apuntar al hombro (mantenido): más precisión, más lento */
  aim: boolean;
  knife: boolean;         // mantenido
  crouch: boolean;        // mantenido
  // Pulsaciones (flanco). world.step las consume y las pone a false.
  reload: boolean;
  grenade: boolean;
  ability: boolean;
  interact: boolean;
  useItem: boolean;
  cycleItem: boolean;
  order: OrderKind | null;
  /** v1.2 — pulsaciones (flanco): elegir ranura, volver a la anterior (Q), rueda (+1 siguiente, -1 anterior) */
  weaponSlot: WeaponSlot | null;
  weaponLast: boolean;
  weaponCycle: number;
  /** móvil: las balas se corrigen hacia el enemigo visible más cercano a la mira */
  aimAssist: boolean;
}

export function emptyInput(): PlayerInput {
  return {
    moveF: 0, moveR: 0, yaw: 0, pitch: 0, camDist: 4.2,
    fire: false, sprint: false, aim: false, knife: false, crouch: false,
    reload: false, grenade: false, ability: false, interact: false,
    useItem: false, cycleItem: false, order: null, aimAssist: false,
    weaponSlot: null, weaponLast: false, weaponCycle: 0,
  };
}

export type HitZone = 'head' | 'torso' | 'limb';

/** Sucesos de un paso. Se vacían al empezar el paso siguiente: léelos tras cada step. */
export type GameEvent =
  | { type: 'shot'; id: number; kind: Kind; team: Team; fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; hit: 'none' | 'wall' | 'entity';
      /** v1.2 — qué ha tocado la bala (para marcas y polvo); normal aproximada en el plano (nx, ny) */
      surface?: 'wall' | 'door' | 'furniture' | 'floor' | 'body' | 'none'; nx?: number; ny?: number;
      /** v1.2 — con qué ranura se disparó (ausente = principal) */
      weapon?: WeaponSlot }
  | { type: 'weaponSwitch'; id: number; weapon: WeaponSlot }
  | { type: 'dryfire'; id: number }
  | { type: 'explosion'; x: number; y: number; z: number; radius: number }
  | { type: 'hurt'; id: number; amount: number; zone: HitZone | 'blast' | 'knife'; fromX: number; fromY: number; attackerId: number }
  | { type: 'death'; id: number; kind: Kind; team: Team; x: number; y: number;
      /** v1.2 — quién lo mató (-1 si nadie), si fue de un tiro en la cabeza, y dirección del golpe final */
      killerId?: number; headshot?: boolean; fromX?: number; fromY?: number }
  | { type: 'knife'; id: number; hit: boolean }
  | { type: 'reload'; id: number }
  | { type: 'door'; doorId: number; open: boolean; x: number; y: number }
  | { type: 'pickup'; id: number; item: ItemType; x: number; y: number }
  | { type: 'itemUsed'; id: number; item: ItemType }
  | { type: 'throw'; id: number; kind: ProjectileKind }
  | { type: 'step'; id: number; x: number; y: number }
  | { type: 'spawn'; id: number; kind: Kind }
  | { type: 'ability'; id: number; ability: 'orders' | 'hack' | 'suppress' | 'demolition'; ok: boolean; x: number; y: number }
  | { type: 'breach'; x: number; y: number }       // se ha abierto un boquete: hay que redibujar muros
  | { type: 'order'; order: OrderKind; x: number; y: number }
  | { type: 'bossPhase'; id: number; phase: number }
  | { type: 'alert'; id: number; x: number; y: number }  // un enemigo te descubre
  | { type: 'phase'; phase: 'ascenso' | 'pico' | 'alivio' | 'descanso' }
  | { type: 'cleared' }
  | { type: 'playerDead' };

export type WorldStatus = 'playing' | 'cleared' | 'dead';

/** Datos de depuración de IA (ai.debug). */
export interface AiDebugInfo {
  id: number;
  state: string;
  /** conos: [semiángulo rad, alcance m] primario y periférico */
  cones: [number, number, number, number];
  path: Vec2[];
  /** dónde cree que está el objetivo */
  belief: Vec2 | null;
  awareness: number; // 0..1
}

/** Estadísticas de la zona para el resumen de fin de planta y el ajuste de dificultad. */
export interface ZoneStats {
  /** v1.2 — impactos en la cabeza del jugador, y mejor racha de bajas del jugador (bajas con < 4 s entre ellas) */
  headshots?: number;
  bestStreak?: number;
  time: number;
  kills: number;
  shotsFired: number;
  shotsHit: number;
  damageTaken: number;
  alliesLost: number;
  scoreGained: number;
}
