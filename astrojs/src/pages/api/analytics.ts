import type { APIRoute } from 'astro';
import { json, jsonError } from '@lib/api-utils';
import { apiCache, CACHE_PREFIXES } from '@lib/cache';
import { toNumber } from '@lib/extract';
import { addDays, nextDay, todayLocal } from '@lib/filters';
import { GhError, ghDailyRollUp, ghList, ghListAll } from '@lib/gh-client';
import { computeReadiness } from '@lib/stats';
import type { ListResponse, RollupResponse } from '@lib/gh-types';

const isValidDate = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d).getTime());

/**
 * Error collector for parallel fetches. Single request failure — "no data",
 * but if ALL failed — it's a dead token/network: propagate error upward
 * (route returns 502), instead of zeros with status 200 that would also be cached.
 */
function makeErrorSink(errors: unknown[]): (e: unknown) => null {
  return (e) => {
    errors.push(e);
    return null;
  };
}

function throwIfAllFailed(errors: unknown[], total: number): void {
  if (errors.length >= total) {
    const gh = errors.find((e) => e instanceof GhError);
    throw gh ?? errors[0] ?? new GhError('analytics: all requests failed', 502);
  }
}

interface HrvDayEntry {
  date: unknown;
  rmssd_ms: number;
  entropy: number | null;
  deep_sleep_rmssd_ms: number | null;
  non_rem_hr_bpm: number | null;
}

interface RhrDayEntry {
  date: unknown;
  bpm: number;
  calculation_method: string | null;
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'compare';

  try {
    if (mode === 'compare') {
      // Defaults: last 7 days vs the 7 days before that, relative to today
      // Local dates (todayLocal), not UTC — otherwise at night "today" shifts to yesterday
      const today = todayLocal();
      const p2End = url.searchParams.get('p2End') || today;
      const p2Start = url.searchParams.get('p2Start') || addDays(today, -6);
      const p1End = url.searchParams.get('p1End') || addDays(today, -7);
      const p1Start = url.searchParams.get('p1Start') || addDays(today, -13);

      if (
        !isValidDate(p1Start) ||
        !isValidDate(p1End) ||
        !isValidDate(p2Start) ||
        !isValidDate(p2End)
      ) {
        return json({ error: 'Invalid date format, use YYYY-MM-DD' }, 400);
      }

      // Both dailyRollUp and the sleep filter treat the end date as exclusive,
      // so pass end+1 day to the APIs while keeping the inclusive dates for display.
      const p1EndNext = nextDay(p1End);
      const p2EndNext = nextDay(p2End);

      const payload = await apiCache.orFetch(
        `${CACHE_PREFIXES.analytics}compare:${p1Start}:${p1End}:${p2Start}:${p2End}`,
        async () => {
          // Fetch all metrics in parallel for both periods
          const METRICS = ['steps', 'active-energy-burned', 'total-calories', 'distance', 'floors', 'heart-rate'] as const;
          const errors: unknown[] = [];
          const sink = makeErrorSink(errors);
          const fetches = await Promise.all([
            ...METRICS.map((m) => ghDailyRollUp(m, { startDate: p1Start, endDate: p1EndNext }).catch(sink)),
            ...METRICS.map((m) => ghDailyRollUp(m, { startDate: p2Start, endDate: p2EndNext }).catch(sink)),
            ghListAll('sleep', `sleep.interval.civil_end_time >= "${p1Start}" AND sleep.interval.civil_end_time < "${p1EndNext}"`, 25).then((dataPoints): ListResponse => ({ dataPoints })).catch(sink),
            ghListAll('sleep', `sleep.interval.civil_end_time >= "${p2Start}" AND sleep.interval.civil_end_time < "${p2EndNext}"`, 25).then((dataPoints): ListResponse => ({ dataPoints })).catch(sink),
          ]);
          throwIfAllFailed(errors, fetches.length);

          const sumField = (res: RollupResponse | null, path: string[]): number => {
            let total = 0;
            for (const p of res?.rollupDataPoints || []) {
              let val: unknown = p;
              for (const key of path) val = (val as Record<string, unknown>)?.[key];
              total += Number(val || 0);
            }
            return total;
          };

          const avgField = (res: RollupResponse | null, path: string[]): number => {
            const pts = res?.rollupDataPoints || [];
            if (!pts.length) return 0;
            let total = 0;
            let count = 0;
            for (const p of pts) {
              let val: unknown = p;
              for (const key of path) val = (val as Record<string, unknown>)?.[key];
              const n = Number(val || 0);
              if (n > 0) { total += n; count++; }
            }
            return count > 0 ? total / count : 0;
          };

          const sumSleep = (res: ListResponse | null): { total: number; sessions: number } => {
            let total = 0;
            let sessions = 0;
            for (const p of res?.dataPoints || []) {
              const mins = toNumber(
                (p?.sleep as { summary?: { minutesAsleep?: unknown } } | undefined)?.summary
                  ?.minutesAsleep,
              );
              if (mins && mins > 0) {
                total += mins;
                sessions++;
              }
            }
            return { total, sessions };
          };

          // Math.max(1, ...) guards against division by zero on degenerate ranges
          const d1 = Math.max(1, (new Date(p1End).getTime() - new Date(p1Start).getTime()) / 86400000 + 1);
          const d2 = Math.max(1, (new Date(p2End).getTime() - new Date(p2Start).getTime()) / 86400000 + 1);

          const N = METRICS.length;
          const p1 = fetches.slice(0, N);
          const p2 = fetches.slice(N, N * 2);
          const sleep1 = sumSleep(fetches[N * 2]);
          const sleep2 = sumSleep(fetches[N * 2 + 1]);

          const m1 = {
            avg_daily_steps: Math.round(sumField(p1[0], ['steps', 'countSum']) / d1),
            avg_daily_active_calories: Math.round((sumField(p1[1], ['activeEnergyBurned', 'kcalSum']) / d1) * 10) / 10,
            avg_daily_total_calories: Math.round((sumField(p1[2], ['totalCalories', 'kcalSum']) / d1) * 10) / 10,
            avg_daily_distance_km: Math.round((sumField(p1[3], ['distance', 'millimetersSum']) / 1000000 / d1) * 100) / 100,
            avg_daily_floors: Math.round(sumField(p1[4], ['floors', 'countSum']) / d1),
            avg_heart_rate: Math.round(avgField(p1[5], ['heartRate', 'beatsPerMinuteAvg']) * 10) / 10,
            avg_sleep_minutes: sleep1.sessions > 0 ? Math.round(sleep1.total / sleep1.sessions) : 0,
            sleep_sessions: sleep1.sessions,
          };

          const m2 = {
            avg_daily_steps: Math.round(sumField(p2[0], ['steps', 'countSum']) / d2),
            avg_daily_active_calories: Math.round((sumField(p2[1], ['activeEnergyBurned', 'kcalSum']) / d2) * 10) / 10,
            avg_daily_total_calories: Math.round((sumField(p2[2], ['totalCalories', 'kcalSum']) / d2) * 10) / 10,
            avg_daily_distance_km: Math.round((sumField(p2[3], ['distance', 'millimetersSum']) / 1000000 / d2) * 100) / 100,
            avg_daily_floors: Math.round(sumField(p2[4], ['floors', 'countSum']) / d2),
            avg_heart_rate: Math.round(avgField(p2[5], ['heartRate', 'beatsPerMinuteAvg']) * 10) / 10,
            avg_sleep_minutes: sleep2.sessions > 0 ? Math.round(sleep2.total / sleep2.sessions) : 0,
            sleep_sessions: sleep2.sessions,
          };

          const deltas: Record<string, { diff: number; pct: string }> = {};
          for (const key of Object.keys(m1) as (keyof typeof m1)[]) {
            const va = m1[key] as number;
            const vb = m2[key] as number;
            const diff = Math.round((vb - va) * 100) / 100;
            const pct = va !== 0 ? ((diff / Math.abs(va)) * 100).toFixed(1) + '%' : '0%';
            deltas[key] = { diff, pct };
          }

          return {
            period1: { start: p1Start, end: p1End, days: d1, ...m1 },
            period2: { start: p2Start, end: p2End, days: d2, ...m2 },
            deltas,
          };
        },
      );

      return json(payload);
    }

    if (mode === 'hrv_trend') {
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || '14')));
      if (isNaN(days)) return json({ error: 'Invalid days parameter' }, 400);
      const endDate = url.searchParams.get('endDate') || todayLocal();
      if (!isValidDate(endDate)) return json({ error: 'Invalid endDate' }, 400);

      const payload = await apiCache.orFetch(
        `${CACHE_PREFIXES.analytics}hrv_trend:${days}:${endDate}`,
        async () => {
          const startDate = new Date(new Date(endDate).getTime() - (days - 1) * 86400000).toISOString().split('T')[0];

          const endExclusive = nextDay(endDate);
          const hrvFilter = `daily_heart_rate_variability.date >= "${startDate}" AND daily_heart_rate_variability.date < "${endExclusive}"`;
          const rhrFilter = `daily_resting_heart_rate.date >= "${startDate}" AND daily_resting_heart_rate.date < "${endExclusive}"`;

          const errors: unknown[] = [];
          const sink = makeErrorSink(errors);
          const [hrvRes, rhrRes] = await Promise.all([
            ghList('daily-heart-rate-variability', { filter: hrvFilter, pageSize: 100 }).catch(sink),
            ghList('daily-resting-heart-rate', { filter: rhrFilter, pageSize: 100 }).catch(sink),
          ]);
          throwIfAllFailed(errors, 2);

          const hrvValues: number[] = [];
          const hrvDaily: HrvDayEntry[] = [];
          for (const p of (hrvRes as ListResponse | null)?.dataPoints || []) {
            const hrv = p?.dailyHeartRateVariability as Record<string, unknown> | undefined;
            if (!hrv) continue;
            // API field: averageHeartRateVariabilityMilliseconds
            const val = hrv.averageHeartRateVariabilityMilliseconds;
            if (val != null) {
              const n = Number(val);
              hrvValues.push(n);
              hrvDaily.push({
                date: hrv.date,
                rmssd_ms: n,
                entropy: hrv.entropy != null ? Number(hrv.entropy) : null,
                deep_sleep_rmssd_ms: hrv.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds != null
                  ? Number(hrv.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds)
                  : null,
                non_rem_hr_bpm: hrv.nonRemHeartRateBeatsPerMinute ? Number(hrv.nonRemHeartRateBeatsPerMinute) : null,
              });
            }
          }

          const rhrValues: number[] = [];
          const rhrDaily: RhrDayEntry[] = [];
          for (const p of (rhrRes as ListResponse | null)?.dataPoints || []) {
            const rhr = p?.dailyRestingHeartRate as Record<string, unknown> | undefined;
            if (!rhr) continue;
            const val = rhr.beatsPerMinute;
            if (val != null) {
              const n = Number(val);
              rhrValues.push(n);
              const meta = rhr.dailyRestingHeartRateMetadata as Record<string, unknown> | undefined;
              rhrDaily.push({
                date: rhr.date,
                bpm: n,
                calculation_method: (meta?.calculationMethod as string) ?? null,
              });
            }
          }

          const hrvAvg = hrvValues.length ? hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length : 0;
          const rhrAvg = rhrValues.length ? rhrValues.reduce((a, b) => a + b, 0) / rhrValues.length : 0;

          const readiness = computeReadiness(hrvAvg, rhrAvg);

          return {
            days,
            startDate,
            endDate,
            hrv: {
              count: hrvValues.length,
              avg: Math.round(hrvAvg * 10) / 10,
              min: hrvValues.length ? Math.min(...hrvValues) : 0,
              max: hrvValues.length ? Math.max(...hrvValues) : 0,
            },
            restingHr: {
              count: rhrValues.length,
              avg: Math.round(rhrAvg * 10) / 10,
              min: rhrValues.length ? Math.min(...rhrValues) : 0,
              max: rhrValues.length ? Math.max(...rhrValues) : 0,
            },
            dailyHrv: hrvDaily,
            dailyRhr: rhrDaily,
            readiness,
          };
        },
      );

      return json(payload);
    }

    if (mode === 'temperature') {
      // Defaults: last 14 days (inclusive of today)
      // Local dates (todayLocal), not UTC — otherwise at night "today" shifts to yesterday
      const today = todayLocal();
      const endDate = url.searchParams.get('endDate') || today;
      const startDate = url.searchParams.get('startDate') || addDays(today, -13);

      if (!isValidDate(startDate) || !isValidDate(endDate)) {
        return json({ error: 'Invalid date format, use YYYY-MM-DD' }, 400);
      }

      const payload = await apiCache.orFetch(
        `${CACHE_PREFIXES.analytics}temperature:${startDate}:${endDate}`,
        async () => {
          const endExclusive = nextDay(endDate);
          const coreFilter =
            `core_body_temperature.sample_time.physical_time >= "${startDate}T00:00:00Z" AND ` +
            `core_body_temperature.sample_time.physical_time < "${endExclusive}T00:00:00Z"`;
          const sleepTempFilter =
            `daily_sleep_temperature_derivations.date >= "${startDate}" AND ` +
            `daily_sleep_temperature_derivations.date < "${endExclusive}"`;

          const errors: unknown[] = [];
          const sink = makeErrorSink(errors);
          const [coreRes, sleepRes] = await Promise.all([
            ghList('core-body-temperature', { filter: coreFilter, pageSize: 1000 }).catch(sink),
            ghList('daily-sleep-temperature-derivations', { filter: sleepTempFilter, pageSize: 100 }).catch(sink),
          ]);
          throwIfAllFailed(errors, 2);

          return {
            coreBodyTemperature: (coreRes as ListResponse | null)?.dataPoints || [],
            sleepTemperature: (sleepRes as ListResponse | null)?.dataPoints || [],
            period: { start: startDate, end: endDate },
          };
        },
      );

      return json(payload);
    }

    return json({ error: 'Invalid mode' }, 400);
  } catch (e) {
    return jsonError(e);
  }
};
