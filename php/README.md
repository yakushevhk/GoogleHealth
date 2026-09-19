# Google Health MCP — PHP Implementation

Partial implementation (like `c/` and `zig/`): OAuth2 token refresh, HTTPS with
retry/backoff, 39-data-type registry, and 15 core tools over MCP stdio.

## Requirements

- PHP 8.0+ CLI
- `ext-curl` (HTTPS to `health.googleapis.com` and `oauth2.googleapis.com`)

## Usage

```bash
export GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=...
php main.php
```

One JSON-RPC request per line on stdin, one response per line on stdout —
same stdio contract as every other implementation in this repo.

## HTTP Mode

```bash
export MCP_API_KEY=your-secret
php main.php --http    # HOST=127.0.0.1, PORT=3000 by default
```

POST one JSON-RPC request per call to `http://127.0.0.1:3000/mcp` (or `/`) with
`Authorization: Bearer $MCP_API_KEY`. Exits with code 1 if `MCP_API_KEY` is
unset; the key comparison is constant-time (`hash_equals`). Minimal transport:
POST-only, no SSE or sessions.

## Tools

`list_data_types`, `describe_data_type`, `list_data_points`, `get_data_point`,
`get_profile`, `get_settings`, `get_identity`, `list_paired_devices`,
`get_irn_profile`, `clear_cache`, `today`, `yesterday`, `summary`,
`add_weight_sample`, `export_exercise_tcx`.

`today`/`yesterday`/`summary` return an `info` stub — daily summaries need
multiple parallel API calls; use the Rust/Go/TypeScript/Python implementations
for the full 35-tool surface (resources, prompts, deletes, write tools).

Without `GOOGLE_*` env vars the server still answers `initialize`, `tools/list`
and registry tools; API tools return a `not configured` error instead of
crashing.
