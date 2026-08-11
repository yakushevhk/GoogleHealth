/**
 * Thin HTTP helpers for API routes: JSON responses with security headers,
 * error-to-JSON mapping (reusing `errors.ts`), and request metric hooks.
 */
import { messageOf, statusOf } from './errors';
import { countMetric, makeRequestMeta } from './request-meta';

/** Security headers applied to every JSON API response. */
const DEFAULT_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...DEFAULT_HEADERS, ...extra },
  });
}

export interface ApiContext {
  /** request meta (id + timing) for correlation headers. */
  meta?: ReturnType<typeof makeRequestMeta>;
}

/** JSON success response with request-id/timing headers. */
export function jsonOk(data: unknown, ctx: ApiContext = {}, status = 200): Response {
  const headers: Record<string, string> = {};
  if (ctx.meta) {
    headers['x-request-id'] = ctx.meta.id;
    headers['x-request-duration-ms'] = String(ctx.meta.elapsedMs());
  }
  countMetric('cache_miss');
  return json(data, status, headers);
}

/** Serialize a thrown error to a JSON response, keeping the status mapping. */
export function jsonError(e: unknown, ctx: ApiContext = {}): Response {
  const status = statusOf(e);
  const message = messageOf(e);
  const headers: Record<string, string> = {};
  if (ctx.meta) {
    headers['x-request-id'] = ctx.meta.id;
    headers['x-request-duration-ms'] = String(ctx.meta.elapsedMs());
  }
  return json({ error: message, requestId: ctx.meta?.id ?? null }, status, headers);
}

/** Read and validate a JSON request body. */
export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new TypeError('Invalid JSON in request body');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Request body must be a JSON object');
  }
  return parsed as T;
}
