// Recorta el GLB del maniquí «Universal Animation Library» (Quaternius, CC0) para el juego.
// El retargeteo solo necesita el esqueleto (los nodos) y los clips: se conservan los nodos y SOLO las
// animaciones de la lista; se eliminan mallas, esqueletos con pesos, materiales, texturas e imágenes y se
// recompone el búfer binario con los accessors que quedan.
//
// Uso: npx tsx tools/recortar-ual.ts [entrada.glb] [salida.glb]
// (sin dependencias nuevas: parsea a mano la cabecera, el chunk JSON y el chunk BIN)

import fs from 'node:fs';
import { UAL_TO_ROCKETBOX } from '../src/render/retarget';

/** Clips que usa el juego (src/render/rbchars.ts y preview.ts). */
export const KEEP = [
  'Pistol_Idle_Loop', 'Pistol_Aim_Neutral', 'Pistol_Shoot', 'Pistol_Reload', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop',
  'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Punch_Jab', 'Punch_Cross', 'Hit_Chest', 'Hit_Head', 'Death01', 'Idle_Loop', 'Roll', 'Sword_Attack',
];

const COMP_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

export function recortar(input: Buffer, keep: string[]): Buffer {
  if (input.toString('ascii', 0, 4) !== 'glTF') throw new Error('no es un GLB');
  let off = 12;
  let json: any = null; let bin: Buffer | null = null;
  while (off < input.length) {
    const len = input.readUInt32LE(off), type = input.toString('ascii', off + 4, off + 8);
    const data = input.subarray(off + 8, off + 8 + len);
    if (type === 'JSON') json = JSON.parse(data.toString('utf8'));
    else if (type.startsWith('BIN')) bin = data;
    off += 8 + len;
  }
  if (!json || !bin) throw new Error('faltan chunks');

  json.animations = (json.animations ?? []).filter((a: any) => keep.includes(a.name));
  // solo los huesos que el retargeteo lee (los emparejados y sus ancestros): se descartan dedos, IK, cara…
  const clean = (n: string): string => n.replace(/\./g, '');
  const mapped = new Set<string>(Object.values(UAL_TO_ROCKETBOX.bones).map((b) => b.src));
  mapped.add(UAL_TO_ROCKETBOX.hipsSrc);
  const parent = new Map<number, number>();
  json.nodes.forEach((n: any, i: number) => { for (const c of n.children ?? []) parent.set(c, i); });
  const keepNode = new Set<number>();
  json.nodes.forEach((n: any, i: number) => {
    if (!mapped.has(clean(n.name ?? ''))) return;
    for (let k: number | undefined = i; k !== undefined; k = parent.get(k)) keepNode.add(k);
  });
  for (const a of json.animations) {
    a.channels = a.channels.filter((c: any) => keepNode.has(c.target.node));
    const used = [...new Set<number>(a.channels.map((c: any) => c.sampler))];
    const map = new Map(used.map((o, i) => [o, i]));
    a.samplers = used.map((o) => a.samplers[o]);
    for (const c of a.channels) c.sampler = map.get(c.sampler);
  }
  const remap = new Map<number, number>();
  const chunks: Buffer[] = [];
  const newViews: any[] = [], newAcc: any[] = [];
  let cursor = 0;
  const use = (oldIdx: number): number => {
    const got = remap.get(oldIdx);
    if (got !== undefined) return got;
    const acc = json.accessors[oldIdx];
    if (acc.sparse) throw new Error('accessor sparse no soportado');
    const bv = json.bufferViews[acc.bufferView];
    if (bv.byteStride) throw new Error('bufferView con byteStride no soportado');
    const size = acc.count * TYPE_COUNT[acc.type] * COMP_SIZE[acc.componentType];
    const start = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const slice = bin!.subarray(start, start + size);
    const padded = Buffer.alloc((size + 3) & ~3);
    slice.copy(padded);
    chunks.push(padded);
    newViews.push({ buffer: 0, byteOffset: cursor, byteLength: size });
    cursor += padded.length;
    const na = { ...acc, bufferView: newViews.length - 1 };
    delete na.byteOffset;
    newAcc.push(na);
    remap.set(oldIdx, newAcc.length - 1);
    return newAcc.length - 1;
  };
  for (const a of json.animations) for (const s of a.samplers) { s.input = use(s.input); s.output = use(s.output); }

  json.accessors = newAcc;
  json.bufferViews = newViews;
  json.buffers = [{ byteLength: cursor }];
  for (const k of ['meshes', 'materials', 'textures', 'images', 'samplers', 'skins', 'cameras']) delete json[k];
  for (const n of json.nodes ?? []) { delete n.mesh; delete n.skin; }
  delete json.extensionsUsed; delete json.extensionsRequired;

  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const binBuf = Buffer.concat(chunks);
  const total = 12 + 8 + jsonPad.length + 8 + binBuf.length;
  const head = Buffer.alloc(12);
  head.write('glTF', 0, 'ascii'); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const c0 = Buffer.alloc(8); c0.writeUInt32LE(jsonPad.length, 0); c0.write('JSON', 4, 'ascii');
  const c1 = Buffer.alloc(8); c1.writeUInt32LE(binBuf.length, 0); c1.write('BIN\0', 4, 'ascii');
  return Buffer.concat([head, c0, jsonPad, c1, binBuf]);
}

const isMain = process.argv[1] && process.argv[1].endsWith('recortar-ual.ts');
if (isMain) {
  const entrada = process.argv[2] ?? 'assets-src/quaternius-universal-animation-library/Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb';
  const salida = process.argv[3] ?? 'public/models/anim/ual-min.glb';
  const out = recortar(fs.readFileSync(entrada), KEEP);
  fs.writeFileSync(salida, out);
  console.log(`${entrada} (${(fs.statSync(entrada).size / 1024) | 0} KB) -> ${salida} (${(out.length / 1024) | 0} KB)`);
}
