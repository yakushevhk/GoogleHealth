# Google Health MCP Server — Zig Implementation (partial)

Partial MCP server in Zig — same 15-tool core set as `c/`: OAuth2 token
refresh, HTTPS via `std.http.Client` (on `std.Io.Threaded`), 39-data-type
registry, stdio transport over raw POSIX fd I/O.

## Quick Start

```bash
cd zig
zig build -Doptimize=ReleaseSmall
export GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=...
./zig-out/bin/google-health-mcp
```

## Tools

`list_data_types`, `describe_data_type`, `list_data_points`, `get_data_point`,
`get_profile`, `get_settings`, `get_identity`, `list_paired_devices`,
`get_irn_profile`, `clear_cache`, `today`, `yesterday`, `summary`,
`add_weight_sample`, `export_exercise_tcx`.

`today`/`yesterday`/`summary` return an `info` stub — daily summaries need
multiple parallel API calls; use Rust/Go/TypeScript/Python for the full
35-tool surface (resources, prompts, deletes, write tools).

Without `GOOGLE_*` env vars the server still answers `initialize`,
`tools/list` and registry tools; API tools return a `not configured` error.
