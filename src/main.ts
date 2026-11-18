// Armazón de la aplicación: máquina de estados de pantallas, bucle de juego y consola de trucos.
//
// Pantallas (screen): title · class · strategy · game · pause · options · summary · defeat · victory · credits.
//  - 'game' es la única en la que corre world.step. 'pause' y 'options' (desde la pausa) mantienen el mundo
//    dibujado pero congelado; el resto lo descarta.
//  - La consola de trucos es una superposición independiente (consoleUi.isOpen): mientras está abierta no se simula.

import './ui/styles.css';
import type {
  CampaignState, ConsoleHost, IAudio, IConsole, IControls, ICampaign, IRenderer, IWorld, KVStorage, MusicTrack, ZoneSummary,
} from './contracts';
import type { ClassId, PlayerInput } from './sim/types';
import { CLASS_IDS, emptyInput } from './sim/types';
import { createRenderer } from './render';
import { createAudio } from './audio';
import { createControls } from './input';
import { createCampaign } from './sim/campaign';
import { createConsole } from './sim/console';
import { onLangChange, setLang, t } from './ui/i18n';
import { loadSettings, saveSettings } from './ui/settings';
import { asset, flags, h, pad2, setUiAudio, stepNav } from './ui/dom';
import {
  Screens, classScreen, creditsScreen, defeatScreen, optionsScreen, pauseScreen, strategyScreen, summaryScreen,
  titleScreen, victoryScreen,
} from './ui/screens';
import { Hud } from './ui/hud';
import { ConsoleOverlay } from './ui/consoleOverlay';

type Screen =
  | 'title' | 'class' | 'strategy' | 'game' | 'pause' | 'options' | 'summary' | 'defeat' | 'victory' | 'credits';

const STEP = 1 / 60;
const MAX_STEPS = 5;
const END_DELAY = 1.5; // s entre «zona limpia»/«muerte» y la pantalla siguiente

// ───────────────────────────── Ajustes e idioma ─────────────────────────────

const params = new URLSearchParams(location.search);
const settings = loadSettings();
// ?lang=en fuerza inglés para pruebas (no se guarda). Sin parámetro manda el ajuste guardado; por defecto, español.
{
  const q = params.get('lang');
  if (q === 'en' || q === 'es') settings.lang = q;
}
setLang(settings.lang);

// Fondo de menús (public/ui): variable CSS para usarlo en varias pantallas sin repetir la ruta
document.documentElement.style.setProperty('--tower', `url("${new URL(asset('ui/fondo-torre.webp'), location.href).href}")`);

// ───────────────────────────── Almacenamiento ─────────────────────────────

function makeStorage(): KVStorage {
  try {
    const k = '__stracomter_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    // Modo privado o almacenamiento bloqueado: la partida sigue, solo que sin persistir
    const mem = new Map<string, string>();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k, v) => { mem.set(k, v); },
      removeItem: (k) => { mem.delete(k); },
    };
  }
}

// ───────────────────────────── DOM base ─────────────────────────────

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctlRoot = document.getElementById('ctl') as HTMLElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

function toast(msg: string, ms = 4500): void {
  const el = h('div', { class: 'toast' }, msg);
  uiRoot.appendChild(el);
  window.setTimeout(() => el.remove(), ms);
}

// ───────────────────────────── Módulos ─────────────────────────────

let renderer: IRenderer;
let audio: IAudio;
let controls: IControls;
let campaign: ICampaign;
let cons: IConsole;

try {
  renderer = createRenderer(canvas);
} catch (err) {
  console.error(err);
  uiRoot.appendChild(h('div', { class: 'screen bg-dim' }, h('div', { class: 'panel center-col' }, t('err.webgl'))));
  throw err;
}
audio = createAudio();
setUiAudio(audio);
controls = createControls(ctlRoot, canvas);
campaign = createCampaign(makeStorage());

// ───────────────────────────── Estado de la aplicación ─────────────────────────────

let screen: Screen = 'title';
let state: CampaignState | null = null;
let world: IWorld | null = null;
let optionsFrom: 'title' | 'pause' = 'title';
let quickFloor = 1;
let lastSummary: ZoneSummary | null = null;

let acc = 0;                 // acumulador del paso fijo
let endTimer = 0;            // s transcurridos desde cleared/dead
let lastFrameMs = performance.now();
let musicTimer = 0;
let gameTrack: MusicTrack = null;
let curMusic: MusicTrack = null;
let audioUnlocked = false;
let lastPauseToggle = -1e9;
let lastConsoleToggle = -1e9;

// Pantalla de carga de zona: se quita al primer frame dibujado, respetando un mínimo y un máximo (ver frame())
const loadingText = h('div', { class: 'ld-t' });
const loadingEl = h('div', { id: 'loading', class: 'out' }, loadingText, h('div', { class: 'ld-bar' }));
let loadingActive = false;
let loadingSince = 0;
let loadingFrames = 0;
let loadedOnce = false; // los modelos pesan: la primera zona de la sesión espera más que las siguientes

function showLoading(floor: number, zone: number): void {
  loadingText.textContent = t('load.deploying', { floor: pad2(floor), zone: pad2(zone) });
  loadingEl.classList.remove('out');
  loadingActive = true;
  loadingSince = performance.now();
  loadingFrames = 0;
}
function hideLoading(): void {
  loadingActive = false;
  loadingEl.classList.add('out');
}

// Dentro de #ui, de abajo arriba: HUD, capa de pantallas, carga, consola.
const screensLayer = h('div', { id: 'screens' });
const screens = new Screens(screensLayer);
const hud = new Hud(uiRoot, () => settings, () => controls.isTouch, () => togglePause());
uiRoot.appendChild(screensLayer);
uiRoot.appendChild(loadingEl);
const consoleUi = new ConsoleOverlay(uiRoot, runConsole, () => closeConsole());

// ───────────────────────────── Ajustes aplicados ─────────────────────────────

function applyAll(save: boolean): void {
  document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale));
  document.body.classList.toggle('cb', settings.colorblind);
  setLang(settings.lang);
  renderer.applySettings(settings);
  audio.applySettings(settings);
  controls.applySettings(settings);
  if (save) saveSettings(settings);
}

onLangChange(() => {
  document.title = t('title.name');
  screens.refresh();
  hud.relabel();
  consoleUi.relabel();
});

// ───────────────────────────── Música ─────────────────────────────

function music(track: MusicTrack): void {
  curMusic = track;
  audio.music(track);
}

function updateGameMusic(force = false): void {
  if (!world) return;
  let want: MusicTrack = world.floor === 9 ? 'boss' : 'combat';
  if (want !== 'boss') {
    const p = world.player;
    for (const e of world.entities) {
      if (e.alive && e.team === 'enemy' && (e.kind === 'miniboss' || e.kind === 'megaboss')
        && Math.hypot(e.x - p.x, e.y - p.y) < 15) { want = 'boss'; break; }
    }
  }
  if (force || want !== gameTrack) { gameTrack = want; music(want); }
}

// ───────────────────────────── Pantallas ─────────────────────────────

function leaveGame(): void {
  world = null;
  renderer.setWorld(null);
  renderer.render(0); // deja el lienzo limpio
  controls.setActive(false);
  hud.show(false);
  gameTrack = null;
  if (loadingActive) hideLoading();
}

function showTitle(): void {
  leaveGame();
  screen = 'title';
  music('menu');
  screens.show(() => titleScreen({
    hasSave: campaign.hasSave(),
    onNew: () => showClassSelect(false),
    onContinue: continueCampaign,
    onQuick: () => showClassSelect(true),
    onOptions: () => showOptions('title'),
    onCredits: showCredits,
    onLang: (l) => { settings.lang = l; applyAll(true); },
  }));
}

function showClassSelect(quick: boolean): void {
  screen = 'class';
  music('menu');
  screens.show((sc) => classScreen(sc, {
    quickFloor: quick ? quickFloor : null,
    onFloor: (n) => { quickFloor = n; screens.refresh(); },
    onPick: (c) => {
      state = quick
        ? campaign.newQuickPlay(settings.difficulty, c, quickFloor)
        : campaign.newCampaign(settings.difficulty, c);
      showStrategy();
    },
    onBack: showTitle,
  }));
}

function continueCampaign(): void {
  const st = campaign.load();
  if (!st) { toast(t('menu.noSave')); return; }
  state = st;
  if (state.floor > 9) showVictory(); else showStrategy();
}

function showStrategy(): void {
  if (!state) { showTitle(); return; }
  leaveGame();
  screen = 'strategy';
  music('strategy');
  const st = state;
  // Si el personaje controlado está muerto, se pasa al primero vivo
  if (st.members[st.controlled].hp <= 0) {
    const alive = CLASS_IDS.find((c) => st.members[c].hp > 0);
    if (alive) st.controlled = alive;
  }
  const zones = campaign.zonesOf(st.floor);
  screens.show((sc) => strategyScreen(sc, {
    state: st, zones,
    onEnter: enterZone,
    onControl: (c: ClassId) => { st.controlled = c; },
    onMenu: showTitle,
  }));
}

function showPause(): void {
  if (!world) return;
  screen = 'pause';
  lastPauseToggle = performance.now();
  controls.setActive(false);
  screens.show((sc) => pauseScreen(sc, {
    onResume: resume,
    onOptions: () => showOptions('pause'),
    onConsole: () => openConsole(),
    onQuit: showTitle,
  }));
}

function resume(): void {
  if (!world) return;
  screens.clear();
  screen = 'game';
  hud.show(true);
  acc = 0;
  controls.setActive(!consoleUi.isOpen);
}

/** Alterna pausa/juego. Se protege contra el doble disparo (controles + atajo propio) en el mismo gesto. */
function togglePause(): void {
  const now = performance.now();
  if (now - lastPauseToggle < 200) return;
  lastPauseToggle = now;
  if (consoleUi.isOpen) { closeConsole(); return; }
  if (screen === 'game') showPause();
  else if (screen === 'pause') resume();
}

function showOptions(from: 'title' | 'pause'): void {
  optionsFrom = from;
  screen = 'options';
  if (from === 'pause') hud.show(false); else music('menu');
  screens.show((s) => optionsScreen(s, {
    settings,
    onChange: () => applyAll(true),
    onBack: () => {
      if (optionsFrom === 'pause') { hud.show(true); showPause(); } else showTitle();
    },
  }));
}

function showCredits(): void {
  leaveGame();
  screen = 'credits';
  music('menu');
  screens.show((sc) => creditsScreen(sc, { onBack: showTitle }));
}

function showSummary(summary: ZoneSummary): void {
  screen = 'summary';
  lastSummary = summary;
  music('strategy');
  const shownAt = Date.now();
  screens.show((s) => summaryScreen(s, {
    summary, shownAt,
    onContinue: () => {
      if (summary.campaignWon) showVictory();
      else if (state?.quick) showTitle();
      else showStrategy();
    },
  }));
}

function showDefeat(): void {
  screen = 'defeat';
  controls.setActive(false);
  hud.show(false);
  audio.ui('defeat');
  if (state) campaign.failZone(state); // el ajuste dinámico afloja un escalón tras una derrota
  const floor = world?.floor ?? state?.floor ?? 1;
  const zone = world?.zone ?? 1;
  screens.show((sc) => defeatScreen(sc, { floor, zone, onRetry: retryFloor, onMenu: showTitle }));
}

function retryFloor(): void {
  // El estado solo cambia en completeZone, así que está tal como estaba al empezar la planta.
  if (!state) { showTitle(); return; }
  showStrategy();
}

function showVictory(): void {
  leaveGame();
  screen = 'victory';
  music('victory');
  audio.ui('victory');
  const score = state?.score ?? lastSummary?.totalScore ?? 0;
  screens.show(() => victoryScreen({ score, onContinue: showCredits }));
}

// ───────────────────────────── Zona de juego ─────────────────────────────

function enterZone(zone: number): void {
  if (!state) return;
  showLoading(state.floor, zone);
  try {
    beginWorld(campaign.startZone(state, zone));
  } catch (err) {
    hideLoading();
    console.error(err);
    toast(t('err.zone', { msg: err instanceof Error ? err.message : String(err) }));
  }
}

function beginWorld(w: IWorld): void {
  world = w;
  acc = 0;
  endTimer = 0;
  musicTimer = 0;
  screens.clear();
  screen = 'game';
  renderer.setWorld(w);
  controls.setView(w.player.yaw, -0.12);
  controls.setActive(!consoleUi.isOpen);
  hud.reset();
  hud.show(true);
  updateGameMusic(true);
  const ae = document.activeElement as HTMLElement | null;
  if (ae && ae !== document.body && !ae.closest('#console')) ae.blur();
}

function finishZone(): void {
  if (!world || !state) return;
  const summary = campaign.completeZone(state, world);
  leaveGame();
  audio.ui('reward');
  showSummary(summary);
}

function neutralInput(src: PlayerInput): PlayerInput {
  const e = emptyInput();
  e.yaw = src.yaw; e.pitch = src.pitch; e.camDist = src.camDist;
  return e;
}

function simulate(dtReal: number): void {
  const w = world!;
  const input = controls.poll(dtReal, w);
  acc += dtReal;
  let n = 0;
  while (acc >= STEP && n < MAX_STEPS) {
    w.step(STEP, w.status === 'playing' ? input : neutralInput(input));
    renderer.onEvents(w.events);
    audio.handleEvents(w);
    hud.onEvents(w);
    acc -= STEP;
    n++;
  }
  // Si el frame tardó demasiado, el exceso se descarta (no se acumula deuda de simulación)
  if (acc >= STEP) acc = 0;

  if (w.status === 'cleared' || w.status === 'dead') {
    endTimer += dtReal;
    if (endTimer >= END_DELAY) {
      if (w.status === 'cleared') finishZone(); else showDefeat();
    }
  } else {
    endTimer = 0;
  }
}

function frame(nowMs: number): void {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.25, Math.max(0, (nowMs - lastFrameMs) / 1000));
  lastFrameMs = nowMs;
  try {
    if (world) {
      if (screen === 'game' && !consoleUi.isOpen && !loadingActive) {
        simulate(dtReal);
        musicTimer += dtReal;
        if (musicTimer >= 0.5 && world) { musicTimer = 0; updateGameMusic(); }
      }
      if (world) {
        renderer.render(dtReal);
        if (screen === 'game' || screen === 'pause') hud.update(world);
        if (loadingActive) {
          loadingFrames++;
          const el = performance.now() - loadingSince;
          // Sin señal del renderer: 1ª vez mínimo 1,2 s y máximo 4 s; después 0,4 s y 1,5 s
          const minMs = loadedOnce ? 400 : 1200, maxMs = loadedOnce ? 1500 : 4000;
          if ((loadingFrames >= 1 && el >= minMs) || el >= maxMs) { hideLoading(); loadedOnce = true; }
        }
      }
    }
  } catch (err) {
    reportError(err);
  }
}

const reported = new Set<string>();
function reportError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(err);
  if (reported.has(msg)) return;
  reported.add(msg);
  toast(t('err.generic', { msg }), 7000);
}

// ───────────────────────────── Consola de trucos ─────────────────────────────

function runConsole(line: string): string[] {
  return cons.exec(line, world);
}

function openConsole(): void {
  if (consoleUi.isOpen) return;
  controls.setActive(false);
  consoleUi.open();
}

function closeConsole(): void {
  if (!consoleUi.isOpen) return;
  consoleUi.close();
  if (screen === 'game') { acc = 0; controls.setActive(true); }
}

function toggleConsole(): void {
  const now = performance.now();
  if (now - lastConsoleToggle < 200) return;
  lastConsoleToggle = now;
  if (consoleUi.isOpen) closeConsole(); else openConsole();
}

/** Salto de planta/zona pedido por la consola (`floor`, `zone`). */
function gotoFloorZone(floor: number | null, zone: number | null): string {
  if (floor !== null && (!Number.isInteger(floor) || floor < 1 || floor > 9)) return t('con.badFloor');
  if (zone !== null && (!Number.isInteger(zone) || zone < 1 || zone > 6)) return t('con.badZone', { max: 6 });
  // Sin campaña en curso se crea una partida rápida
  if (!state) state = campaign.newQuickPlay(settings.difficulty, 'captain', floor ?? 1);
  else if (floor !== null) state.floor = floor;
  const f = state.floor;
  const zs = campaign.zonesOf(f);
  const z = zone ?? 1;
  if (z > zs.length) return t('con.badZone', { max: zs.length });
  const st = state;
  if (st.members[st.controlled].hp <= 0) {
    const alive = CLASS_IDS.find((c) => st.members[c].hp > 0);
    if (alive) st.controlled = alive;
  }
  enterZone(z);
  return t('con.goto', { floor: f, zone: z });
}

const host: ConsoleHost = { gotoFloorZone };
cons = createConsole(host);

// ───────────────────────────── Entrada global ─────────────────────────────

function onGlobalKey(e: KeyboardEvent): void {
  if (flags.capturing || e.repeat) return;
  const code = e.code;
  if (code === settings.bindings.console || code === 'IntlBackslash' || code === 'F2') {
    // Backquote, IntlBackslash y F2: en teclados españoles la tecla a la izquierda del 1 varía
    e.preventDefault();
    toggleConsole();
    return;
  }
  if (code === 'Escape' || code === settings.bindings.pause) {
    if (consoleUi.isOpen) { e.preventDefault(); closeConsole(); return; }
    // Con el juego activo lo gestionan los controles (onPause); aquí solo se reanuda desde la pausa
    if (screen === 'pause') { e.preventDefault(); togglePause(); return; }
    // En el resto de menús, Esc vuelve atrás (si la pantalla lo admite)
    if (screen !== 'game' && code === 'Escape' && screens.goBack()) { e.preventDefault(); return; }
  }
  // Navegación por teclado en menús: flechas + Enter (Enter lo resuelve el propio botón enfocado)
  if (screen !== 'game' && screens.visible && !consoleUi.isOpen
    && (code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight')) {
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return;
    e.preventDefault();
    stepNav(screens.root, code === 'ArrowUp' || code === 'ArrowLeft' ? -1 : 1);
  }
}
window.addEventListener('keydown', onGlobalKey, true);

// ?test=1: en pruebas automáticas el panel pierde el foco y el pointer lock sin parar; ahí no se pausa sola
const testMode = params.has('test');
controls.onPause = () => { if (!testMode) togglePause(); };
controls.onConsole = () => toggleConsole();

// Primer gesto del usuario: los navegadores exigen uno para arrancar el audio
function unlockAudio(): void {
  if (audioUnlocked) return;
  audioUnlocked = true;
  audio.unlock();
  audio.music(curMusic);
  for (const ev of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(ev, unlockAudio, true);
}
for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlockAudio, true);

// Si la pestaña se oculta en pleno juego, pausa
document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'game' && !consoleUi.isOpen && !testMode) showPause();
});

function onResize(): void { renderer.resize(window.innerWidth, window.innerHeight); }
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
// Evita el menú contextual del navegador sobre la interfaz (el clic derecho es el cuchillo)
uiRoot.addEventListener('contextmenu', (e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); });

// ───────────────────────────── Gancho de pruebas y arranque ─────────────────────────────

const appApi = {
  showTitle,
  enterZone,
  pause: () => { if (screen === 'game') showPause(); },
  resume: () => { if (screen === 'pause') resume(); },
  openConsole,
  closeConsole,
  finishZone,
  gotoFloorZone,
  get consoleOpen(): boolean { return consoleUi.isOpen; },
};

(window as unknown as { __stracomter: unknown }).__stracomter = {
  get world() { return world; },
  get state() { return state; },
  get screen() { return screen; },
  settings,
  exec: (cmd: string): string[] => cons.exec(cmd, world),
  app: appApi,
  /**
   * Pruebas automáticas: avanza la simulación `seconds` segundos de golpe con la entrada indicada
   * (campos de PlayerInput; los flancos solo valen para el primer paso) y dibuja un frame.
   * Pasa por el mismo camino que el bucle real (step → renderer.onEvents → audio → hud).
   */
  advance(seconds: number, patch: Partial<PlayerInput> = {}): string {
    if (!world || (screen !== 'game' && screen !== 'pause')) return 'sin partida: ' + screen;
    const w = world;
    const input = controls.poll(0, w);
    const steps = Math.round(seconds / STEP);
    for (let i = 0; i < steps && w.status === 'playing'; i++) {
      Object.assign(input, i === 0 ? patch : { ...patch, reload: false, grenade: false, ability: false, interact: false, useItem: false, cycleItem: false, order: null });
      w.step(STEP, input);
      renderer.onEvents(w.events);
      audio.handleEvents(w);
      hud.onEvents(w);
    }
    if (patch.yaw !== undefined || patch.pitch !== undefined) controls.setView(input.yaw, input.pitch);
    renderer.render(Math.min(0.25, seconds));
    hud.update(w);
    return w.status;
  },
};

function autoStart(): boolean {
  const mode = params.get('auto');
  if (mode !== 'campaign' && mode !== 'quick') return false;
  const cls = params.get('class') as ClassId | null;
  const c: ClassId = cls && (CLASS_IDS as string[]).includes(cls) ? cls : 'captain';
  const floor = Math.min(9, Math.max(1, parseInt(params.get('floor') ?? '1', 10) || 1));
  const zone = Math.max(1, parseInt(params.get('zone') ?? '1', 10) || 1);
  if (mode === 'quick') {
    state = campaign.newQuickPlay(settings.difficulty, c, floor);
  } else {
    state = campaign.newCampaign(settings.difficulty, c);
    state.floor = floor;
  }
  enterZone(Math.min(zone, campaign.zonesOf(state.floor).length));
  return true;
}

document.title = t('title.name');
applyAll(false);
onResize();
requestAnimationFrame((ms) => { lastFrameMs = ms; frame(ms); });

try {
  if (!autoStart()) showTitle();
} catch (err) {
  reportError(err);
  showTitle();
}
