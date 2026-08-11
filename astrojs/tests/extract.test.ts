import { describe, expect, it } from 'vitest';
import {
  canonicalZone,
  canonicalizeZones,
  civilFromUtc,
  durationSeconds,
  extractAggregates,
  extractZones,
  firstNumber,
  kebabToCamel,
  pointDate,
  sampleTimeOf,
  sampleValue,
  toNumber,
  totalOf,
} from '@lib/extract';

describe('toNumber', () => {
  it('numbers and numeric strings', () => {
    expect(toNumber(975)).toBe(975);
    expect(toNumber('975')).toBe(975);
    expect(toNumber('62')).toBe(62);
    expect(toNumber('')).toBeUndefined();
    expect(toNumber('abc')).toBeUndefined();
    expect(toNumber(null)).toBeUndefined();
    expect(toNumber(NaN)).toBeUndefined();
  });
});

describe('kebabToCamel', () => {
  it('heart-rate → heartRate', () => expect(kebabToCamel('heart-rate')).toBe('heartRate'));
  it('swim-lengths-data → swimLengthsData', () =>
    expect(kebabToCamel('swim-lengths-data')).toBe('swimLengthsData'));
  it('steps → steps', () => expect(kebabToCamel('steps')).toBe('steps'));
});

describe('extractAggregates — real API response formats', () => {
  it('steps: {countSum: "975"} (string) → sum 975', () => {
    expect(extractAggregates({ countSum: '975' })).toEqual({ sum: 975 });
  });
  it('heartRate: avg/min/max numbers', () => {
    expect(
      extractAggregates({
        beatsPerMinuteAvg: 80.28,
        beatsPerMinuteMax: 140,
        beatsPerMinuteMin: 45,
      }),
    ).toEqual({ avg: 80.28, max: 140, min: 45 });
  });
  it('kcalSum → sum', () => {
    expect(extractAggregates({ kcalSum: 54.97 })).toEqual({ sum: 54.97 });
  });
  it('millimetersSum string → sum', () => {
    expect(extractAggregates({ millimetersSum: '1768721' })).toEqual({ sum: 1768721 });
  });
  it('single value (beatsPerMinute) → avg', () => {
    expect(extractAggregates({ beatsPerMinute: '62' })).toEqual({ avg: 62 });
  });
  it('activeMinutesRollupByActivityLevel → per-level breakdown', () => {
    expect(
      extractAggregates({
        activeMinutesRollupByActivityLevel: [
          { activityLevel: 'STILL', activeMinutes: 400 },
          { activityLevel: 'WALKING', activeMinutes: 45 },
        ],
      }),
    ).toEqual({ rollupBy: { STILL: 400, WALKING: 45 } });
  });
  it('rollupBy with duration string ("7200s") → minutes', () => {
    expect(
      extractAggregates({
        activityLevelRollupByActivityLevel: [
          { activityLevel: 'SEDENTARY', duration: '7200s' },
          { activityLevel: 'WALKING', duration: '900s' },
        ],
      }),
    ).toEqual({ rollupBy: { SEDENTARY: 120, WALKING: 15 } });
  });
  it('daily field with date object first → metric avg, not year (P0 regression)', () => {
    expect(
      extractAggregates({
        date: { year: 2026, month: 7, day: 28 },
        averageHeartRateVariabilityMilliseconds: 36.4,
        nonRemHeartRateBeatsPerMinute: '67',
        entropy: 3.299,
      }),
    ).toEqual({ avg: 36.4 });
  });
  it('daily respiratory: breathsPerMinute after date → avg, not year', () => {
    expect(
      extractAggregates({ date: { year: 2026, month: 7, day: 28 }, breathsPerMinute: 17.6 }),
    ).toEqual({ avg: 17.6 });
  });
  it('weight: Avg/Min/Max grams', () => {
    expect(
      extractAggregates({
        weightGramsAvg: 70000,
        weightGramsMin: 69500,
        weightGramsMax: 70500,
      }),
    ).toEqual({ avg: 70000, min: 69500, max: 70500 });
  });
  it('null/undefined → {}', () => {
    expect(extractAggregates(null)).toEqual({});
    expect(extractAggregates(undefined)).toEqual({});
  });
  it('avg does not depend on key order: "Average" takes priority over first numeric fields', () => {
    // Regression: previously avg was "first number in JSON order" — if Google
    // added count/entropy before the metric, the dashboard would silently show
    // the wrong value.
    expect(
      extractAggregates({
        date: { year: 2026, month: 7, day: 28 },
        sampleCount: 120,
        entropy: 3.299,
        averageHeartRateVariabilityMilliseconds: 36.4,
      }),
    ).toEqual({ avg: 36.4 });
    // Without "Average" — a recognizable metric (PerMinute) takes priority over a counter.
    expect(
      extractAggregates({ sampleCount: 120, breathsPerMinute: 17.6 }),
    ).toEqual({ avg: 17.6 });
    // With no metrics at all — first number (previous behavior).
    expect(extractAggregates({ sampleCount: 120, value: 7 })).toEqual({ avg: 120 });
  });
});

describe('extractZones', () => {
  it('HR zones from rollupByHeartRateZone', () => {
    const zones = extractZones({
      timeInHeartRateZoneRollupByHeartRateZone: [
        { heartRateZone: 'FAT_BURN', seconds: 1200 },
        { heartRateZone: 'CARDIO', seconds: 600 },
        { heartRateZone: 'PEAK', seconds: 120 },
      ],
    });
    expect(zones).toEqual({ FAT_BURN: 1200, CARDIO: 600, PEAK: 120 });
  });
  it('duration strings → minutes (real API format)', () => {
    const zones = extractZones({
      timeInHeartRateZones: [
        { heartRateZone: 'LIGHT', duration: '22920s' },
        { heartRateZone: 'MODERATE', duration: '960s' },
      ],
    });
    expect(zones).toEqual({ LIGHT: 382, MODERATE: 16 });
  });
  it('empty → {}', () => {
    expect(extractZones(null)).toEqual({});
    expect(extractZones({ foo: 1 })).toEqual({});
  });
});

describe('firstNumber', () => {
  it('nested objects', () => {
    expect(firstNumber({ a: { b: { c: '42' } } })).toBe(42);
    expect(firstNumber({ x: null, y: 7 })).toBe(7);
    expect(firstNumber({})).toBeUndefined();
  });
});

describe('pointDate', () => {
  it('date object {year, month, day}', () => {
    expect(pointDate({ date: { year: 2026, month: 7, day: 5 } })).toBe('2026-07-05');
  });
  it('civilStartTime object from dailyRollUp', () => {
    expect(
      pointDate({ civilStartTime: { date: { year: 2026, month: 7, day: 22 }, time: {} } }),
    ).toBe('2026-07-22');
  });
  it('civilStartTime string', () => {
    expect(pointDate({ civilStartTime: '2026-07-05T00:00:00' })).toBe('2026-07-05');
  });
  it('startTime string', () => {
    expect(pointDate({ startTime: '2026-07-05T14:00:00Z' })).toBe('2026-07-05');
  });
  it('no date → empty', () => {
    expect(pointDate({})).toBe('');
  });
});

describe('durationSeconds', () => {
  it('"1945s" → 1945', () => expect(durationSeconds('1945s')).toBe(1945));
  it('null → null', () => expect(durationSeconds(null)).toBeNull());
  it('garbage → null', () => expect(durationSeconds('abc')).toBeNull());
});

describe('sampleValue', () => {
  it('HRV: does not pick up year from nested sampleTime date', () => {
    expect(
      sampleValue({
        sampleTime: {
          physicalTime: '2026-07-21T15:01:33Z',
          civilTime: { date: { year: 2026, month: 7, day: 21 }, time: { hours: 18 } },
        },
        rootMeanSquareOfSuccessiveDifferencesMilliseconds: 57,
      }),
    ).toBe(57);
  });
  it('SpO₂: percentage', () => {
    expect(
      sampleValue({
        sampleTime: { physicalTime: '2026-07-21T15:46:00Z' },
        percentage: 96,
      }),
    ).toBe(96);
  });
  it('number as-is', () => expect(sampleValue(42)).toBe(42));
  it('sampleTime only → undefined', () => {
    expect(sampleValue({ sampleTime: { physicalTime: 'x' } })).toBeUndefined();
  });
});

describe('sampleTimeOf', () => {
  it('physicalTime from nested sampleTime', () => {
    expect(
      sampleTimeOf({ sampleTime: { physicalTime: '2026-07-21T15:01:33Z' } }),
    ).toBe('2026-07-21T15:01:33Z');
  });
  it('no sampleTime → empty', () => expect(sampleTimeOf({})).toBe(''));
});

describe('civilFromUtc', () => {
  it('UTC+1: UTC evening → same civil day', () => {
    const r = civilFromUtc('2026-07-20T22:05:00Z', '3600s')!;
    expect(r.date).toBe('2026-07-20');
    expect(r.time).toBe('23:05');
    expect(r.hours).toBeCloseTo(23 + 5 / 60);
  });
  it('no shift — UTC', () => {
    const r = civilFromUtc('2026-07-21T15:00:00Z')!;
    expect(r.date).toBe('2026-07-21');
    expect(r.time).toBe('15:00');
  });
  it('negative shift', () => {
    const r = civilFromUtc('2026-07-21T02:00:00Z', '-3600s')!;
    expect(r.date).toBe('2026-07-21');
    expect(r.time).toBe('01:00');
  });
  it('garbage → null', () => expect(civilFromUtc('not-a-date')).toBeNull());
});

describe('canonicalZone / canonicalizeZones', () => {
  it('Fitbit → canonical', () => {
    expect(canonicalZone('LIGHT')).toBe('FAT_BURN');
    expect(canonicalZone('MODERATE')).toBe('CARDIO');
    expect(canonicalZone('VIGOROUS')).toBe('PEAK');
    expect(canonicalZone('PEAK')).toBe('PEAK');
  });
  it('rollup names pass through', () => {
    expect(canonicalZone('FAT_BURN')).toBe('FAT_BURN');
    expect(canonicalZone('OUT_OF_ZONE')).toBe('OUT_OF_ZONE');
  });
  it('unknown passes through unchanged', () => expect(canonicalZone('WEIRD')).toBe('WEIRD'));
  it('canonicalizeZones maps real API shape (regression: /zones today card)', () => {
    const raw = extractZones({
      timeInHeartRateZones: [
        { heartRateZone: 'LIGHT', duration: '43980s' },
        { heartRateZone: 'MODERATE', duration: '240s' },
      ],
    });
    const canon = canonicalizeZones(raw);
    expect(canon).toEqual({ FAT_BURN: 733, CARDIO: 4 });
    for (const k of Object.keys(canon))
      expect(['OUT_OF_ZONE', 'FAT_BURN', 'CARDIO', 'PEAK']).toContain(k);
  });
});

describe('totalOf', () => {
  it('prefers sum', () => expect(totalOf({ sum: 5, rollupBy: { A: 9 } })).toBe(5));
  it('falls back to rollupBy sum (active-minutes, no scalar sum)', () =>
    expect(
      totalOf(
        extractAggregates({
          activeMinutesRollupByActivityLevel: [
            { activityLevel: 'STILL', activeMinutes: 400 },
            { activityLevel: 'WALKING', activeMinutes: 45 },
          ],
        }),
      ),
    ).toBe(445));
  it('falls back to zones sum', () => expect(totalOf({ zones: { FAT_BURN: 4, CARDIO: 2 } })).toBe(6));
  it('empty → null', () => expect(totalOf({})).toBeNull());
});
