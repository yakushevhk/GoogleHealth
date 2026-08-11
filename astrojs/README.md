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

A single page driven by a date picker (‹ › + date input), auto-refresh every 60s:

- **Vitals feed** — HR (with ECG waveform), HRV·RMSSD, SpO₂, respiratory rate, temperature, resting heart rate: large numbers, sparklines, deltas vs previous day.
- **Activity** — step ring (goal 10,000), calories, distance, floors, active minutes, heart rate zones, sedentary alert.
- **Heart** — intraday HR min–max band + average (1h window), resting HR and HRV trends (7/30/90 days), irregular rhythm notifications.
- **Sleep** — hypnogram, phase bars with percentages, sleep temperature, respiratory rate during sleep.
- **Body** — weight trends (90d), body fat %, glucose, VO₂ max, temperature.
- **Workouts** — cards with metrics (avg/max HR, kcal, distance).
- **Other** — hydration, nutrition, altitude, swimming, ECG (hidden when no data).
- **Devices** — paired devices, battery level.

Missing metrics for a day show as "—"; empty sections are hidden automatically.

## API Routes (server-side proxy to Google Health API v4)

| Route | Parameters | Description |
|-------|-----------|-------------|
| `GET /api/summary` | `date=YYYY-MM-DD` | Daily summary (~33 parallel requests, same shape as MCP `today` tool) |
| `GET /api/history` | `type`, `days=7\|30\|90`, `date` | Daily aggregations (dailyRollUp / daily types) |
| `GET /api/intraday` | `type`, `date`, `window=3600s` | Intraday aggregations (rollUp) |
| `GET /api/list` | `type`, `date`, `pageSize` | Raw data points (filter built by type) |
| `GET /api/profile` | — | User profile |
| `GET /api/devices` | — | Paired devices |

In-memory cache with 60s TTL reduces Google Health API quota usage.

## Tests

```bash
npm test             # vitest run
```

Unit tests: filter builders for all 39 data types, date edge cases (month boundaries, leap year), rollup response parsing, summary assembly (response shape, batches, resilience to individual type errors).

## Tech Stack

Astro 5 (`output: 'server'`, adapter `@astrojs/node`), vanilla TS islands with no UI framework, ECharts (selective imports), hand-written SVG sparklines, Space Grotesk / IBM Plex fonts (fontsource, no CDN).

## Out of Scope

Data writing, integration with the Rust application, multi-user support, cloud deployment — local viewing only.
