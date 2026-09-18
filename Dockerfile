# rust-mcp-sdk requires Rust >= 1.80; pin the builder to the toolchain this
# crate is developed against.
FROM rust:1.97-slim-bookworm AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src/ src/

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home gh

COPY --from=builder /app/target/release/google-health-mcp /usr/local/bin/google-health-mcp

USER gh
EXPOSE 3000

ENTRYPOINT ["google-health-mcp"]
