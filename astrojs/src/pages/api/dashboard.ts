/**
 * GET /api/dashboard?date=YYYY-MM-DD
 *
 * Single source for the dashboard's main page. Currently returns the full daily
 * `summary` (all sections) plus a timestamp and per-section availability map —
 * so the client can render once and know exactly what loaded vs what's missing,
 * instead of issuing ~30 parallel /api/* calls.
 *
 * The heavy lifting is `buildSummary`, which is already cached by date
 * (60 s TTL) and single-flight via `apiCache.orFetch`, so repeated dashboard
 * loads for the same day hit the cache.
 */
import type { APIRoute } from 'astro';
import { jsonOk, jsonError } from '@lib/http';
import { makeRequestMeta } from '@lib/request-meta';
import { apiCache, CACHE_PREFIXES } from '@lib/cache';
import { ghDailyRollUp, ghList } from '@lib/gh-client';
import { queryDate } from '@lib/api-utils';
import { todayLocal } from '@lib/filters';
import { buildSummary, type SummaryClient } from '@lib/summary';
import { countMetric } from '@lib/request-meta';

const client: SummaryClient = {
  dailyRollUp: (dt, startDate, endDate) =>
    ghDailyRollUp(dt, { startDate, endDate, windowSizeDays: 1 }),
  list: (dt, filter, pageSize) => ghList(dt, { filter, pageSize }),
};

/** Which top-level sections exist in the summary for a given day. */
function sectionMap(s: Record<string, unknown>): Record<string, boolean> {
  const has = (keys: string[]): boolean => keys.some((k) => s[k] !== undefined && s[k] !== null);
  return {
    vitals: has(['heart_rate', 'heart_rate_variability', 'oxygen_saturation', 'resting_heart_rate']),
    activity: has(['steps', 'active_calories', 'active_minutes', 'distance']),
    heart: has(['heart_rate', 'resting_heart_rate', 'heart_rate_variability', 'hrv_sample']),
    sleep: has(['sleep']),
    body: has(['weight_rollup', 'body_fat', 'blood_glucose', 'core_body_temperature']),
    exercise: has(['exercise']),
    misc: has(['sedentary_period', 'nutrition_log', 'hydration_log', 'swim_lengths']),
  };
}

export const GET: APIRoute = async ({ request }) => {
  const meta = makeRequestMeta();
  const url = new URL(request.url);
  const date = queryDate(url, todayLocal());
  if (date instanceof Response) return date;

  try {
    const summary = await apiCache.orFetch(
      `${CACHE_PREFIXES.summary}${date}`,
      () => buildSummary(date, client),
    );
    countMetric('upstream');
    const sections = sectionMap(summary as unknown as Record<string, unknown>);
    return jsonOk(
      {
        date,
        takenAt: new Date().toISOString(),
        summary,
        sections,
      },
      { meta },
    );
  } catch (e) {
    return jsonError(e, { meta });
  }
};
