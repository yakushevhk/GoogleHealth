# Google Health MCP Server — Zig Implementation (PoC)

Proof-of-concept MCP server in Zig. Supports 10 tools and 39 data types.
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
| `GOOGLE_CLIENT_ID` | Yes | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Yes | OAuth refresh token |

## Supported Tools (10)

`list_data_types`, `describe_data_type`, `list_data_points`, `get_profile`, `get_settings`, `list_paired_devices`, `get_identity`, `clear_cache`, `today`, `yesterday`

Note: `today` and `yesterday` require multiple parallel API calls and return stub responses. For full daily summary support, use the Rust, Go, TypeScript, or Python implementations.

## Tech Stack

- Zig 0.16
- `std.json` for JSON parsing/serialization
- `std.posix` for raw fd I/O
- MCP JSON-RPC 2.0 implemented by hand (no SDK)
- `extern "c" write()` for stdout output

## Limitations

This is a proof-of-concept. It does not implement write operations, OAuth token refresh (uses a pre-obtained access token), or the full MCP protocol (no resources, no prompts).
