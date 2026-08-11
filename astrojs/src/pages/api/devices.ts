/** GET /api/devices — paired devices. */
import type { APIRoute } from 'astro';
import { json, jsonError } from '@lib/api-utils';
import { apiCache } from '@lib/cache';
import { ghPairedDevices } from '@lib/gh-client';

export const GET: APIRoute = async () => {
  try {
    const devices = await apiCache.orFetch('devices', () => ghPairedDevices());
    return json(devices);
  } catch (e) {
    return jsonError(e);
  }
};
