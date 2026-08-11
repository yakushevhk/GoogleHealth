/** GET /api/irn — irregular rhythm notification (IRN) profile. */
import type { APIRoute } from 'astro';
import { json, jsonError } from '@lib/api-utils';
import { apiCache } from '@lib/cache';
import { ghGetIrnProfile } from '@lib/gh-client';

export const GET: APIRoute = async () => {
  try {
    const profile = await apiCache.orFetch('irnProfile', () => ghGetIrnProfile());
    return json(profile);
  } catch (e) {
    return jsonError(e);
  }
};
