/**
 * Daily summary — replicates daily_summary() from GoogleHealth/src/tools.rs.
 * Same response shape (snake_case keys), but ~33 requests run in parallel
 * batches of 10 instead of sequential calls in Rust.
 *
 * A single request failure is not a summary failure: the field is simply absent
 * (like Rust: `if let Ok(v) = ...`).
 */
import { buildDayFilter, nextDay } from './filters';
import { GhError } from './gh-client';
import type { DaySummary, ExerciseMetrics, ListResponse, RollupResponse, SleepStage, SleepSummary } from './gh-types';

export interface SummaryClient {
  dailyRollUp(dataType: string, startDate: string, endDate: string): Promise<RollupResponse>;
  list(dataType: string, filter: string | null, pageSize: number): Promise<ListResponse>;
}

/** dailyRollUp: [type, field in rollupDataPoints[0], key in summary] */
const ROLLUP_SPECS: [string, string, keyof DaySummary][] = [
  ['steps', 'steps', 'steps'],
  ['heart-rate', 'heartRate', 'heart_rate'],
  ['active-energy-burned', 'activeEnergyBurned', 'active_calories'],
  ['total-calories', 'totalCalories', 'total_calories'],
  ['distance', 'distance', 'distance'],
  ['active-minutes', 'activeMinutes', 'active_minutes'],
  ['active-zone-minutes', 'activeZoneMinutes', 'active_zone_minutes'],
  ['floors', 'floors', 'floors'],
  ['time-in-heart-rate-zone', 'timeInHeartRateZone', 'time_in_heart_rate_zone'],
  ['calories-in-heart-rate-zone', 'caloriesInHeartRateZone', 'calories_in_heart_rate_zone'],
  ['altitude', 'altitude', 'altitude'],
  ['swim-lengths-data', 'swimLengthsData', 'swim_lengths'],
  ['weight', 'weight', 'weight_rollup'],
  ['body-fat', 'bodyFat', 'body_fat'],
  ['blood-glucose', 'bloodGlucose', 'blood_glucose'],
  ['core-body-temperature', 'coreBodyTemperature', 'core_body_temperature'],
  ['run-vo2-max', 'runVo2Max', 'run_vo2_max'],
  ['sedentary-period', 'sedentaryPeriod', 'sedentary_period'],
  ['nutrition-log', 'nutritionLog', 'nutrition_log'],
  ['hydration-log', 'hydrationLog', 'hydration_log'],
];

/** Daily types (list, pageSize=1): [type, data field, key in summary] */
const DAILY_SPECS: [string, string, keyof DaySummary][] = [
  ['daily-resting-heart-rate', 'dailyRestingHeartRate', 'resting_heart_rate'],
  ['daily-heart-rate-variability', 'dailyHeartRateVariability', 'heart_rate_variability'],
  ['daily-oxygen-saturation', 'dailyOxygenSaturation', 'oxygen_saturation'],
  ['daily-respiratory-rate', 'dailyRespiratoryRate', 'respiratory_rate'],
  ['daily-sleep-temperature-derivations', 'dailySleepTemperatureDerivations', 'sleep_temperature'],
  ['daily-vo2-max', 'dailyVo2Max', 'daily_vo2_max'],
  ['daily-heart-rate-zones', 'dailyHeartRateZones', 'daily_heart_rate_zones'],
];

/** Raw samples for the day (list, pageSize=1, civil_time): [type, field, key] */
const SAMPLE_SPECS: [string, string, keyof DaySummary][] = [
  ['vo2-max', 'vo2Max', 'vo2_max'],
  ['heart-rate-variability', 'heartRateVariability', 'hrv_sample'],
  ['oxygen-saturation', 'oxygenSaturation', 'spo2_sample'],
  ['respiratory-rate-sleep-summary', 'respiratoryRateSleepSummary', 'respiratory_rate_sleep'],
];

const BATCH_SIZE = 10;

async function runBatched(tasks: (() => Promise<void>)[]): Promise<void> {
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    await Promise.all(tasks.slice(i, i + BATCH_SIZE).map((t) => t()));
  }
}

/**
 * A single metric failure is not a summary failure (field is simply absent, like in Rust).
 * But if ALL requests failed — it's almost certainly a dead token/network, and this
 * must be propagated up (502), not returned as an empty summary with status 200.
 */
function makeErrorSink(errors: unknown[]): (e: unknown) => void {
  return (e) => {
    errors.push(e);
  };
}

export async function buildSummary(
  date: string,
  client: SummaryClient,
): Promise<DaySummary> {
  const next = nextDay(date);
  const summary: DaySummary = { date };

  const tasks: (() => Promise<void>)[] = [];
  const errors: unknown[] = [];
  const onFail = makeErrorSink(errors);

  // ── Rollups (dailyRollUp, 1-day window) ──
  for (const [dt, field, key] of ROLLUP_SPECS) {
    tasks.push(async () => {
      try {
        const v = await client.dailyRollUp(dt, date, next);
        const val = v.rollupDataPoints?.[0]?.[field];
        if (val !== undefined && val !== null) {
          (summary as unknown as Record<string, unknown>)[key] = val;
        }
      } catch (e) {
        /* no data or API error — field absent */
        onFail(e);
      }
    });
  }

  // ── Daily types (list with {snake}.date filter) ──
  for (const [dt, field, key] of DAILY_SPECS) {
    tasks.push(async () => {
      try {
        const v = await client.list(dt, buildDayFilter(dt, date), 1);
        const val = v.dataPoints?.[0]?.[field];
        if (val !== undefined && val !== null) {
          (summary as unknown as Record<string, unknown>)[key] = val;
        }
      } catch (e) {
        onFail(e);
      }
    });
  }

  // ── Raw samples (civil_time) ──
  for (const [dt, field, key] of SAMPLE_SPECS) {
    tasks.push(async () => {
      try {
        const v = await client.list(dt, buildDayFilter(dt, date), 1);
        const val = v.dataPoints?.[0]?.[field];
        if (val !== undefined && val !== null) {
          (summary as unknown as Record<string, unknown>)[key] = val;
        }
      } catch (e) {
        onFail(e);
      }
    });
  }

  // ── Sleep (full, with stages) ──
  tasks.push(async () => {
    try {
      const v = await client.list('sleep', buildDayFilter('sleep', date), 25);
      const sleeps = (v.dataPoints ?? [])
        .map((p) => p.sleep as Record<string, unknown> | undefined)
        .filter((s): s is Record<string, unknown> => Boolean(s))
        .map((s) => {
          const interval = (s.interval ?? {}) as Record<string, unknown>;
          return {
            start: (interval.startTime as string) ?? null,
            end: (interval.endTime as string) ?? null,
            startUtcOffset: (interval.startUtcOffset as string) ?? null,
            endUtcOffset: (interval.endUtcOffset as string) ?? null,
            type: (s.type as string) ?? null,
            stages: (s.stages as SleepStage[] | undefined) ?? null,
            summary: (s.summary as SleepSummary | undefined) ?? null,
            metadata: s.metadata ?? null,
          };
        });
      if (sleeps.length > 0) summary.sleep = sleeps;
    } catch (e) {
      onFail(e);
    }
  });

  // ── Exercise sessions (full) ──
  tasks.push(async () => {
    try {
      const v = await client.list('exercise', buildDayFilter('exercise', date), 25);
      const exercises = (v.dataPoints ?? [])
        .map((p) => {
          const e = p.exercise as Record<string, unknown> | undefined;
          if (!e) return null;
          const interval = (e.interval ?? {}) as Record<string, unknown>;
          return {
            // Data point ID — last segment of resource name (for TCX export)
            id:
              typeof p.name === 'string' && p.name
                ? (p.name.split('/').pop() ?? null)
                : null,
            type: (e.exerciseType as string) ?? null,
            name: (e.displayName as string) ?? (e.title as string) ?? null,
            start: (interval.startTime as string) ?? null,
            end: (interval.endTime as string) ?? null,
            startUtcOffset: (interval.startUtcOffset as string) ?? null,
            endUtcOffset: (interval.endUtcOffset as string) ?? null,
            duration: (e.activeDuration as string) ?? null,
            metrics: (e.metricsSummary as ExerciseMetrics | undefined) ?? null,
            metadata: e.exerciseMetadata ?? null,
          };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);
      if (exercises.length > 0) summary.exercise = exercises;
    } catch (e) {
      onFail(e);
    }
  });

  // ── Activity levels (interval, up to 50 points) ──
  tasks.push(async () => {
    try {
      const f =
        `activity_level.interval.start_time >= "${date}T00:00:00Z" AND ` +
        `activity_level.interval.start_time < "${next}T00:00:00Z"`;
      const v = await client.list('activity-level', f, 50);
      const levels = (v.dataPoints ?? [])
        .map((p) => p.activityLevel)
        .filter((l): l is Record<string, unknown> => l !== undefined && l !== null);
      if (levels.length > 0) summary.activity_levels = levels;
    } catch (e) {
      onFail(e);
    }
  });

  await runBatched(tasks);

  if (errors.length >= tasks.length) {
    // All requests failed → account/network level problem (dead token).
    // We propagate outward: route will return 502, and empty result won't be cached.
    const gh = errors.find((e) => e instanceof GhError);
    throw gh ?? errors[0] ?? new GhError('summary: all requests failed', 502);
  }

  return summary;
}
