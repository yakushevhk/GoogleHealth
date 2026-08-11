/**
 * GET /api/list?type=sleep&date=YYYY-MM-DD&pageSize=100
 * Raw data points for a day (filter is built automatically by type).
 */
import type { APIRoute } from 'astro';
import { json, jsonError, queryDate } from '@lib/api-utils';
import { apiCache, CACHE_PREFIXES } from '@lib/cache';
import { buildDayFilter, todayLocal } from '@lib/filters';
import { ghList } from '@lib/gh-client';
import { LISTABLE_TYPES } from '@lib/gh-types';

/** API page size limit for session types. */
const SESSION_LIMIT: Record<string, number> = { exercise: 25, sleep: 25 };

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const type = url.searchParams.get('type') ?? '';
  const date = queryDate(url, todayLocal());
  if (date instanceof Response) return date;

  if (!LISTABLE_TYPES.includes(type)) {
    return json(
      { error: `Type ${type} does not support list (use rollUp)` },
      400,
    );
  }

  const requested = Number(url.searchParams.get('pageSize') ?? '100');
  const cap = SESSION_LIMIT[type] ?? 10000;
  const pageSize = Math.min(Math.max(requested || 100, 1), cap);
  const pageToken = url.searchParams.get('pageToken') ?? undefined;

  try {
    const cacheKey = pageToken
      ? `${CACHE_PREFIXES.list}${type}:${date}:${pageSize}:${pageToken}`
      : `${CACHE_PREFIXES.list}${type}:${date}:${pageSize}`;
    const data = await apiCache.orFetch(
      cacheKey,
      () => ghList(type, { filter: buildDayFilter(type, date), pageSize, pageToken }),
    );
    return json(data);
  } catch (e) {
    return jsonError(e);
  }
};
