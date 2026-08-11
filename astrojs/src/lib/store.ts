/**
 * Client-side store for the daily summary.
 *
 * Multiple islands (Vitals, Activity, Sleep, Workouts, Other)
 * share a single /api/summary — it is fetched once per date here,
 * and subscribers receive (summary, prevSummary) for diff highlighting.
 */
import type { DaySummary } from './gh-types';
import { fetchJson } from './ui';

type Listener = (
  summary: DaySummary | null,
  prev: DaySummary | null,
  error: string | null,
) => void;

let current: DaySummary | null = null;
let prev: DaySummary | null = null;
let currentDate = '';
let inflight: Promise<void> | null = null;
/** Date requested while an inflight request is in progress (will be loaded next). */
let queuedDate: string | null = null;
/** Among queued requests there was a refresh of the same date (e.g. after a write). */
let queuedSameDateRefresh = false;
const listeners = new Set<Listener>();

function notify(err: string | null = null): void {
  for (const fn of listeners) fn(current, prev, err);
}

export function subscribeSummary(fn: Listener): () => void {
  listeners.add(fn);
  // Give new subscribers the current state immediately
  fn(current, prev, null);
  return () => listeners.delete(fn);
}

/** Current loaded summary (or null). */
export function getCurrentSummary(): DaySummary | null {
  return current;
}

/**
 * Load the summary for a date. Same date triggers a silent refresh (auto-update).
 * If a request is already in progress, the date is queued: after the current
 * request completes, the latest requested date will be loaded (otherwise fast
 * navigation "<<" would lose the second date and cards would stay on the old one).
 */
export function loadSummary(date: string): Promise<void> {
  if (inflight) {
    queuedDate = date;
    // A refresh of the current date during an inflight request (write via modal)
    // must not be discarded: the inflight response is older than the write
    // and contains no new data.
    if (date === currentDate) queuedSameDateRefresh = true;
    return inflight;
  }
  inflight = (async () => {
    try {
      const fresh = await fetchJson<DaySummary>(`/api/summary?date=${date}`);
      if (date === currentDate) {
        prev = current;
      } else {
        prev = null;
      }
      current = fresh;
      currentDate = date;
      notify();
    } catch (e) {
      // A failed switch to a DIFFERENT date must not leave the old
      // summary: cards would render the previous day's data under the new date.
      if (current && date !== currentDate) {
        current = null;
        prev = null;
      }
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      inflight = null;
      const next = queuedDate;
      const sameDateRefresh = queuedSameDateRefresh;
      queuedDate = null;
      queuedSameDateRefresh = false;
      if (next && (next !== currentDate || sameDateRefresh)) void loadSummary(next);
    }
  })();
  return inflight;
}

/** Summary for the previous day (for vital sign deltas). Module-level cache. */
const prevDayCache = new Map<string, DaySummary>();
export async function loadPrevDaySummary(date: string): Promise<DaySummary | null> {
  const hit = prevDayCache.get(date);
  if (hit) return hit;
  try {
    const [y, m, d] = date.split('-').map(Number);
    const pd = new Date(y, m - 1, d - 1);
    const pad = (x: number) => String(x).padStart(2, '0');
    const prevDate = `${pd.getFullYear()}-${pad(pd.getMonth() + 1)}-${pad(pd.getDate())}`;
    const s = await fetchJson<DaySummary>(`/api/summary?date=${prevDate}`);
    prevDayCache.set(date, s);
    return s;
  } catch {
    return null;
  }
}
