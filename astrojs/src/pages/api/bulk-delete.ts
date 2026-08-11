/**
 * POST /api/bulk-delete — delete several data points in one call.
 * Body: { dataType, names: string[] } (full resource names).
 */
import type { APIRoute } from 'astro';
import { invalidateReadCache, json, jsonError, readJson } from '@lib/api-utils';
import { ghBatchDelete } from '@lib/gh-client';
import { isDataType } from '@lib/gh-types';

/** Google batchDelete limit — 10,000 names per request. */
const MAX_NAMES = 10000;

export const POST: APIRoute = async ({ request }) => {
  try {
    const payload = await readJson<{ dataType?: string; names?: string[] }>(request);
    const { dataType, names } = payload;
    if (!dataType || !Array.isArray(names) || names.length === 0) {
      return json({ error: 'Missing dataType or names[]' }, 400);
    }
    if (!isDataType(dataType)) {
      return json({ error: `Unknown data type: ${dataType}` }, 400);
    }
    if (names.length > MAX_NAMES) {
      return json({ error: `names[] is limited to ${MAX_NAMES} entries per request` }, 400);
    }
    if (!names.every((n) => typeof n === 'string' && n.length > 0)) {
      return json({ error: 'names must be non-empty strings' }, 400);
    }
    await ghBatchDelete(dataType, names);
    invalidateReadCache();
    return json({ success: true, deleted: names.length });
  } catch (e) {
    return jsonError(e);
  }
};
