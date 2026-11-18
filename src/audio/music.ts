// Música sintetizada: secuenciador por pasos (semicorcheas) con planificación anticipada.
// Melodías y armonías originales; las melodías se generan con una semilla fija (determinista)
// sobre la armonía de cada tema, así que son siempre las mismas y encajan con los acordes.
// Voces sostenidas por tema: <= 6 (las de batería son ráfagas cortas).

import type { MusicTrack } from '../contracts';
import type { Samples } from './samples';

/**
 * true = el tema original (.ogg) sustituye a la música generada en menu/strategy/victory/boss y
 * combat usa solo un ambiente discreto. false = siempre la música generada (reserva).
 */
export const USE_SAMPLE_MUSIC = true;
/** Volumen del tema original: normal y en el jefe (más alto). */
const THEME_LEVEL = 0.7;
const THEME_LEVEL_BOSS = 1.0;

const LOOKAHEAD = 0.25;     // s de notas planificadas por delante
const TICK_MS = 50;
const FADE = 0.8;           // s de fundido cruzado

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Chord { root: number; iv: number[] }
const ch = (root: number, iv: number[]): Chord => ({ root, iv });
/** Notas medias del acorde para el colchón (3ª, 5ª y 7ª/octava), una octava por encima de la fundamental. */
const padNotes = (c: Chord, oct = 12): number[] =>
  [c.root + oct + c.iv[1], c.root + oct + c.iv[2], c.root + oct + (c.iv[3] ?? c.iv[0] + 12)];

interface ToneOpts { lp?: number; att?: number; rel?: number; det?: number; send?: number; drive?: boolean; slide?: number }

class Voices {
  echo: AudioNode | null = null;
  drive: AudioNode | null = null;
  constructor(readonly ctx: AudioContext, readonly noise: AudioBuffer, readonly dest: AudioNode) {}

  tone(type: OscillatorType, freq: number, t: number, dur: number, vol: number, o: ToneOpts = {}): void {
    const c = this.ctx;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    if (o.det) osc.detune.value = o.det;
    const att = o.att ?? 0.01, rel = o.rel ?? 0.08;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + att);
    g.gain.setValueAtTime(vol, t + Math.max(att, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(att, dur) + rel);
    let head: AudioNode = osc;
    if (o.lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = 0.7;
      osc.connect(f);
      head = f;
    }
    head.connect(g);
    g.connect(o.drive && this.drive ? this.drive : this.dest);
    if (o.send && this.echo) {
      const s = c.createGain();
      s.gain.value = o.send;
      g.connect(s);
      s.connect(this.echo);
    }
    osc.start(t);
    osc.stop(t + Math.max(att, dur) + rel + 0.05);
    osc.onended = () => { try { g.disconnect(); } catch { /* ya desconectado */ } };
  }

  /** Ruido filtrado con envolvente (golpe de caja, charles, barridos). */
  nz(t: number, dur: number, vol: number, ft: BiquadFilterType, f0: number, f1: number, q = 1, att = 0.002): void {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = ft; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.dest);
    s.start(t, Math.random() * 1.4);
    s.stop(t + dur + 0.02);
    s.onended = () => { try { g.disconnect(); } catch { /* ya desconectado */ } };
  }

  kick(t: number, vol: number): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g); g.connect(this.dest);
    o.start(t); o.stop(t + 0.32);
    o.onended = () => { try { g.disconnect(); } catch { /* ya desconectado */ } };
  }
  snare(t: number, vol: number): void {
    this.nz(t, 0.16, vol, 'bandpass', 1900, 1500, 0.8);
    this.nz(t, 0.05, vol * 0.5, 'highpass', 5000, 5000);
    this.tone('triangle', 190, t, 0.05, vol * 0.5, { rel: 0.06, slide: 120 });
  }
  hat(t: number, vol: number, open = false): void {
    this.nz(t, open ? 0.16 : 0.035, vol, 'highpass', 7500, 7500, 0.7, 0.001);
  }
}

// ───────────────────────── Generador de melodías ─────────────────────────

interface Note { m: number; len: number }

/**
 * Camina por una escala favoreciendo notas del acorde en los tiempos fuertes.
 * `grid` = granularidad en pasos; `density` = probabilidad base de nota.
 */
function genMelody(
  seed: number, bars: number, chordAt: (bar: number) => Chord, scale: number[], root: number,
  lo: number, hi: number, grid: number, density: number,
): Map<number, Note> {
  const r = rng(seed);
  const pool: number[] = [];
  for (let m = lo; m <= hi; m++) if (scale.includes((((m - root) % 12) + 12) % 12)) pool.push(m);
  let idx = Math.floor(pool.length / 2);
  const pos: number[] = [];
  const notes: number[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const c = chordAt(bar);
    const pcs = c.iv.map((i) => (c.root + i) % 12);
    for (let s = 0; s < 16; s += grid) {
      const strong = s % 8 === 0 ? 1 : s % 4 === 0 ? 0.6 : 0.25;
      if (!(bar === 0 && s === 0) && r() > density * (0.45 + strong)) continue;
      idx += Math.round((r() - 0.5) * 4) + (idx > pool.length * 0.7 ? -1 : idx < pool.length * 0.3 ? 1 : 0);
      idx = Math.max(0, Math.min(pool.length - 1, idx));
      if (s % 4 === 0) {
        for (let k = 0; k < pool.length; k++) {
          const j = idx + (k % 2 ? -((k + 1) >> 1) : k >> 1);
          if (j >= 0 && j < pool.length && pcs.includes(pool[j] % 12)) { idx = j; break; }
        }
      }
      pos.push(bar * 16 + s);
      notes.push(pool[idx]);
    }
  }
  const out = new Map<number, Note>();
  for (let i = 0; i < pos.length; i++) {
    const next = i + 1 < pos.length ? pos[i + 1] : bars * 16;
    out.set(pos[i], { m: notes[i], len: Math.max(1, Math.min(8, next - pos[i])) });
  }
  return out;
}

// ───────────────────────── Definición de temas ─────────────────────────

type StepFn = (v: Voices, pos: number, t: number, sps: number) => void;
interface TrackDef {
  bpm: number;
  bars: number;
  loopStart: number;
  echo: boolean;   // envío de eco (retardo con realimentación, barato)
  drive: boolean;  // saturador para el bajo del jefe
  make(): StepFn;
}

/** MENÚ: D dórico/menor, ~90 bpm, misterioso y quieto. 16 compases. */
function makeMenu(): StepFn {
  const chords = [ch(38, [0, 3, 7, 10]), ch(34, [0, 4, 7, 11]), ch(43, [0, 3, 7, 10]), ch(45, [0, 5, 7, 10]),
    ch(38, [0, 3, 7, 10]), ch(41, [0, 4, 7, 11]), ch(43, [0, 3, 7, 10]), ch(45, [0, 4, 7, 10])];
  const at = (b: number) => chords[b % 8];
  const mel = genMelody(11, 16, at, [0, 2, 3, 5, 7, 8, 10], 2, 66, 86, 4, 0.32);
  return (v, pos, t, sps) => {
    const bar = Math.floor(pos / 16), s = pos % 16, c = at(bar), late = bar >= 8;
    if (s === 0) {
      for (const n of padNotes(c)) v.tone('sawtooth', mtof(n), t, sps * 15, 0.045, { lp: 850, att: 0.8, rel: 0.6, det: Math.random() * 8 - 4 });
    }
    if (s === 0) v.tone('sine', mtof(c.root), t, sps * 6, 0.24, { att: 0.03, rel: 0.4 });
    if (s === 10) v.tone('sine', mtof(c.root + (bar % 2 ? 7 : 0)), t, sps * 4, 0.16, { att: 0.03, rel: 0.4 });
    const m = mel.get(pos);
    if (m) v.tone('triangle', mtof(m.m), t, m.len * sps * 0.9, 0.11, { lp: 2400, att: 0.02, rel: 0.5, send: 0.55 });
    if (late && s % 2 === 0) { // arpegio de púa, solo en la segunda mitad
      const k = c.iv[((s >> 1) + bar) % c.iv.length];
      v.tone('triangle', mtof(c.root + 24 + k), t, sps * 1.5, 0.04, { lp: 1800, att: 0.005, rel: 0.2, send: 0.4 });
    }
    if (late && (s === 2 || s === 6 || s === 10 || s === 14)) v.hat(t, 0.03, s === 14);
  };
}

/** ESTRATEGIA: La frigio/menor, ~100 bpm, tensa y pausada: colchones, pulso grave, pings. */
function makeStrategy(): StepFn {
  const chords = [ch(33, [0, 3, 7]), ch(33, [0, 3, 7, 10]), ch(34, [0, 4, 7, 11]), ch(40, [0, 4, 7, 10]),
    ch(33, [0, 3, 7]), ch(41, [0, 4, 7, 11]), ch(34, [0, 4, 7]), ch(40, [0, 4, 7, 10])];
  const at = (b: number) => chords[b % 8];
  const mel = genMelody(23, 16, at, [0, 1, 3, 5, 7, 8, 10], 9, 69, 88, 4, 0.2);
  return (v, pos, t, sps) => {
    const bar = Math.floor(pos / 16), s = pos % 16, c = at(bar), late = bar >= 8;
    if (s === 0) {
      for (const n of padNotes(c)) v.tone('sawtooth', mtof(n), t, sps * 15.5, 0.04, { lp: 650 + (bar % 4) * 120, att: 1.2, rel: 0.8, det: Math.random() * 10 - 5 });
    }
    // Pulso de bajo irregular (tensión sin prisa)
    const pat = bar % 2 ? [0, 6, 8, 14] : [0, 3, 8, 11];
    if (pat.includes(s)) v.tone('sawtooth', mtof(c.root), t, sps * 2, 0.15, { lp: 330, att: 0.01, rel: 0.2 });
    if (late && (s === 0 || s === 3)) v.kick(t, s === 0 ? 0.3 : 0.18); // latido
    if (s === 2 || s === 6 || s === 10 || s === 14) v.hat(t, 0.025);
    const m = mel.get(pos);
    if (m && bar >= 2) v.tone('sine', mtof(m.m), t, m.len * sps * 0.6, 0.09, { att: 0.01, rel: 0.7, send: 0.6 });
    if (bar === 15 && s === 0) v.nz(t, sps * 16, 0.05, 'bandpass', 300, 3200, 2, sps * 12); // subida hacia el bucle
    if (bar === 7 && s === 8) v.tone('sawtooth', mtof(c.root + 36), t, sps * 6, 0.025, { lp: 2500, att: 0.3, rel: 0.5, send: 0.5 }); // sirena lejana
  };
}

/** COMBATE: Mi menor, ~132 bpm, bajo de sierra, bombo a negras, caja y lead de cuadrada. */
function makeCombat(): StepFn {
  const chords = [ch(40, [0, 3, 7]), ch(40, [0, 3, 7]), ch(36, [0, 4, 7]), ch(38, [0, 4, 7]),
    ch(40, [0, 3, 7]), ch(43, [0, 4, 7]), ch(36, [0, 4, 7]), ch(35, [0, 4, 7, 10])];
  const at = (b: number) => chords[b % 8];
  const mel = genMelody(37, 16, at, [0, 2, 3, 5, 7, 8, 10], 4, 64, 83, 2, 0.5);
  return (v, pos, t, sps) => {
    const bar = Math.floor(pos / 16), s = pos % 16, c = at(bar), b2 = bar >= 8, fillBar = bar % 4 === 3;
    // Bajo: corcheas con octavas y síncopas
    if (s % 2 === 0) {
      const oct = s === 6 || s === 14 || (b2 && s === 10) ? 12 : 0;
      const acc = s % 8 === 0 ? 1 : 0.75;
      v.tone('sawtooth', mtof(c.root + oct), t, sps * 1.6, 0.17 * acc, { lp: 500 + 900 * acc, att: 0.004, rel: 0.06 });
    }
    // Batería
    if (s % 4 === 0) v.kick(t, 0.55);
    if (b2 && s === 10 && bar % 2 === 1) v.kick(t, 0.35);
    if (s === 4 || s === 12) v.snare(t, 0.4);
    if (s % 2 === 0) v.hat(t, s % 4 === 2 ? 0.07 : 0.045, s === 14 && !fillBar);
    if (fillBar && s >= 12) v.snare(t, 0.18 + (s - 12) * 0.07); // redoble de relleno
    // Lead (entra en el compás 4)
    const m = mel.get(pos);
    if (m && bar >= 4) v.tone('square', mtof(m.m), t, m.len * sps * 0.85, 0.06, { lp: 3000, att: 0.005, rel: 0.08, det: 5 });
    // Arpegio en la segunda mitad
    if (b2 && s % 2 === 0 && s % 4 !== 0) {
      v.tone('sawtooth', mtof(c.root + 24 + c.iv[(s >> 1) % c.iv.length]), t, sps * 1.2, 0.035, { lp: 2400, att: 0.004, rel: 0.05 });
    }
  };
}

/** JEFE: Do frigio, ~150 bpm, pesado y oscuro: bajo saturado al galope, zumbido, golpes de tritono. */
function makeBoss(): StepFn {
  const chords = [ch(36, [0, 3, 7]), ch(37, [0, 4, 7]), ch(36, [0, 3, 6]), ch(31, [0, 4, 7, 10]),
    ch(29, [0, 3, 7]), ch(37, [0, 4, 7]), ch(36, [0, 3, 7]), ch(31, [0, 4, 7, 10])];
  const at = (b: number) => chords[b % 8];
  const mel = genMelody(53, 16, at, [0, 1, 3, 5, 7, 8, 10], 0, 58, 76, 2, 0.42);
  const gallop = [0, 2, 3, 6, 8, 10, 11, 14];
  return (v, pos, t, sps) => {
    const bar = Math.floor(pos / 16), s = pos % 16, c = at(bar), b2 = bar >= 8, fillBar = bar % 4 === 3;
    if (gallop.includes(s)) {
      const hi = s === 6 || s === 14 ? 12 : 0;
      v.tone('sawtooth', mtof(c.root + hi), t, sps * (s === 0 ? 2 : 1.1), 0.2, { lp: 420, att: 0.003, rel: 0.05, drive: true });
    }
    // Zumbido grave (dos sierras: fundamental y quinta)
    if (s === 0) {
      v.tone('sawtooth', mtof(c.root + 12), t, sps * 15.5, 0.04, { lp: 500, att: 0.3, rel: 0.4 });
      v.tone('sawtooth', mtof(c.root + 19), t, sps * 15.5, 0.03, { lp: 500, att: 0.3, rel: 0.4, det: 7 });
    }
    // Golpes a contratiempo (3ª y 7ª o tritono)
    if (b2 && (s === 4 || s === 12)) {
      v.tone('sawtooth', mtof(c.root + 24 + c.iv[1]), t, sps * 1.2, 0.045, { lp: 1900, att: 0.004, rel: 0.05 });
      v.tone('sawtooth', mtof(c.root + 24 + c.iv[2]), t, sps * 1.2, 0.04, { lp: 1900, att: 0.004, rel: 0.05, det: 6 });
    }
    // Batería
    if (s === 0 || s === 3 || s === 8 || s === 10) v.kick(t, s === 0 ? 0.65 : 0.45);
    if (s === 4 || s === 12) v.snare(t, 0.5);
    v.hat(t, s % 4 === 2 ? 0.05 : 0.025, false);
    if (fillBar && s >= 13) v.snare(t, 0.25 + (s - 13) * 0.1);
    // Lead oscuro en la segunda mitad
    const m = mel.get(pos);
    if (m && b2) v.tone('sawtooth', mtof(m.m), t, m.len * sps * 0.8, 0.045, { lp: 2200, att: 0.01, rel: 0.1, det: -6 });
  };
}

/** VICTORIA: Do mayor, ~120 bpm. 4 compases de fanfarria y luego bucle suave de 8. */
function makeVictory(): StepFn {
  // [paso dentro del compás, nota MIDI, duración en pasos]
  const fan: [number, number, number][][] = [
    [[0, 72, 2], [2, 76, 2], [4, 79, 4], [8, 84, 8]],
    [[0, 83, 2], [2, 84, 2], [4, 86, 4], [8, 88, 8]],
    [[0, 79, 2], [2, 81, 2], [4, 83, 2], [6, 84, 2], [8, 88, 4], [12, 86, 2], [14, 84, 2]],
    [[0, 84, 16]],
  ];
  const fanChords: [number, number, number[]][][] = [
    [[0, 8, [60, 64, 67]]], [[0, 8, [59, 62, 67]]], [[0, 8, [60, 65, 69]], [8, 8, [59, 62, 67]]], [[0, 16, [60, 64, 67, 72]]],
  ];
  const loop = [ch(36, [0, 4, 7]), ch(31, [0, 4, 7]), ch(33, [0, 3, 7]), ch(29, [0, 4, 7]),
    ch(36, [0, 4, 7]), ch(31, [0, 4, 7]), ch(29, [0, 4, 7]), ch(36, [0, 4, 7, 11])];
  const lAt = (b: number) => loop[(b - 4 + 8) % 8];
  const mel = genMelody(71, 12, (b) => lAt(b), [0, 2, 4, 5, 7, 9, 11], 0, 72, 91, 4, 0.3);
  return (v, pos, t, sps) => {
    const bar = Math.floor(pos / 16), s = pos % 16;
    if (bar < 4) {
      for (const [st, m, len] of fan[bar]) {
        if (st !== s) continue;
        v.tone('sawtooth', mtof(m), t, len * sps * 0.9, 0.07, { lp: 3600, att: 0.01, rel: 0.12 });
        v.tone('square', mtof(m - 12), t, len * sps * 0.9, 0.05, { lp: 2400, att: 0.01, rel: 0.12 });
      }
      for (const [st, len, notes] of fanChords[bar]) {
        if (st !== s) continue;
        for (const n of notes.slice(0, 3)) v.tone('sawtooth', mtof(n), t, len * sps * 0.9, 0.03, { lp: 2200, att: 0.02, rel: 0.2 });
      }
      if (s === 0 || s === 8) v.kick(t, 0.5);
      if (bar === 2 && s >= 12) v.snare(t, 0.15 + (s - 12) * 0.08);
      if (bar === 3 && s === 0) v.snare(t, 0.5);
      return;
    }
    const c = lAt(bar);
    if (s === 0) {
      for (const n of padNotes(c)) v.tone('triangle', mtof(n), t, sps * 15, 0.06, { lp: 1500, att: 0.5, rel: 0.5 });
      v.tone('sine', mtof(c.root), t, sps * 8, 0.2, { att: 0.02, rel: 0.4 });
    }
    if (s === 8) v.tone('sine', mtof(c.root + 7), t, sps * 6, 0.14, { att: 0.02, rel: 0.4 });
    if (s % 2 === 0) v.tone('triangle', mtof(c.root + 24 + c.iv[(s >> 1) % c.iv.length]), t, sps * 1.4, 0.04, { lp: 2400, att: 0.005, rel: 0.2, send: 0.45 });
    const m = mel.get(pos);
    if (m) v.tone('sine', mtof(m.m), t, m.len * sps * 0.9, 0.09, { att: 0.02, rel: 0.5, send: 0.5 });
    if (s === 4 || s === 12) v.hat(t, 0.025);
  };
}

const TRACKS: Record<Exclude<MusicTrack, null>, TrackDef> = {
  menu:     { bpm: 90,  bars: 16, loopStart: 0, echo: true,  drive: false, make: makeMenu },
  strategy: { bpm: 100, bars: 16, loopStart: 0, echo: true,  drive: false, make: makeStrategy },
  combat:   { bpm: 132, bars: 16, loopStart: 0, echo: false, drive: false, make: makeCombat },
  boss:     { bpm: 150, bars: 16, loopStart: 0, echo: false, drive: true,  make: makeBoss },
  victory:  { bpm: 120, bars: 12, loopStart: 4, echo: true,  drive: false, make: makeVictory },
};

// ───────────────────────── Reproductor y mezcla ─────────────────────────

interface Playing {
  key: string;
  scheduling: boolean;
  stopAt: number;
  setLevel(level: number): void;
  fadeOut(now: number, dur?: number): void;
  tick(until: number): void;
  dispose(): void;
}

class Player implements Playing {
  readonly key: string;
  readonly gain: GainNode;
  private v: Voices;
  private step: StepFn;
  private pos = 0;
  private next: number;
  private sps: number;
  private def: TrackDef;
  private extra: AudioNode[] = [];
  scheduling = true;
  stopAt = Infinity;

  constructor(private ctx: AudioContext, noise: AudioBuffer, out: AudioNode, track: Exclude<MusicTrack, null>) {
    this.key = 'synth:' + track;
    this.def = TRACKS[track];
    this.sps = 60 / this.def.bpm / 4;
    this.gain = ctx.createGain();
    const t0 = ctx.currentTime;
    this.gain.gain.setValueAtTime(0.0001, t0);
    this.gain.gain.linearRampToValueAtTime(1, t0 + FADE);
    this.gain.connect(out);
    this.v = new Voices(ctx, noise, this.gain);
    if (this.def.echo) { // retardo de corchea con puntillo, con realimentación filtrada
      const d = ctx.createDelay(2);
      d.delayTime.value = this.sps * 3;
      const fb = ctx.createGain(); fb.gain.value = 0.38;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
      const wet = ctx.createGain(); wet.gain.value = 0.7;
      d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(wet); wet.connect(this.gain);
      this.v.echo = d;
      this.extra.push(d, fb, lp, wet);
    }
    if (this.def.drive) { // saturación suave
      const ws = ctx.createWaveShaper();
      const curve = new Float32Array(257);
      for (let i = 0; i < 257; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 3.5) * 0.8; }
      ws.curve = curve;
      ws.connect(this.gain);
      this.v.drive = ws;
      this.extra.push(ws);
    }
    this.step = this.def.make();
    this.next = t0 + 0.06;
  }

  setLevel(): void { /* el nivel de la música generada es fijo */ }

  fadeOut(now: number, dur = FADE): void {
    this.scheduling = false;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0.0001, now + dur);
    this.stopAt = now + dur + 2.5; // deja morir las colas (eco, releases)
  }

  tick(until: number): void {
    if (!this.scheduling) return;
    const now = this.ctx.currentTime;
    if (this.next < now - 0.3) this.next = now + 0.05; // si el hilo se durmió, no soltar todo de golpe
    const end = this.def.bars * 16;
    while (this.next < until) {
      this.step(this.v, this.pos, this.next, this.sps);
      this.next += this.sps;
      this.pos++;
      if (this.pos >= end) this.pos = this.def.loopStart * 16;
    }
  }

  dispose(): void {
    try { this.gain.disconnect(); } catch { /* ya desconectado */ }
    for (const n of this.extra) { try { n.disconnect(); } catch { /* ya desconectado */ } }
  }
}

/** Tema original en bucle (AudioBufferSourceNode.loop: sin corte audible). */
class ThemePlayer implements Playing {
  readonly key = 'theme';
  scheduling = true;
  stopAt = Infinity;
  private gain: GainNode;
  private src: AudioBufferSourceNode;

  constructor(private ctx: AudioContext, buf: AudioBuffer, out: AudioNode, level: number) {
    this.gain = ctx.createGain();
    const t = ctx.currentTime;
    this.gain.gain.setValueAtTime(0.0001, t);
    this.gain.gain.linearRampToValueAtTime(level, t + FADE);
    this.gain.connect(out);
    this.src = ctx.createBufferSource();
    this.src.buffer = buf;
    this.src.loop = true;
    this.src.connect(this.gain);
    this.src.start(t);
  }
  setLevel(level: number): void {
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(level, t + FADE);
  }
  fadeOut(now: number, dur = FADE): void {
    this.scheduling = false;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0.0001, now + dur);
    this.stopAt = now + dur + 0.1;
    try { this.src.stop(now + dur + 0.05); } catch { /* ya parada */ }
  }
  tick(): void { /* nada que planificar */ }
  dispose(): void { try { this.gain.disconnect(); } catch { /* nada */ } }
}

/** Combate: sin melodía. Zumbido grave de edificio/aire acondicionado y algún pulso lento. */
class Ambient implements Playing {
  readonly key = 'ambient';
  scheduling = true;
  stopAt = Infinity;
  private gain: GainNode;
  private nodes: (AudioScheduledSourceNode)[] = [];
  private nextPulse: number;

  constructor(private ctx: AudioContext, private noise: AudioBuffer, out: AudioNode) {
    const t = ctx.currentTime;
    this.gain = ctx.createGain();
    this.gain.gain.setValueAtTime(0.0001, t);
    this.gain.gain.linearRampToValueAtTime(0.6, t + FADE);
    this.gain.connect(out);
    // Zumbido: dos senos muy graves ligeramente desafinados (batido lento)
    for (const [f, v] of [[48, 0.2], [48.7, 0.16], [96.5, 0.04]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = v;
      o.connect(g); g.connect(this.gain); o.start(t);
      this.nodes.push(o);
    }
    // Aire: ruido muy filtrado con respiración lenta
    const n = ctx.createBufferSource();
    n.buffer = noise; n.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.6;
    const ng = ctx.createGain(); ng.gain.value = 0.12;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
    const lg = ctx.createGain(); lg.gain.value = 0.07;
    lfo.connect(lg); lg.connect(ng.gain);
    n.connect(lp); lp.connect(ng); ng.connect(this.gain);
    n.start(t); lfo.start(t);
    this.nodes.push(n, lfo);
    this.nextPulse = t + 2;
  }
  setLevel(): void { /* fijo */ }
  fadeOut(now: number, dur = FADE): void {
    this.scheduling = false;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(0.0001, now + dur);
    this.stopAt = now + dur + 0.1;
    for (const n of this.nodes) { try { n.stop(now + dur + 0.05); } catch { /* nada */ } }
  }
  tick(until: number): void {
    if (!this.scheduling) return;
    while (this.nextPulse < until) { // pulso lento y grave, muy bajo
      const t = this.nextPulse;
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(52, t);
      o.frequency.exponentialRampToValueAtTime(34, t + 0.5);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g); g.connect(this.gain);
      o.start(t); o.stop(t + 0.95);
      o.onended = () => { try { g.disconnect(); } catch { /* nada */ } };
      this.nextPulse += 3.5 + Math.random() * 2;
    }
  }
  dispose(): void {
    try { this.gain.disconnect(); } catch { /* nada */ }
  }
}

export class Music {
  private players: Playing[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private cur: MusicTrack = null;
  private noise: AudioBuffer;

  constructor(private ctx: AudioContext, private out: AudioNode, private samples: Samples) {
    const n = Math.floor(ctx.sampleRate * 3);
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    // Si el tema termina de cargar después de pedirlo, se arranca entonces
    samples.load('theme').then(() => { try { this.reconcile(); } catch { /* nada */ } });
  }

  /** Cambia de tema con fundido cruzado. Pedir el que ya suena no hace nada. */
  set(track: MusicTrack): void {
    if (track === this.cur) return;
    this.cur = track;
    this.reconcile();
  }

  /** Qué debe sonar ahora (clave) según el tema pedido y lo que haya cargado. */
  private desired(): { key: string; level: number } | null {
    const track = this.cur;
    if (!track) return null;
    if (USE_SAMPLE_MUSIC) {
      if (track === 'combat') return { key: 'ambient', level: 0 };
      if (this.samples.get('theme')) return { key: 'theme', level: track === 'boss' ? THEME_LEVEL_BOSS : THEME_LEVEL };
      if (!this.samples.hasFailed('theme')) return null; // aún cargando: silencio hasta que llegue
    }
    return { key: 'synth:' + track, level: 0 }; // reserva: música generada
  }

  private reconcile(): void {
    const want = this.desired();
    const now = this.ctx.currentTime;
    const live = this.players.filter((p) => p.scheduling);
    if (want && live.length === 1 && live[0].key === want.key) {
      if (want.key === 'theme') live[0].setLevel(want.level); // menu/strategy/victory <-> boss: solo cambia el volumen
    } else {
      // Al pasar del tema al combate, el tema sale en 1 s
      for (const p of live) p.fadeOut(now, p.key === 'theme' ? 1 : FADE);
      if (want) {
        let np: Playing | null = null;
        if (want.key === 'theme') np = new ThemePlayer(this.ctx, this.samples.get('theme')!, this.out, want.level);
        else if (want.key === 'ambient') np = new Ambient(this.ctx, this.noise, this.out);
        else np = new Player(this.ctx, this.noise, this.out, this.cur as Exclude<MusicTrack, null>);
        this.players.push(np);
      }
    }
    if (this.players.length && this.timer === null) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
    }
  }

  private tick(): void {
    try {
      const now = this.ctx.currentTime;
      const until = now + LOOKAHEAD;
      for (const p of this.players) p.tick(until);
      this.players = this.players.filter((p) => {
        if (now > p.stopAt) { p.dispose(); return false; }
        return true;
      });
      if (this.players.length === 0 && this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
    } catch { /* la música nunca debe romper el juego */ }
  }
}
