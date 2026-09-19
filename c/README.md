# Google Health MCP Server — C Implementation

MCP server for Google Health API v4 in C: 39 data types, 15 core tools.
Uses vendored cJSON and libcurl.

## Status: Partial Implementation

This implementation is **partial** — a subset of the MCP server surface is available:
- 15 core tools registered, but `today`, `yesterday`, and `summary` return informational stubs (see `main.c`)
- Tool `inputSchema` fields for `tools/list` are largely empty
- OAuth2 token refresh is implemented in `auth.c`

It compiles and runs, but is not feature-complete. The Rust implementation in `src/` is the reference implementation.

## Prerequisites

- C compiler (gcc or clang)
- libcurl development headers
- `make`

## Quick Start

```bash
cd c
make
./google-health-mcp
```

## HTTP Mode

```bash
export MCP_API_KEY=your-secret
./google-health-mcp --http    # HOST=127.0.0.1, PORT=3000 by default
```

POST one JSON-RPC request per call to `http://127.0.0.1:3000/mcp` (or `/`) with
`Authorization: Bearer $MCP_API_KEY`. Exits with code 1 if `MCP_API_KEY` is
unset; the key comparison is constant-time. Minimal transport: POST-only, no
SSE or sessions.

## Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| `GOOGLE_CLIENT_ID` | Yes | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Yes | OAuth refresh token |
| `MCP_API_KEY` | `--http` only | Bearer key; required, exits(1) if unset |
| `HOST` | No | HTTP bind address (default `127.0.0.1`) |
| `PORT` | No | HTTP port (default `3000`) |

## Structure

```
c/
├── Makefile
├── main.c        # MCP server: tool registration, JSON-RPC dispatch
├── auth.c        # OAuth2 token refresh, HTTP client
├── auth.h        # Auth interface
├── http.c        # Minimal HTTP mode: POST /mcp + Bearer auth
├── cJSON.c       # Vendored cJSON library (MIT, Dave Gamble)
└── cJSON.h       # cJSON header
```

## Dependencies

- **libcurl** — HTTP client for Google Health API calls
- **cJSON** — JSON parsing/serialization (vendored, MIT license)
