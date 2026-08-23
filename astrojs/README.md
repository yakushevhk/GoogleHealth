# Google Health Dashboard (Astro.js)

Full-featured dashboard for all Google Health API metrics (39 data types): read,
write, patch, and delete. Standalone project; the Rust MCP server (`../src/`) is
not required — the dashboard proxies the Google Health API v4 directly.

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

## Pages

Four routes (nav in the top bar), all driven by a date picker (‹ › + date input)
and configurable auto-refresh (off / 60 s via the UI, persisted in settings):

- **`/` Overview** — Vitals feed, Activity, Heart, Sleep, Body, Workouts, Misc cards, devices footer.
- **`/trends`** — 30/90-day summary strip, steps heatmap, sleep/steps/HRV/RHR/SpO₂ trends, period comparison, expert insights, CSV/JSON export.
- **`/zones`** — time-in-heart-rate-zone charts, active zone minutes, calories by zone.
- **`/inspector`** — raw data-point browser for all listable types, with delete.

A **+ Entry** button (QuickWriteModal, available on every page) writes data:
weight, hydration, sleep sessions, exercise sessions, nutrition logs, or raw JSON.

### Overview cards

- **Vitals feed** — HR (with ECG waveform), HRV·RMSSD, SpO₂, respiratory rate, temperature, resting heart rate: large numbers, sparklines, deltas vs previous day.
- **Activity** — step ring (goal 10,000), calories, distance, floors, active minutes, heart rate zones, sedentary alert.
- **Heart** — intraday HR min–max band + average (1h window), resting HR and HRV trends (7/30/90 days), irregular rhythm notifications.
- **Sleep** — hypnogram, phase bars with percentages, sleep temperature, respiratory rate during sleep.
- **Body** — weight trends (90d), body fat %, glucose, VO₂ max, temperature.
- **Workouts** — cards with metrics (avg/max HR, kcal, distance).
- **Other** — hydration, nutrition, altitude, swimming, ECG (hidden when no data).
- **Devices** — paired devices, battery level.

Missing metrics for a day show as "—"; empty sections are hidden automatically.

### Dashboard settings

- A settings module stores card visibility and compact mode in `localStorage`;
  the dashboard applies them on load and on a `gh:settings` event. The top bar
  has a **settings panel** (⚙): show/hide each of the seven cards, toggle
  compact mode, and reset to defaults.
- A **language toggle** switches ru/en and re-localizes the top-bar chrome
  (nav, connection status, settings panel labels, auto-refresh label) via the
  i18n dictionary (card/chart titles remain hardcoded for now). Auto-refresh
  interval is configurable and read from settings (off / 60 s by default; other
  intervals can be written directly).
- Keyboard shortcuts: `←`/`→` switch day, `r`/`R` refresh, `t` today, `p` privacy toggle.

### Privacy

- Values are blurred when the window loses focus, or toggled manually (`p`).
- A strict Content-Security-Policy and other security headers are applied to
  every response; API logs are redacted (no tokens, no user id).

## API Routes (server-side proxy to Google Health API v4)

### Reads

| Route | Parameters | Description |
|-------|-----------|-------------|
| `GET /api/summary` | `date=YYYY-MM-DD` | Daily summary (~33 parallel requests, same shape as MCP `today` tool) |
| `GET /api/dashboard` | `date=YYYY-MM-DD` | Single summary payload + per-section availability map |
| `GET /api/history` | `type`, `days=7\|30\|90`, `date` | Daily aggregations (dailyRollUp / daily types) |
| `GET /api/intraday` | `type`, `date`, `window=3600s`, `offsetMin` | Intraday aggregations (rollUp) |
| `GET /api/samples` | `type`, `date`, `days=1\|7\|30` | Raw sample series with context fields |
| `GET /api/list` | `type`, `date`, `pageSize`, `pageToken` | Raw data points (filter built by type) |
| `GET /api/get` | `type`, `id` | One data point by full resource name |
| `GET /api/analytics` | `mode=compare\|hrv_trend\|temperature` | Period comparison, HRV/RHR readiness, temperature |
| `GET /api/insights` | `days=30`, `endDate` | Analytical health observations (severity-ordered) |
| `GET /api/sync` | `type`, `since`, `until` | Delta sync via `:reconcile` |
| `GET /api/tcx` | `id`, `dataType=exercise` | Export exercise as TCX XML |
| `GET /api/profile` | — | User profile |
| `GET /api/settings` | — | Google account settings |
| `GET /api/identity` | — | Identity information |
| `GET /api/irn` | — | Irregular Rhythm Notification profile |
| `GET /api/devices` | — | Paired devices |
| `GET /api/status` | — | Auth/setup diagnostics (no secrets) |
| `GET /api/metrics` | — | Cache/upstream runtime counters |
| `GET /api/healthz` | — | Liveness probe (never touches Google) |
| `GET /api/readyz` | `probe=1` | Readiness: OAuth configured (+ optional upstream check) |

### Writes (no built-in auth — see Security)

| Route | Body | Description |
|-------|------|-------------|
| `POST /api/write` | `{action, …}` | Create data point. Actions: `raw_create`, `add_weight`, `add_hydration`, `add_sleep`, `add_exercise`, `add_nutrition` |
| `POST /api/patch` | `{dataType, dataPointId, body}` | Update an existing data point |
| `POST /api/delete` | `{dataType, dataPointId}` | Delete one data point |
| `POST /api/bulk-delete` | `{dataType, names[]}` | Delete multiple by full resource name |
| `POST /api/settings` | settings body | Update Google account settings |
| `POST /api/cache-clear` | — | Clear the in-memory read cache |

In-memory cache with 60s TTL reduces Google Health API quota usage, plus a
client-side single-flight GET cache for duplicate requests across cards. Writes
invalidate the read cache.

## Security

- **The app has no authentication of its own.** Mutating routes rely on network
  placement: dev binds `127.0.0.1`, production deployments put nginx Basic Auth
  in front (`deploy/`). Never expose port 4321 directly to the internet.
- OAuth credentials live only on the server (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / refresh token), never sent to the browser.
- `Content-Security-Policy`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store`, and `X-Request-Id` applied to every response by middleware.
- Sensitive values can be hidden (privacy mode); logs redact tokens and the user id.
- Data-type IDs and full resource names are validated server-side before being
  interpolated into upstream URLs (path-traversal protection).

## Docker

```bash
cd ..
docker compose up --build dashboard
# → http://127.0.0.1:4321
```

The dashboard runs standalone (the Rust MCP server is not required); there is a
dedicated non-root `astrojs/Dockerfile` with a `/api/healthz` healthcheck.

## Deployment

`deploy/` contains a production runbook (systemd unit + nginx Basic Auth + a
2-command `push.sh` rsync deploy). See [deploy/README.md](deploy/README.md).

## Tests

```bash
npm test             # vitest run
npm run check        # astro check (typecheck)
```

Unit tests: filter builders for all 39 data types, date edge cases (month boundaries, leap year), rollup response parsing, summary assembly, cache TTL/single-flight, settings persistence, i18n vocabulary parity, insights rules, exports (CSV/JSON), errors/privacy helpers. Route handlers and `.astro` components are not unit-tested.

## Tech Stack

Astro 7 (`output: 'server'`, adapter `@astrojs/node`), Node.js ≥ 22.12, vanilla TS islands with no UI framework, ECharts (selective imports), hand-written SVG sparklines, IBM Plex fonts (fontsource, no CDN).
