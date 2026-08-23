# Architecture

## Data Flow

```
MCP Client (Claude, ZCode, etc.)
    │
    │ JSON-RPC (stdio or HTTP/SSE)
    ▼
┌───────────────────────────────────┐
│         MCP Server                │
│  ┌─────────┐  ┌───────────────┐  │
│  │  Auth    │  │  Tool Router  │  │
│  │ (OAuth2) │  │  (35 tools)   │  │
│  └────┬─────┘  └───────┬───────┘  │
│       │                │          │
│  ┌────▼────┐    ┌──────▼──────┐  │
│  │ Token   │    │ HTTP Client │  │
│  │ Cache   │    │ (retry+cache)│  │
│  └─────────┘    └──────┬──────┘  │
└────────────────────────┼─────────┘
                         │ HTTPS
                         ▼
              Google Health API v4
```

## MCP Protocol Details

- **Transport**: stdio (default) or HTTP/SSE (`--http` flag)
- **Authentication**: OAuth2 with automatic token refresh
- **API key**: Bearer token in HTTP mode (constant-time comparison)
- **Cache**: 120-second TTL per endpoint, thread-safe
- **Retry**: Exponential backoff (500ms, 1500ms, 4000ms), max 3 retries. 401 → refresh token → retry; 429/5xx → retry with backoff.

## Tool Categories (35 total)

1. **Discovery (2)**: list_data_types, describe_data_type
2. **Data & Sync (6)**: list_data_points, get_data_point, reconcile_data_points, sync_data_points, rollup_data_points, daily_rollup_data_points
3. **Write & Delete (10)**: create_data_point, add_weight_sample, add_hydration_log, add_sleep_session, add_exercise_session, add_nutrition_log, patch_data_point, delete_data_point, batch_delete_data_points, delete_by_filter
4. **Export (1)**: export_exercise_tcx
5. **Profile & Devices (8)**: get_profile, update_profile, get_settings, update_settings, get_identity, get_irn_profile, list_paired_devices, get_paired_device
6. **Summaries & Analytics (8)**: summary, today, yesterday, compare_health_periods, get_hrv_recovery_trend, get_temperature_summary, get_trends, clear_cache

## Resources (4)

1. Health Profile
2. Health Settings
3. Paired Devices
4. Daily Summary

## Prompts (3)

1. health_weekly_review
2. sleep_quality_analysis
3. workout_summary

## File Layout (per implementation)

Each language implementation follows the same pattern:
- Entry point (main.rs / main.go / index.ts / server.py)
- Types/data models (types module)
- Tools/handlers (tools module)
- Auth/OAuth (auth module)
- HTTP server logic
- .env.example with required variables
