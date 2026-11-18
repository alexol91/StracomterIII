// Reduce un HDRI Radiance (.hdr) a la mitad de resolución (promedio 2×2) y lo guarda sin comprimir (RGBE plano,
// que RGBELoader de three sabe leer). Uso: npx tsx tools/reducir-hdri.ts entrada.hdr salida.hdr [factor=2]
import fs from 'node:fs';
import { DataUtils, FloatType } from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

const [entrada, salida, f] = [process.argv[2], process.argv[3], Number(process.argv[4] ?? 2)];
if (!entrada || !salida) { console.error('uso: npx tsx tools/reducir-hdri.ts entrada.hdr salida.hdr [factor]'); process.exit(1); }
const buf = fs.readFileSync(entrada);
const img = new RGBELoader().setDataType(FloatType).parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) as { width: number; height: number; data: Float32Array };
void DataUtils;
const w = Math.floor(img.width / f), h = Math.floor(img.height / f);
const out = Buffer.alloc(w * h * 4);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  let r = 0, g = 0, b = 0;
  for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) {
    const k = ((y * f + j) * img.width + (x * f + i)) * 4;
    r += img.data[k]; g += img.data[k + 1]; b += img.data[k + 2];
  }
  r /= f * f; g /= f * f; b /= f * f;
  const m = Math.max(r, g, b);
  const o = (y * w + x) * 4;
  if (m < 1e-32) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; continue; }
  const e = Math.ceil(Math.log2(m) + 1e-9);
  const s = 256 / Math.pow(2, e);
  out[o] = Math.min(255, Math.floor(r * s)); out[o + 1] = Math.min(255, Math.floor(g * s)); out[o + 2] = Math.min(255, Math.floor(b * s)); out[o + 3] = e + 128;
}
// un primer píxel que parezca cabecera RLE (2,2,<128) haría que el lector lo tomara por comprimido: se evita
if (out[0] === 2 && out[1] === 2 && !(out[2] & 0x80)) out[0] = 3;
fs.writeFileSync(salida, Buffer.concat([Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`, 'ascii'), out]));
console.log(`${entrada} ${img.width}x${img.height} -> ${salida} ${w}x${h} (${((fs.statSync(salida).size) / 1024) | 0} KB)`);
