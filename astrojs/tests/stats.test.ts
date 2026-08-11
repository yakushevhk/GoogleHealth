import { describe, expect, it } from 'vitest';
import {
  civilDateOf,
  clipToDay,
  computeReadiness,
  computeStreaks,
  dayDiff,
  deepRemRatio,
  desatStats,
  heartRateRecovery,
  hrZoneDistribution,
  mean,
  minuteOfDay,
  sleepEfficiency,
  splitNightDay,
  stagePercentages,
  stdDev,
  vo2MaxTrend,
  weekOverWeekPct,
} from '@lib/stats';

describe('computeReadiness', () => {
  it('HIGH: HRV>50 and RHR in (0,65)', () => expect(computeReadiness(55, 58)).toBe('HIGH'));
  it('MODERATE: HRV>30 but RHR is high', () => expect(computeReadiness(45, 70)).toBe('MODERATE'));
  it('LOW: HRV<=30', () => expect(computeReadiness(25, 60)).toBe('LOW / RECOVERY NEEDED'));
  it('boundary: HRV=50 is not strictly HIGH', () => expect(computeReadiness(50, 60)).toBe('MODERATE'));
  it('RHR=0 is not HIGH', () => expect(computeReadiness(55, 0)).toBe('MODERATE'));
});

describe('dayDiff', () => {
  it('adjacent days', () => expect(dayDiff('2026-07-21', '2026-07-22')).toBe(1));
  it('across month boundary', () => expect(dayDiff('2026-06-30', '2026-07-02')).toBe(2));
  it('backwards', () => expect(dayDiff('2026-07-22', '2026-07-20')).toBe(-2));
});

describe('computeStreaks', () => {
  it('counts current and longest streaks', () => {
    const entries = [
      { date: '2026-07-10', value: 12000 },
      { date: '2026-07-11', value: 11000 },
      { date: '2026-07-12', value: 3000 }, // break
      { date: '2026-07-13', value: 15000 },
      { date: '2026-07-14', value: 10000 },
      { date: '2026-07-15', value: 10500 },
    ];
    expect(computeStreaks(entries, 10000)).toEqual({ current: 3, longest: 3 });
  });
  it('missed day breaks the streak', () => {
    const entries = [
      { date: '2026-07-10', value: 12000 },
      // 11th missing
      { date: '2026-07-12', value: 12000 },
    ];
    expect(computeStreaks(entries, 10000)).toEqual({ current: 1, longest: 1 });
  });
  it('incomplete today is excluded', () => {
    const entries = [
      { date: '2026-07-14', value: 12000 },
      { date: '2026-07-15', value: 11000 },
      { date: '2026-07-16', value: 500 }, // today, hasn't reached threshold yet
    ];
    expect(computeStreaks(entries, 10000, '2026-07-16')).toEqual({
      current: 2,
      longest: 2,
    });
  });
  it('empty → zeros', () => {
    expect(computeStreaks([], 10000)).toEqual({ current: 0, longest: 0 });
  });
});

describe('mean / stdDev', () => {
  it('mean', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBeNull();
  });
  it('stdDev: identical values → 0', () => expect(stdDev([5, 5, 5])).toBe(0));
  it('stdDev: known case', () => {
    // [2,4,4,4,5,5,7,9] → σ = 2
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2);
  });
  it('stdDev: single value → 0', () => expect(stdDev([42])).toBe(0));
});

describe('desatStats', () => {
  const samples = [
    { time: '2026-07-21T01:00:00Z', value: 97 },
    { time: '2026-07-21T02:00:00Z', value: 91 },
    { time: '2026-07-21T03:00:00Z', value: 88 },
    { time: '2026-07-21T04:00:00Z', value: 95 },
  ];
  it('counts samples below threshold and finds minimum', () => {
    expect(desatStats(samples, 92)).toEqual({
      count: 2,
      min: 88,
      minTime: '2026-07-21T03:00:00Z',
    });
  });
  it('empty → zeros', () => {
    expect(desatStats([], 92)).toEqual({ count: 0, min: null, minTime: null });
  });
  it('all above threshold → count 0, minimum exists', () => {
    expect(desatStats([{ time: 't', value: 96 }], 92)).toEqual({
      count: 0,
      min: 96,
      minTime: 't',
    });
  });
});

describe('splitNightDay', () => {
  const windows = [
    { start: '2026-07-20T22:00:00Z', end: '2026-07-21T06:00:00Z' },
  ];
  it('splits samples into sleep windows', () => {
    const { night, day } = splitNightDay(
      [
        { time: '2026-07-20T23:00:00Z', value: 60 }, // night
        { time: '2026-07-21T03:00:00Z', value: 55 }, // night
        { time: '2026-07-21T12:00:00Z', value: 80 }, // day
      ],
      windows,
    );
    expect(night.map((s) => s.value)).toEqual([60, 55]);
    expect(day.map((s) => s.value)).toEqual([80]);
  });
  it('window boundaries are inclusive', () => {
    const { night } = splitNightDay(
      [
        { time: '2026-07-20T22:00:00Z', value: 1 },
        { time: '2026-07-21T06:00:00Z', value: 2 },
      ],
      windows,
    );
    expect(night).toHaveLength(2);
  });
});

describe('heartRateRecovery', () => {
  const points = [
    { time: '2026-07-21T06:30:00Z', avg: 120 }, // 0–5 min after end
    { time: '2026-07-21T06:33:00Z', avg: 110 },
    { time: '2026-07-21T06:37:00Z', avg: 95 }, // 5–10 min
    { time: '2026-07-21T06:39:00Z', avg: 85 },
  ];
  it('delta between windows', () => {
    const r = heartRateRecovery(points, '2026-07-21T06:30:00Z')!;
    expect(r.first).toBe(115);
    expect(r.second).toBe(90);
    expect(r.drop).toBe(25);
  });
  it('no data in windows → null', () => {
    expect(heartRateRecovery(points, '2026-07-21T10:00:00Z')).toBeNull();
  });
});

describe('weekOverWeekPct', () => {
  it('increase', () => expect(weekOverWeekPct([110], [100])).toBeCloseTo(10));
  it('decrease', () => expect(weekOverWeekPct([90], [100])).toBeCloseTo(-10));
  it('nothing to compare → null', () => {
    expect(weekOverWeekPct([100], [])).toBeNull();
    expect(weekOverWeekPct([100], [0])).toBeNull();
  });
});

describe('sleepEfficiency', () => {
  it('typical night: 450 out of 480 minutes → 93.8%', () => {
    expect(
      sleepEfficiency({ minutesAsleep: 450, minutesInSleepPeriod: 480 }),
    ).toBe(93.8);
  });
  it('string values from API', () => {
    expect(
      sleepEfficiency({ minutesAsleep: '400', minutesInSleepPeriod: '500' }),
    ).toBe(80);
  });
  it('zero sleep → null', () => {
    expect(
      sleepEfficiency({ minutesAsleep: 0, minutesInSleepPeriod: 480 }),
    ).toBeNull();
  });
  it('zero period / empty data → null', () => {
    expect(
      sleepEfficiency({ minutesAsleep: 450, minutesInSleepPeriod: 0 }),
    ).toBeNull();
    expect(sleepEfficiency({})).toBeNull();
  });
});

describe('stagePercentages', () => {
  // Typical night: LIGHT 210, DEEP 90, REM 100, AWAKE 30 (total 430)
  const stages = [
    { type: 'LIGHT', minutes: 210 },
    { type: 'DEEP', minutes: 90 },
    { type: 'REM', minutes: 100 },
    { type: 'AWAKE', minutes: 30 },
  ];
  it('computes minutes and percentages per stage', () => {
    const r = stagePercentages(stages);
    expect(r.LIGHT).toEqual({ minutes: 210, percent: 48.8 });
    expect(r.DEEP).toEqual({ minutes: 90, percent: 20.9 });
    expect(r.REM).toEqual({ minutes: 100, percent: 23.3 });
    expect(r.AWAKE).toEqual({ minutes: 30, percent: 7 });
  });
  it('empty array → empty object', () => {
    expect(stagePercentages([])).toEqual({});
  });
  it('zero minutes → 0 percent', () => {
    expect(stagePercentages([{ type: 'DEEP', minutes: 0 }])).toEqual({
      DEEP: { minutes: 0, percent: 0 },
    });
  });
  it('garbage items are skipped', () => {
    const r = stagePercentages([null, { minutes: 60 }, { type: 'REM', minutes: 60 }]);
    expect(r).toEqual({ REM: { minutes: 60, percent: 100 } });
  });
});

describe('deepRemRatio', () => {
  it('deep + REM of total time', () => {
    const stages = [
      { type: 'LIGHT', minutes: 210 },
      { type: 'DEEP', minutes: 90 },
      { type: 'REM', minutes: 100 },
      { type: 'AWAKE', minutes: 30 },
    ];
    // (90 + 100) / 430 = 44.2%
    expect(deepRemRatio(stages)).toBe(44.2);
  });
  it('empty → null', () => expect(deepRemRatio([])).toBeNull());
  it('all zeros → null', () => {
    expect(deepRemRatio([{ type: 'LIGHT', minutes: 0 }])).toBeNull();
  });
  it('no DEEP/REM → 0', () => {
    expect(deepRemRatio([{ type: 'LIGHT', minutes: 300 }])).toBe(0);
  });
});

describe('hrZoneDistribution', () => {
  it('duration strings "Ns" from time-in-heart-rate-zones', () => {
    const r = hrZoneDistribution({
      timeInHeartRateZones: [
        { heartRateZone: 'ZONE_1', duration: '900s' },
        { heartRateZone: 'ZONE_2', duration: '1800s' },
        { heartRateZone: 'ZONE_3', duration: '600s' },
      ],
    });
    expect(r.ZONE_1).toEqual({ minutes: 15, percent: 27.3 });
    expect(r.ZONE_2).toEqual({ minutes: 30, percent: 54.5 });
    expect(r.ZONE_3).toEqual({ minutes: 10, percent: 18.2 });
  });
  it('variant with zone field and minutes', () => {
    const r = hrZoneDistribution({
      zones: [
        { zone: 'fat_burn', minutes: 20 },
        { zone: 'cardio', minutes: 10 },
      ],
    });
    expect(r.fat_burn).toEqual({ minutes: 20, percent: 66.7 });
    expect(r.cardio).toEqual({ minutes: 10, percent: 33.3 });
  });
  it('no zone array / garbage → empty object', () => {
    expect(hrZoneDistribution({})).toEqual({});
    expect(hrZoneDistribution(null as unknown as Record<string, unknown>)).toEqual({});
  });
});

describe('vo2MaxTrend', () => {
  it('rising trend', () => {
    const r = vo2MaxTrend([
      { vo2Max: 40 },
      { vo2Max: 40.5 },
      { vo2Max: 41 },
      { vo2Max: 42 },
      { vo2Max: 43 },
      { vo2Max: 44 },
    ]);
    expect(r.current).toBe(44);
    expect(r.trend).toBe('improving');
    expect(r.changePercent).toBe(6.2);
  });
  it('stable trend (change < 2%)', () => {
    const r = vo2MaxTrend([
      { vo2Max: 42 },
      { vo2Max: 42.1 },
      { vo2Max: 41.9 },
      { vo2Max: 42 },
    ]);
    expect(r.current).toBe(42);
    expect(r.trend).toBe('stable');
    expect(r.changePercent).toBe(-0.2);
  });
  it('declining trend', () => {
    const r = vo2MaxTrend([
      { vo2Max: 45 },
      { vo2Max: 44 },
      { vo2Max: 43 },
      { vo2Max: 41 },
      { vo2Max: 40 },
    ]);
    expect(r.current).toBe(40);
    expect(r.trend).toBe('declining');
    expect(r.changePercent).toBe(-8);
  });
  it('single value → no trend', () => {
    expect(vo2MaxTrend([{ value: 42 }])).toEqual({
      current: 42,
      trend: null,
      changePercent: null,
    });
  });
  it('empty → all null', () => {
    expect(vo2MaxTrend([])).toEqual({
      current: null,
      trend: null,
      changePercent: null,
    });
  });
  it('raw API format: date objects + nested vo2Max, unsorted', () => {
    // Real daily-vo2-max points: date = {year,month,day} (object), value nested
    // in vo2Max.*. The old code compared String(date) = "[object Object]" (sorting
    // was a no-op) and toNumber(vo2Max) on an object returned undefined (points
    // were lost).
    const d = (y: number, m: number, day: number) => ({ year: y, month: m, day });
    const r = vo2MaxTrend([
      { date: d(2026, 7, 3), vo2Max: { millilitersPerMinuteKilogramMax: 44 } },
      { date: d(2026, 7, 1), vo2Max: { millilitersPerMinuteKilogramMax: 40 } },
      { date: d(2026, 7, 4), vo2Max: { millilitersPerMinuteKilogramMax: 45 } },
      { date: d(2026, 7, 2), vo2Max: { millilitersPerMinuteKilogramMax: 42 } },
    ]);
    expect(r.current).toBe(45); // last by date, not by array order
    expect(r.trend).toBe('improving');
  });
  it('flattened points without dates keep original order (stable sort)', () => {
    const r = vo2MaxTrend([{ avg: 40 }, { avg: 42 }, { avg: 44 }]);
    expect(r.current).toBe(44);
    expect(r.trend).toBe('improving');
  });
});

describe('clipToDay', () => {
  // UTC+3: local midnight 31.07 = 30.07T21:00Z → offsetMin = −180
  const OFF = -180;
  const DAY = '2026-07-31';

  it('night session is clipped to day start', () => {
    // sleep 23:00 local time 30.07 (20:00Z) — 07:00 local time 31.07 (04:00Z)
    expect(clipToDay('2026-07-30T20:00:00Z', '2026-07-31T04:00:00Z', DAY, OFF)).toEqual([0, 420]);
  });

  it('session within the day — no clipping', () => {
    // 10:00–11:30 local time = 07:00Z–08:30Z
    expect(clipToDay('2026-07-31T07:00:00Z', '2026-07-31T08:30:00Z', DAY, OFF)).toEqual([600, 690]);
  });

  it('session that started during the day and went past midnight is clipped to day end', () => {
    // 23:30 local time 31.07 (20:30Z) — 02:00 local time 01.08 (23:00Z)
    expect(clipToDay('2026-07-31T20:30:00Z', '2026-07-31T23:00:00Z', DAY, OFF)).toEqual([1410, 1440]);
  });

  it('interval entirely before day → null', () => {
    expect(clipToDay('2026-07-30T10:00:00Z', '2026-07-30T12:00:00Z', DAY, OFF)).toBeNull();
  });

  it('interval entirely after day → null', () => {
    expect(clipToDay('2026-08-01T10:00:00Z', '2026-08-01T12:00:00Z', DAY, OFF)).toBeNull();
  });

  it('touching boundary (end == day start) → null', () => {
    expect(clipToDay('2026-07-30T10:00:00Z', '2026-07-30T21:00:00Z', DAY, OFF)).toBeNull();
  });

  it('degenerate interval (end == start) → null', () => {
    expect(clipToDay('2026-07-31T07:00:00Z', '2026-07-31T07:00:00Z', DAY, OFF)).toBeNull();
  });

  it('offsetMin = 0 (UTC day) works on UTC boundaries', () => {
    expect(clipToDay('2026-07-31T00:30:00Z', '2026-07-31T02:00:00Z', DAY, 0)).toEqual([30, 120]);
  });

  it('garbage input → null', () => {
    expect(clipToDay('not-a-date', '2026-07-31T07:00:00Z', DAY, OFF)).toBeNull();
  });
});

describe('minuteOfDay', () => {
  it('moment within day → minute from local midnight', () => {
    // 07:15 local time = 04:15Z, offset −180 → 7*60+15
    expect(minuteOfDay('2026-07-31T04:15:00Z', '2026-07-31', -180)).toBe(435);
  });

  it('moment outside day → null', () => {
    expect(minuteOfDay('2026-07-30T04:15:00Z', '2026-07-31', -180)).toBeNull();
  });

  it('null/garbage → null', () => {
    expect(minuteOfDay(null, '2026-07-31', -180)).toBeNull();
    expect(minuteOfDay('x', '2026-07-31', -180)).toBeNull();
  });
});

describe('civilDateOf', () => {
  it('night UTC+3: 01:00 local time → next civil date', () => {
    // 01:00 local time 01.08 = 22:00Z 31.07; offset −180 → date 2026-08-01
    expect(civilDateOf('2026-07-31T22:00:00Z', -180)).toBe('2026-08-01');
  });
  it('day UTC+3: 15:00 local time = 12:00Z → same date', () => {
    expect(civilDateOf('2026-07-31T12:00:00Z', -180)).toBe('2026-07-31');
  });
  it('offset 0 → UTC date', () => {
    expect(civilDateOf('2026-07-31T23:59:00Z', 0)).toBe('2026-07-31');
  });
  it('garbage/null → null', () => {
    expect(civilDateOf('not-a-date', -180)).toBeNull();
    expect(civilDateOf(null, -180)).toBeNull();
  });
});
