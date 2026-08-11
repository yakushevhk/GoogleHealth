import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CARD_IDS,
  DEFAULT_SETTINGS,
  parseSettings,
  readSettings,
  resetSettings,
  toggleCard,
  updateSettings,
  writeSettings,
  type StorageLike,
} from '@lib/settings';

function memStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('settings', () => {
  let s: StorageLike;
  beforeEach(() => {
    s = memStorage();
  });
  afterEach(() => {});

  it('returns defaults on empty storage', () => {
    const out = readSettings(s);
    expect(out.compact).toBe(false);
    expect(out.refreshSec).toBe(60);
    for (const id of CARD_IDS) expect(out.visible[id]).toBe(true);
  });

  it('write/read round-trip', () => {
    writeSettings(s, { ...DEFAULT_SETTINGS, compact: true, refreshSec: 30 });
    const out = readSettings(s);
    expect(out.compact).toBe(true);
    expect(out.refreshSec).toBe(30);
  });

  it('updateSettings patches and persists', () => {
    const out = updateSettings(s, { refreshSec: 120 });
    expect(out.refreshSec).toBe(120);
    expect(readSettings(s).refreshSec).toBe(120);
  });

  it('toggleCard flips a single card', () => {
    toggleCard(s, 'heart', false);
    expect(readSettings(s).visible.heart).toBe(false);
    expect(readSettings(s).visible.sleep).toBe(true);
  });

  it('resetSettings clears to defaults', () => {
    updateSettings(s, { compact: true, refreshSec: 5 });
    toggleCard(s, 'sleep', false);
    const out = resetSettings(s);
    expect(out.compact).toBe(false);
    expect(out.refreshSec).toBe(60);
    expect(out.visible.sleep).toBe(true);
  });

  it('parseSettings discards corrupted JSON', () => {
    const out = parseSettings('{not json');
    expect(out).toEqual(expect.objectContaining({ compact: DEFAULT_SETTINGS.compact }));
  });

  it('parseSettings sanitizes bad field types', () => {
    const out = parseSettings(
      JSON.stringify({ compact: 'yes', refreshSec: -5, language: 'fr', visible: { heart: 'no' } }),
    );
    expect(out.compact).toBe(false);
    expect(out.refreshSec).toBe(60);
    // Unknown/extra keys (e.g. a removed 'language' field) are ignored.
    expect(out).not.toHaveProperty('language');
    // Unknown keys in visible fall back to defaults (true).
    expect(out.visible.heart).toBe(true);
  });

  it('parseSettings tolerates empty object and unknown visible keys', () => {
    const out = parseSettings('{}');
    expect(out.compact).toBe(false);
    for (const id of CARD_IDS) expect(out.visible[id]).toBe(true);
  });
});
