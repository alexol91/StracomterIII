// Efectos de sonido sintetizados con Web Audio (sin ficheros de terceros).
// Posicional "barato": paneo estéreo + atenuación por distancia + pasa-bajos para lo lejano/trasero.

import type { IWorld } from '../contracts';
import type { GameEvent, Kind } from '../sim/types';
import type { Samples } from './samples';

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

const ROOM_LEVEL = { mid: 1.6, big: 1.9, ext: 1.2 };
const HEAVY = new Set<string>(['enemy3', 'especialist', 'megaboss', 'explosives', 'miniboss']);
const SINGLE = new Set<string>(['enemy1', 'enemy3']);
const AUTO = new Set<string>(['captain', 'technic', 'especialist', 'enemy2', 'megaboss']);

export class Sfx {
  private noise: AudioBuffer;
  private active = 0;
  // Estado de limitación de cadencia y del Modo Chutaos
  private lastHurt = new Map<number, number>();
  private lastShot = new Map<number, number>();
  private mv = new Map<number, { src: AudioBufferSourceNode; g: GainNode; last: number }>();
  private chutVoices = 0;
  private lastChut = false;
  private lastWorld: IWorld | null = null;
  private lastStepV = -9;
  private lastSexo = -9;
  private lastGo = -9;
  private shotgunIds = new Set<number>();
  private skip = new Set<GameEvent>();
  private lastCasing = -9;
  private lastProg = -9;
  private tickN = 0;
  private lastTick = -9;
  private nextBeep = new Map<number, number>();
  private lastConfirm = -9;
  /** Capas sintetizadas (transitorio, sub-grave, mecánica, cola de sala, casquillos). Apagable. */
  layers = true;
  private duck: GainNode;
  private roomIn: GainNode;
  private roomOut: GainNode;
  private conv: ConvolverNode;
  private roomProfile: 'mid' | 'big' | 'ext' = 'mid';
  private irCache = new Map<string, AudioBuffer>();

  constructor(private ctx: AudioContext, private out: AudioNode, private samples: Samples) {
    // Un único buffer de ruido blanco de 3 s, reutilizado por todos los efectos.
    const n = Math.floor(ctx.sampleRate * 3);
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
    // Nodo de «ducking» entre los efectos y el bus (atenuación breve tras una explosión cercana)
    this.duck = ctx.createGain();
    this.duck.connect(out);
    this.out = this.duck;
    // Cola de sala: UN ConvolverNode con respuesta generada por código, compartido por todos los disparos.
    this.roomIn = ctx.createGain();
    this.conv = ctx.createConvolver();
    this.roomOut = ctx.createGain();
    this.roomOut.gain.value = ROOM_LEVEL.mid;
    this.conv.buffer = this.makeIR('mid');
    this.roomIn.connect(this.conv);
    this.conv.connect(this.roomOut);
    this.roomOut.connect(this.out);
  }

  setLayers(on: boolean): void { this.layers = on; }

  private makeIR(p: 'mid' | 'big' | 'ext'): AudioBuffer {
    const cached = this.irCache.get(p);
    if (cached) return cached;
    const sr = this.ctx.sampleRate;
    const len = p === 'ext' ? 0.3 : p === 'big' ? 1.0 : 0.65;
    const n = Math.floor(sr * len);
    const buf = this.ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let prev = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const x = Math.random() * 2 - 1;
        const fadeIn = Math.min(1, t / 0.004);
        if (p === 'mid') d[i] = x * Math.exp(-t * 6.5) * fadeIn;
        else if (p === 'big') { // metálica: brillante, con reflexiones tempranas
          d[i] = (x - 0.6 * prev) * Math.exp(-t * 5) * fadeIn;
          prev = x;
        } else { // exterior: casi sin cola y un eco corto («slap») a ~120 ms
          d[i] = x * Math.exp(-t * 18) * 0.08 * fadeIn;
          if (t >= 0.12 && t < 0.15) d[i] += x * Math.exp(-(t - 0.12) * 80) * 0.7;
        }
      }
      if (p === 'big') for (const tt of [0.011 + c * 0.003, 0.023, 0.037 + c * 0.004]) d[Math.floor(sr * tt)] += 0.9;
      if (p === 'mid') for (const tt of [0.008 + c * 0.002, 0.019]) d[Math.floor(sr * tt)] += 0.6;
    }
    this.irCache.set(p, buf);
    return buf;
  }

  /** Elige el tipo de sala según el tema del nivel (solo reconstruye si cambia). */
  private setRoom(world: IWorld): void {
    const theme = (world.level as { theme?: string } | undefined)?.theme;
    const p: 'mid' | 'big' | 'ext' = theme === 'azotea' ? 'ext' : theme === 'datos' ? 'big' : 'mid';
    if (p === this.roomProfile) return;
    this.roomProfile = p;
    this.conv.buffer = this.makeIR(p);
    this.roomOut.gain.value = ROOM_LEVEL[p];
  }

  // ───────────────────────── Ruta posicional ─────────────────────────

  private route(
    world: IWorld | null, pos: { x: number; y: number } | null, vol: number,
    opt: { prio?: boolean; novar?: boolean; room?: number } = {},
  ): Route | null {
    const limit = opt.prio ? MAX_VOICES_PRIO : MAX_VOICES;
    if (this.active >= limit) return null;
    const c = this.ctx;
    let pan = 0;
    let dd = 0;
    let gain = vol;
    let cutoff = 20000;
    if (pos) {
      // Sin cámara no sabemos desde dónde se oye: por defecto, no suena (restrictivo).
      if (!world) return null;
      const cam = world.cam;
      const dx = pos.x - cam.x, dy = pos.y - cam.y;
      const d = Math.hypot(dx, dy);
      dd = d;
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
        if (d > 25) cutoff *= 0.6; // lo lejano, más apagado
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
    // Envío a la cola de sala (compartida): lo lejano lleva más cola; lo propio, menos.
    if (opt.room && this.layers && this.roomIn) {
      const sendG = c.createGain();
      sendG.gain.value = opt.room * (pos ? 0.6 + Math.min(1.5, dd / 20) : 1) * (dd > 25 ? 1.5 : 1);
      tail.connect(sendG);
      sendG.connect(this.roomIn);
    }
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
  private play(world: IWorld | null, pos: { x: number; y: number } | null, vol: number, fn: (r: Route) => void, opt: { prio?: boolean; novar?: boolean; room?: number } = {}): void {
    const r = this.route(world, pos, vol, opt);
    if (!r) return;
    try { fn(r); } finally { r.finish(); }
  }

  /** Reproduce una muestra en la ruta. Devuelve false si aún no está cargada. */
  private smp(r: Route, name: string, rate: number, vol: number): boolean {
    const b = this.samples.get(name);
    if (!b) return false;
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate * r.pv;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    s.connect(g);
    g.connect(r.in);
    s.start(r.t);
    r.len = Math.max(r.len, b.duration / (rate * r.pv) + 0.02);
    return true;
  }

  /** Voz de broma (Modo Chutaos): máx. 6 a la vez. */
  private voice(world: IWorld, pos: { x: number; y: number } | null, name: string, vol: number): boolean {
    const b = this.samples.get(name);
    if (!b || this.chutVoices >= 6) return false;
    const r = this.route(world, pos, vol, { prio: !pos });
    if (!r) return false;
    this.smp(r, name, 1, 1);
    this.chutVoices++;
    setTimeout(() => { this.chutVoices = Math.max(0, this.chutVoices - 1); }, b.duration * 1000 + 150);
    r.finish();
    return true;
  }

  /** Voz de ametralladora de broma: una sola instancia por tirador mientras siga disparando. */
  private machineVoice(world: IWorld, id: number, pos: { x: number; y: number } | null): void {
    const now = this.ctx.currentTime;
    const st = this.mv.get(id);
    if (st) {
      if (now - st.last <= 0.6) { st.last = now; return; }
      this.cutMv(id, st);
    }
    const b = this.samples.get('v:machine');
    if (!b || this.chutVoices >= 6) return;
    const r = this.route(world, pos, 0.9, { prio: !pos });
    if (!r) return;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = r.pv;
    const g = this.ctx.createGain();
    src.connect(g);
    g.connect(r.in);
    const entry = { src, g, last: now };
    this.mv.set(id, entry);
    this.chutVoices++;
    src.onended = () => {
      if (this.mv.get(id) === entry) this.mv.delete(id);
      this.chutVoices = Math.max(0, this.chutVoices - 1);
      r.len = 0;
      r.finish();
    };
    src.start(r.t);
  }

  private cutMv(id: number, st: { src: AudioBufferSourceNode; g: GainNode }): void {
    this.mv.delete(id);
    try {
      const t = this.ctx.currentTime;
      st.g.gain.cancelScheduledValues(t);
      st.g.gain.setValueAtTime(st.g.gain.value, t);
      st.g.gain.linearRampToValueAtTime(0, t + 0.08);
      st.src.stop(t + 0.09);
    } catch { /* ya parada */ }
  }

  // ───────────────────────── Sonidos concretos ─────────────────────────

  private shot(r: Route, kind: Kind, own: boolean, weapon?: string): void {
    // Cuerpo: muestra original (pistola para armas de un tiro, ametralladora para automáticas).
    let sampled = false;
    const sec = weapon === 'secondary';
    if (sec) { // pistola secundaria: más seca y aguda que el fusil
      const old = Math.random() < 0.25 && this.samples.get('pistolOld');
      sampled = this.smp(r, old ? 'pistolOld' : 'pistol', 1.15, 0.9);
    } else if (SINGLE.has(kind) || !SHOTS[kind]) {
      const old = Math.random() < 0.25 && this.samples.get('pistolOld');
      const shotgun = kind === 'enemy3';
      if (this.smp(r, old ? 'pistolOld' : 'pistol', shotgun ? 0.794 : 1, shotgun ? 1.0 : 0.9)) {
        sampled = true;
        if (shotgun) this.osc(r, 'sine', 120, 45, 0, 0.22, 0.45); // más cuerpo
      }
    } else if (AUTO.has(kind)) {
      const base = kind === 'megaboss' ? 0.8 : kind === 'especialist' ? 0.9 : kind === 'technic' ? 1.1 : 1;
      // variación por disparo: tono ±3 % (sobre la de la ruta) y nivel ±1 dB
      const rate = base * (0.97 + Math.random() * 0.06) / r.pv;
      const lvl = 0.9 * Math.pow(10, (Math.random() * 2 - 1) / 20);
      sampled = this.smp(r, 'machine', rate, lvl);
    }
    if (!sampled) this.shotSynth(r, sec ? 'technic' : kind);
    if (this.layers) this.shotLayers(r, kind, own, sampled, sec);
  }

  /** Capas sintetizadas sobre el cuerpo: transitorio, sub-grave, mecánica y casquillo del jugador. */
  private shotLayers(r: Route, kind: Kind, own: boolean, sampled: boolean, sec = false): void {
    const heavy = !sec && HEAVY.has(kind);
    if (sec) this.nz(r, 0, 0.012, 0.55, 'bandpass', 3800, 3000, 1.5, 0.0005); // chasquido marcado
    this.osc(r, 'square', 2600, 1400, 0, 0.004, 0.12, 0.0005);                  // clic del transitorio
    this.nz(r, 0, 0.007, own ? 0.5 : 0.35, 'highpass', 5000, 5000, 0.7, 0.0005); // golpe seco en agudos
    if (sampled || !SHOTS[kind]) this.osc(r, 'sine', heavy ? 65 : 85, heavy ? 38 : 50, 0, heavy ? 0.09 : 0.07, heavy ? 0.5 : 0.22, 0.003); // sub-grave
    this.nz(r, 0.04, 0.03, 0.07, 'bandpass', 3500, 3000, 3, 0.002);              // mecánica (muy baja)
    // Casquillo: solo disparos del jugador con pistola/automática, como mucho 1 cada 0,12 s
    if (own && (sec || AUTO.has(kind) || SINGLE.has(kind)) && this.ctx.currentTime - this.lastCasing >= 0.12) {
      this.lastCasing = this.ctx.currentTime;
      const dt = 0.25 + Math.random() * 0.15;
      const f = 4200 + Math.random() * 2600;
      this.osc(r, 'sine', f, f * 0.97, dt, 0.06, 0.05, 0.001);
      this.osc(r, 'sine', f * 1.52, f * 1.5, dt + 0.012, 0.045, 0.03, 0.001);
      this.nz(r, dt, 0.02, 0.05, 'highpass', 6000, 6000, 1, 0.001);
    }
  }

  private shotSynth(r: Route, kind: Kind): void {
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

  /** Explosión por capas. `delay` = retardo por distancia (d/340 s); el filtrado lo hace la ruta. */
  private explosion(r: Route, delay: number): void {
    this.nz(r, delay, 0.02, 1.0, 'highpass', 3000, 3000, 0.7, 0.0005);           // crack inicial
    this.osc(r, 'square', 2200, 900, delay, 0.006, 0.2, 0.0005);
    this.osc(r, 'sine', 90, 35, delay, 0.6, 1.0, 0.006);                          // cuerpo grave con caída
    this.osc(r, 'triangle', 55, 25, delay + 0.05, 0.9, 0.45, 0.02);
    this.nz(r, delay, 1.2, 1.0, 'lowpass', 4000, 300, 0.7, 0.01);                 // ruido que se oscurece
    const n = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) { // escombros cayendo
      this.nz(r, delay + 0.3 + Math.random() * 0.9, 0.04 + Math.random() * 0.05, 0.18 + Math.random() * 0.17,
        'bandpass', 800 + Math.random() * 1700, 400, 1.5, 0.002);
    }
  }

  /** Pitido de oído tenue y ducking de los efectos (explosión cercana, cegado). */
  private stun(world: IWorld, ring = 1.0, duckFor = 0.4): void {
    const t = this.ctx.currentTime;
    const g = this.duck.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.45, t + 0.05);
    g.setValueAtTime(0.45, t + duckFor);
    g.linearRampToValueAtTime(1, t + duckFor + 0.4);
    this.play(world, null, 1, (r) => this.osc(r, 'sine', 4000, 3900, 0.05, ring, 0.04, 0.05), { prio: true, novar: true });
  }

  /** Estampido único de escopeta: grave y ancho, en lugar de N disparos. */
  private blast(r: Route, own: boolean): void {
    if (!this.smp(r, 'pistol', 0.65, 1.1)) this.nz(r, 0, 0.2, 0.8, 'bandpass', 1200, 500, 0.7);
    this.osc(r, 'sine', 75, 32, 0, 0.3, 0.8, 0.004);
    this.nz(r, 0, 0.28, 0.7, 'lowpass', 1800, 250, 0.7, 0.003);
    this.nz(r, 0, 0.008, own ? 0.6 : 0.4, 'highpass', 4500, 4500, 0.7, 0.0005);
  }

  /** Sonido de saque por ranura (< 200 ms, discreto). */
  private weaponSwitchSound(r: Route, w: string): void {
    switch (w) {
      case 'secondary': // funda + clic corto
        this.nz(r, 0, 0.06, 0.3, 'bandpass', 1200, 700, 1.2, 0.01);
        this.nz(r, 0.08, 0.02, 0.4, 'highpass', 3000, 3000);
        this.osc(r, 'square', 1500, 1000, 0.08, 0.01, 0.04, 0.0005);
        break;
      case 'knife': // siseo metálico breve
        this.nz(r, 0, 0.13, 0.3, 'bandpass', 4500, 7000, 3, 0.03);
        break;
      case 'grenade': // clic de anilla suave
        this.nz(r, 0, 0.025, 0.3, 'bandpass', 2800, 2200, 3);
        this.osc(r, 'sine', 2000, 1700, 0.02, 0.03, 0.05, 0.001);
        break;
      default: // fusil: roce de correa + clic metálico
        this.nz(r, 0, 0.09, 0.3, 'bandpass', 900, 500, 1, 0.02);
        this.nz(r, 0.1, 0.025, 0.45, 'highpass', 2800, 2800);
        this.nz(r, 0.1, 0.04, 0.25, 'lowpass', 900, 300);
    }
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
    if (!ok) { // fallo: clic seco y golpe sordo
      this.nz(r, 0, 0.03, 0.5, 'bandpass', 1500, 1000, 2);
      this.osc(r, 'triangle', 140, 90, 0, 0.12, 0.25);
      return;
    }
    switch (a) {
      case 'orders': // radio: clic, estática breve, clic
        this.nz(r, 0, 0.02, 0.5, 'highpass', 2500, 2500);
        this.nz(r, 0.03, 0.2, 0.14, 'bandpass', 1800, 1500, 1.5);
        this.osc(r, 'sine', 900, 900, 0.05, 0.12, 0.08);
        this.nz(r, 0.26, 0.02, 0.4, 'highpass', 2500, 2500);
        break;
      case 'hack': // teclado y relés: clics rápidos
        for (let i = 0; i < 7; i++) this.nz(r, i * 0.05 + Math.random() * 0.02, 0.02, 0.4, 'highpass', 3000 + Math.random() * 2000, 3000, 1);
        this.nz(r, 0.4, 0.05, 0.5, 'lowpass', 1500, 400);
        break;
      case 'suppress': // ráfaga grave de pulsos
        for (let i = 0; i < 6; i++) {
          this.nz(r, i * 0.07, 0.06, 0.45, 'bandpass', 1200, 700, 1);
          this.osc(r, 'sawtooth', 120, 60, i * 0.07, 0.06, 0.25);
        }
        break;
      case 'demolition': // tres pulsos de temporizador y carga
        for (let i = 0; i < 3; i++) this.nz(r, i * 0.14, 0.025, 0.5, 'bandpass', 1400, 1400, 3);
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
  private describe(e: GameEvent, world: IWorld, chut: boolean): Item | null {
    const pid = world.player.id;
    const cam = world.cam;
    const now = this.ctx.currentTime;
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - cam.x, p.y - cam.y);
    const hasV = (n: string) => chut && this.samples.get(n) !== null;
    // Suceso de una entidad, localizada por id
    const ent = (key: string, id: number, vol: number, fn: (r: Route, own: boolean) => void, opt: { maxD?: number } = {}): Item | null => {
      if (id === pid) return { key, d: 0, own: true, play: () => this.play(world, null, vol * 1.2, (r) => fn(r, true), { prio: true }) };
      const p = this.posOf(world, id);
      if (!p) return null;
      const d = dist(p);
      if (opt.maxD !== undefined && d > opt.maxD) return null;
      return { key, d, own: false, play: () => this.play(world, p, vol, (r) => fn(r, false)) };
    };
    const at = (key: string, x: number, y: number, vol: number, fn: (r: Route) => void, own = false): Item => {
      const p = { x, y };
      return own
        ? { key, d: 0, own: true, play: () => this.play(world, null, vol * 1.2, fn, { prio: true }) }
        : { key, d: dist(p), own: false, play: () => this.play(world, p, vol, fn) };
    };
    const global = (key: string, vol: number, fn: (r: Route) => void): Item =>
      ({ key, d: 0, own: true, play: () => this.play(world, null, vol, fn, { prio: true, novar: true }) });
    /** Voz de broma de una entidad (posicional salvo el jugador). */
    const vEnt = (key: string, id: number, name: string, vol: number): Item | null => {
      if (id === pid) return { key, d: 0, own: true, play: () => { this.voice(world, null, name, vol); } };
      const p = this.posOf(world, id);
      if (!p) return null;
      return { key, d: dist(p), own: false, play: () => { this.voice(world, p, name, vol); } };
    };
    const vAt = (key: string, x: number, y: number, name: string, vol: number, own: boolean): Item =>
      own ? { key, d: 0, own: true, play: () => { this.voice(world, null, name, vol); } }
        : { key, d: dist({ x, y }), own: false, play: () => { this.voice(world, { x, y }, name, vol); } };
    const goVoice = (): Item | null => {
      if (!hasV('v:go') || now - this.lastGo < 1.5) return null;
      this.lastGo = now;
      return { key: 'go', d: 0, own: true, play: () => { this.voice(world, null, 'v:go', 0.9); } };
    };

    switch (e.type) {
      case 'shot': {
        const kind = e.kind;
        const id = e.id;
        const own = id === pid;
        const weapon = e.weapon;
        const auto = AUTO.has(kind) && weapon !== 'secondary';
        const explos = kind === 'explosives' || kind === 'miniboss';
        const pos = own ? null : { x: e.fx, y: e.fy };
        if (hasV('v:machine') && auto) {
          // Una sola instancia por tirador (se corta sola cuando deja de disparar)
          return { key: 'shotm' + id, d: pos ? dist(pos) : 0, own, play: () => this.machineVoice(world, id, pos) };
        }
        if (hasV('v:pistol') && !explos) {
          return { key: 'shotv', d: pos ? dist(pos) : 0, own, play: () => { this.voice(world, pos, 'v:pistol', 0.9); } };
        }
        if (this.shotgunIds.has(id) && !hasV('v:pistol')) {
          const bf = (r: Route) => this.blast(r, own);
          if (own) return { key: 'shot', d: 0, own: true, play: () => this.play(world, null, 1.4, bf, { prio: true, room: 0.3 }) };
          return { key: 'shot', d: dist(pos!), own: false, play: () => this.play(world, pos, 1.1, bf, { room: 0.5 }) };
        }
        const fn = (r: Route) => this.shot(r, kind, own, weapon);
        const gate = () => {
          if (!auto) return true;
          const last = this.lastShot.get(id) ?? -9;
          if (now - last < 1 / 12) return false; // máx. ~12 disparos/s por tirador
          this.lastShot.set(id, now);
          return true;
        };
        if (own) return { key: 'shot', d: 0, own: true, play: () => { if (gate()) this.play(world, null, 1.3, fn, { prio: true, room: 0.25 }); } };
        return { key: 'shot', d: dist(pos!), own: false, play: () => { if (gate()) this.play(world, pos, 1.0, fn, { room: 0.5 }); } };
      }
      case 'dryfire':
        return ent('dryfire', e.id, 0.5, (r) => {
          this.nz(r, 0, 0.02, 0.6, 'highpass', 3000, 3000);
          this.osc(r, 'square', 900, 600, 0, 0.012, 0.08);
        }, { maxD: 25 });
      case 'explosion': {
        const synthVol = hasV('v:explosion') ? 0.8 : 1.5;
        const ep = { x: e.x, y: e.y };
        const ed = dist(ep);
        const it: Item = { key: 'explosion', d: ed, own: false, play: () => {
          this.play(world, ep, synthVol, (r) => this.explosion(r, ed / 340), { room: 1.0 });
          if (ed < 6 && this.layers) this.stun(world);
        } };
        if (hasV('v:explosion')) {
          const base = it.play;
          const p = { x: e.x, y: e.y };
          it.play = () => { base(); this.voice(world, p, 'v:explosion', 1.0); };
        }
        return it;
      }
      case 'knife': {
        const hit = e.hit;
        if (hasV('v:knife')) return vEnt('knife', e.id, 'v:knife', 0.9);
        return ent('knife', e.id, 0.7, (r) => {
          if (!this.smp(r, 'knife', 1, 1.0)) this.nz(r, 0, 0.16, 0.5, 'bandpass', 2500, 6000, 1.5, 0.05);
          if (hit) {
            this.nz(r, 0.07, 0.09, 0.6, 'lowpass', 900, 250);
            this.osc(r, 'triangle', 220, 90, 0.07, 0.08, 0.3);
          }
        }, { maxD: 30 });
      }
      case 'reload': {
        const en = world.entityById(e.id);
        const D = Math.max(0.6, Math.min(4, en && en.reloading > 0 ? en.reloading : 1.6));
        return ent('reload', e.id, 0.4, (r, own) => {
          const k = own ? 1.4 : 0.8;
          // 1) sacar cargador
          this.nz(r, D * 0.12, 0.03, 0.5 * k, 'bandpass', 2600, 2200, 2);
          this.nz(r, D * 0.12 + 0.01, 0.06, 0.3 * k, 'lowpass', 900, 300);
          this.nz(r, D * 0.12 + 0.07, 0.05, 0.25 * k, 'bandpass', 1500, 900, 2);   // roce al salir
          // 2) meter cargador
          this.nz(r, D * 0.55, 0.07, 0.35 * k, 'bandpass', 1500, 2500, 1.5, 0.02);
          this.nz(r, D * 0.55 + 0.05, 0.06, 0.45 * k, 'lowpass', 700, 250);
          this.nz(r, D * 0.55 + 0.05, 0.02, 0.4 * k, 'highpass', 3000, 3000);
          // 3) montar el arma: corredera atrás y adelante
          this.nz(r, D * 0.85, 0.04, 0.4 * k, 'highpass', 2500, 2500);
          this.nz(r, D * 0.85, 0.06, 0.3 * k, 'lowpass', 1100, 300);
          this.nz(r, D * 0.85 + 0.09, 0.04, 0.55 * k, 'highpass', 2500, 2500);
          this.nz(r, D * 0.85 + 0.09, 0.07, 0.4 * k, 'lowpass', 1000, 250);
        }, { maxD: 30 });
      }
      case 'door': {
        const open = e.open;
        return at('door', e.x, e.y, 0.8, (r) => {
          this.osc(r, 'sawtooth', open ? 70 : 95, open ? 95 : 65, 0, 0.35, 0.1, 0.05); // bisagra
          this.nz(r, 0, 0.35, 0.14, 'bandpass', 600, 900, 3, 0.1);
          if (!open) { // el golpe seco del cierre
            this.nz(r, 0.33, 0.08, 0.5, 'lowpass', 700, 200);
            this.osc(r, 'sine', 110, 50, 0.33, 0.1, 0.4);
          } else {
            this.nz(r, 0, 0.05, 0.35, 'lowpass', 1200, 400); // pestillo
          }
        });
      }
      case 'step': {
        const own = e.id === pid;
        const en = own ? world.player : world.entityById(e.id);
        const rush = !own && en?.variant === 'asaltante' && en.sprinting === true; // se le oye venir
        if (!own && dist({ x: e.x, y: e.y }) > (rush ? 24 : STEP_RANGE)) return null;
        if (own && hasV('v:step')) {
          if (now - this.lastStepV < 0.45) return null;
          this.lastStepV = now;
          return { key: 'stepv', d: 0, own: true, play: () => { this.voice(world, null, 'v:step', 0.8); } };
        }
        const sprint = (own && world.player.sprinting === true) || rush;
        return at('step', e.x, e.y, sprint ? 0.42 : 0.2, (r) => {
          this.nz(r, 0, sprint ? 0.08 : 0.06, 0.5, 'lowpass', 450 + Math.random() * 150, 180, 0.8, 0.01);
          if (sprint) { // roce del equipo al correr
            this.nz(r, 0.005, 0.1, 0.22, 'bandpass', 1800, 900, 1.2, 0.03);
            this.nz(r, 0.03, 0.03, 0.2, 'highpass', 4000, 4000);
          }
        }, own);
      }
      case 'hurt': {
        const last = this.lastHurt.get(e.id) ?? -9;
        if (now - last < 0.25) return null; // no un "ouch" por cada bala
        this.lastHurt.set(e.id, now);
        if (hasV('v:ouch')) return vEnt('hurt', e.id, 'v:ouch', 1.0);
        const heavy = e.zone === 'head' || e.zone === 'blast';
        const ouch = () => (Math.random() < 0.25 && this.samples.get('ouchOld')) ? 'ouchOld' : 'ouch';
        if (e.id === pid) {
          return { key: 'hurt', d: 0, own: true, play: () => this.play(world, null, 1.3, (r) => {
            this.smp(r, ouch(), 1, 1.0);
            this.osc(r, 'sine', 170, 55, 0, 0.18, 0.6);           // impacto
            this.nz(r, 0, 0.12, 0.4, 'bandpass', 900, 400, 1);
            if (heavy) this.osc(r, 'sine', 70, 35, 0.05, 0.3, 0.5);
          }, { prio: true }) };
        }
        return ent('hurt', e.id, 0.7, (r) => {
          if (!this.smp(r, ouch(), 1, 0.9)) {
            this.nz(r, 0, 0.1, 0.55, 'lowpass', 600, 200);
            this.osc(r, 'sine', 140, 70, 0, 0.1, 0.35);
          } else {
            this.nz(r, 0, 0.08, 0.3, 'lowpass', 600, 200);
          }
        }, { maxD: 35 });
      }
      case 'death': {
        const ally = e.team === 'ally';
        if (hasV('v:dead')) return vAt('death', e.x, e.y, 'v:dead', 1.0, e.id === pid);
        const fn = (r: Route) => {
          if (this.smp(r, 'dead', ally ? 1 : 0.92, 1.0)) this.nz(r, 0.05, 0.2, 0.35, 'lowpass', 500, 160); // golpe del cuerpo
          else this.deathSound(r, ally);
        };
        if (e.id === pid) return { key: 'death', d: 0, own: true, play: () => this.play(world, null, 1.0, fn, { prio: true }) };
        return at('death', e.x, e.y, 1.0, fn);
      }
      case 'pickup':
        if (hasV('v:sexo') && now - this.lastSexo >= 2) {
          this.lastSexo = now;
          return vAt('pickup', e.x, e.y, 'v:sexo', 0.9, e.id === pid);
        }
        return at('pickup', e.x, e.y, 0.5, (r) => { // recogida: roce de tela y golpecito
          this.nz(r, 0, 0.08, 0.4, 'bandpass', 2200, 1400, 1);
          this.nz(r, 0.05, 0.06, 0.4, 'lowpass', 800, 300);
          this.osc(r, 'sine', 300, 200, 0.05, 0.06, 0.15);
        }, e.id === pid);
      case 'weaponSwitch': {
        if (e.id !== pid) return null;
        const w = e.weapon as string;
        return { key: 'wswitch', d: 0, own: true, play: () => this.play(world, null, 0.45, (r) => this.weaponSwitchSound(r, w), { prio: true, novar: true }) };
      }
      case 'roll':
        return ent('roll', e.id, 0.4, (r) => {
          this.nz(r, 0, 0.14, 0.35, 'bandpass', 1500, 800, 1, 0.03); // roce de ropa
          this.nz(r, 0.1, 0.08, 0.5, 'lowpass', 600, 200);           // golpe sordo
          this.osc(r, 'sine', 110, 60, 0.1, 0.07, 0.25);
        }, { maxD: 25 });
      case 'flash': {
        const p = { x: e.x, y: e.y }, blind = e.playerBlind;
        const it = at('flash', e.x, e.y, 1.2, (r) => {
          this.nz(r, 0, 0.05, 1.0, 'highpass', 4000, 4000, 0.7, 0.0005);
          this.osc(r, 'square', 3000, 1200, 0, 0.006, 0.2, 0.0005);
          this.nz(r, 0, 0.18, 0.5, 'bandpass', 2500, 1200, 0.8);
        });
        if (blind > 0 && this.layers) {
          const base = it.play;
          it.play = () => { base(); this.stun(world, Math.min(4, blind), Math.min(3, blind)); };
        }
        void p;
        return it;
      }
      case 'smoke':
        return at('smoke', e.x, e.y, 0.6, (r) => {
          this.nz(r, 0, 1.5, 0.45, 'bandpass', 5000, 3500, 0.6, 0.15);
          this.nz(r, 0, 1.4, 0.3, 'lowpass', 1500, 700, 0.6, 0.1);
        });
      case 'downed': {
        const ally = e.kind === 'captain' || e.kind === 'technic' || e.kind === 'especialist' || e.kind === 'explosives';
        const k = ally ? 1 : 0.75;
        return at('downed', e.x, e.y, 0.9, (r) => {
          this.nz(r, 0, 0.12, 0.6, 'lowpass', 500, 180);           // golpe de caída
          this.osc(r, 'sine', 100, 50, 0, 0.15, 0.4);
          this.osc(r, 'triangle', 280 * k, 150 * k, 0.1, 0.28, 0.22, 0.03); // quejido corto
        });
      }
      case 'revived':
        return ent('revived', e.id, 0.5, (r) => {
          this.nz(r, 0, 0.25, 0.3, 'bandpass', 800, 1500, 1, 0.1);   // respiro
          this.nz(r, 0.26, 0.02, 0.4, 'highpass', 3000, 3000);       // clic del equipo
        }, { maxD: 25 });
      case 'bark': {
        const ally = e.team === 'ally';
        return ent('bark', e.id, 0.22, (r) => {
          if (ally) { // blip de radio limpio
            this.nz(r, 0, 0.012, 0.5, 'highpass', 3000, 3000);
            this.osc(r, 'sine', 1100, 1100, 0.01, 0.05, 0.12);
          } else {    // radio hostil: más grave y sucia
            this.nz(r, 0, 0.09, 0.25, 'bandpass', 1600, 1200, 1.5, 0.005);
            this.osc(r, 'square', 700, 650, 0.01, 0.05, 0.06);
          }
        }, { maxD: 30 });
      }
      case 'combo': {
        const n = e.key === 'clavado' ? 2 : e.key === 'conmocion' ? 3 : 4;
        return global('combo', 0.4, (r) => {
          for (let i = 0; i < n; i++) this.osc(r, 'triangle', 520 * Math.pow(1.19, i * 2), 520 * Math.pow(1.19, i * 2), i * 0.055, 0.1, 0.18, 0.005);
        });
      }
      case 'ping': {
        const f = e.what === 'enemy' ? 1800 : e.what === 'door' ? 1200 : e.what === 'item' ? 1400 : 1000;
        return global('ping', 0.4, (r) => {
          this.osc(r, 'sine', f, f, 0, 0.07, 0.2, 0.002);
          this.nz(r, 0, 0.01, 0.2, 'highpass', 4000, 4000);
        });
      }
      case 'threat': {
        const th = e.threat;
        const D = Math.max(0.3, Math.min(3, th.at - world.time));
        if (th.kind === 'laser') {
          // solo si apunta cerca del jugador (distancia del jugador al segmento)
          const px = world.player.x - th.fx, py = world.player.y - th.fy;
          const vx = th.x - th.fx, vy = th.y - th.fy;
          const l2 = vx * vx + vy * vy;
          const u = l2 > 0 ? Math.max(0, Math.min(1, (px * vx + py * vy) / l2)) : 0;
          if (Math.hypot(px - u * vx, py - u * vy) > 3) return null;
          return at('threat', th.fx, th.fy, 0.7, (r) => {
            this.osc(r, 'sine', 1200, 3200, 0, D, 0.07, D * 0.8);
            this.osc(r, 'triangle', 2400, 6400, 0, D, 0.03, D * 0.8);
          });
        }
        if (th.kind === 'charge') {
          return at('threat', th.fx, th.fy, 0.9, (r) => {
            this.nz(r, 0, D, 0.8, 'lowpass', 200, 600, 0.8, D * 0.9);
            this.osc(r, 'sawtooth', 50, 85, 0, D, 0.12, D * 0.9);
          });
        }
        if (th.kind === 'lane') {
          return at('threat', th.fx, th.fy, 0.8, (r) => { // montaje de arma pesada
            for (const t of [0, 0.14, 0.34]) this.nz(r, t, 0.03, 0.5, 'bandpass', 2200 - t * 2000, 1500, 2);
            this.nz(r, 0.34, 0.08, 0.5, 'lowpass', 700, 200);
            this.osc(r, 'sine', 90, 55, 0.34, 0.12, 0.4);
          });
        }
        return null;
      }
      case 'shieldHit':
        return at('shieldHit', e.x, e.y, 0.7, (r) => {
          this.nz(r, 0, 0.03, 0.5, 'bandpass', 3000, 2500, 2);
          this.osc(r, 'triangle', 1800, 1700, 0, 0.25, 0.3, 0.001);
          this.osc(r, 'sine', 2700, 2650, 0, 0.2, 0.15, 0.001);
        });
      case 'lights': {
        const on = e.on;
        return global('lights', 0.6, (r) => {
          this.nz(r, 0, 0.015, 0.6, 'highpass', 3000, 3000);        // clac del disyuntor
          this.nz(r, 0, 0.08, 0.8, 'lowpass', 600, 200);
          this.osc(r, 'sine', 90, 50, 0, 0.12, 0.5);
          if (on) this.osc(r, 'sawtooth', 40, 120, 0.05, 0.5, 0.06, 0.2);   // vuelve el zumbido
          else this.osc(r, 'sawtooth', 120, 40, 0.05, 0.6, 0.08, 0.01);     // baja el zumbido
        });
      }
      case 'objective': {
        const w = e.what;
        if (w === 'tick') {
          if (now - this.lastTick > 2.5) this.tickN = 0;
          this.lastTick = now;
          const f = 900 + Math.min(this.tickN, 12) * 70; // cada vez más agudo
          this.tickN++;
          return global('otick', 0.4, (r) => this.osc(r, 'sine', f, f, 0, 0.07, 0.25, 0.002));
        }
        this.tickN = 0;
        if (w === 'progress') {
          if (now - this.lastProg < 0.12) return null;
          this.lastProg = now;
          return at('oprog', e.x, e.y, 0.4, (r) => { // clics de herramienta
            this.nz(r, 0, 0.015, 0.5, 'bandpass', 3000 + Math.random() * 1500, 2500, 3);
            this.nz(r, 0.04, 0.012, 0.3, 'highpass', 4500, 4500);
          });
        }
        if (w === 'start') return global('ostart', 0.5, (r) => { // aviso de radio breve
          this.nz(r, 0, 0.02, 0.5, 'highpass', 2500, 2500);
          this.nz(r, 0.02, 0.2, 0.1, 'bandpass', 1800, 1500, 1.5);
          this.osc(r, 'sine', 900, 900, 0.05, 0.06, 0.12);
          this.osc(r, 'sine', 1200, 1200, 0.14, 0.07, 0.12);
          this.nz(r, 0.24, 0.02, 0.4, 'highpass', 2500, 2500);
        });
        if (w === 'done') return global('odone', 0.5, (r) =>
          [440, 554, 659].forEach((f, i) => this.osc(r, 'triangle', f, f, i * 0.09, i === 2 ? 0.4 : 0.12, 0.25, 0.01)));
        return global('ofail', 0.6, (r) => { // alarma descendente
          for (let i = 0; i < 2; i++) this.osc(r, 'sawtooth', 600, 300, i * 0.3, 0.28, 0.14, 0.01);
          this.osc(r, 'sine', 80, 40, 0, 0.5, 0.4);
        });
      }
      case 'wave': {
        const boss = e.boss;
        return global('wave', 0.7, (r) => {
          if (boss) { // más grave y largo
            for (let i = 0; i < 8; i++) this.nz(r, i * 0.1, 0.1, 0.25 + i * 0.05, 'bandpass', 500, 400, 1);
            this.osc(r, 'sine', 70, 35, 0.8, 0.7, 0.8, 0.01);
            this.nz(r, 0.8, 0.8, 0.5, 'lowpass', 900, 150);
          } else { // redoble corto y acento
            for (let i = 0; i < 5; i++) this.nz(r, i * 0.06, 0.05, 0.2 + i * 0.07, 'bandpass', 1800, 1500, 1);
            this.osc(r, 'sine', 100, 50, 0.3, 0.3, 0.5, 0.005);
            this.nz(r, 0.3, 0.1, 0.4, 'bandpass', 1900, 1400, 1);
          }
        });
      }
      case 'itemUsed':
        if (hasV('v:sexo') && now - this.lastSexo >= 2) {
          this.lastSexo = now;
          return vEnt('itemUsed', e.id, 'v:sexo', 0.9);
        }
        return ent('itemUsed', e.id, 0.5, (r) => { // velcro de la bolsa, cremallera y golpe seco
          this.nz(r, 0, 0.18, 0.35, 'bandpass', 2500, 1500, 1.2, 0.02);
          this.nz(r, 0.2, 0.07, 0.35, 'lowpass', 900, 300);
        }, { maxD: 25 });
      case 'throw':
        return ent('throw', e.id, 0.7, (r) => {
          this.nz(r, 0, 0.25, 0.4, 'bandpass', 700, 1500, 1, 0.08);
          this.nz(r, 0, 0.06, 0.4, 'lowpass', 800, 300);
        }, { maxD: 35 });
      case 'ability': {
        const a = e.ability, ok = e.ok;
        return at('ability', e.x, e.y, 0.8, (r) => this.ability(r, a, ok), e.id === pid);
      }
      case 'breach':
        return at('breach', e.x, e.y, 1.3, (r) => {
          this.nz(r, 0, 1.3, 0.9, 'lowpass', 700, 120, 0.7, 0.05);
          this.osc(r, 'sine', 70, 30, 0, 0.8, 0.8);
          for (let i = 0; i < 7; i++) this.nz(r, 0.15 + i * 0.12 + Math.random() * 0.08, 0.07, 0.3, 'bandpass', 900 + Math.random() * 1500, 400, 1.5); // cascotes
        });
      case 'order':
        if (hasV('v:go')) return goVoice();
        return global('order', 0.5, (r) => { // radio: clic de pulsar, ráfaga de estática y clic de soltar
          this.nz(r, 0, 0.02, 0.5, 'highpass', 2500, 2500);
          this.nz(r, 0.02, 0.14, 0.13, 'bandpass', 1800, 1600, 1.5);
          this.nz(r, 0.17, 0.02, 0.4, 'highpass', 2500, 2500);
        });
      case 'phase':
        return chut ? goVoice() : null;
      case 'bossPhase':
        return global('bossPhase', 0.8, (r) => {
          const o = this.ctx.createOscillator();
          o.type = 'sawtooth';
          const t = r.t;
          for (let i = 0; i < 3; i++) { // sirena grave
            o.frequency.setValueAtTime(160, t + i * 0.4);
            o.frequency.linearRampToValueAtTime(260, t + i * 0.4 + 0.36);
          }
          const f = this.ctx.createBiquadFilter();
          f.type = 'lowpass'; f.frequency.value = 900;
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.25, t + 0.05);
          g.gain.setValueAtTime(0.25, t + 1.0);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
          o.connect(f); f.connect(g); g.connect(r.in);
          o.start(t); o.stop(t + 1.35);
          r.len = Math.max(r.len, 1.4);
          this.nz(r, 0, 1.5, 0.7, 'lowpass', 500, 90, 0.7, 0.1); // retumbo
          this.osc(r, 'sine', 60, 30, 0, 1.2, 0.8, 0.1);
        });
      case 'alert':
        return at('alert', e.x, e.y, 0.9, (r) => { // chasquido seco de alerta, sin pitido de videojuego
          this.nz(r, 0, 0.05, 0.7, 'bandpass', 1800, 1200, 1.5);
          this.osc(r, 'triangle', 500, 380, 0, 0.12, 0.2);
        });
      case 'cleared':
        return global('cleared', 0.6, (r) => { // sobrio: acorde grave y corto, sin fanfarria
          [262, 330, 392].forEach((f, i) => this.osc(r, 'triangle', f, f, i * 0.1, 0.7, 0.2, 0.02));
          this.nz(r, 0, 0.1, 0.2, 'lowpass', 800, 300);
        });
      case 'playerDead':
        return global('playerDead', 0.9, (r) => {
          this.osc(r, 'sawtooth', 160, 40, 0, 1.4, 0.2, 0.05);
          this.osc(r, 'sine', 80, 25, 0, 1.6, 0.7, 0.05);
          this.nz(r, 0, 1.0, 0.3, 'lowpass', 1200, 80);
        });
      default:
        return null;
    }
  }

  /** Items adicionales de un suceso: impactos por superficie y confirmaciones del jugador. */
  private extras(e: GameEvent, world: IWorld, out: (it: Item) => void): void {
    const pid = world.player.id;
    const cam = world.cam;
    const now = this.ctx.currentTime;
    if (e.type === 'shot' && e.hit === 'wall') {
      const surf = e.surface ?? 'wall';
      if (surf === 'none' || surf === 'body') return;
      const p = { x: e.tx, y: e.ty };
      out({ key: 'impact', d: Math.hypot(p.x - cam.x, p.y - cam.y), own: false, play: () => this.play(world, p, 0.55, (r) => {
        switch (surf) {
          case 'furniture': // toc seco
            this.nz(r, 0, 0.03, 0.5, 'bandpass', 1200, 900, 2);
            this.osc(r, 'triangle', 260, 170, 0, 0.04, 0.3);
            break;
          case 'door': // clac más agudo
            this.nz(r, 0, 0.04, 0.55, 'bandpass', 3500, 2500, 2);
            this.osc(r, 'triangle', 900, 650, 0, 0.05, 0.2);
            break;
          case 'floor': // rebote
            this.nz(r, 0, 0.04, 0.45, 'lowpass', 1500, 400);
            this.nz(r, 0.07, 0.03, 0.2, 'bandpass', 1800, 1200, 2);
            break;
          default: // yeso/muro: golpe sordo y polvillo
            this.nz(r, 0, 0.06, 0.55, 'lowpass', 700, 250);
            this.osc(r, 'sine', 140, 80, 0, 0.05, 0.3);
            this.nz(r, 0.02, 0.14, 0.1, 'highpass', 4000, 3000, 0.7, 0.02);
        }
      }) });
      return;
    }
    const conf = (key: string, fn: (r: Route) => void) =>
      out({ key, d: 0, own: true, play: () => this.play(world, null, 0.4, fn, { prio: true, novar: true }) });
    if (e.type === 'hurt' && e.attackerId === pid && e.id !== pid && e.zone !== 'blast') {
      if (now - this.lastConfirm < 0.06) return;
      this.lastConfirm = now;
      if (e.zone === 'head') {
        conf('confirmH', (r) => { // tic agudo y brillante, dos parciales
          this.nz(r, 0, 0.01, 0.5, 'highpass', 4500, 4500, 1, 0.0005);
          this.osc(r, 'sine', 2600, 2500, 0, 0.07, 0.3, 0.001);
          this.osc(r, 'sine', 3900, 3800, 0, 0.055, 0.2, 0.001);
        });
      } else {
        conf('confirmH', (r) => { // tic corto
          this.nz(r, 0, 0.012, 0.55, 'bandpass', 3000, 2600, 2, 0.0005);
          this.osc(r, 'sine', 1700, 1500, 0, 0.035, 0.25, 0.001);
        });
      }
    } else if (e.type === 'death' && e.killerId === pid && e.id !== pid) {
      const head = e.headshot === true;
      conf('confirmK', (r) => { // golpe grave + chasquido (+ armónico agudo si fue a la cabeza)
        this.osc(r, 'sine', 120, 55, 0, 0.16, 0.65, 0.002);
        this.nz(r, 0, 0.025, 0.6, 'bandpass', 2200, 1800, 2, 0.0005);
        if (head) {
          this.osc(r, 'sine', 3300, 3200, 0.015, 0.16, 0.22, 0.001);
          this.osc(r, 'sine', 4950, 4900, 0.015, 0.1, 0.1, 0.001);
        }
      });
    }
  }

  /** Cargas de «desactivar»: pitido posicional suave, más rápido cuanto menos tiempo queda. */
  private beepCharges(world: IWorld): void {
    const ob = world.objective;
    if (!ob || ob.kind !== 'defuse' || !(ob.timeLeft >= 0)) { if (this.nextBeep.size) this.nextBeep.clear(); return; }
    const now = this.ctx.currentTime;
    const interval = Math.max(0.2, Math.min(1.4, 0.2 + ob.timeLeft * 0.035));
    ob.points.forEach((p, i) => {
      if (p.done) return;
      if (now < (this.nextBeep.get(i) ?? 0)) return;
      this.nextBeep.set(i, now + interval);
      this.play(world, { x: p.x, y: p.y }, 0.3, (r) => {
        this.osc(r, 'sine', 1500, 1500, 0, 0.05, 0.25, 0.002);
        this.nz(r, 0, 0.008, 0.2, 'highpass', 4000, 4000);
      });
    });
  }

  handleEvents(world: IWorld): void {
    if (this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const chut = world.cheats?.chutaos === true; // por defecto, modo normal
    // Mundo nuevo (otra zona): se olvidan los ids anteriores
    const newWorld = world !== this.lastWorld;
    if (newWorld) {
      this.lastWorld = world;
      for (const [id, st] of [...this.mv]) this.cutMv(id, st);
      this.lastHurt.clear();
      this.lastShot.clear();
      this.nextBeep.clear();
    }
    // Cambio de modo: «go» de confirmación (y se cortan las ráfagas de broma al desactivar)
    if (chut !== this.lastChut) {
      this.lastChut = chut;
      this.lastGo = now;
      this.voice(world, null, 'v:go', 0.9);
      if (!chut) for (const [id, st] of [...this.mv]) this.cutMv(id, st);
    } else if (chut && newWorld && now - this.lastGo >= 1.5) {
      this.lastGo = now; // inicio de zona
      this.voice(world, null, 'v:go', 0.9);
    }
    // Ráfaga de broma: se corta (fundido de 80 ms) ~0,4 s después del último disparo
    for (const [id, st] of [...this.mv]) if (now - st.last > 0.4) this.cutMv(id, st);
    try { this.beepCharges(world); } catch { /* nada */ }
    const evs = world.events;
    if (!evs || evs.length === 0) return;
    try { this.setRoom(world); } catch { /* nada */ }
    // ≥5 disparos del mismo id en una llamada = escopeta: un solo estampido
    this.shotgunIds.clear();
    this.skip.clear();
    const cnt = new Map<number, number>();
    for (const e of evs) if (e.type === 'shot') cnt.set(e.id, (cnt.get(e.id) ?? 0) + 1);
    const seen = new Set<number>();
    for (const e of evs) {
      if (e.type !== 'shot' || (cnt.get(e.id) ?? 0) < 5) continue;
      this.shotgunIds.add(e.id);
      if (seen.has(e.id)) this.skip.add(e); else seen.add(e.id);
    }
    const groups = new Map<string, Item[]>();
    for (const e of evs) {
      if (this.skip.has(e)) continue;
      let it: Item | null = null;
      try { it = this.describe(e, world, chut); } catch { it = null; }
      const add = (x: Item) => {
        const g = groups.get(x.key);
        if (g) g.push(x); else groups.set(x.key, [x]);
      };
      try { this.extras(e, world, add); } catch { /* nada */ }
      if (it) add(it);
    }
    if (groups.has('confirmK')) groups.delete('confirmH'); // la baja ya confirma el impacto
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

  /** Chasquido/ruido de radio de Mando (80-150 ms). */
  radioBlip(kind: 'open' | 'close'): void {
    if (this.ctx.state !== 'running') return;
    this.play(null, null, 0.4, (r) => {
      if (kind === 'open') {
        this.nz(r, 0, 0.02, 0.6, 'highpass', 2500, 2500);
        this.nz(r, 0.02, 0.1, 0.18, 'bandpass', 1800, 1500, 1.5, 0.005);
      } else {
        this.nz(r, 0, 0.08, 0.16, 'bandpass', 1800, 1400, 1.5, 0.005);
        this.nz(r, 0.07, 0.03, 0.55, 'highpass', 2500, 2500);
      }
    }, { prio: true, novar: true });
  }

  // ───────────────────────── Interfaz ─────────────────────────

  ui(sound: 'click' | 'confirm' | 'back' | 'error' | 'reward' | 'victory' | 'defeat'): void {
    if (this.ctx.state !== 'running') return;
    this.play(null, null, 0.6, (r) => {
      switch (sound) {
        case 'click':
          this.nz(r, 0, 0.025, 0.5, 'bandpass', 2400, 1800, 2);
          this.osc(r, 'sine', 300, 200, 0, 0.03, 0.12);
          break;
        case 'confirm':
          this.nz(r, 0, 0.03, 0.5, 'bandpass', 2000, 1600, 2);
          this.osc(r, 'triangle', 440, 440, 0.02, 0.12, 0.18);
          this.osc(r, 'triangle', 660, 660, 0.09, 0.18, 0.15);
          break;
        case 'back':
          this.nz(r, 0, 0.03, 0.4, 'bandpass', 1500, 1200, 2);
          this.osc(r, 'triangle', 400, 300, 0.02, 0.12, 0.15);
          break;
        case 'error':
          this.nz(r, 0, 0.04, 0.4, 'bandpass', 1200, 900, 2);
          this.osc(r, 'triangle', 150, 110, 0, 0.18, 0.3);
          break;
        case 'reward':
          [392, 494, 587, 784].forEach((f, i) => {
            this.osc(r, 'triangle', f, f, i * 0.09, 0.35, 0.2, 0.01);
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
