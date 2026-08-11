# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
