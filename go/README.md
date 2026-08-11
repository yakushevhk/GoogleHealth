# Google Health MCP Server — Go Implementation

Full parity with the Rust reference implementation (`src/`). MCP server for Google Health API v4: 35 tools, 39 data types, 4 resources, 3 prompts.

## Quick Start

```bash
cd go

# Dependencies
go mod tidy

# Stdio mode (for Claude Desktop, ZCode, and other MCP clients)
go run .

# HTTP/SSE mode (for dashboards and remote clients)
go run . --http
# → Starting HTTP/SSE server on 127.0.0.1:3000
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `GOOGLE_CLIENT_ID` | Yes | — | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | — | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Yes | — | OAuth refresh token |
| `MCP_API_KEY` | — | `change-me` | API key for HTTP mode |
| `HOST` | — | `127.0.0.1` | HTTP server bind address |
| `PORT` | — | `3000` | HTTP server port |

Copy `.env.example` → `.env` and fill in your credentials.

## MCP Client Configuration

### Claude Desktop / ZCode (stdio)

```json
{
  "mcpServers": {
    "google-health": {
      "command": "/path/to/go-mcp",
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id",
        "GOOGLE_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

### HTTP/SSE Client

```
POST http://127.0.0.1:3000/mcp
Authorization: Bearer your-api-key
Content-Type: application/json
```

## Architecture

```
go/
├── main.go                 # MCP server: tool, resource, and prompt registration
├── auth.go                 # OAuth2 token refresh, retry with backoff, response cache
├── types.go                # Data type registry (39 types)
├── helpers.go              # Utilities: filter builder, JSON pointer, date helpers
├── tools_discovery.go      # list_data_types, describe_data_type
├── tools_data.go           # list/get/reconcile/sync/rollup/dailyRollUp
├── tools_write.go          # create + 5 write helpers + patch
├── tools_delete.go         # delete/batchDelete/deleteByFilter
├── tools_analytics.go      # compare_periods, HRV trend, temperature, trends
├── tools_summary.go        # daily summary (34 metrics, concurrency=10)
├── tools_profile.go        # profile/settings/identity/devices/TCX export
├── types_test.go           # Data type registry tests
├── tools_test.go           # Helper and utility tests
└── .env.example
```

## Tools (35)

### Summaries & Analytics
| Tool | Description |
|------|-------------|
| `summary` | Full health summary for a date (~34 metrics in parallel) |
| `today` / `yesterday` | Shortcuts for summary |
| `compare_health_periods` | Compare two periods (13 metrics + deltas) |
| `get_hrv_recovery_trend` | HRV + RHR trend, personalized readiness |
| `get_temperature_summary` | Body temperature + sleep temperature derivations |
| `get_trends` | Daily time series (dailyRollUp) |
| `clear_cache` | Reset in-memory cache (TTL 120s) |

### Data & Sync
| Tool | Description |
|------|-------------|
| `list_data_points` | List with AIP-160 filters |
| `get_data_point` | Single record by ID |
| `reconcile_data_points` | Dedup/merge (GET) |
| `sync_data_points` | Delta sync (auto-filter by since_time) |
| `rollup_data_points` | Aggregate by time windows (POST) |
| `daily_rollup_data_points` | Aggregate by day (civil time) |

### Write & Delete
| Tool | Description |
|------|-------------|
| `create_data_point` | Generic create (JSON body) |
| `add_weight_sample` | Weight in kg |
| `add_hydration_log` | Hydration (time only) |
| `add_sleep_session` | Sleep (start/end) |
| `add_exercise_session` | Exercise (type/start/end) |
| `add_nutrition_log` | Meal (meal type) |
| `patch_data_point` | Update record |
| `delete_data_point` | Delete one record |
| `batch_delete_data_points` | Delete by names (max 10,000) |
| `delete_by_filter` | Delete by filter (list → batch) |

### Export & Profile
| Tool | Description |
|------|-------------|
| `export_exercise_tcx` | TCX XML export |
| `get_profile` / `update_profile` | User profile |
| `get_settings` / `update_settings` | Settings (units) |
| `get_identity` | Identity |
| `get_irn_profile` | Irregular Rhythm Notification |
| `list_paired_devices` / `get_paired_device` | Devices |

### Discovery
| Tool | Description |
|------|-------------|
| `list_data_types` | All 39 types with metadata |
| `describe_data_type` | Type details: filters, limits, gotchas |

## Resources

| URI | Description |
|-----|-------------|
| `health://profile` | User profile |
| `health://settings` | Settings |
| `health://devices` | Devices |
| `health://summary/{date}` | Template: daily summary |

## Prompts

| Name | Description |
|------|-------------|
| `health_weekly_review` | 7-day health review |
| `sleep_quality_analysis` | Sleep analysis (stages, HRV, efficiency) |
| `workout_summary` | Exercise and HR zones |

## Key Features

- **OAuth2 auto-refresh**: single-flight gate, double-check, 401 → refresh → retry
- **Retry with backoff**: 500ms → 1500ms → 4000ms for 429/5xx/network
- **Response cache**: 120s TTL, clear-on-write
- **Concurrency**: daily summary fetches 34 requests in parallel (limit 10)
- **Error classification**: 403/404/400/filter errors → actionable `next_steps`
- **Pagination hints**: `_hint` when `nextPageToken` is present
- **Simplify**: auto-remove `dataSource`/`createTime`/`updateTime` from responses

## Tests

```bash
go test ./... -v        # 36 tests
go test ./... -cover    # ~12% (all pure functions >90%)
```

## Benchmark (Rust vs Go)

| Metric | Rust | Go |
|--------|------|-----|
| Binary | 14 MB | 7 MB |
| Idle RSS | 7.8 MB | 10.5 MB |
| RSS under load | 10.4 MB | 11.5 MB |
| Latency (tools/list) | ~42 ms | ~41 ms |
| Jitter | 34–174 ms | 34–63 ms |

Performance difference is negligible — both are bottlenecked by the upstream Google API.

## Build

```bash
# Standard
go build -o google-health-mcp .

# Optimized (stripped)
go build -ldflags="-s -w" -o google-health-mcp .

# Cross-compile for Linux (server)
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o google-health-mcp-linux .
```

## Dependencies

- `github.com/mark3labs/mcp-go` — MCP protocol SDK (tools, resources, prompts, stdio, HTTP)
- `github.com/joho/godotenv` — `.env` file loading
