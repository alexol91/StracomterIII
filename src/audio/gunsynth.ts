// Síntesis «offline» de disparos, explosiones y mecánica de armas.
// Cada sonido se calcula UNA vez en JavaScript (muestra a muestra, con filtros biquad propios,
// envolventes exponenciales y saturación suave) y se guarda como forma de onda. Luego el juego
// solo reproduce el buffer: más barato que montar 10 nodos de Web Audio por disparo y con más
// control (saturación, filtros que barren, transitorio de un solo ciclo).
// No depende de Web Audio: se puede probar en Node.
//
// Cada arma = suma de capas:
//   crack  — transitorio seco (onda de choque / boca del cañón): ruido agudo de 2-6 ms
//   cuerpo — la explosión de la pólvora: ruido con pasa-bajos que se cierra + resonancia del arma
//   golpe  — el «puñetazo» grave: seno con caída de tono (como un bombo)
//   mecánica — cerrojo, corredera, eslabones: clics metálicos con un poco de «ring»
//   cola   — el retumbo que queda (antes de la sala, que la pone el convolver del juego)
// y al final saturación (tanh) y normalización de pico.

export type GunId = 'M4A1' | 'MP5' | 'M249' | 'SVD' | 'M1911' | 'REM870' | 'MGL' | 'RPG';
export const GUN_IDS: readonly GunId[] = ['M4A1', 'MP5', 'M249', 'SVD', 'M1911', 'REM870', 'MGL', 'RPG'];

interface Click { t: number; f: number; ring: number; amp: number; dur: number }

export interface GunSpec {
  len: number;                                   // s
  crack: { amp: number; hp: number; tau: number };
  body: { amp: number; f0: number; f1: number; sweep: number; tau: number; res: number; resQ: number; resAmp: number };
  thump: { amp: number; f0: number; f1: number; drop: number; tau: number };
  mech: Click[];
  tail: { amp: number; lp: number; tau: number; delay: number };
  /** motor de cohete / silbido (solo el RPG): ruido de banda que sube */
  whoosh?: { amp: number; f0: number; f1: number; dur: number };
  /** resonancia hueca del tubo (lanzagranadas) */
  tube?: { amp: number; f0: number; f1: number; tau: number };
  drive: number;
  peak: number;                                  // nivel final de pico (0-1): el «volumen» relativo del arma
}

// Ajustes por arma (razonados a partir de cómo suenan de verdad):
// - 5,56 (M4A1, M249): crack supersónico marcado, cuerpo medio-agudo, cerrojo rápido.
// - 9 mm subsónico (MP5): poco crack, sonido más «plano» y con el clac de rodillos muy presente.
// - 7,62x54R (SVD): el más fuerte: crack enorme, golpe grave largo y cola que rueda.
// - .45 ACP (M1911): subsónico, gordo y corto, con corredera.
// - 12 ga (REM870): estampido ancho y grave, cola larga; el corredera de bomba va aparte.
// - 40 mm (MGL): «tump» hueco, poco agudo, con giro del tambor.
// - Cohete (RPG): estampido + chorro de motor que se aleja.
export const GUNS: Record<GunId, GunSpec> = {
  M4A1: {
    len: 0.55, drive: 1.6, peak: 0.92,
    crack: { amp: 1.0, hp: 2800, tau: 0.0035 },
    body: { amp: 0.95, f0: 7000, f1: 850, sweep: 0.03, tau: 0.045, res: 650, resQ: 2.2, resAmp: 0.5 },
    thump: { amp: 0.75, f0: 150, f1: 52, drop: 0.035, tau: 0.065 },
    mech: [{ t: 0.032, f: 2600, ring: 3300, amp: 0.16, dur: 0.012 }, { t: 0.062, f: 2100, ring: 2900, amp: 0.12, dur: 0.014 }],
    tail: { amp: 0.28, lp: 1300, tau: 0.19, delay: 0.012 },
  },
  MP5: {
    len: 0.4, drive: 1.4, peak: 0.8,
    crack: { amp: 0.5, hp: 2400, tau: 0.0025 },
    body: { amp: 0.9, f0: 5200, f1: 1100, sweep: 0.025, tau: 0.032, res: 1350, resQ: 2.8, resAmp: 0.6 },
    thump: { amp: 0.45, f0: 190, f1: 80, drop: 0.025, tau: 0.04 },
    mech: [{ t: 0.016, f: 3600, ring: 4300, amp: 0.3, dur: 0.01 }, { t: 0.044, f: 3000, ring: 3800, amp: 0.26, dur: 0.012 }],
    tail: { amp: 0.16, lp: 1600, tau: 0.11, delay: 0.01 },
  },
  M249: {
    len: 0.62, drive: 1.8, peak: 0.95,
    crack: { amp: 0.95, hp: 2500, tau: 0.004 },
    body: { amp: 1.0, f0: 6000, f1: 650, sweep: 0.035, tau: 0.058, res: 520, resQ: 2.0, resAmp: 0.55 },
    thump: { amp: 0.9, f0: 120, f1: 45, drop: 0.045, tau: 0.085 },
    mech: [{ t: 0.03, f: 1800, ring: 2350, amp: 0.2, dur: 0.016 }, { t: 0.072, f: 1500, ring: 2000, amp: 0.17, dur: 0.02 }],
    tail: { amp: 0.32, lp: 1100, tau: 0.23, delay: 0.014 },
  },
  SVD: {
    len: 1.5, drive: 2.0, peak: 1.0,
    crack: { amp: 1.2, hp: 2300, tau: 0.006 },
    body: { amp: 1.0, f0: 6500, f1: 450, sweep: 0.05, tau: 0.075, res: 430, resQ: 1.8, resAmp: 0.5 },
    thump: { amp: 1.05, f0: 95, f1: 36, drop: 0.06, tau: 0.13 },
    mech: [{ t: 0.055, f: 2200, ring: 2800, amp: 0.12, dur: 0.016 }],
    tail: { amp: 0.26, lp: 900, tau: 0.36, delay: 0.02 },
  },
  M1911: {
    len: 0.6, drive: 1.5, peak: 0.85,
    crack: { amp: 0.65, hp: 2000, tau: 0.003 },
    body: { amp: 0.95, f0: 5000, f1: 750, sweep: 0.028, tau: 0.038, res: 900, resQ: 2.4, resAmp: 0.55 },
    thump: { amp: 0.8, f0: 165, f1: 58, drop: 0.03, tau: 0.055 },
    mech: [{ t: 0.024, f: 3000, ring: 3700, amp: 0.2, dur: 0.01 }, { t: 0.052, f: 2600, ring: 3400, amp: 0.15, dur: 0.012 }],
    tail: { amp: 0.18, lp: 1300, tau: 0.14, delay: 0.01 },
  },
  REM870: {
    len: 1.25, drive: 2.0, peak: 1.0,
    crack: { amp: 0.75, hp: 1800, tau: 0.005 },
    body: { amp: 1.1, f0: 4200, f1: 420, sweep: 0.06, tau: 0.095, res: 380, resQ: 1.6, resAmp: 0.6 },
    thump: { amp: 1.05, f0: 82, f1: 32, drop: 0.07, tau: 0.15 },
    mech: [],
    tail: { amp: 0.3, lp: 850, tau: 0.28, delay: 0.018 },
  },
  MGL: {
    len: 0.85, drive: 1.5, peak: 0.85,
    crack: { amp: 0.3, hp: 1500, tau: 0.002 },
    body: { amp: 0.7, f0: 1600, f1: 280, sweep: 0.05, tau: 0.06, res: 320, resQ: 2.5, resAmp: 0.7 },
    thump: { amp: 1.0, f0: 125, f1: 46, drop: 0.05, tau: 0.09 },
    tube: { amp: 0.35, f0: 310, f1: 175, tau: 0.045 },
    mech: [{ t: 0.13, f: 2400, ring: 3000, amp: 0.16, dur: 0.012 }, { t: 0.17, f: 1900, ring: 2500, amp: 0.1, dur: 0.02 }],
    tail: { amp: 0.18, lp: 900, tau: 0.15, delay: 0.015 },
  },
  RPG: {
    len: 1.6, drive: 1.8, peak: 1.0,
    crack: { amp: 0.6, hp: 1600, tau: 0.004 },
    body: { amp: 1.0, f0: 3500, f1: 350, sweep: 0.06, tau: 0.09, res: 300, resQ: 1.6, resAmp: 0.5 },
    thump: { amp: 1.0, f0: 95, f1: 35, drop: 0.06, tau: 0.13 },
    whoosh: { amp: 0.45, f0: 500, f1: 2600, dur: 1.1 },
    mech: [],
    tail: { amp: 0.3, lp: 800, tau: 0.3, delay: 0.02 },
  },
};

// ───────────────────────── Utilidades DSP ─────────────────────────

/** Generador pseudoaleatorio con semilla (mulberry32): mismas variantes en cada carga. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type BqType = 'lp' | 'hp' | 'bp';

/** Biquad RBJ (forma directa I) con coeficientes recalculables. */
class Bq {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(private type: BqType, private sr: number, f: number, q = 0.707) { this.set(f, q); }
  set(f: number, q: number): void {
    const fc = Math.max(10, Math.min(this.sr * 0.45, f));
    const w = 2 * Math.PI * fc / this.sr;
    const cw = Math.cos(w), sw = Math.sin(w);
    const al = sw / (2 * q);
    let b0: number, b1: number, b2: number;
    if (this.type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; }
    else if (this.type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * cw) / a0; this.a2 = (1 - al) / a0;
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** Envolvente: ataque lineal `att` y caída exponencial de constante `tau` (s). */
function env(t: number, att: number, tau: number): number {
  if (t < 0) return 0;
  if (t < att) return t / att;
  return Math.exp(-(t - att) / tau);
}

function finish(out: Float32Array, drive: number, peak: number, sr: number): Float32Array {
  // saturación suave: aplasta el pico del transitorio y sube el cuerpo (pegada)
  // (se normaliza ANTES de saturar: si no, la tanh aplasta la cola al nivel del transitorio)
  const k = Math.tanh(drive);
  let m = 0;
  for (let i = 0; i < out.length; i++) { const a = Math.abs(out[i]); if (a > m) m = a; }
  if (m > 0) for (let i = 0; i < out.length; i++) out[i] /= m;
  m = 0;
  for (let i = 0; i < out.length; i++) {
    const y = Math.tanh(drive * out[i]) / k;
    out[i] = y;
    const a = Math.abs(y);
    if (a > m) m = a;
  }
  // DC fuera (pasa-altos suave a 25 Hz) y normalización de pico
  const hp = new Bq('hp', sr, 25, 0.707);
  m = 0;
  for (let i = 0; i < out.length; i++) { out[i] = hp.run(out[i]); const a = Math.abs(out[i]); if (a > m) m = a; }
  const g = m > 0 ? peak / m : 0;
  // fundido de salida de 30 ms para no cortar en seco
  const fo = Math.floor(0.03 * sr);
  for (let i = 0; i < out.length; i++) {
    const f = i > out.length - fo ? (out.length - i) / fo : 1;
    out[i] *= g * f;
  }
  return out;
}

// ───────────────────────── Disparo ─────────────────────────

/** Calcula un disparo. `variant` cambia la semilla y detalles (tono, tiempos) para que no suenen iguales. */
export function renderGun(id: GunId, sr: number, variant = 0): Float32Array {
  const s = GUNS[id];
  const R = rng(0x5eed + variant * 7919 + GUN_IDS.indexOf(id) * 104729);
  const jit = (v: number, p: number) => v * (1 + (R() * 2 - 1) * p);
  const n = Math.floor(s.len * sr);
  const out = new Float32Array(n);
  const crackHp = new Bq('hp', sr, jit(s.crack.hp, 0.1), 0.8);
  const crackHp2 = new Bq('hp', sr, jit(s.crack.hp, 0.1), 0.8);
  const bodyLp = new Bq('lp', sr, s.body.f0, 0.9);
  const bodyRes = new Bq('bp', sr, jit(s.body.res, 0.06), s.body.resQ);
  const tailLp = new Bq('lp', sr, s.tail.lp, 0.6);
  const tailLp2 = new Bq('lp', sr, s.tail.lp, 0.6);
  const clicks = s.mech.map(c => ({
    c, t: jit(c.t, 0.08), bp: new Bq('bp', sr, jit(c.f, 0.05), 4), ringF: jit(c.ring, 0.03),
  }));
  const whBp = s.whoosh ? new Bq('bp', sr, s.whoosh.f0, 1.2) : null;
  const thF0 = jit(s.thump.f0, 0.05), thF1 = s.thump.f1;
  let thPh = 0, tubePh = 0;
  const crackTau = jit(s.crack.tau, 0.15);
  const bodyTau = jit(s.body.tau, 0.1);
  const tailTau = jit(s.tail.tau, 0.1);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 31) === 0) {
      const sw = Math.exp(-t / s.body.sweep);
      bodyLp.set(s.body.f1 + (s.body.f0 - s.body.f1) * sw, 0.9);
      if (whBp && s.whoosh) {
        const u = Math.min(1, t / s.whoosh.dur);
        whBp.set(s.whoosh.f0 * Math.pow(s.whoosh.f1 / s.whoosh.f0, u), 1.2);
      }
    }
    const w = R() * 2 - 1;
    let y = 0;
    // crack: dos pasa-altos en serie (pendiente de 24 dB/oct) — seco y brillante
    y += s.crack.amp * crackHp2.run(crackHp.run(w)) * env(t, 0.0001, crackTau) * 1.6;
    // cuerpo: ruido que se oscurece + resonancia del arma
    const be = env(t, 0.0004, bodyTau);
    y += s.body.amp * bodyLp.run(w) * be;
    y += s.body.resAmp * bodyRes.run(w) * be * 2.2;
    // golpe grave con caída de tono
    const f = thF1 + (thF0 - thF1) * Math.exp(-t / s.thump.drop);
    thPh += 2 * Math.PI * f / sr;
    y += s.thump.amp * Math.sin(thPh) * env(t, 0.0015, s.thump.tau);
    // tubo hueco
    if (s.tube) {
      const tf = s.tube.f1 + (s.tube.f0 - s.tube.f1) * Math.exp(-t / 0.03);
      tubePh += 2 * Math.PI * tf / sr;
      y += s.tube.amp * Math.sin(tubePh) * env(t, 0.002, s.tube.tau);
    }
    // mecánica
    for (const k of clicks) {
      const dt = t - k.t;
      if (dt < 0 || dt > 0.12) { k.bp.run(0); continue; }
      const ce = env(dt, 0.0003, k.c.dur * 0.4);
      y += k.c.amp * (k.bp.run(w) * ce * 3 + Math.sin(2 * Math.PI * k.ringF * dt) * env(dt, 0.0005, 0.02) * 0.35);
    }
    // cola: retumbo grave que queda
    const td = t - s.tail.delay;
    if (td > 0) y += s.tail.amp * tailLp2.run(tailLp.run(w)) * env(td, 0.01, tailTau) * 2.5;
    // motor de cohete
    if (whBp && s.whoosh) {
      const u = t / s.whoosh.dur;
      const we = u < 0.05 ? u / 0.05 : Math.max(0, 1 - (u - 0.05) / 0.95);
      y += s.whoosh.amp * whBp.run(w) * we * we * 2.5;
    }
    out[i] = y;
  }
  return finish(out, s.drive, s.peak, sr);
}

// ───────────────────────── Explosión ─────────────────────────

/** Explosión con pegada: chasquido, onda grave (sub) con caída, estallido que se oscurece, retumbo y cascotes. */
export function renderExplosion(sr: number, variant = 0): Float32Array {
  const R = rng(0xe4910 + variant * 31337);
  const len = 2.8;
  const n = Math.floor(len * sr);
  const out = new Float32Array(n);
  const crackHp = new Bq('hp', sr, 2500, 0.7);
  const blastLp = new Bq('lp', sr, 6000, 0.8);
  const blastLp2 = new Bq('lp', sr, 6000, 0.8);
  const rumbleLp = new Bq('lp', sr, 220, 0.7);
  const rumbleLp2 = new Bq('lp', sr, 220, 0.7);
  const debrisBp = new Bq('bp', sr, 1500, 2);
  const debris: { t: number; amp: number; f: number }[] = [];
  const nd = 10 + Math.floor(R() * 8);
  for (let i = 0; i < nd; i++) debris.push({ t: 0.25 + R() * 1.5, amp: 0.15 + R() * 0.25, f: 700 + R() * 2200 });
  debris.sort((a, b) => a.t - b.t);
  let di = 0, curDeb: { t: number; amp: number; f: number } | null = null;
  let ph = 0;
  const subF0 = 70 + R() * 15;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 31) === 0) {
      const c = 180 + 5800 * Math.exp(-t / 0.09);
      blastLp.set(c, 0.8); blastLp2.set(c, 0.8);
      while (di < debris.length && debris[di].t <= t) { curDeb = debris[di]; debrisBp.set(curDeb.f, 2.5); di++; }
    }
    const w = R() * 2 - 1;
    let y = 0;
    y += 1.4 * crackHp.run(w) * env(t, 0.0001, 0.006);                       // chasquido inicial
    y += 1.3 * blastLp2.run(blastLp.run(w)) * env(t, 0.002, 0.22);           // estallido
    const f = 26 + (subF0 - 26) * Math.exp(-t / 0.12);                       // onda grave
    ph += 2 * Math.PI * f / sr;
    y += 1.1 * Math.sin(ph) * env(t, 0.003, 0.35);
    y += 1.5 * rumbleLp2.run(rumbleLp.run(w)) * env(t - 0.03, 0.05, 0.75);   // retumbo largo
    if (curDeb) {                                                            // cascotes
      const dt = t - curDeb.t;
      y += curDeb.amp * debrisBp.run(w) * env(dt, 0.001, 0.02) * 3;
    }
    out[i] = y;
  }
  return finish(out, 2.5, 1.0, sr);
}

// ───────────────────────── Mecánica suelta ─────────────────────────

/** Corredera de la escopeta de bomba: atrás (roce + clac) y adelante (clac). ~0,35 s. */
export function renderPump(sr: number, variant = 0): Float32Array {
  const R = rng(0x9047 + variant * 17);
  const n = Math.floor(0.4 * sr);
  const out = new Float32Array(n);
  const fr = new Bq('bp', sr, 1100, 1.5);
  const k1 = new Bq('bp', sr, 2300, 3);
  const k2 = new Bq('bp', sr, 1900, 3);
  const body = new Bq('lp', sr, 600, 0.7);
  const tBack = 0.07 + R() * 0.01, tFwd = 0.2 + R() * 0.02;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = R() * 2 - 1;
    let y = 0;
    if (t < 0.1) y += 0.35 * fr.run(w) * Math.sin(Math.PI * t / 0.1);                // roce atrás
    else if (t > 0.12 && t < tFwd) y += 0.25 * fr.run(w) * Math.sin(Math.PI * (t - 0.12) / (tFwd - 0.12));
    y += 1.0 * k1.run(w) * env(t - tBack, 0.0003, 0.008) * 3;
    y += 1.2 * k2.run(w) * env(t - tFwd, 0.0003, 0.01) * 3;
    y += 0.8 * body.run(w) * (env(t - tBack, 0.001, 0.02) + env(t - tFwd, 0.001, 0.025));
    y += 0.15 * Math.sin(2 * Math.PI * 2900 * Math.max(0, t - tFwd)) * env(t - tFwd, 0.0005, 0.03);
    out[i] = y;
  }
  return finish(out, 1.8, 0.7, sr);
}

/** Bala que pasa cerca: chasquido supersónico + soplido corto. */
export function renderFlyby(sr: number, variant = 0): Float32Array {
  const R = rng(0xf1b + variant * 101);
  const n = Math.floor(0.22 * sr);
  const out = new Float32Array(n);
  const hp = new Bq('hp', sr, 3000, 0.8);
  const bp = new Bq('bp', sr, 2500, 1.5);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 31) === 0) bp.set(4000 * Math.exp(-t / 0.08) + 900, 1.5);
    const w = R() * 2 - 1;
    out[i] = 1.2 * hp.run(w) * env(t, 0.0001, 0.003) + 0.6 * bp.run(w) * env(t, 0.01, 0.05);
  }
  return finish(out, 2, 0.6, sr);
}
