/**
 * AIP-160 filter builder for Google Health API by data type.
 * Exact reproduction of the syntax from GoogleHealth/src/tools.rs:
 * filters use snake_case, dates are civil (YYYY-MM-DD) or RFC3339.
 */
import {
  DAILY_TYPES,
  INTERVAL_TYPES,
  NO_FILTER_TYPES,
  ROLLUP_ONLY_TYPES,
  SAMPLE_CIVIL_TYPES,
  SAMPLE_PHYSICAL_TYPES,
  type DataType,
} from './gh-types';

export function kebabToSnake(s: string): string {
  return s.replaceAll('-', '_');
}

export function isDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Strict RFC3339 timestamp (2026-08-04T12:34:56Z / +03:00, fractional seconds optional). */
export function isRfc3339(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s);
}

/** Next day (replicates next_day from tools.rs, given a valid input date). */
export function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  const daysInMonth = (yy: number, mm: number): number => {
    switch (mm) {
      case 1: case 3: case 5: case 7: case 8: case 10: case 12:
        return 31;
      case 4: case 6: case 9: case 11:
        return 30;
      case 2:
        return (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0 ? 29 : 28;
      default:
        return 30;
    }
  };
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d < daysInMonth(y, m)) return `${y}-${pad(m)}-${pad(d + 1)}`;
  if (m < 12) return `${y}-${pad(m + 1)}-01`;
  return `${y + 1}-01-01`;
}

/** Shift date by n days (for the history endpoint). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Today's date in local time (like chrono::Local in Rust). */
export function todayLocal(now = new Date()): string {
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Client timezone offset in minutes (as Date.getTimezoneOffset: UTC-local,
 * -180 for UTC+3). Passed to /api/intraday so that rollUp windows align
 * to the user's civil day rather than UTC midnight.
 */
export function localOffsetMin(now = new Date()): number {
  return now.getTimezoneOffset();
}

/**
 * "Full day [date, date+1)" filter for a data type.
 *
 * - `null` — type does not support filters (food, food-measurement-unit);
 * - throws Error — type does not support list (floors, total-calories, ...).
 */
export function buildDayFilter(type: DataType | string, date: string): string | null {
  if (!isDate(date)) throw new Error(`Invalid date: ${date}`);
  const next = nextDay(date);
  const snake = kebabToSnake(type);

  if ((NO_FILTER_TYPES as readonly string[]).includes(type)) return null;

  if ((ROLLUP_ONLY_TYPES as readonly string[]).includes(type)) {
    throw new Error(`Type ${type} does not support list — use rollUp/dailyRollUp`);
  }

  if ((INTERVAL_TYPES as readonly string[]).includes(type)) {
    return (
      `${snake}.interval.start_time >= "${date}T00:00:00Z" AND ` +
      `${snake}.interval.start_time < "${next}T00:00:00Z"`
    );
  }

  if ((SAMPLE_PHYSICAL_TYPES as readonly string[]).includes(type)) {
    return (
      `${snake}.sample_time.physical_time >= "${date}T00:00:00Z" AND ` +
      `${snake}.sample_time.physical_time < "${next}T00:00:00Z"`
    );
  }

  if ((SAMPLE_CIVIL_TYPES as readonly string[]).includes(type)) {
    return (
      `${snake}.sample_time.civil_time >= "${date}" AND ` +
      `${snake}.sample_time.civil_time < "${next}"`
    );
  }

  if ((DAILY_TYPES as readonly string[]).includes(type)) {
    return `${snake}.date >= "${date}" AND ${snake}.date < "${next}"`;
  }

  switch (type) {
    case 'sleep':
      return `sleep.interval.civil_end_time >= "${date}" AND sleep.interval.civil_end_time < "${next}"`;
    case 'exercise':
      return `exercise.interval.civil_start_time >= "${date}" AND exercise.interval.civil_start_time < "${next}"`;
    case 'hydration-log':
      return `hydration_log.interval.civil_start_time >= "${date}" AND hydration_log.interval.civil_start_time < "${next}"`;
    case 'nutrition-log':
      return `nutrition_log.interval.civil_start_time >= "${date}" AND nutrition_log.interval.civil_start_time < "${next}"`;
    case 'irregular-rhythm-notification':
      return `irregular_rhythm_notification.interval.civil_start_time >= "${date}" AND irregular_rhythm_notification.interval.civil_start_time < "${next}"`;
    case 'electrocardiogram':
      // ECG only supports the >= operator
      return `electrocardiogram.interval.start_time >= "${date}T00:00:00Z"`;
  }

  throw new Error(`Unknown data type: ${type}`);
}

/**
 * Date range filter [start, end) for daily types and session types
 * (civil dates). Used in /api/history for daily-* types.
 */
export function buildRangeFilter(type: DataType | string, start: string, end: string): string {
  if (!isDate(start) || !isDate(end)) throw new Error('Invalid date range');
  const snake = kebabToSnake(type);
  if ((DAILY_TYPES as readonly string[]).includes(type)) {
    return `${snake}.date >= "${start}" AND ${snake}.date < "${end}"`;
  }
  if (type === 'sleep') {
    return `sleep.interval.civil_end_time >= "${start}" AND sleep.interval.civil_end_time < "${end}"`;
  }
  if (
    type === 'exercise' ||
    type === 'hydration-log' ||
    type === 'nutrition-log' ||
    type === 'irregular-rhythm-notification'
  ) {
    return `${snake}.interval.civil_start_time >= "${start}" AND ${snake}.interval.civil_start_time < "${end}"`;
  }
  throw new Error(`buildRangeFilter: unsupported type ${type}`);
}

/**
 * Range filter for sample types with civil_time (HRV, SpO2, ...):
 * `{snake}.sample_time.civil_time >= "start" AND < "end"`.
 */
export function buildSampleRangeFilter(type: DataType | string, start: string, end: string): string {
  if (!isDate(start) || !isDate(end)) throw new Error('Invalid date range');
  if (!(SAMPLE_CIVIL_TYPES as readonly string[]).includes(type)) {
    throw new Error(`buildSampleRangeFilter: ${type} is not a sample-civil type`);
  }
  const snake = kebabToSnake(type);
  return `${snake}.sample_time.civil_time >= "${start}" AND ${snake}.sample_time.civil_time < "${end}"`;
}

/** URL-encode a filter (replicates urlenc from tools.rs + encodeURIComponent). */
export function encodeFilter(f: string): string {
  return encodeURIComponent(f);
}

/**
 * Delta-sync filter for the reconcile endpoint. Exact reproduction of
 * SyncDataPoints::build_filter from GoogleHealth/src/tools.rs: each type
 * category has its own time field, and civil fields take only the date part
 * (first 10 chars) of an RFC3339 timestamp. The generic `update_time` filter
 * is rejected by the API — this is why /api/sync needs a type-specific one.
 */
const SYNC_SESSION_CIVIL_TYPES = [
  'exercise',
  'hydration-log',
  'nutrition-log',
  'irregular-rhythm-notification',
];

const SYNC_SAMPLE_PHYSICAL_TYPES = [
  'heart-rate',
  'weight',
  'height',
  'body-fat',
  'blood-glucose',
  'core-body-temperature',
  'heart-rate-variability',
  'oxygen-saturation',
  'respiratory-rate-sleep-summary',
  'vo2-max',
  'run-vo2-max',
];

export function buildSyncFilter(dataType: string, sinceTime: string, untilTime?: string): string {
  const snake = kebabToSnake(dataType);
  const civilDate = (t: string) => t.slice(0, 10);

  let filter: string;
  if (dataType === 'sleep') {
    filter = `sleep.interval.end_time >= "${sinceTime}"`;
  } else if (SYNC_SESSION_CIVIL_TYPES.includes(dataType)) {
    filter = `${snake}.interval.civil_start_time >= "${civilDate(sinceTime)}"`;
  } else if ((DAILY_TYPES as readonly string[]).includes(dataType)) {
    filter = `${snake}.date >= "${civilDate(sinceTime)}"`;
  } else if (SYNC_SAMPLE_PHYSICAL_TYPES.includes(dataType)) {
    filter = `${snake}.sample_time.physical_time >= "${sinceTime}"`;
  } else if (dataType === 'electrocardiogram') {
    filter = `electrocardiogram.interval.start_time >= "${sinceTime}"`;
  } else {
    filter = `${snake}.interval.start_time >= "${sinceTime}"`;
  }

  if (untilTime) {
    let addUntil: string;
    if (dataType === 'sleep') {
      addUntil = ` AND sleep.interval.end_time < "${untilTime}"`;
    } else if (SYNC_SESSION_CIVIL_TYPES.includes(dataType)) {
      addUntil = ` AND ${snake}.interval.civil_start_time < "${civilDate(untilTime)}"`;
    } else if ((DAILY_TYPES as readonly string[]).includes(dataType)) {
      addUntil = ` AND ${snake}.date < "${civilDate(untilTime)}"`;
    } else if (SYNC_SAMPLE_PHYSICAL_TYPES.includes(dataType)) {
      addUntil = ` AND ${snake}.sample_time.physical_time < "${untilTime}"`;
    } else if (dataType === 'electrocardiogram') {
      // ECG only supports >= filters; no upper bound.
      addUntil = '';
    } else {
      addUntil = ` AND ${snake}.interval.start_time < "${untilTime}"`;
    }
    filter += addUntil;
  }

  return filter;
}
