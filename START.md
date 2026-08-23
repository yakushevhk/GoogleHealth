# Google Health MCP Server — Quick Start Guide

This guide covers the **Rust implementation** only. It is written for LLMs and developers who need to understand, build, configure, and run the server from scratch.

For an overview of all implementations (Rust, Go, TypeScript, Python, C, Zig, Astro.js dashboard), see [README.md](README.md).

---

## What This Is

An MCP (Model Context Protocol) server that provides full read access to the **Google Health API v4**. It exposes 35 tools, 4 resources, 3 prompts, and supports 39 health data types.

**Key capabilities:**
- Daily health summaries (~34 metrics fetched in parallel)
- Read for all 39 data types; write support for sleep, exercise, weight, height, body fat, nutrition, and other writable types
- OAuth2 token management with auto-refresh, retry with backoff, and single-flight gate
- In-memory response cache (120s TTL, cleared on writes)
- Two transport modes: **stdio** (local MCP clients) and **HTTP/SSE** (production)

---

## Prerequisites

- **Rust 1.80+** (edition 2021) — install via [rustup.rs](https://rustup.rs)
- **Google account** with health data (Fitbit, Pixel Watch, etc.)
- **Google Cloud project** with billing enabled (free tier is sufficient)

---

## Step 1: Google Cloud Console Setup

### 1a. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)

### 1b. Enable the Google Health API

1. Navigate to **APIs & Services → Library**
2. Search for **Google Health API**
3. Click **Enable**

### 1c. Configure OAuth Consent Screen

1. Navigate to **APIs & Services → OAuth consent screen**
2. Choose **External** user type
3. Fill in the required fields (app name, email)
4. Add all 15 Google Health scopes (see below)
5. Add your Gmail address as a **Test user** (required while the app is in "Testing" status)

**Required scopes:**

```
https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly
https://www.googleapis.com/auth/googlehealth.activity_and_fitness.writeonly
https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly
https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.writeonly
https://www.googleapis.com/auth/googlehealth.sleep.readonly
https://www.googleapis.com/auth/googlehealth.sleep.writeonly
https://www.googleapis.com/auth/googlehealth.nutrition.readonly
https://www.googleapis.com/auth/googlehealth.nutrition.writeonly
https://www.googleapis.com/auth/googlehealth.location.readonly
https://www.googleapis.com/auth/googlehealth.ecg.readonly
https://www.googleapis.com/auth/googlehealth.irn.readonly
https://www.googleapis.com/auth/googlehealth.profile.readonly
https://www.googleapis.com/auth/googlehealth.profile.writeonly
https://www.googleapis.com/auth/googlehealth.settings.readonly
https://www.googleapis.com/auth/googlehealth.settings.writeonly
```

### 1d. Create OAuth Credentials

1. Navigate to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Desktop app**
4. Save the **Client ID** and **Client Secret** — you'll need them next

---

## Step 2: Obtain a Refresh Token

### Option A: Using the bundled Python script

```bash
python3 oauth_health.py
```

This will:
1. Open your browser for Google authorization
2. Start a local HTTP server on `localhost:8086` to receive the callback
3. Exchange the authorization code for tokens
4. Save the result to `health_token.json`
5. Print the refresh token to stdout

Before running, edit `oauth_health.py` and set your `CLIENT_ID` and `CLIENT_SECRET`.

### Option B: Manual curl

1. Open this URL in a browser (replace `YOUR_CLIENT_ID`):

```
https://accounts.google.com/o/oauth2/v2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:8086/callback&response_type=code&scope=https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly%20https://www.googleapis.com/auth/googlehealth.activity_and_fitness.writeonly%20https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly%20https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.writeonly%20https://www.googleapis.com/auth/googlehealth.sleep.readonly%20https://www.googleapis.com/auth/googlehealth.sleep.writeonly%20https://www.googleapis.com/auth/googlehealth.nutrition.readonly%20https://www.googleapis.com/auth/googlehealth.nutrition.writeonly%20https://www.googleapis.com/auth/googlehealth.location.readonly%20https://www.googleapis.com/auth/googlehealth.ecg.readonly%20https://www.googleapis.com/auth/googlehealth.irn.readonly%20https://www.googleapis.com/auth/googlehealth.profile.readonly%20https://www.googleapis.com/auth/googlehealth.profile.writeonly%20https://www.googleapis.com/auth/googlehealth.settings.readonly%20https://www.googleapis.com/auth/googlehealth.settings.writeonly&access_type=offline&prompt=consent
```

2. Authorize and copy the `code` from the redirect URL
3. Exchange it for tokens:

```bash
curl -X POST https://oauth2.googleapis.com/token \
  -d "code=YOUR_AUTH_CODE" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "redirect_uri=http://localhost:8086/callback" \
  -d "grant_type=authorization_code"
```

The response contains `refresh_token` — save it.

> **Important:** `access_type=offline` and `prompt=consent` are required. Without them, Google may not return a refresh token.

---

## Step 3: Configure Environment

Create a `.env` file in the project root (copy from `.env.example`):

```bash
cp .env.example .env
```

Fill in the values:

| Variable | Required | Description |
|----------|:--------:|-------------|
| `GOOGLE_CLIENT_ID` | Yes | OAuth client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Yes | Refresh token from Step 2 |
| `MCP_API_KEY` | No | Bearer token for HTTP mode authentication (default: none, must be set for `--http`) |
| `HOST` | No | Bind address (default: `127.0.0.1`) |
| `PORT` | No | Bind port (default: `3000`) |
| `PUBLIC_HOST` | No | Additional allowed Host header for DNS-rebinding protection (e.g., your domain behind a reverse proxy) |

---

## Step 4: Build

```bash
cargo build --release
```

Output: `target/release/google-health-mcp` (~14 MB binary, ~7.8 MB idle RAM)

Run tests:

```bash
cargo test
```

---

## Step 5: Run

### stdio mode (for local MCP clients like Claude Desktop, ZCode)

```bash
./target/release/google-health-mcp
```

The server reads JSON-RPC from stdin and writes responses to stdout. No API key authentication — the MCP client manages the connection directly.

### HTTP/SSE mode (for production, remote clients, dashboards)

```bash
MCP_API_KEY="your-secret-key" ./target/release/google-health-mcp --http
```

The server starts on `HOST:PORT` (default `127.0.0.1:3000`).

Endpoints:
- `POST /mcp` — MCP Streamable HTTP
- `GET /health` — health check (no auth required)

Authentication: `Authorization: Bearer your-secret-key` header.

---

## Step 6: Connect an MCP Client

### Claude Desktop / ZCode (stdio)

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "google-health": {
      "command": "/path/to/target/release/google-health-mcp",
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id",
        "GOOGLE_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

### HTTP client

```json
{
  "mcpServers": {
    "google-health": {
      "url": "http://127.0.0.1:3000/mcp",
      "headers": {
        "Authorization": "Bearer your-secret-key"
      }
    }
  }
}
```

---

## All 35 MCP Tools

### Summaries & Analytics (8)

| Tool | Description |
|------|-------------|
| `summary` | Full health summary for any date (YYYY-MM-DD). Fetches ~34 metrics in parallel. Cached for 120s |
| `today` | Shortcut for `summary` with today's date |
| `yesterday` | Shortcut for `summary` with yesterday's date |
| `compare_health_periods` | Compare two date ranges (13 metrics with delta %) |
| `get_hrv_recovery_trend` | HRV and resting HR trend over N days with personalized readiness score |
| `get_temperature_summary` | Core body temperature and sleep temperature derivations for a period |
| `get_trends` | Daily time series for any dailyRollUp-compatible metric |
| `clear_cache` | Force-clear the 120s in-memory response cache |

### Data & Sync (6)

| Tool | Description |
|------|-------------|
| `list_data_points` | List data points with AIP-160 filter syntax |
| `get_data_point` | Get a single data point by ID |
| `reconcile_data_points` | Deduplicate/merge data points (read-only GET) |
| `sync_data_points` | Incremental delta sync since a timestamp |
| `rollup_data_points` | Aggregate into time buckets (POST, e.g., hourly) |
| `daily_rollup_data_points` | Aggregate into daily civil-time buckets (POST) |

### Write & Delete (10)

| Tool | Description |
|------|-------------|
| `create_data_point` | Create a data point (generic JSON body) |
| `add_weight_sample` | Add weight in kg |
| `add_hydration_log` | Log hydration event (time only, no volume) |
| `add_sleep_session` | Log sleep session (start/end times) |
| `add_exercise_session` | Log exercise (type, start/end) |
| `add_nutrition_log` | Log meal (meal type + time, no nutrients) |
| `patch_data_point` | Update an existing data point |
| `delete_data_point` | Delete a single data point |
| `batch_delete_data_points` | Delete multiple (max 10,000) |
| `delete_by_filter` | Delete all matching a filter (destructive) |

### Export (1)

| Tool | Description |
|------|-------------|
| `export_exercise_tcx` | Export exercise as TCX XML (requires `location.readonly` scope) |

### Profile & Devices (8)

| Tool | Description |
|------|-------------|
| `get_profile` / `update_profile` | User profile (name, birthdate, gender) |
| `get_settings` / `update_settings` | Units and preferences |
| `get_identity` | Identity information |
| `get_irn_profile` | Irregular Rhythm Notification profile |
| `list_paired_devices` / `get_paired_device` | Paired devices |

### Discovery (2)

| Tool | Description |
|------|-------------|
| `list_data_types` | All 39 data types with metadata |
| `describe_data_type` | Detailed info: filters, limits, gotchas |

---

## 39 Data Types

### Interval types (filter: `{type}.interval.start_time`)

`steps`, `active-energy-burned`, `distance`, `active-minutes`, `active-zone-minutes`, `activity-level`, `altitude`, `sedentary-period`, `swim-lengths-data`, `time-in-heart-rate-zone`

### Sample types (filter: `{type}.sample_time.physical_time`)

`heart-rate`, `weight`, `height`, `body-fat`, `blood-glucose`, `core-body-temperature`, `heart-rate-variability`, `oxygen-saturation`, `respiratory-rate-sleep-summary`, `vo2-max`, `run-vo2-max`

### Daily types (filter: `{type}.date`)

`daily-resting-heart-rate`, `daily-heart-rate-variability`, `daily-heart-rate-zones`, `daily-oxygen-saturation`, `daily-respiratory-rate`, `daily-sleep-temperature-derivations`, `daily-vo2-max`

### Session types

| Type | Filter field |
|------|-------------|
| `sleep` | `sleep.interval.end_time` or `sleep.interval.civil_end_time` |
| `exercise` | `exercise.interval.civil_start_time` |
| `hydration-log` | `hydration_log.interval.civil_start_time` |
| `nutrition-log` | `nutrition_log.interval.civil_start_time` |
| `irregular-rhythm-notification` | `irregular_rhythm_notification.interval.civil_start_time` |
| `electrocardiogram` | `electrocardiogram.interval.start_time` (only `>=`, no upper bound) |

### No filter

`food`, `food-measurement-unit` (reference catalogs)

### Rollup-only (no list support)

`floors`, `total-calories`, `calories-in-heart-rate-zone`

---

## MCP Resources

| URI | Description |
|-----|-------------|
| `health://profile` | User profile (JSON) |
| `health://settings` | User settings (JSON) |
| `health://devices` | Paired devices (JSON) |
| `health://summary/{date}` | Full daily summary template (YYYY-MM-DD) |

## MCP Prompts

| Name | Description |
|------|-------------|
| `health_weekly_review` | 7-day health, sleep, and workout review |
| `sleep_quality_analysis` | Sleep stages, HRV, and recovery analysis |
| `workout_summary` | Exercise sessions and heart rate zone breakdown |

---

## Filter Syntax

- **Data type IDs** use **kebab-case**: `heart-rate`, `daily-resting-heart-rate`
- **Filter fields** use **snake_case**: `heart_rate.sample_time.physical_time`

Examples:

```
steps.interval.start_time >= "2026-07-01T00:00:00Z" AND steps.interval.start_time < "2026-07-02T00:00:00Z"
heart_rate.sample_time.physical_time >= "2026-07-01T00:00:00Z"
daily_resting_heart_rate.date >= "2026-07-01" AND daily_resting_heart_rate.date < "2026-07-02"
sleep.interval.civil_end_time >= "2026-07-01" AND sleep.interval.civil_end_time < "2026-07-02"
exercise.interval.civil_start_time >= "2026-07-01"
```

---

## API Gotchas

1. **Use `daily_rollup` for steps/distance/floors totals.** The `list` endpoint returns intervals without values for these types.

2. **Missing days ≠ zero data.** If a day has no records, the API returns nothing — don't assume zero steps/calories.

3. **int64 fields are strings in JSON.** Fields like `countSum`, `beatsPerMinute`, `minutesAsleep` are quoted strings, not numbers.

4. **Summary cache.** Responses from `summary`/`today`/`yesterday` are cached for 120 seconds. Use `clear_cache` after writes to get fresh data.

5. **Page size limits.** Sleep and exercise: max 25 per page. All other types: max 10,000.

6. **ECG filter limitation.** `electrocardiogram.interval.start_time` only supports `>=`, not range filters.

7. **No title/notes on sleep and exercise.** The API rejects `title` fields on these data points (returns 400).

8. **Hydration and nutrition are time-only.** The API does not support recording volume (hydration) or nutrient details (nutrition).

9. **Rollup range limits.** `heart-rate`, `active-minutes`, `total-calories`, `calories-in-heart-rate-zone`: max 14 days. All others: max 90 days.

10. **Food types are reference catalogs.** `food` and `food-measurement-unit` have no time-based filter.

---

## OAuth2 Auth Flow Technical Details

### Token Refresh

The server uses the **refresh token** grant to obtain access tokens:

```
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

client_id=...&client_secret=...&refresh_token=...&grant_type=refresh_token
```

- Access tokens expire after ~3600 seconds
- The server considers tokens expired 60 seconds before actual expiry
- On startup, the access token is empty — the first API call triggers a refresh

### Single-Flight Gate

Token refresh uses a mutex-based single-flight pattern:
1. Fast-path read: check if token is still valid (RwLock)
2. If expired: acquire refresh gate (Mutex)
3. Double-check: re-read token (another task may have refreshed it)
4. If still stale: call Google OAuth endpoint
5. Store new token and expiry

### Retry with Backoff

- **Delays:** 500ms → 1500ms → 4000ms (3 retries)
- **Retryable:** HTTP 429, HTTP 5xx, network errors
- **401 handling:** Single token refresh + retry (does not count as a backoff retry)
- **Non-retryable:** 400, 403, 404 (returned immediately with actionable error message)

### HTTP Client Configuration

- Request timeout: 30 seconds
- Connect timeout: 10 seconds
- TLS: rustls (no OpenSSL dependency)

---

## Token Maintenance

Google refresh tokens expire if not used for **6 months**. To keep yours alive:

### Manual refresh

```bash
./refresh_token.sh
```

### Automated refresh (cron)

```bash
# Add to crontab (every 5 days):
0 0 */5 * * /path/to/refresh_token.sh >> /path/to/refresh.log 2>&1
```

The script:
1. Reads the current refresh token from `health_token.json`
2. Calls Google OAuth to get a new access token (and possibly a new refresh token)
3. Updates `health_token.json` and `.env`

---

## Project Structure (Rust)

```
src/
├── main.rs       # Server entry point, MCP handler registration, tool_box! macro
├── auth.rs       # OAuth2 token refresh, retry logic, response cache
├── tools.rs      # All 35 tool implementations, helper functions
└── types.rs      # Data type registry (39 types with metadata)
```

**Key dependencies:**
- `rust-mcp-sdk` 1.0 — MCP protocol (tools, resources, prompts, stdio, HTTP)
- `rust-mcp-axum` 1.0 — Axum-based HTTP/SSE server
- `tokio` 1 — async runtime
- `reqwest` 0.12 — HTTP client (rustls-tls, no OpenSSL)
- `serde` / `serde_json` — serialization
- `chrono` — date/time handling
- `dotenvy` — .env file loading
