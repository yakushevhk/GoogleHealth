/**
 * Google Health API v4 client. Mirrors the logic of GoogleHealth/src/auth.rs:
 * OAuth2 refresh token -> in-memory access token cache -> on 401 refresh + 1 retry.
 *
 * The token is never sent to the browser: the client runs only on the server
 * (in Astro API routes).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CivilDate, ListResponse, RollupPoint, RollupResponse } from './gh-types';

export const GH_BASE = 'https://health.googleapis.com/v4/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * In dev, Astro loads .env automatically; in production (node dist/server/entry.mjs)
 * we load .env manually, only if the variables are not yet set.
 * Memoize the promise: parallel requests wait for a single load.
 */
let envPromise: Promise<void> | null = null;
function ensureEnv(): Promise<void> {
  envPromise ??= (async () => {
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) return;
    try {
      const raw = await readFile(path.resolve(process.cwd(), '.env'), 'utf8');
      for (const line of raw.split('\n')) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m || line.trim().startsWith('#')) continue;
        const [, key, val] = m;
        if (process.env[key] === undefined || process.env[key] === '') {
          process.env[key] = val.replace(/^["']|["']$/g, '');
        }
      }
    } catch {
      /* no .env — relying on env vars and health_token.json */
    }
  })();
  return envPromise;
}

export class GhError extends Error {
  constructor(
    message: string,
    public status: number = 502,
  ) {
    super(message);
    this.name = 'GhError';
  }
}

interface Credentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

let creds: Credentials | null = null;
let credsPromise: Promise<Credentials> | null = null;
let accessToken = '';
let tokenExpiresAt = 0;

/**
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN from env
 * (Astro loads .env automatically). If GOOGLE_REFRESH_TOKEN is not set,
 * the refresh_token is read from a file (GH_TOKEN_FILE, defaults to ../health_token.json).
 */
function getCredentials(): Promise<Credentials> {
  credsPromise ??= (async () => {
    try {
      if (creds) return creds;
      await ensureEnv();

      const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
      let refreshToken = process.env.GOOGLE_REFRESH_TOKEN ?? '';

      if (!refreshToken) {
        const tokenFile = path.resolve(
          process.cwd(),
          process.env.GH_TOKEN_FILE ?? '../health_token.json',
        );
        try {
          const raw = JSON.parse(await readFile(tokenFile, 'utf8')) as {
            refresh_token?: string;
          };
          refreshToken = raw.refresh_token ?? '';
        } catch {
          throw new GhError(
            `No GOOGLE_REFRESH_TOKEN in env and no refresh_token found in ${tokenFile}`,
            500,
          );
        }
      }

      if (!clientId || !clientSecret || !refreshToken) {
        throw new GhError(
          'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN are not set',
          500,
        );
      }

      creds = { clientId, clientSecret, refreshToken };
      return creds;
    } catch (e) {
      // Do not memoize failures: otherwise the process would remember the error
      // forever and never pick up a newly added token/file without a restart.
      credsPromise = null;
      throw e;
    }
  })();
  return credsPromise;
}

let refreshPromise: Promise<string> | null = null;
// Negative cache for OAuth failures: with a dead refresh token every request
// would otherwise make its own POST to oauth2.googleapis.com (~33 for a single /api/summary).
let authFailAt = 0;
let authFailError: GhError | null = null;
const AUTH_FAIL_BACKOFF_MS = 30_000;

function refreshAccessToken(): Promise<string> {
  refreshPromise ??= (async () => {
    let fromCache = false;
    try {
      if (authFailError && Date.now() - authFailAt < AUTH_FAIL_BACKOFF_MS) {
        fromCache = true;
        throw authFailError;
      }
      const c = await getCredentials();
      // Same 30s timeout as doFetch: a hung oauth2.googleapis.com must not
      // block getToken() (which every request awaits).
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30_000);
      let resp: Response;
      try {
        resp = await fetch(TOKEN_URL, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: c.clientId,
            client_secret: c.clientSecret,
            refresh_token: c.refreshToken,
            grant_type: 'refresh_token',
          }),
        });
      } finally {
        clearTimeout(timer);
      }
      const body = (await resp.json().catch(() => ({}))) as {
        access_token?: string;
        expires_in?: number;
        error_description?: string;
      };
      if (!resp.ok || !body.access_token) {
        throw new GhError(
          `OAuth refresh failed: ${body.error_description ?? resp.statusText}`,
          502,
        );
      }
      accessToken = body.access_token;
      // Track expiry with 60s safety margin (mirrors Rust EXPIRY_MARGIN)
      tokenExpiresAt = Date.now() + (body.expires_in ?? 3600) * 1000 - 60_000;
      authFailError = null;
      return accessToken;
    } catch (e) {
      // A cached failure does not extend the backoff window: otherwise frequent
      // requests (< 30s) would postpone the OAuth retry indefinitely.
      if (!fromCache) {
        authFailError = e instanceof GhError ? e : new GhError(`OAuth refresh: ${(e as Error).message}`, 502);
        authFailAt = Date.now();
      }
      throw e;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function getToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
  return refreshAccessToken();
}

async function doFetch(
  url: string,
  init: RequestInit,
  token: string,
): Promise<{ status: number; body: unknown }> {
    // Without a timeout, a hung Google connection permanently occupies a pool slot
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const resp = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    const body = await resp.json().catch(() => ({}));
    return { status: resp.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET/POST with 401 -> refresh -> retry and 429/5xx/network errors -> backoff
 * (0.5/1.5/4 s), like api_get/api_post in Rust. 30s timeout per request:
 * without it, a hung Google connection would hang forever.
 *
 * Retries on 429/5xx/network only happen for idempotent calls: a mutation
 * (create/patch/delete) that succeeded but lost its response must not be
 * re-sent — that would duplicate records. 401 retry is safe for everyone:
 * an unauthenticated request was never processed.
 */
const RETRY_DELAYS_MS = [500, 1500, 4000];

async function apiFetch(
  url: string,
  init: RequestInit = {},
  opts: { idempotent?: boolean } = {},
): Promise<unknown> {
  const idempotent =
    opts.idempotent ?? ((init.method ?? 'GET').toUpperCase() === 'GET');
  for (let attempt = 0; ; attempt++) {
    try {
      let token = await getToken();
      let { status, body } = await doFetch(url, init, token);
      if (status === 401) {
        token = await refreshAccessToken();
        ({ status, body } = await doFetch(url, init, token));
      }
      if (status >= 200 && status < 300) return body;
      if (idempotent && (status === 429 || status >= 500) && attempt < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      const b = body as { error?: { message?: string } };
      throw new GhError(
        b?.error?.message ?? `Google Health API: HTTP ${status}`,
        status,
      );
    } catch (e) {
      if (e instanceof GhError) throw e;
      // network error/timeout — retry with backoff (idempotent only)
      if (idempotent && attempt < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw new GhError(
        `Google Health API: ${(e as Error).message ?? 'network error'}`,
        502,
      );
    }
  }
}

// ─── Path safety ────────────────────────────────────────────────────────────
// dataType and dataPointId are interpolated directly into the Google API URL path.
// searchParams.get() decodes %2F, and WHATWG URL normalizes dot-segments,
// so without validation it's possible to escape into adjacent paths (../profile etc.).

/** Valid path segment characters (dataType, dataPointId). */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;
/**
 * Full resource name: users/{user}/dataTypes/{type}/dataPoints/{id}.
 * Google's list responses return the actual numeric user ID
 * (users/123456789/...) instead of the `me` alias — both must be accepted,
 * otherwise bulk-delete with names from /api/list fails with 400.
 */
const FULL_NAME_RE =
  /^users\/(me|\d+)\/dataTypes\/[A-Za-z0-9_-]+\/dataPoints\/[A-Za-z0-9_-]+$/;

export function assertSegment(value: string, what: string): void {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value)) {
    throw new GhError(`${what} must consist of letters, digits, "-", or "_": "${value}"`, 400);
  }
}

export function assertResourceName(name: string): void {
  if (typeof name !== 'string' || !FULL_NAME_RE.test(name)) {
    throw new GhError(
      `name must have the form users/{user}/dataTypes/{type}/dataPoints/{id}: "${name}"`,
      400,
    );
  }
}

// ─── API method wrappers ────────────────────────────────────────────────────

export async function ghList(
  dataType: string,
  opts: { filter?: string | null; pageSize?: number; pageToken?: string } = {},
): Promise<ListResponse> {
  assertSegment(dataType, 'dataType');
  const params = new URLSearchParams();
  if (opts.filter) params.set('filter', opts.filter);
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.pageToken) params.set('pageToken', opts.pageToken);
  const qs = params.toString();
  const url = `${GH_BASE}/dataTypes/${dataType}/dataPoints${qs ? `?${qs}` : ''}`;
  return (await apiFetch(url)) as ListResponse;
}

/** Maximum pages to fetch in ghListAll to prevent infinite loops. */
const MAX_PAGES = 100;

/** Fetch all dataPoints with pagination (safety-capped at MAX_PAGES). */
export async function ghListAll(
  type: string,
  filter: string | null,
  pageSize: number = 1000,
): Promise<Record<string, unknown>[]> {
  const allPoints: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const resp = await ghList(type, { filter, pageSize, pageToken });
    allPoints.push(...(resp.dataPoints ?? []));
    pageToken = resp.nextPageToken;
    pages++;
  } while (pageToken && pages < MAX_PAGES);
  return allPoints;
}

export async function ghRollUp(
  dataType: string,
  opts: {
    startTime: string;
    endTime: string;
    windowSize: string;
    pageSize?: number;
    pageToken?: string;
  },
): Promise<RollupResponse> {
  assertSegment(dataType, 'dataType');
  const url = `${GH_BASE}/dataTypes/${dataType}/dataPoints:rollUp`;
  const body: Record<string, unknown> = {
    range: { startTime: opts.startTime, endTime: opts.endTime },
    windowSize: opts.windowSize,
  };
  if (opts.pageSize) body.pageSize = opts.pageSize;
  if (opts.pageToken) body.pageToken = opts.pageToken;
  // POST, but this is a read-only request — retries are safe.
  return (await apiFetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
  }, { idempotent: true })) as RollupResponse;
}

/**
 * Fetch all rollupDataPoints with pagination (safety-capped at MAX_PAGES).
 * Required for small windows: window=60s over a day is up to 1440 points,
 * which Google truncates to the default page size without a pageToken loop.
 */
export async function ghRollUpAll(
  dataType: string,
  opts: { startTime: string; endTime: string; windowSize: string; pageSize?: number },
): Promise<RollupPoint[]> {
  const all: RollupPoint[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const resp = await ghRollUp(dataType, {
      ...opts,
      pageSize: opts.pageSize ?? 1000,
      pageToken,
    });
    all.push(...(resp.rollupDataPoints ?? []));
    pageToken = resp.nextPageToken;
    pages++;
  } while (pageToken && pages < MAX_PAGES);
  return all;
}

function civilDate(date: string): CivilDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new GhError(`civilDate: date must be YYYY-MM-DD, got "${date}"`, 400);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Calendar validation: 2026-02-30 etc. Date silently normalizes to March.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new GhError(`civilDate: invalid date "${date}"`, 400);
  }
  return { year, month, day };
}

export async function ghDailyRollUp(
  dataType: string,
  opts: { startDate: string; endDate: string; windowSizeDays?: number },
): Promise<RollupResponse> {
  assertSegment(dataType, 'dataType');
  const url = `${GH_BASE}/dataTypes/${dataType}/dataPoints:dailyRollUp`;
  const body = {
    range: {
      start: { date: civilDate(opts.startDate) },
      end: { date: civilDate(opts.endDate) },
    },
    windowSizeDays: opts.windowSizeDays ?? 1,
  };
  // POST, but this is a read-only request — retries are safe.
  return (await apiFetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
  }, { idempotent: true })) as RollupResponse;
}

export async function ghGetProfile(): Promise<unknown> {
  return apiFetch(`${GH_BASE}/profile`);
}

export async function ghGetIdentity(): Promise<unknown> {
  return apiFetch(`${GH_BASE}/identity`);
}

export async function ghGetIrnProfile(): Promise<unknown> {
  return apiFetch(`${GH_BASE}/irnProfile`);
}

export async function ghGetSettings(): Promise<unknown> {
  return apiFetch(`${GH_BASE}/settings`);
}

export async function ghUpdateSettings(body: unknown): Promise<unknown> {
  return apiFetch(`${GH_BASE}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function ghPairedDevices(): Promise<unknown> {
  return apiFetch(`${GH_BASE}/pairedDevices`);
}

export async function ghCreate(dataType: string, body: unknown): Promise<unknown> {
  assertSegment(dataType, 'dataType');
  const url = `${GH_BASE}/dataTypes/${dataType}/dataPoints`;
  return apiFetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function ghDelete(dataType: string, dataPointId: string): Promise<unknown> {
  assertSegment(dataType, 'dataType');
  let name: string;
  if (dataPointId.includes('/')) {
    assertResourceName(dataPointId);
    name = dataPointId;
  } else {
    assertSegment(dataPointId, 'dataPointId');
    name = `users/me/dataTypes/${dataType}/dataPoints/${dataPointId}`;
  }
  const url = `${GH_BASE}/dataTypes/${dataType}/dataPoints:batchDelete`;
  return apiFetch(url, {
    method: 'POST',
    body: JSON.stringify({ names: [name] }),
  });
}

/** Delete several data points in one call (full resource names). */
export async function ghBatchDelete(dataType: string, names: string[]): Promise<unknown> {
  assertSegment(dataType, 'dataType');
  for (const n of names) assertResourceName(n);
  const url = `${GH_BASE}/dataTypes/${dataType}/dataPoints:batchDelete`;
  return apiFetch(url, {
    method: 'POST',
    body: JSON.stringify({ names }),
  });
}

/** Read a single data point. */
export async function ghGet(dataType: string, dataPointId: string): Promise<unknown> {
  assertSegment(dataType, 'dataType');
  assertSegment(dataPointId, 'dataPointId');
  const url = `${GH_BASE}/dataTypes/${dataType}/dataPoints/${dataPointId}`;
  return apiFetch(url);
}

/**
 * Delta sync: reconcile returns the data points of the type that changed
 * since the given filter (e.g. `update_time >= "..."`).
 */
export async function ghReconcile(dataType: string, filter?: string): Promise<unknown> {
  assertSegment(dataType, 'dataType');
  const qs = filter ? `?filter=${encodeURIComponent(filter)}` : '';
  const url = `${GH_BASE}/dataTypes/${dataType}/dataPoints:reconcile${qs}`;
  return apiFetch(url);
}

export async function ghPatch(dataType: string, dataPointId: string, body: unknown): Promise<unknown> {
  assertSegment(dataType, 'dataType');
  assertSegment(dataPointId, 'dataPointId');
  const url = `${GH_BASE}/dataTypes/${dataType}/dataPoints/${dataPointId}`;
  return apiFetch(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * Export exercise data point as TCX XML.
 * Returns raw XML string (not JSON).
 */
export async function ghExportTcx(dataPointId: string): Promise<string> {
  assertSegment(dataPointId, 'dataPointId');
  const url = `${GH_BASE}/dataTypes/exercise/dataPoints/${dataPointId}:exportExerciseTcx`;
  for (let attempt = 0; ; attempt++) {
    try {
      let token = await getToken();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30_000);
      try {
        let resp = await fetch(url, {
          signal: ctrl.signal,
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.status === 401) {
          token = await refreshAccessToken();
          resp = await fetch(url, {
            signal: ctrl.signal,
            headers: { Authorization: `Bearer ${token}` },
          });
        }
        if (resp.ok) {
          // The API returns JSON: { "tcxData": "<?xml ...>" }
          const data = (await resp.json().catch(() => ({}))) as { tcxData?: string };
          if (!data.tcxData) {
            throw new GhError('exportExerciseTcx: response does not contain tcxData', 502);
          }
          return data.tcxData;
        }
        const errBody = await resp.json().catch(() => ({})) as { error?: { message?: string } };
        if ((resp.status === 429 || resp.status >= 500) && attempt < RETRY_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
          continue;
        }
        throw new GhError(
          errBody?.error?.message ?? `exportExerciseTcx: HTTP ${resp.status}`,
          resp.status,
        );
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      if (e instanceof GhError) throw e;
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw new GhError(
        `exportExerciseTcx: ${(e as Error).message ?? 'network error'}`,
        502,
      );
    }
  }
}

