// Tutorial guiado de la primera partida (planta 1 de campaña). Solo panel y una flecha de borde: nada 3D.
// Mientras dura, world.hold = true (el director no suelta oleadas y los presentes no detectan a nadie) hasta llegar
// al paso de disparar. Cada paso se completa al detectar la acción en el mundo, con la tecla REAL de los ajustes.

import type { Action, IWorld, Settings } from '../contracts';
import { h, icon, setCls, setStyle, setText } from './dom';
import { t } from './i18n';
import { keyLabel } from './settings';

const STORAGE_KEY = 'stracomter3.tutorial';
const NEXT_AFTER = 25;   // s sin completar el paso: se ofrece «siguiente»
const FLASH = 0.7;       // s que se muestra el ✓ al completar un paso
const FINAL_SHOW = 6;    // s que permanece el último paso

type EvKey = 'shot' | 'reload' | 'throw' | 'ability' | 'order' | 'door' | 'weapon';

interface Deps {
  getSettings: () => Settings;
  isTouch: () => boolean;
  project: (x: number, y: number, z: number) => { x: number; y: number } | null;
}

export class Tutorial {
  private el: HTMLElement;
  private r: ReturnType<Tutorial['build']>;
  private arrow: HTMLElement;
  private world: IWorld | null = null;
  active = false;
  private visible = true;
  private idx = 0;
  private stepT = 0;
  private flashT = 0;
  private startX = 0; private startY = 0;
  private lastYaw = 0; private yawAcc = 0;
  private sprintT = 0;
  private ev: Record<EvKey, boolean> = { shot: false, reload: false, throw: false, ability: false, order: false, door: false, weapon: false };
  private onKey = (e: KeyboardEvent): void => {
    if (!this.active || !this.visible || e.repeat) return;
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    // Supr = omitir, Intro = siguiente (T y N están ocupadas: usar objeto y orden)
    if (e.code === 'Delete') this.skip();
    else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && this.stepT > NEXT_AFTER) this.advance();
  };

  constructor(parent: HTMLElement, private deps: Deps, private onFinish: (how: 'done' | 'skipped') => void) {
    this.el = h('div', { class: 'tut' });
    this.arrow = h('div', { class: 'tut-arrow' }, icon('arrow'));
    parent.append(this.el, this.arrow);
    this.r = this.build();
    window.addEventListener('keydown', this.onKey);
  }

  static shouldStart(): boolean {
    try { return localStorage.getItem(STORAGE_KEY) === null; } catch { return false; }
  }
  static mark(v: 'done' | 'skipped'): void { try { localStorage.setItem(STORAGE_KEY, v); } catch { /* sin almacenamiento */ } }
  static reset(): void { try { localStorage.removeItem(STORAGE_KEY); } catch { /* sin almacenamiento */ } }

  static readonly STEPS = 13;

  private build() {
    this.el.textContent = '';
    const tag = h('span', { class: 'tag' });
    const ticks = Array.from({ length: Tutorial.STEPS }, () => h('i'));
    const prog = h('div', { class: 'tut-prog' }, ...ticks);
    const text = h('div', { class: 'tut-text' });
    const ok = h('span', { class: 'tut-ok' }, '✓');
    const next = h<HTMLButtonElement>('button', { type: 'button', class: 'tut-btn', onclick: (e: Event) => { e.stopPropagation(); (e.currentTarget as HTMLElement).blur(); this.advance(); } }, `${t('tut.next')} [${keyLabel('Enter')}]`);
    const skip = h<HTMLButtonElement>('button', { type: 'button', class: 'tut-btn', onclick: (e: Event) => { e.stopPropagation(); (e.currentTarget as HTMLElement).blur(); this.skip(); } }, `${t('tut.skip')} [${keyLabel('Delete')}]`);
    this.el.append(h('div', { class: 'tut-head' }, tag, prog), h('div', { class: 'tut-body' }, ok, text), h('div', { class: 'tut-btns' }, next, skip));
    return { tag, ticks, text, ok, next, skip };
  }

  relabel(): void { this.r = this.build(); if (this.active) this.render(); }

  setVisible(v: boolean): void {
    this.visible = v;
    setCls(this.el, 'on', this.active && v);
    if (!v) setCls(this.arrow, 'on', false);
  }

  start(world: IWorld): void {
    this.world = world;
    this.active = true;
    world.hold = true;
    this.enter(0);
    setCls(this.el, 'on', this.visible);
  }

  /** Cierra el tutorial. `how` lo marca como completado/omitido; null lo deja pendiente (p. ej. al salir al menú). */
  stop(how: 'done' | 'skipped' | null): void {
    if (this.world) this.world.hold = false;
    const was = this.active;
    this.active = false;
    this.world = null;
    setCls(this.el, 'on', false);
    setCls(this.arrow, 'on', false);
    if (how) Tutorial.mark(how);
    if (was && how) this.onFinish(how);
  }

  skip(): void { if (this.active) this.stop('skipped'); }

  private advance(): void {
    if (this.idx >= Tutorial.STEPS - 1) { this.stop('done'); return; }
    this.enter(this.idx + 1);
  }

  private enter(i: number): void {
    const w = this.world;
    this.idx = i;
    this.stepT = 0;
    this.flashT = 0;
    this.sprintT = 0;
    this.yawAcc = 0;
    for (const k of Object.keys(this.ev) as EvKey[]) this.ev[k] = false;
    if (w) {
      this.startX = w.player.x; this.startY = w.player.y;
      this.lastYaw = w.cam.yaw;
      if (i >= 5) w.hold = false; // desde el paso de disparar, el mundo vuelve a la vida
    }
    this.render();
  }

  private keys(actions: Action[], sep = ' '): string {
    const b = this.deps.getSettings().bindings;
    return actions.map((a) => keyLabel(b[a])).join(sep);
  }

  private stepText(): string {
    const touch = this.deps.isTouch();
    const btn = t('tut.btn');
    const k = (a: Action[], sep?: string): string => (touch ? btn : this.keys(a, sep));
    const w = this.world;
    switch (this.idx) {
      case 0: return touch ? t('tut.t1') : t('tut.s1', { key: this.keys(['forward', 'left', 'back', 'right']) });
      case 1: return touch ? t('tut.t2') : t('tut.s2');
      case 2: return t('tut.s3', { key: k(['sprint']) });
      case 3: return t('tut.s4', { key: k(['crouch']) });
      case 4: return t('tut.s5', { key: k(['aim']) });
      case 5: return t('tut.s6', { key: k(['fire']) });
      case 6: return t('tut.s7', { key: k(['reload']) });
      case 7: return touch ? t('tut.tw') : t('tut.sw', { k2: this.keys(['slot2']), k1: this.keys(['slot1']), kq: this.keys(['lastWeapon']) });
      case 8: return t('tut.s8', { key: k(['grenade']), slot: touch ? btn : this.keys(['slot4']) });
      case 9: return t('tut.s9', { key: k(['ability']), ability: w ? t('ability.' + w.player.kind) : '' });
      case 10: return t('tut.s10', { key: k(['orderFollow', 'orderGoto', 'orderFocus', 'orderHold'], ' / ') });
      case 11: return t('tut.s11', { key: k(['interact']) });
      default: return t('tut.s12');
    }
  }

  private render(): void {
    const r = this.r;
    setText(r.tag, `// ${t('tut.title')} ${String(this.idx + 1).padStart(2, '0')}/${Tutorial.STEPS}`);
    r.ticks.forEach((tk, i) => { setCls(tk, 'done', i < this.idx); setCls(tk, 'cur', i === this.idx); });
    setText(r.text, this.stepText());
    setCls(r.ok, 'on', false);
  }

  private isDone(w: IWorld): boolean {
    const p = w.player;
    switch (this.idx) {
      case 0: return Math.hypot(p.x - this.startX, p.y - this.startY) > 3;
      case 1: return this.yawAcc > (60 * Math.PI) / 180;
      case 2: return this.sprintT >= 1;
      case 3: return !!p.crouch;
      case 4: return !!p.aiming;
      case 5: return this.ev.shot;
      case 6: return this.ev.reload;
      case 7: return this.ev.weapon;
      case 8: return this.ev.throw;
      case 9: return this.ev.ability;
      case 10: return this.ev.order;
      case 11: return this.ev.door;
      default: return false;
    }
  }

  /** Recoge los sucesos del paso de simulación (llamar tras cada world.step). */
  onEvents(world: IWorld): void {
    if (!this.active) return;
    const p = world.player;
    for (const e of world.events) {
      switch (e.type) {
        case 'shot': if (e.id === p.id) this.ev.shot = true; break;
        case 'reload': if (e.id === p.id) this.ev.reload = true; break;
        case 'weaponSwitch': if (e.id === p.id) this.ev.weapon = true; break;
        case 'throw': if (e.id === p.id && e.kind === 'grenade') this.ev.throw = true; break;
        case 'ability': if (e.id === p.id) this.ev.ability = true; break;
        case 'order': this.ev.order = true; break;
        case 'door': if (e.open && Math.hypot(e.x - p.x, e.y - p.y) < 8) this.ev.door = true; break;
        default: break;
      }
    }
  }

  /** Una vez por frame de juego (dt real). */
  update(world: IWorld, dt: number): void {
    if (!this.active) return;
    const p = world.player;
    this.stepT += dt;
    const last = this.idx === Tutorial.STEPS - 1;

    // Giro acumulado de la cámara
    let dy = world.cam.yaw - this.lastYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yawAcc += Math.abs(dy);
    this.lastYaw = world.cam.yaw;
    if (p.sprinting) this.sprintT += dt;

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.advance();
    } else if (last) {
      if (this.stepT > FINAL_SHOW) { this.stop('done'); return; }
    } else if (this.isDone(world)) {
      this.flashT = FLASH;
      setCls(this.r.ok, 'on', true);
    }

    setCls(this.r.next, 'on', this.stepT > NEXT_AFTER && !last);
    this.updateArrow(world);
  }

  /** Paso de la puerta: flecha de borde de pantalla hacia la puerta cercana (o marcador si ya se ve). */
  private updateArrow(world: IWorld): void {
    if (this.idx !== 11) { setCls(this.arrow, 'on', false); return; }
    const p = world.player;
    let best: { cx: number; cy: number } | null = null;
    let bd = Infinity;
    for (const d of world.level.doors) {
      if (d.open) continue;
      const dist = Math.hypot(d.cx - p.x, d.cy - p.y);
      if (dist < bd) { bd = dist; best = d; }
    }
    if (!best) { setCls(this.arrow, 'on', false); return; }
    const W = window.innerWidth, H = window.innerHeight;
    const pr = this.deps.project(best.cx, best.cy, 1.4);
    let x: number, y: number, rot: number;
    const m = 48;
    if (pr && pr.x > m && pr.x < W - m && pr.y > m && pr.y < H - m) {
      x = pr.x; y = pr.y - 36; rot = 90; // marcador sobre la puerta, apuntando hacia abajo
    } else {
      const rel = Math.atan2(best.cy - p.y, best.cx - p.x) - world.cam.yaw; // >0 = a la derecha
      const sx = Math.sin(rel), sy = -Math.cos(rel);
      const k = Math.min((W / 2 - m) / (Math.abs(sx) || 1e-6), (H / 2 - m) / (Math.abs(sy) || 1e-6));
      x = W / 2 + sx * k; y = H / 2 + sy * k;
      rot = (Math.atan2(sy, sx) * 180) / Math.PI;
    }
    setCls(this.arrow, 'on', this.visible);
    setStyle(this.arrow, 'transform', `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%) rotate(${Math.round(rot)}deg)`);
  }
}
