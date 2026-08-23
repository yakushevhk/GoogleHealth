# Google Health MCP Server — Zig Implementation (PoC)

Proof-of-concept MCP server in Zig. Lists 10 tools (only 3 implemented) and 39 data types.
Uses raw POSIX fd I/O to avoid `std.Io` API instability in Zig 0.16.

## Quick Start

```bash
cd zig
zig build -Doptimize=ReleaseSmall   # 101 KB binary
./zig-out/bin/google-health-mcp
```

## Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| `GOOGLE_CLIENT_ID` | No | Warning is printed if unset; unused by the PoC |
| `GOOGLE_CLIENT_SECRET` | No | Unused by the PoC |
| `GOOGLE_REFRESH_TOKEN` | No | Unused by the PoC |

## Supported Tools (10)

`list_data_types`, `describe_data_type`, `list_data_points`, `get_profile`, `get_settings`, `list_paired_devices`, `get_identity`, `clear_cache`, `today`, `yesterday`

Note: only `list_data_types`, `describe_data_type`, and `clear_cache` are implemented. Every other tool returns a stub response (`"requires Google Health API auth"`) — there is no HTTP client or OAuth flow in this PoC.

## Tech Stack

- Zig 0.16
- `std.json` for JSON parsing/serialization
- `std.posix` for raw fd I/O
- MCP JSON-RPC 2.0 implemented by hand (no SDK)
- `extern "c" write()` for stdout output

## Limitations

This is a proof-of-concept. It does not implement write operations, the Google Health API client (no OAuth, no HTTP requests — no token is read or used), or the full MCP protocol (no resources, no prompts).
