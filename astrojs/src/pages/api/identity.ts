/** GET /api/identity — Google Health identity. */
import type { APIRoute } from 'astro';
import { json, jsonError } from '@lib/api-utils';
import { apiCache } from '@lib/cache';
import { ghGetIdentity } from '@lib/gh-client';

export const GET: APIRoute = async () => {
  try {
    const identity = await apiCache.orFetch('identity', () => ghGetIdentity());
    return json(identity);
  } catch (e) {
    return jsonError(e);
  }
};
