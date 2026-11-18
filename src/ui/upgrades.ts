// Acceso defensivo a la tabla de mejoras (UPGRADES en src/sim/data.ts): si aún no existe, se degrada a ids sueltos.

import * as data from '../sim/data';
import { getLang } from './i18n';

interface UpgradeText { name: string; desc: string }
interface UpgradeDef { es?: UpgradeText; en?: UpgradeText; icon?: string }

export interface UpgradeInfo { id: string; name: string; desc: string; icon: string }

export function upgradeInfo(id: string): UpgradeInfo {
  // UPGRADES es una lista (src/sim/data.ts); se admite también un mapa por id.
  const raw = (data as unknown as { UPGRADES?: unknown }).UPGRADES;
  const d: UpgradeDef | undefined = Array.isArray(raw)
    ? (raw as (UpgradeDef & { id: string })[]).find(u => u.id === id)
    : (raw as Record<string, UpgradeDef> | undefined)?.[id];
  const tx = d ? (d[getLang()] ?? d.es ?? d.en) : undefined;
  return { id, name: tx?.name ?? id, desc: tx?.desc ?? '', icon: d?.icon ?? 'star' };
}

/** Ids de los modificadores de campaña y su multiplicador de puntos (tabla MUTATORS de data.ts, leída con cuidado). */
export const MUTATOR_IDS = ['rapidos', 'sin-aura', 'jefes-dobles', 'solo-pistola', 'escasez'];

export function mutatorMult(id: string): number {
  const m = (data as unknown as { MUTATORS?: unknown }).MUTATORS;
  let def: { scoreMult?: number } | undefined;
  if (Array.isArray(m)) def = (m as { id: string; scoreMult?: number }[]).find((x) => x.id === id);
  else if (m && typeof m === 'object') def = (m as Record<string, { scoreMult?: number }>)[id];
  return def?.scoreMult ?? 1.15;
}
