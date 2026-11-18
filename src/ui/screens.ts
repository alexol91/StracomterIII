// Pantallas de menú (HTML/CSS superpuesto): Título, Elección de clase, Estrategia, Pausa, Informe de misión,
// Derrota, Victoria, Créditos y Opciones. No saben nada del flujo de la aplicación: reciben callbacks.
// Navegables con teclado (flechas + Enter, Esc para volver; lo gestiona main con stepNav/goBack) y con el dedo.

import type { Action, CampaignState, Settings, ZoneInfo, ZoneSummary } from '../contracts';
import type { ClassId, ItemType } from '../sim/types';
import { CLASS_IDS } from '../sim/types';
import { CLASS_STATS } from '../sim/data';
import { asset, button, fmtTime, flags, h, icon, itemIcon, pad2, uiSound } from './dom';
import { t, getLang } from './i18n';
import { drawMiniMap } from './minimap';
import { ACTIONS, defaultBindings, keyLabel } from './settings';

/** Contenedor de pantallas: solo hay una visible a la vez. Se puede redibujar (cambio de idioma). */
export class Screens {
  private cleanups: (() => void)[] = [];
  private build: ((s: Screens) => HTMLElement) | null = null;
  private backFn: (() => void) | null = null;

  constructor(private layer: HTMLElement) {}

  show(build: (s: Screens) => HTMLElement): void {
    this.clear();
    this.build = build;
    const el = build(this);
    this.layer.appendChild(el);
    // Foco inicial: la primera opción marcada, para poder navegar con teclado desde el primer momento
    const af = el.querySelector<HTMLElement>('[data-autofocus]');
    if (af) af.focus({ preventScroll: true });
  }

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
    class: 'mi on-focus' + (o.danger ? ' danger' : ''), type: 'button', 'data-nav': true,
    'data-autofocus': o.autofocus ? true : null, disabled: o.disabled,
    style: `--i:${i}`,
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
  onNew(): void; onContinue(): void; onQuick(): void; onOptions(): void; onCredits(): void;
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
      h('span', null, t('menu.foot')),
      h('span', { class: 'nav-hint' }, t('nav.hint')),
      langSelector(p.onLang),
    ),
  );
}

// ───────────────────────────── Elección de clase ─────────────────────────────

export interface ClassParams {
  /** null en campaña; planta elegida en partida rápida */
  quickFloor: number | null;
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
  const cards = CLASS_IDS.map((c, i) => {
    const st = CLASS_STATS[c];
    const dmg = st.explosive ? t('stat.damageBlast', { n: st.damage }) : String(st.damage);
    const pick = (): void => { uiSound('confirm'); p.onPick(c); };
    return h('div', {
      class: 'op tech ' + CLS[c], tabindex: 0, role: 'button', 'data-nav': true, 'data-autofocus': i === 0 ? true : null,
      style: `--i:${i}`,
      onclick: pick,
      onmouseenter: (e: Event) => (e.currentTarget as HTMLElement).focus({ preventScroll: true }),
      onkeydown: (e: KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(); } },
    },
      h('div', { class: 'ph' },
        h('img', { src: asset(PORTRAIT[c]), alt: '', draggable: 'false', loading: 'eager' }),
        h('span', { class: 'tag idx' }, `// ${pad2(i + 1)}`),
        h('h3', { class: 'h-title nm' }, t('kind.' + c)),
      ),
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
      h('div', { style: 'margin-top:auto' }, h('div', { class: 'dots', style: 'margin:0 0.7rem' }), deployLabel(p.quickFloor === null ? t('class.deploy') : t('class.pick'))),
    );
  });

  const head = h('div', { class: 'screen-head' },
    h('div', null,
      h('span', { class: 'tag' }, '// 01'),
      h('h2', { class: 'h-title' }, p.quickFloor === null ? t('class.title') : t('class.titleQuick')),
    ),
    button(t('menu.back'), p.onBack, 'small', 'back'),
  );
  const kids: (HTMLElement | null)[] = [head];
  if (p.quickFloor !== null) {
    const floors = h('div', { class: 'floor-pick' }, h('span', { class: 'tag' }, t('quick.floor')));
    for (let n = 1; n <= 9; n++) {
      const b = h<HTMLButtonElement>('button', {
        type: 'button', class: 'fl' + (n === p.quickFloor ? ' on' : ''), title: t(`floor.${n}.name`),
        onclick: (e: Event) => { e.stopPropagation(); uiSound('click'); p.onFloor(n); },
      }, pad2(n));
      floors.appendChild(b);
    }
    kids.push(floors);
    kids.push(h('p', { class: 'hint', style: 'margin-bottom:0.6rem' }, t('strat.head', { n: pad2(p.quickFloor), name: t(`floor.${p.quickFloor}.name`) })));
  } else {
    kids.push(h('p', { class: 'hint', style: 'margin-bottom:0.6rem' }, t('class.hint')));
  }
  kids.push(h('div', { class: 'ops' }, ...cards));
  return scr('bg-blur', ...kids);
}

// ───────────────────────────── Estrategia ─────────────────────────────

export interface StrategyParams {
  state: CampaignState;
  zones: ZoneInfo[];
  onEnter(zone: number): void;
  onControl(c: ClassId): void;
  onMenu(): void;
}

function slotChip(it: ItemType | null): HTMLElement {
  if (!it) return h('span', { class: 'slot-i empty' }, '·');
  return h('span', { class: 'slot-i', title: t('item.' + it) }, itemIcon(it), it.slice(it.indexOf('_') + 1));
}

export function strategyScreen(s: Screens, p: StrategyParams): HTMLElement {
  s.setBack(p.onMenu);
  const st = p.state;
  const floor = st.floor;

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

  return scr('bg-blur',
    h('div', { class: 'screen-head' },
      h('div', null,
        h('span', { class: 'tag' }, '// 02'),
        h('h2', { class: 'h-title' }, t('strat.head', { n: pad2(floor), name: t(`floor.${floor}.name`) })),
        h('p', { class: 'hint' }, t(`floor.${floor}.desc`)),
      ),
      h('div', { class: 'btn-row' },
        h('div', { class: 'score-box' }, h('span', { class: 'tag' }, t('strat.score')), h('div', { class: 'big' }, String(st.score))),
        button(t('strat.menu'), p.onMenu, 'small', 'back'),
      ),
    ),
    h('p', { class: 'hint', style: 'margin-bottom:0.7rem' }, t('strat.hint')),
    h('div', { class: 'strat-body' }, party, zones),
  );
}

// ───────────────────────────── Informe de misión ─────────────────────────────

export interface SummaryParams {
  summary: ZoneSummary;
  /** Instante (Date.now) en que se mostró: el botón se habilita 2 s después y no se reinicia al redibujar */
  shownAt: number;
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
  return scr('bg-dim',
    h('div', { class: 'center-col' },
      h('div', { class: 'report tech' },
        h('span', { class: 'tag' }, '// ' + t('sum.report')),
        h('h1', { class: 'h-title' }, t('sum.title')),
        h('div', { class: 'sub' }, t('sum.sub', { floor: pad2(sm.floor), zone: pad2(sm.zone) })),
        h('div', { class: 'kpis' },
          kpi(t('sum.time'), fmtTime(st.time)),
          kpi(t('sum.kills'), String(st.kills)),
          kpi(t('sum.accuracy'), acc),
          kpi(t('sum.damage'), String(Math.round(st.damageTaken))),
          kpi(t('sum.gained'), '+' + Math.round(st.scoreGained), true),
          kpi(t('sum.total'), String(sm.totalScore)),
        ),
        h('div', { class: 'rep-lines' },
          h('div', { class: 'rl' }, h('span', { class: 'k' }, t('sum.fallen')), h('span', { class: 'v' }, fallen)),
          h('div', { class: 'rl' }, h('span', { class: 'k' }, t('sum.reward')), h('span', { class: 'v' }, `${t('reward.' + sm.reward)} — ${rewardTo}`)),
        ),
        h('div', { class: 'btn-row center', style: 'margin-top:0.9rem' }, cont),
      ),
    ),
  );
}

// ───────────────────────────── Derrota ─────────────────────────────

export function defeatScreen(s: Screens, p: { floor: number; zone: number; onRetry(): void; onMenu(): void }): HTMLElement {
  s.setBack(null);
  return scr('bg-defeat',
    h('div', { class: 'center-col' },
      h('h1', { class: 'h-title defeat-title' }, t('def.title')),
      h('div', { class: 'defeat-sub' }, t('def.sub', { floor: pad2(p.floor), zone: pad2(p.zone) })),
      h('div', { class: 'btn-row center', style: 'margin-top:0.6rem' },
        (() => { const b = button(t('def.retry'), p.onRetry, 'primary', 'confirm'); b.setAttribute('data-nav', ''); b.setAttribute('data-autofocus', ''); return b; })(),
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
    h('div', { class: 'credits' },
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
      slider(t('opt.uiscale'), 0.8, 1.4, 0.05, () => st.uiScale, (v) => { st.uiScale = v; }, pct),
      toggle(t('opt.colorblind'), () => st.colorblind, (v) => { st.colorblind = v; }),
      toggle(t('opt.shake'), () => st.cameraShake, (v) => { st.cameraShake = v; }),
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
    h('div', { class: 'screen-head' },
      h('div', null, h('span', { class: 'tag' }, '// 04'), h('h2', { class: 'h-title' }, t('opt.title'))),
      (() => { const b = button(t('opt.back'), () => { stopListening(); p.onBack(); }, 'primary', 'back'); b.setAttribute('data-nav', ''); return b; })(),
    ),
    tabs,
    body,
  );
}
