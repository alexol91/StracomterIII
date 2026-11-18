// Contratos entre módulos. Cada módulo implementa lo suyo y consume lo de los demás
// SOLO a través de estas interfaces. Si necesitas algo que no está aquí, pídelo: no lo inventes.

import type {
  AiDebugInfo, ClassId, Door, Entity, FurnitureInst, GameEvent, ItemType, MapDef, OrderKind,
  Pickup, PlayerInput, Projectile, Theme, WallRect, WorldStatus, ZoneStats,
} from './sim/types';

// ───────────────────────── Simulación (src/sim) ─────────────────────────

export interface ILevel {
  map: MapDef;
  theme: Theme;
  /** Muros actuales (interiores y de perímetro, estos como rectángulos finos o segmentos gruesos). Cambia tras un boquete. */
  walls: WallRect[];
  /** Segmentos del perímetro [x0,y0,x1,y1] para dibujar la fachada (pueden no estar alineados con los ejes). */
  perimeterSegs: [number, number, number, number][];
  doors: Door[];
  furniture: FurnitureInst[];
  /** Se incrementa cada vez que cambia la geometría (boquete). */
  version: number;
  /** ¿(x,y) está dentro del polígono exterior? */
  inside(x: number, y: number): boolean;
}

export interface IWorld {
  level: ILevel;
  /** Todas las entidades, vivas y muertas (las muertas se quedan como cadáveres). */
  entities: Entity[];
  player: Entity;
  projectiles: Projectile[];
  pickups: Pickup[];
  /** Sucesos del último step. */
  events: GameEvent[];
  time: number;
  status: WorldStatus;
  floor: number; // 1..9
  zone: number;  // 1..6
  score: number;
  /** 0..100 */
  morale: number;
  stats: ZoneStats;
  /** Posición de cámara calculada por la simulación (ya con colisión contra muros). Úsala tal cual. */
  cam: { x: number; y: number; z: number; yaw: number; pitch: number };
  /** Punto al que apunta la mira (para dibujar retícula 3D o láser si se quiere). */
  aim: { x: number; y: number; z: number; entityId: number };
  /** Puerta que se puede accionar ahora (para el aviso contextual), o -1. */
  interactDoor: number;
  /** Sugerencia de apuntado asistido: orientación hacia el mejor blanco, o null. */
  assist: { yaw: number; pitch: number } | null;
  /** Orden vigente de la escuadra y su punto. */
  order: { kind: OrderKind; x: number; y: number; targetId: number };
  /** Enemigos vivos + los que aún faltan por aparecer. */
  enemiesRemaining(): number;
  enemiesAlive(): number;
  /** Fase del ritmo de la zona. */
  pacing: 'ascenso' | 'pico' | 'alivio' | 'descanso';
  cheats: { god: boolean; noclip: boolean; aiDebug: boolean };
  /** Avanza la simulación dt segundos (usa paso fijo 1/60). Consume los flancos de input. */
  step(dt: number, input: PlayerInput): void;
  /** Datos para dibujar ai.debug. Solo se rellenan si cheats.aiDebug. */
  aiDebug(): AiDebugInfo[];
  entityById(id: number): Entity | undefined;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface MemberState {
  hp: number;              // 0 = muerto para el resto de la campaña
  ammo: number;            // total de balas (cargador + reserva)
  inv: (ItemType | null)[]; // 5 ranuras
}

export interface CampaignState {
  version: 1;
  /** Planta que toca jugar (1..9). 10 = campaña terminada. */
  floor: number;
  controlled: ClassId;
  score: number;
  members: Record<ClassId, MemberState>;
  difficulty: Difficulty;
  /** Escalón de ajuste dinámico: -3..+3 (cada escalón, 10 % de enemigos). */
  adapt: number;
  quick?: boolean; // partida rápida: no se guarda
  /** intentos fallidos seguidos en la planta actual (cada reintento sale distinto) */
  retries?: number;
}

export interface ZoneInfo {
  floor: number;
  zone: number;
  map: MapDef;
  size: 'pequeno' | 'mediano' | 'grande';
  reward: ItemType;
  diafano: boolean;
  hasMiniBoss: boolean;
  hasMegaBoss: boolean;
  areaM2: number;
}

export interface ZoneSummary {
  floor: number;
  zone: number;
  stats: ZoneStats;
  reward: ItemType;
  /** quién cobra la recompensa (supervivientes) */
  rewarded: ClassId[];
  /** compañeros caídos en esta zona */
  fallen: ClassId[];
  totalScore: number;
  /** true si era la azotea: toca pantalla de Victoria */
  campaignWon: boolean;
}

export interface KVStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export interface ICampaign {
  newCampaign(difficulty: Difficulty, controlled: ClassId): CampaignState;
  newQuickPlay(difficulty: Difficulty, controlled: ClassId, floor: number): CampaignState;
  /** Las zonas elegibles de una planta (6; en la azotea, 1). */
  zonesOf(floor: number): ZoneInfo[];
  /** Crea el mundo de una zona a partir del estado. No modifica el estado. */
  startZone(state: CampaignState, zone: number): IWorld;
  /** Llamar cuando world.status === 'cleared'. Modifica y devuelve el estado nuevo (planta+1, recompensas, muertos) y GUARDA (salvo partida rápida). */
  completeZone(state: CampaignState, world: IWorld): ZoneSummary;
  /** Llamar al morir (world.status === 'dead'): el ajuste dinámico baja un escalón y se guarda. No toca nada más. */
  failZone(state: CampaignState): void;
  save(state: CampaignState): void;
  load(): CampaignState | null;
  hasSave(): boolean;
  clearSave(): void;
}

/** Consola de trucos. Devuelve las líneas de respuesta. `ctx` permite saltar de planta/zona. */
export interface IConsole {
  exec(line: string, world: IWorld | null): string[];
}
export interface ConsoleHost {
  /** Salta a planta/zona (lo implementa la app; recarga el mundo). */
  gotoFloorZone(floor: number | null, zone: number | null): string;
}

// ───────────────────────── Ajustes (src/ui/settings) ─────────────────────────

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'fire' | 'knife' | 'reload' | 'grenade' | 'ability'
  | 'interact' | 'useItem' | 'cycleItem' | 'crouch' | 'orderFollow' | 'orderGoto' | 'orderFocus'
  | 'orderHold' | 'pause' | 'console';

export interface Settings {
  lang: 'es' | 'en';
  musicVol: number; // 0..1
  sfxVol: number;   // 0..1
  difficulty: Difficulty;
  sensitivity: number; // 0.2..3, 1 = normal
  /** KeyboardEvent.code o 'Mouse0' | 'Mouse1' | 'Mouse2' */
  bindings: Record<Action, string>;
  subtitles: boolean;
  uiScale: number; // 0.8..1.4
  colorblind: boolean;
  cameraShake: boolean;
}

// ───────────────────────── Dibujo (src/render) ─────────────────────────

export interface IRenderer {
  /** Cambia de mundo (nueva zona). Reconstruye la escena. null = sin mundo (menús). */
  setWorld(world: IWorld | null): void;
  /** La app lo llama tras CADA world.step con world.events (trazadoras, explosiones, boquetes…). */
  onEvents(events: GameEvent[]): void;
  /** Dibuja un frame. dt = segundos reales desde el frame anterior. */
  render(dt: number): void;
  resize(width: number, height: number): void;
  applySettings(s: Settings): void;
  /** Proyecta un punto del mundo a píxeles CSS; null si queda detrás de la cámara. */
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  dispose(): void;
}

// ───────────────────────── Audio (src/audio) ─────────────────────────

export type MusicTrack = 'menu' | 'strategy' | 'combat' | 'boss' | 'victory' | null;

export interface IAudio {
  /** Llamar en el primer gesto del usuario (los navegadores exigen gesto para arrancar el audio). */
  unlock(): void;
  applySettings(s: Settings): void;
  music(track: MusicTrack): void;
  /** Reproduce los sonidos de los sucesos del último step, posicionados respecto a world.cam. */
  handleEvents(world: IWorld): void;
  ui(sound: 'click' | 'confirm' | 'back' | 'error' | 'reward' | 'victory' | 'defeat'): void;
}

// ───────────────────────── Controles (src/input) ─────────────────────────

export interface IControls {
  readonly isTouch: boolean;
  /** Activa/desactiva la captura (juego frente a menús). Al activar en ordenador pide pointer lock. */
  setActive(active: boolean): void;
  applySettings(s: Settings): void;
  /** Devuelve la entrada de este frame. Los flancos quedan a true hasta que world.step los consume. */
  poll(dt: number, world: IWorld): PlayerInput;
  /** Fija la orientación (al empezar una zona, mirar hacia donde toca). */
  setView(yaw: number, pitch: number): void;
  onPause: (() => void) | null;
  onConsole: (() => void) | null;
  dispose(): void;
}
