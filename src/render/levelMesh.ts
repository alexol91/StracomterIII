// Geometría del nivel: suelo con textura generada, muros con zócalo/cenefa/remate y degradado,
// fachada con ventanales, oclusión ambiental falsa, luminarias, hojas de puerta, cielo con
// skyline lejano, helipuerto y estrellas de la azotea. Todo generado por código.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ILevel } from '../contracts';
import type { Door, Theme } from '../sim/types';
import { DOOR_HEIGHT, WALL_HEIGHT } from '../sim/data';
import { GeoBuilder, Owned, makeOutlineMat, makeStylized, makeToonVC } from './geo';
import { THEMES, type ThemeDef } from './palette';
import { getStyleMode, outlinesOn } from './style';
import { loadPBR } from './pbr';

/** Colores del cielo [cenit, horizonte] por tema; el horizonte es también el color de la niebla. */
export const SKY: Record<Theme, [number, number]> = {
  recepcion: [0x5d93d6, 0xcfe3f5], soporte: [0x5d93d6, 0xcfe3f5], desarrollo: [0x5a8ad0, 0xc6dcf2],
  calidad: [0x5d93d6, 0xcfe3f5], comercial: [0x6a9ede, 0xdcebf8], direccion: [0x6a8fc8, 0xf0dcc0],
  juntas: [0x5d86c8, 0xc9dcf0], datos: [0x040610, 0x0c1630], azotea: [0x01030a, 0x16264a],
};
/** Color de acento (franja de pared) por planta en el estilo realista. */
const ACCENT: Record<Theme, number> = {
  recepcion: 0x2f66b3, soporte: 0x2e9aa8, desarrollo: 0x3aa66b, calidad: 0xd4a32b, datos: 0x35d0ff,
  comercial: 0xd0693a, direccion: 0x7b2d3a, juntas: 0x4a4fa8, azotea: 0x35d0ff,
};
/**
 * Suelo PBR por tema (estilo realista): conjunto de texturas y multiplicador LINEAL de color [r, g, b].
 * Las texturas de moqueta son muy oscuras (luminosidad ~50/255), así que se multiplican por más de 1.
 */
const FLOOR_PBR: Record<Theme, { set: string; mul: [number, number, number] }> = {
  recepcion: { set: 'marble_tiles', mul: [1.25, 1.35, 1.45] },
  soporte: { set: 'dirty_carpet', mul: [2.3, 3.0, 4.6] },          // moqueta gris azulada
  desarrollo: { set: 'Carpet012', mul: [2.1, 2.15, 2.1] },         // moqueta gris medio
  calidad: { set: 'large_grey_tiles', mul: [1.2, 1.2, 1.25] },
  datos: { set: 'concrete_floor_painted', mul: [1.0, 1.2, 1.7] },
  comercial: { set: 'laminate_floor_02', mul: [1.05, 1.12, 1.3] },
  direccion: { set: 'laminate_floor_02', mul: [0.95, 0.78, 0.62] },
  juntas: { set: 'terrazzo_tiles', mul: [1.0, 1.25, 1.6] },
  azotea: { set: 'rough_concrete', mul: [0.5, 0.55, 0.65] },
};
/** Color de pared (yeso pintado, blanco roto) y de fachada en el estilo realista. */
const WALL_REAL: Record<Theme, { wall: number; facade: number }> = {
  recepcion: { wall: 0xd9d7d1, facade: 0xe4e9ef }, soporte: { wall: 0xd7d7d3, facade: 0xe2e8ee },
  desarrollo: { wall: 0xd8d8d4, facade: 0xe2e8ee }, calidad: { wall: 0xd6d8d3, facade: 0xe2e8ee },
  datos: { wall: 0x77839a, facade: 0x5c6880 }, comercial: { wall: 0xdbd6cd, facade: 0xe8e6e0 },
  direccion: { wall: 0xd3c9b8, facade: 0xdcd2c0 }, juntas: { wall: 0xd6d6d4, facade: 0xe0e4ea },
  azotea: { wall: 0x8e949f, facade: 0x7c828d },
};
export const FOG: Record<Theme, [number, number]> = {
  recepcion: [50, 150], soporte: [50, 150], desarrollo: [50, 150], calidad: [50, 150], comercial: [50, 150],
  direccion: [50, 150], juntas: [50, 150], datos: [22, 90], azotea: [28, 120],
};

// ───────────────────────── Texturas generadas ─────────────────────────

function canvas(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, g: c.getContext('2d')! };
}
function hex(n: number): string { return '#' + n.toString(16).padStart(6, '0'); }
function rnd(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function shade(hexv: number, f: number): number {
  const c = new THREE.Color(hexv); c.multiplyScalar(f); return c.getHex();
}
function rgba(n: number, f: number, a: number): string {
  const r = Math.min(255, ((n >> 16) & 255) * f) | 0, g = Math.min(255, ((n >> 8) & 255) * f) | 0, b = Math.min(255, (n & 255) * f) | 0;
  return `rgba(${r},${g},${b},${a})`;
}

function floorTexture(th: ThemeDef): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = canvas(S);
  const r = rnd(7);
  g.fillStyle = hex(th.floorA); g.fillRect(0, 0, S, S);

  if (th.pattern === 'tiles') {
    // baldosas de mármol 2×2 con veta, variación de tono, junta y bisel
    const n = 2, t = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const base = (i + j) % 2 ? th.floorB : th.floorA;
      const gr = g.createLinearGradient(i * t, j * t, (i + 1) * t, (j + 1) * t);
      gr.addColorStop(0, rgba(base, 1.04 + r() * 0.04, 1)); gr.addColorStop(1, rgba(base, 0.93 + r() * 0.05, 1));
      g.fillStyle = gr; g.fillRect(i * t, j * t, t, t);
      for (let k = 0; k < 7; k++) {            // vetas
        g.strokeStyle = r() > 0.4 ? 'rgba(120,125,140,0.22)' : 'rgba(255,255,255,0.35)';
        g.lineWidth = 0.8 + r() * 1.8;
        g.beginPath();
        let x = i * t + r() * t, y = j * t + r() * t;
        g.moveTo(x, y);
        for (let q = 0; q < 4; q++) { x += (r() - 0.35) * 70; y += (r() - 0.5) * 70; g.lineTo(x, y); }
        g.stroke();
      }
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;                   // bisel claro
      g.strokeRect(i * t + 4, j * t + 4, t - 8, t - 8);
    }
    g.strokeStyle = 'rgba(40,44,55,0.55)'; g.lineWidth = 5;                          // juntas
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, S); g.stroke(); g.beginPath(); g.moveTo(0, i * t); g.lineTo(S, i * t); g.stroke(); }
  } else if (th.pattern === 'carpet') {
    // moqueta con trama y losetas de 1 m
    for (let k = 0; k < 9000; k++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)';
      g.fillRect(r() * S, r() * S, 2, 2);
    }
    g.strokeStyle = 'rgba(0,0,0,0.045)'; g.lineWidth = 1;
    for (let i = 0; i < S; i += 4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
    const n = 4, t = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = ((i + j) % 2) ? 'rgba(0,0,0,0.045)' : 'rgba(255,255,255,0.035)'; g.fillRect(i * t, j * t, t, t);
    }
    g.strokeStyle = rgba(th.floorB, 0.7, 0.8); g.lineWidth = 3;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, S); g.stroke(); g.beginPath(); g.moveTo(0, i * t); g.lineTo(S, i * t); g.stroke(); }
  } else if (th.pattern === 'wood') {
    // tarima en tablas con vetas y juntas alternas
    const n = 8, t = S / n;
    for (let j = 0; j < n; j++) {
      const off = r() * S;
      for (let seg = 0; seg < 2; seg++) {
        const x0 = seg === 0 ? 0 : off, x1 = seg === 0 ? off : S;
        const base = (j + seg) % 2 ? th.floorB : th.floorA;
        g.fillStyle = rgba(base, 0.92 + r() * 0.16, 1); g.fillRect(x0, j * t, x1 - x0, t);
        g.strokeStyle = 'rgba(0,0,0,0.10)'; g.lineWidth = 1;
        for (let k = 0; k < 6; k++) { const y = j * t + 4 + r() * (t - 8); g.beginPath(); g.moveTo(x0, y); g.bezierCurveTo(x0 + 60, y + (r() - 0.5) * 6, x1 - 60, y + (r() - 0.5) * 6, x1, y); g.stroke(); }
        g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x0, j * t, 2, t);
      }
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, j * t, S, 2);
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, j * t + 2, S, 2);
    }
    g.fillStyle = 'rgba(0,0,0,0.45)';
  } else if (th.pattern === 'grid') {
    // suelo técnico: paneles con perforaciones y líneas de luz azul
    g.fillStyle = hex(th.floorB); g.fillRect(0, 0, S, S);
    const n = 4, t = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = rgba(th.floorA, 0.9 + r() * 0.2, 1); g.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) { g.beginPath(); g.arc(i * t + 16 + a * 19, j * t + 16 + b * 19, 3.2, 0, 7); g.fill(); }
      g.fillStyle = 'rgba(160,190,255,0.25)';
      for (const [cx, cy] of [[6, 6], [t - 9, 6], [6, t - 9], [t - 9, t - 9]]) g.fillRect(i * t + cx, j * t + cy, 3, 3);
    }
    g.strokeStyle = 'rgba(53,208,255,0.55)'; g.lineWidth = 2;
    for (let i = 0; i <= n; i += 2) { g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, S); g.stroke(); g.beginPath(); g.moveTo(0, i * t); g.lineTo(S, i * t); g.stroke(); }
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 4;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, S); g.stroke(); g.beginPath(); g.moveTo(0, i * t); g.lineTo(S, i * t); g.stroke(); }
  } else {
    // hormigón con manchas, grano, juntas de dilatación y grietas
    for (let k = 0; k < 22; k++) {
      const x = r() * S, y = r() * S, rad = 30 + r() * 90;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, r() > 0.5 ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.07)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (let k = 0; k < 7000; k++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.13)';
      g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
    }
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 0, S, 4); g.fillRect(0, 0, 4, S);
    g.fillRect(0, S / 2, S, 2); g.fillRect(S / 2, 0, 2, S);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.5;
    for (let k = 0; k < 3; k++) { g.beginPath(); let x = r() * S, y = r() * S; g.moveTo(x, y); for (let q = 0; q < 5; q++) { x += (r() - 0.5) * 60; y += (r() - 0.5) * 60; g.lineTo(x, y); } g.stroke(); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / th.tileM, 1 / th.tileM);   // UV en metros -> una repetición cada tileM metros
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function helipadTexture(): THREE.CanvasTexture {
  const S = 512;
  const { c, g } = canvas(S);
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#2b2f37'; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 6, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#f2c200'; g.lineWidth = 14; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 22, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#f2f2f2'; g.lineWidth = 6; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 46, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#f2f2f2';
  g.fillRect(S * 0.3, S * 0.25, S * 0.07, S * 0.5);
  g.fillRect(S * 0.63, S * 0.25, S * 0.07, S * 0.5);
  g.fillRect(S * 0.3, S * 0.47, S * 0.4, S * 0.07);
  g.fillStyle = '#f2c200';                                  // marcas de aproximación
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.save(); g.translate(S / 2 + Math.cos(a) * (S / 2 - 22), S / 2 + Math.sin(a) * (S / 2 - 22)); g.rotate(a);
    g.fillRect(-10, -4, 20, 8); g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function skylineTexture(night: boolean, theme: Theme): THREE.CanvasTexture {
  const W = 2048, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const r = rnd(1234);
  g.clearRect(0, 0, W, H);
  const fill = night ? ['#0a1124', '#0d162d', '#101a35'] : theme === 'direccion' ? ['#a9a4b0', '#b9b3bd', '#c6c0c8'] : ['#7f97b8', '#8fa6c4', '#a2b6d0'];
  let x = 0;
  while (x < W) {
    const w = 40 + r() * 90, h = 50 + Math.pow(r(), 1.5) * 170;
    g.fillStyle = fill[Math.floor(r() * 3)];
    g.fillRect(x, H - h, w, h);
    if (r() > 0.7) g.fillRect(x + w * 0.4, H - h - 20, 4, 20);           // antena
    for (let wy = H - h + 8; wy < H - 6; wy += 11) for (let wx = x + 6; wx < x + w - 8; wx += 10) {
      if (night) { if (r() > 0.62) { g.fillStyle = r() > 0.25 ? '#ffd27a' : '#9fd0ff'; g.fillRect(wx, wy, 4, 6); } }
      else if (r() > 0.55) { g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(wx, wy, 4, 6); }
    }
    x += w + r() * 14;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ───────────────────────── Muros ─────────────────────────

/** Caja de muro con color por vértice: tapa distinta y degradado vertical (más oscuro abajo). */
function wallBox(cx: number, cz: number, sx: number, sz: number, rotY: number, y0: number, y1: number, main: number, cap: number, grad = true, soft = false): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, y1 - y0, sz);
  g.rotateY(rotY);
  g.translate(cx, (y0 + y1) / 2, cz);
  const n = g.toNonIndexed();
  g.dispose();
  const count = n.getAttribute('position').count;
  const pos = n.getAttribute('position');
  // UV en metros según la cara dominante (para las texturas PBR del estilo realista)
  const nor = n.getAttribute('normal');
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    if (ay > 0.5) { uv[i * 2] = pos.getX(i); uv[i * 2 + 1] = pos.getZ(i); }
    else if (ax >= az) { uv[i * 2] = pos.getZ(i); uv[i * 2 + 1] = pos.getY(i); }
    else { uv[i * 2] = pos.getX(i); uv[i * 2 + 1] = pos.getY(i); }
  }
  n.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const cm = new THREE.Color(main), cc = new THREE.Color(cap);
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const face = Math.floor(i / 6);          // 0 +x, 1 -x, 2 +y (tapa), 3 -y, 4 +z, 5 -z
    const col = face === 2 ? cc : cm;
    let k = 1;
    if (grad && face !== 2) k = (soft ? 0.9 : 0.7) + (soft ? 0.1 : 0.3) * Math.min(1, Math.max(0, (pos.getY(i) - y0) / Math.max(0.01, y1 - y0)));
    arr[i * 3] = col.r * k; arr[i * 3 + 1] = col.g * k; arr[i * 3 + 2] = col.b * k;
  }
  n.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return n;
}

interface WallGeos { main: THREE.BufferGeometry | null; all: THREE.BufferGeometry | null; glass: THREE.BufferGeometry | null; ao: THREE.BufferGeometry | null }

/** Franja de oclusión falsa: cuadrilátero con alfa 0.4 junto al muro que se desvanece hacia fuera. */
function aoQuad(out: number[], ax: number, az: number, bx: number, bz: number, nx: number, nz: number, w: number, a: number): void {
  const P = (x: number, z: number, al: number): void => { out.push(x, 0.012, z, 0, 0, 0, al); };
  const ix = ax + nx * w, iz = az + nz * w, jx = bx + nx * w, jz = bz + nz * w;
  P(ax, az, a); P(bx, bz, a); P(jx, jz, 0);
  P(ax, az, a); P(jx, jz, 0); P(ix, iz, 0);
}

function buildWallGeometry(level: ILevel, th: ThemeDef, theme: Theme): WallGeos {
  const main: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const ao: number[] = [];
  const H = WALL_HEIGHT;
  const hasSegs = level.perimeterSegs.length > 0;
  const band = getStyleMode() === 'realista' ? (ACCENT[theme] ?? 0x2f66b3) : theme === 'datos' || theme === 'azotea' ? th.accent : 0x2f66b3;
  const showBand = theme !== 'azotea';
  const real = getStyleMode() === 'realista';
  const WR = WALL_REAL[theme];
  const wallCol = real ? WR.wall : th.wall;
  const facCol = real ? WR.facade : th.facade;
  const base = shade(th.cap, 1.5);

  for (const w of level.walls) {
    if (w.perimeter && hasSegs) continue;   // la fachada se dibuja desde perimeterSegs
    const sx = w.x1 - w.x0, sz = w.y1 - w.y0;
    if (sx <= 0 || sz <= 0) continue;
    const cx = (w.x0 + w.x1) / 2, cz = (w.y0 + w.y1) / 2;
    main.push(wallBox(cx, cz, sx, sz, 0, 0, H, w.perimeter ? facCol : wallCol, th.cap, true, real));
    trim.push(wallBox(cx, cz, sx + 0.05, sz + 0.05, 0, 0, 0.17, base, base, false));            // zócalo
    if (showBand) trim.push(wallBox(cx, cz, sx + 0.03, sz + 0.03, 0, 1.4, 1.52, band, band, false)); // cenefa
    trim.push(wallBox(cx, cz, sx + 0.07, sz + 0.07, 0, H - 0.1, H + 0.02, th.cap, th.cap, false));   // remate
    aoQuad(ao, w.x0, w.y0, w.x1, w.y0, 0, -1, 0.6, 0.42);
    aoQuad(ao, w.x1, w.y1, w.x0, w.y1, 0, 1, 0.6, 0.42);
    aoQuad(ao, w.x0, w.y1, w.x0, w.y0, -1, 0, 0.6, 0.42);
    aoQuad(ao, w.x1, w.y0, w.x1, w.y1, 1, 0, 0.6, 0.42);
  }

  for (const [x0, y0, x1, y1] of level.perimeterSegs) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.01) continue;
    const a = Math.atan2(y1 - y0, x1 - x0);
    const ux = Math.cos(a), uz = Math.sin(a);
    const mx = (x0 + x1) / 2, mz = (y0 + y1) / 2;
    // caja alineada con el tramo: u = posición a lo largo (centrada), longitud, grosor, alturas
    const along = (list: THREE.BufferGeometry[], u: number, l: number, t: number, ya: number, yb: number, col: number, cap: number, grad = true): void => {
      list.push(wallBox(mx + ux * u, mz + uz * u, l, t, -a, ya, yb, col, cap, grad));
    };
    if (theme === 'azotea') {
      along(main, 0, len + 0.2, 0.3, 0, 1.1, facCol, th.cap);         // peto bajo
      along(trim, 0, len + 0.24, 0.36, 1.08, 1.18, th.cap, th.cap, false);
    } else {
      const n = Math.max(1, Math.round(len / 2.8)), pitch = len / n;
      along(main, 0, len + 0.2, 0.22, 0, 0.9, facCol, th.cap);          // antepecho
      along(main, 0, len + 0.2, 0.22, 2.7, H, facCol, th.cap);          // dintel corrido
      along(trim, 0, len + 0.24, 0.26, 0, 0.17, base, base, false);
      along(trim, 0, len + 0.24, 0.26, 0.9, 0.98, th.cap, th.cap, false);  // alféizar
      for (let i = 0; i <= n; i++) along(main, -len / 2 + i * pitch, 0.34, 0.3, 0.9, 2.7, shade(facCol, 0.85), th.cap);  // pilares
      for (let i = 0; i < n; i++) along(glass, -len / 2 + (i + 0.5) * pitch, pitch - 0.34, 0.05, 0.98, 2.7, 0x7cc4f4, 0xcfeaff);
    }
    // oclusión a ambos lados del tramo
    aoQuad(ao, x0, y0, x1, y1, -uz, ux, 0.6, 0.4);
    aoQuad(ao, x1, y1, x0, y0, uz, -ux, 0.6, 0.4);
  }

  for (const d of level.doors) {
    // dintel sobre el hueco de la puerta
    main.push(wallBox(d.cx, d.cy, d.x1 - d.x0, d.y1 - d.y0, 0, DOOR_HEIGHT, H, wallCol, th.cap, true, real));
  }

  const mainGeo = main.length ? mergeGeometries(main, false) : null;
  const all = main.length || trim.length ? mergeGeometries([...main, ...trim], false) : null;
  const glassGeo = glass.length ? mergeGeometries(glass, false) : null;
  for (const p of [...main, ...trim, ...glass]) p.dispose();

  let aoGeo: THREE.BufferGeometry | null = null;
  if (ao.length) {
    aoGeo = new THREE.BufferGeometry();
    const arr = new Float32Array(ao.length / 7 * 3), col = new Float32Array(ao.length / 7 * 4);
    for (let i = 0; i < ao.length / 7; i++) {
      arr[i * 3] = ao[i * 7]; arr[i * 3 + 1] = ao[i * 7 + 1]; arr[i * 3 + 2] = ao[i * 7 + 2];
      col[i * 4] = 0; col[i * 4 + 1] = 0; col[i * 4 + 2] = 0; col[i * 4 + 3] = ao[i * 7 + 6];
    }
    aoGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    aoGeo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  }
  return { main: mainGeo, all, glass: glassGeo, ao: aoGeo };
}

// ───────────────────────── Capa del nivel ─────────────────────────

interface DoorView { door: Door; pivot: THREE.Group }

export class LevelLayer {
  group = new THREE.Group();
  /** cielo y skyline: siguen a la cámara */
  sky = new THREE.Group();
  private owned = new Owned();
  private wallGroup = new THREE.Group();
  private wallOwned = new Owned();
  private doors: DoorView[] = [];
  private floorMesh!: THREE.Mesh;
  private doorMeshes: THREE.Mesh[] = [];
  private version: number;
  private th: ThemeDef;
  private shadowsOn = false;
  private disposed = false;
  /** luces puntuales del estilo realista (azotea) */
  lights: THREE.PointLight[] = [];

  constructor(private level: ILevel, shadows: boolean) {
    this.th = THEMES[level.theme] ?? THEMES.recepcion;
    this.version = level.version;
    this.shadowsOn = shadows;
    this.buildFloor();
    this.buildWalls();
    this.buildDoors();
    this.group.add(this.wallGroup);
    this.buildLights();
    this.buildSky();
    if (level.theme === 'azotea') this.buildRoofExtras();
    this.setShadows(shadows);
  }

  /** Activa/desactiva recibir y proyectar sombras reales. */
  setShadows(on: boolean): void {
    this.shadowsOn = on;
    this.floorMesh.receiveShadow = on;
    this.wallGroup.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.userData.solid) { m.castShadow = on; m.receiveShadow = on; } });
    for (const m of this.doorMeshes) m.castShadow = on;
    for (const l of this.lights) l.visible = on;   // luces puntuales solo con calidad alta
  }

  private buildFloor(): void {
    const per = this.level.map.perimetro;
    const shape = new THREE.Shape();
    per.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, -y) : shape.lineTo(x, -y)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);       // (x, -y, 0) -> (x, 0, y), normal hacia arriba
    this.owned.add(geo);
    let mat: THREE.Material;
    if (getStyleMode() === 'realista') {
      const cfg = FLOOR_PBR[this.level.theme] ?? FLOOR_PBR.recepcion;
      const sm = new THREE.MeshStandardMaterial({ color: new THREE.Color(...cfg.mul).multiplyScalar(0.35), roughness: 1, metalness: 0 });
      this.owned.add(sm);
      void loadPBR(cfg.set).then((set) => {
        if (!set || this.disposed) return;
        sm.map = set.map; sm.normalMap = set.normalMap; sm.roughnessMap = set.roughnessMap;
        sm.color.setRGB(cfg.mul[0], cfg.mul[1], cfg.mul[2], THREE.LinearSRGBColorSpace);
        sm.needsUpdate = true;
      });
      mat = sm;
    } else {
      const tex = floorTexture(this.th);
      mat = makeStylized({ map: tex, color: 0xb4b4b4 }, { rim: 0, spec: 0.15 });   // albedo rebajado: el suelo claro no debe quemarse
      this.owned.add(tex); this.owned.add(mat);
    }
    this.floorMesh = new THREE.Mesh(geo, mat);
    this.floorMesh.position.y = -0.01;
    this.floorMesh.frustumCulled = false;
    this.group.add(this.floorMesh);
  }

  private buildWalls(): void {
    this.wallOwned.disposeAll();
    this.wallGroup.clear();
    const g = buildWallGeometry(this.level, this.th, this.level.theme);
    if (g.all) {
      const mat = this.wallOwned.add(makeToonVC());
      if (getStyleMode() === 'realista') {
        const sm = mat as THREE.MeshStandardMaterial;
        sm.roughness = 0.92;
        void loadPBR('white_plaster_02').then((set) => {
          if (!set || this.disposed) return;
          sm.normalMap = set.normalMap; sm.normalScale.set(0.25, 0.25); sm.roughnessMap = set.roughnessMap; sm.needsUpdate = true;   // sin mapa de color: blanco limpio
        });
      }
      this.wallOwned.add(g.all);
      const mesh = new THREE.Mesh(g.all, mat);
      mesh.frustumCulled = false;
      mesh.userData.solid = true;
      mesh.castShadow = this.shadowsOn; mesh.receiveShadow = this.shadowsOn;
      this.wallGroup.add(mesh);
    }
    if (g.main) {
      this.wallOwned.add(g.main);
      const eg = this.wallOwned.add(new THREE.EdgesGeometry(g.main, 25));
      const lm = this.wallOwned.add(new THREE.LineBasicMaterial({ color: 0x151220 }));
      const lines = new THREE.LineSegments(eg, lm);
      lines.frustumCulled = false;
      this.wallGroup.add(lines);
    }
    if (g.glass) {
      const gm = this.wallOwned.add(getStyleMode() === 'realista'
        ? new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false, roughness: 0.05, metalness: 0.4 })
        : new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false }));
      this.wallOwned.add(g.glass);
      const mesh = new THREE.Mesh(g.glass, gm);
      mesh.frustumCulled = false; mesh.renderOrder = 1;
      this.wallGroup.add(mesh);
    }
    if (g.ao) {
      const am = this.wallOwned.add(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      this.wallOwned.add(g.ao);
      const mesh = new THREE.Mesh(g.ao, am);
      mesh.frustumCulled = false; mesh.renderOrder = 0;
      this.wallGroup.add(mesh);
    }
  }

  private buildDoors(): void {
    const mat = this.owned.add(makeToonVC());
    const hullMat = this.owned.add(makeOutlineMat());
    for (const d of this.level.doors) {
      const L = d.vertical ? d.y1 - d.y0 : d.x1 - d.x0;
      const hgt = DOOR_HEIGHT - 0.03;
      const th = 0.09;
      const b = new GeoBuilder(0.016);
      b.box(L / 2, hgt / 2, 0, L - 0.02, hgt, th, this.th.door);
      b.box(L / 2, hgt * 0.58, 0, (L - 0.02) * 0.72, hgt * 0.7, th + 0.02, shade(this.th.door, 1.35), { outline: false });
      // pomo de tamaño fijo (no escala con el ancho de la hoja), cerca del extremo libre
      const kx = Math.max(0.2, L - 0.18);
      b.sph(kx, 1.0, th / 2 + 0.04, 0.035, 0xd9b84a, { outline: false });
      b.sph(kx, 1.0, -th / 2 - 0.04, 0.035, 0xd9b84a, { outline: false });
      const { geo, hull } = b.build();
      this.owned.add(geo);
      const pivot = new THREE.Group();
      const m = new THREE.Mesh(geo, mat);
      this.doorMeshes.push(m);
      pivot.add(m);
      if (hull && outlinesOn()) { this.owned.add(hull); pivot.add(new THREE.Mesh(hull, hullMat)); }
      if (d.vertical) pivot.position.set(d.cx, 0, d.y0);
      else pivot.position.set(d.x0, 0, d.cy);
      this.group.add(pivot);
      this.doors.push({ door: d, pivot });
    }
    this.updateDoors();
  }

  private updateDoors(): void {
    for (const dv of this.doors) {
      const a = Math.max(0, Math.min(1, dv.door.anim));
      dv.pivot.rotation.y = dv.door.vertical ? -Math.PI / 2 - a * (Math.PI / 2) : -a * (Math.PI / 2);
    }
  }

  /** Luminarias de techo sugeridas (sin techo): rectángulos emisivos a 3 m cada ~5 m. */
  private buildLights(): void {
    const theme = this.level.theme;
    if (theme === 'azotea') return;
    const per = this.level.map.perimetro;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of per) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const spots: [number, number][] = [];
    const real = getStyleMode() === 'realista';
    const STEP = real ? 4 : 5;
    for (let x = minX + STEP / 2; x < maxX; x += STEP) for (let y = minY + STEP / 2; y < maxY; y += STEP) {
      if (this.level.inside(x, y)) spots.push([x, y]);
    }
    if (!spots.length) return;
    const datos = theme === 'datos';
    const geo = this.owned.add(datos ? new THREE.BoxGeometry(3.2, 0.05, 0.12) : real ? new THREE.BoxGeometry(1.2, 0.04, 0.6) : new THREE.BoxGeometry(1.5, 0.05, 0.5));
    const mat = this.owned.add(new THREE.MeshBasicMaterial({ color: datos ? 0x35d0ff : 0xfff4dc, fog: false }));
    const im = new THREE.InstancedMesh(geo, mat, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, y], i) => { m.makeTranslation(x, WALL_HEIGHT, y); im.setMatrixAt(i, m); });
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    this.group.add(im);
  }

  private buildSky(): void {
    const theme = this.level.theme;
    const [top, bot] = SKY[theme];
    // cúpula con degradado vertical. Estilo realista y planta de oficina: cielo solo junto al horizonte
    // (lo que se ve por los ventanales) y por encima, un techo gris muy oscuro y neutro, de modo que los
    // paneles LED parezcan luminarias de un techo en penumbra.
    const dome = new THREE.SphereGeometry(180, 24, 14);
    const pos = dome.getAttribute('position');
    const cols = new Float32Array(pos.count * 3);
    const ct = new THREE.Color(top), cb = new THREE.Color(bot), cc = new THREE.Color(0x1d1e22), c = new THREE.Color();
    const officeCeiling = getStyleMode() === 'realista' && theme !== 'azotea' && theme !== 'datos';
    for (let i = 0; i < pos.count; i++) {
      const e = pos.getY(i) / 180;                       // seno de la elevación
      if (officeCeiling) {
        if (e <= 0.03) c.copy(cb);
        else if (e < 0.12) c.copy(cb).lerp(ct, (e - 0.03) / 0.09);
        else if (e < 0.26) c.copy(ct).lerp(cc, (e - 0.12) / 0.14);
        else c.copy(cc);
      } else {
        const t = Math.min(1, Math.max(0, (e + 0.05) / 0.65));
        c.copy(cb).lerp(ct, Math.pow(t, 0.8));
      }
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    dome.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const dm = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    const dmesh = new THREE.Mesh(dome, dm);
    dmesh.renderOrder = -20; dmesh.frustumCulled = false;
    // skyline lejano
    const tex = skylineTexture(theme === 'datos' || theme === 'azotea', theme);
    tex.repeat.set(3, 1);
    const low = getStyleMode() === 'realista' && theme !== 'azotea' && theme !== 'datos';   // skyline bajo: no asoma sobre los muros
    const cyl = new THREE.CylinderGeometry(150, 150, low ? 36 : 90, 48, 1, true);
    const cm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false });
    const cmesh = new THREE.Mesh(cyl, cm);
    cmesh.position.y = low ? -4 : -28; cmesh.renderOrder = -19; cmesh.frustumCulled = false;
    this.sky.add(dmesh, cmesh);
    for (const o of [dome, dm, tex, cyl, cm]) this.owned.add(o);
  }

  private buildRoofExtras(): void {
    const [bx, by] = this.level.map.punto_jefe;
    if (getStyleMode() === 'realista') {
      // luces cálidas sobre los casetones: junto a la salida del jugador, el helipuerto y el centro
      const [sx, sy] = this.level.map.inicio_jugador;
      for (const [x, y] of [[sx, sy], [bx, by], [this.level.map.ancho_m / 2, this.level.map.alto_m / 2]]) {
        const l = new THREE.PointLight(0xffc27a, 40, 22, 2);
        l.position.set(x, 3.2, y);
        this.lights.push(l); this.group.add(l);
      }
    }
    const tex = helipadTexture();
    const R = 6.5;
    const geo = new THREE.PlaneGeometry(R * 2, R * 2).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
    this.owned.add(tex); this.owned.add(geo); this.owned.add(mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(bx, 0.015, by);
    this.group.add(m);
  }

  /** Cada frame: reconstruye muros si cambió la geometría, y mueve las puertas. */
  update(): void {
    if (this.level.version !== this.version) {
      this.version = this.level.version;
      this.buildWalls();
    }
    this.updateDoors();
  }

  followCamera(x: number, y: number, z: number): void {
    this.sky.position.set(x, y, z);
    this.sky.children[1]?.position.setY(-28 - 0);   // el skyline mantiene su base respecto a la cámara
  }

  dispose(): void {
    this.disposed = true;
    this.wallOwned.disposeAll();
    this.owned.disposeAll();
  }
}

/** Estrellas del cielo de la azotea. */
export function makeStars(owned: Owned): THREE.Points {
  const n = 260;
  const pos = new Float32Array(n * 3);
  const r = rnd(99);
  for (let i = 0; i < n; i++) {
    const az = r() * Math.PI * 2, el = 0.12 + r() * 1.2;
    const R = 170;
    pos[i * 3] = Math.cos(az) * Math.cos(el) * R;
    pos[i * 3 + 1] = Math.sin(el) * R;
    pos[i * 3 + 2] = Math.sin(az) * Math.cos(el) * R;
  }
  const g = owned.add(new THREE.BufferGeometry());
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = owned.add(new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, fog: false }));
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = -18;
  return p;
}
