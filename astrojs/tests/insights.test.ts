import { describe, expect, it } from 'vitest';
import {
  bedtimeInsight,
  collectInsights,
  hrvInsight,
  rhrInsight,
  recoveryInsight,
  sleepInsight,
  stepsInsight,
  weightInsight,
} from '@lib/insights';

describe('sleepInsight', () => {
  it('flags a short last night (> 25 % below average)', () => {
    const r = sleepInsight({ lastAsleepMin: 270, avgAsleepMin: 480, nights: 7 });
    expect(r?.key).toBe('sleep_short');
    expect(r?.severity).toBe('warn');
  });
  it('reports good sleep when at/above average', () => {
    const r = sleepInsight({ lastAsleepMin: 510, avgAsleepMin: 480, nights: 7 });
    expect(r?.key).toBe('sleep_good');
    expect(r?.severity).toBe('good');
  });
  it('returns null without data', () => {
    expect(sleepInsight({ lastAsleepMin: null, avgAsleepMin: 480, nights: 0 })).toBeNull();
    expect(sleepInsight({ lastAsleepMin: 300, avgAsleepMin: null, nights: 1 })).toBeNull();
  });
});

describe('hrvInsight', () => {
  it('flags HRV more than 1 SD below the average', () => {
    const r = hrvInsight({ lastHrv: 20, avgHrv: 45, sdHrv: 12 });
    expect(r?.key).toBe('hrv_low');
    expect(r?.severity).toBe('warn');
  });
  it('stays null within the band', () => {
    expect(hrvInsight({ lastHrv: 40, avgHrv: 45, sdHrv: 12 })).toBeNull();
  });
});

describe('rhrInsight', () => {
  it('flags a > 5 % elevated resting HR', () => {
    const r = rhrInsight({ lastRhr: 70, avgRhr: 60 });
    expect(r?.key).toBe('rhr_elevated');
  });
  it('stays null around baseline', () => {
    expect(rhrInsight({ lastRhr: 61, avgRhr: 60 })).toBeNull();
  });
});

describe('stepsInsight', () => {
  it('flags activity below baseline', () => {
    const r = stepsInsight({ avg7: 4000, baseline: 10000, target: 10000 });
    expect(r?.key).toBe('steps_down');
  });
  it('stays null when active', () => {
    expect(stepsInsight({ avg7: 9500, baseline: 10000, target: 10000 })).toBeNull();
  });
});

describe('bedtimeInsight', () => {
  it('flags variable bedtime (> 45 min)', () => {
    // spread → sd ≈ 53 > 45
    const r = bedtimeInsight({ bedMin: [90, 10, 120, 5, 130], nights: 5 });
    expect(r?.key).toBe('bedtime_variable');
  });
  it('reports stable bedtime within 10–45 min', () => {
    // spread → sd ≈ 11, within [10,45]
    const r = bedtimeInsight({ bedMin: [0, 30, 20, 10], nights: 4 });
    expect(r?.key).toBe('bedtime_stable');
  });
  it('needs ≥ 2 nights', () => {
    expect(bedtimeInsight({ bedMin: [20], nights: 1 })).toBeNull();
  });
});

describe('recoveryInsight', () => {
  it('reports good recovery when HRV high & RHR low', () => {
    const r = recoveryInsight({ hrvAvg: 60, rhrAvg: 55, hasData: true });
    expect(r?.key).toBe('recovery_high');
  });
  it('flags low recovery when HRV ≤ 30', () => {
    const r = recoveryInsight({ hrvAvg: 25, rhrAvg: 70, hasData: true });
    expect(r?.key).toBe('recovery_low');
  });
  it('returns null without data', () => {
    expect(recoveryInsight({ hrvAvg: 0, rhrAvg: 0, hasData: false })).toBeNull();
  });
});

describe('weightInsight', () => {
  it('reports stable within ±1.5 kg', () => {
    expect(weightInsight({ firstKg: 70, lastKg: 70.5 })?.key).toBe('weight_stable');
  });
  it('reports up/down beyond 1.5 kg', () => {
    expect(weightInsight({ firstKg: 70, lastKg: 73 })?.key).toBe('weight_up');
    expect(weightInsight({ firstKg: 70, lastKg: 67 })?.key).toBe('weight_down');
  });
});

describe('collectInsights', () => {
  it('orders warn → info → good', () => {
    const out = collectInsights({
      sleep: { lastAsleepMin: 270, avgAsleepMin: 480, nights: 7 },
      hrv: { lastHrv: 20, avgHrv: 45, sdHrv: 12 },
      recovery: { hrvAvg: 60, rhrAvg: 55, hasData: true },
    });
    const order = out.map((i) => i.severity);
    expect(order[0]).toBe('warn');
    expect(order[order.length - 1]).toBe('good');
  });
});
