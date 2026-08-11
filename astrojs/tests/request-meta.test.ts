import { afterEach, describe, expect, it } from 'vitest';
import {
  countCustom,
  countMetric,
  makeRequestMeta,
  metricSnapshot,
  resetMetrics,
} from '@lib/request-meta';

describe('request-meta', () => {
  afterEach(() => resetMetrics());

  it('assigns a unique id per call', () => {
    const a = makeRequestMeta();
    const b = makeRequestMeta();
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it('elapsedMs returns a non-negative number', () => {
    const m = makeRequestMeta();
    expect(typeof m.elapsedMs()).toBe('number');
    expect(m.elapsedMs()).toBeGreaterThanOrEqual(0);
  });

  it('counts metrics and exposes a safe snapshot', () => {
    countMetric('cache_hit');
    countMetric('cache_hit');
    countMetric('cache_miss');
    countCustom('upstream_ms', 5);
    const s = metricSnapshot();
    expect(s.cache_hit).toBe(2);
    expect(s.cache_miss).toBe(1);
    // 'upstream' is one of the built-ins; custom name added separately on top
    expect(s.upstream_ms).toBe(5);
  });

  it('reset clears counters', () => {
    countMetric('cache_hit');
    resetMetrics();
    expect(metricSnapshot().cache_hit).toBe(0);
  });
});
