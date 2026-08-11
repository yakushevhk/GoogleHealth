/**
 * GET /api/settings — read user settings.
 * POST /api/settings — update user settings (JSON body).
 */
import type { APIRoute } from 'astro';
import { json, jsonError, readJson } from '@lib/api-utils';
import { apiCache } from '@lib/cache';
import { ghGetSettings, ghUpdateSettings } from '@lib/gh-client';

export const GET: APIRoute = async () => {
  try {
    const settings = await apiCache.orFetch('settings', () => ghGetSettings());
    return json(settings);
  } catch (e) {
    return jsonError(e);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await readJson(request);
    const updated = await ghUpdateSettings(body);
    apiCache.invalidatePrefix('settings');
    return json(updated);
  } catch (e) {
    return jsonError(e);
  }
};
