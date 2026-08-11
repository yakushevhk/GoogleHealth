FROM rust:1.75-slim AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src/ src/

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/google-health-mcp /usr/local/bin/google-health-mcp

EXPOSE 3000

ENTRYPOINT ["google-health-mcp"]
