// Armazón de la aplicación: máquina de estados de pantallas, bucle de juego y consola de trucos.
//
// Pantallas (screen): title · class · strategy · game · pause · options · summary · defeat · victory · credits.
//  - 'game' es la única en la que corre world.step. 'pause' y 'options' (desde la pausa) mantienen el mundo
//    dibujado pero congelado; el resto lo descarta.
//  - La consola de trucos es una superposición independiente (consoleUi.isOpen): mientras está abierta no se simula.

import './ui/styles.css';
import type {
  RecordEntry, CampaignState, Difficulty, ConsoleHost, IAudio, IConsole, IControls, ICampaign, IRenderer, IWorld, KVStorage, MusicTrack, ZoneSummary,
} from './contracts';
import type { ClassId, OrderKind, PlayerInput } from './sim/types';
import { CLASS_IDS, emptyInput } from './sim/types';
import { createRenderer } from './render';
import { createAudio } from './audio';
import { createControls } from './input';
import { createCampaign } from './sim/campaign';
import { createConsole } from './sim/console';
import { onLangChange, setLang, t } from './ui/i18n';
import { NG_PLUS, SHOP } from './sim/data';
import { loadSettings, saveSettings, takeBindingsNotice, setDeviceProvider, type ExtraSettings } from './ui/settings';
import { Radio } from './ui/radio';
import { asset, button, flags, h, pad2, setUiAudio, stepNav } from './ui/dom';
import {
  Screens, classScreen, creditsScreen, defeatScreen, optionsScreen, pauseScreen, strategyScreen, summaryScreen,
  titleScreen, victoryScreen, recordsScreen, upgradeScreen, setupScreen, hordeEndScreen,
} from './ui/screens';
import { Tutorial } from './ui/tutorial';
import { VERSION } from './ui/version';
import { Hud } from './ui/hud';
import { ConsoleOverlay } from './ui/consoleOverlay';

type Screen =
  | 'title' | 'class' | 'strategy' | 'game' | 'pause' | 'options' | 'summary' | 'defeat' | 'victory' | 'credits'
  | 'records' | 'upgrade';

const STEP = 1 / 60;
const MAX_STEPS = 5;
const END_DELAY = 1.5; // s entre «zona limpia»/«muerte» y la pantalla siguiente

// ───────────────────────────── Ajustes e idioma ─────────────────────────────

const params = new URLSearchParams(location.search);
// Ganchos de prueba (window.__stracomter, ?test, ?auto, advance): solo en desarrollo o con ?debug=1
const DEBUG = import.meta.env.DEV || params.get('debug') === '1';
const autoMode = DEBUG && params.has('auto');
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

let fatal = false;
/** Panel sobrio de error irrecuperable, con botón para recargar (en vez de dejar la pantalla congelada). */
function showFatal(msg: string): void {
  if (fatal) return;
  fatal = true;
  try { controls?.setActive(false); } catch { /* aún sin controles */ }
  uiRoot.appendChild(h('div', { class: 'screen bg-defeat', style: 'z-index:100' },
    h('div', { class: 'scroll' },
      h('div', { class: 'center-col' },
        h('span', { class: 'tag' }, '// ERROR'),
        h('h1', { class: 'h-title defeat-title' }, t('err.title')),
        h('p', { class: 'hint', style: 'max-width:36rem;word-break:break-word' }, msg),
        button(t('err.reload'), () => location.reload(), 'primary'),
      ))));
}

let renderer: IRenderer;
let audio: IAudio;
let controls: IControls;
let campaign: ICampaign;
let cons: IConsole;

try {
  renderer = createRenderer(canvas);
} catch (err) {
  console.error(err);
  showFatal(t('err.webgl'));
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
const loadingBar = h('div', { class: 'ld-bar' });
const loadingEl = h('div', { id: 'loading', class: 'out' }, loadingText, loadingBar);
let loadingActive = false;
let loadingSince = 0;
let loadingFrames = 0;
let loadedOnce = false; // los modelos pesan: la primera zona de la sesión espera más que las siguientes

function showLoading(floor: number, zone: number): void {
  loadingText.textContent = t('load.deploying', { floor: pad2(floor), zone: pad2(zone) });
  loadingEl.classList.remove('out');
  loadingBar.classList.remove('det');
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
const hud = new Hud(uiRoot, () => settings, () => controls.isTouch, () => togglePause(), (x, y, z) => renderer.project(x, y, z));
const radio = new Radio(uiRoot);
uiRoot.appendChild(screensLayer);
// Escenas: bandas negras, rótulo y aviso de omitir (solo visibles con la clase cine-on)
const cineCap = h('div', { class: 'cine-cap' });
const cineEl = h('div', { class: 'cine' },
  h('div', { class: 'cine-bar top' }), h('div', { class: 'cine-bar bot' }), cineCap, h('div', { class: 'cine-skip' }, t('scene.skip')));
uiRoot.appendChild(cineEl);
uiRoot.appendChild(loadingEl);
const consoleUi = new ConsoleOverlay(uiRoot, runConsole, () => closeConsole());
const tutorial = new Tutorial(uiRoot, {
  getSettings: () => settings,
  isTouch: () => controls.isTouch,
  project: (x, y, z) => renderer.project(x, y, z),
}, () => { /* el tutorial ya queda marcado en localStorage */ });

// Dispositivo de entrada en uso (teclado, táctil o mando): las ayudas de tecla muestran el botón del mando si toca
setDeviceProvider(() => (controls as unknown as { lastDevice?: 'keyboard' | 'touch' | 'gamepad' }).lastDevice ?? (controls.isTouch ? 'touch' : 'keyboard'));

/** Vibración del mando (si el módulo de controles la ofrece y el ajuste está activo). */
function rumble(strong: number, weak: number, ms: number): void {
  if (settings.vibration === false) return;
  const c = controls as unknown as { rumble?: (a: number, b: number, c: number) => void };
  try { c.rumble?.(strong, weak, ms); } catch { /* sin vibración */ }
}

// ───────────────────────────── Rueda de órdenes (mantener el botón de ping) ─────────────────────────────

const WHEEL: { kind: OrderKind; cls: string }[] = [
  { kind: 'follow', cls: 'n' }, { kind: 'goto', cls: 'e' }, { kind: 'focus', cls: 's' }, { kind: 'hold', cls: 'w' },
];
const wheelSecs = WHEEL.map((w) => h('div', { class: 'os ' + w.cls }, t('order.' + w.kind)));
const wheelDot = h('div', { class: 'od' });
const wheelEl = h('div', { class: 'owheel' }, ...wheelSecs, wheelDot);
uiRoot.appendChild(wheelEl);
let pingDownAt = -1;
let wheelOpen = false;
let wheelX = 0, wheelY = 0;
let wheelSel = -1;
let pendingOrder: OrderKind | null = null;

function wheelUpdate(): void {
  const len = Math.hypot(wheelX, wheelY);
  wheelSel = len < 25 ? -1 : Math.abs(wheelX) > Math.abs(wheelY) ? (wheelX > 0 ? 1 : 3) : (wheelY > 0 ? 2 : 0);
  wheelSecs.forEach((el, i) => el.classList.toggle('sel', i === wheelSel));
  const k = len > 60 ? 60 / len : 1;
  wheelDot.style.transform = `translate(${Math.round(wheelX * k)}px, ${Math.round(wheelY * k)}px)`;
}
function wheelClose(send: boolean): void {
  if (wheelOpen && send && wheelSel >= 0) pendingOrder = WHEEL[wheelSel].kind;
  wheelOpen = false;
  pingDownAt = -1;
  wheelEl.classList.remove('on');
}

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
  tutorial.relabel();
  wheelSecs.forEach((el, i) => { el.textContent = t('order.' + WHEEL[i].kind); });
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

// ───────────────────────────── Radio de «Mando» y escenas ─────────────────────────────

const extra = (): ExtraSettings => settings as ExtraSettings;
let radioEnterPending = false;
let radioFewDone = false;
let initialEnemies = 0;
let postLoadPending = false;   // intro/tutorial/radio de entrada: se disparan cuando se quita la pantalla de carga
const bossSeen = new Set<number>();
const introPlayed = new WeakSet<object>();
let victorySceneDone = false;

function radioSay(key: string, params?: Record<string, string | number>, urgent = false): void {
  if (extra().radio === false || tutorial.active) return;
  radio.say(t(key, params), urgent);
}

let cinematicActive = false;
let sceneThen: (() => void) | null = null;
let sceneTimer = 0;

function canPlayScene(): boolean {
  return !!renderer.playCinematic && extra().cinematics !== false && !autoMode && !testMode;
}

/** Escena corta (si el renderer la ofrece): HUD fuera, bandas negras y rótulo; la simulación espera. Cualquier tecla la omite. */
function playScene(kind: 'intro' | 'boss' | 'victory', opts: { targetId?: number }, caption: string[], then: () => void): void {
  if (!canPlayScene() || cinematicActive) { then(); return; }
  cinematicActive = true;
  sceneThen = then;
  controls.setActive(false);
  hud.show(false);
  radio.setVisible(false);
  cineCap.textContent = '';
  caption.forEach((c, i) => cineCap.appendChild(h('div', { class: i === 0 ? 'c1' : 'c2' }, c)));
  cineEl.classList.add('cine-on');
  // Por si el renderer no llegara a avisar nunca del final
  sceneTimer = window.setTimeout(endScene, 20000);
  try { renderer.playCinematic!(kind, opts, endScene); } catch (err) { reportError(err); endScene(); }
}

function endScene(): void {
  if (!cinematicActive) return;
  cinematicActive = false;
  window.clearTimeout(sceneTimer);
  cineEl.classList.remove('cine-on');
  const then = sceneThen;
  sceneThen = null;
  if (screen === 'game') { hud.show(true); acc = 0; controls.setActive(!consoleUi.isOpen); }
  then?.();
}

function cancelScene(): void {
  if (!cinematicActive) return;
  try { renderer.cancelCinematic?.(); } catch { /* sin cancelar */ }
  endScene();
}

/** Con Ctrl como agacharse, Ctrl+W cierra la pestaña: mientras se juega, el navegador pide confirmación. */
const onBeforeUnload = (e: BeforeUnloadEvent): void => { e.preventDefault(); e.returnValue = ''; };
let unloadGuard = false;
function setUnloadGuard(on: boolean): void {
  if (on === unloadGuard) return;
  unloadGuard = on;
  if (on) window.addEventListener('beforeunload', onBeforeUnload);
  else window.removeEventListener('beforeunload', onBeforeUnload);
}

function leaveGame(): void {
  cancelScene();
  radio.clear();
  postLoadPending = false;
  wheelClose(false);
  setUnloadGuard(false);
  tutorial.stop(null);
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
  if (!autoMode && takeBindingsNotice()) toast(t('title.controlsUpdated'), 9000);
  screens.show(() => titleScreen({
    hasSave: campaign.hasSave(),
    onNew: () => showClassSelect('campaign'),
    onContinue: continueCampaign,
    onQuick: () => showClassSelect('quick'),
    onHorde: () => showClassSelect('horde'),
    onOptions: () => showOptions('title'),
    onCredits: showCredits,
    onRecords: showRecords,
    onLang: (l) => { settings.lang = l; applyAll(true); },
  }));
}

let hordeDiff: Difficulty = settings.difficulty;
let lastHorde: { cls: ClassId; floor: number; diff: Difficulty } | null = null;
let setupMut: string[] = [];
let setupNg = false;

function showClassSelect(mode: 'campaign' | 'quick' | 'horde'): void {
  screen = 'class';
  music('menu');
  const quick = mode !== 'campaign';
  let best: Record<number, number> = {};
  if (mode === 'horde') { try { best = campaign.meta?.().hordeBest ?? {}; } catch { /* sin meta */ } }
  screens.show((sc) => classScreen(sc, {
    quickFloor: quick ? quickFloor : null,
    horde: mode === 'horde' ? { best, diff: hordeDiff, onDiff: (d) => { hordeDiff = d; screens.refresh(); } } : undefined,
    onFloor: (n) => { quickFloor = n; screens.refresh(); },
    onPick: (c) => {
      if (mode === 'horde') startHorde(c, quickFloor, hordeDiff);
      else if (mode === 'quick') { state = campaign.newQuickPlay(settings.difficulty, c, quickFloor); showStrategy(); }
      else showSetup(c);
    },
    onBack: showTitle,
  }));
}

/** Modo supervivencia: mapa de una planta, oleadas sin fin; no se guarda como campaña. */
function startHorde(c: ClassId, floor: number, diff: Difficulty): void {
  lastHorde = { cls: c, floor, diff };
  try {
    state = campaign.newHorde(diff, c, floor);
    enterZone(1);
  } catch (err) { reportError(err); }
}

/** Preparar la campaña: dificultad, modificadores y segunda vuelta. */
function showSetup(c: ClassId): void {
  screen = 'class';
  let ngUnlocked = false;
  try { ngUnlocked = !!campaign.meta?.().ngUnlocked; } catch { /* sin meta */ }
  if (!ngUnlocked) setupNg = false;
  screens.show((sc) => setupScreen(sc, {
    diff: settings.difficulty,
    onDiff: (d) => { settings.difficulty = d; saveSettings(settings); },
    mutators: setupMut,
    onToggle: (id, on) => { setupMut = on ? [...setupMut.filter((x) => x !== id), id] : setupMut.filter((x) => x !== id); },
    ngUnlocked, ng: setupNg,
    onNg: (on) => { setupNg = on; },
    onStart: () => {
      const st = campaign.newCampaign(settings.difficulty, c, { mutators: [...setupMut], ngPlus: setupNg });
      state = st;
      // Segunda vuelta: se eligen 2 mejoras iniciales entre las que ofrece la campaña
      let ch: string[] = [];
      if (setupNg) { try { ch = campaign.ngStartChoices?.(st) ?? []; } catch (err) { reportError(err); } }
      if (ch.length < 2) { showStrategy(); return; }
      const pickInitial = (opts: string[], left: number): void => {
        showUpgrade(opts, () => {}, false, (id) => {
          try { campaign.chooseUpgrade?.(st, id); } catch (err) { reportError(err); }
          if (left > 1 && opts.length > 1) pickInitial(opts.filter((x) => x !== id), left - 1); else showStrategy();
        });
      };
      pickInitial(ch, NG_PLUS.startPicks);
    },
    onBack: () => showClassSelect('campaign'),
  }));
}

function continueCampaign(): void {
  const st = campaign.load();
  if (!st) { toast(t('menu.noSave')); return; }
  state = st;
  if (state.floor > 9) showVictory(); else showStrategy();
}

let lastRehydrate = '';
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
  // Mejora pendiente (compra de la Armería o fin de planta sin elegir, también tras cargar una partida): se resuelve primero
  const pend = st.pendingUpgrade?.length ? st.pendingUpgrade : st.upgradeChoices?.length ? st.upgradeChoices : null;
  const pendKey = pend ? pend.join(',') : '';
  if (pend && pendKey !== lastRehydrate) {
    lastRehydrate = pendKey; // evita bucles si la simulación no limpiase la mejora pendiente
    showUpgrade(pend, showStrategy, !st.pendingUpgrade?.length);
    return;
  }
  lastRehydrate = '';
  const zones = campaign.zonesOf(st.floor);
  screens.show((sc) => strategyScreen(sc, {
    state: st, zones,
    onEnter: enterZone,
    onControl: (c: ClassId) => { st.controlled = c; },
    onLoadout: (c, v) => {
      // El selector de variante lo implementa la simulación (campaign.setLoadout); si aún no existe, se guarda en el estado
      try { (campaign as unknown as { setLoadout?: (s: CampaignState, c: ClassId, v: 0 | 1) => void }).setLoadout?.(st, c, v); } catch (err) { reportError(err); }
      if (!st.loadout) st.loadout = {};
      st.loadout[c] = v;
    },
    shop: (() => { try { return campaign.shopItems?.(st) ?? []; } catch { return []; } })(),
    onBuy: (id, target) => {
      let ok = false;
      try { ok = !!campaign.buy?.(st, id, target); } catch (err) { reportError(err); }
      if (!ok) { audio.ui('error'); return; }
      audio.ui('reward');
      if (id === 'upgrade') {
        const ch = (campaign as unknown as { shopUpgradeChoices?: (s: CampaignState) => string[] }).shopUpgradeChoices?.(st) ?? [];
        if (ch.length) { showUpgrade(ch, showStrategy, false); return; }
      }
      screens.refresh();
    },
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
  if (cinematicActive) cancelScene();
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
    onRepeatTutorial: () => Tutorial.reset(),
    onExportLog: exportLog,
    onClearLog: () => { writeLog([]); return 0; },
    logCount: () => readLog().length,
    onBack: () => {
      if (optionsFrom === 'pause') { hud.show(true); showPause(); } else showTitle();
    },
  }));
}

function showRecords(): void {
  leaveGame();
  screen = 'records';
  music('menu');
  let recs: Record<string, RecordEntry> = {};
  try { recs = campaign.records?.() ?? {}; } catch { /* sin récords */ }
  let hb: Record<number, number> = {};
  try { hb = campaign.meta?.().hordeBest ?? {}; } catch { /* sin meta */ }
  screens.show((sc) => recordsScreen(sc, { records: recs, hordeBest: hb, onBack: showTitle }));
}

function showCredits(): void {
  leaveGame();
  screen = 'credits';
  music('menu');
  screens.show((sc) => creditsScreen(sc, { onBack: showTitle }));
}

function showSummary(summary: ZoneSummary, cheated: boolean): void {
  screen = 'summary';
  lastSummary = summary;
  music('strategy');
  const shownAt = Date.now();
  screens.show((s) => summaryScreen(s, {
    summary, shownAt, cheated,
    onContinue: () => {
      const next = (): void => {
        if (summary.campaignWon) showVictory();
        else if (state?.quick) showTitle();
        else showStrategy();
      };
      // Mejora de campaña: obligatoria, no se puede saltar
      const choices = summary.upgradeChoices ?? [];
      if (choices.length > 0 && state && !state.quick) showUpgrade(choices, next, true); else next();
    },
  }));
}

function showUpgrade(choices: string[], then: () => void, allowReroll = false, onPick?: (id: string) => void): void {
  screen = 'upgrade';
  music('strategy');
  screens.show((sc) => upgradeScreen(sc, {
    choices,
    onPick: (id) => {
      if (onPick) { onPick(id); return; }
      try { if (state && campaign.chooseUpgrade) campaign.chooseUpgrade(state, id); } catch (err) { reportError(err); }
      then();
    },
    reroll: allowReroll && state ? {
      price: SHOP.reroll,
      onReroll: () => {
        let nw: string[] | null = null;
        try { nw = campaign.rerollUpgrades?.(state!) ?? null; } catch (err) { reportError(err); }
        if (!nw || nw.length === 0) { audio.ui('error'); return; }
        audio.ui('reward');
        showUpgrade(nw, then, allowReroll, onPick);
      },
    } : undefined,
  }));
}

/** Modo horda: pausa y elección de mejora entre oleadas. */
let hordePicking = false;
function showHordePick(w: IWorld): void {
  hordePicking = true;
  let ch: string[] = [];
  try { ch = state ? campaign.hordeChoices?.(state) ?? [] : []; } catch (err) { reportError(err); }
  controls.setActive(false);
  hud.show(false);
  showUpgrade(ch, () => {}, false, (id) => {
    try { w.hordePick?.(id); } catch (err) { reportError(err); }
    screens.clear();
    screen = 'game';
    hud.show(true);
    acc = 0;
    controls.setActive(!consoleUi.isOpen);
  });
}

function showDefeat(): void {
  screen = 'defeat';
  controls.setActive(false);
  hud.show(false);
  audio.ui('defeat');
  const w = world;
  if (w) logPlay(w.status === 'failed' ? 'failed' : 'dead', w);
  // Supervivencia: fin de la partida con su marca (no hay «reintentar planta», se vuelve a empezar la horda)
  if (w && state?.horde) {
    let res = { wave: w.horde?.wave ?? 0, best: 0, newRecord: false };
    try { res = campaign.finishHorde?.(state, w) ?? res; } catch (err) { reportError(err); }
    const hs = lastHorde;
    screens.show((sc) => hordeEndScreen(sc, {
      ...res,
      onRetry: () => { if (hs) startHorde(hs.cls, hs.floor, hs.diff); else showTitle(); },
      onMenu: showTitle,
    }));
    return;
  }
  if (state) campaign.failZone(state); // el ajuste dinámico afloja un escalón tras una derrota
  const floor = w?.floor ?? state?.floor ?? 1;
  const zone = w?.zone ?? 1;
  // Objetivo fallido: el motivo según el tipo de objetivo
  let reason: string | undefined;
  if (w && w.status === 'failed') {
    const k = w.objective?.kind;
    reason = k && k !== 'clear' ? t('fail.' + k) : t('fail.generic');
  }
  screens.show((sc) => defeatScreen(sc, { floor, zone, reason, onRetry: retryFloor, onMenu: showTitle }));
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

// ───────────────────────────── Registro de partidas (pruebas con personas) ─────────────────────────────
// Una línea por zona terminada o perdida, en localStorage. No se envía nada a ningún sitio.

const LOG_KEY = 'stracomter3.playlog';
const LOG_MAX = 200;

function readLog(): unknown[] {
  try {
    const v = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function writeLog(a: unknown[]): void {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(a.slice(-LOG_MAX))); } catch { /* sin almacenamiento */ }
}

function logPlay(result: 'cleared' | 'dead' | 'failed', w: IWorld, summary?: ZoneSummary): void {
  try {
    const st = w.stats;
    const log = readLog();
    log.push({
      date: new Date().toISOString(),
      version: VERSION,
      device: { touch: controls.isTouch, window: `${window.innerWidth}x${window.innerHeight}` },
      graphics: settings.graphics ?? 'auto',
      difficulty: state?.difficulty ?? settings.difficulty,
      mode: state?.horde ? 'horde' : state?.quick ? 'quick' : 'campaign',
      objective: w.objective?.kind ?? 'clear',
      mutators: state?.mutators ?? [],
      ngPlus: state?.ngPlus ?? 0,
      wave: w.horde?.wave ?? null,
      floor: w.floor,
      zone: w.zone,
      class: w.player.kind,
      result,
      time: Math.round(st.time * 10) / 10,
      kills: st.kills,
      accuracy: st.shotsFired > 0 ? Math.round((st.shotsHit / st.shotsFired) * 1000) / 1000 : null,
      damageTaken: Math.round(st.damageTaken),
      alliesFallen: summary ? summary.fallen : st.alliesLost,
      grade: summary?.grade ?? null,
      upgrades: state?.upgrades ?? [],
      cheated: !!(w.cheated || state?.cheated),
    });
    writeLog(log);
  } catch (err) { console.error(err); }
}

function exportLog(): void {
  const blob = new Blob([JSON.stringify(readLog(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stracomter-partidas-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
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
  hud.setBadges([...(state?.mutators ?? []).map((id) => t('mut.' + id)), ...((state?.ngPlus ?? 0) > 0 ? [t('setup.ng')] : [])]);
  hud.show(true);
  updateGameMusic(true);
  if (!testMode && !autoMode) setUnloadGuard(true);
  // Tutorial guiado: primera partida de campaña, planta 1, sin trucos
  tutorial.stop(null);
  radio.clear();
  bossSeen.clear();
  radioFewDone = false;
  initialEnemies = 0;
  victorySceneDone = false;
  // Intro, tutorial y radio de entrada esperan a que se quite la pantalla de carga (ver frame)
  postLoadPending = true;
  const ae = document.activeElement as HTMLElement | null;
  if (ae && ae !== document.body && !ae.closest('#console')) ae.blur();
}

function finishZone(): void {
  if (!world || !state) return;
  const w = world;
  const summary = campaign.completeZone(state, w);
  const cheated = !!(w.cheated || state.cheated);
  logPlay('cleared', w, summary);
  leaveGame();
  audio.ui('reward');
  showSummary(summary, cheated);
}

function neutralInput(src: PlayerInput): PlayerInput {
  const e = emptyInput();
  e.yaw = src.yaw; e.pitch = src.pitch; e.camDist = src.camDist;
  return e;
}

function onBossSpawn(w: IWorld, id: number, kind: string): void {
  bossSeen.add(id);
  const ent = w.entityById(id);
  const v = ent?.bossVariant;
  radioSay('radio.boss.' + (v ?? (kind === 'megaboss' ? 'mega' : 'mini')), undefined, true);
  // Nombre propio del jefe para el rótulo de la escena
  let nm = t('kind.' + kind);
  const own = ent?.bossName ?? '';
  if (own) { const k = own.startsWith('boss.') ? own : 'boss.' + own; if (t(k) !== k) nm = t(k); }
  if (tutorial.active) return;
  playScene('boss', { targetId: id }, [nm, t('kind.' + kind)], () => { /* la partida sigue */ });
}

function simulate(dtReal: number): void {
  const w = world!;
  const input = controls.poll(dtReal, w);
  // Rueda de órdenes: se abre al mantener el botón de ping más de 0,35 s; la orden elegida entra por el mismo camino que las teclas
  if (pingDownAt >= 0 && !wheelOpen && performance.now() - pingDownAt > 350 && !controls.isTouch) {
    wheelOpen = true; wheelX = 0; wheelY = 0; wheelSel = -1; wheelUpdate();
    wheelEl.classList.add('on');
  }
  if (pendingOrder) { input.order = pendingOrder; pendingOrder = null; }
  acc += dtReal;
  let n = 0;
  while (acc >= STEP && n < MAX_STEPS) {
    w.step(STEP, w.status === 'playing' ? input : neutralInput(input));
    renderer.onEvents(w.events);
    audio.handleEvents(w);
    hud.onEvents(w);
    for (const ev of w.events) {
      if (ev.type === 'hurt' && ev.id === w.player.id) rumble(0.5, 0.3, 120);
      else if (ev.type === 'explosion' && Math.hypot(ev.x - w.player.x, ev.y - w.player.y) < 7) rumble(0.7, 0.7, 200);
    }
    tutorial.onEvents(w);
    for (const ev of w.events) {
      if (ev.type === 'spawn' && (ev.kind === 'miniboss' || ev.kind === 'megaboss') && !bossSeen.has(ev.id)) onBossSpawn(w, ev.id, ev.kind);
      else if (ev.type === 'wave' && ev.wave > 0 && ev.wave % 5 === 0) radioSay('radio.horde.five', { n: ev.wave });
      else if (ev.type === 'cleared') radioSay('radio.clear', undefined, true);
    }
    acc -= STEP;
    n++;
    if (cinematicActive) break; // el mundo NO avanza mientras dura una escena
  }
  // Si el frame tardó demasiado, el exceso se descarta (no se acumula deuda de simulación)
  if (acc >= STEP) acc = 0;

  if (w.status === 'cleared' || w.status === 'dead' || w.status === 'failed') {
    endTimer += dtReal;
    if (endTimer >= END_DELAY) {
      if (w.status === 'cleared') {
        // Última planta de campaña: escena de victoria antes del informe
        if (w.floor === 9 && state && !state.quick && !state.horde && !victorySceneDone && canPlayScene()) {
          victorySceneDone = true;
          playScene('victory', {}, [t('scene.victory')], () => finishZone());
        } else finishZone();
      } else showDefeat();
    }
  } else {
    endTimer = 0;
  }

  // Horda: al terminar una oleada con mejora pendiente, pausa y elección
  const pick = !!w.horde?.pickUpgrade;
  if (pick && !hordePicking && screen === 'game') showHordePick(w);
  else if (!pick) hordePicking = false;
}

function frame(nowMs: number): void {
  requestAnimationFrame(frame);
  if (fatal) return;
  const dtReal = Math.min(0.25, Math.max(0, (nowMs - lastFrameMs) / 1000));
  lastFrameMs = nowMs;
  try {
    if (world) {
      tutorial.setVisible(screen === 'game' && !consoleUi.isOpen && !loadingActive && !cinematicActive);
      // Tras la carga: intro (planta 1 de campaña nueva), tutorial y mensajes de entrada
      if (postLoadPending && !loadingActive && screen === 'game' && world && !cinematicActive) {
        postLoadPending = false;
        const w0 = world;
        const go = (): void => {
          if (world !== w0) return;
          if (state && !state.quick && !state.horde && w0.floor === 1 && !autoMode && !w0.cheated && Tutorial.shouldStart()) tutorial.start(w0);
          radioEnterPending = true;
        };
        const intro = !!state && !state.quick && !state.horde && w0.floor === 1 && (state.score ?? 0) === 0 && !introPlayed.has(state);
        if (intro && state) {
          introPlayed.add(state);
          playScene('intro', {}, [t('scene.intro', { n: '01' }), CLASS_IDS.map((c) => t('kind.' + c)).join(' · ')], go);
        } else go();
      }
      if (radioEnterPending && !cinematicActive && world) {
        radioEnterPending = false;
        const w1 = world;
        if (w1.horde) radioSay('radio.horde.start');
        else {
          radioSay('radio.enter.' + Math.floor(Math.random() * 3));
          const ok = w1.objective?.kind;
          if (ok && ok !== 'clear') radioSay('radio.obj.' + ok);
        }
      }
      radio.setVisible(screen === 'game' && !consoleUi.isOpen && !loadingActive && !cinematicActive);
      radio.update(performance.now());
      if (screen === 'game' && !consoleUi.isOpen && !loadingActive && !cinematicActive) {
        simulate(dtReal);
        if (world) {
          const w2 = world;
          const rem = w2.enemiesRemaining();
          initialEnemies = Math.max(initialEnemies, rem);
          if (!radioFewDone && !w2.horde && initialEnemies >= 8 && rem > 0 && rem <= 3) { radioFewDone = true; radioSay('radio.few'); }
        }
        if (world) tutorial.update(world, dtReal);
        musicTimer += dtReal;
        if (musicTimer >= 0.5 && world) { musicTimer = 0; updateGameMusic(); }
      }
      if (world) {
        renderer.render(dtReal);
        if (screen === 'game' || screen === 'pause') hud.update(world);
        if (loadingActive) {
          loadingFrames++;
          const el = performance.now() - loadingSince;
          // Con progreso real del renderer: la barra lo enseña y se quita al llegar a 1 (tope absoluto 20 s).
          // Sin él: 1ª vez mínimo 1,2 s y máximo 4 s; después 0,4 s y 1,5 s.
          const lp = renderer.loadProgress ? renderer.loadProgress() : undefined;
          const real = typeof lp === 'number' && isFinite(lp);
          if (real) {
            loadingBar.classList.add('det');
            loadingBar.style.setProperty('--p', String(Math.min(1, Math.max(0, lp as number))));
          }
          const minMs = loadedOnce ? 400 : 1200;
          const maxMs = real ? 20000 : loadedOnce ? 1500 : 4000;
          const ready = real ? (lp as number) >= 1 : true;
          if ((loadingFrames >= 1 && ready && el >= minMs) || el >= maxMs) { hideLoading(); loadedOnce = true; }
        }
      }
    }
  } catch (err) {
    reportError(err);
  }
}

const reported = new Map<string, number>();
function reportError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(err);
  const n = (reported.get(msg) ?? 0) + 1;
  reported.set(msg, n);
  if (n === 1) toast(t('err.generic', { msg }), 7000);
  // El mismo fallo en el bucle de juego, una y otra vez: no se puede seguir
  if (n >= 5) showFatal(msg);
}
window.addEventListener('error', (e) => {
  if (/ResizeObserver/.test(e.message)) return;
  if (e.error) showFatal(e.error instanceof Error ? e.error.message : String(e.message));
});
window.addEventListener('unhandledrejection', (e) => {
  // Las promesas rechazadas del navegador (p. ej. audio sin gesto) son DOMException: no son un fallo del juego
  const r = e.reason;
  if (r instanceof Error && !(r instanceof DOMException)) showFatal(r.message);
});

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
  // Escena en curso: cualquier tecla la omite; Esc además pausa
  if (cinematicActive) {
    cancelScene();
    if (e.code === 'Escape' || e.code === settings.bindings.pause) { e.preventDefault(); togglePause(); }
    return;
  }
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

// Ping / rueda de órdenes: el botón (o tecla) asignado a «ping»; el ratón mueve el selector mientras se mantiene
function isPingCode(code: string): boolean { return code !== '' && code === settings.bindings.ping; }
window.addEventListener('mousedown', (e) => {
  if (screen === 'game' && !consoleUi.isOpen && isPingCode('Mouse' + e.button)) pingDownAt = performance.now();
}, true);
window.addEventListener('mouseup', (e) => { if (isPingCode('Mouse' + e.button)) wheelClose(true); }, true);
window.addEventListener('keydown', (e) => {
  if (screen === 'game' && !consoleUi.isOpen && !e.repeat && isPingCode(e.code)) pingDownAt = performance.now();
}, true);
window.addEventListener('keyup', (e) => { if (isPingCode(e.code)) wheelClose(true); }, true);
window.addEventListener('mousemove', (e) => {
  if (!wheelOpen) return;
  wheelX += e.movementX || 0; wheelY += e.movementY || 0;
  const len = Math.hypot(wheelX, wheelY);
  if (len > 90) { wheelX *= 90 / len; wheelY *= 90 / len; }
  wheelUpdate();
});

// ?test=1: en pruebas automáticas el panel pierde el foco y el pointer lock sin parar; ahí no se pausa sola
const testMode = DEBUG && params.has('test');
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
function autoPause(): void {
  if (DEBUG && params.has('nopause')) return; // pruebas en una ventana sin foco
  if (testMode) return;
  cancelScene();
  if (screen === 'game' && !consoleUi.isOpen) showPause();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
// Al perder el foco la ventana, el juego se pausa solo
window.addEventListener('blur', () => { if (screen === 'game') autoPause(); });
// Un clic o un toque también omiten la escena
window.addEventListener('mousedown', () => { if (cinematicActive) cancelScene(); }, true);
window.addEventListener('touchstart', () => { if (cinematicActive) cancelScene(); }, { capture: true, passive: true });

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

if (DEBUG) (window as unknown as { __stracomter: unknown }).__stracomter = {
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
  const mode = DEBUG ? params.get('auto') : null;
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
