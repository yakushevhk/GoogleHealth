/**
 * Verify parser against real Google Health API shape.
 *
 * raw_api_responses.json in repo root — saved raw prod-API responses
 * (keys rollup_*, sample_*, daily_*, session_*). IMPORTANT: each response
 * is saved in an envelope {count, response, status} (dump artifact — HTTP status
 * and counter around body). The real API body is in `.response`; that's the shape
 * the frontend sees (gh-client returns clean body without envelope). bodyOf()
 * removes the envelope so verification reads what prod parses.
 *
 * Test runs extract* on each key and checks invariants without hardcoded
 * numbers (we read them from file). This is regression insurance after redesign:
 * if API shape and parser diverge, test will fail and show the specific type.
 */
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  durationSeconds,
  extractAggregates,
  extractZones,
  kebabToCamel,
  sampleTimeOf,
  sampleValue,
  toNumber,
} from '@lib/extract';

const RAW_PATH = fileURLToPath(
  new URL('../../raw_api_responses.json', import.meta.url),
);

// Skip this test suite if raw_api_responses.json is not present (e.g. in CI)
const rawExists = (() => {
  try { return statSync(RAW_PATH).isFile(); } catch { return false; }
})();
const describeOrSkip = rawExists ? describe : describe.skip;

const raw = rawExists
  ? JSON.parse(readFileSync(RAW_PATH, 'utf8')) as Record<string, Record<string, unknown>>
  : {};

/** Remove dump envelope {count,response,status} → API body. */
function bodyOf(key: string): Record<string, unknown> {
  const node = raw[key];
  const inner = node?.response;
  return inner && typeof inner === 'object' && !Array.isArray(inner)
    ? (inner as Record<string, unknown>)
    : node;
}

/** Strip prefix rollup_/sample_/daily_/session_ → kebab type. */
function typeOfKey(key: string): string | null {
  const m = /^(rollup|sample|daily|session)_(.+)$/.exec(key);
  return m ? m[2] : null;
}

const firstPoint = (body: Record<string, unknown>): Record<string, unknown> | null => {
  const pts = (body.rollupDataPoints ?? body.dataPoints) as
    | Record<string, unknown>[]
    | undefined;
  return pts && pts.length > 0 ? pts[0] : null;
};

// Zones are parsed via a separate path (extractZoneArray), not extractAggregates —
// we mirror history.ts ZONE_TYPES logic, otherwise we test the wrong code path.
const ZONE_ROLLUP = new Set(['time-in-heart-rate-zone', 'calories-in-heart-rate-zone']);

// Duration-only types: frontend reads their durationSum directly via durationSeconds
// (ActivityCard), not through extractAggregates — we verify exactly this path.
const DURATION_ROLLUP = new Set(['sedentary-period']);

describeOrSkip('raw API shape ↔ parser', () => {
  it('raw responses file is readable and non-empty', () => {
    expect(Object.keys(raw).length).toBeGreaterThan(10);
  });

  it('dump envelope is removed: bodyOf returns body with points', () => {
    const body = bodyOf('rollup_heart-rate');
    expect(Array.isArray(body.rollupDataPoints)).toBe(true);
    expect((body.rollupDataPoints as unknown[]).length).toBeGreaterThan(0);
  });

  it('rollup types: extractAggregates returns number where response has aggregate', () => {
    const checked: string[] = [];
    for (const key of Object.keys(raw)) {
      if (!key.startsWith('rollup_')) continue;
      const type = typeOfKey(key);
      if (!type) continue;
      const pt = firstPoint(bodyOf(key));
      if (!pt) continue;
      const field = pt[kebabToCamel(type)];
      if (field === undefined) continue; // this sample doesn't have the field — skip
      // Zone types: frontend extracts them via extractZones, not extractAggregates
      if (ZONE_ROLLUP.has(type)) {
        const z = extractZones(field);
        expect(
          Object.keys(z).length > 0,
          `${key}: extractZones returned empty object from ${JSON.stringify(field).slice(0, 80)}`,
        ).toBe(true);
        checked.push(key);
        continue;
      }
      // Duration-only types: frontend parses durationSum via durationSeconds
      if (DURATION_ROLLUP.has(type)) {
        const sec = durationSeconds((field as Record<string, unknown>).durationSum as string);
        expect(
          sec !== null && sec > 0,
          `${key}: durationSum didn't parse to seconds from ${JSON.stringify(field).slice(0, 80)}`,
        ).toBe(true);
        checked.push(key);
        continue;
      }
      const agg = extractAggregates(field);
      const scalar = agg.avg ?? agg.sum ?? agg.min ?? agg.max;
      const hasZones = !!agg.zones && Object.keys(agg.zones).length > 0;
      const hasRollup = !!agg.rollupBy && Object.keys(agg.rollupBy).length > 0;
      // "Extracted" = scalar OR non-empty zones OR non-empty rollupBy
      // (active-minutes stores aggregate only in *RollupBy array — that's valid).
      if (typeof field === 'number' || (typeof field === 'object' && field !== null)) {
        expect(
          scalar !== undefined || hasZones || hasRollup,
          `${key}: parser didn't extract number from ${JSON.stringify(field).slice(0, 80)}`,
        ).toBe(true);
        checked.push(key);
      }
    }
    expect(checked.length).toBeGreaterThan(5);
  });

  it('heart-rate rollup: min ≤ avg ≤ max and avg matches beatsPerMinuteAvg', () => {
    const pt = firstPoint(bodyOf('rollup_heart-rate'));
    expect(pt, 'no rollup_heart-rate with points in raw').toBeTruthy();
    const hr = pt!.heartRate as Record<string, unknown>;
    expect(hr).toBeDefined();
    const agg = extractAggregates(hr);
    expect(agg.avg).toBeCloseTo(Number(hr.beatsPerMinuteAvg), 6);
    expect(agg.min).toBe(Number(hr.beatsPerMinuteMin));
    expect(agg.max).toBe(Number(hr.beatsPerMinuteMax));
    expect(agg.min!).toBeLessThanOrEqual(agg.avg!);
    expect(agg.avg!).toBeLessThanOrEqual(agg.max!);
  });

  it('time-in-heart-rate-zone: zones parse into non-empty object with minutes', () => {
    const pt = firstPoint(bodyOf('rollup_time-in-heart-rate-zone'));
    expect(pt).toBeTruthy();
    const field = pt!.timeInHeartRateZone as Record<string, unknown>;
    const zones = extractZones(field);
    const total = Object.values(zones).reduce((a, b) => a + b, 0);
    expect(Object.keys(zones).length).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(0);
  });

  it('sedentary-period: durationSum "13500s" → 225 minutes (duration, not counter)', () => {
    const pt = firstPoint(bodyOf('rollup_sedentary-period'));
    expect(pt).toBeTruthy();
    const field = pt!.sedentaryPeriod as Record<string, unknown>;
    const sec = durationSeconds(field.durationSum as string);
    expect(sec).toBe(13500);
    expect(Math.round(sec! / 60)).toBe(225);
  });

  it('daily-resting-heart-rate: avg === beatsPerMinute (string → number)', () => {
    const pt = firstPoint(bodyOf('daily_daily-resting-heart-rate'));
    expect(pt).toBeTruthy();
    const field = pt!.dailyRestingHeartRate as Record<string, unknown>;
    const agg = extractAggregates(field);
    expect(agg.avg).toBe(toNumber(field.beatsPerMinute));
    expect(typeof agg.avg).toBe('number');
  });

  it('sample heart-rate-variability: has sample time and numeric value', () => {
    const pt = firstPoint(bodyOf('sample_heart-rate-variability'));
    expect(pt).toBeTruthy();
    const field = pt!.heartRateVariability as Record<string, unknown>;
    expect(sampleTimeOf(field)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sampleValue(field)).toBeTypeOf('number');
  });

  it('sample oxygen-saturation: value in range 0..100', () => {
    const pt = firstPoint(bodyOf('sample_oxygen-saturation'));
    expect(pt).toBeTruthy();
    const field = pt!.oxygenSaturation as Record<string, unknown>;
    const v = sampleValue(field);
    expect(v).toBeTypeOf('number');
    expect(v!).toBeGreaterThan(0);
    expect(v!).toBeLessThanOrEqual(100);
  });

  it('kebabToCamel is correct for all types from raw', () => {
    expect(kebabToCamel('heart-rate')).toBe('heartRate');
    expect(kebabToCamel('time-in-heart-rate-zone')).toBe('timeInHeartRateZone');
    expect(kebabToCamel('daily-resting-heart-rate')).toBe('dailyRestingHeartRate');
    expect(kebabToCamel('heart-rate-variability')).toBe('heartRateVariability');
    expect(kebabToCamel('steps')).toBe('steps');
  });
});
