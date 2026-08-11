/** GET /api/profile — Google Health profile. */
import type { APIRoute } from 'astro';
import { json, jsonError } from '@lib/api-utils';
import { apiCache } from '@lib/cache';
import { ghGetProfile } from '@lib/gh-client';

export const GET: APIRoute = async () => {
  try {
    const profile = await apiCache.orFetch('profile', () => ghGetProfile());
    return json(profile);
  } catch (e) {
    return jsonError(e);
  }
};
