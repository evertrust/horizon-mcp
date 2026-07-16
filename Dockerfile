# syntax=docker/dockerfile:1

# ---- Production dependency stage ----------------------------------------
FROM oven/bun:1 AS prod-deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

# ---- Build stage ---------------------------------------------------------
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN bun run build

# ---- Runtime stage -------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist/index.js ./dist/index.js
COPY package.json ./

# Streamable HTTP defaults. The operator MUST also provide, at minimum:
#   HORIZON_URL              the single Horizon backend this instance serves
#   HORIZON_HTTP_AUTH_MODE   service | api-key | mtls
#   HORIZON_TRUSTED_HOSTS or HORIZON_PUBLIC_URL
#       binding 0.0.0.0 with neither set fails closed and refuses to start
#   plus the credential for the chosen auth mode (see README "Transports").
#
# Liveness/readiness probes should target /healthz and /readyz. Both are
# Host-validated, so the probe MUST send a Host header that is in
# HORIZON_TRUSTED_HOSTS (or derived from HORIZON_PUBLIC_URL).
ENV HORIZON_TRANSPORT=http \
    HORIZON_HTTP_HOST=0.0.0.0 \
    HORIZON_HTTP_PORT=8080

EXPOSE 8080
USER node
CMD ["node", "dist/index.js"]
