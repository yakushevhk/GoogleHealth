/**
 * GET /api/readyz
 * Readiness: OAuth configuration present + (optionally) upstream reachability.
 * Never returns secrets. `probe`=1 does one minimal Google Health call
 * (getProfile) to verify the token actually works; OWASP-terming it read-only.
 */
import type { APIRoute } from 'astro';
import { jsonOk, jsonError } from '@lib/http';
import { makeRequestMeta } from '@lib/request-meta';
import { hasOAuthClientId, hasOAuthClientSecret, hasRefreshToken } from '@lib/auth-config';
import { ghGetProfile } from '@lib/gh-client';

export const GET: APIRoute = async ({ request }) => {
  const meta = makeRequestMeta();
  const url = new URL(request.url);
  const probe = url.searchParams.get('probe') === '1';

  const [hasClientId, hasClientSecret, hasToken] = await Promise.all([
    hasOAuthClientId(),
    hasOAuthClientSecret(),
    hasRefreshToken(),
  ]);
  const configured = hasClientId && hasClientSecret && hasToken;

  if (!configured) {
    return jsonOk(
      { status: 'not_ready', reason: 'oauth_misconfigured' },
      { meta },
      200,
    );
  }

  // Optional upstream probe — confirms the refresh token actually works.
  if (probe) {
    try {
      await ghGetProfile();
      return jsonOk({ status: 'ready', probe: 'ok' }, { meta });
    } catch (e) {
      return jsonError(e, { meta });
    }
  }

  return jsonOk({ status: 'ready', probe: 'skipped' }, { meta });
};
