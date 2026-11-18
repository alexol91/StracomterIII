// Mini-plano de una zona para la pantalla de Estrategia. Se dibuja SOLO el plano: perímetro, muros, puertas y
// muebles. Nunca enemigos ni su composición (§12: el jugador decide con información parcial).

import type { MapDef, Vec2 } from '../sim/types';
import { FURNITURE } from '../sim/data';

const INK = '#10131a';

function bounds(pts: Vec2[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** Dibuja el mapa en el canvas (se ajusta a su tamaño interno, con márgenes). */
export function drawMiniMap(canvas: HTMLCanvasElement, map: MapDef): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  // Fondo de plano técnico
  ctx.fillStyle = '#aeb8c6';
  ctx.fillRect(0, 0, W, H);

  const per = map.perimetro;
  if (!per || per.length < 3) return;
  const b = bounds(per);
  const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
  const pad = Math.round(Math.min(W, H) * 0.07);
  const sc = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
  const ox = (W - bw * sc) / 2 - b.x0 * sc;
  const oy = (H - bh * sc) / 2 - b.y0 * sc;
  const px = (x: number): number => x * sc + ox;
  const py = (y: number): number => y * sc + oy;
  const lw = Math.max(1.5, W / 130);

  // Suelo
  ctx.beginPath();
  per.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(px(x), py(y)); else ctx.lineTo(px(x), py(y)); });
  ctx.closePath();
  ctx.fillStyle = '#eef1f5';
  ctx.fill();

  // Muebles (rectángulos girados)
  for (const f of map.mobiliario ?? []) {
    const spec = FURNITURE[f.tipo];
    if (!spec) continue;
    ctx.save();
    ctx.translate(px(f.pos[0]), py(f.pos[1]));
    ctx.rotate((f.angulo * Math.PI) / 180);
    const w = Math.max(2, spec.w * sc), d = Math.max(2, spec.d * sc);
    if (f.tipo === 'maceta') {
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(2, w * 0.7), 0, Math.PI * 2);
      ctx.fillStyle = '#5fae6b';
    } else {
      ctx.beginPath();
      ctx.rect(-w / 2, -d / 2, w, d);
      ctx.fillStyle = spec.cover === 'high' ? '#7e8c9f' : spec.cover === 'none' ? '#cbd3de' : '#9fb0c6';
    }
    ctx.fill();
    ctx.lineWidth = Math.max(1, lw * 0.5);
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.restore();
  }

  // Muros interiores
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw * 0.6;
  for (const m of map.muros ?? []) {
    const r = bounds(m);
    const x = px(r.x0), y = py(r.y0), w = (r.x1 - r.x0) * sc, hh = (r.y1 - r.y0) * sc;
    // Mínimo legible aunque el muro sea muy fino a esta escala
    ctx.fillRect(x - (w < lw ? (lw - w) / 2 : 0), y - (hh < lw ? (lw - hh) / 2 : 0), Math.max(w, lw), Math.max(hh, lw));
  }

  // Puertas (naranja con borde)
  for (const d of map.puertas ?? []) {
    const r = bounds(d);
    const x = px(r.x0), y = py(r.y0), w = (r.x1 - r.x0) * sc, hh = (r.y1 - r.y0) * sc;
    const ww = Math.max(w, lw * 1.6), h2 = Math.max(hh, lw * 1.6);
    ctx.fillStyle = '#ff9a3c';
    ctx.fillRect(x - (ww - w) / 2, y - (h2 - hh) / 2, ww, h2);
    ctx.lineWidth = Math.max(1, lw * 0.5);
    ctx.strokeRect(x - (ww - w) / 2, y - (h2 - hh) / 2, ww, h2);
  }

  // Perímetro encima, grueso
  ctx.beginPath();
  per.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(px(x), py(y)); else ctx.lineTo(px(x), py(y)); });
  ctx.closePath();
  ctx.lineJoin = 'miter';
  ctx.lineWidth = lw * 1.6;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // Punto de entrada (el del jugador). No se pinta el del jefe ni nada hostil.
  if (map.inicio_jugador) {
    const sx = px(map.inicio_jugador[0]), sy = py(map.inicio_jugador[1]);
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(3, W / 55), 0, Math.PI * 2);
    ctx.fillStyle = '#1d5fd0';
    ctx.fill();
    ctx.lineWidth = lw * 0.7;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(3, W / 55) + 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw * 0.5;
    ctx.stroke();
  }
}
