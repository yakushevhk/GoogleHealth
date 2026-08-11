/**
 * POST /api/cache-clear — drop the whole in-memory read cache.
 */
import type { APIRoute } from 'astro';
import { json, jsonError } from '@lib/api-utils';
import { apiCache } from '@lib/cache';

export const POST: APIRoute = async () => {
  try {
    apiCache.clear();
    return json({ cleared: true });
  } catch (e) {
    return jsonError(e);
  }
};
