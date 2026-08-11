/**
 * GET /api/insights?days=30
 *
 * Runs the pure `insights` rules over real dashboard data for the last N days
 * and returns a normalized, severity-ordered list. Each series degrades
 * gracefully (empty on error) — a missing metric just yields no insight for it.
 * Reads are cached by the parameterized key.
 */
import type { APIRoute } from 'astro';
import { json, jsonError } from '@lib/http';
import { makeRequestMeta } from '@lib/request-meta';
import { apiCache, CACHE_PREFIXES } from '@lib/cache';
import { toNumber } from '@lib/extract';
import { addDays, buildRangeFilter, nextDay, todayLocal } from '@lib/filters';
import { ghDailyRollUp, ghListAll } from '@lib/gh-client';
import { collectInsights, type Insight } from '@lib/insights';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

interface Series {
  date: string;
  avg?: number;
  sum?: number;
}
interface SleepRow {
  date: string;
  asleepMinutes: number | null;
}
interface InsightsPayload {
  days: number;
  insights: Insight[];
}

const clampDays = (raw: string | null): number => {
  const n = Number(raw ?? String(DEFAULT_DAYS));
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(1, Math.floor(n)));
};

const civilOf = (d: { year?: number; month?: number; day?: number } | undefined): string => {
  if (!d?.year || !d?.month || !d?.day) return '';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.year}-${p(d.month)}-${p(d.day)}`;
};

export const GET: APIRoute = async ({ request }) => {
  const meta = makeRequestMeta();
  const url = new URL(request.url);
  const days = clampDays(url.searchParams.get('days'));
  const endDateRaw = url.searchParams.get('endDate');
  const endDate =
    endDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(endDateRaw) ? endDateRaw : todayLocal();
  const startDate = addDays(endDate, -(days - 1));

  try {
    const payload = await apiCache.orFetch(
      `${CACHE_PREFIXES.analytics}insights:${days}:${endDate}`,
      async (): Promise<InsightsPayload> => {
        const endEx = nextDay(endDate);

        // Daily typed series (daily-*) via list + range filter.
        const dailySeries = async (type: string): Promise<Series[]> => {
          const rows = await ghListAll(type, buildRangeFilter(type, startDate, endEx), 1000);
          const field = type.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          return rows.map((p) => {
            const o = (p[field] ?? {}) as Record<string, unknown>;
            const date = civilOf(p.date as { year?: number; month?: number; day?: number });
            return {
              date,
              avg: toNumber(o.beatsPerMinute ?? o.averageHeartRateVariabilityMilliseconds),
            };
          });
        };

        // Steps + weight via dailyRollUp (1-day windows) — dates in civilStartTime.
        const rollupSeries = async (
          type: string,
          agg: (p: Record<string, unknown>) => { sum?: number; avg?: number },
        ): Promise<Series[]> => {
          const resp = await ghDailyRollUp(type, { startDate, endDate, windowSizeDays: 1 });
          return (resp.rollupDataPoints ?? []).map((p) => ({
            date: civilOf(
              (p.civilStartTime as { date?: { year?: number; month?: number; day?: number } } | undefined)
                ?.date,
            ),
            ...agg(p),
          }));
        };

        const sleepRows = async (): Promise<SleepRow[]> => {
          const points = await ghListAll(
            'sleep',
            buildRangeFilter('sleep', startDate, endEx),
            25,
          );
          return points
            .map((p) => {
              const s = (p.sleep ?? {}) as {
                interval?: Record<string, string>;
                summary?: Record<string, string>;
              };
              const end = s.interval?.endTime;
              const off = s.interval?.endUtcOffset;
              const date = end
                ? off
                  ? new Date(Date.parse(end) + (parseInt(off, 10) || 0) * 1000)
                      .toISOString()
                      .slice(0, 10)
                  : end.slice(0, 10)
                : '';
              return {
                date,
                asleepMinutes: toNumber(s.summary?.minutesAsleep) ?? null,
              };
            })
            .filter((s) => s.date);
        };

        const [hrv, rhr, steps, sleep, weight] = await Promise.all([
          dailySeries('daily-heart-rate-variability').catch(() => [] as Series[]),
          dailySeries('daily-resting-heart-rate').catch(() => [] as Series[]),
          rollupSeries('steps', (p) => ({
            sum: toNumber((p.steps as { countSum?: string } | undefined)?.countSum),
          })).catch(() => [] as Series[]),
          sleepRows().catch(() => [] as SleepRow[]),
          rollupSeries('weight', (p) => ({
            avg: toNumber((p.weight as { weightGramsAvg?: number } | undefined)?.weightGramsAvg),
          })).catch(() => [] as Series[]),
        ]);

        const nums = (arr: Series[], key: 'avg' | 'sum'): number[] =>
          arr.map((s) => s[key]).filter((v): v is number => typeof v === 'number');
        const lastN = (arr: Series[], key: 'avg' | 'sum', n?: number): number | null => {
          const slice = n ? arr.slice(-n) : arr;
          const vals = nums(slice, key);
          return vals.length ? vals[vals.length - 1] : null;
        };
        const meanOf = (arr: Series[], key: 'avg' | 'sum', n?: number): number | null => {
          const vals = nums(n ? arr.slice(-n) : arr, key);
          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        };
        const sdOf = (arr: Series[], key: 'avg' | 'sum'): number | null => {
          const vals = nums(arr, key);
          if (vals.length < 2) return null;
          const m = vals.reduce((a, b) => a + b, 0) / vals.length;
          return Math.sqrt(vals.reduce((a, v) => a + (v - m) * (v - m), 0) / vals.length);
        };

        const nights = sleep.filter((s) => s.asleepMinutes !== null);
        const avgSleepMin = nights.length
          ? nights.reduce((a, s) => a + (s.asleepMinutes as number), 0) / nights.length
          : null;

        const insights = collectInsights({
          sleep: {
            lastAsleepMin: nights.length ? nights[nights.length - 1].asleepMinutes : null,
            avgAsleepMin: avgSleepMin,
            nights: nights.length,
          },
          hrv: { lastHrv: lastN(hrv, 'avg'), avgHrv: meanOf(hrv, 'avg'), sdHrv: sdOf(hrv, 'avg') },
          rhr: { lastRhr: lastN(rhr, 'avg'), avgRhr: meanOf(rhr, 'avg') },
          steps: { avg7: meanOf(steps, 'sum', 7), baseline: meanOf(steps, 'sum'), target: 10000 },
          recovery: {
            hrvAvg: meanOf(hrv, 'avg') ?? 0,
            rhrAvg: meanOf(rhr, 'avg') ?? 0,
            hasData: hrv.length > 0 || rhr.length > 0,
          },
          weight: {
            firstKg: weight.length ? weight[0].avg ?? null : null,
            lastKg: lastN(weight, 'avg'),
          },
        });

        return { days, insights };
      },
    );

    return json(payload, 200, {
      'x-request-id': meta.id,
      'x-request-duration-ms': String(meta.elapsedMs()),
    });
  } catch (e) {
    return jsonError(e, { meta });
  }
};
