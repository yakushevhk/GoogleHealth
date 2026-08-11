# Google Health Dashboard (Astro.js)

Full read-only dashboard for all Google Health API metrics (39 data types).
Standalone frontend project; the Rust MCP server (`../src/`) is not required.

## Quick Start

```bash
cd astrojs
npm install
npm run dev          # http://127.0.0.1:4321
```

Production:

```bash
npm run build
npm run start        # node dist/server/entry.mjs → http://127.0.0.1:4321
```

## Authorization

The token never leaves the server — the browser only calls its own `/api/*` routes.

| Variable | Required | Description |
|----------|:--------:|-------------|
| `GOOGLE_CLIENT_ID` | Yes | OAuth Client ID (same as the Rust server) |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth Client Secret |
| `GOOGLE_REFRESH_TOKEN` | — | If not set, reads from `../health_token.json` |
| `GH_TOKEN_FILE` | — | Path to token file (default: `../health_token.json`) |

In dev mode, Astro loads `.env` automatically. In production, the server loads `.env`
from the current directory if variables are not set in the environment.

Copy `.env.example` → `.env`.

## What's on Screen

A single page driven by a date picker (‹ › + date input) and configurable
auto-refresh (off / 30s / 60s / 5m, persisted in settings):

- **Vitals feed** — HR (with ECG waveform), HRV·RMSSD, SpO₂, respiratory rate, temperature, resting heart rate: large numbers, sparklines, deltas vs previous day.
- **Activity** — step ring (goal 10,000), calories, distance, floors, active minutes, heart rate zones, sedentary alert.
- **Heart** — intraday HR min–max band + average (1h window), resting HR and HRV trends (7/30/90 days), irregular rhythm notifications.
- **Sleep** — hypnogram, phase bars with percentages, sleep temperature, respiratory rate during sleep.
- **Body** — weight trends (90d), body fat %, glucose, VO₂ max, temperature.
- **Workouts** — cards with metrics (avg/max HR, kcal, distance).
- **Trends** — 30/90-day summary strip, steps heatmap, sleep/steps/HRV/RHR/SpO₂ trends, period comparison, **expert insights** (analytical observations), **CSV/JSON export**.
- **Other** — hydration, nutrition, altitude, swimming, ECG (hidden when no data).
- **Devices** — paired devices, battery level.

Missing metrics for a day show as "—"; empty sections are hidden automatically.

### Dashboard settings

- Show/hide individual cards and toggle compact mode (`dashboard settings` module, persisted to `localStorage`).
- Keyboard shortcuts: `←`/`→` switch day, `r`/`R` refresh, `t` today, `p` privacy toggle.

### Privacy

- Values are blurred when the window loses focus, or toggled manually (`p`).
- A strict Content-Security-Policy and other security headers are applied to
  every response; API logs are redacted (no tokens, no user id).

## API Routes (server-side proxy to Google Health API v4)

| Route | Parameters | Description |
|-------|-----------|-------------|
| `GET /api/summary` | `date=YYYY-MM-DD` | Daily summary (~33 parallel requests, same shape as MCP `today` tool) |
| `GET /api/dashboard` | `date=YYYY-MM-DD` | Single summary payload + per-section availability map |
| `GET /api/history` | `type`, `days=7\|30\|90`, `date` | Daily aggregations (dailyRollUp / daily types) |
| `GET /api/intraday` | `type`, `date`, `window=3600s` | Intraday aggregations (rollUp) |
| `GET /api/analytics` | `mode=compare\|hrv_trend\|temperature` | Period comparison, HRV/RHR readiness, temperature |
| `GET /api/insights` | `days=30` | Analytical health observations (severity-ordered) |
| `GET /api/status` | — | Auth/setup diagnostics (no secrets) |
| `GET /api/metrics` | — | Cache/upstream runtime counters |
| `GET /api/healthz` | — | Liveness probe (never touches Google) |
| `GET /api/readyz` | `probe=1` | Readiness: OAuth configured (+ optional upstream check) |
| `GET /api/list` | `type`, `date`, `pageSize` | Raw data points (filter built by type) |
| `GET /api/profile` | — | User profile |
| `GET /api/devices` | — | Paired devices |

In-memory cache with 60s TTL reduces Google Health API quota usage, plus a
client-side single-flight GET cache for duplicate requests across cards.

## Security

- OAuth credentials live only on the server (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / refresh token), never sent to the browser.
- `Content-Security-Policy`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store`, and `X-Request-Id` applied to every response by middleware.
- Sensitive values can be hidden (privacy mode); logs redact tokens and the user id.

## Docker

```bash
cd ..
docker compose up --build dashboard
# → http://127.0.0.1:4321
```

The dashboard runs standalone (the Rust MCP server is not required); there is a
dedicated non-root `astrojs/Dockerfile` with a `/api/healthz` healthcheck.

## Tests

```bash
npm test             # vitest run
npm run check        # astro check (typecheck)
```

Unit tests: filter builders for all 39 data types, date edge cases (month boundaries, leap year), rollup response parsing, summary assembly, cache TTL/single-flight, settings persistence, i18n vocabulary parity, insights rules, exports (CSV/JSON), errors/privacy helpers.

## Tech Stack

Astro 5 (`output: 'server'`, adapter `@astrojs/node`), vanilla TS islands with no UI framework, ECharts (selective imports), hand-written SVG sparklines, IBM Plex fonts (fontsource, no CDN).

## Out of Scope

Data writing, integration with the Rust application, multi-user support, cloud deployment — local viewing only.
