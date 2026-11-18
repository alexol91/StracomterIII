// HUD táctico y discreto. Se construye una vez y después solo se escriben en el DOM los valores que cambian.
// Escritorio: escuadra arriba a la izquierda, puntos/tiempo/hostiles arriba a la derecha, brújula, moral y jefe arriba
// al centro, inventario abajo al centro, vida abajo a la izquierda y munición/habilidad abajo a la derecha.
// Táctil: la esquina inferior izquierda (stick) y la franja inferior derecha (botones) son de los mandos, así que
// vida y munición suben a las esquinas superiores (clase `touch` en #hud).

import type { IWorld, Settings } from '../contracts';
import type { ClassId, Entity, GameEvent, ItemType, OrderKind, Threat } from '../sim/types';
import { CLASS_IDS } from '../sim/types';
import { CLASS_STATS, isClass } from '../sim/data';
import { fmtTime, h, icon, itemIcon, setBar, setCls, setStyle, setText } from './dom';
import { t } from './i18n';
import { actionLabel } from './settings';

interface Arc { el: HTMLElement; fromX: number; fromY: number; until: number; active: boolean }
interface Sub { text: string; until: number }

const ARC_LIFE = 1.0;       // s
const ARC_POOL = 6;
const SUB_LIFE = 2.6;       // s
const SUB_MAX = 3;
const VIGNETTE_LIFE = 0.7;  // s

/** Estados de IA que indican que el jefe ya ha detectado al jugador (la IA los etiqueta como texto libre). */
const BOSS_ENGAGED = /attack|ataca|chase|persig|combat|engage|suppress|fire|disp|alert/i;

function normAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/** Barra segmentada (vida, escuadra, jefe…). */
function sbar(cls = ''): { el: HTMLElement; fill: HTMLElement } {
  const fill = h('i');
  const el = h('div', { class: ('sbar ' + cls).trim() }, fill);
  return { el, fill };
}

export class Hud {
  readonly el: HTMLElement;
  private r!: ReturnType<Hud['build']>;
  private arcs: Arc[] = [];
  private arcNext = 0;
  private subs: Sub[] = [];
  private subsKey = '';
  private hitUntil = -1;
  private vigUntil = -1;
  private vigPeak = 0.5;
  private phaseUntil = -1;
  private phaseText = '';
  private lastSubAt = new Map<string, number>();
  private allyByKind: Partial<Record<ClassId, Entity>> = {};
  private hitRank = 0;           // 1 normal, 2 cabeza, 3 baja, 4 baja de cabeza
  private gapCur = 4;            // separación actual de la retícula (px), interpolada
  private lastT = 0;
  private reloadTotal = 0;
  private reloadPrev = 0;
  private streak = 0;
  private streakAt = -99;
  private feed: { el: HTMLElement; until: number }[] = [];
  private litUntil = -1;          // la lista de armas se ilumina 1,5 s tras cambiar
  private prevWeapon = '';
  // v1.3
  private blindUntil = -1;
  private blindTotal = 1;
  private comboUntil = -1;
  private comboText = '';
  private barkNext = 0;
  private pingNext = 0;
  private barks: { el: HTMLElement; id: number; until: number }[] = [];
  private pings: { el: HTMLElement; x: number; y: number; until: number }[] = [];

  constructor(
    parent: HTMLElement,
    private getSettings: () => Settings,
    private isTouch: () => boolean,
    private onPauseButton: () => void,
    private project: (x: number, y: number, z: number) => { x: number; y: number } | null = () => null,
  ) {
    this.el = h('div', { id: 'hud' });
    parent.appendChild(this.el);
    this.r = this.build();
  }

  show(on: boolean): void { this.el.classList.toggle('on', on); }

  /** Reconstruye los textos (cambio de idioma). El siguiente update() lo rellena todo. */
  relabel(): void { this.r = this.build(); }

  /** Vacía estados temporales al empezar una zona nueva. */
  reset(): void {
    this.subs = [];
    this.subsKey = '';
    this.hitUntil = this.vigUntil = this.phaseUntil = -1;
    this.lastSubAt.clear();
    this.litUntil = -1; this.prevWeapon = ''; this.blindUntil = -1; this.comboUntil = -1;
    this.streak = 0; this.streakAt = -99; this.reloadTotal = 0; this.reloadPrev = 0; this.feed = []; this.lastT = 0;
    this.r = this.build();
  }

  // ───────────── construcción ─────────────

  private build() {
    this.el.textContent = '';
    this.arcs = [];
    this.el.classList.toggle('touch', this.isTouch());

    // Vida (abajo a la izquierda; en táctil, arriba)
    const plName = h('span', { class: 'vit-cls' });
    const plHp = h('span', { class: 'vit-hp' });
    const plBar = sbar();
    const plSprint = h('span', { class: 'sprint-tag' }, t('hud.sprint'));
    const vit = h('div', { class: 'hud-vit hp-box' },
      h('div', { class: 'lbl' }, t('hud.hp'), ' ', plSprint),
      h('div', { class: 'vit-top' }, plHp, plName),
      plBar.el,
    );

    // Munición, arma, granadas y habilidad (abajo a la derecha; en táctil, arriba bajo los puntos)
    const plAmmo = h('div', { class: 'ammo-big' });
    const plWeapon = h('div', { class: 'wlist' });
    // Ranura 4: tipo seleccionado + existencias de las tres granadas (explosiva, cegadora, humo)
    const gst = ['grenade', 'bolt', 'smoke'].map((ic) => {
      const n = h('span');
      return { el: h('span', { class: 'gst' }, icon(ic), n), n };
    });
    const wslots = [0, 1, 2, 3].map((i) => {
      const k = h('span', { class: 'wk' });
      const n = h('span', { class: 'wn' });
      const x = h('span', { class: 'wx' }, ...(i === 3 ? gst.map((g) => g.el) : []));
      const row = h('div', { class: 'wslot' }, k, n, x);
      plWeapon.appendChild(row);
      return { row, k, n, x };
    });
    const plGren = h('span');
    const plWarn = h('div', { class: 'ammo-warn' });
    const abilLbl = h('div');
    const abilBar = sbar('thin cd');
    const ammo = h('div', { class: 'hud-ammo hud-r hp-box' },
      plWeapon, plAmmo,
      h('div', { class: 'ammo-row' }, h('span', null, icon('grenade'), ' ', plGren)),
      plWarn,
      h('div', { class: 'abil' }, abilLbl, abilBar.el),
    );

    // Escuadra (arriba a la izquierda): tres filas finas
    const squad = h('div', { class: 'hud-squad' });
    const allyRows = [0, 1, 2].map(() => {
      const nm = h('span', { class: 'nm' });
      const b = sbar('thin ally');
      const gone = h('span', { class: 'gone' });
      const row = h('div', { class: 'ally' }, nm, h('div', null, b.el, gone));
      squad.appendChild(row);
      return { row, nm, bar: b, gone };
    });

    // Puntos / tiempo / hostiles / pausa (arriba a la derecha)
    const vScore = h('span', { class: 'v' });
    const vTime = h('span', { class: 'v' });
    const vEnemies = h('span', { class: 'v hostile' });
    const stats = h('div', { class: 'stats hud-r hp-box' },
      h('span', { class: 'k' }, t('hud.score')), vScore,
      h('span', { class: 'k' }, t('hud.time')), vTime,
      h('span', { class: 'k' }, t('hud.enemies')), h('span', { class: 'v hostile' }, icon('warn'), vEnemies),
    );
    const pauseBtn = h<HTMLButtonElement>('button', {
      class: 'hud-pause', type: 'button', 'aria-label': t('hud.pause'),
      onpointerdown: (e: Event) => { e.stopPropagation(); },
      onclick: (e: Event) => { e.stopPropagation(); (e.currentTarget as HTMLElement).blur(); this.onPauseButton(); },
    }, 'II');
    const tr = h('div', { class: 'hud-stats' }, stats, pauseBtn);

    // Brújula, moral y jefe (arriba al centro)
    const compass = h('div', { class: 'compass' });
    const moraleBar = sbar('thin mor');
    const bossName = h('span');
    const bossBar = sbar('boss');
    const bossShield = h('div', { class: 'shield' });
    const bossExp = h('div', { class: 'shield exposed' });
    const boss = h('div', { class: 'boss' }, h('div', { class: 'bn' }, icon('warn'), bossName), bossBar.el, bossShield, bossExp);
    const phaseMsg = h('div', { class: 'phase-msg' });
    const chutaos = h('div', { class: 'chutaos' }, t('hud.chutaos'));
    const cheated = h('div', { class: 'chutaos cheated' }, icon('warn'), t('hud.cheats'));
    const top = h('div', { class: 'hud-top' },
      compass,
      h('div', { class: 'morale' }, h('span', null, t('hud.morale')), moraleBar.el),
      boss, phaseMsg, chutaos, cheated,
    );

    // Centro: retícula fina, marca de impacto, arcos de daño, viñeta, avisos
    const ring = h('div', { class: 'xh-ring' });
    const streakEl = h('div', { class: 'streak' });
    const xh = h('div', { class: 'xh' }, ring, h('i', { class: 'ga' }),
      h('i', { class: 't' }), h('i', { class: 'b' }), h('i', { class: 'l' }), h('i', { class: 'r' }), h('i', { class: 'd' }), h('i', { class: 'dia' }));
    const hit = h('div', { class: 'hit' }, h('i', { class: 'hd' }), h('i', { class: 'hr' }));
    const feedBox = h('div', { class: 'killfeed' });
    const hurtLayer = h('div', { class: 'hurt-layer' });
    for (let i = 0; i < ARC_POOL; i++) {
      const el = h('div', { class: 'hurt-arc' });
      hurtLayer.appendChild(el);
      this.arcs.push({ el, fromX: 0, fromY: 0, until: -1, active: false });
    }
    const vignette = h('div', { class: 'vignette' });
    const prompt = h('div', { class: 'prompt' });
    const clearedMsg = h('div', { class: 'cleared-msg' }, t('hud.cleared'));

    // v1.3: voltereta, cegado, luces, avisos de amenaza, combos, reanimar, marcadores proyectados
    const rollFill = h('i');
    const rollInd = h('div', { class: 'roll-ind' }, rollFill);
    const blind = h('div', { class: 'blind' });
    const dark = h('div', { class: 'dark' });
    const edgeWarn = h('div', { class: 'edge-warn' });
    const warnMsg = h('div', { class: 'warnmsg' });
    const comboMsg = h('div', { class: 'combo-msg' });
    const reviveFill = h('i');
    const revive = h('div', { class: 'revive' }, h('div', { class: 'rv-t' }), h('div', { class: 'rv-bar' }, reviveFill));
    const thr = [0, 1, 2, 3].map(() => {
      const inner = h('span', { class: 'thr-i' }, icon('grenade'), h('b', null, '▲'));
      return { el: h('div', { class: 'thr' }, inner), inner };
    });
    const dnMarks = [0, 1, 2].map(() => {
      const sec = h('span');
      return { el: h('div', { class: 'proj dn-mark' }, icon('cross'), sec), sec };
    });
    this.barks = []; this.pings = [];
    const projLayer = h('div', { class: 'proj-layer' });
    for (let i = 0; i < 6; i++) { const el = h('div', { class: 'proj bark' }); projLayer.appendChild(el); this.barks.push({ el, id: -1, until: -1 }); }
    for (let i = 0; i < 3; i++) { const el = h('div', { class: 'proj ping-mark' }); projLayer.appendChild(el); this.pings.push({ el, x: 0, y: 0, until: -1 }); }
    for (const d of dnMarks) projLayer.appendChild(d.el);

    // Abajo al centro: subtítulos, orden, inventario
    const subsBox = h('div', { class: 'subs' });
    const order = h('div', { class: 'order' });
    const invName = h('div', { class: 'inv-name' });
    const slots = [0, 1, 2, 3, 4].map(() => h('div', { class: 'slot' }));
    const bc = h('div', { class: 'hud-bc' }, subsBox, order, invName, h('div', { class: 'inv' }, ...slots));

    this.el.append(vignette, dark, edgeWarn, blind, projLayer, vit, ammo, squad, tr, feedBox, top, xh, rollInd, ...thr.map((x) => x.el), streakEl, hit, hurtLayer, warnMsg, comboMsg, revive, prompt, clearedMsg, bc);

    return {
      plName, plHp, plBar, plAmmo, plWeapon, wslots, gst, plGren,
      rollInd, rollFill, blind, dark, edgeWarn, warnMsg, comboMsg, revive, reviveFill, thr, dnMarks, bossExp, plWarn, abilLbl, abilBar, allyRows,
      vScore, vTime, vEnemies, pauseBtn,
      compass, moraleBar, boss, bossName, bossBar, bossShield, phaseMsg, chutaos, cheated,
      plSprint, ring, streakEl, feedBox,
      xh, hit, vignette, prompt, clearedMsg, subsBox, order, invName, slots,
    };
  }

  // ───────────── sucesos ─────────────

  private relDir(world: IWorld, x: number, y: number): string {
    const p = world.player;
    const rel = normAngle(Math.atan2(y - p.y, x - p.x) - world.cam.yaw);
    // yaw creciente gira a la derecha: rel > 0 queda a la derecha de la cámara
    const a = Math.abs(rel);
    if (a < Math.PI / 4) return t('dir.front');
    if (a > (3 * Math.PI) / 4) return t('dir.back');
    return rel > 0 ? t('dir.right') : t('dir.left');
  }

  private pushSub(text: string, now: number): void {
    const ex = this.subs.find((s) => s.text === text);
    if (ex) { ex.until = now + SUB_LIFE; return; }
    this.subs.push({ text, until: now + SUB_LIFE });
    while (this.subs.length > SUB_MAX) this.subs.shift();
  }

  private subThrottled(key: string, now: number, dir: string, minGap: number): void {
    const text = t(key, { dir });
    const last = this.lastSubAt.get(text) ?? -99;
    if (now - last < minGap) return;
    this.lastSubAt.set(text, now);
    this.pushSub(text, now);
  }

  /** Lee world.events (los del último step). Llamar tras CADA paso. */
  onEvents(world: IWorld): void {
    const evs = world.events;
    if (!evs || evs.length === 0) return;
    const now = world.time;
    const p = world.player;
    const subsOn = this.getSettings().subtitles;
    for (const e of evs) {
      switch (e.type) {
        case 'hurt': {
          // Impacto del jugador sobre otro: aspa blanca (normal) o ámbar con rombo (cabeza)
          if (e.attackerId === p.id && e.id !== p.id) { this.mark(e.zone === 'head' ? 2 : 1, now); break; }
          if (e.id !== p.id) break;
          this.vigUntil = now + VIGNETTE_LIFE;
          this.vigPeak = Math.min(0.95, 0.35 + e.amount / 40);
          const dx = e.fromX - p.x, dy = e.fromY - p.y;
          if (dx * dx + dy * dy > 0.25) {
            const a = this.arcs[this.arcNext];
            this.arcNext = (this.arcNext + 1) % this.arcs.length;
            a.fromX = e.fromX; a.fromY = e.fromY; a.until = now + ARC_LIFE; a.active = true;
            if (subsOn && e.zone !== 'blast') this.subThrottled('sub.shotAtYou', now, this.relDir(world, e.fromX, e.fromY), 1.5);
          }
          break;
        }
        case 'shot': {
          if (e.id === p.id) {
            if (e.hit === 'entity') this.mark(1, now);
          } else if (subsOn && e.team === 'enemy') {
            const d = Math.hypot(e.fx - p.x, e.fy - p.y);
            if (d < 40) this.subThrottled('sub.shots', now, this.relDir(world, e.fx, e.fy), 1.2);
          }
          break;
        }
        case 'explosion':
          if (subsOn && Math.hypot(e.x - p.x, e.y - p.y) < 45) this.subThrottled('sub.explosion', now, this.relDir(world, e.x, e.y), 0.8);
          break;
        case 'door':
          if (subsOn && Math.hypot(e.x - p.x, e.y - p.y) < 14) this.subThrottled('sub.door', now, this.relDir(world, e.x, e.y), 1.0);
          break;
        case 'alert':
          if (subsOn) this.pushSub(t('sub.seen'), now);
          break;
        case 'bossPhase':
          if (subsOn) this.pushSub(t('sub.reinforce'), now);
          break;
        case 'death':
          this.onDeath(world, e);
          if (subsOn && e.team === 'ally' && e.id !== p.id && isClass(e.kind)) this.pushSub(t('sub.allyDown', { name: t('kind.' + e.kind) }), now);
          break;
        case 'flash':
          if ((e.playerBlind ?? 0) > 0) { this.blindUntil = now + e.playerBlind; this.blindTotal = e.playerBlind; }
          break;
        case 'combo':
          this.comboText = `${t('hud.combo')} — ${t('combo.' + e.key)}`;
          this.comboUntil = now + 1.5;
          break;
        case 'ping': {
          const pg = this.pings[this.pingNext];
          this.pingNext = (this.pingNext + 1) % this.pings.length;
          pg.x = e.x; pg.y = e.y; pg.until = now + 2;
          pg.el.textContent = '';
          pg.el.appendChild(icon(e.what === 'enemy' ? 'target' : e.what === 'door' ? 'door' : e.what === 'item' ? 'ammo' : 'arrow'));
          break;
        }
        case 'bark': {
          const sp = world.entityById(e.id);
          if (!sp) break;
          if (e.team === 'enemy' && Math.hypot(sp.x - p.x, sp.y - p.y) > 35) break;
          const full = 'bark.' + e.key;
          const tr = t(full);
          const text = tr === full ? e.key : tr; // clave desconocida: se muestra la clave
          const b = this.barks[this.barkNext];
          this.barkNext = (this.barkNext + 1) % this.barks.length;
          b.id = e.id; b.until = now + 1.6;
          b.el.textContent = text;
          b.el.classList.toggle('foe', e.team === 'enemy');
          if (subsOn) this.pushSub(`${t('kind.' + sp.kind)}: «${text}»`, now);
          break;
        }
        case 'weaponSwitch':
          if (e.id === p.id) this.litUntil = now + 1.5;
          break;
        case 'phase':
          this.phaseText = t('phase.' + e.phase);
          this.phaseUntil = now + 3;
          break;
        default: break;
      }
    }
  }

  /** Marca de impacto: gana la de mayor rango dentro de su ventana (normal < cabeza < baja < baja de cabeza). */
  private mark(rank: number, now: number): void {
    if (now < this.hitUntil && rank < this.hitRank) return;
    this.hitRank = rank;
    this.hitUntil = now + (rank >= 3 ? 0.25 : 0.12);
  }

  private onDeath(world: IWorld, e: Extract<GameEvent, { type: 'death' }>): void {
    const now = world.time;
    const p = world.player;
    const killerId = e.killerId ?? -1;
    const head = !!e.headshot;
    if (killerId === p.id && e.id !== p.id) {
      this.mark(head ? 4 : 3, now);
      this.streak = now - this.streakAt < 4 ? this.streak + 1 : 1;
      this.streakAt = now;
      const el = this.r.streakEl;
      el.textContent = '×' + this.streak;
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); // reinicia la animación
    }
    // Registro de bajas
    const killer = killerId >= 0 ? world.entityById(killerId) : undefined;
    const victim = t('kind.' + e.kind);
    const text = killer ? `${t('kind.' + killer.kind)} ▸ ${victim}` : `▸ ${victim}`;
    const cls = e.team === 'ally' ? 'loss' : killerId === p.id ? 'mine' : '';
    const line = h('div', { class: 'kf ' + cls }, head ? icon('head') : null, text);
    this.r.feedBox.appendChild(line);
    this.feed.push({ el: line, until: now + 4 });
    while (this.feed.length > 5) this.feed.shift()!.el.remove();
  }

  /** Coloca (o esconde) un elemento proyectado en pantalla. */
  private place(el: HTMLElement, pr: { x: number; y: number } | null): void {
    if (!pr) { setStyle(el, 'display', 'none'); return; }
    setStyle(el, 'display', 'flex');
    setStyle(el, 'transform', `translate(${Math.round(pr.x)}px, ${Math.round(pr.y)}px) translate(-50%, -100%)`);
  }

  // ───────────── actualización por frame ─────────────

  update(world: IWorld): void {
    const r = this.r;
    const now = world.time;
    const p = world.player;
    const s = this.getSettings();

    // Vida
    const hpFrac = p.hp / (p.maxHp || 1);
    setText(r.plName, t('kind.' + p.kind));
    setText(r.plHp, String(Math.max(0, Math.ceil(p.hp))));
    setBar(r.plBar, hpFrac);
    setCls(r.plBar.el, 'low', hpFrac < 0.3);

    // Munición
    // Armas estilo CS: 1 principal, 2 pistola, 3 cuchillo, 4 granada. La activa resalta; la lista se ilumina 1,5 s al cambiar.
    const wpn = p.weapon ?? 'primary';
    if (this.prevWeapon !== '' && this.prevWeapon !== wpn) this.litUntil = Math.max(this.litUntil, now + 1.5);
    this.prevWeapon = wpn;
    const order = ['primary', 'secondary', 'knife', 'grenade'] as const;
    const slotActs = ['slot1', 'slot2', 'slot3', 'slot4'] as const;
    let primaryName = t('hud.pistol');
    if (isClass(p.kind)) {
      const vk = `weapon.${p.kind}.${p.primaryVariant ?? 0}`;
      primaryName = t(vk) === vk ? t('weapon.' + p.kind) : t(vk);
    }
    const gType = p.grenadeType ?? 'frag';
    const gCounts = [p.grenades, p.flashes ?? 0, p.smokes ?? 0];
    const gSel = gType === 'flash' ? 1 : gType === 'smoke' ? 2 : 0;
    const slotNames = [primaryName, t('hud.pistol'), t('hud.knife'), t('gren.' + gType)];
    for (let i = 0; i < 4; i++) {
      const ws = r.wslots[i];
      setText(ws.k, actionLabel(slotActs[i], s.bindings));
      setText(ws.n, slotNames[i]);
      setCls(ws.row, 'act', order[i] === wpn);
      setCls(ws.row, 'off', i === 3 && gCounts[gSel] <= 0);
    }
    setCls(r.plWeapon, 'lit', now < this.litUntil);
    for (let i = 0; i < 3; i++) { setText(r.gst[i].n, String(gCounts[i])); setCls(r.gst[i].el, 'sel', i === gSel); }

    // Contador grande: munición del arma ACTIVA (principal mag/reserva, pistola mag2/∞, cuchillo y granada sin cargador)
    let big = '';
    let emptyMag = false;
    let reloadable = true;
    if (wpn === 'secondary') { big = `${p.mag2 ?? 0} / ∞`; emptyMag = (p.mag2 ?? 0) <= 0; }
    else if (wpn === 'knife') { big = '—'; reloadable = false; }
    else if (wpn === 'grenade') { big = `×${gCounts[gSel]}`; reloadable = false; emptyMag = gCounts[gSel] <= 0; }
    else { big = `${p.mag} / ${p.ammo}`; emptyMag = p.mag <= 0; }
    setText(r.plAmmo, big);
    setCls(r.plAmmo, 'empty', emptyMag);
    setText(r.plGren, `×${gCounts[gSel]}`);
    const hasReserve = wpn === 'secondary' ? true : p.ammo > 0;
    const magSz = wpn === 'secondary' ? (p.magSize2 ?? 0) : p.magSize;
    const magNow = wpn === 'secondary' ? (p.mag2 ?? 0) : p.mag;
    let warn = '', crit = false;
    if (reloadable) {
      if (p.reloading > 0) warn = t('hud.reloading');
      else if (emptyMag) {
        warn = hasReserve ? t('hud.empty', { key: actionLabel('reload', s.bindings) }) : t('hud.noAmmo');
        crit = true;
      } else if (magNow <= Math.max(3, magSz * 0.25) && hasReserve) warn = t('hud.reloadHint', { key: actionLabel('reload', s.bindings) });
    }
    setText(r.plWarn, warn);
    setCls(r.plWarn, 'crit', crit);

    // Habilidad de clase
    if (isClass(p.kind)) {
      const ready = p.abilityCd <= 0;
      const max = p.abilityCdMax > 0 ? p.abilityCdMax : 1;
      const nm = t('ability.' + p.kind);
      setText(r.abilLbl, ready ? `[${actionLabel('ability', s.bindings)}] ${nm} — ${t('hud.ready')}` : `${nm} — ${Math.ceil(p.abilityCd)} s`);
      setBar(r.abilBar, ready ? 1 : 1 - p.abilityCd / max);
      setCls(r.abilBar.el, 'ready', ready);
      setCls(r.abilBar.el, 'cd', !ready);
    }

    // Un solo recorrido de entidades: compañeros y jefe
    const allyByKind = this.allyByKind;
    allyByKind.captain = allyByKind.technic = allyByKind.especialist = allyByKind.explosives = undefined;
    let boss: Entity | null = null;
    let bossD = Infinity;
    for (const e of world.entities) {
      if (e.team === 'ally') {
        if (!e.isPlayer && isClass(e.kind)) allyByKind[e.kind] = e;
      } else if (e.alive && (e.kind === 'miniboss' || e.kind === 'megaboss')) {
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        const engaged = d < 20 || BOSS_ENGAGED.test(e.aiState || '');
        if (engaged && d < bossD) { boss = e; bossD = d; }
      }
    }

    // Compañeros
    const others = CLASS_IDS.filter((c) => c !== p.kind);
    for (let i = 0; i < 3; i++) {
      const row = r.allyRows[i];
      const c = others[i];
      const e = c ? allyByKind[c] : undefined;
      if (!c || !e) { setStyle(row.row, 'display', 'none'); continue; }
      setStyle(row.row, 'display', '');
      const dead = !e.alive || e.hp <= 0;
      const down = !dead && !!e.downed;
      setText(row.nm, t('kind.' + c));
      setCls(row.row, 'dead', dead);
      const max = e.maxHp || CLASS_STATS[c].hp;
      setBar(row.bar, dead || down ? 0 : e.hp / max);
      setCls(row.bar.el, 'low', !dead && e.hp / max < 0.3);
      setText(row.gone, dead ? t('hud.fallen') : down ? `${t('hud.downed')} ${Math.max(0, Math.ceil((e.downedUntil ?? 0) - now))} s` : '');
    }

    // Puntos, tiempo, hostiles
    setText(r.vScore, String(Math.round(world.score)));
    setText(r.vTime, fmtTime(world.time));
    setText(r.vEnemies, String(world.enemiesRemaining()));
    setCls(r.pauseBtn, 'show', this.isTouch());

    // Brújula (marcas que se desplazan con la cámara) y moral
    setStyle(r.compass, '--k', (Math.round((-world.cam.yaw * 180 / Math.PI) / 15 * 20) / 20).toString());
    setBar(r.moraleBar, world.morale / 100);
    setCls(r.chutaos, 'on', !!world.cheats?.chutaos);

    // Jefe
    if (boss) {
      setCls(r.boss, 'on', true);
      const phase = boss.kind === 'megaboss' && boss.bossPhase > 0 ? ` · ${t('hud.phase', { n: boss.bossPhase })}` : '';
      let bn = t('kind.' + boss.kind);
      const own = boss.bossName ?? '';
      if (own) { const k = own.startsWith('boss.') ? own : 'boss.' + own; if (t(k) !== k) bn = t(k); }
      setText(r.bossName, bn + phase);
      const exposed = (boss.exposedUntil ?? 0) > now || /recarga|aturdid|reload|stun/i.test(boss.aiState || '');
      setText(r.bossExp, boss.enraged ? t('hud.enraged') + (exposed ? ' · ' + t('hud.exposed') : '') : exposed ? t('hud.exposed') : '');
      setBar(r.bossBar, boss.hp / (boss.maxHp || 1));
      setText(r.bossShield, boss.shielded ? t('hud.shield') : '');
    } else {
      setCls(r.boss, 'on', false);
    }

    // Fase del ritmo (línea pequeña unos segundos)
    const phaseOn = now < this.phaseUntil;
    if (phaseOn) setText(r.phaseMsg, this.phaseText);
    setCls(r.phaseMsg, 'on', phaseOn);

    // Retícula dinámica: separación (px) = tan(dispersión) / tan(fov/2) × alto/2, mínimo 4, interpolada
    const dtT = Math.min(0.1, Math.max(0, now - this.lastT));
    this.lastT = now;
    const fov = (world.cam.fov ?? 60) * Math.PI / 180;
    const spread = Math.max(0, p.spread ?? 0);
    const target = Math.max(4, (Math.tan(spread) / Math.tan(fov / 2)) * (window.innerHeight / 2));
    this.gapCur += (target - this.gapCur) * Math.min(1, dtT * 16);
    setStyle(r.xh, '--gap', (Math.round(this.gapCur * 2) / 2) + 'px');
    setCls(r.xh, 'on-target', world.aim.entityId >= 0);
    setCls(r.xh, 'aim', !!p.aiming);
    setCls(r.xh, 'knife', wpn === 'knife');
    setCls(r.xh, 'gren', wpn === 'grenade');
    setCls(r.xh, 'draw', (p.drawUntil ?? 0) > now);
    setCls(r.xh, 'sprint', !!p.sprinting);
    setCls(r.plSprint, 'on', !!p.sprinting);

    // Anillo de progreso de la recarga (la duración total es el valor de `reloading` cuando empieza)
    if (p.reloading > 0) {
      if (this.reloadPrev <= 0 || p.reloading > this.reloadPrev + 0.05) this.reloadTotal = p.reloading;
      const prog = this.reloadTotal > 0 ? 1 - p.reloading / this.reloadTotal : 0;
      setStyle(r.ring, '--p', (Math.round(prog * 100) / 100).toString());
      setCls(r.ring, 'on', true);
    } else {
      setCls(r.ring, 'on', false);
    }
    this.reloadPrev = p.reloading;

    // Marca de impacto
    const hitOn = now < this.hitUntil;
    setCls(r.hit, 'on', hitOn);
    setCls(r.hit, 'head', hitOn && (this.hitRank === 2 || this.hitRank === 4));
    setCls(r.hit, 'kill', hitOn && this.hitRank >= 3);

    // Racha de bajas
    const sl = this.streakAt + 4 - now;
    if (this.streak >= 2 && sl > 0) { setCls(r.streakEl, 'on', true); setStyle(r.streakEl, 'opacity', (Math.round(Math.min(1, sl) * 10) / 10).toString()); }
    else { setCls(r.streakEl, 'on', false); if (sl <= 0) this.streak = 0; }

    // Registro de bajas: cada línea se desvanece (CSS) y se retira a los 4 s
    while (this.feed.length && this.feed[0].until <= now) this.feed.shift()!.el.remove();
    setCls(r.cheated, 'on', !!world.cheated);

    // Arcos de daño recibido: siguen la rotación de la cámara
    for (const a of this.arcs) {
      if (!a.active) continue;
      const life = (a.until - now) / ARC_LIFE;
      if (life <= 0) { a.active = false; setStyle(a.el, 'opacity', '0'); continue; }
      const rel = normAngle(Math.atan2(a.fromY - p.y, a.fromX - p.x) - world.cam.yaw);
      setStyle(a.el, 'transform', `rotate(${rel.toFixed(2)}rad)`);
      setStyle(a.el, 'opacity', (Math.round(Math.min(1, life * 1.4) * 20) / 20).toString());
    }
    const vl = (this.vigUntil - now) / VIGNETTE_LIFE;
    setStyle(r.vignette, 'opacity', vl > 0 ? (Math.round(vl * this.vigPeak * 20) / 20).toString() : '0');

    // Aviso contextual de puerta (en táctil lo pone el módulo de controles)
    const reviving = (world.interactRevive ?? -1) >= 0;
    const showPrompt = world.interactDoor >= 0 && !this.isTouch() && !reviving;
    setCls(r.prompt, 'on', showPrompt);
    setCls(r.revive, 'on', reviving);
    if (reviving) {
      const tgt = world.entityById(world.interactRevive);
      setText(r.revive.firstElementChild as HTMLElement, this.isTouch() ? t('hud.downed') : t('hud.revive', { key: actionLabel('interact', s.bindings) }));
      setStyle(r.reviveFill, 'width', Math.round(Math.min(1, Math.max(0, tgt?.reviveProgress ?? 0)) * 100) + '%');
    }
    if (showPrompt) setText(r.prompt, t('hud.interact', { key: actionLabel('interact', s.bindings) }));

    // ── v1.3 ──
    // Voltereta: marca junto a la retícula que se rellena con rollCd (1,5 s) y desaparece al estar lista
    const rcd = p.rollCd ?? 0;
    setCls(r.rollInd, 'on', rcd > 0);
    if (rcd > 0) setStyle(r.rollFill, 'width', Math.round((1 - Math.min(1, rcd / 1.5)) * 100) + '%');

    // Cegado: pantalla en blanco que se desvanece (con «reducir destellos»: gris al 50 %)
    const reduce = !!s.reduceFlashes;
    const brem = this.blindUntil - now;
    const bop = brem > 0 ? Math.min(1, brem / (this.blindTotal * 0.7)) * (reduce ? 0.5 : 1) : 0;
    setStyle(r.blind, 'background', reduce ? '#808080' : '#ffffff');
    setStyle(r.blind, 'opacity', (Math.round(bop * 20) / 20).toString());

    // Luces apagadas por el Hackeo
    setCls(r.dark, 'on', (world.lightsOffUntil ?? 0) > now);

    // Combo
    const comboOn = now < this.comboUntil;
    if (comboOn) setText(r.comboMsg, this.comboText);
    setCls(r.comboMsg, 'on', comboOn);

    // Amenazas: granada (icono + flecha junto a la retícula), láser (te apuntan), embestida/barrido (apártate)
    let nb = 0, aimed = false, dodge = false;
    const threats: Threat[] = world.threats ?? [];
    for (const th of threats) {
      if (th.kind === 'blast') {
        if (nb < r.thr.length && Math.hypot(th.x - p.x, th.y - p.y) <= th.r + 1) {
          const rel = normAngle(Math.atan2(th.y - p.y, th.x - p.x) - world.cam.yaw);
          const ti = r.thr[nb++];
          setStyle(ti.el, 'transform', `rotate(${rel.toFixed(2)}rad)`);
          setStyle(ti.inner, 'transform', `rotate(${(-rel).toFixed(2)}rad)`);
          setStyle(ti.el, 'display', 'block');
        }
      } else {
        const d = segDist(p.x, p.y, th.fx, th.fy, th.x, th.y);
        if (th.kind === 'laser') { if (d <= 1.5) aimed = true; }
        else if (d <= th.r / 2 + 0.5) dodge = true;
      }
    }
    for (let i = nb; i < r.thr.length; i++) setStyle(r.thr[i].el, 'display', 'none');
    setCls(r.edgeWarn, 'on', aimed);
    setCls(r.warnMsg, 'on', aimed || dodge);
    if (aimed || dodge) setText(r.warnMsg, dodge ? t('hud.dodge') : t('hud.aimedAt'));

    // Marcadores proyectados: frases sobre quien habla, pings y compañeros derribados
    for (const b of this.barks) {
      const ent = b.until > now ? world.entityById(b.id) : undefined;
      const pr = ent ? this.project(ent.x, ent.y, 2.2) : null;
      this.place(b.el, pr);
    }
    for (const pg of this.pings) {
      const pr = pg.until > now ? this.project(pg.x, pg.y, 1.0) : null;
      this.place(pg.el, pr);
    }
    let dn = 0;
    for (const e of world.entities) {
      if (dn >= r.dnMarks.length) break;
      if (e.team !== 'ally' || e.isPlayer || !e.alive || !e.downed) continue;
      const m = r.dnMarks[dn++];
      setText(m.sec, String(Math.max(0, Math.ceil((e.downedUntil ?? 0) - now))));
      this.place(m.el, this.project(e.x, e.y, 1.6));
    }
    for (let i = dn; i < r.dnMarks.length; i++) this.place(r.dnMarks[i].el, null);

    // Zona limpia
    setCls(r.clearedMsg, 'on', world.status === 'cleared');

    // Orden vigente
    setText(r.order, `${t('hud.order')}: ${t('order.' + (world.order.kind as OrderKind))}`);

    // Inventario: cinco ranuras pequeñas con icono + cantidad
    for (let i = 0; i < 5; i++) {
      const it: ItemType | null = p.inventory[i] ?? null;
      const slot = r.slots[i];
      const key = it ?? '';
      if (slot.dataset.it !== key) {
        slot.dataset.it = key;
        slot.textContent = '';
        if (it) { slot.appendChild(itemIcon(it)); slot.appendChild(document.createTextNode(it.slice(it.indexOf('_') + 1))); }
      }
      setCls(slot, 'sel', i === p.invSel);
    }
    const sel = p.inventory[p.invSel] ?? null;
    setText(r.invName, sel ? t('item.' + sel) : '');

    // Subtítulos: se reescriben solo cuando cambia el conjunto visible
    if (s.subtitles) {
      this.subs = this.subs.filter((x) => x.until > now);
      const key = this.subs.map((x) => x.text).join('\n');
      if (key !== this.subsKey) {
        this.subsKey = key;
        r.subsBox.textContent = '';
        for (const x of this.subs) r.subsBox.appendChild(h('div', { class: 'sub' }, x.text));
      }
    } else if (this.subsKey !== '') {
      this.subsKey = '';
      this.subs = [];
      r.subsBox.textContent = '';
    }
  }
}

/** Distancia de un punto a un segmento. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const u = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
}
