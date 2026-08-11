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
- i18n (en/ru) dictionary + a language toggle in the top bar (`currentLocale`); settings module (card visibility, compact mode, auto-refresh interval, persisted) with a Live settings panel (show/hide cards + Compact + Reset)
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
