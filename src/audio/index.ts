// Módulo de audio: todo sintetizado con Web Audio (sin ficheros ni bibliotecas de terceros).
// Cadena: efectos y música -> master -> compresor/limitador suave -> salida.
// Si no hay AudioContext (Node, pruebas) o algo falla, todos los métodos son inocuos.

import type { IAudio, IWorld, MusicTrack, Settings } from '../contracts';
import { Music } from './music';
import { Sfx } from './sfx';

/** Nivel interno de la música respecto a los efectos (la música no debe tapar los disparos). */
const MUSIC_TRIM = 0.55;

export function createAudio(): IAudio {
  let ctx: AudioContext | null = null;
  let failed = false;
  let sfx: Sfx | null = null;
  let music: Music | null = null;
  let musicBus: GainNode | null = null;
  let sfxBus: GainNode | null = null;
  let musicVol = 0.5;
  let sfxVol = 0.8;
  let wanted: MusicTrack = null;

  const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

  const applyVolumes = () => {
    if (!ctx || !musicBus || !sfxBus) return;
    const t = ctx.currentTime;
    musicBus.gain.setTargetAtTime(musicVol * MUSIC_TRIM, t, 0.03);
    sfxBus.gain.setTargetAtTime(sfxVol, t, 0.03);
  };

  const build = () => {
    const w = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (!AC) { failed = true; return; }
    ctx = new AC({ latencyHint: 'interactive' });
    const master = ctx.createGain();
    master.gain.value = 0.9;
    // Compresor/limitador suave: con 40 enemigos disparando no satura.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 20;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    master.connect(comp);
    comp.connect(ctx.destination);
    musicBus = ctx.createGain();
    sfxBus = ctx.createGain();
    musicBus.connect(master);
    sfxBus.connect(master);
    sfx = new Sfx(ctx, sfxBus);
    music = new Music(ctx, musicBus);
    applyVolumes();
    if (typeof document !== 'undefined' && document.addEventListener) {
      // En segundo plano, el audio se suspende (ahorra batería y evita música sin partida visible).
      document.addEventListener('visibilitychange', () => {
        try {
          if (!ctx) return;
          if (document.hidden) void ctx.suspend().catch(() => {});
          else void ctx.resume().catch(() => {});
        } catch { /* sin audio */ }
      });
    }
    music.set(wanted);
  };

  return {
    unlock() {
      try {
        if (failed) return;
        if (!ctx) build();
        if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => {});
      } catch { failed = true; }
    },
    applySettings(s: Settings) {
      try {
        musicVol = clamp01(s.musicVol);
        sfxVol = clamp01(s.sfxVol);
        applyVolumes();
      } catch { /* sin audio */ }
    },
    music(track: MusicTrack) {
      try {
        wanted = track;
        if (music) music.set(track);
      } catch { /* sin audio */ }
    },
    handleEvents(world: IWorld) {
      try { sfx?.handleEvents(world); } catch { /* sin audio */ }
    },
    ui(sound) {
      try { sfx?.ui(sound); } catch { /* sin audio */ }
    },
  };
}
