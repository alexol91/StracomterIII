// Ajustes del jugador: valores por defecto, carga y guardado en localStorage (clave stracomter3.settings).

import type { Action, Difficulty, Settings } from '../contracts';
import { t } from './i18n';

export const SETTINGS_KEY = 'stracomter3.settings';

/** Orden en que se listan las acciones en la pantalla de remapeo. */
export const ACTIONS: Action[] = [
  'forward', 'back', 'left', 'right', 'fire', 'knife', 'reload', 'grenade', 'ability',
  'interact', 'useItem', 'cycleItem', 'crouch', 'orderFollow', 'orderGoto', 'orderFocus',
  'orderHold', 'pause', 'console',
];

export function defaultBindings(): Record<Action, string> {
  return {
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
    fire: 'Mouse0', knife: 'Mouse2', reload: 'KeyR', grenade: 'Space', ability: 'KeyF',
    interact: 'KeyE', useItem: 'KeyQ', cycleItem: 'Tab', crouch: 'KeyC',
    orderFollow: 'KeyV', orderGoto: 'Digit1', orderFocus: 'Digit2', orderHold: 'Digit3',
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
  const g = r.graphics;
  s.graphics = g === 'high' || g === 'medium' || g === 'low' ? g : 'auto'; // ajustes antiguos sin el campo: 'auto'
  if (r.bindings && typeof r.bindings === 'object') {
    const b = r.bindings as Record<string, unknown>;
    for (const a of ACTIONS) {
      if (typeof b[a] === 'string' && (b[a] as string).length > 0) s.bindings[a] = b[a] as string;
    }
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* sin almacenamiento */ }
}

/** Texto legible de una tecla (KeyboardEvent.code) o botón de ratón. */
export function keyLabel(code: string): string {
  if (!code) return t('key.none');
  if (code === 'Mouse0') return t('key.mouse0');
  if (code === 'Mouse1') return t('key.mouse1');
  if (code === 'Mouse2') return t('key.mouse2');
  if (code === 'Space') return t('key.space');
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
