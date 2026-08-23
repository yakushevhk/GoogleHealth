# Project Overview

Google Health MCP Server — a multi-language implementation of an MCP (Model Context Protocol) server that bridges LLM clients to the Google Health Connect API v4.

## What It Does

- Exposes 35 MCP tools (read and write: data queries, sync, rollups, create/patch/delete, summaries, profile/settings/devices)
- 4 MCP resources: `health://profile`, `health://settings`, `health://devices`, `health://summary/{date}` (template)
- 3 MCP prompts: `health_weekly_review`, `sleep_quality_analysis`, `workout_summary`
- Handles OAuth2 token refresh, retry with exponential backoff, and response caching (120s TTL)

## Language Implementations

| Directory | Language | Status | Notes |
|-----------|----------|--------|-------|
| `src/` | Rust | Reference (100%) | The canonical implementation. All others must match. |
| `go/` | Go | Full parity (100%) | Uses mcp-go SDK |
| `ts/` | TypeScript (Bun) | Full parity (100%) | Uses @modelcontextprotocol/sdk |
| `py/` | Python | Full parity (100%) | Uses mcp SDK 2.x, httpx, uvicorn |
| `c/` | C | Partial (~40%) | 15 tools (3 stubbed), no resources/prompts/HTTP |
| `zig/` | Zig | PoC (~15%) | 10 tools listed, only 3 functional (no API access) |
| `astrojs/` | Astro.js (Dashboard) | Web UI (read + write) | Astro 7, ECharts, Vitest |

## Key Rule

**Rust (`src/`) is the reference implementation.** Every tool, resource, prompt, data type, auth flow, retry strategy, and caching behavior in Go/TS/Python must be 1:1 with Rust. C and Zig are documented as partial and do not require parity.
