.PHONY: build test lint clean docker docker-stop bench test-py parity update-spec

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

test: test-rust test-go test-ts test-py test-astro parity

test-rust:
	cargo test

test-go:
	cd go && go test ./... -v

test-ts:
	cd ts && bun install --frozen-lockfile && bun test && bunx tsc --noEmit

test-astro:
	cd astrojs && npm test
test-py:
	cd py && GOOGLE_CLIENT_ID=test GOOGLE_CLIENT_SECRET=test GOOGLE_REFRESH_TOKEN=test python3 -m unittest discover -s tests && python3 -c "from google_health_mcp.server import *; print('OK')"

# ── Cross-language conformance ──────────────────────────────────────────────

parity:
	python3 scripts/check-parity.py

update-spec:
	python3 scripts/check-parity.py --update-spec

# ── Lint ────────────────────────────────────────────────────────────────────

lint: lint-rust lint-go lint-ts lint-py

lint-rust:
	cargo fmt --check && cargo clippy --all-targets -- -D warnings

lint-go:
	cd go && test -z "$$(gofmt -l .)" && go vet ./...

lint-ts:
	cd ts && bunx tsc --noEmit

lint-py:
	ruff check py/ oauth_health.py scripts/

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
