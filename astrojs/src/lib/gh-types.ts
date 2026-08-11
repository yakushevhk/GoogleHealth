/**
 * Google Health API v4 data types (39 total) and TS response types.
 *
 * Filters use snake_case (heart_rate),
 * while data_type uses kebab-case (heart-rate).
 */

// ─── Data type categories ──────────────────────────────────────────────────

/** Interval types: filter `{snake}.interval.start_time` (RFC3339). */
export const INTERVAL_TYPES = [
  'steps',
  'active-energy-burned',
  'distance',
  'active-minutes',
  'active-zone-minutes',
  'activity-level',
  'altitude',
  'sedentary-period',
  'swim-lengths-data',
  'time-in-heart-rate-zone',
] as const;

/** Sample types (physical_time): filter `{snake}.sample_time.physical_time`. */
export const SAMPLE_PHYSICAL_TYPES = [
  'heart-rate',
  'weight',
  'height',
  'body-fat',
  'blood-glucose',
  'core-body-temperature',
  'run-vo2-max',
] as const;

/** Sample types (civil_time): filter `{snake}.sample_time.civil_time`. */
export const SAMPLE_CIVIL_TYPES = [
  'vo2-max',
  'heart-rate-variability',
  'oxygen-saturation',
  'respiratory-rate-sleep-summary',
] as const;

/** Daily types: filter `{snake}.date` (YYYY-MM-DD). */
export const DAILY_TYPES = [
  'daily-resting-heart-rate',
  'daily-heart-rate-variability',
  'daily-heart-rate-zones',
  'daily-oxygen-saturation',
  'daily-respiratory-rate',
  'daily-sleep-temperature-derivations',
  'daily-vo2-max',
] as const;

/** Session types with special filters. */
export const SESSION_TYPES = [
  'sleep', // sleep.interval.civil_end_time
  'exercise', // exercise.interval.civil_start_time
  'hydration-log', // hydration_log.interval.civil_start_time
  'nutrition-log', // nutrition_log.interval.civil_start_time
  'irregular-rhythm-notification', // irregular_rhythm_notification.interval.civil_start_time
  'electrocardiogram', // electrocardiogram.interval.start_time (only >=)
] as const;

/** Types without filter support. */
export const NO_FILTER_TYPES = ['food', 'food-measurement-unit'] as const;

/** rollUp/dailyRollUp only, no list. */
export const ROLLUP_ONLY_TYPES = [
  'floors',
  'calories-in-heart-rate-zone',
  'total-calories',
] as const;

export type DataType =
  | (typeof INTERVAL_TYPES)[number]
  | (typeof SAMPLE_PHYSICAL_TYPES)[number]
  | (typeof SAMPLE_CIVIL_TYPES)[number]
  | (typeof DAILY_TYPES)[number]
  | (typeof SESSION_TYPES)[number]
  | (typeof NO_FILTER_TYPES)[number]
  | (typeof ROLLUP_ONLY_TYPES)[number];

export const ALL_DATA_TYPES: readonly string[] = [
  ...INTERVAL_TYPES,
  ...SAMPLE_PHYSICAL_TYPES,
  ...SAMPLE_CIVIL_TYPES,
  ...DAILY_TYPES,
  ...SESSION_TYPES,
  ...NO_FILTER_TYPES,
  ...ROLLUP_ONLY_TYPES,
];

/** Types that support list (all except rollup-only). */
export const LISTABLE_TYPES: readonly string[] = ALL_DATA_TYPES.filter(
  (t) => !(ROLLUP_ONLY_TYPES as readonly string[]).includes(t),
);

/** Types that support rollUp/dailyRollUp. */
export const ROLLUP_TYPES: readonly string[] = [
  'steps',
  'heart-rate',
  'active-energy-burned',
  'distance',
  'weight',
  'altitude',
  'body-fat',
  'floors',
  'total-calories',
  'active-zone-minutes',
  'sedentary-period',
  'run-vo2-max',
  'calories-in-heart-rate-zone',
  'nutrition-log',
  'hydration-log',
  'time-in-heart-rate-zone',
  'active-minutes',
  'swim-lengths-data',
  'core-body-temperature',
  'blood-glucose',
  // Google API supports rollUp for activity-level (types.rs registry):
  // rollupBy-minutes per levels STILL/LOW/MODERATE/HIGH.
  'activity-level',
];

/**
 * rollUp range limit: 14 days for these types, 90 for the rest.
 */
export const ROLLUP_14DAY_TYPES = [
  'heart-rate',
  'active-minutes',
  'total-calories',
  'calories-in-heart-rate-zone',
];

export function isDataType(t: string): t is DataType {
  return (ALL_DATA_TYPES as readonly string[]).includes(t);
}

// ─── API responses ──────────────────────────────────────────────────────────

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export interface RollupPoint {
  /** civilStartTime: RFC3339 string in rollUp, {date,time} object in dailyRollUp */
  civilStartTime?: string | { date?: CivilDate; time?: unknown };
  civilEndTime?: string | { date?: CivilDate; time?: unknown };
  startTime?: string;
  endTime?: string;
  /** Aggregation field: steps, heartRate, distance, ... (depends on type) */
  [field: string]: unknown;
}

export interface RollupResponse {
  rollupDataPoints?: RollupPoint[];
  nextPageToken?: string;
}

export interface ListResponse {
  dataPoints?: Record<string, unknown>[];
  nextPageToken?: string;
}

/** Real GET /profile (v4) body: no name — resource, age, step length. */
export interface Profile {
  /** "users/{id}/profile" */
  name?: string;
  age?: number;
  membershipStartDate?: CivilDate;
  userConfiguredWalkingStrideLengthMm?: number;
  userConfiguredRunningStrideLengthMm?: number;
}

export interface PairedDevice {
  /** Full resource name: users/me/pairedDevices/{id} */
  name?: string;
  deviceType?: string;
  /** Human-readable device name, e.g. "Fitbit Air" */
  deviceVersion?: string;
  batteryLevel?: number;
  batteryStatus?: string;
  macAddress?: string;
  features?: string[];
  // fallback fields for other devices/API versions
  deviceId?: string;
  deviceDisplayName?: string;
  manufacturer?: string;
  model?: string;
  lastSyncTime?: string;
}

// ─── Daily summary (response shape of /api/summary = MCP tool today shape) ───

export interface SleepStage {
  startTime: string;
  startUtcOffset?: string;
  endTime: string;
  endUtcOffset?: string;
  type: 'AWAKE' | 'LIGHT' | 'DEEP' | 'REM' | 'ASLEEP' | 'OUT_OF_BED';
}

export interface SleepSummary {
  minutesInSleepPeriod?: string;
  minutesAfterWakeUp?: string;
  minutesToFallAsleep?: string;
  minutesAsleep?: string;
  minutesAwake?: string;
  stagesSummary?: { type: string; minutes: string; count: string }[];
}

export interface SleepSession {
  start: string | null;
  end: string | null;
  startUtcOffset: string | null;
  endUtcOffset: string | null;
  type: string | null;
  stages: SleepStage[] | null;
  summary: SleepSummary | null;
  metadata: unknown;
}

export interface ExerciseMetrics {
  caloriesKcal?: number;
  distanceMillimeters?: number;
  steps?: string;
  averagePaceSecondsPerMeter?: number;
  averageHeartRateBeatsPerMinute?: string;
  activeZoneMinutes?: string;
  heartRateZoneDurations?: {
    lightTime?: string;
    moderateTime?: string;
    vigorousTime?: string;
    peakTime?: string;
  };
}

export interface ExerciseSession {
  /** Data point ID (last segment of resource name) — for TCX export. */
  id: string | null;
  type: string | null;
  name: string | null;
  start: string | null;
  end: string | null;
  startUtcOffset: string | null;
  endUtcOffset: string | null;
  duration: string | null;
  metrics: ExerciseMetrics | null;
  metadata: unknown;
  dataSource?: unknown;
}

export interface DaySummary {
  date: string;
  steps?: { countSum?: string };
  heart_rate?: {
    beatsPerMinuteAvg?: number;
    beatsPerMinuteMax?: number;
    beatsPerMinuteMin?: number;
  };
  resting_heart_rate?: { beatsPerMinute?: string };
  active_calories?: { kcalSum?: number };
  total_calories?: { kcalSum?: number };
  distance?: { millimetersSum?: string };
  active_minutes?: unknown;
  active_zone_minutes?: {
    sumInFatBurnHeartZone?: string;
    sumInCardioHeartZone?: string;
    sumInPeakHeartZone?: string;
  };
  time_in_heart_rate_zone?: unknown;
  calories_in_heart_rate_zone?: unknown;
  floors?: { countSum?: string };
  sleep?: SleepSession[];
  exercise?: ExerciseSession[];
  heart_rate_variability?: Record<string, unknown>;
  hrv_sample?: Record<string, unknown>;
  oxygen_saturation?: Record<string, unknown>;
  spo2_sample?: { percentage?: number };
  respiratory_rate?: Record<string, unknown>;
  respiratory_rate_sleep?: Record<string, unknown>;
  sleep_temperature?: Record<string, unknown>;
  daily_vo2_max?: Record<string, unknown>;
  run_vo2_max?: unknown;
  vo2_max?: Record<string, unknown>;
  weight_rollup?: { weightGramsAvg?: number };
  body_fat?: { percentageAvg?: number };
  blood_glucose?: Record<string, unknown>;
  core_body_temperature?: Record<string, unknown>;
  altitude?: Record<string, unknown>;
  swim_lengths?: { strokeCountSum?: string };
  sedentary_period?: { durationSum?: string };
  nutrition_log?: Record<string, unknown>;
  hydration_log?: Record<string, unknown>;
  activity_levels?: Record<string, unknown>[];
  daily_heart_rate_zones?: Record<string, unknown>;
}
