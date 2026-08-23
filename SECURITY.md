# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes |
| < 0.2   | No |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public issue.**
2. Email the maintainer privately or use GitHub's [private vulnerability reporting](https://github.com/yakushevhk/GoogleHealth/security/advisories/new).
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

You can expect a response within 7 days. We will work with you to understand and address the issue before any public disclosure.

## Security Considerations

### OAuth Credentials

This server handles OAuth2 credentials for the Google Health API. The following security measures are in place:

- **Credentials are never committed.** `.env`, `health_token.json`, and `raw_api_responses.json` are in `.gitignore`.
- **Refresh tokens** are stored locally and never transmitted except to Google's OAuth endpoint.
- **The `oauth_health.py` helper** runs a local HTTP server on `localhost:8086` only during the initial authorization flow.

### HTTP Mode Authentication

When running in `--http` mode, the server authenticates clients via a static bearer token (`MCP_API_KEY`). Recommendations:

- Always set `MCP_API_KEY` to a strong, unique value in production.
- Use HTTPS (via a reverse proxy like nginx) — the server itself does not terminate TLS.
- The server uses constant-time comparison for API key validation to prevent timing attacks (Rust: `constant_time_eq`, Go: `crypto/subtle.ConstantTimeCompare`, Python: `hmac.compare_digest`, TypeScript: `crypto.timingSafeEqual`).

### Token Refresh

- Access tokens are refreshed automatically via Google's OAuth2 endpoint.
- The refresh flow uses a single-flight gate to prevent thundering herd problems.
- Failed refresh attempts are retried with exponential backoff (500ms → 1500ms → 4000ms).

### Upstream API Errors

- OAuth client secrets are only sent to `https://oauth2.googleapis.com/token`.
- Health data is fetched from `https://health.googleapis.com/v4/`.
- No data is sent to any third-party services.

### Dependencies

- **Rust**: Uses `reqwest` with `rustls-tls` (no OpenSSL dependency).
- **Go**: Standard library `net/http` with TLS.
- **TypeScript**: Bun's built-in `fetch`.
- **Python**: `httpx` with default TLS verification.

## Best Practices for Deployment

1. **Use a reverse proxy** (nginx, Caddy) with TLS termination.
2. **Set `MCP_API_KEY`** to a cryptographically random string (e.g., `openssl rand -hex 32`).
3. **Restrict network access** — bind to `127.0.0.1` and use firewall rules.
4. **Rotate credentials** periodically by re-running `oauth_health.py`.
5. **Monitor logs** for unauthorized access attempts.
6. **Keep dependencies updated** — run `cargo update`, `go get -u`, `npm update`, `pip install --upgrade` regularly.
