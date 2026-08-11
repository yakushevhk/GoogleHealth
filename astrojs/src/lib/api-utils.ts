/** Shared helpers for server API routes. */
import { apiCache, CACHE_PREFIXES } from '@lib/cache';
import { GhError } from '@lib/gh-client';

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Parse JSON request body. Broken JSON — client error (400),
 * not 500: request.json() throws SyntaxError. Body must be
 * a JSON object: `null`, array or number will break destructuring
 * in routes (also 400, not 500).
 */
export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new GhError('Invalid JSON in request body', 400);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new GhError('Request body must be a JSON object', 400);
  }
  return parsed as T;
}

export function jsonError(e: unknown): Response {
  if (e instanceof GhError) {
    // 401/403 from Google = upstream auth problem, not the dashboard's — map to 502
    const status = e.status >= 500 || e.status === 401 || e.status === 403 ? 502 : e.status;
    return json({ error: e.message }, status);
  }
  const msg = e instanceof Error ? e.message : String(e);
  return json({ error: msg }, 500);
}

/** Invalidate all read caches after a write/delete operation. */
export function invalidateReadCache(): void {
  for (const prefix of Object.values(CACHE_PREFIXES)) {
    apiCache.invalidatePrefix(prefix);
  }
}

/** YYYY-MM-DD and a real calendar date (not 2026-02-30). */
export function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

export function queryDate(url: URL, fallback: string): string | Response {
  const date = url.searchParams.get('date') ?? fallback;
  if (!isRealDate(date)) {
    return json({ error: 'date must be a valid YYYY-MM-DD date' }, 400);
  }
  return date;
}
