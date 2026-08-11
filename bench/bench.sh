#!/bin/bash
# Benchmark: Rust vs Go MCP server
# Measures: binary size, idle RSS, request latency, CPU
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUST_BIN="$ROOT/target/release/google-health-mcp"
GO_BIN="$ROOT/target/go-mcp-bench"
RUST_PORT=19871
GO_PORT=19872
RESULTS="$ROOT/bench/results.txt"

# Load env
source "$ROOT/.env" 2>/dev/null || true
export GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-test}"
export GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-test}"
export GOOGLE_REFRESH_TOKEN="${GOOGLE_REFRESH_TOKEN:-test}"
export MCP_API_KEY="bench-key"

mkdir -p "$ROOT/bench"
> "$RESULTS"

log() { echo "$1" | tee -a "$RESULTS"; }

log "══════════════════════════════════════════════════════════"
log "  MCP Server Benchmark: Rust vs Go"
log "  $(date)"
log "══════════════════════════════════════════════════════════"
log ""

# ─── Binary sizes ────────────────────────────────────────────────────────────
RUST_SIZE=$(ls -lh "$RUST_BIN" | awk '{print $5}')
GO_SIZE=$(ls -lh "$GO_BIN" | awk '{print $5}')
log "Binary size:  Rust=$RUST_SIZE  Go=$GO_SIZE"
log ""

# ─── MCP JSON-RPC payloads ───────────────────────────────────────────────────
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"bench","version":"1.0"}}}'
TOOLS_LIST='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
CALL_TOOL='{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_data_types","arguments":{}}}'

# ─── Start servers ───────────────────────────────────────────────────────────
log "Starting servers..."
HOST=127.0.0.1 PORT=$RUST_PORT "$RUST_BIN" --http &>/dev/null &
RUST_PID=$!
HOST=127.0.0.1 PORT=$GO_PORT "$GO_BIN" --http &>/dev/null &
GO_PID=$!

sleep 2  # wait for startup

# Verify both are up
if ! kill -0 $RUST_PID 2>/dev/null; then log "ERROR: Rust server failed to start"; exit 1; fi
if ! kill -0 $GO_PID 2>/dev/null; then log "ERROR: Go server failed to start"; exit 1; fi
log "  Rust PID=$RUST_PID (port $RUST_PORT)"
log "  Go   PID=$GO_PID (port $GO_PORT)"
log ""

# ─── Idle RSS ────────────────────────────────────────────────────────────────
RUST_RSS=$(ps -o rss= -p $RUST_PID | awk '{printf "%.1f", $1/1024}')
GO_RSS=$(ps -o rss= -p $GO_PID | awk '{printf "%.1f", $1/1024}')
log "Idle RSS:     Rust=${RUST_RSS} MB  Go=${GO_RSS} MB"
log ""

# ─── Latency benchmark ───────────────────────────────────────────────────────
bench_endpoint() {
    local name=$1 port=$2 payload=$3 iterations=$4
    local total=0
    local min=999999
    local max=0

    for i in $(seq 1 $iterations); do
        local start=$(python3 -c "import time; print(int(time.time()*1000000))")
        curl -s -o /dev/null -w '' \
            -X POST "http://127.0.0.1:$port/mcp" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer bench-key" \
            -H "Accept: application/json, text/event-stream" \
            -d "$payload" 2>/dev/null
        local end=$(python3 -c "import time; print(int(time.time()*1000000))")
        local elapsed=$(( end - start ))
        total=$(( total + elapsed ))
        if [ $elapsed -lt $min ]; then min=$elapsed; fi
        if [ $elapsed -gt $max ]; then max=$elapsed; fi
    done

    local avg=$(( total / iterations ))
    # Convert μs to ms
    local avg_ms=$(python3 -c "print(f'{$avg/1000:.2f}')")
    local min_ms=$(python3 -c "print(f'{$min/1000:.2f}')")
    local max_ms=$(python3 -c "print(f'{$max/1000:.2f}')")
    echo "$avg_ms $min_ms $max_ms"
}

ITERATIONS=50
log "Latency ($ITERATIONS requests each):"
log "──────────────────────────────────────────────────────────"

# Initialize
R=$(bench_endpoint "Rust init" $RUST_PORT "$INIT" $ITERATIONS)
G=$(bench_endpoint "Go init" $GO_PORT "$INIT" $ITERATIONS)
log "  initialize:    Rust avg=$(echo $R | cut -d' ' -f1)ms (min=$(echo $R | cut -d' ' -f2) max=$(echo $R | cut -d' ' -f3))"
log "                 Go   avg=$(echo $G | cut -d' ' -f1)ms (min=$(echo $G | cut -d' ' -f2) max=$(echo $G | cut -d' ' -f3))"

# tools/list
R=$(bench_endpoint "Rust tools/list" $RUST_PORT "$TOOLS_LIST" $ITERATIONS)
G=$(bench_endpoint "Go tools/list" $GO_PORT "$TOOLS_LIST" $ITERATIONS)
log "  tools/list:    Rust avg=$(echo $R | cut -d' ' -f1)ms (min=$(echo $R | cut -d' ' -f2) max=$(echo $R | cut -d' ' -f3))"
log "                 Go   avg=$(echo $G | cut -d' ' -f1)ms (min=$(echo $G | cut -d' ' -f2) max=$(echo $G | cut -d' ' -f3))"

# tools/call (list_data_types — no upstream API)
R=$(bench_endpoint "Rust call" $RUST_PORT "$CALL_TOOL" $ITERATIONS)
G=$(bench_endpoint "Go call" $GO_PORT "$CALL_TOOL" $ITERATIONS)
log "  tools/call:    Rust avg=$(echo $R | cut -d' ' -f1)ms (min=$(echo $R | cut -d' ' -f2) max=$(echo $R | cut -d' ' -f3))"
log "  (list_data_types)  Go   avg=$(echo $G | cut -d' ' -f1)ms (min=$(echo $G | cut -d' ' -f2) max=$(echo $G | cut -d' ' -f3))"

log ""

# ─── RSS after load ──────────────────────────────────────────────────────────
RUST_RSS2=$(ps -o rss= -p $RUST_PID | awk '{printf "%.1f", $1/1024}')
GO_RSS2=$(ps -o rss= -p $GO_PID | awk '{printf "%.1f", $1/1024}')
log "RSS after load: Rust=${RUST_RSS2} MB  Go=${GO_RSS2} MB"
log ""

# ─── CPU time ────────────────────────────────────────────────────────────────
RUST_CPU=$(ps -o cputime= -p $RUST_PID | xargs)
GO_CPU=$(ps -o cputime= -p $GO_PID | xargs)
log "CPU time:       Rust=$RUST_CPU  Go=$GO_CPU"
log ""

# ─── Cleanup ─────────────────────────────────────────────────────────────────
kill $RUST_PID $GO_PID 2>/dev/null || true
wait $RUST_PID $GO_PID 2>/dev/null || true

log "══════════════════════════════════════════════════════════"
log "  Done. Results saved to $RESULTS"
log "══════════════════════════════════════════════════════════"
