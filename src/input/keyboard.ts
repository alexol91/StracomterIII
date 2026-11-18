// Controles de ordenador: teclado, ratón y pointer lock.

import type { Action, Settings } from '../contracts';
import { CAM_MAX, CAM_MIN, Core, clamp, isTextTarget } from './shared';

/** Teclas por defecto, solo hasta que llegue applySettings. */
export const DEFAULT_BINDINGS: Record<Action, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  fire: 'Mouse0', knife: 'KeyV', sprint: 'ShiftLeft', aim: 'Mouse2', reload: 'KeyR', grenade: 'KeyG', ability: 'KeyF',
  interact: 'KeyE', useItem: 'KeyT', cycleItem: 'Tab', crouch: 'ControlLeft',
  orderFollow: 'KeyZ', orderGoto: 'KeyX', orderFocus: 'KeyB', orderHold: 'KeyN',
  roll: 'Space', ping: 'Mouse1',
  slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4', lastWeapon: 'KeyQ',
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
  /** Aviso de que el último dispositivo usado es el teclado/ratón. */
  onDevice(): void;
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
  /** botón de ping mantenido (para la rueda de órdenes de la interfaz) */
  ping: boolean;
  interactHold: boolean;
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
  let lastWheelAt = -1000;

  // Modo alternar (Settings.toggleX): la acción conmuta con cada pulsación.
  const toggleMode = { crouch: false, aim: false, sprint: false };
  const toggled = { crouch: false, aim: false, sprint: false };

  const held: KeyHeld = { moveF: 0, moveR: 0, fire: false, knife: false, crouch: false, sprint: false, aim: false, ping: false, interactHold: false };

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
    toggled.crouch = false; toggled.aim = false; toggled.sprint = false;
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
        if (a === 'crouch' && toggleMode.crouch) toggled.crouch = !toggled.crouch;
        if (a === 'aim' && toggleMode.aim) toggled.aim = !toggled.aim;
        if (a === 'sprint') {
          if (toggleMode.sprint) toggled.sprint = !toggled.sprint;
          toggled.aim = false; // esprintar corta el apuntar alternado
        }
        switch (a) {
          case 'reload': input.reload = true; break;
          case 'grenade': input.grenade = true; break;
          case 'ability': input.ability = true; break;
          case 'interact': input.interact = true; break;
          case 'useItem': input.useItem = true; break;
          case 'cycleItem': input.cycleItem = true; break;
          case 'slot1': input.weaponSlot = 'primary'; break;
          case 'slot2': input.weaponSlot = 'secondary'; break;
          case 'slot3': input.weaponSlot = 'knife'; break;
          case 'slot4': input.weaponSlot = 'grenade'; break;
          case 'roll': input.roll = true; break;
          case 'ping': input.ping = true; break;
          case 'lastWeapon': input.weaponLast = true; break;
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
    // KeyC agacha como alternativa fija mientras no esté asignada a otra acción.
    if (!acts && code === 'KeyC') {
      latch.add('crouch');
      if (!repeat && toggleMode.crouch) toggled.crouch = !toggled.crouch;
    }
    // La tecla de consola acepta además IntlBackslash y F2 (teclados sin Backquote).
    if (!repeat && (code === 'IntlBackslash' || code === 'F2') && !(acts && acts.includes('console'))) {
      hooks.onConsole();
    }
  }

  // ───────── teclado ─────────
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!active || isTextTarget(e.target)) return;
    hooks.onDevice();
    if (BLOCKED.has(e.code)) e.preventDefault();
    // Con el ratón capturado, Ctrl+tecla de juego no debe llegar al navegador (Ctrl+W no es cancelable).
    if (e.ctrlKey && locked && !e.code.startsWith('Control')) e.preventDefault();
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
    hooks.onDevice();
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
    if (e.movementX || e.movementY) hooks.onDevice();
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
    const dy = e.deltaY || e.deltaX; // con Alt algunos sistemas mueven el delta al eje X
    if (e.altKey) {
      // Alt + rueda: zoom de cámara.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
      input.camDist = clamp(input.camDist + dy * unit * 0.003, CAM_MIN, CAM_MAX);
      return;
    }
    // Rueda: cambiar de arma, un paso por gesto (antirrebote de 120 ms).
    const now = performance.now();
    if (dy !== 0 && now - lastWheelAt >= 120) {
      input.weaponCycle = dy > 0 ? 1 : -1;
      lastWheelAt = now;
    }
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
        // En pantalla completa, intenta que W/Q/S/D/A/Esc no los coma el navegador.
        try {
          const kbd = (navigator as unknown as { keyboard?: { lock?: (k: string[]) => Promise<void> } }).keyboard;
          if (document.fullscreenElement && kbd && kbd.lock) {
            kbd.lock(['KeyW', 'KeyQ', 'KeyS', 'KeyD', 'KeyA', 'Escape']).catch(() => {});
          }
        } catch { /* sin Keyboard Lock */ }
      } else {
        releaseAll();
        if (document.pointerLockElement === canvas) {
          try { document.exitPointerLock(); } catch { /* nada */ }
        }
      }
    },

    applySettings(s: Settings): void {
      bindings = { ...DEFAULT_BINDINGS, ...(s.bindings || {}) };
      toggleMode.crouch = !!s.toggleCrouch;
      toggleMode.aim = !!s.toggleAim;
      toggleMode.sprint = !!s.toggleSprint;
      if (!toggleMode.crouch) toggled.crouch = false;
      if (!toggleMode.aim) toggled.aim = false;
      if (!toggleMode.sprint) toggled.sprint = false;
      rebuild();
    },

    update(dt: number): KeyHeld {
      if (!active) {
        held.moveF = 0; held.moveR = 0; held.fire = false; held.knife = false; held.crouch = false; held.sprint = false; held.aim = false; held.ping = false; held.interactHold = false;
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
      const cAlt = !byCode.has('KeyC') && down.has('KeyC');
      held.crouch = toggleMode.crouch ? toggled.crouch : (isHeld('crouch') || latch.has('crouch') || cAlt);
      held.aim = toggleMode.aim ? toggled.aim : (isHeld('aim') || latch.has('aim'));
      held.sprint = toggleMode.sprint ? toggled.sprint : (isHeld('sprint') || latch.has('sprint'));
      // El esprint alternado se corta al pararse o al disparar/apuntar.
      if (toggleMode.sprint && toggled.sprint && ((held.moveF === 0 && held.moveR === 0) || held.fire || held.aim)) {
        toggled.sprint = false; held.sprint = false;
      }
      held.ping = isHeld('ping');
      held.interactHold = isHeld('interact');
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
