/**
 * Astro middleware: applies security headers and a request-id header to every
 * response (pages + API routes). Applied globally so the HTML pages and the
 * JSON routes share the same hardening without duplicating header logic.
 */
import { defineMiddleware } from 'astro:middleware';
import { makeRequestMeta } from './lib/request-meta';
import {
  redact,
  redactGoogleUserId,
  looksLikeCredential,
  hasGoogleUserId,
} from './lib/privacy';

/** Security headers hardening every response (pages and API alike). */
const SECURITY_HEADERS: Record<string, string> = {
  // No third-party framing / MIME sniffing / referrer leakage.
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy':
    "default-src 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; " +
    "base-uri 'self'; form-action 'self'",
};

/** Redact credentials AND a numeric Google user id from a log-safe path. */
function safePath(raw: string): string {
  if (hasGoogleUserId(raw) || looksLikeCredential(raw)) {
    return redactGoogleUserId(redact(raw));
  }
  return raw;
}

/** Strip sensitive query params, keeping only an allowlist for logs. */
const LOG_ALLOW = new Set(['mode', 'days', 'endDate', 'startDate', 'type', 'window']);
function safeSearch(search: string): string {
  if (!search) return '';
  const params = new URLSearchParams(search);
  const kept: string[] = [];
  for (const key of LOG_ALLOW) {
    const cur = params.get(key);
    if (cur !== null) kept.push(`${key}=${cur}`);
  }
  return kept.length ? '?' + kept.join('&') : '';
}

export const onRequest = defineMiddleware(async (context, next) => {
  const meta = makeRequestMeta();

  const response = await next();
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  // The route (http.ts) may already have set request-id/duration from its own
  // meta; ensure a consistent id exists without stamping over the route's one.
  if (!headers.has('x-request-id')) headers.set('x-request-id', meta.id);
  if (!headers.has('x-request-duration-ms')) {
    headers.set('x-request-duration-ms', String(meta.elapsedMs()));
  }
  // Keep pages out of heuristics/indexing (already noindex in markup).
  headers.set('Cache-Control', 'no-store');

  if (context.url.pathname.startsWith('/api/')) {
    const path = context.url.pathname + safeSearch(context.url.search);
    const safe = safePath(path);
    console.log(`[gh] ${response.status} ${String(meta.elapsedMs()).padEnd(6)}ms ${safe.slice(0, 160)}`);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
