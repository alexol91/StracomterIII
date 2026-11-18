// HUD táctico y discreto. Se construye una vez y después solo se escriben en el DOM los valores que cambian.
// Escritorio: escuadra arriba a la izquierda, puntos/tiempo/hostiles arriba a la derecha, brújula, moral y jefe arriba
// al centro, inventario abajo al centro, vida abajo a la izquierda y munición/habilidad abajo a la derecha.
// Táctil: la esquina inferior izquierda (stick) y la franja inferior derecha (botones) son de los mandos, así que
// vida y munición suben a las esquinas superiores (clase `touch` en #hud).

import type { IWorld, Settings } from '../contracts';
import type { ClassId, Entity, GameEvent, ItemType, OrderKind } from '../sim/types';
import { CLASS_IDS } from '../sim/types';
import { CLASS_STATS, isClass } from '../sim/data';
import { fmtTime, h, icon, itemIcon, setBar, setCls, setStyle, setText } from './dom';
import { t } from './i18n';
import { keyLabel } from './settings';

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
    const plWeapon = h('div', { class: 'ammo-w' });
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
    const boss = h('div', { class: 'boss' }, h('div', { class: 'bn' }, icon('warn'), bossName), bossBar.el, bossShield);
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
    const xh = h('div', { class: 'xh' }, ring,
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

    // Abajo al centro: subtítulos, orden, inventario
    const subsBox = h('div', { class: 'subs' });
    const order = h('div', { class: 'order' });
    const invName = h('div', { class: 'inv-name' });
    const slots = [0, 1, 2, 3, 4].map(() => h('div', { class: 'slot' }));
    const bc = h('div', { class: 'hud-bc' }, subsBox, order, invName, h('div', { class: 'inv' }, ...slots));

    this.el.append(vignette, vit, ammo, squad, tr, feedBox, top, xh, streakEl, hit, hurtLayer, prompt, clearedMsg, bc);

    return {
      plName, plHp, plBar, plAmmo, plWeapon, plGren, plWarn, abilLbl, abilBar, allyRows,
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
    const emptyMag = p.mag <= 0;
    setText(r.plAmmo, `${p.mag} / ${p.ammo}`);
    setCls(r.plAmmo, 'empty', emptyMag);
    setText(r.plGren, `×${p.grenades}`);
    let warn = '', crit = false;
    if (p.reloading > 0) warn = t('hud.reloading');
    else if (emptyMag) {
      warn = p.ammo > 0 ? t('hud.empty', { key: keyLabel(s.bindings.reload) }) : t('hud.noAmmo');
      crit = true;
    } else if (p.mag <= Math.max(3, p.magSize * 0.25) && p.ammo > 0) warn = t('hud.reloadHint', { key: keyLabel(s.bindings.reload) });
    setText(r.plWarn, warn);
    setCls(r.plWarn, 'crit', crit);

    // Habilidad de clase
    if (isClass(p.kind)) {
      const ready = p.abilityCd <= 0;
      const max = p.abilityCdMax > 0 ? p.abilityCdMax : 1;
      const nm = t('ability.' + p.kind);
      setText(r.plWeapon, t('weapon.' + p.kind));
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
      if (!c || !e) { setStyle(row.row, 'display', 'none'); continue; }
      setStyle(row.row, 'display', '');
      const dead = !e.alive || e.hp <= 0;
      setText(row.nm, t('kind.' + c));
      setCls(row.row, 'dead', dead);
      const max = e.maxHp || CLASS_STATS[c].hp;
      setBar(row.bar, dead ? 0 : e.hp / max);
      setCls(row.bar.el, 'low', !dead && e.hp / max < 0.3);
      setText(row.gone, dead ? t('hud.fallen') : '');
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
      setText(r.bossName, t('kind.' + boss.kind) + phase);
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
    const showPrompt = world.interactDoor >= 0 && !this.isTouch();
    setCls(r.prompt, 'on', showPrompt);
    if (showPrompt) setText(r.prompt, t('hud.interact', { key: keyLabel(s.bindings.interact) }));

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
