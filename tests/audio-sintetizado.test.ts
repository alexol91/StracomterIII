// Audio de combate sintetizado (modo normal) y separación de las muestras del dueño (solo Modo Chutaos).
//
// QUÉ CUBRE:
//  - gunsynth: cada arma produce una forma de onda finita, con pico ≤ 1, transitorio al principio,
//    variantes distintas entre sí y armas distintas entre sí; la explosión es más larga y grave.
//  - Sfx con un AudioContext FALSO: en modo normal no pide NINGUNA muestra del dueño
//    (public/audio/efectos ni voces) al disparar, explotar, acuchillar, herir o morir; con
//    «chutaos on» sí pide las voces, como antes.
// QUÉ NO CUBRE (el doble es más amable que la realidad):
//  - Que suene bien: nadie ha oído esto en la prueba. Ni volumen relativo, ni mezcla, ni latencia.
//  - El AudioContext falso acepta cualquier llamada y no valida rampas, tiempos ni conexiones:
//    un error de Web Audio que en el navegador lanza (p. ej. rampa exponencial a 0) aquí NO falla.
//  - El reloj del contexto falso está parado: la limitación de cadencia por tiempo no se prueba.
import { describe, expect, it } from 'vitest';
import { GUN_IDS, renderExplosion, renderGun } from '../src/audio/gunsynth';
import { AUDIO_NORMAL } from '../src/audio/config';
import { Sfx } from '../src/audio/sfx';
import type { Samples } from '../src/audio/samples';
import { createCampaign } from '../src/sim/campaign';
import type { World } from '../src/sim/world';

const SR = 48000;

function centroidish(d: Float32Array, ms: number): number {
  let zc = 0;
  const n = Math.min(d.length, Math.floor(ms / 1000 * SR));
  for (let i = 1; i < n; i++) if ((d[i] >= 0) !== (d[i - 1] >= 0)) zc++;
  return zc / 2 / (ms / 1000);
}
function rmsDb(d: Float32Array, a: number, b: number): number {
  let e = 0, n = 0;
  for (let i = Math.floor(a * SR); i < Math.min(d.length, b * SR); i++) { e += d[i] * d[i]; n++; }
  return 10 * Math.log10(e / Math.max(1, n) + 1e-12);
}

describe('gunsynth · disparos y explosiones por código', () => {
  it('cada arma: finita, pico ≤ 1, empieza fuerte y decae', () => {
    for (const id of GUN_IDS) {
      const d = renderGun(id, SR, 0);
      expect(d.length).toBeGreaterThan(SR * 0.3);
      let peak = 0;
      for (const x of d) { expect(Number.isFinite(x)).toBe(true); peak = Math.max(peak, Math.abs(x)); }
      expect(peak).toBeLessThanOrEqual(1.0001);
      expect(peak).toBeGreaterThan(0.5);
      // el principio (0-30 ms) está muy por encima de lo que queda a los 300 ms
      expect(rmsDb(d, 0, 0.03) - rmsDb(d, 0.3, 0.4)).toBeGreaterThan(id === 'RPG' || id === 'REM870' || id === 'SVD' ? 6 : 15);
    }
  });
  it('las variantes de un arma no son idénticas y las armas no suenan igual entre sí', () => {
    const a = renderGun('M4A1', SR, 0), b = renderGun('M4A1', SR, 1);
    let diff = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff += Math.abs(a[i] - b[i]);
    expect(diff).toBeGreaterThan(10);
    // la pistola .45 y el subfusil no tienen el mismo «brillo» que el lanzagranadas (hueco y grave)
    expect(centroidish(renderGun('MP5', SR, 0), 20)).toBeGreaterThan(centroidish(renderGun('MGL', SR, 0), 20) * 2);
    // el SVD dura más que el MP5
    expect(renderGun('SVD', SR, 0).length).toBeGreaterThan(renderGun('MP5', SR, 0).length * 2);
  });
  it('es determinista (misma variante = mismos datos) y la explosión es larga', () => {
    expect(renderGun('M1911', SR, 2)).toEqual(renderGun('M1911', SR, 2));
    expect(renderExplosion(SR, 0).length).toBeGreaterThan(SR * 2);
  });
});

// ───────────── AudioContext falso (acepta todo, registra nada) ─────────────
function fakeParam() {
  return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} };
}
function fakeNode(): Record<string, unknown> {
  return new Proxy({ connect() {}, disconnect() {}, start() {}, stop() {}, buffer: null, type: '', onended: null } as Record<string, unknown>, {
    get(t, k: string) { if (!(k in t)) t[k] = fakeParam(); return t[k]; },
    set(t, k: string, v) { t[k] = v; return true; },
  });
}
function fakeCtx(): AudioContext {
  const mk = () => fakeNode();
  return {
    sampleRate: SR, currentTime: 10, state: 'running', destination: mk(),
    createGain: mk, createBiquadFilter: mk, createOscillator: mk, createBufferSource: mk,
    createStereoPanner: mk, createConvolver: mk, createDynamicsCompressor: mk,
    createBuffer: (ch: number, n: number) => {
      const data = Array.from({ length: ch }, () => new Float32Array(n));
      return { duration: n / SR, length: n, numberOfChannels: ch, getChannelData: (c: number) => data[c] };
    },
  } as unknown as AudioContext;
}
/** Muestras falsas: todas «cargadas», y apunta qué nombres se piden. */
function fakeSamples(asked: string[]): Samples {
  const buf = { duration: 0.3 } as AudioBuffer;
  return { get: (n: string) => { asked.push(n); return buf; }, hasFailed: () => false } as unknown as Samples;
}

const mem = new Map<string, string>();
const campaign = createCampaign({ getItem: k => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: k => void mem.delete(k) });

function fireAll(chut: boolean): string[] {
  const asked: string[] = [];
  const sfx = new Sfx(fakeCtx(), fakeNode() as unknown as AudioNode, fakeSamples(asked));
  const w = campaign.startZone(campaign.newQuickPlay('normal', 'captain', 1), 1) as World;
  w.cheats.chutaos = chut;
  const p = w.player;
  const c = w.cam;
  const x = c.x + 3, y = c.y;
  w.events.length = 0;
  w.events.push(
    { type: 'shot', id: p.id, kind: 'captain', team: 'ally', fx: c.x, fy: c.y, fz: 1, tx: x, ty: y, tz: 1, hit: 'none' },
    { type: 'shot', id: p.id, kind: 'captain', team: 'ally', fx: c.x, fy: c.y, fz: 1, tx: x, ty: y, tz: 1, hit: 'none', weapon: 'secondary' },
    { type: 'explosion', x, y } as never,
    { type: 'knife', id: p.id, hit: true } as never,
    { type: 'hurt', id: p.id, zone: 'body', attackerId: -1 } as never,
    { type: 'death', id: p.id, team: 'ally', x, y, killerId: -1 } as never,
  );
  sfx.handleEvents(w);
  return asked;
}

describe('audio · muestras del dueño solo en Modo Chutaos', () => {
  it('el interruptor está en «sintetizado» por defecto', () => {
    expect(AUDIO_NORMAL).toBe('sintetizado');
  });
  it('modo normal: ni efectos del dueño ni voces de broma', () => {
    const asked = fireAll(false);
    const owner = asked.filter(n => ['pistol', 'pistolOld', 'machine', 'knife', 'ouch', 'ouchOld', 'dead'].includes(n) || n.startsWith('v:'));
    expect(owner).toEqual([]);
  });
  it('chutaos on: suenan las voces de broma, como antes', () => {
    const asked = fireAll(true);
    expect(asked.some(n => n.startsWith('v:'))).toBe(true);
  });
});
