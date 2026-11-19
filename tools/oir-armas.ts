// Escribe en WAV los sonidos sintetizados de src/audio/gunsynth.ts para escucharlos fuera del juego.
// Uso: npx tsx tools/oir-armas.ts [carpeta]   (por defecto: ./oir-armas, que no se sube al repositorio)
// Además imprime unas medidas por sonido (pico, energía del transitorio, centroide espectral aprox.).
// NO sustituye a oírlo dentro del juego: allí se suman la distancia, el paneo y la cola de sala.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUN_IDS, renderExplosion, renderFlyby, renderGun, renderPump } from '../src/audio/gunsynth';

const SR = 48000;
const dir = process.argv[2] ?? 'oir-armas';
mkdirSync(dir, { recursive: true });

function wav(data: Float32Array): Buffer {
  const b = Buffer.alloc(44 + data.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  return b;
}

function medir(d: Float32Array) {
  let peak = 0, e5 = 0, eAll = 0, zc = 0;
  const n20 = Math.min(d.length, Math.floor(0.02 * SR));
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]); if (a > peak) peak = a;
    const e = d[i] * d[i]; eAll += e; if (i < 0.005 * SR) e5 += e;
    if (i > 0 && i < n20 && (d[i] >= 0) !== (d[i - 1] >= 0)) zc++;
  }
  return { pico: peak.toFixed(2), transitorio5ms: (e5 / eAll * 100).toFixed(0) + '%', brilloHz20ms: Math.round(zc / 2 / 0.02), dur: (d.length / SR).toFixed(2) + 's' };
}

const out: Record<string, unknown> = {};
for (const id of GUN_IDS) {
  for (let v = 0; v < 2; v++) {
    const d = renderGun(id, SR, v);
    writeFileSync(join(dir, `disparo-${id}-${v}.wav`), wav(d));
    if (v === 0) out[id] = medir(d);
  }
}
const ex = renderExplosion(SR, 0); writeFileSync(join(dir, 'explosion-0.wav'), wav(ex)); out.explosion = medir(ex);
const pu = renderPump(SR, 0); writeFileSync(join(dir, 'corredera-escopeta.wav'), wav(pu)); out.pump = medir(pu);
const fb = renderFlyby(SR, 0); writeFileSync(join(dir, 'bala-cerca.wav'), wav(fb)); out.flyby = medir(fb);
console.table(out);
console.log('WAV escritos en', dir);
