/**
 * POST /api/patch — update a single data point.
 * Body: { dataType, dataPointId, body }
 */
import type { APIRoute } from 'astro';
import { invalidateReadCache, json, jsonError, readJson } from '@lib/api-utils';
import { ghPatch } from '@lib/gh-client';
import { isDataType } from '@lib/gh-types';

export const POST: APIRoute = async ({ request }) => {
  try {
    const payload = await readJson<{ dataType?: string; dataPointId?: string; body?: unknown }>(request);
    const { dataType, dataPointId, body } = payload;
    if (!dataType || !dataPointId || !body) {
      return json({ error: 'Missing dataType, dataPointId or body' }, 400);
    }
    if (!isDataType(dataType)) {
      return json({ error: `Unknown data type: ${dataType}` }, 400);
    }
    const updated = await ghPatch(dataType, dataPointId, body);
    invalidateReadCache();
    return json(updated);
  } catch (e) {
    return jsonError(e);
  }
};
