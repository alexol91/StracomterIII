// Mini-plano de una zona en estilo «plano táctico» (blueprint): trazo fino claro sobre fondo oscuro.
// Se dibuja SOLO el plano: perímetro, muros, puertas y muebles. Nunca enemigos ni su composición (§12).
// El grosor de línea es CONSTANTE en píxeles del lienzo, sea el mapa de 100 m² o de 3.000 m²: los muros finos
// se ensanchan a un mínimo legible y los muebles diminutos se reducen a trazos tenues.

import type { MapDef, Vec2 } from '../sim/types';
import { FURNITURE } from '../sim/data';

const WALL = 'rgba(190, 232, 255, 0.95)';
const PERIM = 'rgba(255, 255, 255, 0.98)';
const DOOR = '#f5b301';
const FURN = 'rgba(160, 190, 215, 0.32)';
const GRID = 'rgba(120, 160, 200, 0.10)';

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
  ctx.fillStyle = 'rgba(8, 14, 22, 0.92)';
  ctx.fillRect(0, 0, W, H);

  const per = map.perimetro;
  if (!per || per.length < 3) return;
  const b = bounds(per);
  const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
  const pad = Math.round(Math.min(W, H) * 0.09);
  const sc = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
  const ox = (W - bw * sc) / 2 - b.x0 * sc;
  const oy = (H - bh * sc) / 2 - b.y0 * sc;
  const px = (x: number): number => x * sc + ox;
  const py = (y: number): number => y * sc + oy;
  const u = Math.max(1, W / 320); // unidad de línea: 1 px a 320 de ancho, escala con la resolución del lienzo

  // Cuadrícula: la separación en metros se elige para que quede a ≥ 26 px
  const steps = [1, 2, 5, 10, 20, 50];
  let gm = steps[steps.length - 1];
  for (const sTry of steps) { if (sTry * sc >= 26 * u) { gm = sTry; break; } }
  ctx.strokeStyle = GRID;
  ctx.lineWidth = u;
  ctx.beginPath();
  for (let x = Math.ceil(b.x0 / gm) * gm; x <= b.x1; x += gm) { ctx.moveTo(px(x), py(b.y0) - 4 * u); ctx.lineTo(px(x), py(b.y1) + 4 * u); }
  for (let y = Math.ceil(b.y0 / gm) * gm; y <= b.y1; y += gm) { ctx.moveTo(px(b.x0) - 4 * u, py(y)); ctx.lineTo(px(b.x1) + 4 * u, py(y)); }
  ctx.stroke();

  // Suelo: velo muy tenue
  ctx.beginPath();
  per.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(px(x), py(y)); else ctx.lineTo(px(x), py(y)); });
  ctx.closePath();
  ctx.fillStyle = 'rgba(120, 170, 220, 0.07)';
  ctx.fill();

  // Muebles: trazo tenue; si a esta escala miden menos de 2 px se dibujan como mínimo
  ctx.strokeStyle = FURN;
  ctx.lineWidth = u;
  for (const f of map.mobiliario ?? []) {
    const spec = FURNITURE[f.tipo];
    if (!spec) continue;
    ctx.save();
    ctx.translate(px(f.pos[0]), py(f.pos[1]));
    ctx.rotate((f.angulo * Math.PI) / 180);
    const w = Math.max(2 * u, spec.w * sc), d = Math.max(2 * u, spec.d * sc);
    if (f.tipo === 'maceta') { ctx.beginPath(); ctx.arc(0, 0, Math.max(1.5 * u, w * 0.6), 0, Math.PI * 2); ctx.stroke(); }
    else ctx.strokeRect(-w / 2, -d / 2, w, d);
    ctx.restore();
  }

  // Muros interiores: relleno con espesor mínimo constante
  ctx.fillStyle = WALL;
  const minT = 1.8 * u;
  for (const m of map.muros ?? []) {
    const r = bounds(m);
    const w = (r.x1 - r.x0) * sc, hh = (r.y1 - r.y0) * sc;
    const ww = Math.max(w, minT), h2 = Math.max(hh, minT);
    ctx.fillRect(px(r.x0) - (ww - w) / 2, py(r.y0) - (h2 - hh) / 2, ww, h2);
  }

  // Puertas: ámbar, algo más gruesas que los muros para que se vean siempre
  ctx.fillStyle = DOOR;
  const minD = 3 * u;
  for (const d of map.puertas ?? []) {
    const r = bounds(d);
    const w = (r.x1 - r.x0) * sc, hh = (r.y1 - r.y0) * sc;
    const ww = Math.max(w, minD), h2 = Math.max(hh, minD);
    ctx.fillRect(px(r.x0) - (ww - w) / 2, py(r.y0) - (h2 - hh) / 2, ww, h2);
  }

  // Perímetro
  ctx.beginPath();
  per.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(px(x), py(y)); else ctx.lineTo(px(x), py(y)); });
  ctx.closePath();
  ctx.lineJoin = 'miter';
  ctx.lineWidth = 2.2 * u;
  ctx.strokeStyle = PERIM;
  ctx.stroke();

  // Punto de entrada: anillo azul frío con punto central (nunca el del jefe ni nada hostil)
  if (map.inicio_jugador) {
    const sx = px(map.inicio_jugador[0]), sy = py(map.inicio_jugador[1]);
    const r = 5 * u;
    ctx.strokeStyle = '#6cb4ff';
    ctx.lineWidth = 1.6 * u;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#6cb4ff';
    ctx.beginPath(); ctx.arc(sx, sy, 1.8 * u, 0, Math.PI * 2); ctx.fill();
  }

  // Escala de referencia (barra de metros) abajo a la izquierda
  const barM = [5, 10, 20, 50, 100].find((m) => m * sc >= 40 * u) ?? 100;
  const bx = 8 * u, by = H - 8 * u;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = u;
  ctx.beginPath();
  ctx.moveTo(bx, by - 3 * u); ctx.lineTo(bx, by); ctx.lineTo(bx + barM * sc, by); ctx.lineTo(bx + barM * sc, by - 3 * u);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `${Math.round(8 * u)}px sans-serif`;
  ctx.fillText(`${barM} m`, bx + barM * sc + 5 * u, by);
}
