// Piezas comunes de los controles: constantes, matemáticas de ángulos y el "núcleo"
// que comparten teclado y táctil para escribir sobre el mismo PlayerInput.

import type { PlayerInput } from '../sim/types';

/** Límites de la inclinación vertical (rad). pitch > 0 mira arriba. */
export const PITCH_MIN = -0.9;
export const PITCH_MAX = 0.7;
/** Zoom de cámara (m). */
export const CAM_MIN = 2.2;
export const CAM_MAX = 7;
export const CAM_DEFAULT = 4.2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Diferencia angular más corta de `from` a `to`, en (-π, π]. Evita el salto en ±π. */
export function angleDiff(from: number, to: number): number {
  const TAU = Math.PI * 2;
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

/** ¿El foco está en un campo de texto (la consola de trucos)? Entonces no capturamos teclas. */
export function isTextTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/** Lo que teclado y táctil necesitan del módulo principal. */
export interface Core {
  /** El único PlayerInput (se muta; poll() devuelve siempre este objeto). */
  input: PlayerInput;
  /** Sensibilidad de los ajustes (1 = normal). */
  sensitivity(): number;
  /** Gira la vista: dYaw > 0 gira a la derecha; dPitch > 0 mira arriba. Aplica el límite de pitch. */
  rotate(dYaw: number, dPitch: number): void;
}
