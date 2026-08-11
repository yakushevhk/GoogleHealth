/**
 * GET /api/sync?type=X&since=RFC3339[&until=RFC3339] — delta sync via reconcile:
 * returns the data points of the type changed since `since`.
 *
 * The generic `update_time` filter is rejected by the API, so the filter is
 * built per data type (buildSyncFilter), exactly like the MCP sync_data_points
 * tool (SyncDataPoints::build_filter in GoogleHealth/src/tools.rs).
 */
import type { APIRoute } from 'astro';
import { json, jsonError } from '@lib/api-utils';
import { buildSyncFilter, isDate, isRfc3339 } from '@lib/filters';
import { ghReconcile } from '@lib/gh-client';
import { isDataType } from '@lib/gh-types';

/** since/until: RFC3339 or YYYY-MM-DD (for daily/civil types buildSyncFilter
 * itself trims the label to date — the MCP sync_data_points contract allows both). */
const validSyncTime = (s: string): boolean => isRfc3339(s) || isDate(s);

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const since = url.searchParams.get('since');
  const until = url.searchParams.get('until') || undefined;
  if (!type) {
    return json({ error: 'Missing type' }, 400);
  }
  if (!isDataType(type)) {
    return json({ error: `Unknown data type: ${type}` }, 400);
  }
  // since/until are interpolated into the AIP-160 filter text in quotes —
  // without strict validation filter semantics could be tampered with.
  if (since !== null && !validSyncTime(since)) {
    return json({ error: 'since must be RFC3339 or YYYY-MM-DD' }, 400);
  }
  if (until !== undefined && !validSyncTime(until)) {
    return json({ error: 'until must be RFC3339 or YYYY-MM-DD' }, 400);
  }
  try {
    const filter = since ? buildSyncFilter(type, since, until) : undefined;
    const res = await ghReconcile(type, filter);
    return json(res);
  } catch (e) {
    return jsonError(e);
  }
};
