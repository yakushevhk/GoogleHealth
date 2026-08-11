/**
 * GET /api/healthz
 * Liveness probe: the server process is up. Never touches Google Health.
 */
import type { APIRoute } from 'astro';
import { jsonOk } from '@lib/http';

export const GET: APIRoute = async () => {
  return jsonOk({ status: 'ok' });
};
