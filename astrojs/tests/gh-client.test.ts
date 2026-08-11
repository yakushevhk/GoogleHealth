import { describe, expect, it, vi } from 'vitest';
import { GhError, GH_BASE, assertResourceName, assertSegment } from '@lib/gh-client';

describe('GhError', () => {
  it('has status and message properties', () => {
    const err = new GhError('quota exceeded', 429);
    expect(err.message).toBe('quota exceeded');
    expect(err.status).toBe(429);
  });

  it('is an instance of Error', () => {
    const err = new GhError('fail', 500);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GhError);
  });

  it('has name "GhError"', () => {
    const err = new GhError('test');
    expect(err.name).toBe('GhError');
  });

  it('defaults status to 502', () => {
    const err = new GhError('upstream problem');
    expect(err.status).toBe(502);
  });

  it('preserves stack trace', () => {
    const err = new GhError('with stack', 500);
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('with stack');
  });
});

describe('GH_BASE', () => {
  it('points to Google Health v4 API', () => {
    expect(GH_BASE).toBe('https://health.googleapis.com/v4/users/me');
  });
});

describe('path safety — assertSegment / assertResourceName', () => {
  // dataType/dataPointId are interpolated into the Google API URL path: without
  // these checks, %2F and dot-segments can redirect requests to adjacent paths (../profile).
  it('assertSegment accepts safe IDs', () => {
    expect(() => assertSegment('12345', 'id')).not.toThrow();
    expect(() => assertSegment('abc-DEF_9', 'id')).not.toThrow();
  });

  it('assertSegment rejects traversal and slashes (GhError 400)', () => {
    for (const bad of ['..', '../profile', 'a/b', 'a%2Fb', '', 'a b', 'x:y']) {
      try {
        assertSegment(bad, 'id');
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(GhError);
        expect((e as GhError).status).toBe(400);
      }
    }
  });

  it('assertResourceName accepts the "me" alias and a real numeric user id', () => {
    // Regression: Google's list responses return users/<numeric-id>/...,
    // not users/me/... — the regex must accept both forms, otherwise bulk-delete
    // with names from /api/list fails with 400.
    expect(() =>
      assertResourceName('users/me/dataTypes/weight/dataPoints/123'),
    ).not.toThrow();
    expect(() =>
      assertResourceName('users/123456789/dataTypes/weight/dataPoints/12345'),
    ).not.toThrow();
  });

  it('assertResourceName rejects path forgery (GhError 400)', () => {
    const bad = [
      'users/me/dataTypes/weight/dataPoints/../../../profile',
      'users/me/dataTypes/weight/dataPoints:batchDelete',
      'users/../dataTypes/weight/dataPoints/1',
      'users/abc/dataTypes/weight/dataPoints/1', // user — me or numeric only
      'users/me/dataTypes/../profile/dataPoints/1',
      'users/me/dataTypes/weight/dataPoints/',
      'not-a-name',
    ];
    for (const name of bad) {
      try {
        assertResourceName(name);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(GhError);
        expect((e as GhError).status).toBe(400);
      }
    }
  });
});

describe('ghRollUpAll', () => {
  it('iterates all rollUp pages via nextPageToken and passes pageSize', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh';

    const rollupBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'test-token', expires_in: 3600 }),
          { status: 200 },
        );
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      rollupBodies.push(body);
      if (body.pageToken === 'page-2') {
        return new Response(
          JSON.stringify({
            rollupDataPoints: [{ startTime: '2026-07-28T00:01:00Z', heartRate: { beatsPerMinuteAvg: 70 } }],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          rollupDataPoints: [{ startTime: '2026-07-28T00:00:00Z', heartRate: { beatsPerMinuteAvg: 80 } }],
          nextPageToken: 'page-2',
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const { ghRollUpAll } = await import('@lib/gh-client');
      const pts = await ghRollUpAll('heart-rate', {
        startTime: '2026-07-28T00:00:00Z',
        endTime: '2026-07-29T00:00:00Z',
        windowSize: '60s',
      });

      // both pages collected, order preserved
      expect(pts).toHaveLength(2);
      expect(pts[0].startTime).toBe('2026-07-28T00:00:00Z');
      expect(pts[1].startTime).toBe('2026-07-28T00:01:00Z');

      // pageSize=1000 in both requests, pageToken in the second
      expect(rollupBodies).toHaveLength(2);
      expect(rollupBodies[0].pageSize).toBe(1000);
      expect(rollupBodies[0].pageToken).toBeUndefined();
      expect(rollupBodies[1].pageToken).toBe('page-2');
      expect(rollupBodies[1].windowSize).toBe('60s');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
