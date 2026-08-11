/**
 * GET /api/summary?date=YYYY-MM-DD
 * Full daily summary (~33 metrics, in parallel batches of 10).
 * Response shape = MCP tool today/yesterday shape.
 */
import type { APIRoute } from 'astro';
import { json, jsonError, queryDate } from '@lib/api-utils';
import { apiCache, CACHE_PREFIXES } from '@lib/cache';
import { ghDailyRollUp, ghList } from '@lib/gh-client';
import { todayLocal } from '@lib/filters';
import { buildSummary, type SummaryClient } from '@lib/summary';

const client: SummaryClient = {
  dailyRollUp: (dt, startDate, endDate) =>
    ghDailyRollUp(dt, { startDate, endDate, windowSizeDays: 1 }),
  list: (dt, filter, pageSize) => ghList(dt, { filter, pageSize }),
};

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const date = queryDate(url, todayLocal());
  if (date instanceof Response) return date;

  try {
    const summary = await apiCache.orFetch(`${CACHE_PREFIXES.summary}${date}`, () =>
      buildSummary(date, client),
    );
    return json(summary);
  } catch (e) {
    return jsonError(e);
  }
};
