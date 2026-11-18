// Mando (Gamepad API, mapeo estándar). Dos modos:
//  - jugando: update() lee el mando y escribe sobre el PlayerInput (movimiento, cámara, botones);
//  - en menús: un bucle propio emite teclas sintéticas (flechas, Enter, Escape) para navegar el foco.

import { Core, clamp } from './shared';

// Índices del mapeo estándar
const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7, BACK = 8, START = 9, L3 = 10, R3 = 11;
const DUP = 12, DDOWN = 13, DLEFT = 14, DRIGHT = 15;

const DEAD_MOVE = 0.18;
const DEAD_LOOK = 0.15;
const LOOK_RATE = 2.6;        // rad/s a fondo (× sensibilidad)
const LOOK_ACCEL_MAX = 1.6;   // factor máximo por mantener el stick a fondo
const LOOK_ACCEL_TIME = 0.6;  // s hasta alcanzarlo
const AIM_LOOK = 0.6;
const X_HOLD = 0.4;           // s para que X pase de recargar a interactuar

export interface GamepadHeld {
  moveF: number;
  moveR: number;
  fire: boolean;
  knife: boolean;
  crouch: boolean;
  sprint: boolean;
  aim: boolean;
  /** true si en este frame el jugador ha tocado algo del mando */
  used: boolean;
  /** X mantenida pasado el umbral de 0,4 s */
  interactHold: boolean;
}

export interface GamepadCtl {
  /** Una vez por frame jugando. */
  update(dt: number): GamepadHeld;
  /** Jugando (true) o en menús (false): decide quién lee el mando. */
  setPlaying(playing: boolean): void;
  connected(): boolean;
  rumble(strong: number, weak: number, ms: number): void;
  dispose(): void;
}

export interface GamepadHooks {
  core: Core;
  onPause(): void;
  /** Para saber si estamos activos y no emitir teclas sintéticas por error. */
  isPlaying(): boolean;
}

function getPad(): Gamepad | null {
  try {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const g of list) if (g && g.connected) return g;
  } catch { /* sin Gamepad API */ }
  return null;
}

/** Zona muerta radial con reescalado y curva suave (m^exp). */
function stick(x: number, y: number, dead: number, exp: number): [number, number] {
  const len = Math.hypot(x, y);
  if (len < dead) return [0, 0];
  const m = Math.min((len - dead) / (1 - dead), 1);
  const k = Math.pow(m, exp) / len;
  return [x * k, y * k];
}

export function createGamepad(hooks: GamepadHooks): GamepadCtl {
  const { core } = hooks;
  const input = core.input;
  let playing = false;
  let isConnected = !!getPad();
  let prev: boolean[] = [];
  let sprintToggle = false;
  let crouchToggle = false;
  let xDownAt = -1;
  let xInteracted = false;
  let lookHold = 0;
  let raf = 0;
  let navTimer = 0;
  let navDir = '';
  let lastTime = performance.now();
  const held: GamepadHeld = { moveF: 0, moveR: 0, fire: false, knife: false, crouch: false, sprint: false, aim: false, used: false, interactHold: false };

  const onConnect = (): void => { isConnected = true; };
  const onDisconnect = (): void => { isConnected = !!getPad(); };
  window.addEventListener('gamepadconnected', onConnect);
  window.addEventListener('gamepaddisconnected', onDisconnect);

  function states(g: Gamepad): boolean[] {
    const out: boolean[] = [];
    for (let i = 0; i < 17; i++) {
      const b = g.buttons[i];
      out[i] = !!b && (b.pressed || b.value > 0.5);
    }
    return out;
  }

  /** Copia el estado actual como "anterior" para no generar flancos falsos al cambiar de modo. */
  function snapshot(): void {
    const g = getPad();
    prev = g ? states(g) : [];
    sprintToggle = false;
    xDownAt = -1;
  }

  // ───────── navegación de menús (teclas sintéticas) ─────────
  function sendKey(key: string, code: string): void {
    const target = (document.activeElement as HTMLElement | null) || document.body;
    const init = { key, code, bubbles: true, cancelable: true };
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    // Un keydown sintético no activa botones: el clic hay que darlo a mano.
    if (key === 'Enter' && target && typeof target.click === 'function' && target !== document.body) target.click();
  }

  function menuLoop(): void {
    raf = requestAnimationFrame(menuLoop);
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    if (hooks.isPlaying() || playing) return;
    const g = getPad();
    if (!g) { prev = []; return; }
    const s = states(g);
    const edge = (i: number): boolean => s[i] && !prev[i];
    if (edge(A)) sendKey('Enter', 'Enter');
    if (edge(B)) sendKey('Escape', 'Escape');
    // Dirección: cruceta o stick izquierdo; repite al mantener.
    let dir = '';
    const ax = g.axes[0] || 0, ay = g.axes[1] || 0;
    if (s[DUP] || ay < -0.6) dir = 'ArrowUp';
    else if (s[DDOWN] || ay > 0.6) dir = 'ArrowDown';
    else if (s[DLEFT] || ax < -0.6) dir = 'ArrowLeft';
    else if (s[DRIGHT] || ax > 0.6) dir = 'ArrowRight';
    if (!dir) { navDir = ''; navTimer = 0; } else if (dir !== navDir) {
      navDir = dir; navTimer = 0.35; sendKey(dir, dir);
    } else {
      navTimer -= dt;
      if (navTimer <= 0) { navTimer = 0.12; sendKey(dir, dir); }
    }
    prev = s;
  }
  raf = requestAnimationFrame(menuLoop);

  return {
    setPlaying(p: boolean): void {
      playing = p;
      snapshot();
      lookHold = 0;
      if (!p) { sprintToggle = false; crouchToggle = false; }
    },

    connected(): boolean { return isConnected && !!getPad(); },

    update(dt: number): GamepadHeld {
      held.used = false;
      held.interactHold = false;
      const g = getPad();
      if (!g) {
        held.moveF = 0; held.moveR = 0; held.fire = false; held.knife = false;
        held.crouch = crouchToggle; held.sprint = false; held.aim = false;
        prev = [];
        return held;
      }
      const s = states(g);
      const edge = (i: number): boolean => s[i] && !prev[i];
      const ax = (i: number): number => g.axes[i] || 0;

      // Movimiento
      const [lx, ly] = stick(ax(0), ax(1), DEAD_MOVE, 1.4);
      held.moveR = lx;
      held.moveF = -ly;
      const moving = lx !== 0 || ly !== 0;

      // Cámara con aceleración al mantener a fondo
      const [rx, ry] = stick(ax(2), ax(3), DEAD_LOOK, 2);
      const rmag = Math.hypot(rx, ry);
      lookHold = rmag > 0.85 ? Math.min(lookHold + dt, LOOK_ACCEL_TIME) : Math.max(lookHold - dt * 2, 0);
      const accel = 1 + (LOOK_ACCEL_MAX - 1) * (lookHold / LOOK_ACCEL_TIME);
      const aiming = (g.buttons[LT] ? g.buttons[LT].value > 0.3 || g.buttons[LT].pressed : false);
      const rate = LOOK_RATE * core.sensitivity() * accel * (aiming ? AIM_LOOK : 1);
      if (rx || ry) core.rotate(rx * rate * dt, -ry * rate * dt);

      held.fire = g.buttons[RT] ? g.buttons[RT].value > 0.3 || g.buttons[RT].pressed : false;
      held.aim = aiming;
      held.knife = s[R3];

      if (edge(L3)) sprintToggle = !sprintToggle;
      if (!moving) sprintToggle = false; // el esprint alterno se corta al soltar el stick
      held.sprint = sprintToggle;
      if (edge(B)) crouchToggle = !crouchToggle;
      held.crouch = crouchToggle;

      if (edge(A)) input.roll = true;
      if (edge(Y)) input.weaponLast = true;
      if (edge(RB)) input.grenade = true;
      if (edge(LB)) input.ability = true;
      if (edge(DUP)) input.ping = true;
      if (edge(DLEFT)) input.weaponCycle = -1;
      if (edge(DRIGHT)) input.weaponCycle = 1;
      if (edge(DDOWN)) input.useItem = true;
      if (edge(BACK)) input.cycleItem = true;
      if (edge(START)) hooks.onPause();

      // X: toque = recargar (al soltar); mantener = interactuar
      const now = performance.now() / 1000;
      if (edge(X)) { xDownAt = now; xInteracted = false; }
      if (s[X] && xDownAt >= 0 && !xInteracted && now - xDownAt >= X_HOLD) { input.interact = true; xInteracted = true; }
      if (!s[X] && prev[X] && xDownAt >= 0) {
        if (!xInteracted) input.reload = true;
        xDownAt = -1;
      }

      held.interactHold = s[X] && xInteracted;
      held.used = moving || rmag > 0 || s.some((v) => v);
      prev = s;
      return held;
    },

    rumble(strong: number, weak: number, ms: number): void {
      const g = getPad() as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null;
      const act = g && g.vibrationActuator;
      if (!act || !act.playEffect) return;
      try {
        const r = act.playEffect('dual-rumble', {
          startDelay: 0, duration: Math.max(0, ms),
          strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1),
        });
        if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {});
      } catch { /* sin vibración */ }
    },

    dispose(): void {
      cancelAnimationFrame(raf);
      window.removeEventListener('gamepadconnected', onConnect);
      window.removeEventListener('gamepaddisconnected', onDisconnect);
    },
  };
}
