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
