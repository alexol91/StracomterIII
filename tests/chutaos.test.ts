// Truco «chutaos on|off» (Modo Chutaos): la consola cambia world.cheats.chutaos, que es lo que lee el audio.
// NO cubre: que el audio suene de verdad con las voces (eso solo se comprueba oyéndolo en el navegador).
import { describe, expect, it } from 'vitest';
import { createCampaign } from '../src/sim/campaign';
import { createConsole } from '../src/sim/console';
import type { World } from '../src/sim/world';

const mem = new Map<string, string>();
const campaign = createCampaign({ getItem: k => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: k => void mem.delete(k) });
const cons = createConsole({ gotoFloorZone: () => '' });

describe('21.15 · truco chutaos', () => {
  it('chutaos on activa el modo y chutaos off lo desactiva; sin argumento no cambia nada y lo dice', () => {
    const w = campaign.startZone(campaign.newQuickPlay('normal', 'captain', 1), 1) as World;
    expect(w.cheats.chutaos).toBe(false);
    expect(cons.exec('chutaos on', w).join(' ')).toMatch(/ACTIVADO/);
    expect(w.cheats.chutaos).toBe(true);
    expect(cons.exec('chutaos', w).join(' ')).toMatch(/uso/);
    expect(w.cheats.chutaos).toBe(true);
    expect(cons.exec('chutaos off', w).join(' ')).toMatch(/desactivado/);
    expect(w.cheats.chutaos).toBe(false);
  });
  it('aparece en la ayuda', () => {
    expect(cons.exec('help', null).join(' ')).toMatch(/chutaos/);
  });
});
