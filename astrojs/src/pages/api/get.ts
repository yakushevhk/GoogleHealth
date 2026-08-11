/**
 * GET /api/get?type=X&id=Y — read a single raw data point.
 */
import type { APIRoute } from 'astro';
import { json, jsonError } from '@lib/api-utils';
import { ghGet } from '@lib/gh-client';
import { isDataType } from '@lib/gh-types';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const id = url.searchParams.get('id');
  if (!type || !id) {
    return json({ error: 'Missing type or id' }, 400);
  }
  if (!isDataType(type)) {
    return json({ error: `Unknown data type: ${type}` }, 400);
  }
  try {
    const dataPoint = await ghGet(type, id);
    return json(dataPoint);
  } catch (e) {
    return jsonError(e);
  }
};
