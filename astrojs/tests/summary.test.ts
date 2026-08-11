import { describe, expect, it, vi } from 'vitest';
import type { SummaryClient } from '@lib/summary';
import { buildSummary } from '@lib/summary';
import { GhError } from '@lib/gh-client';
import type { ListResponse, RollupResponse } from '@lib/gh-types';

/** Mock client: returns pre-configured responses by key. */
function mockClient(opts: {
  rollups?: Record<string, RollupResponse>;
  lists?: Record<string, ListResponse>;
  failTypes?: string[];
}): SummaryClient & { rollupCalls: string[]; listCalls: string[] } {
  const rollupCalls: string[] = [];
  const listCalls: string[] = [];
  return {
    rollupCalls,
    listCalls,
    dailyRollUp: vi.fn(async (dt: string) => {
      rollupCalls.push(dt);
      if (opts.failTypes?.includes(dt)) throw new Error('API error');
      return opts.rollups?.[dt] ?? {};
    }),
    list: vi.fn(async (dt: string) => {
      listCalls.push(dt);
      if (opts.failTypes?.includes(dt)) throw new Error('API error');
      return opts.lists?.[dt] ?? {};
    }),
  };
}

describe('buildSummary', () => {
  it('builds a summary in the MCP tool "today" format', async () => {
    const client = mockClient({
      rollups: {
        steps: { rollupDataPoints: [{ steps: { countSum: '9750' } }] },
        'heart-rate': {
          rollupDataPoints: [
            { heartRate: { beatsPerMinuteAvg: 76.5, beatsPerMinuteMin: 48, beatsPerMinuteMax: 132 } },
          ],
        },
        distance: { rollupDataPoints: [{ distance: { millimetersSum: '6500000' } }] },
      },
      lists: {
        'daily-resting-heart-rate': {
          dataPoints: [{ dailyRestingHeartRate: { beatsPerMinute: '58' } }],
        },
        sleep: {
          dataPoints: [
            {
              sleep: {
                interval: { startTime: '2026-07-21T22:10:00Z', endTime: '2026-07-22T05:40:00Z' },
                type: 'STAGES',
                stages: [{ type: 'DEEP' }],
                summary: { sleepQuality: 'GOOD' },
              },
            },
          ],
        },
        exercise: {
          dataPoints: [
            {
              exercise: {
                exerciseType: 'RUNNING',
                displayName: 'Morning run',
                interval: { startTime: '2026-07-22T06:00:00Z', endTime: '2026-07-22T06:32:00Z' },
                activeDuration: '1920s',
                metricsSummary: { heartRate: { beatsPerMinuteAvg: 148 } },
              },
            },
          ],
        },
        'vo2-max': { dataPoints: [{ vo2Max: { millilitersPerMinuteKilogramMax: 46.2 } }] },
        'activity-level': {
          dataPoints: [
            { activityLevel: { activityLevel: 'WALKING', durationSeconds: 1800 } },
          ],
        },
      },
    });

    const s = await buildSummary('2026-07-22', client);

    expect(s.date).toBe('2026-07-22');
    expect(s.steps).toEqual({ countSum: '9750' });
    expect(s.heart_rate).toEqual({
      beatsPerMinuteAvg: 76.5,
      beatsPerMinuteMin: 48,
      beatsPerMinuteMax: 132,
    });
    expect(s.distance).toEqual({ millimetersSum: '6500000' });
    expect(s.resting_heart_rate).toEqual({ beatsPerMinute: '58' });
    expect(s.vo2_max).toEqual({ millilitersPerMinuteKilogramMax: 46.2 });

    // Sleep: field mapping
    expect(s.sleep).toHaveLength(1);
    expect(s.sleep?.[0]).toMatchObject({
      start: '2026-07-21T22:10:00Z',
      end: '2026-07-22T05:40:00Z',
      type: 'STAGES',
    });
    expect(s.sleep?.[0].stages).toEqual([{ type: 'DEEP' }]);

    // Workouts: field mapping
    expect(s.exercise).toHaveLength(1);
    expect(s.exercise?.[0]).toMatchObject({
      type: 'RUNNING',
      name: 'Morning run',
      duration: '1920s',
    });

    // Activity levels
    expect(s.activity_levels).toHaveLength(1);

    // Empty rollups do not create keys
    expect(s.floors).toBeUndefined();
    expect(s.swim_lengths).toBeUndefined();
  });

  it('makes 20 rollup + 13 list requests', async () => {
    const client = mockClient({});
    await buildSummary('2026-07-22', client);
    expect(client.rollupCalls.length).toBe(20);
    // 7 daily + 4 sample + sleep + exercise + activity-level = 14
    expect(client.listCalls.length).toBe(14);
    expect(client.listCalls).toContain('sleep');
    expect(client.listCalls).toContain('exercise');
    expect(client.listCalls).toContain('activity-level');
  });

  it('error from a single type does not crash the summary', async () => {
    const client = mockClient({
      failTypes: ['steps', 'sleep', 'daily-vo2-max'],
      rollups: {
        'heart-rate': {
          rollupDataPoints: [{ heartRate: { beatsPerMinuteAvg: 70 } }],
        },
      },
    });
    const s = await buildSummary('2026-07-22', client);
    expect(s.steps).toBeUndefined();
    expect(s.sleep).toBeUndefined();
    expect(s.daily_vo2_max).toBeUndefined();
    expect(s.heart_rate).toEqual({ beatsPerMinuteAvg: 70 });
  });

  it('empty rollupDataPoints → field absent', async () => {
    const client = mockClient({
      rollups: { steps: { rollupDataPoints: [] } },
    });
    const s = await buildSummary('2026-07-22', client);
    expect(s.steps).toBeUndefined();
  });

  it('all requests failed → throws error (not empty summary with 200)', async () => {
    // Dead token: each of ~34 requests fails with GhError 502. The summary
    // must propagate the error (the route returns 502 and does not cache empty
    // results) rather than returning {date} with a 200 code as it did before the fix.
    const failing: SummaryClient = {
      dailyRollUp: vi.fn(async () => {
        throw new GhError('OAuth refresh failed: Token has been expired or revoked.', 502);
      }),
      list: vi.fn(async () => {
        throw new GhError('OAuth refresh failed: Token has been expired or revoked.', 502);
      }),
    };
    await expect(buildSummary('2026-07-22', failing)).rejects.toBeInstanceOf(GhError);
  });

  it('all requests failed with a regular error → throws it', async () => {
    const failing: SummaryClient = {
      dailyRollUp: vi.fn(async () => {
        throw new Error('network down');
      }),
      list: vi.fn(async () => {
        throw new Error('network down');
      }),
    };
    await expect(buildSummary('2026-07-22', failing)).rejects.toThrow('network down');
  });
});
