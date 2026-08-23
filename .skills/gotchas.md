# Gotchas and Common Pitfalls

## Security

- **MCP_API_KEY is REQUIRED for HTTP mode.** All implementations exit(1) if `--http` is used without it. No `change-me` defaults.
- **Constant-time API key comparison** is used in all HTTP-capable implementations:
  - Rust: manual `constant_time_eq` (XOR-fold)
  - Go: `crypto/subtle.ConstantTimeCompare`
  - Python: `hmac.compare_digest`
  - TypeScript: `crypto.timingSafeEqual`
- **Never commit `.env` files.** Only `.env.example` with empty values.
- **Credential redaction** in logs: Rust redacts tokens in debug output.

## Parity Rules

- **Rust is the reference.** If you add a tool in Go, it must match Rust exactly (name, parameters, return format).
- **All 35 tools, 4 resources, 3 prompts** must be present in Go, TS, and Python.
- **Data types**: All 39 Google Health Connect data types must be registered in every implementation.
- **Auth flow**: Token refresh, retry logic, caching must behave identically.
- **C and Zig** are exempt from parity requirements (documented as partial/PoC).

## Common Mistakes

1. **Forgetting to add a tool to ALL implementations** — always check Go, TS, Python when adding a Rust tool.
2. **Using `!==` for API key comparison** in TypeScript — must use `timingSafeEqual`.
3. **Hardcoding `change-me` as default** — MCP_API_KEY must be required, not optional.
4. **Missing retry on 429/5xx** — all HTTP clients must retry with exponential backoff.
5. **Cache TTL mismatch** — all implementations use 120-second TTL.

## Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| GOOGLE_CLIENT_ID | Yes | — | OAuth2 client ID |
| GOOGLE_CLIENT_SECRET | Yes | — | OAuth2 client secret |
| GOOGLE_REFRESH_TOKEN | Yes | — | OAuth2 refresh token |
| MCP_API_KEY | For HTTP mode | — | Bearer token for --http |
| HOST | No | 127.0.0.1 | Bind address |
| PORT | No | 3000 | Bind port |
| PUBLIC_HOST | No | — | Rust only: reverse proxy Host header |

## Dashboard Specific

- Astro 7 (requires Node >=22.12)
- `@astrojs/node@11` adapter
- TypeScript 5.x (NOT 7.x — incompatible with @astrojs/check)
- Write-capable: POST routes (/api/write, /api/patch, /api/delete, /api/bulk-delete) mutate health data — the app has NO auth of its own, keep it on 127.0.0.1 or behind Basic Auth
- Privacy mode (`p` hotkey / window blur) blurs values on screen; logs redact tokens and user ids
