// Mensajes de radio de «Mando»: panel pequeño que escribe el texto letra a letra y dura unos 5 s.
// Reglas: máximo un mensaje cada 12 s, cola de 2, nunca durante el tutorial (lo decide quien llama con `allowed`).

import { h, icon, setCls, setText } from './dom';
import { t } from './i18n';

const GAP_MS = 12000;     // entre mensajes
const TYPE_MS = 24;       // por letra
const HOLD_MS = 5000;     // visible en total
const QUEUE_MAX = 2;

export class Radio {
  private el: HTMLElement;
  private txt: HTMLElement;
  private queue: string[] = [];
  private cur: { text: string; start: number } | null = null;
  private lastEnd = -1e9;
  private visible = true;

  constructor(parent: HTMLElement) {
    this.txt = h('div', { class: 'rd-t' });
    this.el = h('div', { class: 'radio' },
      h('div', { class: 'rd-h' }, icon('bolt'), h('span', null, t('radio.name'))), this.txt);
    parent.appendChild(this.el);
  }

  relabel(): void { (this.el.querySelector('.rd-h span') as HTMLElement).textContent = t('radio.name'); }

  setVisible(v: boolean): void { this.visible = v; if (!v) setCls(this.el, 'on', false); }

  /** Encola un mensaje (`urgent` lo pone el primero). Se descarta si la cola está llena. */
  say(text: string, urgent = false): void {
    if (urgent) this.queue.unshift(text); else this.queue.push(text);
    while (this.queue.length > QUEUE_MAX) this.queue.pop();
  }

  clear(): void {
    this.queue = [];
    this.cur = null;
    this.lastEnd = -1e9;
    setCls(this.el, 'on', false);
  }

  /** Una vez por frame con el reloj real (ms). */
  update(nowMs: number): void {
    if (this.cur && nowMs - this.cur.start > HOLD_MS) { this.cur = null; this.lastEnd = nowMs; }
    if (!this.cur && this.queue.length > 0 && nowMs - this.lastEnd >= GAP_MS) {
      this.cur = { text: this.queue.shift()!, start: nowMs };
    }
    if (!this.cur || !this.visible) { setCls(this.el, 'on', false); return; }
    const n = Math.min(this.cur.text.length, Math.floor((nowMs - this.cur.start) / TYPE_MS));
    setText(this.txt, this.cur.text.slice(0, n));
    setCls(this.el, 'on', true);
  }
}
