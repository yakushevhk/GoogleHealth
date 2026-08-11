/**
 * Dashboard settings persisted to localStorage-like storage.
 *
 * Isomorphic: the storage adapter is injected (browser `localStorage` in the
 * app, an in-memory Map in tests), so the logic is fully unit-testable.
 */

/** Cardinal dashboard sections that can be shown/hidden. */
export const CARD_IDS = [
  'vitals',
  'activity',
  'heart',
  'sleep',
  'body',
  'exercise',
  'misc',
] as const;
export type CardId = (typeof CARD_IDS)[number];

export interface DashboardSettings {
  /** Which cards to render (all by default). */
  visible: Record<CardId, boolean>;
  /** Compact mode: smaller paddings/graphs. */
  compact: boolean;
  /** Auto-refresh interval in seconds (0 = off). */
  refreshSec: number;
  /** Highlight/hide the "auto" indicator (cosmetic). */
  language: 'en' | 'ru';
}

export const DEFAULT_SETTINGS: DashboardSettings = {
  visible: Object.fromEntries(CARD_IDS.map((id) => [id, true])) as Record<
    CardId,
    boolean
  >,
  compact: false,
  refreshSec: 60,
  language: 'ru',
};

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY = 'gh:dashboard:settings:v1';

export function parseSettings(raw: string | null): DashboardSettings {
  if (!raw) return { ...DEFAULT_SETTINGS, visible: { ...DEFAULT_SETTINGS.visible } };
  try {
    const data = JSON.parse(raw) as Partial<DashboardSettings>;
    const visible = { ...DEFAULT_SETTINGS.visible, ...(data.visible ?? {}) } as Record<
      CardId,
      boolean
    >;
    for (const id of CARD_IDS) if (typeof visible[id] !== 'boolean') visible[id] = true;
    return {
      visible,
      compact: typeof data.compact === 'boolean' ? data.compact : DEFAULT_SETTINGS.compact,
      refreshSec:
        typeof data.refreshSec === 'number' && data.refreshSec >= 0
          ? data.refreshSec
          : DEFAULT_SETTINGS.refreshSec,
      language: data.language === 'en' ? 'en' : DEFAULT_SETTINGS.language,
    };
  } catch {
    return { ...DEFAULT_SETTINGS, visible: { ...DEFAULT_SETTINGS.visible } };
  }
}

export function readSettings(storage: StorageLike): DashboardSettings {
  return parseSettings(storage.getItem?.(KEY) ?? null);
}

export function writeSettings(storage: StorageLike, settings: DashboardSettings): void {
  storage.setItem?.(KEY, JSON.stringify(settings));
}

export function updateSettings(
  storage: StorageLike,
  patch: Partial<DashboardSettings>,
): DashboardSettings {
  const next = { ...readSettings(storage), ...patch };
  writeSettings(storage, next);
  return next;
}

export function resetSettings(storage: StorageLike): DashboardSettings {
  storage.removeItem?.(KEY);
  return { ...DEFAULT_SETTINGS, visible: { ...DEFAULT_SETTINGS.visible } };
}

export function toggleCard(
  storage: StorageLike,
  id: CardId,
  visible: boolean,
): DashboardSettings {
  const cur = readSettings(storage);
  const next = { ...cur, visible: { ...cur.visible, [id]: visible } };
  writeSettings(storage, next);
  return next;
}
