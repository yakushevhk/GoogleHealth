/**
 * Safe OAuth configuration inspection — presence checks only, never values.
 *
 * Mirrors how `gh-client` resolves credentials but is read-only and does not
 * make network calls. Used by `/api/status` so the UI/sysadmin can see at a
 * glance whether setup is complete, without exposing any secret.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Where the refresh token can come from (for the status message). */
export type RefreshSource = 'env' | 'file' | 'missing';

export const DEFAULT_REFRESH_SOURCE = 'missing';

/**
 * Load the same .env as gh-client's `ensureEnv` so env vars picked up from the
 * file are reflected here too. Async because it may read a file.
 */
async function ensureEnv(): Promise<void> {
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
    /* no .env — rely on env vars and health_token.json */
  }
}

/** Resolve whether a refresh token is present and from where (no secrets). */
export async function resolveRefreshSource(): Promise<RefreshSource> {
  await ensureEnv();
  if (process.env.GOOGLE_REFRESH_TOKEN) return 'env';
  const tokenFile = path.resolve(
    process.cwd(),
    process.env.GH_TOKEN_FILE ?? '../health_token.json',
  );
  try {
    const raw = JSON.parse(await readFile(tokenFile, 'utf8')) as {
      refresh_token?: string;
    };
    return raw.refresh_token ? 'file' : 'missing';
  } catch {
    return 'missing';
  }
}

export async function hasRefreshToken(): Promise<boolean> {
  return (await resolveRefreshSource()) !== 'missing';
}

export async function refreshTokenSource(): Promise<RefreshSource> {
  return resolveRefreshSource();
}

export async function hasOAuthClientId(): Promise<boolean> {
  await ensureEnv();
  return Boolean(process.env.GOOGLE_CLIENT_ID);
}

export async function hasOAuthClientSecret(): Promise<boolean> {
  await ensureEnv();
  return Boolean(process.env.GOOGLE_CLIENT_SECRET);
}
