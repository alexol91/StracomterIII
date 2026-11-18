// Pantallas de menú (HTML/CSS superpuesto): Título, Elección de clase, Estrategia, Pausa, Fin de planta,
// Derrota, Victoria, Créditos y Opciones. No saben nada del flujo de la aplicación: reciben callbacks.

import type { Action, CampaignState, Settings, ZoneInfo, ZoneSummary } from '../contracts';
import type { ClassId, ItemType } from '../sim/types';
import { CLASS_IDS } from '../sim/types';
import { CLASS_STATS } from '../sim/data';
import { bar, button, fmtTime, flags, h, itemClass, itemShort, setBar, uiSound } from './dom';
import { t, getLang } from './i18n';
import { drawMiniMap } from './minimap';
import { ACTIONS, defaultBindings, keyLabel } from './settings';

/** Contenedor de pantallas: solo hay una visible a la vez. Se puede redibujar (cambio de idioma). */
export class Screens {
  private cleanups: (() => void)[] = [];
  private build: ((s: Screens) => HTMLElement) | null = null;

  constructor(private layer: HTMLElement) {}

  show(build: (s: Screens) => HTMLElement): void {
    this.clear();
    this.build = build;
    this.layer.appendChild(build(this));
  }

  /** Registra algo que limpiar cuando la pantalla se cierre o se redibuje (temporizadores, listeners). */
  onClear(fn: () => void): void { this.cleanups.push(fn); }

  clear(): void {
    const c = this.cleanups;
    this.cleanups = [];
    for (const f of c) { try { f(); } catch { /* ignorar */ } }
    this.layer.textContent = '';
    this.build = null;
  }

  get visible(): boolean { return this.build !== null; }

  /** Redibuja la pantalla actual conservando el desplazamiento. */
  refresh(): void {
    const b = this.build;
    if (!b) return;
    const old = this.layer.firstElementChild as HTMLElement | null;
    const top = old ? old.scrollTop : 0;
    this.show(b);
    const now = this.layer.firstElementChild as HTMLElement | null;
    if (now) now.scrollTop = top;
  }
}

const CLASS_COLOR_CLS: Record<ClassId, string> = {
  captain: 'cls-captain', technic: 'cls-technic', especialist: 'cls-especialist', explosives: 'cls-explosives',
};

// ───────────────────────────── Título ─────────────────────────────

export interface TitleParams {
  hasSave: boolean;
  onNew(): void; onContinue(): void; onQuick(): void; onOptions(): void; onCredits(): void; onLang(): void;
}

export function titleScreen(p: TitleParams): HTMLElement {
  const btns = h('div', { class: 'menu-btns' },
    button(t('menu.newCampaign'), p.onNew, 'primary', 'confirm'),
    p.hasSave ? button(t('menu.continue'), p.onContinue, 'primary', 'confirm') : null,
    button(t('menu.quick'), p.onQuick),
    button(t('menu.options'), p.onOptions),
    button(t('menu.credits'), p.onCredits),
  );
  return h('div', { class: 'screen bg-title' },
    h('div', { class: 'title-corner' }, button(t('menu.lang'), p.onLang, 'small')),
    h('div', { class: 'center-col' },
      h('h1', { class: 'h-title h-comic title-logo' }, t('title.name')),
      h('p', { class: 'title-sub' }, t('title.sub')),
      btns,
    ),
    h('div', { class: 'title-foot' }, 'Chutaos Team · 2011-2012'),
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

export function classScreen(p: ClassParams): HTMLElement {
  const cards = CLASS_IDS.map((c) => {
    const st = CLASS_STATS[c];
    const dmg = st.explosive ? t('stat.damageBlast', { n: st.damage }) : String(st.damage);
    return h('div', { class: 'class-card ' + CLASS_COLOR_CLS[c] },
      h('header', null, h('h3', { class: 'h-title' }, t('kind.' + c))),
      h('div', { class: 'body' },
        row(t('stat.hp'), String(st.hp)),
        row(t('stat.speed'), t('stat.speedValue', { n: fmtNum(st.speed) })),
        row(t('stat.rof'), t('stat.rofValue', { n: fmtNum(st.rof) })),
        row(t('stat.damage'), dmg),
        h('div', null, h('span', { class: 'lbl' }, t('stat.trait')), t('trait.' + c)),
        h('div', null, h('span', { class: 'lbl' }, t('stat.ability')),
          h('b', null, t('ability.' + c) + ': '), t('abilityDesc.' + c)),
      ),
      button(t('class.pick'), () => p.onPick(c), 'primary', 'confirm'),
    );
  });

  const head = h('div', { class: 'screen-head' },
    h('h2', { class: 'h-title' }, p.quickFloor === null ? t('class.title') : t('class.titleQuick')),
    button(t('menu.back'), p.onBack, 'small', 'back'),
  );
  const kids: (HTMLElement | null)[] = [head];
  if (p.quickFloor !== null) {
    const floors = h('div', { class: 'floor-pick' }, h('b', null, t('quick.floor') + ':'));
    for (let n = 1; n <= 9; n++) {
      const b = button(String(n), () => p.onFloor(n), 'small' + (n === p.quickFloor ? ' on' : ''));
      b.title = t(`floor.${n}.name`);
      floors.appendChild(b);
    }
    kids.push(floors);
    kids.push(h('p', { class: 'hint' }, `${t('strat.title', { n: p.quickFloor, name: t(`floor.${p.quickFloor}.name`) })}`));
  } else {
    kids.push(h('p', { class: 'hint' }, t('class.hint')));
  }
  kids.push(h('div', { class: 'class-grid' }, ...cards));
  return h('div', { class: 'screen bg-menu' }, ...kids);
}

function row(k: string, v: string): HTMLElement {
  return h('div', { class: 'stat-row' }, h('span', null, k), h('b', null, v));
}
function fmtNum(n: number): string {
  const s = (Math.round(n * 100) / 100).toString();
  return getLang() === 'es' ? s.replace('.', ',') : s;
}

// ───────────────────────────── Estrategia ─────────────────────────────

export interface StrategyParams {
  state: CampaignState;
  zones: ZoneInfo[];
  onEnter(zone: number): void;
  onControl(c: ClassId): void;
  onMenu(): void;
}

function itemChip(it: ItemType | null): HTMLElement {
  if (!it) return h('span', { class: 'chip empty' }, '·');
  const c = h('span', { class: 'chip ' + itemClass(it), title: t('item.' + it) }, itemShort(it));
  return c;
}

export function strategyScreen(p: StrategyParams): HTMLElement {
  const st = p.state;
  const floor = st.floor;

  // Escuadra: quién controlas
  const members: Partial<Record<ClassId, HTMLElement>> = {};
  const party = h('div', { class: 'party' }, h('h3', { class: 'h-title' }, t('strat.squad')), h('p', { class: 'hint' }, t('strat.squadHint')));
  for (const c of CLASS_IDS) {
    const m = st.members[c];
    const dead = m.hp <= 0;
    const max = CLASS_STATS[c].hp;
    const hpBar = bar('thin ' + (m.hp / max < 0.3 ? 'low' : ''));
    setBar(hpBar, m.hp / max);
    const inv = h('div', { class: 'inv' });
    for (let i = 0; i < 5; i++) inv.appendChild(itemChip(m.inv?.[i] ?? null));
    const el = h('button', {
      class: 'member ' + CLASS_COLOR_CLS[c] + (dead ? ' dead' : '') + (st.controlled === c ? ' selected' : ''),
      type: 'button',
      disabled: dead,
      onclick: () => {
        if (dead) { uiSound('error'); return; }
        uiSound('click');
        p.onControl(c);
        for (const k of CLASS_IDS) members[k]?.classList.toggle('selected', k === c);
        for (const k of CLASS_IDS) {
          const tag = members[k]?.querySelector('.tag.me') as HTMLElement | null;
          if (tag) tag.style.display = k === c ? '' : 'none';
        }
      },
    },
      h('div', { class: 'row' },
        h('span', { class: 'name' }, t('kind.' + c)),
        dead ? h('span', { class: 'tag dead' }, t('strat.fallen'))
          : h('span', { class: 'tag me', style: st.controlled === c ? '' : 'display:none' }, t('strat.controlling')),
      ),
      h('div', { class: 'row' }, h('span', null, `♥ ${Math.max(0, Math.ceil(m.hp))}/${max}`), h('span', null, `● ${m.ammo}`)),
      hpBar.el,
      inv,
    );
    members[c] = el;
    party.appendChild(el);
  }

  // Zonas
  const zones = h('div', { class: 'zones' });
  for (const z of p.zones) {
    const cv = h<HTMLCanvasElement>('canvas', { width: 320, height: 200 });
    try { drawMiniMap(cv, z.map); } catch { /* un mapa raro no debe tumbar la pantalla */ }
    const tags = h('div', { class: 'tags' },
      h('span', { class: 'tag-pill' }, `${t('size.' + z.size)} · ${t('strat.area', { n: Math.round(z.areaM2) })}`),
      h('span', { class: 'tag-pill' }, z.diafano ? t('layout.diafano') : t('layout.pasillos')),
      z.hasMiniBoss ? h('span', { class: 'tag-pill warn' }, '⚠ ' + t('boss.mini')) : null,
      z.hasMegaBoss ? h('span', { class: 'tag-pill alarm' }, '⚠ ' + t('boss.mega')) : null,
    );
    zones.appendChild(h('div', { class: 'zone-card' },
      cv,
      h('div', { class: 'zc-body' },
        h('h3', { class: 'h-title' }, t('strat.zone', { n: z.zone })),
        h('div', null, h('span', { class: 'tag-pill reward' }, t('strat.reward') + ': ' + t('reward.' + z.reward))),
        tags,
      ),
      button(t('strat.enter'), () => p.onEnter(z.zone), 'primary', 'confirm'),
    ));
  }

  return h('div', { class: 'screen bg-menu' },
    h('div', { class: 'screen-head' },
      h('div', null,
        h('h2', { class: 'h-title' }, t('strat.title', { n: floor, name: t(`floor.${floor}.name`) })),
        h('p', { class: 'hint' }, t(`floor.${floor}.desc`)),
      ),
      h('div', { class: 'btn-row' },
        h('span', { class: 'tag-pill reward', style: 'font-size:1rem' }, `${t('strat.score')}: ${st.score}`),
        button(t('strat.menu'), p.onMenu, 'small', 'back'),
      ),
    ),
    h('p', { class: 'hint' }, t('strat.hint')),
    h('div', { class: 'strat-body' }, party, zones),
  );
}

// ───────────────────────────── Fin de planta ─────────────────────────────

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
  const update = (): void => {
    const left = SUMMARY_LOCK_MS - (Date.now() - p.shownAt);
    if (left > 0) {
      cont.disabled = true;
      cont.textContent = t('sum.continueIn', { n: Math.ceil(left / 1000) });
    } else {
      cont.disabled = false;
      cont.textContent = t('sum.continue');
      clearInterval(timer);
    }
  };
  const timer = window.setInterval(update, 150);
  s.onClear(() => clearInterval(timer));
  update();

  const grid = h('div', { class: 'sum-grid' },
    h('span', null, t('sum.time')), h('span', null, fmtTime(st.time)),
    h('span', null, t('sum.kills')), h('span', null, String(st.kills)),
    h('span', null, t('sum.accuracy')), h('span', null, acc),
    h('span', null, t('sum.damage')), h('span', null, String(Math.round(st.damageTaken))),
    h('span', null, t('sum.fallen')), h('span', null, fallen),
    h('span', null, t('sum.gained')), h('span', null, '+' + Math.round(st.scoreGained)),
    h('span', null, t('sum.total')), h('span', null, String(sm.totalScore)),
  );
  return h('div', { class: 'screen bg-dim' },
    h('div', { class: 'panel summary' },
      h('h1', { class: 'h-title' }, t('sum.title')),
      h('p', { class: 'sub' }, t('sum.sub', { floor: sm.floor, zone: sm.zone })),
      grid,
      h('div', { class: 'sum-reward' }, h('b', null, t('sum.reward') + ': '), t('reward.' + sm.reward), h('br'), rewardTo),
      h('div', { class: 'btn-row', style: 'margin-top:0.7rem' }, cont),
    ),
  );
}

// ───────────────────────────── Derrota ─────────────────────────────

export function defeatScreen(p: { floor: number; zone: number; onRetry(): void; onMenu(): void }): HTMLElement {
  return h('div', { class: 'screen bg-defeat defeat' },
    h('div', { class: 'center-col' },
      h('h1', { class: 'h-title' }, t('def.title')),
      h('p', null, t('def.sub', { floor: p.floor, zone: p.zone })),
      h('div', { class: 'btn-row' },
        button(t('def.retry'), p.onRetry, 'primary', 'confirm'),
        button(t('def.menu'), p.onMenu, 'danger', 'back'),
      ),
    ),
  );
}

// ───────────────────────────── Victoria ─────────────────────────────

export function victoryScreen(p: { score: number; onContinue(): void }): HTMLElement {
  return h('div', { class: 'screen bg-victory victory' },
    h('div', { class: 'burst center-col' },
      h('h1', { class: 'h-title' }, t('vic.title')),
      h('p', { class: 'txt' }, t('vic.text')),
      h('p', { class: 'final' }, `${t('vic.score')}: ${p.score}`),
      button(t('vic.continue'), p.onContinue, 'primary', 'confirm'),
    ),
  );
}

// ───────────────────────────── Créditos ─────────────────────────────

export function creditsScreen(p: { onBack(): void }): HTMLElement {
  return h('div', { class: 'screen bg-menu' },
    h('div', { class: 'credits panel' },
      h('h1', { class: 'h-title' }, t('cred.title')),
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
      h('div', { class: 'btn-row', style: 'margin-top:0.8rem' }, button(t('menu.back'), p.onBack, 'primary', 'back')),
    ),
  );
}

// ───────────────────────────── Pausa ─────────────────────────────

export function pauseScreen(p: { onResume(): void; onOptions(): void; onConsole(): void; onQuit(): void }): HTMLElement {
  return h('div', { class: 'screen bg-dim' },
    h('div', { class: 'panel pause-panel' },
      h('h1', { class: 'h-title' }, t('pause.title')),
      button(t('pause.resume'), p.onResume, 'primary', 'confirm'),
      button(t('menu.options'), p.onOptions),
      button(t('pause.console'), p.onConsole),
      button(t('pause.quit'), p.onQuit, 'danger', 'back'),
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

export function optionsScreen(s: Screens, p: OptionsParams): HTMLElement {
  const st = p.settings;
  const msg = h('p', { class: 'opt-msg' });

  const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string): HTMLElement => {
    const val = h('span', { class: 'val' }, fmt(get()));
    const input = h<HTMLInputElement>('input', {
      type: 'range', min, max, step, value: get(),
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
      btns.push(b);
      box.appendChild(b);
    });
    paint();
    return h('div', { class: 'opt-row' }, h('span', { class: 'l' }, label), h('div', { class: 'ctl' }, box));
  };
  const toggle = (label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement =>
    segment<'1' | '0'>(label, [{ v: '1', text: t('opt.on') }, { v: '0', text: t('opt.off') }], () => (get() ? '1' : '0'), (v) => set(v === '1'));

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

  const stopListening = (): void => {
    if (listening) { listening.stop(); listening = null; }
    flags.capturing = false;
    paintBinds();
  };
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
      class: 'btn small', type: 'button',
      onclick: (e: Event) => {
        e.stopPropagation();
        (e.currentTarget as HTMLElement).blur();
        // Si ya se estaba escuchando esta misma acción, se cancela
        if (listening && listening.action === a) { stopListening(); return; }
        uiSound('click');
        // El clic que inicia la escucha no debe contar como asignación de ratón: se arma en el siguiente turno
        window.setTimeout(() => startListening(a), 0);
      },
    }, keyLabel(st.bindings[a]));
    bindBtns.set(a, b);
    bindGrid.appendChild(h('div', { class: 'bind-row' }, h('span', null, t('act.' + a)), b));
  }

  return h('div', { class: 'screen bg-menu' },
    h('div', { class: 'screen-head' },
      h('h2', { class: 'h-title' }, t('opt.title')),
      button(t('opt.back'), () => { stopListening(); p.onBack(); }, 'primary', 'back'),
    ),
    h('div', { class: 'options panel' },
      slider(t('opt.music'), 0, 1, 0.05, () => st.musicVol, (v) => { st.musicVol = v; }, pct),
      slider(t('opt.sfx'), 0, 1, 0.05, () => st.sfxVol, (v) => { st.sfxVol = v; }, pct),
      segment(t('opt.difficulty'), [
        { v: 'easy', text: t('opt.diff.easy') }, { v: 'normal', text: t('opt.diff.normal') }, { v: 'hard', text: t('opt.diff.hard') },
      ], () => st.difficulty, (v) => { st.difficulty = v; }),
      slider(t('opt.sens'), 0.2, 3, 0.05, () => st.sensitivity, (v) => { st.sensitivity = v; }, (v) => v.toFixed(2)),
      toggle(t('opt.subs'), () => st.subtitles, (v) => { st.subtitles = v; }),
      slider(t('opt.uiscale'), 0.8, 1.4, 0.05, () => st.uiScale, (v) => { st.uiScale = v; }, pct),
      toggle(t('opt.colorblind'), () => st.colorblind, (v) => { st.colorblind = v; }),
      toggle(t('opt.shake'), () => st.cameraShake, (v) => { st.cameraShake = v; }),
      segment(t('opt.lang'), [{ v: 'es', text: t('lang.es') }, { v: 'en', text: t('lang.en') }], () => st.lang, (v) => { st.lang = v; }),
      h('h3', { class: 'h-title opt-sec' }, t('opt.controls')),
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
        }, 'small'),
      ),
    ),
  );
}
