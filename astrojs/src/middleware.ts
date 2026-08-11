/**
 * Astro middleware: applies security headers and a request-id header to every
 * response (pages + API routes). Applied globally so the HTML pages and the
 * JSON routes share the same hardening without duplicating header logic.
 */
import { defineMiddleware } from 'astro:middleware';
import { makeRequestMeta } from './lib/request-meta';
import { redact, hasGoogleUserId } from './lib/privacy';

/** Security headers hardening every response (pages and API alike). */
const SECURITY_HEADERS: Record<string, string> = {
  // No third-party framing / MIME sniffing / referrer leakage.
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; " +
    "base-uri 'self'; form-action 'self'",
};

export const onRequest = defineMiddleware(async (context, next) => {
  const meta = makeRequestMeta();

  const response = await next();
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  headers.set('x-request-id', meta.id);
  headers.set('x-request-duration-ms', String(meta.elapsedMs()));
  // Keep pages out of heuristics/indexing (already noindex in markup).
  headers.set('Cache-Control', 'no-store');

  // Optionally log the request path without leaking tokens/user ids.
  const path = context.url.pathname + context.url.search;
  const safePath = hasGoogleUserId(path) ? redact(path) : path;
  // Deliberately minimal: path + status + duration. No query secrets, no body.
  // Safe log line; a real system would route this through a logger.
  if (context.url.pathname.startsWith('/api/')) {
    console.log(`[gh] ${response.status} ${String(meta.elapsedMs()).padEnd(6)}ms ${safePath.slice(0, 160)}`);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
