# Google Health MCP Server — Python Implementation

MCP server for Google Health API v4: 35 tools, 39 data types, 4 resources, 3 prompts.

## Quick Start

```bash
cd py
python3 -m pip install -e .

# stdio mode
python3 -m src.server

# HTTP mode
python3 -m src.server --http
```

## Environment Variables

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
py/
├── pyproject.toml
└── src/
    ├── __init__.py
    ├── server.py     # MCP server entry: stdio + HTTP modes
    ├── auth.py       # OAuth2 token refresh, retry, cache
    ├── tools.py      # All 35 tool handlers
    └── types.py      # Data type registry (39 types)
```

## Tech Stack

- Python 3.11+
- `asyncio` + `httpx` (async HTTP client)
- `mcp` 2.x (MCPServer, stdio + StreamableHTTP)
- `asyncio.Lock` for single-flight token refresh
- `asyncio.gather` for concurrent metric fetching
