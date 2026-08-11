# Google Health MCP Server — C Implementation

MCP server for Google Health API v4 in C: 39 data types, 15 core tools.
Uses vendored cJSON and libcurl.

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

## Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| `GOOGLE_CLIENT_ID` | Yes | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Yes | OAuth refresh token |

## Structure

```
c/
├── Makefile
├── main.c        # MCP server: tool registration, JSON-RPC dispatch
├── auth.c        # OAuth2 token refresh, HTTP client
├── auth.h        # Auth interface
├── cJSON.c       # Vendored cJSON library (MIT, Dave Gamble)
└── cJSON.h       # cJSON header
```

## Dependencies

- **libcurl** — HTTP client for Google Health API calls
- **cJSON** — JSON parsing/serialization (vendored, MIT license)
