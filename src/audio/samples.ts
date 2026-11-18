// Carga perezosa de muestras (audios originales del juego, propiedad del dueño del proyecto).
// fetch + decodeAudioData con caché. Nunca lanza: si falla, `get` devuelve null y el que llama
// usa el sonido sintetizado de reserva.

const BASE: string = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL) ?? './';

const FILES: Record<string, string> = {
  theme: 'audio/musica/tema-stracomter3-chutaos.ogg',
  pistol: 'audio/efectos/pistol.ogg',
  pistolOld: 'audio/efectos/pistolOld.ogg',
  machine: 'audio/efectos/machine.ogg',
  knife: 'audio/efectos/knife.ogg',
  ouch: 'audio/efectos/ouch.ogg',
  ouchOld: 'audio/efectos/ouchOld.ogg',
  dead: 'audio/efectos/dead.ogg',
  'v:pistol': 'audio/voces-chutaos/pistol.ogg',
  'v:machine': 'audio/voces-chutaos/machine.ogg',
  'v:knife': 'audio/voces-chutaos/knife.ogg',
  'v:ouch': 'audio/voces-chutaos/ouch.ogg',
  'v:dead': 'audio/voces-chutaos/dead.ogg',
  'v:explosion': 'audio/voces-chutaos/explosion.ogg',
  'v:step': 'audio/voces-chutaos/step.ogg',
  'v:go': 'audio/voces-chutaos/go.ogg',
  'v:sexo': 'audio/voces-chutaos/sexo.ogg',
};

export class Samples {
  private bufs = new Map<string, AudioBuffer>();
  private failed = new Set<string>();
  private pending = new Map<string, Promise<AudioBuffer | null>>();
  /** Se llama cada vez que termina de cargar (o falla) una muestra. */
  onSettled: (() => void) | null = null;

  constructor(private ctx: AudioContext) {}

  get(name: string): AudioBuffer | null { return this.bufs.get(name) ?? null; }
  hasFailed(name: string): boolean { return this.failed.has(name); }

  load(name: string): Promise<AudioBuffer | null> {
    const have = this.bufs.get(name);
    if (have) return Promise.resolve(have);
    const p0 = this.pending.get(name);
    if (p0) return p0;
    const file = FILES[name];
    if (!file || typeof fetch !== 'function') { this.failed.add(name); return Promise.resolve(null); }
    const p = (async (): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(BASE + file);
        if (!res.ok) throw new Error('http ' + res.status);
        const data = await res.arrayBuffer();
        const buf = await new Promise<AudioBuffer>((ok, ko) => { this.ctx.decodeAudioData(data, ok, ko); });
        this.bufs.set(name, buf);
        return buf;
      } catch {
        this.failed.add(name);
        return null;
      } finally {
        try { this.onSettled?.(); } catch { /* nada */ }
      }
    })();
    this.pending.set(name, p);
    return p;
  }

  /** Lanza la descarga de todo en segundo plano: primero el tema y los efectos normales. */
  loadAll(): void {
    const names = Object.keys(FILES);
    names.sort((a, b) => Number(a.startsWith('v:')) - Number(b.startsWith('v:')));
    for (const n of names) void this.load(n);
  }
}
