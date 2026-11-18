// Controles de ordenador: teclado, ratón y pointer lock.

import type { Action, Settings } from '../contracts';
import { CAM_MAX, CAM_MIN, Core, clamp, isTextTarget } from './shared';

/** Teclas por defecto, solo hasta que llegue applySettings. */
export const DEFAULT_BINDINGS: Record<Action, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  fire: 'Mouse0', knife: 'KeyX', sprint: 'ShiftLeft', aim: 'Mouse2', reload: 'KeyR', grenade: 'Space', ability: 'KeyF',
  interact: 'KeyE', useItem: 'KeyQ', cycleItem: 'Tab', crouch: 'ControlLeft',
  orderFollow: 'KeyV', orderGoto: 'Digit1', orderFocus: 'Digit2', orderHold: 'Digit3',
  pause: 'Escape', console: 'Backquote',
};

/** Radianes por píxel de ratón (se multiplica por la sensibilidad). */
const MOUSE_K = 0.0022;
/** Giro con las flechas, rad/s. */
const ARROW_YAW = 2.2;
const ARROW_PITCH = 1.2;
/** Teclas cuyo comportamiento por defecto del navegador hay que impedir mientras jugamos. */
const BLOCKED = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export interface KeyboardHooks {
  core: Core;
  onPause(): void;
  onConsole(): void;
  /** false en modo táctil: ahí los eventos de ratón los atiende la capa táctil. */
  useMouse: boolean;
}

/** Estado mantenido que el teclado/ratón aporta a este frame. */
export interface KeyHeld {
  moveF: number;
  moveR: number;
  fire: boolean;
  knife: boolean;
  crouch: boolean;
  sprint: boolean;
  aim: boolean;
}

export interface KeyboardCtl {
  setActive(active: boolean): void;
  applySettings(s: Settings): void;
  /** Una vez por frame: aplica las flechas y devuelve lo mantenido (mismo objeto cada vez). */
  update(dt: number): KeyHeld;
  dispose(): void;
}

export function createKeyboard(root: HTMLElement, canvas: HTMLCanvasElement, hooks: KeyboardHooks): KeyboardCtl {
  const { core } = hooks;
  const input = core.input;

  let bindings: Record<Action, string> = { ...DEFAULT_BINDINGS };
  let byCode = new Map<string, Action[]>();
  /** códigos físicos pulsados ahora ('KeyW', 'Mouse0'…) */
  const down = new Set<string>();
  /** Mantenidas pulsadas y soltadas entre dos polls: cuentan como true un frame (un clic rápido no se pierde). */
  const latch = new Set<Action>();
  const arrows = new Set<string>();
  let active = false;
  let locked = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let haveLast = false;
  let ignorePauseUntil = 0;

  const held: KeyHeld = { moveF: 0, moveR: 0, fire: false, knife: false, crouch: false, sprint: false, aim: false };

  function rebuild(): void {
    byCode = new Map();
    for (const a of Object.keys(bindings) as Action[]) {
      const code = bindings[a];
      if (!code) continue;
      const list = byCode.get(code);
      if (list) list.push(a);
      else byCode.set(code, [a]);
    }
  }
  rebuild();

  function isHeld(a: Action): boolean {
    const c = bindings[a];
    return !!c && down.has(c);
  }

  function releaseAll(): void {
    down.clear();
    latch.clear();
    arrows.clear();
    dragging = false;
    haveLast = false;
  }

  function requestLock(): void {
    if (!hooks.useMouse || locked) return;
    try {
      const r = (canvas as unknown as { requestPointerLock?: () => unknown }).requestPointerLock?.();
      // Los navegadores modernos devuelven una promesa que puede rechazarse: sin lock se usa el arrastre.
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
    } catch { /* sin pointer lock: alternativa por arrastre */ }
  }

  /** Una pulsación (tecla o botón de ratón): dispara los flancos asociados. */
  function press(code: string, repeat: boolean): void {
    const acts = byCode.get(code);
    if (acts) {
      for (const a of acts) {
        if (a === 'fire' || a === 'knife' || a === 'crouch' || a === 'sprint' || a === 'aim') latch.add(a);
        if (repeat) continue;
        switch (a) {
          case 'reload': input.reload = true; break;
          case 'grenade': input.grenade = true; break;
          case 'ability': input.ability = true; break;
          case 'interact': input.interact = true; break;
          case 'useItem': input.useItem = true; break;
          case 'cycleItem': input.cycleItem = true; break;
          case 'orderFollow': input.order = 'follow'; break;
          case 'orderGoto': input.order = 'goto'; break;
          case 'orderFocus': input.order = 'focus'; break;
          case 'orderHold': input.order = 'hold'; break;
          case 'pause':
            if (performance.now() >= ignorePauseUntil) hooks.onPause();
            break;
          case 'console': hooks.onConsole(); break;
          default: break;
        }
      }
    }
    // La tecla de consola acepta además IntlBackslash y F2 (teclados sin Backquote).
    if (!repeat && (code === 'IntlBackslash' || code === 'F2') && !(acts && acts.includes('console'))) {
      hooks.onConsole();
    }
  }

  // ───────── teclado ─────────
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!active || isTextTarget(e.target)) return;
    if (BLOCKED.has(e.code)) e.preventDefault();
    if (e.code.startsWith('Arrow')) arrows.add(e.code);
    down.add(e.code);
    press(e.code, e.repeat);
  };
  // Soltar siempre se procesa (aunque el foco esté en un input) para no dejar teclas pegadas.
  const onKeyUp = (e: KeyboardEvent): void => {
    down.delete(e.code);
    arrows.delete(e.code);
  };
  const onBlur = (): void => releaseAll();
  const onVisibility = (): void => { if (document.hidden) releaseAll(); };

  // ───────── ratón ─────────
  function inGame(t: Element | null): boolean {
    if (!t) return false;
    return t === canvas || root.contains(t) || canvas.contains(t);
  }

  const onMouseDown = (e: MouseEvent): void => {
    if (!active || !hooks.useMouse) return;
    const t = e.target as Element | null;
    if (!inGame(t)) return;
    // Un botón de la interfaz (pausa, etc.) no es un clic de juego.
    if (t && typeof t.closest === 'function' && t.closest('button, a, input, select, textarea, [role="button"], [data-ui]')) return;
    const code = 'Mouse' + e.button;
    if (e.button === 1) e.preventDefault(); // autoscroll del botón central
    down.add(code);
    press(code, false);
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    haveLast = true;
    if (!locked) requestLock();
  };
  const onMouseUp = (e: MouseEvent): void => {
    down.delete('Mouse' + e.button);
    if (e.buttons === 0) dragging = false;
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (!active || !hooks.useMouse) return;
    let mx = e.movementX;
    let my = e.movementY;
    if (!locked) {
      // Sin pointer lock: solo gira arrastrando con algún botón pulsado.
      if (!dragging || e.buttons === 0) { lastX = e.clientX; lastY = e.clientY; haveLast = true; return; }
      // Algunos entornos (pruebas automáticas) no rellenan movementX: usa la diferencia de posición.
      if (!mx && !my && haveLast) { mx = e.clientX - lastX; my = e.clientY - lastY; }
    }
    lastX = e.clientX;
    lastY = e.clientY;
    haveLast = true;
    if (mx || my) {
      // Al apuntar (aim mantenido) la sensibilidad baja a 0,6.
      const k = MOUSE_K * core.sensitivity() * (isHeld('aim') ? 0.6 : 1);
      core.rotate(mx * k, -my * k); // ratón a la derecha = +yaw; ratón arriba (my<0) = +pitch
    }
  };
  const onWheel = (e: WheelEvent): void => {
    if (!active || isTextTarget(e.target)) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    input.camDist = clamp(input.camDist + e.deltaY * unit * 0.003, CAM_MIN, CAM_MAX);
  };
  const onContext = (e: Event): void => { if (active) e.preventDefault(); };

  const onLockChange = (): void => {
    const was = locked;
    locked = document.pointerLockElement === canvas;
    if (was && !locked && active) {
      // El usuario pulsó Esc (o el navegador soltó el lock): pausa. Se ignora la tecla de pausa un instante
      // por si el mismo Esc llega también como keydown.
      ignorePauseUntil = performance.now() + 250;
      releaseAll();
      hooks.onPause();
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('contextmenu', onContext);
  document.addEventListener('pointerlockchange', onLockChange);

  return {
    setActive(a: boolean): void {
      if (a === active) { if (a) requestLock(); return; }
      active = a;
      if (a) {
        requestLock();
      } else {
        releaseAll();
        if (document.pointerLockElement === canvas) {
          try { document.exitPointerLock(); } catch { /* nada */ }
        }
      }
    },

    applySettings(s: Settings): void {
      bindings = { ...DEFAULT_BINDINGS, ...(s.bindings || {}) };
      rebuild();
    },

    update(dt: number): KeyHeld {
      if (!active) {
        held.moveF = 0; held.moveR = 0; held.fire = false; held.knife = false; held.crouch = false; held.sprint = false; held.aim = false;
        return held;
      }
      // Flechas: giran la vista siempre, con o sin pointer lock (no dependen de la sensibilidad).
      const ay = (arrows.has('ArrowRight') ? 1 : 0) - (arrows.has('ArrowLeft') ? 1 : 0);
      const ap = (arrows.has('ArrowUp') ? 1 : 0) - (arrows.has('ArrowDown') ? 1 : 0);
      if (ay || ap) core.rotate(ay * ARROW_YAW * dt, ap * ARROW_PITCH * dt);

      held.moveF = (isHeld('forward') ? 1 : 0) - (isHeld('back') ? 1 : 0);
      held.moveR = (isHeld('right') ? 1 : 0) - (isHeld('left') ? 1 : 0);
      held.fire = isHeld('fire') || latch.has('fire');
      held.knife = isHeld('knife') || latch.has('knife');
      held.crouch = isHeld('crouch') || latch.has('crouch');
      held.sprint = isHeld('sprint') || latch.has('sprint');
      held.aim = isHeld('aim') || latch.has('aim');
      latch.clear();
      return held;
    },

    dispose(): void {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('contextmenu', onContext);
      document.removeEventListener('pointerlockchange', onLockChange);
      active = false;
      if (document.pointerLockElement === canvas) {
        try { document.exitPointerLock(); } catch { /* nada */ }
      }
    },
  };
}
