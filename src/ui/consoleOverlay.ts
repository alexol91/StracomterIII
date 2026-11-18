// Superposición de la consola de trucos: historial, campo de texto, flecha arriba para recuperar órdenes.

import { button, h } from './dom';
import { t } from './i18n';

export class ConsoleOverlay {
  private el: HTMLElement;
  private log!: HTMLElement;
  private input!: HTMLInputElement;
  private head!: HTMLElement;
  private history: string[] = [];
  private histPos = -1;
  private lines: { text: string; cls: string }[] = [];
  isOpen = false;

  constructor(
    parent: HTMLElement,
    private run: (line: string) => string[],
    private onClose: () => void,
  ) {
    this.el = h('div', { id: 'console' });
    parent.appendChild(this.el);
    this.build();
    this.say(t('con.hint'), '');
  }

  /** Reconstruye los textos (cambio de idioma) conservando el historial. */
  relabel(): void {
    const v = this.input.value;
    this.build();
    this.input.value = v;
    for (const l of this.lines) this.appendLine(l.text, l.cls);
  }

  private build(): void {
    this.el.textContent = '';
    this.log = h('div', { class: 'con-log' });
    this.input = h<HTMLInputElement>('input', {
      type: 'text', placeholder: t('con.placeholder'),
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': t('con.title'),
      onkeydown: (e: KeyboardEvent) => this.onKey(e),
    });
    this.head = h('div', { class: 'con-head' }, h('b', null, t('con.title')), h('span', null, t('con.hint')),
      button(t('con.close'), () => this.onClose(), 'small', 'back'));
    this.el.append(
      this.head, this.log,
      h('div', { class: 'con-in' }, h('span', null, '>'), this.input),
    );
  }

  private onKey(e: KeyboardEvent): void {
    // Lo que se teclea aquí no debe llegar a los controles del juego
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      this.submit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.history.length === 0) return;
      this.histPos = this.histPos < 0 ? this.history.length - 1 : Math.max(0, this.histPos - 1);
      this.input.value = this.history[this.histPos];
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.histPos < 0) return;
      this.histPos++;
      if (this.histPos >= this.history.length) { this.histPos = -1; this.input.value = ''; }
      else this.input.value = this.history[this.histPos];
    }
  }

  private submit(): void {
    const line = this.input.value.trim();
    this.input.value = '';
    this.histPos = -1;
    if (!line) return;
    if (this.history[this.history.length - 1] !== line) this.history.push(line);
    this.say('> ' + line, 'echo');
    let out: string[];
    try { out = this.run(line); }
    catch (err) { out = [t('con.err', { msg: err instanceof Error ? err.message : String(err) })]; }
    for (const l of out) this.say(l, '');
  }

  private appendLine(text: string, cls: string): void {
    this.log.appendChild(h('div', { class: cls }, text));
    this.log.scrollTop = this.log.scrollHeight;
  }

  /** Escribe una línea en el historial. */
  say(text: string, cls = ''): void {
    this.lines.push({ text, cls });
    if (this.lines.length > 300) this.lines.shift();
    this.appendLine(text, cls);
  }

  open(): void {
    this.isOpen = true;
    this.el.classList.add('on');
    // El foco se pide en el siguiente turno: si se abre con la tecla de consola, que su carácter no se escriba
    window.setTimeout(() => { if (this.isOpen) this.input.focus(); }, 0);
  }

  close(): void {
    this.isOpen = false;
    this.el.classList.remove('on');
    this.input.blur();
  }
}
