/**
 * GET /api/metrics
 * Runtime counters for the dashboard (cache hits/misses, upstream calls,
 * custom counters). No PII, no secrets — safe to expose.
 */
import type { APIRoute } from 'astro';
import { jsonOk } from '@lib/http';
import { makeRequestMeta, metricSnapshot } from '@lib/request-meta';
import { apiCache } from '@lib/cache';

export const GET: APIRoute = async () => {
  const meta = makeRequestMeta();
  return jsonOk(
    {
      metrics: metricSnapshot(),
      cache: { size: apiCache.size },
      generatedAt: new Date().toISOString(),
    },
    { meta },
  );
};
