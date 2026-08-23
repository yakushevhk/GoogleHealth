.PHONY: build test lint clean docker docker-stop bench test-py

# ── Build full-parity implementations (Rust, Go, TS, Python) ────────────────────────────────────────────────

build: build-rust build-go build-ts build-py

build-rust:
	cargo build --release

build-go:
	cd go && go build -o googlehealth-mcp-go .

build-ts:
	cd ts && bun install --frozen-lockfile

build-py:
	cd py && pip install -e .

# ── Run all tests ───────────────────────────────────────────────────────────

test: test-rust test-go test-ts test-py test-astro

test-rust:
	cargo test

test-go:
	cd go && go test ./... -v

test-ts:
	cd ts && GOOGLE_CLIENT_ID=test GOOGLE_CLIENT_SECRET=test GOOGLE_REFRESH_TOKEN=test bun -e "import('./src/index.ts').then(() => console.log('OK')).catch(() => process.exit(1))"

test-astro:
	cd astrojs && npm test
test-py:
	cd py && GOOGLE_CLIENT_ID=test GOOGLE_CLIENT_SECRET=test GOOGLE_REFRESH_TOKEN=test python3 -c "from src.server import *; print('OK')"

# ── Lint ────────────────────────────────────────────────────────────────────

lint: lint-rust lint-go

lint-rust:
	cargo fmt --check

lint-go:
	cd go && gofmt -l .

# ── Clean build artifacts ───────────────────────────────────────────────────

clean:
	cargo clean
	rm -f go/googlehealth-mcp-go
	rm -rf ts/node_modules
	rm -rf py/dist py/build
	find . -type d -name __pycache__ -exec rm -rf {} +

# ── Docker ──────────────────────────────────────────────────────────────────

docker:
	docker compose up -d

docker-stop:
	docker compose down
# ── Benchmark ───────────────────────────────────────────────────────────────

bench: build-rust build-go
	bash bench/bench.sh
