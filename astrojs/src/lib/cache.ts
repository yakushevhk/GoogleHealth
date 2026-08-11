/**
 * In-memory cache with a 60-second TTL — saves Google Health API quota
 * during development and dashboard auto-refresh.
 */

interface Entry {
  value: unknown;
  expires: number;
}

const DEFAULT_TTL_MS = 60_000;

export class TtlCache {
  private store = new Map<string, Entry>();
  private inflight = new Map<string, Promise<unknown>>();
  /** Hard cap: when exceeded, the oldest entry (first inserted) is evicted. */
  private maxSize = 500;

  constructor(private ttlMs: number = DEFAULT_TTL_MS) {}

  get<T>(key: string): T | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() > e.expires) {
      this.store.delete(key);
      return undefined;
    }
    // LRU: hit moves entry to end so frequently used
    // keys aren't evicted before rarely read ones (Map preserves insertion order).
    this.store.delete(key);
    this.store.set(key, e);
    return e.value as T;
  }

  set(key: string, value: unknown): void {
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  /**
   * Return from cache or compute and cache the result.
   * Concurrent calls for the same key share a single in-flight promise
   * (single-flight deduplication) instead of triggering parallel fetches.
   */
  async orFetch<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;

    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = fn()
      .then((value) => {
        this.set(key, value);
        this.inflight.delete(key);
        return value;
      })
      .catch((err) => {
        this.inflight.delete(key);
        throw err;
      });

    this.inflight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.store.clear();
  }

  /** Delete all entries whose keys start with the given prefix. */
  invalidatePrefix(prefix: string): number {
    let count = 0;
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  get size(): number {
    return this.store.size;
  }
}

/** Shared cache for server API routes. */
export const apiCache = new TtlCache();

/** Canonical cache key prefixes — single source of truth for invalidation. */
export const CACHE_PREFIXES = {
  summary: 'summary:',
  history: 'history:',
  samples: 'samples:',
  list: 'list:',
  intraday: 'intraday:',
  analytics: 'analytics:',
} as const;
