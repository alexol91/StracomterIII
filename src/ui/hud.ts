// HUD de juego. Se construye una vez y después solo se escriben en el DOM los valores que cambian.
// Distribución pensada para móvil en horizontal: jugador y compañeros arriba a la izquierda, puntos/tiempo/enemigos
// arriba a la derecha, moral y jefe arriba al centro, inventario abajo al centro. El centro, la esquina inferior
// izquierda (stick) y la franja inferior derecha (botones táctiles) quedan libres.

import type { IWorld, Settings } from '../contracts';
import type { ClassId, Entity, ItemType, OrderKind } from '../sim/types';
import { CLASS_IDS } from '../sim/types';
import { CLASS_STATS, isClass } from '../sim/data';
import { bar, fmtTime, h, itemClass, itemShort, setBar, setCls, setStyle, setText } from './dom';
import { t } from './i18n';
import { keyLabel } from './settings';

interface Arc { el: HTMLElement; fromX: number; fromY: number; until: number; active: boolean }
interface Sub { text: string; until: number }

const ARC_LIFE = 1.0;       // s
const ARC_POOL = 6;
const SUB_LIFE = 2.6;       // s
const SUB_MAX = 3;
const HIT_LIFE = 0.16;      // s
const VIGNETTE_LIFE = 0.7;  // s

/** Estados de IA que indican que el jefe ya ha detectado al jugador (la IA los etiqueta como texto libre). */
const BOSS_ENGAGED = /attack|ataca|chase|persig|combat|engage|suppress|fire|disp|alert/i;

function normAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
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

  constructor(
    parent: HTMLElement,
    private getSettings: () => Settings,
    private isTouch: () => boolean,
    private onPauseButton: () => void,
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
    for (const a of this.arcs) { a.active = false; a.el.style.opacity = '0'; }
    this.r = this.build();
  }

  // ───────────── construcción ─────────────

  private build() {
    this.el.textContent = '';
    this.arcs = [];

    // Jugador
    const plName = h('span');
    const plHp = h('span', { class: 'hp' });
    const plBar = bar();
    const plAmmo = h('span', { class: 'pl-ammo' });
    const plGren = h('span');
    const plWarn = h('div', { class: 'pl-warn' });
    const abilLbl = h('div', { class: 'abil' });
    const abilBar = bar('thin cd');
    const allies = h('div', { class: 'allies' });
    const allyRows = [0, 1, 2].map(() => {
      const nm = h('span', { class: 'nm' });
      const b = bar('thin');
      const gone = h('span', { class: 'gone' });
      const row = h('div', { class: 'ally hbox' }, nm, h('div', null, b.el, gone));
      allies.appendChild(row);
      return { row, nm, bar: b, gone };
    });
    const tl = h('div', { class: 'hud-tl' },
      h('div', { class: 'hbox' },
        h('div', { class: 'pl-head' }, plName, plHp),
        plBar.el,
        h('div', { class: 'pl-row' }, plAmmo, plGren),
        plWarn,
        abilLbl, abilBar.el,
      ),
      allies,
    );

    // Puntos / tiempo / enemigos / pausa
    const vScore = h('span', { class: 'v' });
    const vTime = h('span', { class: 'v' });
    const vEnemies = h('span', { class: 'v' });
    const stats = h('div', { class: 'stats hbox' },
      h('span', { class: 'k' }, t('hud.score')), vScore,
      h('span', { class: 'k' }, t('hud.time')), vTime,
      h('span', { class: 'k' }, t('hud.enemies')), vEnemies,
    );
    const pauseBtn = h<HTMLButtonElement>('button', {
      class: 'hud-pause', type: 'button', 'aria-label': t('hud.pause'),
      onpointerdown: (e: Event) => { e.stopPropagation(); },
      onclick: (e: Event) => { e.stopPropagation(); (e.currentTarget as HTMLElement).blur(); this.onPauseButton(); },
    }, 'II');
    const tr = h('div', { class: 'hud-tr' }, stats, pauseBtn);

    // Moral y jefe
    const moraleBar = bar('thin blue');
    const bossName = h('div');
    const bossShield = h('div', { class: 'shield' });
    const bossBar = bar('boss');
    const boss = h('div', { class: 'boss hbox' }, bossName, bossBar.el, bossShield);
    const phaseMsg = h('div', { class: 'phase-msg' });
    const tc = h('div', { class: 'hud-tc' },
      h('div', { class: 'morale' }, h('span', null, t('hud.morale')), moraleBar.el),
      boss, phaseMsg,
    );

    // Centro
    const xh = h('div', { class: 'xh' }, h('b'), h('i'));
    const hit = h('div', { class: 'hit' });
    const hurtLayer = h('div', { class: 'hurt-layer' });
    for (let i = 0; i < ARC_POOL; i++) {
      const el = h('div', { class: 'hurt-arc' });
      hurtLayer.appendChild(el);
      this.arcs.push({ el, fromX: 0, fromY: 0, until: -1, active: false });
    }
    const vignette = h('div', { class: 'vignette' });
    const prompt = h('div', { class: 'prompt' });
    const clearedMsg = h('div', { class: 'cleared-msg' }, t('hud.cleared'));

    // Abajo al centro
    const subsBox = h('div', { class: 'subs' });
    const order = h('div', { class: 'order' });
    const invName = h('div', { class: 'inv-name' });
    const slots = [0, 1, 2, 3, 4].map(() => h('div', { class: 'slot' }));
    const bc = h('div', { class: 'hud-bc' }, subsBox, order, invName, h('div', { class: 'inv' }, ...slots));

    this.el.append(vignette, tl, tr, tc, xh, hit, hurtLayer, prompt, clearedMsg, bc);

    return {
      plName, plHp, plBar, plAmmo, plGren, plWarn, abilLbl, abilBar, allyRows,
      vScore, vTime, vEnemies, pauseBtn,
      moraleBar, boss, bossName, bossBar, bossShield, phaseMsg,
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
    // Evita repetir el mismo subtítulo: si ya está, solo se renueva su vida
    const ex = this.subs.find((s) => s.text === text);
    if (ex) { ex.until = now + SUB_LIFE; return; }
    this.subs.push({ text, until: now + SUB_LIFE });
    while (this.subs.length > SUB_MAX) this.subs.shift();
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
            if (e.hit === 'entity') this.hitUntil = now + HIT_LIFE;
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
          if (subsOn && e.team === 'ally' && e.id !== p.id && isClass(e.kind)) this.pushSub(t('sub.allyDown', { name: t('kind.' + e.kind) }), now);
          break;
        case 'phase':
          this.phaseText = t('phase.' + e.phase);
          this.phaseUntil = now + 3;
          break;
        default: break;
      }
    }
  }

  private subThrottled(key: string, now: number, dir: string, minGap: number): void {
    const text = t(key, { dir });
    const last = this.lastSubAt.get(text) ?? -99;
    if (now - last < minGap) return;
    this.lastSubAt.set(text, now);
    this.pushSub(text, now);
  }

  // ───────────── actualización por frame ─────────────

  update(world: IWorld): void {
    const r = this.r;
    const now = world.time;
    const p = world.player;
    const s = this.getSettings();

    // Jugador
    setText(r.plName, t('kind.' + p.kind));
    setText(r.plHp, String(Math.max(0, Math.ceil(p.hp))));
    setBar(r.plBar, p.hp / (p.maxHp || 1));
    setCls(r.plBar.el, 'low', p.hp / (p.maxHp || 1) < 0.3);
    setText(r.plAmmo, `${p.mag} / ${p.ammo}`);
    setText(r.plGren, `${t('hud.grenades')} ×${p.grenades}`);
    let warn = '', crit = false;
    if (p.reloading > 0) warn = t('hud.reloading');
    else if (p.mag <= 0) {
      if (p.ammo > 0) { warn = t('hud.empty', { key: keyLabel(s.bindings.reload) }); crit = true; }
      else { warn = t('hud.noAmmo'); crit = true; }
    }
    setText(r.plWarn, warn);
    setCls(r.plWarn, 'crit', crit);

    // Habilidad de clase
    if (isClass(p.kind)) {
      const ready = p.abilityCd <= 0;
      const max = p.abilityCdMax > 0 ? p.abilityCdMax : 1;
      const nm = t('ability.' + p.kind);
      setText(r.abilLbl, ready ? `[${keyLabel(s.bindings.ability)}] ${nm} — ${t('hud.ready')}` : `${nm} — ${Math.ceil(p.abilityCd)} s`);
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
      if (!c || !e) {
        setStyle(row.row, 'display', 'none');
        continue;
      }
      setStyle(row.row, 'display', '');
      const dead = !e.alive || e.hp <= 0;
      setText(row.nm, t('kind.' + c));
      setCls(row.row, 'dead', dead);
      const max = e.maxHp || CLASS_STATS[c].hp;
      setBar(row.bar, dead ? 0 : e.hp / max);
      setCls(row.bar.el, 'low', !dead && e.hp / max < 0.3);
      setText(row.gone, dead ? t('hud.fallen') : '');
    }

    // Puntos, tiempo, enemigos
    setText(r.vScore, String(Math.round(world.score)));
    setText(r.vTime, fmtTime(world.time));
    setText(r.vEnemies, String(world.enemiesRemaining()));
    setCls(r.pauseBtn, 'show', this.isTouch());

    // Moral
    setBar(r.moraleBar, world.morale / 100);

    // Jefe
    if (boss) {
      setCls(r.boss, 'on', true);
      const phase = boss.kind === 'megaboss' && boss.bossPhase > 0 ? ` · ${t('hud.phase', { n: boss.bossPhase })}` : '';
      setText(r.bossName, t('kind.' + boss.kind) + phase);
      setBar(r.bossBar, boss.hp / (boss.maxHp || 1));
      setText(r.bossShield, boss.shielded ? t('hud.shield') : '');
    } else {
      setCls(r.boss, 'on', false);
    }

    // Fase del ritmo (nada intrusivo: línea pequeña unos segundos)
    const phaseOn = now < this.phaseUntil;
    if (phaseOn) setText(r.phaseMsg, this.phaseText);
    setCls(r.phaseMsg, 'on', phaseOn);

    // Mira y marca de impacto
    setCls(r.xh, 'on-target', world.aim.entityId >= 0);
    setCls(r.hit, 'on', now < this.hitUntil);

    // Arcos de daño recibido: siguen la rotación de la cámara
    for (const a of this.arcs) {
      if (!a.active) continue;
      const life = (a.until - now) / ARC_LIFE;
      if (life <= 0) { a.active = false; setStyle(a.el, 'opacity', '0'); continue; }
      const rel = normAngle(Math.atan2(a.fromY - p.y, a.fromX - p.x) - world.cam.yaw);
      setStyle(a.el, 'transform', `rotate(${rel.toFixed(2)}rad)`);
      setStyle(a.el, 'opacity', (Math.round(Math.min(1, life * 1.4) * 20) / 20).toString());
    }
    // Viñeta roja
    const vl = (this.vigUntil - now) / VIGNETTE_LIFE;
    setStyle(r.vignette, 'opacity', vl > 0 ? (Math.round(vl * this.vigPeak * 20) / 20).toString() : '0');

    // Aviso contextual de puerta (en táctil lo pone el módulo de controles)
    const showPrompt = world.interactDoor >= 0 && !this.isTouch();
    setCls(r.prompt, 'on', showPrompt);
    if (showPrompt) setText(r.prompt, t('hud.interact', { key: keyLabel(s.bindings.interact) }));

    // Zona limpia
    setCls(r.clearedMsg, 'on', world.status === 'cleared');

    // Orden vigente
    setText(r.order, `${t('hud.order')}: ${t('order.' + (world.order.kind as OrderKind))}`);

    // Inventario
    for (let i = 0; i < 5; i++) {
      const it: ItemType | null = p.inventory[i] ?? null;
      const slot = r.slots[i];
      setText(slot, it ? itemShort(it) : '');
      setCls(slot, 'sel', i === p.invSel);
      setCls(slot, 'it-hp', !!it && itemClass(it) === 'it-hp');
      setCls(slot, 'it-ammo', !!it && itemClass(it) === 'it-ammo');
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
