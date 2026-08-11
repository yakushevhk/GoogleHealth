/**
 * Request correlation + lightweight server metrics.
 *
 * Pure, dependency-light helpers (no node imports in the hot path) so they are
 * unit-testable. `makeRequestMeta()` hands out the per-request id and a
 * stopwatch; counters are module-level so a /api/metrics endpoint (added later)
 * can report cache hit/miss and upstream call counts without touching Google.
 */

export interface RequestMeta {
  readonly id: string;
  /** ms since `startT` at call time (high-resolution, non-drifting monotonic). */
  elapsedMs(): number;
}

let requestSeq = 0;

/** Monotonic-ish short id: process seq + random suffix (not a secret). */
export function makeRequestMeta(): RequestMeta {
  const t0 = (performance ?? Date).now();
  const id = `r${requestSeq++}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    elapsedMs: () => Math.round(((performance ?? Date).now() - t0) * 10) / 10,
  };
}

export type MetricKind = 'cache_hit' | 'cache_miss' | 'upstream';

const counts: Record<MetricKind, number> = {
  cache_hit: 0,
  cache_miss: 0,
  upstream: 0,
};
/** Optional custom/adhoc counters keyed by name. */
const custom = new Map<string, number>();

/** Increment a named metric once. */
export function countMetric(kind: MetricKind, delta = 1): void {
  counts[kind] += delta;
}

export function countCustom(name: string, delta = 1): void {
  custom.set(name, (custom.get(name) ?? 0) + delta);
}

/** Snapshot of all counters (safe to expose — no PII, no tokens). */
export function metricSnapshot(): Record<string, number> {
  const out: Record<string, number> = { ...counts };
  for (const [k, v] of custom) out[k] = v;
  return out;
}

/** Reset all counters (for tests). */
export function resetMetrics(): void {
  counts.cache_hit = 0;
  counts.cache_miss = 0;
  counts.upstream = 0;
  custom.clear();
}
