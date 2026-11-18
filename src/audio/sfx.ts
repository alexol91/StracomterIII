// Efectos de sonido sintetizados con Web Audio (sin ficheros de terceros).
// Posicional "barato": paneo estéreo + atenuación por distancia + pasa-bajos para lo lejano/trasero.

import type { IWorld } from '../contracts';
import type { GameEvent, Kind } from '../sim/types';

const MAX_VOICES = 24;       // polifonía normal de efectos
const MAX_VOICES_PRIO = 32;  // tope para sonidos del jugador / interfaz
const MAX_DIST = 45;         // más allá no se oye
const SAME_TYPE_LIMIT = 4;   // sucesos del mismo tipo reproducidos por llamada (los más cercanos)
const STEP_RANGE = 14;

type FilterT = BiquadFilterType;

/** Ruta de un sonido: ganancia de entrada -> pasa-bajos -> paneo -> bus de efectos. */
interface Route {
  in: GainNode;
  t: number;
  pv: number;  // variación de tono de esta instancia
  len: number; // duración total programada (para liberar)
  finish(): void;
}

interface Item {
  key: string;
  d: number;
  own: boolean;
  play: () => void;
}

interface ShotDef {
  nt: FilterT; nf0: number; nf1: number; nq: number; nd: number; ng: number;
  tw: OscillatorType; tf0: number; tf1: number; td: number; tg: number;
  extra?: 'whoosh' | 'double' | 'pop';
}

// Un disparo = ráfaga de ruido filtrado (el "chasquido") + un golpe tonal con caída de tono (el "cuerpo").
const SHOTS: Record<string, ShotDef> = {
  captain:     { nt: 'bandpass', nf0: 2200, nf1: 1200, nq: 0.9, nd: 0.09, ng: 0.55, tw: 'triangle', tf0: 200, tf1: 70, td: 0.09, tg: 0.5 },
  technic:     { nt: 'highpass', nf0: 4500, nf1: 3000, nq: 0.7, nd: 0.05, ng: 0.4, tw: 'square', tf0: 1400, tf1: 600, td: 0.035, tg: 0.1 },
  especialist: { nt: 'lowpass', nf0: 2500, nf1: 300, nq: 0.8, nd: 0.2, ng: 0.75, tw: 'sine', tf0: 120, tf1: 38, td: 0.18, tg: 0.7 },
  explosives:  { nt: 'lowpass', nf0: 900, nf1: 200, nq: 0.7, nd: 0.12, ng: 0.35, tw: 'sine', tf0: 160, tf1: 40, td: 0.28, tg: 0.9, extra: 'pop' },
  enemy1:      { nt: 'bandpass', nf0: 1500, nf1: 900, nq: 0.9, nd: 0.06, ng: 0.32, tw: 'triangle', tf0: 230, tf1: 110, td: 0.06, tg: 0.28 },
  enemy2:      { nt: 'bandpass', nf0: 1900, nf1: 1000, nq: 0.9, nd: 0.08, ng: 0.5, tw: 'triangle', tf0: 190, tf1: 80, td: 0.08, tg: 0.42 },
  enemy3:      { nt: 'lowpass', nf0: 3000, nf1: 400, nq: 0.8, nd: 0.14, ng: 0.75, tw: 'sine', tf0: 130, tf1: 50, td: 0.14, tg: 0.65 },
  miniboss:    { nt: 'lowpass', nf0: 1200, nf1: 250, nq: 0.7, nd: 0.35, ng: 0.5, tw: 'sine', tf0: 100, tf1: 35, td: 0.35, tg: 0.6, extra: 'whoosh' },
  megaboss:    { nt: 'lowpass', nf0: 2200, nf1: 350, nq: 0.8, nd: 0.1, ng: 0.85, tw: 'sawtooth', tf0: 95, tf1: 45, td: 0.1, tg: 0.4, extra: 'double' },
};

export class Sfx {
  private noise: AudioBuffer;
  private active = 0;

  constructor(private ctx: AudioContext, private out: AudioNode) {
    // Un único buffer de ruido blanco de 3 s, reutilizado por todos los efectos.
    const n = Math.floor(ctx.sampleRate * 3);
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
  }

  // ───────────────────────── Ruta posicional ─────────────────────────

  private route(
    world: IWorld | null, pos: { x: number; y: number } | null, vol: number,
    opt: { prio?: boolean; novar?: boolean } = {},
  ): Route | null {
    const limit = opt.prio ? MAX_VOICES_PRIO : MAX_VOICES;
    if (this.active >= limit) return null;
    const c = this.ctx;
    let pan = 0;
    let gain = vol;
    let cutoff = 20000;
    if (pos) {
      // Sin cámara no sabemos desde dónde se oye: por defecto, no suena (restrictivo).
      if (!world) return null;
      const cam = world.cam;
      const dx = pos.x - cam.x, dy = pos.y - cam.y;
      const d = Math.hypot(dx, dy);
      if (!(d < MAX_DIST)) return null;
      const fade = d > 35 ? (MAX_DIST - d) / 10 : 1;
      gain = vol * fade / (1 + d / 6);
      if (d > 0.5) {
        // derecha del oyente = (-sin yaw, cos yaw); frente = (cos yaw, sin yaw)
        const lateral = (dx * -Math.sin(cam.yaw) + dy * Math.cos(cam.yaw)) / d;
        const front = (dx * Math.cos(cam.yaw) + dy * Math.sin(cam.yaw)) / d;
        pan = Math.max(-1, Math.min(1, lateral * 0.9 * Math.min(1, d / 2)));
        cutoff = 16000 / (1 + d / 12);
        if (front < 0) {
          cutoff *= Math.max(0.35, 1 + front * 0.65);
          gain *= 1 + front * 0.15;
        }
        cutoff = Math.max(700, cutoff);
      }
    }
    if (!(gain > 0.004)) return null;
    if (!opt.novar) gain *= 0.88 + Math.random() * 0.24;

    const input = c.createGain();
    input.gain.value = gain;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.Q.value = 0.5;
    input.connect(lp);
    let tail: AudioNode = lp;
    let panner: StereoPannerNode | null = null;
    if (typeof c.createStereoPanner === 'function') {
      panner = c.createStereoPanner();
      panner.pan.value = pan;
      lp.connect(panner);
      tail = panner;
    }
    tail.connect(this.out);
    this.active++;
    const self = this;
    const r: Route = {
      in: input,
      t: c.currentTime + 0.005,
      pv: opt.novar ? 1 : 0.94 + Math.random() * 0.12,
      len: 0.05,
      finish() {
        setTimeout(() => {
          self.active = Math.max(0, self.active - 1);
          try { tail.disconnect(); lp.disconnect(); input.disconnect(); } catch { /* ya desconectado */ }
        }, (r.len + 0.25) * 1000);
      },
    };
    return r;
  }

  // ───────────────────────── Primitivas ─────────────────────────

  private osc(r: Route, type: OscillatorType, f0: number, f1: number, dt: number, dur: number, vol: number, att = 0.004): void {
    const c = this.ctx;
    const t = r.t + dt;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0 * r.pv), t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * r.pv), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(att, dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(r.in);
    o.start(t);
    o.stop(t + dur + 0.02);
    r.len = Math.max(r.len, dt + dur + 0.02);
  }

  private nz(r: Route, dt: number, dur: number, vol: number, ft: FilterT, f0: number, f1: number, q = 1, att = 0.003): void {
    const c = this.ctx;
    const t = r.t + dt;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = ft;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(att, dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(r.in);
    s.start(t, Math.random() * 1.4);
    s.stop(t + dur + 0.02);
    r.len = Math.max(r.len, dt + dur + 0.02);
  }

  /** Reproduce `fn` en una ruta nueva (si hay voz libre). */
  private play(world: IWorld | null, pos: { x: number; y: number } | null, vol: number, fn: (r: Route) => void, opt: { prio?: boolean; novar?: boolean } = {}): void {
    const r = this.route(world, pos, vol, opt);
    if (!r) return;
    try { fn(r); } finally { r.finish(); }
  }

  // ───────────────────────── Sonidos concretos ─────────────────────────

  private shot(r: Route, kind: Kind): void {
    const p = SHOTS[kind] ?? SHOTS.enemy2;
    this.nz(r, 0, p.nd, p.ng, p.nt, p.nf0, p.nf1, p.nq);
    this.osc(r, p.tw, p.tf0, p.tf1, 0, p.td, p.tg);
    if (p.extra === 'pop') this.osc(r, 'triangle', 420, 120, 0, 0.05, 0.3);
    if (p.extra === 'whoosh') this.nz(r, 0.03, 0.5, 0.3, 'bandpass', 500, 2600, 0.8, 0.12);
    if (p.extra === 'double') {
      this.nz(r, 0.07, p.nd, p.ng * 0.8, p.nt, p.nf0, p.nf1, p.nq);
      this.osc(r, p.tw, p.tf0, p.tf1, 0.07, p.td, p.tg * 0.8);
    }
  }

  private explosion(r: Route): void {
    this.nz(r, 0, 1.4, 1.0, 'lowpass', 2400, 90, 0.7, 0.01);
    this.nz(r, 0, 0.25, 0.6, 'bandpass', 1200, 500, 0.6);
    this.osc(r, 'sine', 90, 28, 0, 0.7, 1.0, 0.006);
    this.osc(r, 'triangle', 55, 25, 0.05, 0.9, 0.5, 0.02);
  }

  private deathSound(r: Route, ally: boolean): void {
    // Quejido sintético: sierra con vibrato y barrido descendente por un filtro (formante grosero).
    const c = this.ctx;
    const t = r.t;
    const f0 = ally ? 330 : 200, f1 = ally ? 150 : 70, dur = ally ? 0.6 : 0.5;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * r.pv, t);
    o.frequency.exponentialRampToValueAtTime(f1 * r.pv, t + dur);
    const lfo = c.createOscillator();
    lfo.frequency.value = ally ? 9 : 6;
    const lg = c.createGain();
    lg.gain.value = ally ? 12 : 8;
    lfo.connect(lg);
    lg.connect(o.frequency);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(ally ? 900 : 500, t);
    f.frequency.exponentialRampToValueAtTime(ally ? 350 : 220, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.7, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f);
    f.connect(g);
    g.connect(r.in);
    o.start(t); lfo.start(t);
    o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
    r.len = Math.max(r.len, dur + 0.05);
    this.nz(r, 0.0, 0.18, 0.4, 'lowpass', 500, 200); // golpe del cuerpo al caer (ligero)
    if (!ally) this.osc(r, 'sine', 90, 40, 0.25, 0.3, 0.4);
  }

  private ability(r: Route, a: 'orders' | 'hack' | 'suppress' | 'demolition', ok: boolean): void {
    if (!ok) {
      this.osc(r, 'sawtooth', 180, 120, 0, 0.18, 0.35);
      this.osc(r, 'sawtooth', 170, 100, 0.2, 0.22, 0.35);
      return;
    }
    switch (a) {
      case 'orders': // tres notas de radio ascendentes
        [520, 660, 800].forEach((f, i) => this.osc(r, 'square', f, f, i * 0.09, 0.09, 0.14));
        this.nz(r, 0, 0.3, 0.06, 'highpass', 3000, 3000);
        break;
      case 'hack': // arpegio digital rápido
        for (let i = 0; i < 8; i++) this.osc(r, 'square', 900 + ((i * 5) % 7) * 220, 900 + ((i * 3) % 5) * 260, i * 0.045, 0.04, 0.1);
        this.osc(r, 'sine', 300, 1800, 0.36, 0.25, 0.2);
        break;
      case 'suppress': // ráfaga grave de pulsos
        for (let i = 0; i < 6; i++) {
          this.nz(r, i * 0.07, 0.06, 0.45, 'bandpass', 1200, 700, 1);
          this.osc(r, 'sawtooth', 120, 60, i * 0.07, 0.06, 0.3);
        }
        break;
      case 'demolition': // tres pitidos y un golpe seco
        for (let i = 0; i < 3; i++) this.osc(r, 'square', 880, 880, i * 0.14, 0.07, 0.15);
        this.osc(r, 'sine', 120, 35, 0.45, 0.35, 0.8);
        this.nz(r, 0.45, 0.2, 0.4, 'lowpass', 1800, 200);
        break;
    }
  }

  // ───────────────────────── Sucesos del juego ─────────────────────────

  private posOf(world: IWorld, id: number): { x: number; y: number } | null {
    try {
      const e = world.entityById(id);
      return e ? { x: e.x, y: e.y } : null;
    } catch { return null; }
  }

  /** Convierte un suceso en algo reproducible (o null si no suena). */
  private describe(e: GameEvent, world: IWorld): Item | null {
    const pid = world.player.id;
    const cam = world.cam;
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - cam.x, p.y - cam.y);
    // Suceso de una entidad, localizada por id
    const ent = (key: string, id: number, vol: number, fn: (r: Route) => void, opt: { maxD?: number; prio?: boolean } = {}): Item | null => {
      if (id === pid) return { key, d: 0, own: true, play: () => this.play(world, null, vol * 1.2, fn, { prio: true }) };
      const p = this.posOf(world, id);
      if (!p) return null;
      const d = dist(p);
      if (opt.maxD !== undefined && d > opt.maxD) return null;
      return { key, d, own: false, play: () => this.play(world, p, vol, fn) };
    };
    const at = (key: string, x: number, y: number, vol: number, fn: (r: Route) => void, own = false): Item => {
      const p = { x, y };
      return own
        ? { key, d: 0, own: true, play: () => this.play(world, null, vol * 1.2, fn, { prio: true }) }
        : { key, d: dist(p), own: false, play: () => this.play(world, p, vol, fn) };
    };
    const global = (key: string, vol: number, fn: (r: Route) => void): Item =>
      ({ key, d: 0, own: true, play: () => this.play(world, null, vol, fn, { prio: true, novar: true }) });

    switch (e.type) {
      case 'shot': {
        const kind = e.kind;
        const fn = (r: Route) => this.shot(r, kind);
        if (e.id === pid) return { key: 'shot', d: 0, own: true, play: () => this.play(world, null, 1.3, fn, { prio: true }) };
        return at('shot', e.fx, e.fy, 1.0, fn);
      }
      case 'dryfire':
        return ent('dryfire', e.id, 0.5, (r) => {
          this.nz(r, 0, 0.02, 0.6, 'highpass', 3000, 3000);
          this.osc(r, 'square', 1300, 900, 0, 0.015, 0.15);
        }, { maxD: 25 });
      case 'explosion':
        return at('explosion', e.x, e.y, 1.5, (r) => this.explosion(r));
      case 'knife': {
        const hit = e.hit;
        return ent('knife', e.id, 0.7, (r) => {
          this.nz(r, 0, 0.16, 0.5, 'bandpass', 2500, 6000, 1.5, 0.05);
          if (hit) {
            this.nz(r, 0.07, 0.09, 0.6, 'lowpass', 900, 250);
            this.osc(r, 'triangle', 220, 90, 0.07, 0.08, 0.35);
          }
        }, { maxD: 30 });
      }
      case 'reload':
        return ent('reload', e.id, 0.5, (r) => {
          this.nz(r, 0, 0.03, 0.5, 'bandpass', 2600, 2200, 2);          // quitar cargador
          this.osc(r, 'square', 700, 500, 0, 0.02, 0.08);
          this.nz(r, 0.28, 0.07, 0.35, 'bandpass', 1500, 2500, 1.5, 0.02); // meter cargador
          this.nz(r, 0.45, 0.03, 0.55, 'highpass', 2500, 2500);           // cerrojo
          this.osc(r, 'square', 900, 600, 0.45, 0.02, 0.1);
        }, { maxD: 30 });
      case 'door': {
        const open = e.open;
        return at('door', e.x, e.y, 0.8, (r) => {
          this.osc(r, 'sawtooth', open ? 70 : 95, open ? 95 : 65, 0, 0.35, 0.18, 0.05); // chirrido grave
          this.nz(r, 0, 0.35, 0.12, 'bandpass', 600, 900, 3, 0.1);
          if (!open) { // el golpe seco del cierre
            this.nz(r, 0.33, 0.08, 0.5, 'lowpass', 700, 200);
            this.osc(r, 'sine', 110, 50, 0.33, 0.1, 0.4);
          } else {
            this.nz(r, 0, 0.05, 0.35, 'lowpass', 1200, 400); // pestillo
          }
        });
      }
      case 'step': {
        if (e.id !== pid && dist({ x: e.x, y: e.y }) > STEP_RANGE) return null;
        return at('step', e.x, e.y, 0.2, (r) => {
          this.nz(r, 0, 0.06, 0.5, 'lowpass', 450 + Math.random() * 150, 180, 0.8, 0.01);
        }, e.id === pid);
      }
      case 'hurt': {
        const heavy = e.zone === 'head' || e.zone === 'blast';
        if (e.id === pid) {
          return { key: 'hurt', d: 0, own: true, play: () => this.play(world, null, 1.3, (r) => {
            this.osc(r, 'sine', 170, 55, 0, 0.18, 0.8);
            this.nz(r, 0, 0.14, 0.6, 'bandpass', 900, 400, 1);
            this.osc(r, 'sawtooth', 260, 120, 0.01, 0.12, 0.2);
            if (heavy) this.osc(r, 'sine', 70, 35, 0.05, 0.3, 0.5);
          }, { prio: true }) };
        }
        return ent('hurt', e.id, 0.7, (r) => {
          this.nz(r, 0, 0.1, 0.55, 'lowpass', 600, 200);
          this.osc(r, 'sine', 140, 70, 0, 0.1, 0.35);
        }, { maxD: 35 });
      }
      case 'death': {
        const ally = e.team === 'ally';
        if (e.id === pid) return { key: 'death', d: 0, own: true, play: () => this.play(world, null, 1.0, (r) => this.deathSound(r, true), { prio: true }) };
        return at('death', e.x, e.y, 1.0, (r) => this.deathSound(r, ally));
      }
      case 'pickup':
        return at('pickup', e.x, e.y, 0.6, (r) => {
          this.osc(r, 'sine', 660, 660, 0, 0.09, 0.3);
          this.osc(r, 'sine', 990, 990, 0.08, 0.14, 0.3);
          this.osc(r, 'triangle', 1980, 1980, 0.08, 0.12, 0.08);
        }, e.id === pid);
      case 'itemUsed':
        return ent('itemUsed', e.id, 0.6, (r) => {
          this.osc(r, 'triangle', 400, 900, 0, 0.22, 0.3, 0.03);
          this.osc(r, 'sine', 800, 1600, 0.08, 0.2, 0.12, 0.03);
          this.nz(r, 0, 0.15, 0.1, 'highpass', 4000, 6000);
        }, { maxD: 25 });
      case 'throw':
        return ent('throw', e.id, 0.7, (r) => {
          this.nz(r, 0, 0.25, 0.5, 'bandpass', 700, 1600, 1, 0.08);
          this.osc(r, 'sine', 200, 120, 0, 0.1, 0.2);
        }, { maxD: 35 });
      case 'ability': {
        const a = e.ability, ok = e.ok;
        return at('ability', e.x, e.y, 0.9, (r) => this.ability(r, a, ok), e.id === pid);
      }
      case 'breach':
        return at('breach', e.x, e.y, 1.3, (r) => {
          this.nz(r, 0, 1.3, 0.9, 'lowpass', 700, 120, 0.7, 0.05);
          this.osc(r, 'sine', 70, 30, 0, 0.8, 0.8);
          for (let i = 0; i < 7; i++) this.nz(r, 0.15 + i * 0.12 + Math.random() * 0.08, 0.07, 0.3, 'bandpass', 900 + Math.random() * 1500, 400, 1.5); // cascotes
        });
      case 'order':
        return global('order', 0.5, (r) => {
          this.nz(r, 0, 0.12, 0.12, 'highpass', 2500, 2500);
          this.osc(r, 'sine', 1400, 1400, 0.01, 0.06, 0.3);
          this.osc(r, 'sine', 1100, 1100, 0.09, 0.07, 0.3);
        });
      case 'bossPhase':
        return global('bossPhase', 0.9, (r) => {
          const o = this.ctx.createOscillator();
          o.type = 'sawtooth';
          const t = r.t;
          for (let i = 0; i < 4; i++) {
            o.frequency.setValueAtTime(300, t + i * 0.3);
            o.frequency.linearRampToValueAtTime(620, t + i * 0.3 + 0.28);
          }
          const f = this.ctx.createBiquadFilter();
          f.type = 'lowpass'; f.frequency.value = 1800;
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.3, t + 0.05);
          g.gain.setValueAtTime(0.3, t + 1.0);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
          o.connect(f); f.connect(g); g.connect(r.in);
          o.start(t); o.stop(t + 1.35);
          r.len = Math.max(r.len, 1.4);
          this.nz(r, 0, 1.5, 0.7, 'lowpass', 500, 90, 0.7, 0.1); // rugido
          this.osc(r, 'sine', 60, 30, 0, 1.2, 0.8, 0.1);
        });
      case 'alert':
        return at('alert', e.x, e.y, 1.1, (r) => {
          this.osc(r, 'square', 880, 880, 0, 0.07, 0.2);
          this.osc(r, 'square', 1320, 1320, 0.09, 0.11, 0.2);
        });
      case 'cleared':
        return global('cleared', 0.8, (r) => {
          [523, 659, 784, 1047].forEach((f, i) => {
            this.osc(r, 'triangle', f, f, i * 0.12, i === 3 ? 0.6 : 0.16, 0.3, 0.01);
            this.osc(r, 'square', f, f, i * 0.12, i === 3 ? 0.6 : 0.16, 0.06, 0.01);
          });
        });
      case 'playerDead':
        return global('playerDead', 0.9, (r) => {
          this.osc(r, 'sawtooth', 220, 40, 0, 1.4, 0.35, 0.05);
          this.osc(r, 'sine', 80, 25, 0, 1.6, 0.7, 0.05);
          this.nz(r, 0, 1.0, 0.3, 'lowpass', 1200, 80);
        });
      default:
        return null;
    }
  }

  handleEvents(world: IWorld): void {
    if (this.ctx.state !== 'running') return;
    const evs = world.events;
    if (!evs || evs.length === 0) return;
    const groups = new Map<string, Item[]>();
    for (const e of evs) {
      let it: Item | null = null;
      try { it = this.describe(e, world); } catch { it = null; }
      if (!it) continue;
      const g = groups.get(it.key);
      if (g) g.push(it); else groups.set(it.key, [it]);
    }
    for (const arr of groups.values()) {
      arr.sort((a, b) => a.d - b.d);
      let n = 0;
      for (const it of arr) {
        if (it.own) { it.play(); continue; }
        if (n >= SAME_TYPE_LIMIT) break;
        n++;
        it.play();
      }
    }
  }

  // ───────────────────────── Interfaz ─────────────────────────

  ui(sound: 'click' | 'confirm' | 'back' | 'error' | 'reward' | 'victory' | 'defeat'): void {
    if (this.ctx.state !== 'running') return;
    this.play(null, null, 0.6, (r) => {
      switch (sound) {
        case 'click':
          this.osc(r, 'square', 1200, 900, 0, 0.03, 0.12);
          this.nz(r, 0, 0.02, 0.2, 'highpass', 4000, 4000);
          break;
        case 'confirm':
          this.osc(r, 'triangle', 660, 660, 0, 0.08, 0.3);
          this.osc(r, 'triangle', 990, 990, 0.07, 0.14, 0.3);
          break;
        case 'back':
          this.osc(r, 'triangle', 700, 700, 0, 0.07, 0.25);
          this.osc(r, 'triangle', 470, 470, 0.07, 0.1, 0.25);
          break;
        case 'error':
          this.osc(r, 'sawtooth', 160, 130, 0, 0.14, 0.3);
          this.osc(r, 'sawtooth', 150, 110, 0.15, 0.2, 0.3);
          break;
        case 'reward':
          [784, 988, 1175, 1568, 1976].forEach((f, i) => {
            this.osc(r, 'sine', f, f, i * 0.07, 0.25, 0.25);
            this.osc(r, 'triangle', f * 2, f * 2, i * 0.07, 0.12, 0.05);
          });
          break;
        case 'victory':
          [[523, 0], [659, 0.15], [784, 0.3], [1047, 0.45], [784, 0.7], [1047, 0.85], [1319, 1.0]].forEach(([f, t], i, a) => {
            const last = i === a.length - 1;
            this.osc(r, 'sawtooth', f, f, t, last ? 1.2 : 0.2, 0.12, 0.01);
            this.osc(r, 'triangle', f / 2, f / 2, t, last ? 1.2 : 0.2, 0.2, 0.01);
          });
          break;
        case 'defeat':
          [[392, 0], [349, 0.3], [311, 0.6], [196, 0.95]].forEach(([f, t], i, a) => {
            const last = i === a.length - 1;
            this.osc(r, 'sawtooth', f, f * 0.98, t, last ? 1.4 : 0.32, 0.12, 0.02);
            this.osc(r, 'sine', f / 2, f / 2, t, last ? 1.4 : 0.32, 0.3, 0.02);
          });
          break;
      }
    }, { prio: true, novar: true });
  }
}
