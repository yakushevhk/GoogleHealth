import { describe, expect, it } from 'vitest';
import {
  addDays,
  buildDayFilter,
  buildRangeFilter,
  buildSyncFilter,
  isDate,
  isRfc3339,
  kebabToSnake,
  nextDay,
  todayLocal,
} from '@lib/filters';
import {
  ALL_DATA_TYPES,
  DAILY_TYPES,
  INTERVAL_TYPES,
  NO_FILTER_TYPES,
  ROLLUP_ONLY_TYPES,
  SAMPLE_CIVIL_TYPES,
  SAMPLE_PHYSICAL_TYPES,
} from '@lib/gh-types';

const DATE = '2026-07-22';
const NEXT = '2026-07-23';

describe('ALL_DATA_TYPES', () => {
  it('contains exactly 39 unique types', () => {
    expect(new Set(ALL_DATA_TYPES).size).toBe(39);
    expect(ALL_DATA_TYPES.length).toBe(39);
  });
});

describe('buildDayFilter — interval types', () => {
  it.each(INTERVAL_TYPES)('%s → {snake}.interval.start_time RFC3339', (type) => {
    const snake = kebabToSnake(type);
    expect(buildDayFilter(type, DATE)).toBe(
      `${snake}.interval.start_time >= "${DATE}T00:00:00Z" AND ` +
        `${snake}.interval.start_time < "${NEXT}T00:00:00Z"`,
    );
  });
});

describe('buildDayFilter — sample types (physical_time)', () => {
  it.each(SAMPLE_PHYSICAL_TYPES)('%s → {snake}.sample_time.physical_time', (type) => {
    const snake = kebabToSnake(type);
    expect(buildDayFilter(type, DATE)).toBe(
      `${snake}.sample_time.physical_time >= "${DATE}T00:00:00Z" AND ` +
        `${snake}.sample_time.physical_time < "${NEXT}T00:00:00Z"`,
    );
  });
});

describe('buildDayFilter — sample types (civil_time)', () => {
  it.each(SAMPLE_CIVIL_TYPES)('%s → {snake}.sample_time.civil_time', (type) => {
    const snake = kebabToSnake(type);
    expect(buildDayFilter(type, DATE)).toBe(
      `${snake}.sample_time.civil_time >= "${DATE}" AND ` +
        `${snake}.sample_time.civil_time < "${NEXT}"`,
    );
  });
});

describe('buildDayFilter — daily types', () => {
  it.each(DAILY_TYPES)('%s → {snake}.date', (type) => {
    const snake = kebabToSnake(type);
    expect(buildDayFilter(type, DATE)).toBe(
      `${snake}.date >= "${DATE}" AND ${snake}.date < "${NEXT}"`,
    );
  });
});

describe('buildDayFilter — session types', () => {
  it('sleep → civil_end_time', () => {
    expect(buildDayFilter('sleep', DATE)).toBe(
      `sleep.interval.civil_end_time >= "${DATE}" AND sleep.interval.civil_end_time < "${NEXT}"`,
    );
  });
  it('exercise → civil_start_time', () => {
    expect(buildDayFilter('exercise', DATE)).toBe(
      `exercise.interval.civil_start_time >= "${DATE}" AND exercise.interval.civil_start_time < "${NEXT}"`,
    );
  });
  it('hydration-log → hydration_log.interval.civil_start_time', () => {
    expect(buildDayFilter('hydration-log', DATE)).toBe(
      `hydration_log.interval.civil_start_time >= "${DATE}" AND hydration_log.interval.civil_start_time < "${NEXT}"`,
    );
  });
  it('nutrition-log → nutrition_log.interval.civil_start_time', () => {
    expect(buildDayFilter('nutrition-log', DATE)).toBe(
      `nutrition_log.interval.civil_start_time >= "${DATE}" AND nutrition_log.interval.civil_start_time < "${NEXT}"`,
    );
  });
  it('irregular-rhythm-notification → civil_start_time', () => {
    expect(buildDayFilter('irregular-rhythm-notification', DATE)).toBe(
      `irregular_rhythm_notification.interval.civil_start_time >= "${DATE}" AND irregular_rhythm_notification.interval.civil_start_time < "${NEXT}"`,
    );
  });
  it('electrocardiogram — >= only', () => {
    expect(buildDayFilter('electrocardiogram', DATE)).toBe(
      `electrocardiogram.interval.start_time >= "${DATE}T00:00:00Z"`,
    );
  });
});

describe('buildDayFilter — special cases', () => {
  it.each(NO_FILTER_TYPES)('%s → null (no filters)', (type) => {
    expect(buildDayFilter(type, DATE)).toBeNull();
  });
  it.each(ROLLUP_ONLY_TYPES)('%s → error (no list)', (type) => {
    expect(() => buildDayFilter(type, DATE)).toThrow(/rollUp/);
  });
  it('unknown type → error', () => {
    expect(() => buildDayFilter('no-such-type', DATE)).toThrow(/Unknown data type/);
  });
  it('invalid date → error', () => {
    expect(() => buildDayFilter('steps', '22.07.2026')).toThrow(/Invalid date/);
  });
});

describe('nextDay', () => {
  it('ordinary day', () => expect(nextDay('2026-07-22')).toBe('2026-07-23'));
  it('end of month', () => expect(nextDay('2026-07-31')).toBe('2026-08-01'));
  it('end of year', () => expect(nextDay('2026-12-31')).toBe('2027-01-01'));
  it('leap year february', () => expect(nextDay('2028-02-28')).toBe('2028-02-29'));
  it('non-leap year february', () => expect(nextDay('2026-02-28')).toBe('2026-03-01'));
});

describe('addDays', () => {
  it('back across month boundary', () => {
    expect(addDays('2026-07-01', -6)).toBe('2026-06-25');
  });
  it('forward', () => expect(addDays('2026-12-30', 3)).toBe('2027-01-02'));
});

describe('isDate / todayLocal', () => {
  it('valid and invalid dates', () => {
    expect(isDate('2026-07-22')).toBe(true);
    expect(isDate('2026-7-22')).toBe(false);
    expect(isDate('')).toBe(false);
  });
  it('todayLocal — YYYY-MM-DD format', () => {
    expect(todayLocal(new Date(2026, 6, 22))).toBe('2026-07-22');
  });
});

describe('buildRangeFilter', () => {
  it('daily type', () => {
    expect(buildRangeFilter('daily-vo2-max', '2026-06-23', '2026-07-23')).toBe(
      'daily_vo2_max.date >= "2026-06-23" AND daily_vo2_max.date < "2026-07-23"',
    );
  });
  it('sleep', () => {
    expect(buildRangeFilter('sleep', '2026-07-01', '2026-07-08')).toBe(
      'sleep.interval.civil_end_time >= "2026-07-01" AND sleep.interval.civil_end_time < "2026-07-08"',
    );
  });
  it('unsupported type → error', () => {
    expect(() => buildRangeFilter('steps', '2026-07-01', '2026-07-08')).toThrow();
  });
});

// Parity with test_sync_data_points_build_filter from GoogleHealth/src/tools.rs
describe('buildSyncFilter', () => {
  it('heart-rate → sample_time.physical_time', () => {
    expect(buildSyncFilter('heart-rate', '2026-07-26T00:00:00Z')).toBe(
      'heart_rate.sample_time.physical_time >= "2026-07-26T00:00:00Z"',
    );
  });
  it('steps with until → interval.start_time range', () => {
    expect(buildSyncFilter('steps', '2026-07-26T00:00:00Z', '2026-07-27T00:00:00Z')).toBe(
      'steps.interval.start_time >= "2026-07-26T00:00:00Z" AND steps.interval.start_time < "2026-07-27T00:00:00Z"',
    );
  });
  it('sleep → interval.end_time (not update_time!)', () => {
    expect(buildSyncFilter('sleep', '2026-07-26T00:00:00Z')).toBe(
      'sleep.interval.end_time >= "2026-07-26T00:00:00Z"',
    );
  });
  it('daily-resting-heart-rate → date, civil date without trimming', () => {
    expect(buildSyncFilter('daily-resting-heart-rate', '2026-07-26')).toBe(
      'daily_resting_heart_rate.date >= "2026-07-26"',
    );
  });
  it('daily type trims RFC3339 to date', () => {
    expect(buildSyncFilter('daily-vo2-max', '2026-07-26T12:30:00Z')).toBe(
      'daily_vo2_max.date >= "2026-07-26"',
    );
  });
  it('exercise → civil_start_time trimmed to date', () => {
    expect(buildSyncFilter('exercise', '2026-07-26T08:00:00Z')).toBe(
      'exercise.interval.civil_start_time >= "2026-07-26"',
    );
  });
  it('electrocardiogram — >= only, until ignored', () => {
    expect(buildSyncFilter('electrocardiogram', '2026-07-26T00:00:00Z', '2026-07-27T00:00:00Z')).toBe(
      'electrocardiogram.interval.start_time >= "2026-07-26T00:00:00Z"',
    );
  });
  it('sleep with until → end_time range', () => {
    expect(buildSyncFilter('sleep', '2026-07-26T00:00:00Z', '2026-07-28T00:00:00Z')).toBe(
      'sleep.interval.end_time >= "2026-07-26T00:00:00Z" AND sleep.interval.end_time < "2026-07-28T00:00:00Z"',
    );
  });
});

describe('isRfc3339 — guard since/until in /api/sync against filter tampering', () => {
  it('accepts valid RFC3339 timestamps', () => {
    expect(isRfc3339('2026-07-26T00:00:00Z')).toBe(true);
    expect(isRfc3339('2026-07-26T12:34:56+03:00')).toBe(true);
    expect(isRfc3339('2026-07-26T12:34:56.789Z')).toBe(true);
  });
  it('rejects injection attempts and garbage', () => {
    // An embedded quote would allow rewriting the AIP-160 filter semantics.
    expect(isRfc3339('x" OR sleep.interval.end_time >= "')).toBe(false);
    expect(isRfc3339('2026-07-26')).toBe(false);
    expect(isRfc3339('2026-07-26 12:00:00')).toBe(false);
    expect(isRfc3339('')).toBe(false);
  });
});
