/**
 * GET /api/intraday?type=heart-rate&date=YYYY-MM-DD&window=3600s
 * Intraday aggregations (rollUp with a window, default 1 hour).
 *
 * Response: { type, date, window, points: [{time, sum?, avg?, min?, max?}] }
 */
import type { APIRoute } from 'astro';
import { json, jsonError, queryDate } from '@lib/api-utils';
import { apiCache, CACHE_PREFIXES } from '@lib/cache';
import { extractAggregates, kebabToCamel } from '@lib/extract';
import { todayLocal } from '@lib/filters';
import { ghRollUpAll } from '@lib/gh-client';
import { ROLLUP_TYPES } from '@lib/gh-types';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const type = url.searchParams.get('type') ?? '';
  const windowSize = url.searchParams.get('window') ?? '3600s';
  const date = queryDate(url, todayLocal());
  if (date instanceof Response) return date;

  if (!ROLLUP_TYPES.includes(type)) {
    return json({ error: `Type ${type} does not support rollUp` }, 400);
  }
  if (!/^\d+s$/.test(windowSize)) {
    return json({ error: 'window must be a duration like 3600s' }, 400);
  }

  // Client timezone offset (minutes, Date.getTimezoneOffset format = UTC−local).
  // Without parameter — previous behavior: window from UTC midnight.
  const offsetRaw = url.searchParams.get('offsetMin');
  const offsetMin = offsetRaw === null ? 0 : Number(offsetRaw);
  if (!Number.isFinite(offsetMin) || Math.abs(offsetMin) > 1440) {
    return json({ error: 'offsetMin must be a finite number of minutes (±1440)' }, 400);
  }

  // Client civil day in UTC: local midnight = dateT00:00Z + offsetMin.
  // For UTC+3 offsetMin = −180 → 21:00Z previous day = 00:00 local time,
  // so hourly buckets start at 00:00 local, not 03:00.
  const startMs = Date.parse(`${date}T00:00:00Z`) + offsetMin * 60_000;
  // queryDate only checks format: 2026-13-45 passes regex, but
  // Date.parse gives NaN, and toISOString() below would throw RangeError (500).
  if (Number.isNaN(startMs)) {
    return json({ error: `Invalid date: ${date}` }, 400);
  }

  try {
    const points = await apiCache.orFetch(
      `${CACHE_PREFIXES.intraday}${type}:${date}:${windowSize}:${offsetMin}`,
      async () => {
        const startTime = new Date(startMs).toISOString();
        const endTime = new Date(startMs + 86_400_000).toISOString();
        // ghRollUpAll: per-minute windows (60s → up to 1440 points) without pagination
        // are silently cut by Google's default page size
        const rollupPoints = await ghRollUpAll(type, { startTime, endTime, windowSize });
        const field = kebabToCamel(type);
        return rollupPoints.map((p) => ({
          time: p.startTime ?? '',
          ...extractAggregates(p[field]),
        }));
      },
    );
    return json({ type, date, window: windowSize, points });
  } catch (e) {
    return jsonError(e);
  }
};
