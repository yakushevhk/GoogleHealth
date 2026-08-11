export interface DataTypeInfo {
  id: string;
  filter_name: string;
  category: string;
  listable: boolean;
  rollup: boolean;
  daily_rollup: boolean;
  writable: boolean;
  reconcilable: boolean;
  time_field: string;
  page_cap: number;
  rollup_range_days: number;
  description: string;
  key_fields: string[];
  gotchas: string[];
}

const t = (
  id: string, category: string, time_field: string,
  opts: Partial<Pick<DataTypeInfo, "listable"|"rollup"|"daily_rollup"|"writable"|"reconcilable"|"page_cap"|"rollup_range_days">> = {},
  description = "", key_fields: string[] = [], gotchas: string[] = [],
): DataTypeInfo => ({
  id,
  filter_name: id.replace(/-/g, "_"),
  category,
  listable: opts.listable ?? true,
  rollup: opts.rollup ?? false,
  daily_rollup: opts.daily_rollup ?? false,
  writable: opts.writable ?? false,
  reconcilable: opts.reconcilable ?? true,
  time_field,
  page_cap: opts.page_cap ?? 10000,
  rollup_range_days: opts.rollup_range_days ?? 90,
  description,
  key_fields,
  gotchas,
});

export const DATA_TYPES: DataTypeInfo[] = [
  // Interval types
  t("steps", "activity", "interval_start", { rollup: true, daily_rollup: true }, "Step counts over time intervals.", ["countSum"], ["list returns intervals WITHOUT values; use dailyRollUp for totals"]),
  t("active-energy-burned", "activity", "interval_start", { rollup: true, daily_rollup: true }, "Active (exercise) calories burned over intervals.", ["kcalSum"], ["list returns intervals WITHOUT values; use rollUp/dailyRollUp for kcalSum"]),
  t("distance", "activity", "interval_start", { rollup: true, daily_rollup: true }, "Distance travelled over intervals (millimeters).", ["millimetersSum"], ["values are in millimeters; divide by 1_000_000 for km"]),
  t("active-minutes", "activity", "interval_start", { rollup: true, daily_rollup: true, rollup_range_days: 14 }, "Active minutes bucketed by activity level.", ["activeMinutesRollupByActivityLevel"], ["14-day rollup range limit"]),
  t("active-zone-minutes", "activity", "interval_start", { rollup: true, daily_rollup: true }, "Minutes spent in fat-burn / cardio / peak heart-rate zones.", ["sumInFatBurnHeartZone", "sumInCardioHeartZone", "sumInPeakHeartZone"]),
  t("activity-level", "activity", "interval_start", { rollup: true, daily_rollup: true }, "Discrete activity-level segments (still, walking, running, ...).", ["activityLevel"]),
  t("altitude", "activity", "interval_start", { rollup: true, daily_rollup: true }, "Altitude readings over intervals (meters).", ["metersAvg", "metersMax", "metersMin"]),
  t("sedentary-period", "activity", "interval_start", { rollup: true, daily_rollup: true }, "Continuous sedentary (inactive) periods.", ["interval"]),
  t("swim-lengths-data", "activity", "interval_start", { rollup: true, daily_rollup: true }, "Swim pool-length counts per interval.", ["swimLengthsSum"]),
  t("time-in-heart-rate-zone", "activity", "interval_start", { rollup: true, daily_rollup: true }, "Time spent in each heart-rate zone.", ["timeInHeartRateZone"]),
  // Sample types
  t("heart-rate", "cardiac", "sample_physical", { rollup: true, daily_rollup: true, rollup_range_days: 14 }, "Instantaneous heart-rate samples (BPM).", ["beatsPerMinute", "beatsPerMinuteAvg", "beatsPerMinuteMax", "beatsPerMinuteMin"], ["14-day rollup range limit"]),
  t("weight", "body", "sample_physical", { rollup: true, daily_rollup: true, writable: true }, "Body weight samples (kilograms).", ["kilograms"], ["writable via add_weight_sample"]),
  t("height", "body", "sample_physical", {}, "Height samples (meters).", ["meters"], ["no rollUp support"]),
  t("body-fat", "body", "sample_physical", { rollup: true, daily_rollup: true }, "Body fat percentage samples.", ["percentage"]),
  t("blood-glucose", "nutrition", "sample_physical", { rollup: true, daily_rollup: true }, "Blood glucose samples.", ["millimolesPerLiter", "milligramsPerDeciliter"], ["unit depends on user settings"]),
  t("core-body-temperature", "temperature", "sample_physical", { rollup: true, daily_rollup: true }, "Core body temperature samples (Celsius).", ["celsius"]),
  t("heart-rate-variability", "cardiac", "sample_physical", {}, "HRV (RMSSD) samples in milliseconds.", ["rootMeanSquareOfSuccessiveDifferencesMilliseconds"], ["no rollUp support; use daily-heart-rate-variability for daily aggregates"]),
  t("oxygen-saturation", "oxygen", "sample_physical", {}, "Blood oxygen saturation (SpO2) samples, percentage.", ["percentage"], ["no rollUp support; use daily-oxygen-saturation for daily aggregates"]),
  t("respiratory-rate-sleep-summary", "respiratory", "sample_physical", {}, "Per-sleep-stage respiratory rate summary (breaths/min).", ["breathsPerMinuteDeepSleep", "breathsPerMinuteLightSleep", "breathsPerMinuteRemSleep"], ["no rollUp support"]),
  t("vo2-max", "activity", "sample_physical", {}, "VO2 max samples (ml/min/kg).", ["millilitersPerMinuteKilogramMax"], ["no rollUp support; use daily-vo2-max for daily aggregates"]),
  t("run-vo2-max", "activity", "sample_physical", { rollup: true, daily_rollup: true }, "Running-specific VO2 max samples (ml/min/kg).", ["millilitersPerMinuteKilogramMax"]),
  // Daily types
  t("daily-resting-heart-rate", "cardiac", "daily", {}, "Daily resting heart rate (BPM).", ["beatsPerMinute"], ["already daily; filter on .date (YYYY-MM-DD)"]),
  t("daily-heart-rate-variability", "cardiac", "daily", {}, "Daily HRV aggregate (RMSSD avg, ms).", ["rootMeanSquareOfSuccessiveDifferencesMillisecondsAvg"], ["already daily; filter on .date (YYYY-MM-DD)"]),
  t("daily-heart-rate-zones", "cardiac", "daily", {}, "Daily time-in-heart-rate-zone aggregate.", ["timeInHeartRateZone"], ["already daily; filter on .date (YYYY-MM-DD)"]),
  t("daily-oxygen-saturation", "oxygen", "daily", {}, "Daily SpO2 aggregate (percentage avg).", ["percentageAvg"], ["already daily; filter on .date (YYYY-MM-DD)"]),
  t("daily-respiratory-rate", "respiratory", "daily", {}, "Daily respiratory rate aggregate (breaths/min).", ["breathsPerMinuteAvg"], ["already daily; filter on .date (YYYY-MM-DD)"]),
  t("daily-sleep-temperature-derivations", "sleep", "daily", {}, "Nightly skin/sleep temperature deviation from baseline (Celsius).", ["deviationFromBaselineCelsius"], ["already daily; filter on .date (YYYY-MM-DD)"]),
  t("daily-vo2-max", "activity", "daily", {}, "Daily VO2 max aggregate (ml/min/kg).", ["millilitersPerMinuteKilogramMax"], ["already daily; filter on .date (YYYY-MM-DD)"]),
  // Session types
  t("sleep", "sleep", "interval_end", { writable: true, page_cap: 25 }, "Sleep sessions with stages and summary.", ["stages", "minutesAsleep", "minutesInSleepPeriod", "sleepType"], ["page size capped at 25", "filter on sleep.interval.end_time (or civil_end_time), not start_time"]),
  t("exercise", "activity", "interval_civil_start", { writable: true, page_cap: 25 }, "Exercise sessions with type, duration, and metrics.", ["exerciseType", "metrics", "duration"], ["page size capped at 25", "filter uses exercise.interval.civil_start_time (date)", "exportable to TCX via export_exercise_tcx"]),
  t("hydration-log", "nutrition", "interval_civil_start", { rollup: true, daily_rollup: true, writable: true }, "Hydration events (time only).", ["interval"], ["API v4 does not support volume recording; time only", "filter uses hydration_log.interval.civil_start_time (date)"]),
  t("nutrition-log", "nutrition", "interval_civil_start", { rollup: true, daily_rollup: true, writable: true }, "Meal events (meal type and time only).", ["mealType", "interval"], ["API v4 does not support nutrient recording; meal type and time only", "filter uses nutrition_log.interval.civil_start_time (date)"]),
  t("irregular-rhythm-notification", "clinical", "interval_civil_start", {}, "Irregular rhythm (AFib) notification events.", ["interval"], ["filter uses irregular_rhythm_notification.interval.civil_start_time (date)"]),
  t("electrocardiogram", "clinical", "interval_start", {}, "ECG recordings with classification and signal.", ["classification", "signal"], ["filter supports >= only, no upper bound"]),
  // Reference catalogs
  t("food", "nutrition", "none", { reconcilable: false }, "Reference catalog of foods.", ["foodName"], ["reference catalog, no time filter"]),
  t("food-measurement-unit", "nutrition", "none", { reconcilable: false }, "Reference catalog of food measurement units.", ["measurementUnit"], ["reference catalog, no time filter"]),
  // Rollup-only
  t("floors", "activity", "interval_start", { listable: false, rollup: true, daily_rollup: true, reconcilable: false }, "Floors climbed aggregates.", ["floorsSum"], ["rollup-only, no list support"]),
  t("total-calories", "nutrition", "interval_start", { listable: false, rollup: true, daily_rollup: true, reconcilable: false, rollup_range_days: 14 }, "Total (resting + active) calories burned aggregates.", ["kcalSum"], ["rollup-only, no list support", "14-day rollup range limit"]),
  t("calories-in-heart-rate-zone", "cardiac", "interval_start", { listable: false, rollup: true, daily_rollup: true, reconcilable: false, rollup_range_days: 14 }, "Calories burned per heart-rate zone aggregates.", ["caloriesInHeartRateZone"], ["rollup-only, no list support", "14-day rollup range limit"]),
];

export function findType(id: string): DataTypeInfo | undefined {
  return DATA_TYPES.find((t) => t.id === id);
}

export function categories(): string[] {
  const seen: string[] = [];
  for (const t of DATA_TYPES) if (!seen.includes(t.category)) seen.push(t.category);
  return seen;
}
