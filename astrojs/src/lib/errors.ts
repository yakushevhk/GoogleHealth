/**
 * Typed errors for the dashboard + HTTP status mapping.
 *
 * Isomorphic module: used by server API routes (to pick a status code) and by
 * tests. Centralizes the "which error → which HTTP status / user message"
 * decision so routes stay thin and consistent.
 */

export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL: 500,
  BAD_GATEWAY: 502,
} as const;

/** Upstream Google Health API error. */
export class GhError extends Error {
  constructor(
    message: string,
    public status: number = HTTP_STATUS.BAD_GATEWAY,
  ) {
    super(message);
    this.name = 'GhError';
  }
}

/**
 * Configuration error — credentials missing or unusable.
 * Mapped to 502 (upstream auth problem → the default 400+ would mislead the UI
 * into thinking the request itself was wrong).
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Client-supplied arguments are invalid (bad date, bad type, ...). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Provider currently unavailable / rate-limited. */
export class UpstreamError extends Error {
  constructor(
    message: string,
    public status: number = HTTP_STATUS.BAD_GATEWAY,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/**
 * Map an unknown thrown error to a response status and a JSON-safe message.
 * - Upstream auth/config problems → 502 (so the UI shows its calm
 *   "no connection to Google Health" block instead of a 500 red card);
 * - validation → 400;
 * - everything else → 500.
 */
export function statusOf(e: unknown): number {
  if (e instanceof GhError) {
    // 401/403 from Google = upstream auth problem, not the dashboard's → 502
    return e.status >= 500 || e.status === 401 || e.status === 403
      ? HTTP_STATUS.BAD_GATEWAY
      : e.status;
  }
  if (e instanceof ConfigError) return HTTP_STATUS.BAD_GATEWAY;
  if (e instanceof ValidationError) return HTTP_STATUS.BAD_REQUEST;
  if (e instanceof UpstreamError) return e.status;
  return HTTP_STATUS.INTERNAL;
}

/** JSON-safe message for an unknown error (never leaks stack/exceptions). */
export function messageOf(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Unexpected error';
}
