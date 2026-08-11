/**
 * Pure computations for derived metrics (v3): streaks, variability, SpO2
 * desaturation, night/day sample splitting, heart rate recovery.
 * Isomorphic module — covered by Vitest, used by islands.
 */

import { pointDate, sampleValue, toNumber } from './extract';

export interface Sample {
  time: string;
  value: number;
}

export interface TimeWindow {
  start: string;
  end: string;
}

/** Calendar day difference (b - a). */
export function dayDiff(a: string, b: string): number {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  return Math.round(
    (Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) /
      86_400_000,
  );
}

/**
 * Streaks: consecutive calendar days with a value >= threshold.
 * A missing day or a value below the threshold breaks the streak.
 * `excludeDate` (today, incomplete day) is excluded from the calculation.
 */
export function computeStreaks(
  entries: { date: string; value: number }[],
  threshold: number,
  excludeDate?: string,
): { current: number; longest: number } {
  const sorted = entries
    .filter((e) => e.date !== excludeDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  let longest = 0;
  let run = 0;
  let prevDate: string | null = null;
  for (const e of sorted) {
    if (e.value >= threshold) {
      run = prevDate !== null && run > 0 && dayDiff(prevDate, e.date) === 1 ? run + 1 : 1;
    } else {
      run = 0;
    }
    if (run > longest) longest = run;
    prevDate = e.date;
  }
  // If the last entry is not yesterday (relative to excludeDate), the streak has ended.
  if (excludeDate && sorted.length > 0 && run > 0) {
    const lastDate = sorted[sorted.length - 1].date;
    const d = new Date(excludeDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    const yesterday = d.toISOString().split('T')[0];
    if (lastDate !== yesterday) {
      run = 0;
    }
  }
  return { current: run, longest };
}

/** Mean (null for empty input). */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Standard deviation (population), 0 for < 2 values. */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - m) * (v - m), 0) / values.length;
  return Math.sqrt(variance);
}

export interface DesatStats {
  /** number of samples below the threshold */
  count: number;
  /** minimum value (across all samples) */
  min: number | null;
  /** time of the minimum */
  minTime: string | null;
}

/** Desaturation: samples below the threshold + global minimum. */
export function desatStats(samples: Sample[], threshold = 92): DesatStats {
  if (samples.length === 0) return { count: 0, min: null, minTime: null };
  let min = Infinity;
  let minTime: string | null = null;
  let count = 0;
  for (const s of samples) {
    if (s.value < threshold) count++;
    if (s.value < min) {
      min = s.value;
      minTime = s.time;
    }
  }
  return { count, min, minTime };
}

/** A sample falls into "night" if it lies within any sleep window. */
export function splitNightDay(
  samples: Sample[],
  windows: TimeWindow[],
): { night: Sample[]; day: Sample[] } {
  const ranges = windows
    .map((w) => [new Date(w.start).getTime(), new Date(w.end).getTime()] as const)
    .filter(([a, b]) => !Number.isNaN(a) && !Number.isNaN(b));
  const night: Sample[] = [];
  const day: Sample[] = [];
  for (const s of samples) {
    const t = new Date(s.time).getTime();
    if (Number.isNaN(t)) continue;
    (ranges.some(([a, b]) => t >= a && t <= b) ? night : day).push(s);
  }
  return { night, day };
}

export interface HrrResult {
  /** average HR in the first 5 minutes after end */
  first: number;
  /** average HR in the next 5 minutes */
  second: number;
  /** recovery: how many bpm dropped (positive = good) */
  drop: number;
}

/**
 * Heart rate recovery after exertion: mean in windows [end, +5min)
 * and [+5min, +10min). Null if there is no data in the windows.
 */
export function heartRateRecovery(
  points: { time: string; avg?: number }[],
  endIso: string,
): HrrResult | null {
  const end = new Date(endIso).getTime();
  if (Number.isNaN(end)) return null;
  const inWindow = (from: number, to: number) =>
    points
      .filter((p) => {
        const t = new Date(p.time).getTime();
        return p.avg !== undefined && t >= from && t < to;
      })
      .map((p) => p.avg as number);
  const first = mean(inWindow(end, end + 5 * 60_000));
  const second = mean(inWindow(end + 5 * 60_000, end + 10 * 60_000));
  if (first === null || second === null) return null;
  return { first, second, drop: Math.round(first - second) };
}

/** Delta "last 7 vs previous 7", % (null — nothing to compare). */
export function weekOverWeekPct(cur: number[], prev: number[]): number | null {
  const c = mean(cur);
  const p = mean(prev);
  if (c === null || p === null || p === 0) return null;
  return ((c - p) / Math.abs(p)) * 100;
}

/** Sleep efficiency: minutesAsleep / minutesInSleepPeriod * 100 */
export function sleepEfficiency(summary: Record<string, unknown>): number | null {
  const asleep = toNumber(summary.minutesAsleep);
  const inPeriod = toNumber(summary.minutesInSleepPeriod);
  if (!asleep || !inPeriod || inPeriod === 0) return null;
  return Math.round((asleep / inPeriod) * 1000) / 10; // e.g. 95.3
}

/** Extract sleep stage percentages from stagesSummary array */
export function stagePercentages(
  stagesSummary: unknown[],
): Record<string, { minutes: number; percent: number }> {
  const result: Record<string, { minutes: number; percent: number }> = {};
  if (!Array.isArray(stagesSummary) || stagesSummary.length === 0) return result;

  let total = 0;
  const items: { type: string; minutes: number }[] = [];
  for (const item of stagesSummary) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const type = rec.type as string | undefined;
    const minutes = toNumber(rec.minutes) ?? 0;
    if (!type) continue;
    items.push({ type, minutes });
    total += minutes;
  }
  for (const { type, minutes } of items) {
    result[type] = {
      minutes,
      percent: total > 0 ? Math.round((minutes / total) * 1000) / 10 : 0,
    };
  }
  return result;
}

/** Deep + REM sleep as percentage of total sleep - the key sleep quality metric */
export function deepRemRatio(stagesSummary: unknown[]): number | null {
  if (!Array.isArray(stagesSummary) || stagesSummary.length === 0) return null;

  let deepMinutes = 0;
  let remMinutes = 0;
  let totalMinutes = 0;

  for (const item of stagesSummary) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const type = (rec.type as string) ?? '';
    const minutes = toNumber(rec.minutes) ?? 0;
    totalMinutes += minutes;
    if (type === 'DEEP') deepMinutes += minutes;
    if (type === 'REM') remMinutes += minutes;
  }

  if (totalMinutes === 0) return null;
  return Math.round(((deepMinutes + remMinutes) / totalMinutes) * 1000) / 10;
}

/** Analyze HR zone time distribution from time-in-heart-rate-zone data */
export function hrZoneDistribution(
  zoneData: Record<string, unknown>,
): Record<string, { minutes: number; percent: number }> {
  const result: Record<string, { minutes: number; percent: number }> = {};
  if (!zoneData || typeof zoneData !== 'object') return result;

  // Find the zones array
  const arr = Object.values(zoneData).find((v) => Array.isArray(v)) as
    | unknown[]
    | undefined;
  if (!arr) return result;

  let total = 0;
  const items: { zone: string; minutes: number }[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const zone = (rec.heartRateZone as string) ?? (rec.zone as string);
    if (!zone) continue;
    let minutes = 0;
    if (typeof rec.duration === 'string') {
      const sec = /^(\d+(?:\.\d+)?)s$/.exec(rec.duration);
      minutes = sec ? Math.round(Number(sec[1]) / 60) : 0;
    } else {
      minutes = toNumber(rec.minutes) ?? toNumber(rec.duration) ?? 0;
    }
    items.push({ zone, minutes });
    total += minutes;
  }
  for (const { zone, minutes } of items) {
    result[zone] = {
      minutes,
      percent: total > 0 ? Math.round((minutes / total) * 1000) / 10 : 0,
    };
  }
  return result;
}

/** Analyze VO2 max trend over time */
export function vo2MaxTrend(dataPoints: Record<string, unknown>[]): {
  current: number | null;
  trend: 'improving' | 'stable' | 'declining' | null;
  changePercent: number | null;
} {
  const empty = { current: null, trend: null, changePercent: null };
  if (!Array.isArray(dataPoints) || dataPoints.length === 0) return empty;

  // Chronological sort: date can be an object {year, month, day}
  // (String() would give "[object Object]" and sorting would silently fail).
  // Points without a date (pre-sorted by the caller) keep their order.
  const sortKey = (p: Record<string, unknown>): string => {
    const pd = pointDate(p);
    if (pd) return pd;
    const st = (p.sampleTime as Record<string, unknown> | undefined)?.physicalTime;
    if (typeof st === 'string') return st.slice(0, 10);
    const t = toNumber(p.date);
    return t !== undefined ? String(t) : '';
  };
  const sorted = [...dataPoints].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  const values: number[] = [];
  for (const dp of sorted) {
    if (!dp || typeof dp !== 'object') continue;
    // Real API: vo2Max = {millilitersPerMinuteKilogramMax: 46.2};
    // flattened points from the caller come as {avg: N}.
    const v =
      sampleValue(dp.vo2Max) ??
      toNumber(dp.vo2Max) ??
      toNumber(dp.value) ??
      toNumber(dp.avg);
    if (v !== undefined && v > 0) values.push(v);
  }

  if (values.length === 0) return empty;
  const current = values[values.length - 1] ?? null;

  if (values.length < 2) return { current, trend: null, changePercent: null };

  // Compare first half average vs second half average
  const mid = Math.ceil(values.length / 2);
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);
  if (secondHalf.length === 0) return { current, trend: null, changePercent: null };

  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

  if (avgFirst === 0) return { current, trend: null, changePercent: null };

  const changePercent = Math.round(((avgSecond - avgFirst) / avgFirst) * 1000) / 10;

  let trend: 'improving' | 'stable' | 'declining' = 'stable';
  if (changePercent > 2) trend = 'improving';
  else if (changePercent < -2) trend = 'declining';

  return { current, trend, changePercent };
}

/**
 * Readiness based on average HRV and resting heart rate over a period
 * (thresholds are heuristics for exercise readiness). Pure function — covered
 * by tests, used in /api/analytics?mode=hrv_trend.
 */
export function computeReadiness(hrvAvg: number, rhrAvg: number): string {
  if (hrvAvg > 50 && rhrAvg > 0 && rhrAvg < 65) return 'HIGH';
  if (hrvAvg > 30) return 'MODERATE';
  return 'LOW / RECOVERY NEEDED';
}

/**
 * Clip the interval [startIso, endIso) to the civil day `date`.
 *
 * Day boundaries are local midnight in UTC: dayStart = dateT00:00:00Z + offsetMin,
 * where offsetMin = Date.getTimezoneOffset (UTC-local; -180 for UTC+3) — the same
 * formula as in /api/intraday, so segments align on the same axis.
 *
 * Returns [startMin, endMin] — minutes from midnight of the day, both in [0, 1440];
 * null if the interval does not intersect the day or is degenerate (zero minutes).
 * endIso = null/undefined -> point event -> also null (no duration).
 */
export function clipToDay(
  startIso: string,
  endIso: string | null | undefined,
  date: string,
  offsetMin = 0,
): [number, number] | null {
  const start = Date.parse(startIso);
  const dayStart = Date.parse(`${date}T00:00:00Z`) + offsetMin * 60_000;
  if (Number.isNaN(start) || Number.isNaN(dayStart)) return null;
  const endParsed = endIso ? Date.parse(endIso) : Number.NaN;
  const end = Number.isNaN(endParsed) ? start : endParsed;
  const dayEnd = dayStart + 86_400_000;
  if (end <= dayStart || start >= dayEnd) return null;
  const from = Math.max(0, Math.round((start - dayStart) / 60_000));
  const to = Math.min(1440, Math.round((end - dayStart) / 60_000));
  return from < to ? [from, to] : null;
}

/** Minute of the civil day (0..1443) for an ISO moment; null — outside the day. */
export function minuteOfDay(
  iso: string | null | undefined,
  date: string,
  offsetMin = 0,
): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  const dayStart = Date.parse(`${date}T00:00:00Z`) + offsetMin * 60_000;
  if (Number.isNaN(t) || Number.isNaN(dayStart)) return null;
  const m = Math.floor((t - dayStart) / 60_000);
  return m >= 0 && m < 1440 ? m : null;
}

/**
 * Civil date (YYYY-MM-DD) of an ISO moment in the offsetMin timezone.
 * Intraday windows are aligned to the local day, so the UTC date of the event
 * (iso.slice(0,10)) is not suitable: 01:00 local time = 22:00Z of the previous day.
 */
export function civilDateOf(iso: string | null | undefined, offsetMin = 0): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  // local time = UTC - offsetMin: shift the moment and take the UTC date
  return new Date(t - offsetMin * 60_000).toISOString().slice(0, 10);
}
