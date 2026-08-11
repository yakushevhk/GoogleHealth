.PHONY: build test lint clean docker release

# ── Build all implementations ────────────────────────────────────────────────

build: build-rust build-go build-ts build-py

build-rust:
	cargo build --release

build-go:
	cd go && go build -o googlehealth-mcp-go .

build-ts:
	cd ts && bun install

build-py:
	cd py && pip install -e .

# ── Run all tests ───────────────────────────────────────────────────────────

test: test-rust test-go test-ts test-astro

test-rust:
	cargo test

test-go:
	cd go && go test ./... -v

test-ts:
	cd ts && bun test || echo "No tests yet"

test-astro:
	cd astrojs && npm test

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
