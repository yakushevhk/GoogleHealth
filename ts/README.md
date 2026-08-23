# Google Health MCP Server — TypeScript (Bun) Implementation

MCP server for Google Health API v4: 35 tools, 39 data types, 4 resources, 3 prompts.

## Quick Start

```bash
cd ts
bun install
bun run start          # stdio mode
bun run start:http     # HTTP mode on 127.0.0.1:3000
```

## Environment Variables

Copy `.env.example` → `.env` and fill in:

| Variable | Required | Description |
|----------|:--------:|-------------|
| `GOOGLE_CLIENT_ID` | Yes | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Yes | OAuth refresh token |
| `MCP_API_KEY` | Yes* | API key for HTTP mode (*required when using `--http`) |
| `HOST` | — | Bind address (default: `127.0.0.1`) |
| `PORT` | — | Bind port (default: `3000`) |

## Structure

```
ts/
├── src/
│   ├── index.ts      # Server entry: MCP handlers, HTTP server
│   ├── auth.ts       # OAuth2 token refresh, retry, cache
│   ├── tools.ts      # All 35 tool definitions and handlers
│   └── types.ts      # Data type registry (39 types)
├── .env.example
├── package.json
└── tsconfig.json
```

## HTTP API

```bash
# Health check
curl http://127.0.0.1:3000/health

# MCP JSON-RPC
curl -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_data_types","arguments":{}}}'
```

## Differences from Rust/Go

- Direct JSON-RPC handling (no SSE sessions in HTTP mode)
- Stateless HTTP mode — each request is independent
- Uses Bun's built-in `fetch` for HTTP client
- Low-level MCP Server API (no high-level SDK wrapper)
