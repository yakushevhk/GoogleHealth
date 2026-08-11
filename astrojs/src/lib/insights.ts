/**
 * Health insights — non-medical, purely analytical observations derived from
 * the dashboard's own data. Pure and isomorphic (no I/O), fully unit-tested.
 *
 * Each rule returns a normalized `Insight`:
 *   { key, severity: 'info'|'warn'|'good', title, detail, meta? }
 *
 * Rules are intentionally heuristic (comparisons against period averages),
 * never medical advice. Implemented as pure functions so they can be reused
 * by `/api/insights` and tested in isolation.
 */
import { stdDev } from './stats';

export type InsightSeverity = 'info' | 'warn' | 'good';

export interface Insight {
  key: string;
  severity: InsightSeverity;
  title: string;
  /** Rendered as supporting detail (e.g. "avg 6h 12m, last 7: 4h 30m"). */
  detail?: string;
  meta?: Record<string, number | string | null>;
}

export interface SleepInsightInput {
  /** last night asleep minutes (0 if none). */
  lastAsleepMin: number | null;
  /** period average asleep minutes. */
  avgAsleepMin: number | null;
  /** night count with data. */
  nights: number;
}

/** Sleep: last night notably shorter than the period average (> 25 %). */
export function sleepInsight(i: SleepInsightInput): Insight | null {
  if (i.lastAsleepMin === null || i.avgAsleepMin === null || i.avgAsleepMin <= 0) return null;
  const ratio = i.lastAsleepMin / i.avgAsleepMin;
  if (ratio < 0.75) {
    return {
      key: 'sleep_short',
      severity: 'warn',
      title: 'Sleep below your average',
      detail: `Last night ${Math.round(i.lastAsleepMin / 60)} h vs ~${Math.round(i.avgAsleepMin / 60)} h on average.`,
      meta: { lastHours: i.lastAsleepMin / 60, avgHours: i.avgAsleepMin / 60 },
    };
  }
  if (ratio >= 1.05) {
    return {
      key: 'sleep_good',
      severity: 'good',
      title: 'Good sleep',
      detail: `Last night ${Math.round(i.lastAsleepMin / 60)} h — at or above your average (${Math.round(i.avgAsleepMin / 60)} h).`,
    };
  }
  return null;
}

export interface HrvInsightInput {
  /** last day HRV (ms). */
  lastHrv: number | null;
  /** period average HRV (ms). */
  avgHrv: number | null;
  /** standard deviation over the period. */
  sdHrv: number | null;
}

/** HRV: last value meaningfully below the period average (> 1 SD). */
export function hrvInsight(i: HrvInsightInput): Insight | null {
  if (i.lastHrv === null || i.avgHrv === null || i.sdHrv === null) return null;
  if (i.avgHrv <= 0 || i.sdHrv <= 0) return null;
  if (i.lastHrv < i.avgHrv - i.sdHrv) {
    return {
      key: 'hrv_low',
      severity: 'warn',
      title: 'HRV dropped',
      detail: `HRV ${i.lastHrv} ms vs an average of ${i.avgHrv} ms (±${i.sdHrv}).`,
      meta: { last: i.lastHrv, avg: i.avgHrv, sd: i.sdHrv },
    };
  }
  return null;
}

export interface RhrInsightInput {
  lastRhr: number | null;
  avgRhr: number | null;
}

/** Resting HR: last value elevated vs the period average (> +5 %). */
export function rhrInsight(i: RhrInsightInput): Insight | null {
  if (i.lastRhr === null || i.avgRhr === null || i.avgRhr <= 0) return null;
  const pct = (i.lastRhr - i.avgRhr) / i.avgRhr;
  if (pct > 0.05) {
    return {
      key: 'rhr_elevated',
      severity: 'info',
      title: 'Resting HR slightly elevated',
      detail: `Resting HR ${i.lastRhr} bpm vs an average of ${i.avgRhr} bpm.`,
      meta: { last: i.lastRhr, avg: i.avgRhr },
    };
  }
  return null;
}

export interface StepsInsightInput {
  /** average steps over the last 7 available days (excl. today). */
  avg7: number | null;
  /** baseline (e.g. last 30 days) average steps. */
  baseline: number | null;
  target: number;
}

/** Steps: last-week average below 80 % of the baseline. */
export function stepsInsight(i: StepsInsightInput): Insight | null {
  if (i.avg7 === null || i.baseline === null || i.baseline <= 0) return null;
  if (i.avg7 / i.baseline < 0.8) {
    return {
      key: 'steps_down',
      severity: 'info',
      title: 'Activity below baseline',
      detail: `Last week avg ${Math.round(i.avg7)} steps vs ~${Math.round(i.baseline)} baseline.`,
      meta: { avg7: Math.round(i.avg7), baseline: Math.round(i.baseline) },
    };
  }
  return null;
}

export interface BedtimeInsightInput {
  /** bedtime minutes as deviations from the mean across nights. */
  bedMin: number[];
  /** count of nights with a bedtime. */
  nights: number;
}

/** Sleep regularity: bedtime varies more than ~45 minutes across nights. */
export function bedtimeInsight(i: BedtimeInsightInput): Insight | null {
  if (i.nights < 2 || i.bedMin.length < 2) return null;
  const sd = stdDev(i.bedMin);
  if (sd > 45) {
    return {
      key: 'bedtime_variable',
      severity: 'info',
      title: 'Bedtime varies',
      detail: `Bedtime shifts by ±${Math.round(sd)} min across nights.`,
      meta: { sdMin: Math.round(sd) },
    };
  }
  if (sd >= 10 && sd <= 45) {
    return {
      key: 'bedtime_stable',
      severity: 'good',
      title: 'Consistent bedtime',
      detail: `Bedtime is stable (±${Math.round(sd)} min).`,
      meta: { sdMin: Math.round(sd) },
    };
  }
  return null;
}

export interface RecoveryInsightInput {
  hrvAvg: number;
  rhrAvg: number;
  hasData: boolean;
}

/** Readiness derived from HRV + RHR (reuses computeReadiness semantics). */
export function recoveryInsight(i: RecoveryInsightInput): Insight | null {
  // Guard on a positive, finite HRV first: a missing/zero value must not be
  // reported as "low recovery" (no signal ≠ bad signal).
  if (!i.hasData || !Number.isFinite(i.hrvAvg) || i.hrvAvg <= 0) return null;
  if (i.hrvAvg > 50 && i.rhrAvg > 0 && i.rhrAvg < 65) {
    return {
      key: 'recovery_high',
      severity: 'good',
      title: 'Good recovery',
      detail: 'Averaged HRV is high with a low resting HR.',
    };
  }
  if (i.hrvAvg <= 30) {
    return {
      key: 'recovery_low',
      severity: 'warn',
      title: 'Recovery might be low',
      detail: 'Averaged HRV is low; consider more rest.',
      meta: { hrvAvg: i.hrvAvg },
    };
  }
  return null;
}

export interface WeightInsightInput {
  /** first (older) and last (newer) weight in kg. */
  firstKg: number | null;
  lastKg: number | null;
}

/** Weight trend over the period (> 1.5 kg change either way). */
export function weightInsight(i: WeightInsightInput): Insight | null {
  // Both ends must be positive, finite kg — otherwise it's "no data". A missing
  // lastKg must not fall through to a weight_down with NaN.
  if (
    i.firstKg === null ||
    i.lastKg === null ||
    !Number.isFinite(i.firstKg) ||
    !Number.isFinite(i.lastKg) ||
    i.firstKg <= 0 ||
    i.lastKg <= 0
  ) {
    return null;
  }
  const diff = i.lastKg - i.firstKg;
  const abs = Math.abs(diff);
  if (abs < 1.5) {
    return {
      key: 'weight_stable',
      severity: 'good',
      title: 'Weight stable',
      detail: `From ${i.firstKg} kg to ${i.lastKg} kg.`,
      meta: { diff },
    };
  }
  return {
    key: diff > 0 ? 'weight_up' : 'weight_down',
    severity: 'info',
    title: diff > 0 ? 'Weight trend up' : 'Weight trend down',
    detail: `${diff > 0 ? '+' : ''}${diff.toFixed(1)} kg over the period (${i.firstKg} → ${i.lastKg} kg).`,
    meta: { diff },
  };
}

/** Evaluate a full set of inputs and return only the non-null insights. */
export function collectInsights(inputs: {
  sleep?: SleepInsightInput;
  hrv?: HrvInsightInput;
  rhr?: RhrInsightInput;
  steps?: StepsInsightInput;
  bedtime?: BedtimeInsightInput;
  recovery?: RecoveryInsightInput;
  weight?: WeightInsightInput;
}): Insight[] {
  const out: Insight[] = [];
  const push = (i: Insight | null): void => {
    if (i) out.push(i);
  };
  if (inputs.sleep) push(sleepInsight(inputs.sleep));
  if (inputs.hrv) push(hrvInsight(inputs.hrv));
  if (inputs.rhr) push(rhrInsight(inputs.rhr));
  if (inputs.steps) push(stepsInsight(inputs.steps));
  if (inputs.bedtime) push(bedtimeInsight(inputs.bedtime));
  if (inputs.recovery) push(recoveryInsight(inputs.recovery));
  if (inputs.weight) push(weightInsight(inputs.weight));
  // Deterministic ordering: warn first, then info, then good.
  const order: Record<InsightSeverity, number> = { warn: 0, info: 1, good: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
