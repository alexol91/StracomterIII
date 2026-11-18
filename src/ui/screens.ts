// Pantallas de menú (HTML/CSS superpuesto): Título, Elección de clase, Estrategia, Pausa, Informe de misión,
// Derrota, Victoria, Créditos y Opciones. No saben nada del flujo de la aplicación: reciben callbacks.
// Navegables con teclado (flechas + Enter, Esc para volver; lo gestiona main con stepNav/goBack) y con el dedo.

import type { Action, CampaignState, Difficulty, RecordEntry, Settings, ShopItem, ZoneInfo, ZoneSummary } from '../contracts';
import type { ClassId, ItemType } from '../sim/types';
import { CLASS_IDS } from '../sim/types';
import { CLASS_STATS } from '../sim/data';
import { asset, button, fmtTime, flags, h, icon, itemIcon, pad2, uiSound } from './dom';
import { t, getLang } from './i18n';
import { drawMiniMap } from './minimap';
import { ACTIONS, defaultBindings, keyLabel, type ExtraSettings } from './settings';
import { createSquadPreview, type SquadPreview } from '../render/preview';
import { MUTATOR_IDS, mutatorMult, upgradeInfo } from './upgrades';
import { VERSION } from './version';

/** Contenedor de pantallas: solo hay una visible a la vez. Se puede redibujar (cambio de idioma). */
export class Screens {
  private cleanups: (() => void)[] = [];
  private build: ((s: Screens) => HTMLElement) | null = null;
  private backFn: (() => void) | null = null;
  private shown: (() => void)[] = [];

  constructor(private layer: HTMLElement) {}

  show(build: (s: Screens) => HTMLElement): void {
    this.clear();
    this.build = build;
    const el = build(this);
    this.layer.appendChild(el);
    // Foco inicial: la primera opción marcada, para poder navegar con teclado desde el primer momento
    const af = el.querySelector<HTMLElement>('[data-autofocus]');
    if (af) af.focus({ preventScroll: true });
    const sh = this.shown;
    this.shown = [];
    for (const f of sh) { try { f(); } catch (e) { console.error(e); } }
  }

  /** Código que necesita la pantalla YA en el DOM (medidas, lienzos 3D). */
  onShown(fn: () => void): void { this.shown.push(fn); }

  /** Registra algo que limpiar cuando la pantalla se cierre o se redibuje. */
  onClear(fn: () => void): void { this.cleanups.push(fn); }

  /** Acción de Esc en la pantalla actual (volver). */
  setBack(fn: (() => void) | null): void { this.backFn = fn; }
  goBack(): boolean {
    if (!this.backFn) return false;
    uiSound('back');
    this.backFn();
    return true;
  }

  clear(): void {
    const c = this.cleanups;
    this.cleanups = [];
    this.shown = [];
    for (const f of c) { try { f(); } catch { /* ignorar */ } }
    this.layer.textContent = '';
    this.build = null;
    this.backFn = null;
  }

  get visible(): boolean { return this.build !== null; }
  get root(): HTMLElement { return this.layer; }

  /** Redibuja la pantalla actual conservando el desplazamiento y el foco aproximado. */
  refresh(): void {
    const b = this.build;
    if (!b) return;
    const sc = this.layer.querySelector<HTMLElement>('.scroll');
    const top = sc ? sc.scrollTop : 0;
    this.show(b);
    const now = this.layer.querySelector<HTMLElement>('.scroll');
    if (now) now.scrollTop = top;
  }
}

// ───────────────────────────── Piezas comunes ─────────────────────────────

/** Pantalla con fondo: `.screen.<bg>` > `.scroll` (que es el que se desplaza). */
function scr(bg: string, ...kids: (HTMLElement | null | false)[]): HTMLElement {
  return h('div', { class: 'screen ' + bg }, h('div', { class: 'scroll' }, ...kids));
}

interface MenuItemOpts { danger?: boolean; disabled?: boolean; autofocus?: boolean; sound?: 'click' | 'confirm' | 'back' }

/** Opción de menú: texto condensado, barra en paralelogramo y cuña ámbar al estar activa (foco/ratón). */
function menuItem(label: string, onClick: () => void, i: number, o: MenuItemOpts = {}): HTMLButtonElement {
  const b = h<HTMLButtonElement>('button', {
    class: 'mi on-focus' + (o.danger ? ' danger' : '') + (o.autofocus ? ' active' : ''), type: 'button', 'data-nav': true,
    'data-autofocus': o.autofocus ? true : null, disabled: o.disabled,
    style: `--i:${i}`,
    onfocus: (e: Event) => {
      // Solo una opción «activa» a la vez: la marca inicial se quita en cuanto el foco pasa a otra
      const cur = e.currentTarget as HTMLElement;
      cur.parentElement?.querySelectorAll('.mi.active').forEach((x) => { if (x !== cur) x.classList.remove('active'); });
    },
    onmouseenter: (e: Event) => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLElement).focus({ preventScroll: true }); },
    onclick: (e: Event) => { e.stopPropagation(); uiSound(o.sound ?? 'click'); onClick(); },
  }, h('span', { class: 'wedge' }), h('span', { class: 'pbar' }), h('span', { class: 'txt' }, label));
  return b;
}

function menuBlock(items: HTMLElement[]): HTMLElement {
  return h('nav', { class: 'menu tech', role: 'menu' }, ...items);
}

/** Botón-cuña pequeño (DESPLEGAR/ENTRAR) dentro de una tarjeta. */
function deployLabel(label: string): HTMLElement {
  return h('span', { class: 'deploy' }, h('span', { class: 'wedge' }), h('span', { class: 'pbar' }), h('span', { class: 'txt' }, label));
}

const PORTRAIT: Record<ClassId, string> = {
  captain: 'ui/retrato-Military_Male_01.png',
  technic: 'ui/retrato-Military_Male_05.png',
  especialist: 'ui/retrato-Military_Male_04.png',
  explosives: 'ui/retrato-Military_Male_03.png',
};
const CLS: Record<ClassId, string> = {
  captain: 'cls-captain', technic: 'cls-technic', especialist: 'cls-especialist', explosives: 'cls-explosives',
};

function fmtNum(n: number): string {
  const s = (Math.round(n * 100) / 100).toString();
  return getLang() === 'es' ? s.replace('.', ',') : s;
}

// ───────────────────────────── Título ─────────────────────────────

export interface TitleParams {
  hasSave: boolean;
  onNew(): void; onContinue(): void; onQuick(): void; onOptions(): void; onCredits(): void; onRecords(): void; onHorde(): void;
  onLang(l: 'es' | 'en'): void;
}

export function langSelector(onLang: (l: 'es' | 'en') => void): HTMLElement {
  const cur = getLang();
  const mk = (l: 'es' | 'en', label: string): HTMLButtonElement => h<HTMLButtonElement>('button', {
    type: 'button', class: l === cur ? 'on' : '', 'aria-label': l === 'es' ? 'Español' : 'English',
    onclick: (e: Event) => { e.stopPropagation(); (e.currentTarget as HTMLElement).blur(); uiSound('click'); onLang(l); },
  }, label);
  return h('div', { class: 'lang-sel' }, mk('es', 'ES'), mk('en', 'EN'));
}

export function titleScreen(p: TitleParams): HTMLElement {
  const items: HTMLElement[] = [];
  let i = 0;
  items.push(menuItem(t('menu.newCampaign'), p.onNew, i++, { autofocus: true, sound: 'confirm' }));
  if (p.hasSave) items.push(menuItem(t('menu.continue'), p.onContinue, i++, { sound: 'confirm' }));
  items.push(menuItem(t('menu.quick'), p.onQuick, i++));
  items.push(menuItem(t('menu.horde'), p.onHorde, i++));
  items.push(menuItem(t('menu.records'), p.onRecords, i++));
  items.push(menuItem(t('menu.options'), p.onOptions, i++));
  items.push(menuItem(t('menu.credits'), p.onCredits, i++));
  return scr('bg-tower',
    h('header', null,
      h('h1', { class: 'head-font t-logo' }, t('title.name')),
      h('div', { class: 'rule' }),
      h('p', { class: 't-sub' }, t('title.sub')),
    ),
    h('div', { class: 't-menu' }, menuBlock(items)),
    h('div', { class: 't-foot' },
      h('span', null, `${t('menu.foot')} · v${VERSION}`),
      h('span', { class: 'nav-hint' }, t('nav.hint')),
      langSelector(p.onLang),
    ),
  );
}

// ───────────────────────────── Elección de clase ─────────────────────────────

export interface ClassParams {
  /** null en campaña; planta elegida en partida rápida */
  quickFloor: number | null;
  /** modo supervivencia: mejor oleada por planta y selector de dificultad */
  horde?: { best: Record<number, number>; diff: Difficulty; onDiff(d: Difficulty): void };
  onFloor(n: number): void;
  onPick(c: ClassId): void;
  onBack(): void;
}

const STAT_MAX = { hp: 160, speed: 6.7, rof: 12.5, dmg: 60 };

function statLine(label: string, frac: number, value: string): HTMLElement {
  const bar = h('div', { class: 'sb' }, h('i', { style: `width:${Math.round(Math.min(1, Math.max(0.03, frac)) * 100)}%` }));
  return h('div', { class: 'statl' }, h('span', null, label), bar, h('span', { class: 'v' }, value));
}

export function classScreen(s: Screens, p: ClassParams): HTMLElement {
  s.setBack(p.onBack);
  const slots: Partial<Record<ClassId, HTMLElement>> = {};
  const imgs: Partial<Record<ClassId, HTMLElement>> = {};
  let preview: SquadPreview | null = null;
  const cards = CLASS_IDS.map((c, i) => {
    const st = CLASS_STATS[c];
    const dmg = st.explosive ? t('stat.damageBlast', { n: st.damage }) : String(st.damage);
    const pick = (): void => { uiSound('confirm'); p.onPick(c); };
    return h('div', {
      class: 'op tech ' + CLS[c], tabindex: 0, role: 'button', 'data-nav': true, 'data-autofocus': i === 0 ? true : null,
      style: `--i:${i}`,
      onclick: pick,
      onmouseenter: (e: Event) => (e.currentTarget as HTMLElement).focus({ preventScroll: true }),
      onfocus: () => preview?.setActive(c),
      onblur: () => preview?.setActive(null),
      onkeydown: (e: KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(); } },
    },
      (slots[c] = h('div', { class: 'ph' },
        (imgs[c] = h('img', { src: asset(PORTRAIT[c]), alt: '', draggable: 'false', loading: 'eager' })),
        h('span', { class: 'tag idx' }, `// ${pad2(i + 1)}`),
        h('h3', { class: 'h-title nm' }, t('kind.' + c)),
      )),
      h('div', { class: 'info' },
        h('div', { class: 'role' }, t('role.' + c)),
        statLine(t('stat.hp'), st.hp / STAT_MAX.hp, String(st.hp)),
        statLine(t('stat.speed'), st.speed / STAT_MAX.speed, t('stat.speedValue', { n: fmtNum(st.speed) })),
        statLine(t('stat.rof'), st.rof / STAT_MAX.rof, t('stat.rofValue', { n: fmtNum(st.rof) })),
        // El daño se dibuja en escala de raíz cuadrada: con la lineal, el Explosivo (60) aplastaría a los demás
        statLine(t('stat.damage'), Math.sqrt(st.damage / STAT_MAX.dmg), dmg),
        h('div', { class: 'txtb' }, h('b', null, t('stat.trait')), t('trait.' + c)),
        h('div', { class: 'txtb' }, h('b', null, `${t('stat.ability')} · ${t('ability.' + c)}`), t('abilityDesc.' + c)),
      ),
      h('div', { class: 'foot' }, h('div', { class: 'dots', style: 'margin:0 0.7rem' }), deployLabel(p.quickFloor === null ? t('class.deploy') : t('class.pick'))),
    );
  });

  const head = h('div', { class: 'screen-head' },
    h('div', null,
      h('span', { class: 'tag' }, '// 01'),
      h('h2', { class: 'h-title' }, p.horde ? t('class.titleHorde') : p.quickFloor === null ? t('class.title') : t('class.titleQuick')),
    ),
    button(t('menu.back'), p.onBack, 'small', 'back'),
  );
  const kids: (HTMLElement | null)[] = [head];
  if (p.quickFloor !== null) {
    const floors = h('div', { class: 'floor-pick' }, h('span', { class: 'tag' }, t('quick.floor')));
    for (let n = 1; n <= 9; n++) {
      const b = h<HTMLButtonElement>('button', {
        type: 'button', class: 'fl' + (n === p.quickFloor ? ' on' : ''), title: t(`floor.${n}.name`) + (p.horde ? ` · ${t('horde.bestLabel')}: ${p.horde.best[n] ?? 0}` : ''),
        onclick: (e: Event) => { e.stopPropagation(); uiSound('click'); p.onFloor(n); },
      }, pad2(n));
      floors.appendChild(b);
    }
    kids.push(floors);
    kids.push(h('p', { class: 'hint', style: 'margin-bottom:0.6rem' }, t('strat.head', { n: pad2(p.quickFloor), name: t(`floor.${p.quickFloor}.name`) })
      + (p.horde ? ` — ${t('horde.bestLabel')}: ${p.horde.best[p.quickFloor] ?? 0}` : '')));
    if (p.horde) {
      const hd = p.horde;
      const row = h('div', { class: 'floor-pick' }, h('span', { class: 'tag' }, t('opt.difficulty')));
      for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
        row.appendChild(h('button', {
          type: 'button', class: 'fl wide' + (d === hd.diff ? ' on' : ''), 'data-nav': true,
          onclick: (e: Event) => { e.stopPropagation(); uiSound('click'); hd.onDiff(d); },
        }, t('opt.diff.' + d)));
      }
      kids.push(row);
    }
  } else {
    kids.push(h('p', { class: 'hint', style: 'margin-bottom:0.6rem' }, t('class.hint')));
  }
  kids.push(h('div', { class: 'ops' }, ...cards));
  const screen = scr('bg-blur', ...kids);

  // Operadores en 3D: solo en escritorio y sin «reducir movimiento»; si no, quedan los retratos fijos
  const mq = (q: string): boolean => typeof matchMedia === 'function' && matchMedia(q).matches;
  if (!mq('(pointer: coarse)') && !mq('(prefers-reduced-motion: reduce)')) {
    s.onShown(() => {
      const scroll = screen.querySelector<HTMLElement>('.scroll');
      if (!scroll) return;
      const canvas = h<HTMLCanvasElement>('canvas', { class: 'squad-canvas' });
      scroll.appendChild(canvas);
      try {
        preview = createSquadPreview(canvas, slots as Record<ClassId, HTMLElement>, {
          onReady: (c: ClassId) => imgs[c]?.classList.add('gone'),
        });
      } catch (err) {
        console.error(err);
        canvas.remove();
        return;
      }
      const onResize = (): void => preview?.resize();
      window.addEventListener('resize', onResize);
      requestAnimationFrame(onResize); // la maquetación definitiva llega un frame después
      const act = document.activeElement as HTMLElement | null;
      const idx = act ? cards.indexOf(act) : -1;
      if (idx >= 0) preview.setActive(CLASS_IDS[idx]);
      s.onClear(() => {
        window.removeEventListener('resize', onResize);
        preview?.dispose();
        preview = null;
        canvas.remove();
      });
    });
  }
  return screen;
}

// ───────────────────────────── Preparar campaña: modificadores y segunda vuelta ─────────────────────────────

export interface SetupParams {
  diff: Difficulty;
  onDiff(d: Difficulty): void;
  mutators: string[];
  onToggle(id: string, on: boolean): void;
  ngUnlocked: boolean;
  ng: boolean;
  onNg(on: boolean): void;
  onStart(): void;
  onBack(): void;
}

export function setupMultiplier(mutators: string[], ng: boolean): number {
  return mutators.reduce((m, id) => m * mutatorMult(id), 1) * (ng ? 1.5 : 1);
}
const fmtMult = (n: number): string => (Math.round(n * 100) / 100).toString().replace('.', getLang() === 'es' ? ',' : '.');

export function setupScreen(s: Screens, p: SetupParams): HTMLElement {
  s.setBack(p.onBack);
  const total = h('b', { class: 'su-total' });
  const paint = (): void => { total.textContent = '×' + fmtMult(setupMultiplier(p.mutators, p.ng)); };
  const mkRow = (name: string, desc: string, mult: string, get: () => boolean, set: (v: boolean) => void): HTMLElement => {
    const sw = h<HTMLButtonElement>('button', {
      type: 'button', class: 'sw', role: 'switch', 'aria-checked': String(get()), 'aria-label': name, 'data-nav': true,
      onclick: (e: Event) => {
        const b = e.currentTarget as HTMLElement;
        const v = b.getAttribute('aria-checked') !== 'true';
        b.setAttribute('aria-checked', String(v));
        uiSound('click');
        set(v);
        paint();
      },
    });
    return h('div', { class: 'opt-row' },
      h('span', { class: 'l' }, h('b', null, name), h('div', { class: 'hint' }, desc)),
      h('div', { class: 'ctl' }, h('span', { class: 'val' }, mult), sw));
  };
  const rows = MUTATOR_IDS.map((id) => mkRow(t('mut.' + id), t(`mut.${id}.desc`), t('mut.mult', { n: fmtMult(mutatorMult(id)) }),
    () => p.mutators.includes(id), (v) => p.onToggle(id, v)));
  if (p.ngUnlocked) rows.push(mkRow(t('setup.ng'), t('setup.ngDesc'), '×1,5', () => p.ng, (v) => p.onNg(v)));
  const diffRow = h('div', { class: 'floor-pick' }, h('span', { class: 'tag' }, t('opt.difficulty')));
  const dbtns: HTMLButtonElement[] = [];
  for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
    const b = h<HTMLButtonElement>('button', {
      type: 'button', class: 'fl wide' + (d === p.diff ? ' on' : ''), 'data-nav': true,
      onclick: (e: Event) => { e.stopPropagation(); uiSound('click'); p.onDiff(d); dbtns.forEach((x, i) => x.classList.toggle('on', (['easy', 'normal', 'hard'] as Difficulty[])[i] === d)); },
    }, t('opt.diff.' + d));
    dbtns.push(b);
    diffRow.appendChild(b);
  }
  paint();
  return scr('bg-blur',
    h('div', { class: 'stack', style: 'max-width:46rem' },
      h('div', { class: 'screen-head' },
        h('div', null, h('span', { class: 'tag' }, '// 02'), h('h2', { class: 'h-title' }, t('setup.title')), h('p', { class: 'hint' }, t('setup.hint'))),
        button(t('menu.back'), p.onBack, 'small', 'back')),
      diffRow,
      h('div', { class: 'options tech' },
        h('h3', { class: 'h-title opt-sec', style: 'margin-top:0' }, '// ' + t('setup.mut')),
        ...rows,
        h('div', { class: 'opt-row' }, h('span', { class: 'l' }, t('setup.total')), h('div', { class: 'ctl' }, total))),
      h('div', { class: 'btn-row', style: 'margin-top:0.8rem' },
        (() => { const b = button(t('setup.start'), p.onStart, 'primary', 'confirm'); b.setAttribute('data-nav', ''); b.setAttribute('data-autofocus', ''); return b; })()),
    ),
  );
}

// ───────────────────────────── Estrategia ─────────────────────────────

export interface StrategyParams {
  state: CampaignState;
  zones: ZoneInfo[];
  onEnter(zone: number): void;
  onControl(c: ClassId): void;
  onLoadout(c: ClassId, v: 0 | 1): void;
  /** Armería: artículos disponibles y compra (para 'medkit' se indica operador) */
  shop?: ShopItem[];
  onBuy?(id: string, target?: ClassId): void;
  onMenu(): void;
}

/** Valores de las barras del selector de armamento (daño, cadencia, alcance), 0..1. Son solo de presentación. */
const WEAPON_BARS: Record<ClassId, [[number, number, number], [number, number, number]]> = {
  captain: [[0.5, 0.55, 0.7], [0.75, 0.4, 0.8]],
  technic: [[0.35, 1, 0.4], [0.9, 0.25, 0.2]],
  especialist: [[0.3, 0.5, 0.6], [0.85, 0.2, 0.95]],
  explosives: [[1, 0.3, 0.6], [0.8, 0.35, 0.5]],
};

const OBJ_ICON: Record<string, string> = { clear: 'target', defuse: 'warn', defend: 'shield', rescue: 'cross' };

function slotChip(it: ItemType | null): HTMLElement {
  if (!it) return h('span', { class: 'slot-i empty' }, '·');
  return h('span', { class: 'slot-i', title: t('item.' + it) }, itemIcon(it), it.slice(it.indexOf('_') + 1));
}

/** Chapas pequeñas de los modificadores activos (y de la segunda vuelta). */
export function mutChips(st: { mutators?: string[]; ngPlus?: number }): HTMLElement | null {
  const names = [...(st.mutators ?? []).map((id) => t('mut.' + id)), ...((st.ngPlus ?? 0) > 0 ? [t('setup.ng')] : [])];
  if (names.length === 0) return null;
  return h('div', { class: 'mchips' }, ...names.map((n) => h('span', { class: 'mchip' }, n)));
}

type StratTab = 'zones' | 'armory' | 'loadout';
let stratTab: StratTab = 'zones';
/** planta de la última vez que se abrió Estrategia: al cambiar de planta (o de campaña) se vuelve a «Zonas» */
let stratFloor = -1;

export function strategyScreen(s: Screens, p: StrategyParams): HTMLElement {
  s.setBack(p.onMenu);
  const st = p.state;
  const floor = st.floor;
  if (floor !== stratFloor || st.score === 0) { stratTab = 'zones'; stratFloor = floor; }

  // Escuadra
  const members: Partial<Record<ClassId, HTMLElement>> = {};
  const party = h('aside', { class: 'party tech' },
    h('span', { class: 'tag' }, '// ' + t('strat.squad')),
    h('p', { class: 'hint' }, t('strat.squadHint')),
  );
  for (const c of CLASS_IDS) {
    const m = st.members[c];
    const dead = m.hp <= 0;
    const max = CLASS_STATS[c].hp;
    const frac = Math.max(0, Math.min(1, m.hp / max));
    const inv = h('div', { class: 'slots' });
    for (let i = 0; i < 5; i++) inv.appendChild(slotChip(m.inv?.[i] ?? null));
    const me = h('span', { class: 'pill', style: st.controlled === c ? '' : 'display:none' }, t('strat.controlling'));
    const el = h('button', {
      class: 'member ' + CLS[c] + (dead ? ' dead' : '') + (st.controlled === c ? ' selected' : ''),
      type: 'button', disabled: dead, 'data-nav': true,
      onclick: () => {
        if (dead) { uiSound('error'); return; }
        uiSound('click');
        p.onControl(c);
        for (const k of CLASS_IDS) {
          members[k]?.classList.toggle('selected', k === c);
          const tag = members[k]?.querySelector<HTMLElement>('.pill:not(.dead)');
          if (tag) tag.style.display = k === c ? '' : 'none';
        }
      },
    },
      h('div', { class: 'av' }, h('img', { src: asset(PORTRAIT[c]), alt: '', draggable: 'false' })),
      h('div', { class: 'row' }, h('span', { class: 'name' }, t('kind.' + c)),
        dead ? h('span', { class: 'pill dead' }, icon('kia'), t('strat.fallen')) : me),
      h('div', { class: 'row' }, h('span', null, `${Math.max(0, Math.ceil(m.hp))}/${max}`), h('span', null, `${m.ammo}`)),
      h('div', null,
        h('div', { class: 'mbar' + (frac < 0.3 ? ' low' : ''), style: 'margin-bottom:2px' }, h('i', { style: `width:${Math.round(frac * 100)}%` })),
        h('div', { class: 'mbar ammo' }, h('i', { style: `width:${Math.round(Math.min(1, m.ammo / 200) * 100)}%` })),
      ),
    );
    // Inventario bajo el resumen, a ancho completo
    el.appendChild(h('div', { style: 'grid-column:1 / -1' }, inv));
    members[c] = el;
    party.appendChild(el);
  }
  // ── Pestaña ARMERÍA: créditos, artículos con descripción, lo comprado y las mejoras que lleva la campaña ──
  const buildArmory = (): HTMLElement => {
    const pane = h('div', { class: 'pane-in tech' });
    const bought = st.bought;
    const pend = bought ? [bought.grenades ? `${bought.grenades}× ${t('shop.grenade')}` : '', bought.flashes ? `${bought.flashes}× ${t('shop.flash')}` : '', bought.smokes ? `${bought.smokes}× ${t('shop.smoke')}` : ''].filter(Boolean) : [];
    pane.appendChild(h('div', { class: 'ar-head' },
      h('span', { class: 'tag' }, '// ' + t('shop.title')),
      h('b', { class: 'ar-cr' }, `${t('shop.credits')}: ${st.credits ?? 0}`),
      pend.length ? h('span', { class: 'hint' }, `${t('shop.bought')}: ${pend.join(', ')}`) : null));
    if (p.shop && p.shop.length > 0) {
      const grid = h('div', { class: 'ar-grid' });
      const pick = h('div', { class: 'ar-pick', style: 'display:none' });
      const ICO: Record<string, string> = { ammo: 'ammo', medkit: 'med', grenade: 'grenade', flash: 'bolt', smoke: 'smoke', upgrade: 'star' };
      for (const it of p.shop) {
        const off = !it.available;
        grid.appendChild(h('button', {
          type: 'button', class: 'ar-card' + (off ? ' off' : ''), 'data-nav': true, disabled: off,
          onclick: () => {
            if (off) { uiSound('error'); return; }
            if (it.needsTarget || it.id === 'medkit') {
              uiSound('click');
              pick.textContent = '';
              pick.style.display = 'flex';
              pick.appendChild(h('span', { class: 'tag' }, t('shop.pickTarget')));
              for (const c of CLASS_IDS) {
                if (st.members[c].hp <= 0) continue;
                pick.appendChild(h('button', { type: 'button', class: 'lo-tab', 'data-nav': true, onclick: () => { p.onBuy?.(it.id, c); } }, t('kind.' + c)));
              }
            } else p.onBuy?.(it.id);
          },
        },
          h('span', { class: 'ar-ico' }, icon(ICO[it.id] ?? 'star')),
          h('span', { class: 'ar-tx' }, h('b', null, t(`shop.${it.id}`)), h('small', null, t(`shop.${it.id}.desc`))),
          h('span', { class: 'ar-p' }, t('shop.price', { n: it.price }))));
      }
      pane.appendChild(grid);
      pane.appendChild(pick);
    }
    // Mejoras que lleva la campaña
    pane.appendChild(h('span', { class: 'tag', style: 'margin-top:0.8rem;display:block' }, '// ' + t('strat.upgrades')));
    const ups = st.upgrades ?? [];
    if (ups.length === 0) pane.appendChild(h('p', { class: 'hint' }, t('strat.noUpgrades')));
    else {
      const list = h('div', { class: 'ar-ups' });
      for (const id of ups) {
        const u = upgradeInfo(id);
        list.appendChild(h('div', { class: 'ar-up' }, icon(u.icon), h('span', null, h('b', null, u.name), h('small', null, u.desc))));
      }
      pane.appendChild(list);
    }
    return pane;
  };

  // ── Pestaña ARMAMENTO: los cuatro operadores con sus dos variantes y barras ──
  const buildLoadout = (): HTMLElement => {
    const grid = h('div', { class: 'lo-grid' });
    for (const c of CLASS_IDS) {
      const dead = st.members[c].hp <= 0;
      const col = h('div', { class: 'lo-col tech ' + CLS[c] + (dead ? ' dead' : '') });
      col.appendChild(h('div', { class: 'lo-head' }, h('div', { class: 'av' }, h('img', { src: asset(PORTRAIT[c]), alt: '', draggable: 'false' })), h('b', { class: 'h-title' }, t('kind.' + c))));
      const opts: HTMLElement[] = [];
      const cur = (): 0 | 1 => (st.loadout?.[c] ?? 0) as 0 | 1;
      ([0, 1] as const).forEach((v) => {
        const bars = WEAPON_BARS[c][v];
        const btn = h('button', {
          type: 'button', class: 'lo-opt' + (cur() === v ? ' sel' : ''), 'data-nav': true, disabled: dead,
          onclick: () => {
            uiSound('confirm');
            p.onLoadout(c, v);
            if (!st.loadout) st.loadout = {};
            st.loadout[c] = v;
            opts.forEach((o, i) => o.classList.toggle('sel', i === v));
          },
        },
          h('div', { class: 'lo-n' }, t(`weapon.${c}.${v}`)),
          statLine(t('stat.damage'), bars[0], ''),
          statLine(t('stat.rof'), bars[1], ''),
          statLine(t('stat.range'), bars[2], ''));
        opts.push(btn);
        col.appendChild(btn);
      });
      grid.appendChild(col);
    }
    return grid;
  };

  // Zonas: tarjetas de «plano táctico». Un clic selecciona; ENTRAR (o Enter) despliega.
  const zones = h('div', { class: 'zones' });
  const cards: HTMLElement[] = [];
  const select = (el: HTMLElement): void => { for (const c of cards) c.classList.toggle('sel', c === el); };
  p.zones.forEach((z, i) => {
    const cv = h<HTMLCanvasElement>('canvas', { width: 640, height: 400 });
    try { drawMiniMap(cv, z.map); } catch { /* un mapa raro no debe tumbar la pantalla */ }
    const enter = (): void => { uiSound('confirm'); p.onEnter(z.zone); };
    const card = h('div', {
      class: 'zone tech' + (i === 0 ? ' sel' : ''), tabindex: 0, 'data-nav': true, role: 'button', style: `--i:${i}`,
      'data-autofocus': i === 0 ? true : null,
      onclick: (e: Event) => { uiSound('click'); select(e.currentTarget as HTMLElement); (e.currentTarget as HTMLElement).focus({ preventScroll: true }); },
      onfocus: (e: Event) => select(e.currentTarget as HTMLElement),
      onkeydown: (e: KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); enter(); } },
    },
      cv,
      h('div', { class: 'zhead' }, h('h3', { class: 'h-title' }, t('strat.zone', { n: z.zone })), h('span', { class: 'tag' }, `// ${pad2(z.zone)}`)),
      h('div', { class: 'zb' },
        h('div', { class: 'zline' }, `${t('size.' + z.size)} · ${t('strat.area', { n: Math.round(z.areaM2).toLocaleString(getLang() === 'es' ? 'es-ES' : 'en-US') })}`),
        h('div', { class: 'zline' }, z.diafano ? t('layout.diafano') : t('layout.pasillos')),
        h('div', { class: 'zline reward' }, itemIcon(z.reward), t('reward.' + z.reward)),
        z.objective ? h('div', { class: 'zline obj' }, icon(OBJ_ICON[z.objective] ?? 'target'), t('objk.' + z.objective),
          (z.objectiveBonus ?? 1) > 1 ? h('b', { class: 'obj-bonus' }, t('obj.bonus', { n: Math.round(((z.objectiveBonus ?? 1) - 1) * 100) })) : null) : null,
        z.hasMiniBoss ? h('div', { class: 'zline boss' }, icon('warn'), t('boss.mini')) : null,
        z.hasMegaBoss ? h('div', { class: 'zline boss' }, icon('warn'), t('boss.mega')) : null,
      ),
      h('button', {
        type: 'button', class: 'deploy',
        onclick: (e: Event) => { e.stopPropagation(); enter(); },
      }, h('span', { class: 'wedge' }), h('span', { class: 'pbar' }), h('span', { class: 'txt' }, t('strat.enter'))),
    );
    cards.push(card);
    zones.appendChild(card);
  });

  // ── Pestañas: ZONAS (por defecto), ARMERÍA y ARMAMENTO ──
  const tabDefs: { id: StratTab; label: string }[] = [
    { id: 'zones', label: t('strat.tab.zones') }, { id: 'armory', label: t('strat.tab.armory') }, { id: 'loadout', label: t('strat.tab.loadout') },
  ];
  const pane = h('div', { class: 'pane' });
  const tabBtns: HTMLButtonElement[] = [];
  const open = (id: StratTab): void => {
    stratTab = id;
    tabBtns.forEach((b, i) => b.classList.toggle('on', tabDefs[i].id === id));
    pane.textContent = '';
    if (id === 'zones') pane.appendChild(h('div', { class: 'strat-body' }, party, zones));
    else if (id === 'armory') pane.appendChild(buildArmory());
    else pane.appendChild(buildLoadout());
  };
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  tabDefs.forEach((d) => {
    const b = h<HTMLButtonElement>('button', {
      type: 'button', class: 'tab', role: 'tab', 'data-nav': true,
      onclick: (e: Event) => { e.stopPropagation(); uiSound('click'); open(d.id); },
    }, d.label);
    tabBtns.push(b);
    tabs.appendChild(b);
  });
  open(stratTab);
  // Q / E cambian de pestaña (con el foco fuera de campos de texto)
  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat || (e.code !== 'KeyQ' && e.code !== 'KeyE')) return;
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    const i = tabDefs.findIndex((d) => d.id === stratTab);
    const n = (i + (e.code === 'KeyE' ? 1 : -1) + tabDefs.length) % tabDefs.length;
    uiSound('click');
    open(tabDefs[n].id);
  };
  window.addEventListener('keydown', onKey);
  s.onClear(() => window.removeEventListener('keydown', onKey));

  // Informe de «Mando» compacto: una o dos líneas, con «ver más»
  const briefTxt = h('p', { class: 'bf-txt' }, t(`brief.${floor}`));
  const more = h<HTMLButtonElement>('button', {
    type: 'button', class: 'bf-more', 'data-nav': true,
    onclick: (e: Event) => { e.stopPropagation(); (e.currentTarget as HTMLElement).blur(); const ex = briefTxt.classList.toggle('open'); more.textContent = ex ? t('strat.less') : t('strat.more'); },
  }, t('strat.more'));

  return scr('bg-blur',
    h('div', { class: 'screen-head' },
      h('div', null,
        h('span', { class: 'tag' }, '// 02'),
        h('h2', { class: 'h-title' }, t('strat.head', { n: pad2(floor), name: t(`floor.${floor}.name`) })),
        h('p', { class: 'hint' }, t(`floor.${floor}.desc`)),
      ),
      h('div', { class: 'btn-row' },
        st.credits !== undefined ? h('div', { class: 'score-box' }, h('span', { class: 'tag' }, t('shop.credits')), h('div', { class: 'big cr' }, String(st.credits))) : null,
        h('div', { class: 'score-box' }, h('span', { class: 'tag' }, t('strat.score')), h('div', { class: 'big' }, String(st.score))),
        button(t('strat.menu'), p.onMenu, 'small', 'back'),
      ),
    ),
    h('div', { class: 'brief-line' },
      h('span', { class: 'bf-who' }, icon('bolt'), t('radio.name')), briefTxt, more),
    mutChips(st),
    tabs,
    pane,
  );
}

// ───────────────────────────── Informe de misión ─────────────────────────────

export interface SummaryParams {
  summary: ZoneSummary;
  /** Instante (Date.now) en que se mostró: el botón se habilita 2 s después y no se reinicia al redibujar */
  shownAt: number;
  /** true si hubo trucos en esta zona o en la campaña */
  cheated?: boolean;
  onContinue(): void;
}

export const SUMMARY_LOCK_MS = 2000;

export function summaryScreen(s: Screens, p: SummaryParams): HTMLElement {
  const sm = p.summary, st = sm.stats;
  const acc = st.shotsFired > 0 ? Math.round((st.shotsHit / st.shotsFired) * 100) + ' %' : '—';
  const fallen = sm.fallen.length ? sm.fallen.map((c) => t('kind.' + c)).join(', ') : t('sum.none');
  const rewardTo = sm.rewarded.length
    ? t('sum.rewardTo', { names: sm.rewarded.map((c) => t('kind.' + c)).join(', ') })
    : t('sum.nobody');

  const cont = button(t('sum.continue'), p.onContinue, 'primary', 'confirm');
  cont.setAttribute('data-nav', '');
  const update = (): void => {
    const left = SUMMARY_LOCK_MS - (Date.now() - p.shownAt);
    if (left > 0) {
      cont.disabled = true;
      cont.textContent = t('sum.continueIn', { n: Math.ceil(left / 1000) });
    } else {
      const was = cont.disabled;
      cont.disabled = false;
      cont.textContent = t('sum.continue');
      if (was) cont.focus({ preventScroll: true });
      clearInterval(timer);
    }
  };
  const timer = window.setInterval(update, 150);
  s.onClear(() => clearInterval(timer));
  update();

  const kpi = (k: string, v: string, acc2 = false): HTMLElement =>
    h('div', { class: 'kpi' + (acc2 ? ' acc' : '') }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
  const grade = sm.grade;
  const gradeBox = grade
    ? h('div', { class: 'grade g-' + grade },
      h('div', { class: 'gl-k tag' }, t('sum.grade')),
      h('div', { class: 'gl' }, grade),
      sm.gradeScore !== undefined ? h('div', { class: 'gs' }, t('sum.score100', { n: Math.round(sm.gradeScore) })) : null)
    : null;
  const bd = sm.gradeBreakdown ?? [];
  const breakdown = bd.length
    ? h('div', { class: 'breakdown' }, h('span', { class: 'tag' }, '// ' + t('sum.breakdown')),
      ...bd.map(([k, pts, max]) => statLine(t(k), max > 0 ? pts / max : 0, `${Math.round(pts)}/${Math.round(max)}`)))
    : null;
  return scr('bg-dim',
    h('div', { class: 'center-col' },
      h('div', { class: 'report tech' },
        h('span', { class: 'tag' }, '// ' + t('sum.report')),
        h('h1', { class: 'h-title' }, t('sum.title')),
        h('div', { class: 'sub' }, t('sum.sub', { floor: pad2(sm.floor), zone: pad2(sm.zone) })),
        sm.newRecord && !p.cheated ? h('div', { class: 'flag rec' }, icon('star'), t('sum.newRecord')) : null,
        p.cheated ? h('div', { class: 'flag cheat' }, icon('warn'), t('sum.cheated')) : null,
        h('div', { class: 'rep-top' },
          gradeBox,
          h('div', { class: 'kpis' },
            kpi(t('sum.time'), fmtTime(st.time)),
            kpi(t('sum.kills'), String(st.kills)),
            kpi(t('sum.accuracy'), acc),
            kpi(t('sum.damage'), String(Math.round(st.damageTaken))),
            kpi(t('sum.gained'), '+' + Math.round(st.scoreGained), true),
            kpi(t('sum.total'), String(sm.totalScore)),
          ),
        ),
        breakdown,
        h('div', { class: 'rep-lines' },
          h('div', { class: 'rl' }, h('span', { class: 'k' }, t('sum.fallen')), h('span', { class: 'v' }, fallen)),
          h('div', { class: 'rl' }, h('span', { class: 'k' }, t('sum.reward')), h('span', { class: 'v' }, `${t('reward.' + sm.reward)} — ${rewardTo}`)),
        ),
        h('div', { class: 'btn-row center', style: 'margin-top:0.9rem' }, cont),
      ),
    ),
  );
}

// ───────────────────────────── Elegir mejora ─────────────────────────────

export function upgradeScreen(s: Screens, p: { choices: string[]; onPick(id: string): void; reroll?: { price: number | null; onReroll(): void } }): HTMLElement {
  s.setBack(null);
  const cards = p.choices.map((id, i) => {
    const u = upgradeInfo(id);
    const pick = (): void => { uiSound('reward'); p.onPick(id); };
    return h('div', {
      class: 'up tech', tabindex: 0, role: 'button', 'data-nav': true, 'data-autofocus': i === 0 ? true : null, style: `--i:${i}`,
      onclick: pick,
      onmouseenter: (e: Event) => (e.currentTarget as HTMLElement).focus({ preventScroll: true }),
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } },
    },
      h('span', { class: 'tag' }, `// ${pad2(i + 1)}`),
      h('div', { class: 'up-ico' }, icon(u.icon)),
      h('h3', { class: 'h-title' }, u.name),
      h('p', { class: 'up-desc' }, u.desc),
      h('div', { class: 'foot' }, deployLabel(t('up.pick'))),
    );
  });
  return scr('bg-blur',
    h('div', { class: 'stack' },
      h('div', { class: 'screen-head' }, h('div', null, h('span', { class: 'tag' }, '// 03'), h('h2', { class: 'h-title' }, t('up.title')), h('p', { class: 'hint' }, t('up.hint')))),
      h('div', { class: 'ups' }, ...cards),
      p.reroll ? h('div', { class: 'btn-row', style: 'margin-top:0.8rem' }, (() => { const rr = p.reroll!; const b = button(rr.price !== null ? t('up.rerollPrice', { n: rr.price }) : t('up.reroll'), rr.onReroll, 'small'); b.setAttribute('data-nav', ''); return b; })()) : null,
    ),
  );
}

// ───────────────────────────── Récords ─────────────────────────────

let recTab: 'campaign' | 'horde' = 'campaign';
export function recordsScreen(s: Screens, p: { records: Record<string, RecordEntry>; hordeBest?: Record<number, number>; onBack(): void }): HTMLElement {
  s.setBack(p.onBack);
  if (recTab === 'horde') {
    const hb = p.hordeBest ?? {};
    const hg = h('div', { class: 'rec-grid', style: 'grid-template-columns:minmax(9rem,2fr) 1fr' }, h('span', { class: 'tag' }, t('rec.floor')), h('span', { class: 'tag' }, t('horde.bestLabel')));
    for (let f = 1; f <= 9; f++) {
      hg.appendChild(h('span', { class: 'rf' }, `${pad2(f)} · ${t(`floor.${f}.name`)}`));
      hg.appendChild(hb[f] ? h('span', { class: 'rc' }, h('b', null, String(hb[f])), h('small', null, t('rec.wave', { n: hb[f] }))) : h('span', { class: 'rc none' }, '—'));
    }
    return recordsShell(s, p.onBack, h('div', { class: 'tech rec-box' }, hg));
  }
  const diffs: ('easy' | 'normal' | 'hard')[] = ['easy', 'normal', 'hard'];
  const any = Object.keys(p.records).length > 0;
  const grid = h('div', { class: 'rec-grid' }, h('span', { class: 'tag' }, t('rec.floor')), ...diffs.map((d) => h('span', { class: 'tag' }, t('opt.diff.' + d))));
  for (let f = 1; f <= 9; f++) {
    grid.appendChild(h('span', { class: 'rf' }, `${pad2(f)} · ${t(`floor.${f}.name`)}`));
    for (const d of diffs) {
      const r = p.records[`${d}:${f}`];
      let when = '';
      if (r) { const dt = new Date(r.date); when = isNaN(dt.getTime()) ? String(r.date) : dt.toLocaleDateString(getLang() === 'es' ? 'es-ES' : 'en-US'); }
      grid.appendChild(r
        ? h('span', { class: 'rc' }, h('b', { class: 'g-' + r.grade }, r.grade), h('small', null, `${fmtTime(r.time)} · ${when}`))
        : h('span', { class: 'rc none' }, '—'));
    }
  }
  return recordsShell(s, p.onBack, any ? h('div', { class: 'tech rec-box' }, grid) : h('div', { class: 'tech rec-box' }, h('p', { class: 'hint', style: 'padding:1rem' }, t('rec.empty'))));
}

function recordsShell(s: Screens, onBack: () => void, body: HTMLElement): HTMLElement {
  const tabs = h('div', { class: 'tabs', role: 'tablist' },
    ...(['campaign', 'horde'] as const).map((id) => h('button', {
      type: 'button', class: 'tab' + (recTab === id ? ' on' : ''), role: 'tab', 'data-nav': true,
      onclick: () => { uiSound('click'); recTab = id; s.refresh(); },
    }, t('rec.tab.' + id))));
  return scr('bg-blur',
    h('div', { class: 'stack' },
      h('div', { class: 'screen-head' },
        h('div', null, h('span', { class: 'tag' }, '// 06'), h('h2', { class: 'h-title' }, t('rec.title')), h('p', { class: 'hint' }, t('rec.hint'))),
        (() => { const b = button(t('menu.back'), onBack, 'primary', 'back'); b.setAttribute('data-nav', ''); b.setAttribute('data-autofocus', ''); return b; })()),
      tabs,
      body,
    ),
  );
}

// ───────────────────────────── Derrota ─────────────────────────────

export function defeatScreen(s: Screens, p: { floor: number; zone: number; reason?: string; onRetry(): void; onMenu(): void }): HTMLElement {
  s.setBack(null);
  return scr('bg-defeat',
    h('div', { class: 'center-col' },
      h('h1', { class: 'h-title defeat-title' }, t('def.title')),
      p.reason ? h('div', { class: 'defeat-sub', style: 'color:var(--danger)' }, p.reason) : null,
      h('div', { class: 'defeat-sub' }, t('def.sub', { floor: pad2(p.floor), zone: pad2(p.zone) })),
      h('div', { class: 'btn-row center', style: 'margin-top:0.6rem' },
        (() => { const b = button(t('def.retry'), p.onRetry, 'primary', 'confirm'); b.setAttribute('data-nav', ''); b.setAttribute('data-autofocus', ''); return b; })(),
        button(t('def.menu'), p.onMenu, '', 'back'),
      ),
    ),
  );
}

// ───────────────────────────── Fin de supervivencia ─────────────────────────────

export function hordeEndScreen(s: Screens, p: { wave: number; best: number; newRecord: boolean; onRetry(): void; onMenu(): void }): HTMLElement {
  s.setBack(null);
  return scr('bg-defeat',
    h('div', { class: 'center-col' },
      h('h1', { class: 'h-title defeat-title' }, t('horde.end', { n: p.wave })),
      h('div', { class: 'defeat-sub' }, t('horde.best', { n: p.best })),
      p.newRecord ? h('div', { class: 'flag rec' }, icon('star'), t('sum.newRecord')) : null,
      h('div', { class: 'btn-row center', style: 'margin-top:0.6rem' },
        (() => { const b = button(t('horde.retry'), p.onRetry, 'primary', 'confirm'); b.setAttribute('data-nav', ''); b.setAttribute('data-autofocus', ''); return b; })(),
        button(t('def.menu'), p.onMenu, '', 'back'),
      ),
    ),
  );
}

// ───────────────────────────── Victoria ─────────────────────────────

export function victoryScreen(p: { score: number; onContinue(): void }): HTMLElement {
  return scr('bg-tower',
    h('div', { class: 'center-col', style: 'gap:1rem' },
      h('h1', { class: 'h-title vic-title' }, t('vic.title')),
      h('p', { class: 'vic-text' }, t('vic.text')),
      h('div', { class: 'vic-score' }, `${t('vic.score')}: ${p.score}`),
      (() => { const b = button(t('vic.continue'), p.onContinue, 'primary', 'confirm'); b.setAttribute('data-nav', ''); b.setAttribute('data-autofocus', ''); return b; })(),
    ),
  );
}

// ───────────────────────────── Créditos ─────────────────────────────

export function creditsScreen(s: Screens, p: { onBack(): void }): HTMLElement {
  s.setBack(p.onBack);
  return scr('bg-tower',
    h('div', { class: 'credits stack' },
      h('span', { class: 'tag' }, '// 05'),
      h('h1', { class: 'h-title' }, t('cred.title')),
      h('div', { class: 'rule' }),
      h('p', { class: 'big' }, t('cred.game')),
      h('p', { class: 'big' }, t('cred.team')),
      h('p', null, 'Sergio Gallardo Sales'),
      h('p', null, 'Alejandro Oñate Latorre'),
      h('p', null, 'Martín Candela Calabuig'),
      h('p', null, 'Rubén Pardo Millá'),
      h('p', { class: 'hint' }, t('cred.uni')),
      h('h3', { class: 'h-title' }, t('cred.musicHead')),
      h('p', null, 'Adrián Gómez Marín'),
      h('p', null, 'Almudena Segovia Calabuig'),
      h('h3', { class: 'h-title' }, t('cred.versionHead')),
      h('p', null, t('cred.versionText')),
      h('h3', { class: 'h-title' }, t('cred.libsHead')),
      h('p', null, t('cred.three')),
      h('div', { class: 'btn-row', style: 'margin:1rem 0 0.5rem' },
        (() => { const b = button(t('menu.back'), p.onBack, 'primary', 'back'); b.setAttribute('data-nav', ''); b.setAttribute('data-autofocus', ''); return b; })()),
    ),
  );
}

// ───────────────────────────── Pausa ─────────────────────────────

export function pauseScreen(s: Screens, p: { onResume(): void; onOptions(): void; onConsole(): void; onQuit(): void }): HTMLElement {
  s.setBack(p.onResume);
  return scr('bg-dim',
    h('div', { class: 'center-col', style: 'align-items:flex-start;margin-left:max(0px, 6vw)' },
      h('span', { class: 'tag' }, '// 00'),
      h('h1', { class: 'h-title t-logo' }, t('pause.title')),
      h('div', { class: 'rule' }),
      menuBlock([
        menuItem(t('pause.resume'), p.onResume, 0, { autofocus: true, sound: 'confirm' }),
        menuItem(t('menu.options'), p.onOptions, 1),
        menuItem(t('pause.console'), p.onConsole, 2),
        menuItem(t('pause.quit'), p.onQuit, 3, { danger: true, sound: 'back' }),
      ]),
    ),
  );
}

// ───────────────────────────── Opciones ─────────────────────────────

export interface OptionsParams {
  settings: Settings;
  /** Se llama tras CADA cambio: la app guarda y reaplica los ajustes. */
  onChange(): void;
  onBack(): void;
  /** Datos: tutorial y registro de partidas (v1.2) */
  onRepeatTutorial(): void;
  onExportLog(): void;
  onClearLog(): number;
  logCount(): number;
}

type OptTab = 'audio' | 'controls' | 'video' | 'lang';
let optTab: OptTab = 'audio';

export function optionsScreen(s: Screens, p: OptionsParams): HTMLElement {
  const st = p.settings;
  const msg = h('p', { class: 'opt-msg' });
  s.setBack(() => { stopListening(); p.onBack(); });

  const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string): HTMLElement => {
    const val = h('span', { class: 'val' }, fmt(get()));
    const input = h<HTMLInputElement>('input', {
      type: 'range', min, max, step, value: get(), 'aria-label': label,
      oninput: (e: Event) => {
        const v = parseFloat((e.target as HTMLInputElement).value);
        set(v);
        val.textContent = fmt(v);
        p.onChange();
      },
    });
    return h('div', { class: 'opt-row' }, h('span', { class: 'l' }, label), h('div', { class: 'ctl' }, input, val));
  };
  const pct = (v: number): string => Math.round(v * 100) + ' %';

  const segment = <T extends string>(label: string, values: { v: T; text: string }[], get: () => T, set: (v: T) => void): HTMLElement => {
    const btns: HTMLButtonElement[] = [];
    const paint = (): void => values.forEach((o, i) => btns[i].classList.toggle('on', o.v === get()));
    const box = h('div', { class: 'seg' });
    values.forEach((o) => {
      const b = button(o.text, () => { set(o.v); paint(); p.onChange(); }, 'small');
      b.setAttribute('data-nav', '');
      btns.push(b);
      box.appendChild(b);
    });
    paint();
    return h('div', { class: 'opt-row' }, h('span', { class: 'l' }, label), h('div', { class: 'ctl' }, box));
  };
  const toggle = (label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement => {
    const sw = h<HTMLButtonElement>('button', {
      type: 'button', class: 'sw', role: 'switch', 'aria-checked': String(get()), 'aria-label': label, 'data-nav': true,
      onclick: (e: Event) => {
        const b = e.currentTarget as HTMLElement;
        const v = !(b.getAttribute('aria-checked') === 'true');
        b.setAttribute('aria-checked', String(v));
        val.textContent = v ? t('opt.on') : t('opt.off');
        uiSound('click');
        set(v);
        p.onChange();
      },
    });
    const val = h('span', { class: 'val' }, get() ? t('opt.on') : t('opt.off'));
    return h('div', { class: 'opt-row' }, h('span', { class: 'l' }, label), h('div', { class: 'ctl' }, val, sw));
  };

  // Remapeo de controles
  const bindGrid = h('div', { class: 'bind-grid' });
  const bindBtns = new Map<Action, HTMLButtonElement>();
  let listening: { action: Action; stop: () => void } | null = null;

  const paintBinds = (): void => {
    for (const a of ACTIONS) {
      const b = bindBtns.get(a);
      if (b) { b.textContent = keyLabel(st.bindings[a]); b.classList.remove('listening'); }
    }
  };
  function stopListening(): void {
    if (listening) { listening.stop(); listening = null; }
    flags.capturing = false;
    paintBinds();
  }
  s.onClear(stopListening);

  const startListening = (a: Action): void => {
    stopListening();
    msg.textContent = '';
    const btn = bindBtns.get(a)!;
    btn.textContent = t('opt.press');
    btn.classList.add('listening');
    flags.capturing = true;

    const finish = (code: string | null): void => {
      stopListening();
      if (code === null) return;
      const dup = ACTIONS.find((o) => o !== a && st.bindings[o] === code);
      if (dup) {
        uiSound('error');
        msg.textContent = t('opt.dup', { key: keyLabel(code), action: t('act.' + dup) });
        return;
      }
      st.bindings[a] = code;
      uiSound('confirm');
      paintBinds();
      p.onChange();
    };
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.repeat) return;
      // Esc cancela, salvo al reasignar la propia pausa (si no, nunca se podría poner Esc ahí)
      if (e.code === 'Escape' && a !== 'pause') { finish(null); return; }
      if (e.code === 'Unidentified' || e.code === '') return;
      finish(e.code);
    };
    const onMouse = (e: MouseEvent): void => {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.button > 2) return;
      finish('Mouse' + e.button);
    };
    const onCtx = (e: Event): void => { e.preventDefault(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('contextmenu', onCtx, true);
    listening = {
      action: a,
      stop: () => {
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('mousedown', onMouse, true);
        window.removeEventListener('contextmenu', onCtx, true);
      },
    };
  };

  for (const a of ACTIONS) {
    const b = h<HTMLButtonElement>('button', {
      class: 'btn small', type: 'button', 'data-nav': true,
      onclick: (e: Event) => {
        e.stopPropagation();
        (e.currentTarget as HTMLElement).blur();
        if (listening && listening.action === a) { stopListening(); return; }
        uiSound('click');
        // El clic que inicia la escucha no debe contar como asignación de ratón: se arma en el siguiente turno
        window.setTimeout(() => startListening(a), 0);
      },
    }, keyLabel(st.bindings[a]));
    bindBtns.set(a, b);
    bindGrid.appendChild(h('div', { class: 'bind-row' }, h('span', null, t('act.' + a)), b));
  }

  // Datos: tutorial y registro de partidas (todo local, no se envía nada)
  const dataSection = (): HTMLElement[] => {
    const info = h('p', { class: 'hint' }, t('opt.logCount', { n: p.logCount() }));
    return [
      h('h3', { class: 'h-title opt-sec' }, '// ' + t('opt.data')),
      h('div', { class: 'btn-row', style: 'margin:0.4rem 0' },
        button(t('tut.again'), () => { p.onRepeatTutorial(); info.textContent = t('tut.againDone'); }, 'small'),
        button(t('opt.exportLog'), () => p.onExportLog(), 'small'),
        button(t('opt.clearLog'), () => { const n = p.onClearLog(); info.textContent = t('opt.logCount', { n }); }, 'small'),
      ),
      info,
    ];
  };

  // Con Ctrl como agacharse, Ctrl+W cierra la pestaña; en pantalla completa el navegador no lo intercepta
  const fullscreenTip = (): HTMLElement[] => {
    const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
    if (typeof el.requestFullscreen !== 'function') return [];
    return [h('div', { class: 'btn-row', style: 'margin:0.2rem 0 0.4rem' },
      h('span', { class: 'hint' }, t('opt.fsTip')),
      button(t('opt.fullscreen'), () => { try { void el.requestFullscreen?.()?.catch(() => {}); } catch { /* sin pantalla completa */ } }, 'small'))];
  };

  const panes: Record<OptTab, () => HTMLElement[]> = {
    audio: () => [
      slider(t('opt.music'), 0, 1, 0.05, () => st.musicVol, (v) => { st.musicVol = v; }, pct),
      slider(t('opt.sfx'), 0, 1, 0.05, () => st.sfxVol, (v) => { st.sfxVol = v; }, pct),
    ],
    controls: () => [
      slider(t('opt.sens'), 0.2, 3, 0.05, () => st.sensitivity, (v) => { st.sensitivity = v; }, (v) => v.toFixed(2)),
      segment(t('opt.difficulty'), [
        { v: 'easy', text: t('opt.diff.easy') }, { v: 'normal', text: t('opt.diff.normal') }, { v: 'hard', text: t('opt.diff.hard') },
      ], () => st.difficulty, (v) => { st.difficulty = v; }),
      h('h3', { class: 'h-title opt-sec' }, '// ' + t('opt.controls')),
      h('p', { class: 'hint' }, t('opt.remapHint')),
      h('p', { class: 'hint', style: 'color:var(--acc)' }, t('opt.controlsNote')),
      h('p', { class: 'hint', style: 'color:var(--acc)' }, t('opt.controlsNote2')),
      ...fullscreenTip(),
      msg,
      bindGrid,
      h('div', { class: 'btn-row', style: 'margin-top:0.5rem' },
        button(t('opt.reset'), () => {
          stopListening();
          st.bindings = defaultBindings();
          msg.textContent = '';
          paintBinds();
          p.onChange();
        }, 'small')),
    ],
    video: () => [
      toggle(t('opt.subs'), () => st.subtitles, (v) => { st.subtitles = v; }),
      toggle(t('opt.radio'), () => (st as ExtraSettings).radio !== false, (v) => { (st as ExtraSettings).radio = v; }),
      toggle(t('opt.cinematics'), () => (st as ExtraSettings).cinematics !== false, (v) => { (st as ExtraSettings).cinematics = v; }),
      slider(t('opt.fov'), 50, 80, 1, () => st.fov ?? 60, (v) => { st.fov = v; }, (v) => Math.round(v) + '°'),
      toggle(t('opt.toggleCrouch'), () => !!st.toggleCrouch, (v) => { st.toggleCrouch = v; }),
      toggle(t('opt.toggleAim'), () => !!st.toggleAim, (v) => { st.toggleAim = v; }),
      toggle(t('opt.toggleSprint'), () => !!st.toggleSprint, (v) => { st.toggleSprint = v; }),
      toggle(t('opt.aimAssistDesktop'), () => !!st.aimAssistDesktop, (v) => { st.aimAssistDesktop = v; }),
      toggle(t('opt.highContrast'), () => !!st.highContrast, (v) => { st.highContrast = v; }),
      slider(t('opt.uiscale'), 0.8, 1.4, 0.05, () => st.uiScale, (v) => { st.uiScale = v; }, pct),
      toggle(t('opt.colorblind'), () => st.colorblind, (v) => { st.colorblind = v; }),
      toggle(t('opt.shake'), () => st.cameraShake, (v) => { st.cameraShake = v; }),
      toggle(t('opt.vibration'), () => st.vibration !== false, (v) => { st.vibration = v; }),
      toggle(t('opt.reduceFlashes'), () => !!st.reduceFlashes, (v) => { st.reduceFlashes = v; }),
      segment(t('opt.graphics'), [
        { v: 'auto', text: t('opt.gfx.auto') }, { v: 'high', text: t('opt.gfx.high') },
        { v: 'medium', text: t('opt.gfx.medium') }, { v: 'low', text: t('opt.gfx.low') },
      ], () => st.graphics ?? 'auto', (v) => { st.graphics = v; }),
      h('p', { class: 'hint' }, t('opt.gfx.help')),
      ...dataSection(),
    ],
    lang: () => [
      segment(t('opt.lang'), [{ v: 'es', text: t('lang.es') }, { v: 'en', text: t('lang.en') }], () => st.lang, (v) => { st.lang = v; }),
    ],
  };

  const tabDefs: { id: OptTab; label: string }[] = [
    { id: 'audio', label: t('opt.tab.audio') }, { id: 'controls', label: t('opt.tab.controls') },
    { id: 'video', label: t('opt.tab.video') }, { id: 'lang', label: t('opt.tab.lang') },
  ];
  const body = h('div', { class: 'options tech' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const tabBtns: HTMLButtonElement[] = [];
  const open = (id: OptTab): void => {
    stopListening();
    optTab = id;
    tabBtns.forEach((b, i) => b.classList.toggle('on', tabDefs[i].id === id));
    body.textContent = '';
    for (const el of panes[id]()) body.appendChild(el);
  };
  tabDefs.forEach((d) => {
    const b = h<HTMLButtonElement>('button', {
      type: 'button', class: 'tab', role: 'tab', 'data-nav': true,
      onclick: (e: Event) => { e.stopPropagation(); uiSound('click'); open(d.id); },
    }, d.label);
    tabBtns.push(b);
    tabs.appendChild(b);
  });
  open(optTab);

  return scr('bg-tower',
    h('div', { class: 'stack', style: 'max-width:46rem' },
      h('div', { class: 'screen-head' },
        h('div', null, h('span', { class: 'tag' }, '// 04'), h('h2', { class: 'h-title' }, t('opt.title'))),
        (() => { const b = button(t('opt.back'), () => { stopListening(); p.onBack(); }, 'primary', 'back'); b.setAttribute('data-nav', ''); return b; })(),
      ),
      tabs,
      body,
    ),
  );
}
