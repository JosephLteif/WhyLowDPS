FROM node:22.22.2-bookworm-slim AS frontend-builder

WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --prefix frontend

COPY frontend ./frontend
COPY backend/resources ./backend/resources
COPY docs/whats-new-history.md ./docs/whats-new-history.md
COPY scripts/sync-changelog.js ./scripts/sync-changelog.js
ARG WHYLOWDPS_DEPLOYMENT=hosted-private
ENV NODE_ENV=production \
    WEB_STATIC_BUILD=true \
    NEXT_PUBLIC_DEPLOYMENT_MODE=${WHYLOWDPS_DEPLOYMENT}
RUN npm run build --prefix frontend

FROM rust:1.95-bookworm AS backend-builder

WORKDIR /src
COPY . .
RUN cargo build --release -p whylowdps-server --features web

FROM debian:bookworm-slim AS runtime

ARG WHYLOWDPS_VERSION=unknown
ARG WHYLOWDPS_REVISION=unknown

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libstdc++6 locales tzdata \
    && localedef -i en_US -f UTF-8 en_US.UTF-8 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home --home-dir /home/whylowdps whylowdps \
    && mkdir -p /app/bin /app/frontend /app/resources /app/data-seed /data \
    && chown -R whylowdps:whylowdps /app /data /home/whylowdps

LABEL org.opencontainers.image.version="${WHYLOWDPS_VERSION}" \
      org.opencontainers.image.revision="${WHYLOWDPS_REVISION}" \
      org.opencontainers.image.source="https://github.com/josephlteif/whylowdps"

COPY --from=backend-builder /src/target/release/whylowdps-server /app/bin/whylowdps-server
COPY --from=frontend-builder /src/frontend/out /app/frontend
COPY backend/resources /app/resources
COPY backend/resources/data /app/data-seed
COPY backend/resources/zones-encounters-index.json /app/data-seed/zones-encounters-index.json

ENV BIND_HOST=0.0.0.0 \
    PORT=8000 \
    FRONTEND_DIR=/app/frontend \
    DATA_DIR=/data \
    DATA_SEED_DIR=/app/data-seed \
    DATABASE_URL=/data/whylowdps-multi-user.db \
    SIMC_RUNTIME_DIR=/data/simc-runtime \
    SIMC_CHANNEL=weekly \
    LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8 \
    WHYLOWDPS_DEPLOYMENT=hosted-private \
    WHYLOWDPS_VERSION=${WHYLOWDPS_VERSION} \
    WHYLOWDPS_REVISION=${WHYLOWDPS_REVISION} \
    WHYLOWDPS_SECURE_COOKIES=true

USER whylowdps
WORKDIR /app
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8000/health || exit 1

ENTRYPOINT ["/app/bin/whylowdps-server"]
