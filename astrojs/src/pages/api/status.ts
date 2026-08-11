/**
 * GET /api/status
 * Lightweight auth/connection diagnostics — does NOT hit Google Health.
 * Tells the UI (and a sysadmin) whether the OAuth setup is complete.
 * Never returns secrets: only boolean presence + a human-safe message.
 */
import type { APIRoute } from 'astro';
import { makeRequestMeta } from '@lib/request-meta';
import { jsonOk } from '@lib/http';
import {
  hasOAuthClientId,
  hasOAuthClientSecret,
  hasRefreshToken,
  refreshTokenSource,
} from '@lib/auth-config';

export const GET: APIRoute = async () => {
  const meta = makeRequestMeta();
  const [hasClientId, hasClientSecret, hasToken, source] = await Promise.all([
    hasOAuthClientId(),
    hasOAuthClientSecret(),
    hasRefreshToken(),
    refreshTokenSource(),
  ]);

  // Which piece is missing first, for a readable suggestion.
  let status: 'ok' | 'misconfigured' = 'ok';
  let suggestion = '';
  if (!hasClientId || !hasClientSecret || !hasToken) {
    status = 'misconfigured';
    if (!hasClientId) suggestion = 'GOOGLE_CLIENT_ID is not set';
    else if (!hasClientSecret) suggestion = 'GOOGLE_CLIENT_SECRET is not set';
    else suggestion = 'No Google refresh token (env or token file)';
  }

  return jsonOk(
    {
      status,
      configured: status === 'ok',
      oauth: {
        hasClientId,
        hasClientSecret,
        hasRefreshToken: hasToken,
        refreshSource: source,
      },
      suggestion,
    },
    { meta },
  );
};
