# syntax=docker/dockerfile:1

# ---- Build stage ---------------------------------------------------------
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN bun run build

# Prune dev dependencies so the runtime image only carries production deps.
RUN bun install --frozen-lockfile --production

# ---- Runtime stage -------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
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
