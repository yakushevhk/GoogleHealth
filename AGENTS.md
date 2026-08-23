# AGENTS.md — Instructions for AI Coding Agents

This file provides context for AI agents (Copilot, Cursor, Claude, Trae, etc.) working on this repository.

## Project Summary

Multi-language MCP server for Google Health Connect API v4. One protocol, six language implementations, one web dashboard.

## Critical Rules

1. **Rust (`src/`) is the reference implementation.** All changes to tools/resources/prompts/types must be made in Rust first, then ported to Go, TypeScript, and Python with 1:1 parity.
2. **Never commit secrets.** Only `.env.example` with empty values. Real credentials go in `.env` (gitignored).
3. **MCP_API_KEY is required for HTTP mode** — no defaults, no fallbacks. All implementations must exit(1) if missing.
4. **Constant-time comparison** for API keys in all HTTP implementations.
5. **35 tools, 4 resources, 3 prompts** — the exact count must be maintained across Go, TS, Python.

## File Map

| Path | Purpose |
|------|---------|
| `src/` | Rust reference implementation |
| `go/` | Go implementation |
| `ts/` | TypeScript (Bun) implementation |
| `py/` | Python implementation |
| `c/` | C implementation (partial) |
| `zig/` | Zig implementation (PoC) |
| `astrojs/` | Web dashboard (Astro 7 + ECharts) |
| `.github/workflows/` | CI/CD (ci.yml, release.yml) |
| `.skills/` | Detailed context for AI agents |

## Key Files per Implementation

- **Rust**: `src/main.rs`, `src/tools.rs`, `src/types.rs`, `src/auth.rs`
- **Go**: `go/main.go`, `go/tools.go`, `go/types.go`, `go/auth.go`
- **TypeScript**: `ts/src/index.ts`
- **Python**: `py/src/server.py`, `py/src/tools.py`, `py/src/types.py`, `py/src/auth.py`
- **Dashboard**: `astrojs/src/lib/`, `astrojs/src/pages/`, `astrojs/src/components/`

## Build & Test Quick Reference

```bash
cargo test                              # Rust tests
cd go && go test ./... -v               # Go tests
cd astrojs && npm test                  # Dashboard tests
cd ts && bun install                    # TS dependencies
cd py && pip install -e .               # Python dependencies
```

## Documentation

| File | Purpose |
|------|---------|
| README.md | Project overview, quick start, tool reference |
| START.md | Step-by-step setup guide |
| ARCHITECTURE.md | System architecture and data flow |
| CONTRIBUTING.md | How to contribute |
| SECURITY.md | Security policy |
| CHANGELOG.md | Release history |
| .skills/ | Detailed AI agent context |

## Before Submitting Changes

1. Run tests for the language you changed
2. If adding/modifying a tool: update ALL implementations
3. Update README.md if tool list changed
4. Update CHANGELOG.md for user-facing changes
5. Ensure no secrets in diff (`git diff`)
