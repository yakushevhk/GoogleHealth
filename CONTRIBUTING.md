# Contributing to Google Health MCP Server

Thank you for your interest in contributing! This project provides MCP (Model Context Protocol) servers for the Google Health API v4 in multiple languages.

## Getting Started

1. Fork the repository
2. Clone your fork
3. Create a feature branch: `git checkout -b feature/my-change`
4. Make your changes
5. Run tests (see below)
6. Commit and push
7. Open a Pull Request

## Development Setup

### Prerequisites

- **Rust 1.80+** — for the reference implementation
- **Go 1.25+** — for the Go implementation
- **Bun** — for the TypeScript implementation
- **Python 3.11+** — for the Python implementation
- **Zig 0.16** — for the Zig PoC
- **Google Cloud project** with OAuth2 credentials (see [START.md](START.md))

### Running Tests

```bash
# Rust
cargo test

# Go
cd go && go test ./... -v

# Dashboard (Astro.js)
cd astrojs && npm test
```

## Project Structure

The reference implementation is in **Rust** (`src/`). All other implementations (Go, TypeScript, Python, Zig, C) must maintain parity with the Rust version.Go, TypeScript, and Python must maintain 1:1 parity with the Rust version. C and Zig are partial/PoC implementations; align them with Rust where implemented.

```
src/        # Rust (reference) — 35 tools, 39 types
go/         # Go — full parity
ts/         # TypeScript (Bun) — full parity
py/         # Python — full parity
zig/        # Zig — PoC (10 tools)
c/          # C — partial
astrojs/    # Web dashboard (read + write)
```

## Parity Requirements

When adding a new tool or data type:

1. Implement it in Rust first (`src/tools.rs`, `src/types.rs`)
2. Port to Go (`go/tools_*.go`, `go/types.go`)
3. Port to TypeScript (`ts/src/tools.ts`, `ts/src/types.ts`)
4. Port to Python (`py/src/tools.py`, `py/src/types.py`)
5. Update README.md with the new tool/type documentation

## Code Style

- **Rust**: Follow standard `rustfmt` formatting. Comments in English.
- **Go**: Follow `gofmt` and Go conventions. Comments in English.
- **TypeScript**: Use TypeScript strict mode. Minimize `any` usage.
- **Python**: Follow PEP 8. Use type hints where practical.

## Commit Messages

Use clear, descriptive commit messages:

```
feat: add swim_lengths data type support
fix: handle 403 error in HRV trend tool
docs: update START.md with new scopes
test: add filter builder tests for daily types
```

## Security

**Never commit credentials.** The `.gitignore` excludes `.env`, `health_token.json`, and `raw_api_responses.json`. If you discover a security issue, please report it privately rather than opening a public issue.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
