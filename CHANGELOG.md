# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Web Dashboard (Astro.js)
- Manual refresh button in the top bar (immediate re-fetch of today's data, e.g. after a write or connection recovery)
- Screen-reader support for canvas charts: `role="img"` + `aria-label` plus a visually-hidden textual summary (HR, HRV, SpO₂, sleep, body, zones, trends) updated from real loaded data
- OAuth/auth diagnostics via `GET /api/status` (presence-only, no secrets)
- Single-page `GET /api/dashboard` payload with a per-section availability map
- Health/readiness probes: `GET /api/healthz`, `GET /api/readyz` (`probe=1` for upstream check)
- Runtime metrics: `GET /api/metrics` (cache/upstream counters)
- Insights engine (`src/lib/insights.ts`) + `GET /api/insights` — analytical, non-medical observations (sleep, HRV, RHR, steps, bedtime, recovery, weight) with a Trends panel
- CSV/JSON export of period series (steps/heart/HRV/sleep/weight) from the Trends page
- Chart PNG export helper (`chartDataUrl` / `downloadChartPng`) + a "PNG" button on the Heart card
- i18n (en/ru) dictionary + a language toggle that re-localizes the top-bar chrome (nav, connection status, settings-panel labels, auto-refresh label); settings module (card visibility, compact mode, auto-refresh interval, persisted) with a Live settings panel (show/hide cards + Compact + Reset)
- Configurable auto-refresh (off / 60 s via the UI; other intervals read from settings), hotkeys (`←`/`→`, r/R, t, p)
- Mobile/tablet layout improvements and compact dashboard mode
- Security headers (CSP, frame, nosniff, referrer, permissions) + request-id on every response via middleware
- Privacy mode: values blurred on window blur or on `p`
- Dedicated non-root `astrojs/Dockerfile` (check+test+build, healthcheck) + dashboard service in `docker-compose.yml`
- Dependabot coverage for astrojs npm + docker

#### Performance
- Client-side GET memoization with single-flight deduplication: identical or short-lived repeated requests (heart-rate intraday fetched by several cards with different windows, date switches, auto-refresh) no longer hit the server twice within a short TTL
- `whenVisible()` utility to defer expensive chart initialization until an element scrolls into view (ready for lazy-render use)
- Typed error hierarchy (`errors.ts`) and HTTP helpers (`http.ts`) for consistent status mapping
- Privacy/redaction helpers for safe logging (`privacy.ts`); request correlation + counters (`request-meta.ts`)

### Fixed
- `astro check` (typecheck) failed with 53 TS errors due to unescaped apostrophes in test descriptions (`tests/ui.test.ts`, `tests/store.test.ts`) — quotes escaped, typecheck now clean
- CI: the Dashboard (Astro.js) job now runs `npm run check` in addition to tests and build, so type errors are caught in CI

### Security
- `MCP_API_KEY` is now **required** in HTTP mode for all implementations — the `change-me` fallback is removed and servers exit(1) if the key is missing (Rust, Go, TypeScript, Python)
- TypeScript HTTP mode now validates the API key with `crypto.timingSafeEqual` (constant-time); Python HTTP mode authenticates via Starlette middleware with `hmac.compare_digest`
- `docker-compose.yml` no longer substitutes a default `MCP_API_KEY`
- Added `.dockerignore` files so local `.env`/token files are never baked into Docker images

### Changed
- Python implementation requires MCP SDK 2.x (`mcp>=2.0.0`); declared `mcp-types`, `starlette`, `uvicorn` dependencies explicitly
- Removed unused `zod` dependency from the TypeScript implementation
- Root `Dockerfile` builder upgraded from `rust:1.75-slim` to `rust:slim` (rust-mcp-sdk MSRV is 1.80); runtime image gains `curl` so the compose healthcheck works
- CI/release Go toolchain pin updated 1.23 → 1.25 to match `go.mod`
- Docs: corrected stale claims — dashboard is read+write (write/patch/delete API + Quick Entry UI) with 4 pages, Zig PoC lists 10 tools but only 3 are implemented, Node ≥ 22.12 for Astro 7, Rust 1.80+, Go 1.25+

### Fixed
- `docker-compose.yml` healthcheck used `curl`, which was absent from the runtime image (container stuck "unhealthy")
- `bench/bench.sh` referenced a Go binary path (`target/go-mcp-bench`) that nothing builds — now uses `go/googlehealth-mcp-go`
- `Makefile` `.PHONY` declared a nonexistent `release` target
- `.editorconfig` no longer forces spaces for `*.go` (contradicted gofmt tabs)
#### Pre-publication audit (2026-08-23)
- TypeScript HTTP auth: `timingSafeEqual` crashed with a 500 when a non-ASCII `MCP_API_KEY` was configured (JS length ≠ UTF-8 byte length) — now compares buffer byte lengths and returns 401 on mismatch
- TypeScript and Python HTTP auth accept the `Bearer` scheme case-insensitively per RFC 7235 (`bearer`/`BEARER`)
- `refresh_token.sh`: reads `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` from `.env`, portable `sed` (temp-file + mv, works on macOS BSD sed), `set -euo pipefail`
- Rust: updated transitive `h2` 0.4.15 → 0.4.18 to fix CVE-2025-51797 / CVE-2025-51798 (HTTP/2 CONTINUATION-frame DoS)
- TypeScript HTTP `prompts/list` now declares prompt arguments (parity with Rust); HTTP mode enforces MCP_API_KEY constant-time
- `astrojs/deploy/server-setup.sh` enforces Node ≥ 22.12 (Astro 7 requirement) instead of accepting Node 18+
- `bench/bench.sh`: adds `EXIT` trap so servers are killed on early failure
- `c/README.md` honestly labels the C port as a partial implementation (informational stubs for `today`/`yesterday`/`summary`, empty inputSchemas)
- Docs: corrected stale line counts, overclaimed "read/write for all data types" (only writable types support writes), parity scope (Go/TS/Python full, C/Zig partial)
- `.gitignore` covers `.pytest_cache/`; Dependabot now monitors the root Dockerfile

## [0.2.0] - 2026-08-09

### Added

#### Core Server (Rust reference implementation)
- 35 MCP tools covering all Google Health API v4 operations
- 39 data types with full metadata registry (category, filter syntax, page limits, rollup ranges)
- 4 MCP resources (profile, settings, devices, daily summary template)
- 3 MCP prompts (weekly review, sleep analysis, workout summary)
- OAuth2 token refresh with single-flight gate and exponential backoff retry
- In-memory response cache with 120s TTL, cleared on writes
- Structured error recovery with actionable `next_steps` for common API errors
- `structuredContent` in MCP responses for programmatic consumption
- Tool annotations (`readOnlyHint`, `destructiveHint`) for client safety

#### Multi-Language Implementations
- **Go** — Full parity (35 tools, 39 types, auth, cache, summary)
- **TypeScript (Bun)** — Full parity (35 tools, 39 types, auth, cache, summary)
- **Python** — Full parity (35 tools, 39 types, auth, cache, summary, JSON schemas)
- **C** — Partial (15 tools, 39 types, stdio mode)
- **Zig** — PoC (10 tools, 39 types, stdio mode)

#### Web Dashboard (Astro.js)
- Read-only dashboard for all 39 Google Health data types
- Vitals feed with sparklines and daily deltas
- Activity ring, heart rate zones, sleep hypnogram
- Weight/HRV/SpO2 trends over 7/30/90 days
- Exercise cards with detailed metrics
- Device status and battery monitoring
- Auto-refresh every 60 seconds
- Server-side API proxy to Google Health API v4

#### Documentation
- `START.md` — Comprehensive setup guide for LLMs and developers
- `README.md` — Project overview with implementation comparison
- `ARCHITECTURE.md` — System architecture and data flow
- `SECURITY.md` — Security policy and best practices
- `CONTRIBUTING.md` — Contribution guidelines
- Per-implementation READMEs (Go, TypeScript, Python, C, Zig, Astro.js)
- `.env.example` files for all implementations

#### Infrastructure
- GitHub Actions CI for Rust, Go, TypeScript, Python, and Astro.js
- MIT License
- `.gitignore` covering secrets, build artifacts, IDE files
- Benchmark script (Rust vs Go)

### Security

- All OAuth credentials use environment variables (never hardcoded)
- SSL verification enabled in all OAuth flows
- Constant-time API key comparison in HTTP mode
- `.env`, `health_token.json`, `raw_api_responses.json` excluded from git
