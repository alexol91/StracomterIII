// Utilidades mínimas para construir DOM sin librerías.

import type { IAudio } from '../contracts';
import type { ItemType } from '../sim/types';

type UiSound = Parameters<IAudio['ui']>[0];

let audioRef: IAudio | null = null;
export function setUiAudio(a: IAudio): void { audioRef = a; }
export function uiSound(s: UiSound): void {
  try { audioRef?.ui(s); } catch { /* un fallo de audio nunca debe romper la interfaz */ }
}

/** Banderas compartidas entre pantallas y la app. */
export const flags = {
  /** true mientras se espera una tecla nueva en el remapeo: la app no debe interpretar atajos. */
  capturing: false,
};

export type Child = Node | string | number | null | undefined | false;
export type Props = Record<string, unknown> | null | undefined;

export function append(el: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

/** Crea un elemento. Las props que empiezan por «on» son listeners; «class» fija className. */
export function h<T extends HTMLElement = HTMLElement>(tag: string, props?: Props, ...children: Child[]): T {
  const el = document.createElement(tag) as T;
  let value: unknown;
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'value') value = v;
      else if (k === 'disabled' || k === 'checked') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  // «value» va al final: en un input range hay que fijar antes min/max/step.
  if (value !== undefined) (el as unknown as { value: string }).value = String(value);
  return el;
}

/** Botón grande de interfaz. Suena al pulsarlo y suelta el foco (para que Espacio no lo vuelva a pulsar en juego). */
export function button(label: string, onClick: () => void, cls = '', sound: UiSound = 'click'): HTMLButtonElement {
  return h<HTMLButtonElement>('button', {
    class: ('btn ' + cls).trim(),
    type: 'button', 'data-nav': true,
    onclick: (e: Event) => {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).blur();
      uiSound(sound);
      onClick();
    },
  }, label);
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** «♥50» para un botiquín, «●20» para munición. */
export function itemShort(it: ItemType): string {
  const idx = it.indexOf('_');
  const kind = it.slice(0, idx);
  const n = it.slice(idx + 1);
  return (kind === 'vida' ? '♥' : '●') + n;
}

export function itemClass(it: ItemType): string {
  return it.startsWith('vida') ? 'it-hp' : 'it-ammo';
}

// ───── Escritura en el DOM solo cuando cambia el valor (el HUD se actualiza cada frame) ─────

const textCache = new WeakMap<HTMLElement, string>();
export function setText(el: HTMLElement, s: string): void {
  if (textCache.get(el) !== s) { el.textContent = s; textCache.set(el, s); }
}

const styleCache = new WeakMap<HTMLElement, Record<string, string>>();
export function setStyle(el: HTMLElement, prop: string, v: string): void {
  let c = styleCache.get(el);
  if (!c) { c = {}; styleCache.set(el, c); }
  if (c[prop] !== v) { c[prop] = v; el.style.setProperty(prop, v); }
}

const clsCache = new WeakMap<HTMLElement, Record<string, boolean>>();
export function setCls(el: HTMLElement, cls: string, on: boolean): void {
  let c = clsCache.get(el);
  if (!c) { c = {}; clsCache.set(el, c); }
  if (c[cls] !== on) { c[cls] = on; el.classList.toggle(cls, on); }
}

/** Barra de progreso: devuelve el contenedor y el relleno. */
export function bar(cls = ''): { el: HTMLElement; fill: HTMLElement } {
  const fill = h('i');
  const el = h('div', { class: ('bar ' + cls).trim() }, fill);
  return { el, fill };
}

export function setBar(b: { fill: HTMLElement }, frac: number): void {
  const f = Math.max(0, Math.min(1, isFinite(frac) ? frac : 0));
  setStyle(b.fill, 'width', (Math.round(f * 1000) / 10) + '%');
}

// ───────────── Recursos estáticos e iconos ─────────────

/** Ruta a un fichero de public/ relativa a la página (la base de Vite es './'). */
export function asset(path: string): string { return './' + path.replace(/^\/+/, ''); }

const ICONS: Record<string, string> = {
  med: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  ammo: '<path d="M7 3h3.5v13H7zM13.5 7H17v9h-3.5zM5 18h14v3H5z"/>',
  warn: '<path fill-rule="evenodd" d="M12 3l10 18H2zM11 10v5h2v-5zM11 16.5v2h2v-2z"/>',
  grenade: '<circle cx="12" cy="14.5" r="6.5"/><path d="M10 2h5v3h-5z"/>',
  kia: '<path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="3" fill="none"/>',
  door: '<path fill-rule="evenodd" d="M6 3h12v18H6zM14 11v2h2v-2z"/>',
  target: '<path fill-rule="evenodd" d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 4a6 6 0 110 12 6 6 0 010-12zm0 4a2 2 0 100 4 2 2 0 000-4z"/>',
  star: '<path d="M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7.1L12 17.6 5.7 21.3l1.7-7.1L2 9.5l7.1-.6z"/>',
};

/** Icono SVG en línea (hereda el color del texto). */
export function icon(name: keyof typeof ICONS | string, cls = ''): HTMLElement {
  const el = document.createElement('span');
  el.className = ('ico ' + cls).trim();
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor">${ICONS[name] ?? ''}</svg>`;
  return el;
}

/** Icono según el tipo de objeto (botiquín / munición). */
export function itemIcon(it: ItemType): HTMLElement {
  return icon(it.startsWith('vida') ? 'med' : 'ammo');
}

/** Número con cero a la izquierda: 3 → «03». */
export function pad2(n: number): string { return String(Math.max(0, Math.floor(n))).padStart(2, '0'); }

/** Mueve el foco entre los elementos [data-nav] del contenedor (flechas del teclado). */
export function stepNav(root: ParentNode, dir: 1 | -1): void {
  const items = Array.from(root.querySelectorAll<HTMLElement>('[data-nav]:not([disabled])'))
    .filter((e) => e.offsetParent !== null);
  if (items.length === 0) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = i < 0 ? (dir > 0 ? 0 : items.length - 1) : (i + dir + items.length) % items.length;
  items[next].focus({ preventScroll: false });
}
