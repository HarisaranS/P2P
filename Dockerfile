# HexGab — multi-stage reproducible build
FROM rust:1.85-bookworm AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY crates ./crates

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev libxcb-render0-dev libxcb-shape0-dev libxcb-xfixes0-dev \
    libxkbcommon-dev libgtk-3-dev libwayland-dev \
    && rm -rf /var/lib/apt/lists/*

RUN cargo build --release -p hexgab-gui

FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tor \
    libxcb-render0 libxcb-shape0 libxcb-xfixes0 libxkbcommon0 \
    libgtk-3-0 libwayland-client0 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 hexgab

COPY --from=builder /app/target/release/hexgab-gui /usr/local/bin/hexgab-gui
COPY docker/entrypoint.sh /entrypoint.sh
COPY docker/torrc /etc/tor/torrc

RUN chmod +x /entrypoint.sh && chown -R hexgab:hexgab /etc/tor

USER hexgab
WORKDIR /home/hexgab

ENV HEXGAB_BIND_HOST=0.0.0.0
ENV HEXGAB_TRANSPORT=direct
ENV DISPLAY=:0

EXPOSE 17845

ENTRYPOINT ["/entrypoint.sh"]
CMD ["hexgab-gui"]
