// Controles táctiles: stick flotante, cámara por arrastre, botón de disparo y botones secundarios.
// Multitoque real con Pointer Events: cada dedo se sigue por su pointerId.
//
// Distribución (px a escala 1; centros medidos desde la esquina inferior DERECHA, sumando
// env(safe-area-inset-*)). Todo se multiplica por settings.uiScale:
//   Disparo 92        centro (68, 68)
//   Recargar 54       (148, 40)     Cuchillo 54 (mantenido)  (140, 102)
//   Granada 54        (206, 100)    Habilidad 54             (214, 40)
//   Usar objeto 54    (200, 160)
//   Interactuar 58    (68, 158)     (contextual, encima del disparo)
//   Agacharse 40      (276, 52)     Cambiar objeto 36        (270, 104)
//   Órdenes 46        (258, 150)    menú 2x2 de 92x38 con borde derecho a 150 px y base a 196 px

import type { IWorld, Settings } from '../contracts';
import type { OrderKind } from '../sim/types';
import { Core, clamp } from './shared';

const STICK_R = 60;      // radio del stick (px a escala 1)
const DEAD = 0.12;       // zona muerta
const CAM_K = 0.005;     // rad por píxel de arrastre (× sensibilidad)

export interface TouchHeld {
  moveF: number;
  moveR: number;
  fire: boolean;
  knife: boolean;
  crouch: boolean;
}

export interface TouchCtl {
  setActive(active: boolean): void;
  applySettings(s: Settings): void;
  /** Una vez por frame: refresca el botón contextual y devuelve lo mantenido (mismo objeto). */
  update(dt: number, world: IWorld | null): TouchHeld;
  /** ¿Hay un dedo arrastrando la cámara ahora mismo (zona de cámara o botón de disparo)? */
  isDragging(): boolean;
  dispose(): void;
}

// ───────── iconos SVG en línea (trazo blanco; el borde negro lo pone CSS) ─────────
const ICONS: Record<string, string> = {
  fire: '<circle cx="12" cy="12" r="6.5"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"/><circle cx="12" cy="12" r="1" fill="#fff"/>',
  reload: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20.5 3.5v5.2h-5.2"/>',
  knife: '<path d="M20 3C14 4 8 9 6 15l3 3c6-2 11-8 11-15z"/><path d="M6 15l-3 6 6-3"/>',
  grenade: '<circle cx="12" cy="14.5" r="6.5"/><path d="M9.5 8h5M12 8V4.5l3.5-2"/>',
  ability: '<path d="M13 2L5 13.5h6L10 22l8-11.5h-6z"/>',
  useItem: '<path d="M9 4h6v5h5v6h-5v5H9v-5H4V9h5z"/>',
  cycle: '<path d="M4 8h14l-3.2-3.2M20 16H6l3.2 3.2"/>',
  crouch: '<circle cx="9" cy="5" r="2.3"/><path d="M9 8v6l6 1.5M9 14l-3.5 6M15 15.5l1 4.5"/>',
  orders: '<path d="M6 21V3.5M6 4.5h12l-3.2 4.2 3.2 4.3H6"/>',
  interact: '<path d="M6 21V3h12v18M3 21h18"/><circle cx="14.5" cy="12.5" r="1" fill="#fff"/>',
};

function svg(name: string, px: number): string {
  return `<svg viewBox="0 0 24 24" style="width:calc(${px}px * var(--s));height:calc(${px}px * var(--s))" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

// ───────── textos ─────────
type Lang = 'es' | 'en';
const TXT: Record<string, { es: string; en: string }> = {
  reload: { es: 'Recargar', en: 'Reload' },
  knife: { es: 'Cuchillo', en: 'Knife' },
  grenade: { es: 'Granada', en: 'Grenade' },
  ability: { es: 'Habilidad', en: 'Ability' },
  useItem: { es: 'Objeto', en: 'Item' },
  interact: { es: 'Puerta', en: 'Door' },
  cycle: { es: 'Cambiar objeto', en: 'Next item' },
  crouch: { es: 'Agacharse', en: 'Crouch' },
  orders: { es: 'Órdenes', en: 'Orders' },
  fire: { es: 'Disparar', en: 'Fire' },
  follow: { es: 'A mí', en: 'To me' },
  goto: { es: 'Ir ahí', en: 'Go there' },
  focus: { es: 'Enfocar', en: 'Focus' },
  hold: { es: 'Mantener', en: 'Hold' },
};

const CSS = `
.touch-layer{position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:6;display:none;--s:1;
  touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;}
.touch-layer.tl-on{display:block}
.touch-layer *{touch-action:none;-webkit-tap-highlight-color:transparent;box-sizing:border-box;-webkit-user-select:none;user-select:none}
.tl-zone{position:absolute;pointer-events:auto}
.tl-stick-base,.tl-stick-hint{position:absolute;border-radius:50%;pointer-events:none;border:calc(3px*var(--s)) solid #000}
.tl-stick-base{display:none;background:rgba(255,255,255,.16)}
.tl-stick-hint{background:rgba(255,255,255,.07);border-color:rgba(0,0,0,.35);border-style:dashed}
.tl-stick-knob{position:absolute;border-radius:50%;border:calc(3px*var(--s)) solid #000;background:rgba(255,255,255,.55);pointer-events:none}
.tl-btn{position:absolute;pointer-events:auto;border-radius:50%;border:calc(3px*var(--s)) solid #000;
  background:rgba(255,236,120,.42);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:0;line-height:1;box-shadow:0 calc(2px*var(--s)) 0 rgba(0,0,0,.5)}
.tl-btn svg{filter:drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000);flex:none}
.tl-btn .tl-cap{font-weight:800;font-size:calc(9px*var(--s));letter-spacing:.2px;margin-top:calc(1px*var(--s));
  text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000;white-space:nowrap}
.tl-btn.tl-fire{background:rgba(255,80,60,.5)}
.tl-btn.tl-interact{background:rgba(120,230,150,.55);display:none}
.tl-btn.tl-down{background:rgba(255,255,255,.7);transform:scale(.94)}
.tl-btn.tl-act{background:rgba(255,150,40,.75)}
.tl-menu{position:absolute;pointer-events:auto;display:none;grid-template-columns:1fr 1fr;gap:calc(6px*var(--s))}
.tl-menu.tl-open{display:grid}
.tl-pill{display:flex;align-items:center;justify-content:center;border-radius:calc(19px*var(--s));
  border:calc(3px*var(--s)) solid #000;background:rgba(255,236,120,.72);color:#000;font-weight:800;
  font-size:calc(13px*var(--s));box-shadow:0 calc(2px*var(--s)) 0 rgba(0,0,0,.5)}
.tl-pill.tl-down{background:#fff}
`;

type Pos = { r: number; b: number; size: number };

export function createTouch(root: HTMLElement, canvas: HTMLCanvasElement, core: Core, acceptMouse: boolean): TouchCtl {
  const input = core.input;
  let lang: Lang = 'es';
  let scale = 1;
  let active = false;
  let clock = 0;
  let lastMoveAt = -10;

  // ───────── DOM ─────────
  const style = document.createElement('style');
  style.setAttribute('data-touch-layer', '');
  style.textContent = CSS;
  document.head.appendChild(style);

  const layer = document.createElement('div');
  layer.className = 'touch-layer';
  root.appendChild(layer);
  layer.addEventListener('contextmenu', (e) => e.preventDefault());

  const prevCanvasTouchAction = canvas.style.touchAction;

  const mk = (cls: string, parent: HTMLElement = layer): HTMLDivElement => {
    const d = document.createElement('div');
    d.className = cls;
    parent.appendChild(d);
    return d;
  };

  /** Colocación por centro desde la esquina inferior derecha, con safe-area y uiScale. */
  const place = (d: HTMLElement, p: Pos): void => {
    d.style.width = `calc(${p.size}px * var(--s))`;
    d.style.height = `calc(${p.size}px * var(--s))`;
    d.style.right = `calc(env(safe-area-inset-right, 0px) + ${p.r - p.size / 2}px * var(--s))`;
    d.style.bottom = `calc(env(safe-area-inset-bottom, 0px) + ${p.b - p.size / 2}px * var(--s))`;
  };

  // Zona de la cámara (mitad derecha, bajo la franja superior de la interfaz) y zona del stick.
  const camZone = mk('tl-zone tl-cam');
  camZone.style.left = '45%'; camZone.style.right = '0'; camZone.style.top = '14%'; camZone.style.bottom = '0';
  const stickZone = mk('tl-zone tl-stick');
  stickZone.style.left = '0'; stickZone.style.bottom = '0'; stickZone.style.width = '45%'; stickZone.style.height = '62%';

  // Aviso tenue de dónde se pone el pulgar (se oculta mientras hay stick).
  const hint = mk('tl-stick-hint');
  const base = mk('tl-stick-base');
  const knob = mk('tl-stick-knob', base);

  const accept = (e: PointerEvent): boolean => e.pointerType !== 'mouse' || acceptMouse;
  const capture = (d: HTMLElement, id: number): void => { try { d.setPointerCapture(id); } catch { /* nada */ } };

  // ───────── stick izquierdo (flotante) ─────────
  let stickId: number | null = null;
  let ox = 0, oy = 0, rx = 0, ry = 0; // origen del stick y esquina de la capa en pantalla
  let sF = 0, sR = 0;

  const stickRadius = (): number => STICK_R * scale;

  function placeHint(): void {
    const R = stickRadius();
    hint.style.width = hint.style.height = `${R * 2}px`;
    hint.style.left = `calc(env(safe-area-inset-left, 0px) + ${16 * scale}px)`;
    hint.style.bottom = `calc(env(safe-area-inset-bottom, 0px) + ${16 * scale}px)`;
  }

  function stickMove(e: PointerEvent): void {
    const R = stickRadius();
    const dx = e.clientX - rx - ox;
    const dy = e.clientY - ry - oy;
    const len = Math.hypot(dx, dy);
    const mag = Math.min(len / R, 1);
    if (mag < DEAD || len === 0) {
      sF = 0; sR = 0;
    } else {
      const m = (mag - DEAD) / (1 - DEAD); // 0 en la zona muerta … 1 a fondo
      sR = (dx / len) * m;
      sF = (-dy / len) * m;
    }
    const k = len > R ? R / len : 1;
    const kr = knobSize() / 2;
    knob.style.left = `${R + dx * k - kr}px`;
    knob.style.top = `${R + dy * k - kr}px`;
  }
  const knobSize = (): number => 52 * scale;

  stickZone.addEventListener('pointerdown', (e) => {
    if (!accept(e) || e.button > 0 || stickId !== null) return;
    e.preventDefault();
    stickId = e.pointerId;
    capture(stickZone, e.pointerId);
    const rect = layer.getBoundingClientRect();
    rx = rect.left; ry = rect.top;
    const R = stickRadius();
    ox = clamp(e.clientX - rx, Math.min(R, rect.width / 2), Math.max(rect.width - R, rect.width / 2));
    oy = clamp(e.clientY - ry, Math.min(R, rect.height / 2), Math.max(rect.height - R, rect.height / 2));
    base.style.display = 'block';
    base.style.width = base.style.height = `${R * 2}px`;
    base.style.left = `${ox - R}px`;
    base.style.top = `${oy - R}px`;
    knob.style.width = knob.style.height = `${knobSize()}px`;
    hint.style.display = 'none';
    stickMove(e);
  });
  stickZone.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) stickMove(e); });
  const stickEnd = (e: PointerEvent): void => { if (e.pointerId === stickId) stickRelease(); };
  stickZone.addEventListener('pointerup', stickEnd);
  stickZone.addEventListener('pointercancel', stickEnd);
  function stickRelease(): void {
    stickId = null; sF = 0; sR = 0;
    base.style.display = 'none';
    hint.style.display = active ? 'block' : 'none';
  }

  // ───────── cámara (arrastre en la zona derecha) ─────────
  let camId: number | null = null;
  let camX = 0, camY = 0;
  const lookBy = (dx: number, dy: number): void => {
    const k = CAM_K * core.sensitivity();
    core.rotate(dx * k, -dy * k);   // arrastrar a la derecha = +yaw; arrastrar arriba = +pitch
    if (dx || dy) lastMoveAt = clock;
  };
  camZone.addEventListener('pointerdown', (e) => {
    if (!accept(e) || e.button > 0 || camId !== null) return;
    e.preventDefault();
    camId = e.pointerId; camX = e.clientX; camY = e.clientY;
    capture(camZone, e.pointerId);
  });
  camZone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== camId) return;
    lookBy(e.clientX - camX, e.clientY - camY);
    camX = e.clientX; camY = e.clientY;
  });
  const camEnd = (e: PointerEvent): void => { if (e.pointerId === camId) camId = null; };
  camZone.addEventListener('pointerup', camEnd);
  camZone.addEventListener('pointercancel', camEnd);

  // ───────── botones ─────────
  const releasers: (() => void)[] = [];
  const texts: { el: HTMLElement; key: string; aria: boolean }[] = [];

  /** Botón de pulsación: down al pulsar, up al soltar (cada dedo con su pointerId). */
  function bindPress(d: HTMLElement, onDown: (e: PointerEvent) => void, onUp: () => void,
    onMove?: (e: PointerEvent) => void): void {
    let id: number | null = null;
    d.addEventListener('pointerdown', (e) => {
      if (!accept(e) || e.button > 0 || id !== null) return;
      e.preventDefault();
      e.stopPropagation();
      id = e.pointerId;
      capture(d, e.pointerId);
      d.classList.add('tl-down');
      onDown(e);
    });
    if (onMove) d.addEventListener('pointermove', (e) => { if (e.pointerId === id) onMove(e); });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      id = null;
      d.classList.remove('tl-down');
      onUp();
    };
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', end);
    releasers.push(() => { if (id !== null) { id = null; d.classList.remove('tl-down'); onUp(); } });
  }

  function makeBtn(key: string, p: Pos, opts: { caption: boolean; icon?: string; cls?: string }): HTMLDivElement {
    const d = mk('tl-btn' + (opts.cls ? ' ' + opts.cls : ''));
    d.setAttribute('role', 'button');
    place(d, p);
    const iconPx = opts.caption ? 22 : Math.round(p.size * 0.55);
    d.innerHTML = svg(opts.icon ?? key, iconPx) + (opts.caption ? '<span class="tl-cap"></span>' : '');
    const cap = d.querySelector('.tl-cap') as HTMLElement | null;
    if (cap) texts.push({ el: cap, key, aria: false });
    texts.push({ el: d, key, aria: true });
    return d;
  }

  // Disparo (mantenido; arrastrar sin soltar gira la cámara)
  let fireHeld = false;
  let fireX = 0, fireY = 0;
  const fireBtn = makeBtn('fire', { r: 68, b: 68, size: 92 }, { caption: false, cls: 'tl-fire' });
  bindPress(fireBtn,
    (e) => { fireHeld = true; fireX = e.clientX; fireY = e.clientY; },
    () => { fireHeld = false; },
    (e) => { lookBy(e.clientX - fireX, e.clientY - fireY); fireX = e.clientX; fireY = e.clientY; });

  // Secundarios de 54 px
  const tap = (key: string, p: Pos, flag: () => void): void => {
    const b = makeBtn(key, p, { caption: true });
    bindPress(b, flag, () => {});
  };
  tap('reload', { r: 148, b: 40, size: 54 }, () => { input.reload = true; });
  tap('grenade', { r: 206, b: 100, size: 54 }, () => { input.grenade = true; });
  tap('ability', { r: 214, b: 40, size: 54 }, () => { input.ability = true; });
  tap('useItem', { r: 200, b: 160, size: 54 }, () => { input.useItem = true; });

  let knifeHeld = false;
  const knifeBtn = makeBtn('knife', { r: 140, b: 102, size: 54 }, { caption: true });
  bindPress(knifeBtn, () => { knifeHeld = true; }, () => { knifeHeld = false; });

  // Pequeños: cambiar de objeto y agacharse (conmutador)
  const cycleBtn = makeBtn('cycle', { r: 270, b: 104, size: 36 }, { caption: false });
  bindPress(cycleBtn, () => { input.cycleItem = true; }, () => {});

  let crouchOn = false;
  const crouchBtn = makeBtn('crouch', { r: 276, b: 52, size: 40 }, { caption: false });
  bindPress(crouchBtn, () => {
    crouchOn = !crouchOn;
    crouchBtn.classList.toggle('tl-act', crouchOn);
  }, () => {});

  // Interactuar contextual (solo visible con puerta al alcance)
  const interactBtn = makeBtn('interact', { r: 68, b: 158, size: 58 }, { caption: true, cls: 'tl-interact' });
  bindPress(interactBtn, () => { input.interact = true; }, () => {});
  let interactShown = false;

  // Órdenes de escuadra: botón + menú 2x2 que se repliega al elegir
  const ordersBtn = makeBtn('orders', { r: 258, b: 150, size: 46 }, { caption: false });
  const menu = mk('tl-menu');
  menu.style.right = `calc(env(safe-area-inset-right, 0px) + ${150}px * var(--s))`;
  menu.style.bottom = `calc(env(safe-area-inset-bottom, 0px) + ${196}px * var(--s))`;
  const closeMenu = (): void => { menu.classList.remove('tl-open'); ordersBtn.classList.remove('tl-act'); };
  bindPress(ordersBtn, () => {
    const open = !menu.classList.contains('tl-open');
    menu.classList.toggle('tl-open', open);
    ordersBtn.classList.toggle('tl-act', open);
  }, () => {});
  const orderKinds: OrderKind[] = ['follow', 'goto', 'focus', 'hold'];
  for (const kind of orderKinds) {
    const pill = mk('tl-pill', menu);
    pill.setAttribute('role', 'button');
    pill.style.width = 'calc(92px * var(--s))';
    pill.style.height = 'calc(38px * var(--s))';
    texts.push({ el: pill, key: kind, aria: false });
    bindPress(pill, () => { input.order = kind; closeMenu(); }, () => {});
  }

  // ───────── texto según idioma ─────────
  function applyLang(): void {
    for (const t of texts) {
      const s = TXT[t.key]?.[lang] ?? t.key;
      if (t.aria) t.el.setAttribute('aria-label', s);
      else t.el.textContent = s;
    }
  }
  applyLang();
  placeHint();

  function releaseAllFingers(): void {
    for (const r of releasers) r();
    stickRelease();
    camId = null;
    fireHeld = false; knifeHeld = false;
    crouchOn = false; crouchBtn.classList.remove('tl-act');
    closeMenu();
  }

  const held: TouchHeld = { moveF: 0, moveR: 0, fire: false, knife: false, crouch: false };

  return {
    setActive(a: boolean): void {
      active = a;
      layer.classList.toggle('tl-on', a);
      canvas.style.touchAction = a ? 'none' : prevCanvasTouchAction;
      if (!a) releaseAllFingers();
      hint.style.display = a && stickId === null ? 'block' : 'none';
    },

    applySettings(s: Settings): void {
      scale = clamp(Number.isFinite(s.uiScale) ? s.uiScale : 1, 0.8, 1.4);
      lang = s.lang === 'en' ? 'en' : 'es';
      layer.style.setProperty('--s', String(scale));
      placeHint();
      applyLang();
    },

    update(dt: number, world: IWorld | null): TouchHeld {
      clock += dt;
      const want = !!world && world.interactDoor >= 0;
      if (want !== interactShown) {
        interactShown = want;
        interactBtn.style.display = want ? 'flex' : 'none';
      }
      held.moveF = sF; held.moveR = sR;
      held.fire = fireHeld; held.knife = knifeHeld; held.crouch = crouchOn;
      return held;
    },

    isDragging(): boolean {
      return (camId !== null || fireHeld) && clock - lastMoveAt < 0.12;
    },

    dispose(): void {
      releaseAllFingers();
      canvas.style.touchAction = prevCanvasTouchAction;
      layer.remove();
      style.remove();
    },
  };
}
