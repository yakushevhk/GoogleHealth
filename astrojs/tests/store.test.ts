import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentSummary, loadSummary } from '@lib/store';

/**
 * Store fetches summary via fetchJson(/api/summary) — we mock fetch.
 * Module holds state (current/inflight), so tests run sequentially
 * and account for accumulated context.
 */
let calls: string[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const date = new URL(url, 'http://test').searchParams.get('date') ?? '';
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, json: async () => ({ date }) } as Response;
    }),
  );
});

describe('loadSummary', () => {
  it('fast date switch: second date is not lost but loads after', async () => {
    const p1 = loadSummary('2026-07-01');
    // Second call during inflight — previously silently returned old promise,
    // and summary for 02 was never loaded at all.
    const p2 = loadSummary('2026-07-02');
    await Promise.all([p1, p2]);
    await vi.waitFor(() => {
      expect(getCurrentSummary()?.date).toBe('2026-07-02');
    });
    expect(calls).toContain('/api/summary?date=2026-07-01');
    expect(calls).toContain('/api/summary?date=2026-07-02');
  });

  it("duplicate request for same date during inflight doesn't make extra fetch", async () => {
    const p1 = loadSummary('2026-07-03');
    const p2 = loadSummary('2026-07-03');
    await Promise.all([p1, p2]);
    // Let the queue settle and verify: exactly one request for this date
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.filter((u) => u.includes('2026-07-03'))).toHaveLength(1);
    expect(getCurrentSummary()?.date).toBe('2026-07-03');
  });
});

/**
 * New logic (refresh same date after write + reset stale summary)
 * is tested on a FRESH module: store holds module-state, and fire-and-forget
 * catch-up chains would otherwise leak between tests and pollute them.
 */
describe('loadSummary — fresh module', () => {
  async function freshStore() {
    vi.resetModules();
    return await import('@lib/store');
  }

  function stubFetch(impl: (url: string) => Promise<Response>) {
    vi.stubGlobal('fetch', vi.fn(impl));
  }

  const okResponse = (url: string) => {
    const date = new URL(url, 'http://test').searchParams.get('date') ?? '';
    return { ok: true, json: async () => ({ date }) } as Response;
  };

  it('failed switch to DIFFERENT date resets stale summary', async () => {
    stubFetch(async (url) => {
      const date = new URL(url, 'http://test').searchParams.get('date') ?? '';
      if (date === '2026-07-07') throw new Error('network down');
      return okResponse(url);
    });
    const store = await freshStore();
    await store.loadSummary('2026-07-06');
    expect(store.getCurrentSummary()?.date).toBe('2026-07-06');
    // Network fails when requesting different date: old summary must not remain,
    // otherwise cards would draw 06th data under 07th date.
    await store.loadSummary('2026-07-07');
    expect(store.getCurrentSummary()).toBeNull();
  });

  it('auto-refresh failure for same date preserves summary (data still valid)', async () => {
    let fail = false;
    stubFetch(async (url) => {
      if (fail) throw new Error('network down');
      return okResponse(url);
    });
    const store = await freshStore();
    await store.loadSummary('2026-07-08');
    expect(store.getCurrentSummary()?.date).toBe('2026-07-08');
    fail = true;
    await store.loadSummary('2026-07-08');
    // Same date — summary stays, subscribers receive err with live data.
    expect(store.getCurrentSummary()?.date).toBe('2026-07-08');
  });

  it('refresh same date during inflight fetches fresh data (entry via modal)', async () => {
    const seen: string[] = [];
    stubFetch(async (url) => {
      seen.push(url);
      await new Promise((r) => setTimeout(r, 5));
      return okResponse(url);
    });
    const store = await freshStore();
    await store.loadSummary('2026-07-05');
    expect(seen.filter((u) => u.includes('2026-07-05'))).toHaveLength(1);
    // Auto-refresh is running (inflight), and at this time the modal after write requests
    // the same date. Previously such request was dropped from queue and new entry didn't
    // appear until the next 60-s tick — now a catch-up fetch is made.
    const p2 = store.loadSummary('2026-07-05');
    const p3 = store.loadSummary('2026-07-05');
    await Promise.all([p2, p3]);
    await vi.waitFor(() => {
      expect(seen.filter((u) => u.includes('2026-07-05')).length).toBeGreaterThanOrEqual(3);
    });
  });
});

describe('loadStatus (fresh module)', () => {
  async function freshStore() {
    vi.resetModules();
    return await import('@lib/store');
  }

  const statusResponse = (over = {}) =>
    ({
      ok: true,
      json: async () => ({
        status: 'ok',
        configured: true,
        oauth: { hasClientId: true, hasClientSecret: true, hasRefreshToken: true, refreshSource: 'env' },
        ...over,
      }),
    }) as Response;

  it('loads once and caches within TTL (no second fetch)', async () => {
    let hits = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        hits++;
        return statusResponse();
      }),
    );
    const store = await freshStore();
    await store.loadStatus();
    await store.loadStatus();
    expect(hits).toBe(1);
    expect(store.getStatus()?.configured).toBe(true);
  });

  it('force reloads past the TTL', async () => {
    let hits = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        hits++;
        return statusResponse({ status: hits === 1 ? 'ok' : 'misconfigured' });
      }),
    );
    const store = await freshStore();
    await store.loadStatus();
    expect(store.getStatus()?.status).toBe('ok');
    await store.loadStatus(true);
    expect(store.getStatus()?.status).toBe('misconfigured');
  });

  it('keeps the previous cached status if a refresh fails', async () => {
    let fail = false;
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (fail) throw new Error('network down');
      return statusResponse();
    }));
    const store = await freshStore();
    await store.loadStatus();
    expect(store.getStatus()?.configured).toBe(true);
    fail = true;
    await store.loadStatus(true);
    expect(store.getStatus()?.configured).toBe(true);
  });
});
