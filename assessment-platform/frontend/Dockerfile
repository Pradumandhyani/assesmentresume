# syntax=docker/dockerfile:1.7
# Build from the repository root. Override NODE_IMAGE with an approved sha256 digest.
ARG NODE_IMAGE=node:24.12.0-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
# Rewrites are compiled into the build; deployment gateway also handles /api/v1.
ARG BACKEND_API_URL=http://api:4000
ENV BACKEND_API_URL=${BACKEND_API_URL}
RUN pnpm --filter @assessment/frontend build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 BACKEND_API_URL=http://api:4000
WORKDIR /app
RUN groupadd --gid 10001 assessment && useradd --uid 10001 --gid 10001 --no-create-home assessment
COPY --from=build --chown=10001:10001 /app/frontend/.next/standalone/ ./
USER 10001:10001
EXPOSE 3000
CMD ["node", "frontend/server.js"]
