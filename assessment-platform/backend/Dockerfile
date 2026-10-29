# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24.12.0-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
COPY . .
# Ordinary layer caching is portable across Railway services. Railway cache
# mounts require a literal service-specific ID, which cannot be shared here.
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate && pnpm --filter @assessment/backend build
RUN pnpm --filter @assessment/backend --prod deploy --legacy /opt/backend

# Disposable localhost judge verification only. Never used as an API image.
# The only socket mounted here belongs to the separate local sandbox daemon.
FROM build AS local-sandbox
USER root
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app/backend
CMD ["node", "dist/workers/sandbox/broker.js"]

# DBA-only migration job; never run with an API identity and never run migrate reset.
FROM build AS migrate
WORKDIR /app/backend
CMD ["pnpm", "db:migrate"]

FROM ${NODE_IMAGE} AS base-runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --gid 10001 assessment && useradd --uid 10001 --gid 10001 --no-create-home assessment
COPY --from=build --chown=10001:10001 /opt/backend/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/backend/dist ./dist
COPY --chown=10001:10001 scripts/production-runtime.mjs ./scripts/production-runtime.mjs
USER 10001:10001

FROM base-runtime AS api
EXPOSE 4000
CMD ["node", "scripts/production-runtime.mjs", "dist/main.js"]

FROM base-runtime AS maintenance
CMD ["node", "scripts/production-runtime.mjs", "dist/workers/outbox/main.js"]

# Trusted orchestration worker, not the container in which student code executes.
# No Docker socket or gVisor binary is present. Broker is on a separate dedicated host.
FROM base-runtime AS judge
CMD ["node", "scripts/production-runtime.mjs", "dist/workers/judge/main.js"]

# Hosts that build without --target (including Railway) must start the HTTP API.
# Explicit judge/maintenance/migrate targets remain available for separate services.
FROM api AS railway-api
