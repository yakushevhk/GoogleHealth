# Google Health MCP Server

Full access to the **Google Health API v4** via MCP. **35 tools**, 4 resources, 3 prompts, 39 data types, built-in response cache with TTL.

## Implementations

| Language | Folder | Lines | Binary | Idle RAM | Status |
|----------|--------|-------|--------|----------|--------|
| **Rust** | `src/` | ~4200 | 14 MB | 7.8 MB | production (reference) |
| **Go** | `go/` | ~4640 | 7 MB | 10.5 MB | production |
| **TypeScript (Bun)** | `ts/` | ~1200 | — | ~35 MB | production |
| **Python** | `py/` | ~1500 | — | ~45 MB | production |
| **C** | `c/` | ~630 | 76 KB | <5 MB | 15 tools |
| **Zig** | `zig/` | 227 | 101 KB | <2 MB | PoC (10 tools) |

Rust, Go, TypeScript, and Python implementations have full parity: 35 tools, 39 data types, auth logic, and critical algorithms. C and Zig are partial implementations.

## Quick Start

> **For a complete setup guide** (Google Cloud Console, OAuth, building, running, all tools and data types documented), see **[START.md](START.md)**.

### 1. Prerequisites

- Rust 1.75+ (install via [rustup.rs](https://rustup.rs))
- Google Cloud project with Google Health API enabled
- OAuth2 client credentials (Desktop app type)
- A refresh token (obtained via `oauth_health.py`)

### 2. Build

```bash
cargo build --release
cargo test
```

### 3. Configure

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 4. Run

**stdio** (for Claude Desktop, ZCode, and other local MCP clients):

```bash
./target/release/google-health-mcp
```

**HTTP/SSE** (for production, remote clients):

```bash
MCP_API_KEY="your-secret-key" ./target/release/google-health-mcp --http
```

## Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| `GOOGLE_CLIENT_ID` | Yes | OAuth Client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth Client Secret |
| `GOOGLE_REFRESH_TOKEN` | Yes | Refresh token (obtained via `oauth_health.py`) |
| `MCP_API_KEY` | — | API key for HTTP mode authentication |
| `HOST` | — | Bind address (default: `127.0.0.1`) |
| `PORT` | — | Bind port (default: `3000`) |
| `PUBLIC_HOST` | — | Additional allowed Host header for reverse proxy setups |

## MCP Client Configuration

**stdio (Claude Desktop / ZCode):**

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

**HTTP:**

```json
{
  "mcpServers": {
    "google-health": {
      "url": "http://127.0.0.1:3000/mcp",
      "headers": {
        "Authorization": "Bearer your-api-key"
      }
    }
  }
}
```

## Tools (35)

### Summaries & Analytics

| Tool | Description |
|------|-------------|
| `summary` | Full health summary for any date (`date`: YYYY-MM-DD). ~34 metrics in parallel, cached 120s |
| `today` | Summary for today |
| `yesterday` | Summary for yesterday |
| `compare_health_periods` | Compare two date ranges (13 metrics with deltas) |
| `get_hrv_recovery_trend` | HRV and resting HR trend with personalized readiness |
| `get_temperature_summary` | Core body temperature and sleep temperature derivations |
| `get_trends` | Daily time series for any dailyRollUp-compatible metric |
| `clear_cache` | Force-clear the 120s response cache |

### Data & Sync

| Tool | Description |
|------|-------------|
| `list_data_points` | List with AIP-160 filters |
| `get_data_point` | Get one data point by ID |
| `reconcile_data_points` | Dedup/merge (read-only GET) |
| `sync_data_points` | Delta sync since `since_time` |
| `rollup_data_points` | Aggregate into time buckets |
| `daily_rollup_data_points` | Aggregate into daily civil-time buckets |

### Write & Delete

| Tool | Description |
|------|-------------|
| `create_data_point` | Generic create (JSON body) |
| `add_weight_sample` | Weight in kg |
| `add_hydration_log` | Hydration event (time only) |
| `add_sleep_session` | Sleep session (start/end) |
| `add_exercise_session` | Exercise session (type/start/end) |
| `add_nutrition_log` | Meal event (meal type + time) |
| `patch_data_point` | Update an existing data point |
| `delete_data_point` | Delete one data point |
| `batch_delete_data_points` | Delete multiple (max 10,000) |
| `delete_by_filter` | Delete all matching a filter (destructive) |

### Export

| Tool | Description |
|------|-------------|
| `export_exercise_tcx` | Export exercise as TCX XML |

### Profile & Devices

| Tool | Description |
|------|-------------|
| `get_profile` / `update_profile` | User profile |
| `get_settings` / `update_settings` | Units and preferences |
| `get_identity` | Identity information |
| `get_irn_profile` | Irregular Rhythm Notification profile |
| `list_paired_devices` / `get_paired_device` | Paired devices |

### Discovery

| Tool | Description |
|------|-------------|
| `list_data_types` | All 39 data types with metadata |
| `describe_data_type` | Filter syntax, limits, gotchas for a type |

## Data Types (39)

### Interval (filter: `{type}.interval.start_time`)
`steps`, `active-energy-burned`, `distance`, `active-minutes`, `active-zone-minutes`, `activity-level`, `altitude`, `sedentary-period`, `swim-lengths-data`, `time-in-heart-rate-zone`

### Sample (filter: `{type}.sample_time.physical_time`)
`heart-rate`, `weight`, `height`, `body-fat`, `blood-glucose`, `core-body-temperature`, `heart-rate-variability`, `oxygen-saturation`, `respiratory-rate-sleep-summary`, `vo2-max`, `run-vo2-max`

### Daily (filter: `{type}.date`)
`daily-resting-heart-rate`, `daily-heart-rate-variability`, `daily-heart-rate-zones`, `daily-oxygen-saturation`, `daily-respiratory-rate`, `daily-sleep-temperature-derivations`, `daily-vo2-max`

### Session
- `sleep` — filter: `sleep.interval.end_time` or `sleep.interval.civil_end_time`
- `exercise` — filter: `exercise.interval.civil_start_time`
- `hydration-log` — filter: `hydration_log.interval.civil_start_time`
- `nutrition-log` — filter: `nutrition_log.interval.civil_start_time`
- `irregular-rhythm-notification` — filter: `irregular_rhythm_notification.interval.civil_start_time`
- `electrocardiogram` — filter: `electrocardiogram.interval.start_time` (only `>=`)

### No filter
`food`, `food-measurement-unit`

### Rollup-only (no list)
`floors`, `calories-in-heart-rate-zone`, `total-calories`

## Filter Syntax

Data type IDs use **kebab-case** (`heart-rate`), filter fields use **snake_case** (`heart_rate`).

```
steps.interval.start_time >= "2026-07-01T00:00:00Z" AND steps.interval.start_time < "2026-07-02T00:00:00Z"
heart_rate.sample_time.physical_time >= "2026-07-01T00:00:00Z"
daily_resting_heart_rate.date >= "2026-07-01" AND daily_resting_heart_rate.date < "2026-07-02"
sleep.interval.civil_end_time >= "2026-07-01" AND sleep.interval.civil_end_time < "2026-07-02"
```

## rollUp / dailyRollUp

**rollUp** — aggregate by arbitrary windows:

```json
{
  "data_type": "heart-rate",
  "start_time": "2026-07-15T00:00:00Z",
  "end_time": "2026-07-22T00:00:00Z",
  "window_size": "3600s"
}
```

**dailyRollUp** — aggregate by day (civil/local time):

```json
{
  "data_type": "steps",
  "start_date": "2026-07-15",
  "end_date": "2026-07-22",
  "window_size_days": 1
}
```

Limits: 14 days for `heart-rate`, `active-minutes`, `total-calories`, `calories-in-heart-rate-zone`. 90 days for all others.

## Resources (4)

| URI | Description |
|-----|-------------|
| `health://profile` | User profile (JSON) |
| `health://settings` | User settings (JSON) |
| `health://devices` | Paired devices (JSON) |
| `health://summary/{date}` | Full daily summary (YYYY-MM-DD) |

## Prompts (3)

| Name | Description |
|------|-------------|
| `health_weekly_review` | 7-day health, sleep, and workout review |
| `sleep_quality_analysis` | Sleep stages, HRV, and recovery analysis |
| `workout_summary` | Exercise sessions and heart rate zone breakdown |

## Token Maintenance

Google refresh tokens expire if unused for 6 months. Use `refresh_token.sh` to keep yours alive:

```bash
# Manual
./refresh_token.sh

# Cron (every 5 days)
0 0 */5 * * /path/to/refresh_token.sh >> /path/to/refresh.log 2>&1
```

## Endpoints (HTTP mode)

| Endpoint | Description |
|----------|-------------|
| `POST /mcp` | MCP Streamable HTTP |
| `GET /health` | Health check (no auth) |

## Tech Stack

### Rust (reference)
- Rust, tokio, reqwest (30s/10s timeouts, retry on 429/5xx with backoff, single-flight OAuth refresh)
- rust-mcp-sdk 1.0 (MCP protocol 2025-11-25)
- rust-mcp-axum (Streamable HTTP + SSE)

### Go
- Go 1.23, net/http, sync.Mutex (single-flight gate)
- mcp-go (MCP SDK, stdio + StreamableHTTP)
- godotenv

### TypeScript (Bun)
- Bun runtime, @modelcontextprotocol/sdk 1.12+
- Low-level Server API (JSON-RPC over stdio, HTTP)

### Python
- Python 3.11+, asyncio, httpx (async HTTP)
- mcp 1.9+ (MCPServer, stdio + StreamableHTTP)

### Zig (PoC)
- Zig 0.16, std.json, std.posix (raw fd I/O)
- MCP JSON-RPC by hand (no SDK)

### Common
- Google Health API v4
- OAuth2 refresh token flow (auto-refresh, single-flight, 401 retry)
- Retry with backoff: 500ms → 1500ms → 4000ms (429/5xx/network)
- Response cache: 120s TTL, clear-on-write

## Benchmark (Rust vs Go)

| Metric | Rust | Go |
|--------|------|-----|
| Binary | 14 MB | 7 MB |
| Idle RSS | 7.8 MB | 10.5 MB |
| RSS under load | 10.4 MB | 11.5 MB |
| Latency (tools/list) | ~42 ms | ~41 ms |
| Jitter | 34–174 ms | 34–63 ms |
| CPU time (150 req) | 0.05s | 0.07s |

Performance difference is negligible — both are bottlenecked by the upstream Google API (~200–800 ms).

## Docker

```bash
# Build and run
docker compose up -d

# Check health
curl http://127.0.0.1:3000/health
```

The `docker-compose.yml` starts the Rust server in HTTP mode on port 3000. Configure credentials in `.env` (see `.env.example`).

## Documentation

| Document | Description |
|----------|-------------|
| [START.md](START.md) | Complete setup guide (Google Cloud, OAuth, build, run) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture, data flow, OAuth internals |
| [SECURITY.md](SECURITY.md) | Security policy and best practices |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

## License

[MIT](LICENSE)
