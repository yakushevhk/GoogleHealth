# Testing Guide

## Test Commands

```bash
# Rust (12 unit tests)
cargo test

# Go (36 tests)
cd go && go test ./... -v

# Dashboard (329 vitest tests)
cd astrojs && npm test

# TypeScript — no tests yet (import check only)
cd ts && bun install && GOOGLE_CLIENT_ID=test GOOGLE_CLIENT_SECRET=test GOOGLE_REFRESH_TOKEN=test bun -e "import('./src/index.ts').then(() => console.log('OK')).catch(() => process.exit(1))"

# Python — no tests yet (import check only)
cd py && pip install -e . && GOOGLE_CLIENT_ID=test GOOGLE_CLIENT_SECRET=test GOOGLE_REFRESH_TOKEN=test python3 -c "from src.server import *; print('OK')"
```

## Build Commands

```bash
# Rust
cargo build --release

# Go
cd go && go build -o googlehealth-mcp-go .

# TypeScript
cd ts && bun install

# Python
cd py && pip install -e .

# Dashboard
cd astrojs && npm ci && npm run check && npm test && npm run build

# Docker (Rust MCP server)
docker build -t googlehealth-mcp .

# Docker (Dashboard)
cd astrojs && docker build -t googlehealth-dashboard .
```

## CI/CD

GitHub Actions runs on push/PR to main:
- **Rust**: cargo test + cargo build --release
- **Go**: go test ./... -v
- **TypeScript**: import check (bun)
- **Python**: import check
- **Dashboard**: npm run check + npm test + npm run build

Release workflow: tags matching `v*` trigger a Linux binary build for Rust and Go, plus a Python sdist/wheel upload (TS, C, Zig, and the dashboard are not released).

## Adding Tests

- Rust: add `#[cfg(test)]` modules in the same file
- Go: add `*_test.go` files in the same package
- Dashboard: add `*.test.ts` in `astrojs/tests/`
- TypeScript: tests not yet implemented
- Python: tests not yet implemented
