// Módulo de controles: une teclado/ratón (ordenador) y la capa táctil (móvil) en un único PlayerInput.

import type { IControls, IWorld, Settings } from '../contracts';
import { emptyInput } from '../sim/types';
import { createKeyboard } from './keyboard';
import { createTouch } from './touch';
import { createGamepad } from './gamepad';
import { PITCH_MAX, PITCH_MIN, angleDiff, clamp } from './shared';
import type { Core } from './shared';

/** Imán del apuntado asistido (rad/s). */
const ASSIST_FIRING = 3.0;
const ASSIST_IDLE = 1.0;
/** Con un arrastre activo del jugador, el imán solo usa esta fracción de su velocidad. */
const ASSIST_VS_DRAG = 0.35;

function detectTouch(): { isTouch: boolean; forced: boolean } {
  let forced = false;
  try { forced = /[?&]touch=1(&|$)/.test(window.location.search); } catch { /* sin location */ }
  if (forced) return { isTouch: true, forced };
  let coarse = false;
  let fine = false;
  try {
    coarse = !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    fine = !!window.matchMedia && window.matchMedia('(any-pointer: fine)').matches;
  } catch { /* matchMedia no disponible */ }
  const points = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0;
  return { isTouch: coarse || (points > 0 && !fine), forced };
}

/** Dispositivo del que vino la última entrada (para que la interfaz cambie los iconos). */
export type InputDevice = 'keyboard' | 'touch' | 'gamepad';

/** IControls más lo añadido en v1.3. */
export interface ControlsExt extends IControls {
  lastDevice: InputDevice;
  /** Botón de ping (clic central) mantenido ahora mismo (ordenador). */
  pingHeld: boolean;
  /** Vibración del mando; no hace nada si no hay mando o no soporta vibración. */
  rumble(strong: number, weak: number, ms: number): void;
}

export function createControls(root: HTMLElement, canvas: HTMLCanvasElement): ControlsExt {
  const { isTouch, forced } = detectTouch();
  const input = emptyInput();
  input.aimAssist = isTouch; // obligatorio en táctil, apagado en ordenador
  let settings: Settings | null = null;
  let active = false;
  let assistDesktop = false;

  const core: Core = {
    input,
    sensitivity(): number {
      const s = settings ? settings.sensitivity : 1;
      return Number.isFinite(s) && s > 0 ? s : 1;
    },
    rotate(dYaw: number, dPitch: number): void {
      input.yaw += dYaw;
      input.pitch = clamp(input.pitch + dPitch, PITCH_MIN, PITCH_MAX);
    },
  };

  const ctl: ControlsExt = {
    isTouch,
    lastDevice: isTouch ? 'touch' : 'keyboard',
    pingHeld: false,
    rumble(strong: number, weak: number, ms: number): void { gp.rumble(strong, weak, ms); },
    onPause: null,
    onConsole: null,

    setActive(a: boolean): void {
      active = a;
      kb.setActive(a);
      if (touch) touch.setActive(a);
      gp.setPlaying(a);
      if (!a) {
        input.moveF = 0; input.moveR = 0;
        input.fire = false; input.knife = false; input.crouch = false; input.sprint = false; input.aim = false; input.interactHold = false;
      }
    },

    applySettings(s: Settings): void {
      settings = s;
      kb.applySettings(s);
      gp.setToggleAim(!!s.toggleAim);
      assistDesktop = !!s.aimAssistDesktop;
      if (touch) touch.applySettings(s);
      input.aimAssist = isTouch || assistDesktop || ctl.lastDevice === 'gamepad';
    },

    poll(dt: number, world: IWorld): PlayerInputRef {
      const d = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
      if (!active) {
        input.moveF = 0; input.moveR = 0;
        input.fire = false; input.knife = false; input.crouch = false; input.sprint = false; input.aim = false; input.interactHold = false;
        return input;
      }
      const k = kb.update(d);
      const t = touch ? touch.update(d, world) : null;
      const p = gp.update(d);
      if (p.used) ctl.lastDevice = 'gamepad';
      ctl.pingHeld = k.ping;

      // Movimiento: teclado + stick táctil + stick del mando, normalizado para no pasar de 1.
      let f = k.moveF + (t ? t.moveF : 0) + p.moveF;
      let r = k.moveR + (t ? t.moveR : 0) + p.moveR;
      const len = Math.hypot(f, r);
      if (len > 1) { f /= len; r /= len; }
      input.moveF = f;
      input.moveR = r;

      input.fire = k.fire || (t ? t.fire : false) || p.fire;
      input.knife = k.knife || (t ? t.knife : false) || p.knife;
      input.crouch = k.crouch || (t ? t.crouch : false) || p.crouch;
      input.sprint = k.sprint || (t ? t.sprint : false) || p.sprint;
      input.aim = k.aim || (t ? t.aim : false) || p.aim;
      input.interactHold = k.interactHold || (t ? t.interactHold : false) || p.interactHold;
      // Táctil: asistido siempre. Mando: asistido suave si fue la última entrada.
      input.aimAssist = isTouch || assistDesktop || ctl.lastDevice === 'gamepad';

      // Imán del apuntado asistido (solo táctil).
      if (isTouch && world && world.assist) {
        const dragging = touch ? touch.isDragging() : false;
        let speed = input.fire ? ASSIST_FIRING : dragging ? 0 : ASSIST_IDLE;
        if (dragging) speed *= ASSIST_VS_DRAG;
        if (speed > 0) {
          const maxStep = speed * d;
          const dy = clamp(angleDiff(input.yaw, world.assist.yaw), -maxStep, maxStep);
          const dp = clamp(world.assist.pitch - input.pitch, -maxStep, maxStep);
          core.rotate(dy, dp);
        }
      }

      input.pitch = clamp(input.pitch, PITCH_MIN, PITCH_MAX);
      return input;
    },

    setView(yaw: number, pitch: number): void {
      input.yaw = yaw;
      input.pitch = clamp(pitch, PITCH_MIN, PITCH_MAX);
    },

    dispose(): void {
      kb.dispose();
      gp.dispose();
      if (touch) touch.dispose();
    },
  };

  const kb = createKeyboard(root, canvas, {
    core,
    useMouse: !isTouch,
    onPause: () => { if (ctl.onPause) ctl.onPause(); },
    onConsole: () => { if (ctl.onConsole) ctl.onConsole(); },
    onDevice: () => { ctl.lastDevice = 'keyboard'; },
  });
  const gp = createGamepad({
    core,
    onPause: () => { if (ctl.onPause) ctl.onPause(); },
    isPlaying: () => active,
  });
  const touch = isTouch ? createTouch(root, canvas, core, forced) : null;
  if (touch) touch.onTouch = () => { ctl.lastDevice = 'touch'; };

  return ctl;
}

type PlayerInputRef = ReturnType<typeof emptyInput>;
