// Ajustes del jugador: valores por defecto, carga y guardado en localStorage (clave stracomter3.settings).

import type { Action, Difficulty, Settings } from '../contracts';
import { t } from './i18n';

export const SETTINGS_KEY = 'stracomter3.settings';
/** Versión del esquema de atajos: la 2 es el estilo Counter-Strike (incompatible con la 1); la 3 solo añade roll y ping. */
export const BINDINGS_VERSION = 3;
let bindingsNotice = false;
/** true una sola vez si los atajos guardados eran de una versión anterior y se han sustituido por los nuevos. */
export function takeBindingsNotice(): boolean { const v = bindingsNotice; bindingsNotice = false; return v; }

/** Orden en que se listan las acciones en la pantalla de remapeo. */
export const ACTIONS: Action[] = [
  'forward', 'back', 'left', 'right', 'fire', 'aim', 'sprint', 'crouch', 'reload',
  'slot1', 'slot2', 'slot3', 'slot4', 'lastWeapon', 'roll', 'ping', 'knife', 'grenade', 'ability',
  'interact', 'useItem', 'cycleItem', 'orderFollow', 'orderGoto', 'orderFocus',
  'orderHold', 'pause', 'console',
];

export function defaultBindings(): Record<Action, string> {
  return {
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
    fire: 'Mouse0', aim: 'Mouse2', sprint: 'ShiftLeft', knife: 'KeyV', reload: 'KeyR', grenade: 'KeyG', ability: 'KeyF',
    interact: 'KeyE', useItem: 'KeyT', cycleItem: 'Tab', crouch: 'ControlLeft',
    roll: 'Space', ping: 'Mouse1',
    slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4', lastWeapon: 'KeyQ',
    orderFollow: 'KeyZ', orderGoto: 'KeyX', orderFocus: 'KeyB', orderHold: 'KeyN',
    pause: 'Escape', console: 'Backquote',
  };
}

export function defaultSettings(): Settings {
  return {
    lang: 'es',
    musicVol: 0.6,
    sfxVol: 0.8,
    difficulty: 'normal',
    sensitivity: 1,
    bindings: defaultBindings(),
    subtitles: false,
    uiScale: 1,
    colorblind: false,
    cameraShake: true,
    graphics: 'auto',
  };
}

function clamp(v: unknown, lo: number, hi: number, def: number): number {
  return typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
}

/** Carga los ajustes guardados, validando cada campo. Lo que falte o esté mal toma el valor por defecto. */
export function loadSettings(): Settings {
  const s = defaultSettings();
  let raw: unknown = null;
  try {
    const txt = localStorage.getItem(SETTINGS_KEY);
    if (txt) raw = JSON.parse(txt);
  } catch { /* almacenamiento no disponible o JSON roto: se usan los valores por defecto */ }
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  // El idioma solo cambia a inglés si el ajuste guardado lo dice; no se mira navigator.language.
  s.lang = r.lang === 'en' ? 'en' : 'es';
  s.musicVol = clamp(r.musicVol, 0, 1, s.musicVol);
  s.sfxVol = clamp(r.sfxVol, 0, 1, s.sfxVol);
  s.sensitivity = clamp(r.sensitivity, 0.2, 3, s.sensitivity);
  s.uiScale = clamp(r.uiScale, 0.8, 1.4, s.uiScale);
  const d = r.difficulty;
  if (d === 'easy' || d === 'normal' || d === 'hard') s.difficulty = d as Difficulty;
  if (typeof r.subtitles === 'boolean') s.subtitles = r.subtitles;
  if (typeof r.colorblind === 'boolean') s.colorblind = r.colorblind;
  if (typeof r.cameraShake === 'boolean') s.cameraShake = r.cameraShake;
  s.vibration = r.vibration !== false;
  s.reduceFlashes = r.reduceFlashes === true;
  const g = r.graphics;
  s.graphics = g === 'high' || g === 'medium' || g === 'low' ? g : 'auto'; // ajustes antiguos sin el campo: 'auto'
  if (r.bindingsVersion !== BINDINGS_VERSION && r.bindingsVersion !== 2) {
    // Atajos de una versión anterior a la 2: son incompatibles (1/2/3 eran órdenes, Q usar objeto…). Se usan los nuevos por defecto.
    bindingsNotice = true;
  } else if (r.bindings && typeof r.bindings === 'object') {
    const b = r.bindings as Record<string, unknown>;
    for (const a of ACTIONS) {
      if (typeof b[a] === 'string' && (b[a] as string).length > 0) s.bindings[a] = b[a] as string;
    }
    // De la v2 a la v3 solo se añaden roll y ping: si su tecla por defecto ya la usa otra acción, quedan sin asignar
    if (r.bindingsVersion === 2) {
      for (const a of ['roll', 'ping'] as const) {
        const code = defaultBindings()[a];
        const taken = ACTIONS.some((o) => o !== a && s.bindings[o] === code);
        s.bindings[a] = taken ? '' : code;
      }
    }
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...s, bindingsVersion: BINDINGS_VERSION })); } catch { /* sin almacenamiento */ }
}

/** Texto legible de una tecla (KeyboardEvent.code) o botón de ratón. */
export function keyLabel(code: string): string {
  if (!code) return t('key.none');
  if (code === 'Mouse0') return t('key.mouse0');
  if (code === 'Mouse1') return t('key.mouse1');
  if (code === 'Mouse2') return t('key.mouse2');
  if (code === 'Space') return t('key.space');
  if (code === 'Mouse1') return t('key.mouse1');
  if (code === 'ShiftLeft' || code === 'ShiftRight') return t('key.shift');
  if (code === 'Delete') return t('key.delete');
  if (code === 'Enter' || code === 'NumpadEnter') return t('key.enter');
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const names: Record<string, string> = {
    Escape: 'Esc', Backquote: '`', IntlBackslash: '<', Minus: '-', Equal: '=', Backslash: '\\',
    BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
    AltLeft: 'Alt', AltRight: 'Alt', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'CapsLock',
  };
  return names[code] ?? code;
}

// ───────────── Ayudas de tecla según el dispositivo en uso (teclado o mando) ─────────────

type Device = 'keyboard' | 'touch' | 'gamepad';
let deviceFn: () => Device = () => 'keyboard';
/** La app indica de dónde leer el último dispositivo usado (controls.lastDevice, si existe). */
export function setDeviceProvider(fn: () => Device): void { deviceFn = fn; }
export function currentDevice(): Device { try { return deviceFn(); } catch { return 'keyboard'; } }

/** Glifo simple del botón del mando que dispara cada acción (mapeo estándar de src/input/gamepad.ts). */
const PAD: Partial<Record<Action, string>> = {
  fire: 'RT', aim: 'LT', sprint: 'L3', crouch: 'Ⓑ', knife: 'R3', roll: 'Ⓐ', lastWeapon: 'Ⓨ', grenade: 'RB', ability: 'LB',
  ping: '✚↑', useItem: '✚↓', cycleItem: 'Back', pause: 'Start', reload: 'Ⓧ', interact: 'Ⓧ',
  slot1: '✚← →', slot2: '✚← →', slot3: '✚← →', slot4: '✚← →',
};

/** Etiqueta de la tecla de una acción; con mando, el glifo del botón. */
export function actionLabel(a: Action, bindings: Record<Action, string>): string {
  if (currentDevice() === 'gamepad' && PAD[a]) return PAD[a] as string;
  return keyLabel(bindings[a]);
}
