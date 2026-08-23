# Common Development Tasks

## Adding a New Tool

1. **Add to Rust first** (`src/tools.rs`): implement handler, add to tool registry
2. **Add to Go** (`go/tools_*.go` by category): match name, params, return format exactly
3. **Add to TypeScript** (`ts/src/tools.ts`): match name, params, return format
4. **Add to Python** (`py/src/tools.py` + spec in `py/src/server.py`): match name, params, return format
5. **Update README.md**: add tool to the tools table
6. **Update ARCHITECTURE.md** if needed
7. **Run tests** in all implementations

## Adding a New Data Type

1. Add to `src/types.rs` (Rust reference)
2. Add to `go/types.go`
3. Add to `ts/src/types.ts`
4. Add to `py/src/types.py`
5. Update the data types resource in each implementation

## Modifying Auth Flow

Auth logic lives in:
- Rust: `src/auth.rs`
- Go: `go/auth.go`
- TypeScript: `ts/src/auth.ts` (AuthState class)
- Python: `py/src/auth.py`

Changes must be synchronized across all four.

## Working with the Dashboard

```bash
cd astrojs
npm run dev          # Start dev server
npm run check        # Type check
npm test             # Run Vitest tests
npm run build        # Production build
```

The dashboard talks to the Google Health API v4 **directly** (server-side proxy in
`src/lib/gh-client.ts`) using its own OAuth refresh token; it does NOT talk to the
Rust MCP server and does not need `MCP_API_KEY`.

## Release Process

1. Update CHANGELOG.md
2. Tag: `git tag v0.X.0`
3. Push tag: `git push origin v0.X.0`
4. GitHub Actions builds binaries and Python package automatically

## Docker

```bash
# MCP server (Rust)
docker build -t googlehealth-mcp .
docker run --env-file .env googlehealth-mcp

# Dashboard
cd astrojs
docker build -t googlehealth-dashboard .
docker run -p 4321:4321 --env-file .env googlehealth-dashboard

# Both via docker-compose
docker compose up
```
