# Architecture

This document describes the system architecture of the Google Health MCP Server.

## Overview

```
┌─────────────────┐     MCP (stdio/HTTP)     ┌──────────────────────┐
│   MCP Client    │ ◄──────────────────────► │   Google Health MCP  │
│ (Claude Desktop │                           │       Server         │
│  ZCode, etc.)   │                           │  (Rust/Go/TS/Python) │
└─────────────────┘                           └──────────┬───────────┘
                                                         │
                                                         │ HTTPS (OAuth2)
                                                         ▼
                                              ┌──────────────────────┐
                                              │  Google Health API   │
                                              │        v4            │
                                              └──────────────────────┘
```

The server acts as a bridge between MCP clients (LLMs) and the Google Health API. It handles OAuth2 authentication, request routing, response caching, and error recovery transparently.

## Request Flow

```
MCP Client ──JSON-RPC──► Server ──HTTPS──► Google Health API
                                         │
                                         ▼
                                    ┌─────────┐
                                    │  Cache   │ (120s TTL)
                                    └─────────┘
```

### 1. Client Request
The MCP client sends a JSON-RPC `tools/call` request with a tool name and arguments.

### 2. Tool Dispatch
The server matches the tool name to a handler function.

### 3. Token Resolution
The handler calls `get_token()` which returns a valid access token:
- **Fast path**: Token is cached and not expired → return immediately
- **Slow path**: Token expired → acquire refresh gate → double-check → refresh from Google OAuth

### 4. API Call
The handler constructs the Google Health API request and sends it via the HTTP client.

### 5. Retry Logic
If the request fails:
- **401 Unauthorized**: Refresh token once, retry immediately
- **429 Too Many Requests**: Retry with backoff (500ms → 1500ms → 4000ms)
- **5xx Server Error**: Retry with backoff
- **Network error**: Retry with backoff
- **400/403/404**: Return immediately with structured error and `next_steps`

### 6. Response Processing
- Raw API responses are simplified (remove `dataSource`, `createTime`, `updateTime`, empty objects)
- Results are returned as both text (pretty JSON) and `structuredContent` (parsed object)
- Pagination hints are added when `nextPageToken` is present

## OAuth2 Token Management

```
┌─────────────────────────────────────────────────────────────┐
│                        AuthState                            │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  client_id   │    │ client_secret│    │refresh_token │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  TokenState (RwLock)                                 │  │
│  │  ├── access_token: String                            │  │
│  │  └── expires_at: Option<Instant>                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────┐    ┌──────────────────────────────┐  │
│  │  refresh_gate    │    │  ResponseCache (120s TTL)    │  │
│  │  (Mutex)         │    │  HashMap<String, (Instant,   │  │
│  │                  │    │    Value)>                    │  │
│  └──────────────────┘    └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Token Refresh Flow

```
get_token()
  │
  ├─ Token valid? ──YES──► Return token
  │
  NO
  │
  ▼
Acquire refresh_gate (Mutex)
  │
  ├─ Double-check: another task refreshed? ──YES──► Return new token
  │
  NO
  │
  ▼
POST https://oauth2.googleapis.com/token
  client_id + client_secret + refresh_token
  │
  ├─ Success ──► Update TokenState, return access_token
  │
  └─ Failure ──► Return error (server continues with stale token)
```

### 401 Recovery Flow

```
API request returns 401
  │
  ▼
refresh_if_stale(stale_token)
  │
  ├─ Token changed? ──YES──► Use new token, retry request
  │
  NO
  │
  ▼
Refresh token via OAuth
  │
  ├─ Success ──► Retry request with new token
  │
  └─ Failure ──► Return error
```

## Data Type Registry

The server maintains a registry of all 39 Google Health data types with metadata used for filter building, pagination, and documentation:

```
DataTypeInfo {
    id: "heart-rate",              // kebab-case
    filter_name: "heart_rate",     // snake_case (for AIP-160 filters)
    category: "cardiac",           // activity, cardiac, body, sleep, etc.
    listable: true,                // supports list_data_points
    rollup: true,                  // supports rollup_data_points
    daily_rollup: true,            // supports daily_rollup_data_points
    writable: false,               // supports create/patch/delete
    reconcilable: true,            // supports reconcile_data_points
    time_field: "sample_physical", // determines filter expression
    page_cap: 10000,               // max page size
    rollup_range_days: 14,         // max rollup range
    description: "...",
    key_fields: ["beatsPerMinuteAvg", "beatsPerMinuteMin", "beatsPerMinuteMax"],
    gotchas: ["int64 fields are strings in JSON"],
}
```

### Filter Building

The filter expression is constructed based on `time_field`:

| `time_field` | Filter expression | Example |
|--------------|-------------------|---------|
| `interval_start` | `{type}.interval.start_time >= "..."` | `steps.interval.start_time >= "2026-07-01T00:00:00Z"` |
| `interval_end` | `{type}.interval.end_time >= "..."` | `sleep.interval.end_time >= "2026-07-01T00:00:00Z"` |
| `sample_physical` | `{type}.sample_time.physical_time >= "..."` | `heart_rate.sample_time.physical_time >= "2026-07-01T00:00:00Z"` |
| `daily` | `{type}.date >= "..."` | `daily_resting_heart_rate.date >= "2026-07-01"` |
| `civil_start` | `{type}.interval.civil_start_time >= "..."` | `exercise.interval.civil_start_time >= "2026-07-01"` |

Special cases:
- **ECG**: Only `>=` filter (no upper bound)
- **Sleep**: Supports both `end_time` and `civil_end_time`

## Daily Summary

The `summary`/`today`/`yesterday` tools fetch ~34 metrics in parallel:

```
build_daily_summary(date)
  │
  ├─ 20 dailyRollUp requests (steps, heart-rate, calories, distance, ...)
  ├─ 7 daily type requests (resting HR, HRV, SpO2, respiratory rate, ...)
  ├─ 4 sample type requests (VO2 max, HRV samples, SpO2 samples, ...)
  ├─ 1 sleep request (pageSize=5)
  ├─ 1 exercise request (pageSize=25)
  └─ 1 activity-level request (pageSize=50)
  │
  ▼ (concurrency = 10)
  │
  Aggregate into single response
  Collect errors in _errors array
  Cache result for 120 seconds
```

## Response Cache

```
ResponseCache {
    entries: HashMap<String, (Instant, Value)>,
    default_ttl: 120 seconds,
}
```

- **Read**: Check if entry exists and is not expired
- **Write**: Insert with current timestamp
- **Clear**: Called after any write operation (create, patch, delete) or via `clear_cache` tool
- **Key format**: `summary:YYYY-MM-DD`

## Transport Modes

### stdio Mode (default)

```
MCP Client ◄──stdin/stdout──► Server
```

- No authentication layer (client manages connection)
- Suitable for local development and desktop MCP clients
- Uses `StdioServerTransport`

### HTTP/SSE Mode (`--http`)

```
MCP Client ◄──HTTP POST /mcp──► Server
                │
                ├── GET /health (no auth)
                └── Bearer token auth
```

- Bearer token authentication via `MCP_API_KEY`
- DNS-rebinding protection with configurable allowed hosts
- SSE support for streaming responses
- Health check endpoint at `/health`

## File Structure (Rust Reference)

```
src/
├── main.rs       Entry point, MCP handler registration, server setup
├── auth.rs       OAuth2 token management, retry logic, response cache
├── tools.rs      All 35 tool implementations, filter builder, summary builder
└── types.rs      Data type registry (39 types with full metadata)
```

### Key Design Decisions

1. **Single binary**: No runtime dependencies beyond TLS (rustls)
2. **Async runtime**: Tokio with multi-threaded executor
3. **HTTP client**: Reqwest with rustls-tls (no OpenSSL)
4. **Serialization**: Serde with derive macros
5. **MCP SDK**: rust-mcp-sdk 1.0 with rust-mcp-axum for HTTP transport
