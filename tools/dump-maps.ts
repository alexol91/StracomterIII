// Escribe un SVG por mapa generado (plantas 2-9) y por mapa de muestra en tools/out/, más un index.html.
// Uso:  npx tsx tools/dump-maps.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMapInfo } from '../src/sim/mapgen';
import { FURNITURE } from '../src/sim/data';
import type { FurnitureType, MapDef, Vec2 } from '../src/sim/types';

const AQUI = dirname(fileURLToPath(import.meta.url));
const OUT = join(AQUI, 'out');
const PX = 20; // píxeles por metro
const MARGEN = 1.5;

const COLOR: Record<FurnitureType, string> = {
  mesa: '#c8a06a', escritorio: '#9c6b3a', mesa_con_sillas: '#d9b24c', estanteria: '#6a4a8f',
  sofa: '#3f8f6b', butaca: '#78c4a0', silla: '#b8b8b8', maceta: '#2f9a3a',
};
const OBJ_COLOR: Record<string, string> = {
  vida_20: '#ff9aa8', vida_50: '#ff4d6a', vida_100: '#c4002b',
  municion_20: '#ffe08a', municion_50: '#ffc21a', municion_100: '#c98a00',
};

function area(p: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}
const pts = (p: Vec2[]) => p.map(([x, y]) => `${((x + MARGEN) * PX).toFixed(1)},${((y + MARGEN + 1.2) * PX).toFixed(1)}`).join(' ');

function svgDe(m: MapDef, vanos: Vec2[][] | null, etiqueta: string): string {
  const W = (m.ancho_m + 2 * MARGEN) * PX, H = (m.alto_m + 2 * MARGEN + 1.2) * PX;
  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" font-family="monospace">`);
  o.push(`<rect width="100%" height="100%" fill="#f4f1ea"/>`);
  const titulo = `${etiqueta}  ${area(m.perimetro).toFixed(0)} m2  muros ${m.muros.length}  puertas ${m.puertas.length}` +
    `  vanos ${vanos ? vanos.length : 'n/d'}  muebles ${m.mobiliario.length}  objetos ${m.objetos.length}  ${m.diafano ? 'diafano' : 'cerrado'}`;
  o.push(`<text x="10" y="18" font-size="13" fill="#222">${titulo}</text>`);
  // rejilla de 5 m
  for (let x = 0; x <= m.ancho_m; x += 5) o.push(`<line x1="${((x + MARGEN) * PX).toFixed(1)}" y1="${((MARGEN + 1.2) * PX).toFixed(1)}" x2="${((x + MARGEN) * PX).toFixed(1)}" y2="${((m.alto_m + MARGEN + 1.2) * PX).toFixed(1)}" stroke="#ddd" stroke-width="0.5"/>`);
  for (let y = 0; y <= m.alto_m; y += 5) o.push(`<line x1="${(MARGEN * PX).toFixed(1)}" y1="${((y + MARGEN + 1.2) * PX).toFixed(1)}" x2="${((m.ancho_m + MARGEN) * PX).toFixed(1)}" y2="${((y + MARGEN + 1.2) * PX).toFixed(1)}" stroke="#ddd" stroke-width="0.5"/>`);
  o.push(`<polygon points="${pts(m.perimetro)}" fill="#fff" stroke="#555" stroke-width="3"/>`);
  for (const mu of m.muros) o.push(`<polygon points="${pts(mu)}" fill="#111"/>`);
  if (vanos) for (const v of vanos) o.push(`<polygon points="${pts(v)}" fill="#7fd1ff" fill-opacity="0.45" stroke="#2a8bbf" stroke-width="1" stroke-dasharray="3 2"/>`);
  for (const pu of m.puertas) o.push(`<polygon points="${pts(pu)}" fill="#1f6fe0"/>`);
  for (const f of m.mobiliario) {
    const s = FURNITURE[f.tipo];
    const cx = (f.pos[0] + MARGEN) * PX, cy = (f.pos[1] + MARGEN + 1.2) * PX;
    o.push(`<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${f.angulo})">` +
      `<rect x="${(-s.w * PX / 2).toFixed(1)}" y="${(-s.d * PX / 2).toFixed(1)}" width="${(s.w * PX).toFixed(1)}" height="${(s.d * PX).toFixed(1)}" fill="${COLOR[f.tipo]}" stroke="#333" stroke-width="0.8"/>` +
      `<line x1="${(-s.w * PX / 2).toFixed(1)}" y1="${(-s.d * PX / 2).toFixed(1)}" x2="${(s.w * PX / 2).toFixed(1)}" y2="${(-s.d * PX / 2).toFixed(1)}" stroke="#000" stroke-width="2"/></g>`);
  }
  for (const ob of m.objetos) {
    const cx = (ob.pos[0] + MARGEN) * PX, cy = (ob.pos[1] + MARGEN + 1.2) * PX;
    const vida = ob.tipo.startsWith('vida');
    o.push(vida
      ? `<g><rect x="${(cx - 6).toFixed(1)}" y="${(cy - 6).toFixed(1)}" width="12" height="12" fill="${OBJ_COLOR[ob.tipo]}" stroke="#600" stroke-width="1"/><path d="M${cx - 4},${cy} h8 M${cx},${cy - 4} v8" stroke="#fff" stroke-width="2"/></g>`
      : `<g><rect x="${(cx - 6).toFixed(1)}" y="${(cy - 4).toFixed(1)}" width="12" height="8" fill="${OBJ_COLOR[ob.tipo]}" stroke="#640" stroke-width="1"/></g>`);
    o.push(`<text x="${(cx + 8).toFixed(1)}" y="${(cy + 4).toFixed(1)}" font-size="9" fill="#333">${ob.tipo.split('_')[1]}</text>`);
  }
  const [ix, iy] = m.inicio_jugador, [jx, jy] = m.punto_jefe;
  o.push(`<circle cx="${((ix + MARGEN) * PX).toFixed(1)}" cy="${((iy + MARGEN + 1.2) * PX).toFixed(1)}" r="8" fill="#19b34a" stroke="#064"/>`);
  o.push(`<circle cx="${((jx + MARGEN) * PX).toFixed(1)}" cy="${((jy + MARGEN + 1.2) * PX).toFixed(1)}" r="9" fill="#e02020" stroke="#600"/>`);
  o.push('</svg>');
  return o.join('\n');
}

mkdirSync(OUT, { recursive: true });
const entradas: { fichero: string; titulo: string }[] = [];

// Muestras de la planta 1, para comparar
const muestras = JSON.parse(readFileSync(join(AQUI, '..', 'MAPAS-DE-MUESTRA.json'), 'utf8')) as Record<string, MapDef>;
for (const k of Object.keys(muestras)) {
  const fichero = `muestra-${k}.svg`;
  writeFileSync(join(OUT, fichero), svgDe(muestras[k], null, `MUESTRA ${k}`));
  entradas.push({ fichero, titulo: `Muestra ${k}` });
}

const filas: string[] = ['planta | tamaño | m2 | muros | puertas | vanos | muebles | objetos | tiempo'];
const casos: [number, 'pequeno' | 'mediano' | 'grande'][] = [];
for (let f = 2; f <= 8; f++) for (const s of ['pequeno', 'mediano', 'grande'] as const) casos.push([f, s]);
casos.push([9, 'grande']);
const filtro = process.argv[2]; // p. ej. «2/pequeno» para generar solo ese
const t0 = Date.now();
for (const [f, s] of casos) {
  if (filtro && !(f + '/' + s).startsWith(filtro)) continue;
  const tIni = Date.now();
  const info = generateMapInfo(f, s);
  const ms = Date.now() - tIni;
  const m = info.map;
  const fichero = `P${f}-${s}.svg`;
  writeFileSync(join(OUT, fichero), svgDe(m, info.vanos, m.nombre));
  entradas.push({ fichero, titulo: m.nombre + (info.avisos.length ? ' (AVISOS: ' + info.avisos.join('; ') + ')' : '') });
  filas.push(`${f} | ${s} | ${area(m.perimetro).toFixed(0)} | ${m.muros.length} | ${m.puertas.length} | ${info.vanos.length} | ${m.mobiliario.length} | ${m.objetos.length} | ${ms} ms`);
}
const html = `<!doctype html><meta charset="utf-8"><title>Mapas generados</title>
<style>body{font-family:sans-serif;background:#ddd;margin:16px}figure{margin:0 0 24px;background:#fff;padding:8px;display:inline-block}figcaption{font:12px monospace}</style>
<h1>Mapas generados (plantas 2-9) y muestras</h1>
<p>Negro: muros. Azul: puertas. Celeste punteado: vanos. Verde: inicio. Rojo: jefe. La raya negra gruesa de cada mueble marca su lado «trasero» (y local -).</p>
${entradas.map((e) => `<figure><figcaption>${e.titulo}</figcaption><img src="${e.fichero}"></figure>`).join('\n')}
<pre>${filas.join('\n')}</pre>`;
writeFileSync(join(OUT, 'index.html'), html);
console.log(filas.join('\n'));
void t0;
console.log(`Escritos ${entradas.length} SVG en ${OUT}`);
